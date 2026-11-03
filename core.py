"""Shared chat logic for the terminal (chat.py), the app (app/server.py) and the tests (evals/).

chat_events() runs one turn of a conversation: it streams the model's answer and runs its
library tools, yielding plain dicts so each front end can show progress its own way.
Talks only to the local Ollama server, so it works with Wi-Fi off.
"""
import json
import os
import re
import urllib.error
import urllib.request

from library.search import STOPWORDS, TOPICS
from memory import _stems, asked_memory, forgets

HOST = "http://" + os.environ.get("OLLAMA_HOST", "127.0.0.1:11434")
MAX_TOOL_ROUNDS = 6
# Longest reply the model may write in one go, set by the person's "Length limit" (tokens; -1 = no limit). A model
# stuck repeating itself would otherwise run, and drain the battery, until someone noticed (Qwen 3.6 once went an
# hour on one question). With no limit, only the Stop button ends a stuck answer.
LENGTH_LIMITS = {"normal": 8192, "long": 32768, "none": -1}
# How much it may reason before it answers, set by the person's "Reasoning" setting: tokens of reasoning in one round,
# after which its reasoning is cut and it has to answer from what it has (-1 = no limit). A model reasoning in circles
# would otherwise go on until the length limit and never answer. "off" asks it not to reason at all.
REASONING_LIMITS = {"off": 0, "short": 1000, "medium": 4000, "long": 16000, "none": -1}

BASE_PROMPT = """你是一个完全运行在这台电脑上的离线助手，没有联网能力：你不能上网，也不能替提问的人打电话或联系任何人。提问的人可能正在经历停电或其他紧急情况，设备也许只剩电池供电。"""

LIBRARY_PROMPT = """

你有一个离线知识库：用 search_library 搜索它，用 read_article 读取结果。id 是给你调用工具用的，不要给对方看。知识库里有：{labels}。{personal}如果对方想看来源或完整说明，用 show_article 为他打开。"""

RULES = """

怎么回答：
- {search_rule}
- 先给直接答案，需要步骤时再列简短的编号步骤。
- 安全优先。说出真实的危险（一氧化碳、火灾、触电、变质食物、不安全的水、受伤），并直说什么时候该打 911。
- 每次停电都有人死于一氧化碳。绝不建议在室内或车库里开动发电机、汽车、烤炉或露营炉，即使门窗开着也不行；也绝不用燃气烤箱或炉灶取暖。取暖设备必须是室内专用型，并配合可用的 CO 报警器。这些规则没有任何“如果实在没办法”的例外。
  (English restatement, for emphasis: never run a generator, car, grill or camp stove indoors or in a garage, not even with the door or windows open; never heat with a gas oven or stove; heaters must be indoor-rated and used with a working CO alarm; no "if you must" exceptions.)
- 一定要回答。当被问到一个没人实测过的数字（概率、以微死亡（micromort）计的风险、某个数量）时，也要给出估计：根据你所知道的推理出来，给出一个数字或区间，并说明你有多大把握。涉及死亡风险时，先查知识库里的微死亡参考资料和死亡率表。数据缺失绝不是不给数字的理由。当你确实没把握时，照样给出数字，并说明：“这是我能给出的最好估计，但我确实不确定，你不该采信这个回答。”
- 当知识库支撑不了答案时，仍然根据你所知道的作答；万不得已可以推测，但必须说明（“据我所知：”或“我在这里只是推测：”）。绝不能把推测说成事实，尤其是电话号码、地址、当地规定和当前情况，这些人们会照着去做。
- 不要加“我不是医生”或“请咨询专业人士”这类免责声明；应用已经说明 AI 会出错。但有人现在就需要急救时，要说出来。{sources_rule}
- 用简体中文回答。引用文章标题、来源名（Ready.gov、CDC 等）或英文原文时保留英文，必要时加一句中文说明。
- 除非对方要求更详细，回答要简短，以省电。"""

TOOLS = [
    {"type": "function", "function": {
        "name": "search_library",
        "description": "用关键词搜索离线知识库。返回最匹配的段落，每段带一个 id，供 read_article 使用。"
                       "用几个具体的关键词，不要写一整句话。知识库内容是英文，请用英文关键词搜索。",
        "parameters": {"type": "object", "properties": {
            "query": {"type": "string",
                      "description": "关键词，例如 'generator carbon monoxide garage'（知识库为英文，用英文关键词更准）"},
            "topic": {"type": "string", "enum": ["any", *TOPICS],
                      "description": "可选：只搜索某一类来源"}},
            "required": ["query"]}}},
    {"type": "function", "function": {
        "name": "read_article",
        "description": "读取一篇文章约 5,000 字符，从搜索结果所在的段落开始。",
        "parameters": {"type": "object", "properties": {
            "id": {"type": "integer", "description": "来自 search_library 的 id"}},
            "required": ["id"]}}},
    {"type": "function", "function": {
        "name": "show_article",
        "description": "把一篇文章打开显示在对方的屏幕上，让他自己读，并滚动到这个 id 所在的段落。"
                       "当他要求看来源或完整说明时使用。",
        "parameters": {"type": "object", "properties": {
            "id": {"type": "integer", "description": "来自 search_library 或 read_article 的 id"}},
            "required": ["id"]}}},
]

# Qwen drafts an answer before it searches when its reasoning is fully off, so with Reasoning off it still gets a brief
# think (held to the short limit); Qwen's highest effort goes with the long and unlimited settings.
THINK_OFF = {"qwen": "low"}
THINK_LONG = {"qwen": "xhigh"}
SAMPLING = {
    "qwen": {"temperature": 0.7, "top_p": 0.8, "top_k": 20},
    "nemotron": {"temperature": 0.7, "top_p": 0.95},
    "granite": {"temperature": 0.3, "top_p": 0.9},
    "gemma": {"temperature": 0.7, "top_p": 0.95, "top_k": 64},
}
_shown = {}  # model -> Ollama's /api/show answer


def _show(model):
    if model not in _shown:
        try:
            _shown[model] = _post("/api/show", {"model": model})
        except (OSError, ValueError):
            return {}  # not cached: Ollama may just not be running yet
    return _shown[model]


def family(model):
    """Which SAMPLING/THINK settings fit a model: from its name, else from the family Ollama reports."""
    known = next((f for f in SAMPLING if f in model.lower()), "")
    if known:
        return known
    details = _show(model).get("details") or {}
    names = " ".join([details.get("family") or ""] + (details.get("families") or [])).lower()
    return next((f for f in SAMPLING if f in names), "")


def _post(path, body, stream=False):
    req = urllib.request.Request(HOST + path, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    resp = urllib.request.urlopen(req, timeout=900)
    return resp if stream else json.load(resp)


def capabilities(model):
    return set(_show(model).get("capabilities") or [])


def think_setting(model, caps, reasoning="off"):
    """Ollama's "think" for this model at this Reasoning setting: None for a model that can't reason, False for none."""
    if "thinking" not in caps:
        return None
    fam = family(model)
    if REASONING_LIMITS.get(reasoning, 0) == 0:
        return THINK_OFF.get(fam, False)
    if reasoning in ("long", "none"):
        return THINK_LONG.get(fam, True)
    return "low" if fam == "qwen" and reasoning == "short" else True


def system_prompt(library, tools=True):
    """library: a Library (its sources get listed for the model) or None."""
    has_library = library is not None
    if has_library and tools:
        labels = ", ".join(library.labels()) if hasattr(library, "labels") else "参考文章"
        personal = ('来自“我的文件”的结果是对方自己添加的文件，比如他自己设备的说明书、他的药物或他的计划；'
                    '只要有相关的，就优先于通用建议。'
                    if getattr(library, "has_personal", False) else "")
        return BASE_PROMPT + LIBRARY_PROMPT.format(labels=labels, personal=personal) + RULES.format(
            search_rule="回答任何事实、医学、安全或操作类问题之前，都要先搜索知识库，即使你觉得你已经知道答案，"
                        "这样对方才能核对其出处。第一次没找到就换一种说法再试一次，读最相关的那条结果，"
                        "并以此为基础作答。如果确实没有相关内容，也要照样回答。"
                        "当来源之间说法不一致时，以 Ready.gov、CDC、MedlinePlus、英国用药指南、WikEM 和 WikiMed 为准，"
                        "而不是 wikiHow 和问答网站。",
            sources_rule="\n- 最后单起一行，以 Sources: 开头，列出你实际读过的文章。应用会把你在界面上打开过的每一篇都显示给对方，"
                         "所以只写你真正读过的，绝不编造。如果你是根据已有知识回答的，就写 Sources: none（来自我自己的知识）。")
    if has_library:
        return BASE_PROMPT + RULES.format(
            search_rule="问题后面可能附有知识库摘录；相关时以它们为基础作答。",
            sources_rule="\n- 最后单起一行，以 Sources: 开头，列出你用到的摘录；如果它们都没帮上忙，就写 "
                         "Sources: none（来自我自己的知识）。对方也能看到这些摘录，所以不要写别的东西。")
    return BASE_PROMPT + RULES.format(
        search_rule="根据你所知道的作答；你查不了任何资料。",
        sources_rule="\n- 不要引用你无法核实的来源。")


BAD_ID = "id 必须是 search_library 给出的数字。"
NO_PASSAGE = "没有这个 id 对应的段落。"
# Models sometimes open an id they never saw (Lightning opened "How to Be an Organized Artist" that way, then cited it).
UNSEEN_ID = "搜索结果里没有这个 id。请用 search_library 结果中的 id，或者根据已有的内容作答。"
TOOL_ERRORS = {BAD_ID, NO_PASSAGE, UNSEEN_ID}
KNOWN_ID = re.compile(r"\[id (\d+)\]|read_article\(id=(\d+)\)")  # ids the tools have shown the model


def _ids(text):
    return {int(a or b) for a, b in KNOWN_ID.findall(text or "")}


def _args(call):
    args = call.get("function", {}).get("arguments") or {}
    if isinstance(args, str):
        try:
            args = json.loads(args or "{}")
        except ValueError:
            args = {}
    return args if isinstance(args, dict) else {}


def _used_ids(messages):
    """Passages it read or showed earlier in this chat. Their ids stay usable after trim() has shortened those results
    to a title, as the model still sees them in its own earlier calls."""
    used, pending = set(), []
    for m in messages:
        if m.get("role") == "assistant":
            pending = list(m.get("tool_calls") or [])
        elif m.get("role") == "tool" and pending:
            call = pending.pop(0)
            if call.get("function", {}).get("name") in ("read_article", "show_article") \
                    and (m.get("content") or "") not in TOOL_ERRORS:
                try:
                    used.add(int(_args(call).get("id")))
                except (TypeError, ValueError):
                    pass
    return used


def run_tool(library, name, args):
    """Run one tool call. Returns (text for the model, event for the screen or None)."""
    if name == "search_library":
        query, topic = str(args.get("query", "")), args.get("topic") or "any"
        hits = library.search(query, topic=topic)
        event = {"type": "search", "query": query, "topic": topic,
                 "results": [{k: h[k] for k in ("id", "title", "source", "official")} for h in hits]}
        if not hits:
            return "没有结果。换个说法，或者少用几个关键词。", event
        return "\n\n".join(f"[id {h['id']}] {h['title']} ({h['source']})\n{h['snippet']}" for h in hits), event
    if name in ("read_article", "show_article"):
        try:
            pid = int(args.get("id", 0))
        except (TypeError, ValueError):
            return BAD_ID, None
        doc = library.read(pid)
        if not doc:
            return NO_PASSAGE, None
        event = {"type": "read" if name == "read_article" else "show", "id": pid,
                 "title": doc["title"], "source": doc["source"], "official": doc["official"]}
        if name == "show_article":
            return f"已在屏幕上打开“{doc['title']}”（{doc['source']}）。", event
        more = f"\n\n[More of this article: read_article(id={doc['next_id']})]" if doc["next_id"] else ""
        return f"{doc['title']} ({doc['source']})\n{doc['url'] or ''}\n\n{doc['text']}{more}", event
    return f"未知的工具 {name}", None


def _stream(model, messages, tools, think, options):
    body = {"model": model, "messages": messages, "stream": True, "keep_alive": "15m", "options": options}
    if tools:
        body["tools"] = tools
    if think is not None:
        body["think"] = think
    with _post("/api/chat", body, stream=True) as resp:
        for line in resp:
            yield json.loads(line)


def attach_excerpts(library, messages):
    """For models without tool support: put the top library passages into the question itself."""
    question = messages[-1]["content"]
    hits = library.search(question, limit=4)
    blocks = []
    for h in hits:
        doc = library.read(h["id"], max_chars=2500)
        blocks.append(f"[{doc['title']} ({doc['source']})]\n{doc['text']}")
    if blocks:
        messages[-1] = {"role": "user", "content": question + "\n\nLibrary excerpts:\n\n" + "\n\n".join(blocks)}
    return [{"type": "read", **{k: h[k] for k in ("id", "title", "source", "official")}} for h in hits]


TOOL_MARKUP = ("<tool_call", "<function")
SOURCES_LINE = re.compile(r"^[*_# ]*Sources?(?:[*_ ]*:.*|[*_ ]*)$", re.IGNORECASE | re.MULTILINE)  # or a "Sources" heading
LIST_ITEM = re.compile(r"\s*([-*•–+]|\d+[.)])\s")
ID_ROW = re.compile(r"\s*\[ids?\s*\d{5,}\]", re.I)
# A passage id the way models write one: "1403312", "[id 1403312]", "(ids 1403312 and 1403313, etc.)", "passage
# #1403312", "read_article(id=1403312)", "id **1403312**".
_ONE_ID = r"(?:\b(?:passages?|ids?)\b\s*[:=#]?\s*|#)?[*_]*\b\d{5,}\b[*_]*"
ID_REF = re.compile(r"(\bread_article\(\s*(?:id\s*=\s*)?)?\[?" + _ONE_ID + r"(?:\s*(?:,|and|&|/)\s*" + _ONE_ID
                    + r")*(?:,?\s*etc\b\.?)?\]?(?(1)\s*\)?)", re.I)
ID_REMARK = re.compile(r"[ \t]*[(\[]\s*(?:passage\s+)?ids?\s*:?\s*\d{5,}(?:\s*(?:,|and)\s*\d{5,})*(?:,?\s*etc\.?)?\s*[)\]]",
                       re.I)
LOOKUP_PREAMBLE = re.compile(r"(?:let me|i'll|i will|i need to|i should|now i|next,? i|first,? i)\b[^\n]{0,200}?"
                             r"\b(?:search|look|check|read|open|find)\b[^\n]{0,200}$", re.I)
INLINE_SOURCES = re.compile(r"([.!?])[ \t]+((?:\*\*)?Sources?(?:\*\*)?:[^\n]*?)\s*\Z")
# A Sources line made of tool calls ("Sources: search_library (generator carbon monoxide garage), read_article (...)"),
# written out instead of looking anything up: Lightning opened an answer with one in the 0.3.1 Windows test.
TOOL_SOURCES = re.compile(r"^[*_# ]*Sources?\b[^\n]*\b(?:search_library|read_article|show_article)\b[^\n]*(?:\n|\Z)",
                          re.IGNORECASE | re.MULTILINE)
# Said before the last round, after the lookups run out. Without it some models (Granite) answer the last
# round with yet another lookup written out as text, and the person gets no answer at all.
FINAL_NUDGE = ("（来自应用的提示，不是对方说的：你的知识库查询次数已经用完。现在根据你已经读过的内容回答问题，"
               "并列出你的来源。不要再调用任何工具。）")
THINK_NUDGE = ("（来自应用的提示，不是对方说的：你已经思考得够久了。现在根据已有的内容简短回答，并列出你的来源。）")
# When the person asks it to look something up and it answers from memory, it is asked once more, told to search.
SEARCH_NUDGE = ("（来自应用的提示，不是对方说的：对方要求你查一下。回答前先用 search_library 搜索知识库。）")
ASKED_SEARCH = re.compile(r"\b(?:look (?:it|that|this|them|those) up|look up|search (?:the library|for|it|that|this)|"
                          r"check (?:the library|your sources|a source)|look (?:in|through) the library|"
                          r"find (?:a|the|me a|some) sources?|what does the library say|in the library)\b|"
                          r"查一下|查查|搜一下|搜索一下|查资料|查一下知识库|查知识库|有来源吗|出处|依据", re.I)
# Said with the best passages its searches found, when it looked things up but wrote no answer: Granite searched six
# times for "A power line is down in my front yard" and then wrote another lookup instead of answering (issue #2).
RESCUE_NOTE = ("（来自应用的提示，不是对方说的：你不能再查别的了。现在根据这些知识库摘录和你所知道的回答问题，"
               "并列出你的来源。）")
# After an answer, the model gets one short request of its own to update its notes about the person (memory.py).
# Asked while answering, models put the question first and rarely saved anything; asked for tool calls after the
# answer, Nemotron Super said "nothing to save" about "I have type 1 diabetes"; given the whole chat, Lightning lost
# such facts among the library results. A short request with just what the person said, answered in JSON, worked
# best for every model, and Ollama still has the chat cached for the next question.
MEMORY_CHECK = """你在为 Survival LLM（一个离线助手应用）记录关于这个人的简短条目，好让它在之后的对话里认识他们。你的条目现在是：
{notes}

{earlier}他们最后说的话："{said}"

只保存他们最后那句话里关于他们自己或家里、在之后的对话里仍然成立、并且还没在你的条目里的内容：家里有谁和他们的年龄、健康状况、药物、过敏、怀孕、宠物、他们的设备、住在哪里、他们某个文件是什么或有多重要、他们喜欢什么样的回答。不要保存他们的问题、今天正在发生的事（停电、今天的症状）、知识库里的事实或你的猜测。当他们要求你忘记或删除什么时，把它提到的条目原样放进 "forget"；不要把条目改写成“已经没有了”。

只回复一个 JSON 对象：
{"forget": [因为对方要求忘记而要删除的条目，按条目里的原文写],
 "change": [{"old": 条目里的原文, "new": 现在应该写成什么}, 针对发生变化的事实],
 "remember": [新的事实，一条一个]}
没有要做的就都用空列表。

示例：
- "我女儿 Maya 7 岁，对青霉素过敏。她今晚耳朵疼。" 得到 {"forget": [], "change": [], "remember": ["女儿 Maya（7 岁）对青霉素过敏。"]}（耳朵疼会好，所以不记）。
- "我在吃抗凝药。我能吃布洛芬治背痛吗？" 得到 {"forget": [], "change": [], "remember": ["在服用抗凝药。"]}（顺带提到的一个事实也算）。
- "请忘掉我住在哪。" 在条目 "住在得克萨斯州奥斯汀。" 下得到 {"forget": ["住在得克萨斯州奥斯汀。"], "change": [], "remember": []}
- "忘掉我的猫。" 在条目 "有两只猫。" 下得到 {"forget": ["有两只猫。"], "change": [], "remember": []}
- "发电机说明书是我最重要的文件。" 得到 {"forget": [], "change": [], "remember": ["最重要的文件：发电机说明书。"]}
- "医生把我的二甲双胍加到 1000 mg。" 在条目 "服用二甲双胍 500 mg，每天两次。" 下得到 {"forget": [], "change": [{"old": "服用二甲双胍 500 mg，每天两次。", "new": "服用二甲双胍 1000 mg，每天两次。"}], "remember": []}
- "删掉关于我自行车的那条。" 在条目 "有一辆电动自行车，用来办事。" 下得到 {"forget": ["有一辆电动自行车，用来办事。"], "change": [], "remember": []}
- "我卖掉了斯巴鲁，买了辆福特皮卡。" 在条目 "开一辆斯巴鲁傲虎。" 下得到 {"forget": [], "change": [{"old": "开一辆斯巴鲁傲虎。", "new": "开一辆福特皮卡。"}], "remember": []}
- "停电了。冰箱里的食物还能放多久？" 得到 {"forget": [], "change": [], "remember": []}"""
PERSONAL = re.compile(r"\b(i|i'm|im|i've|ive|i'd|my|me|mine|myself|we|we're|we've|our|ours|us|forget|remember|remind|"
                      r"daughter|son|wife|husband|partner|kids?|child|children|baby|mom|dad|mother|father|grand\w+|"
                      r"family|household|roommates?)\b|"
                      r"(?:我|我的|我家|我们|咱|孩子|儿子|女儿|妻子|丈夫|老公|老婆|爱人|父母|爸|妈|老人|室友|家里|"
                      r"记住|记一下|忘了|忘记|别记)", re.I)


def chat_events(model, library, messages, reasoning="off", caps=None, length="normal", memory=None):
    """Answer the last user message. Yields thinking/search/read/show/token/tick/done events (thinking and token
    events carry the model's reasoning and answer as they stream), then, with a memory the person lets the AI write
    to, memory_check and memory events from a short step after the answer."""
    caps = capabilities(model) if caps is None else caps
    can_call = "tools" in caps
    tools = TOOLS if (library and can_call) else None
    question = messages[-1]["content"]
    think = think_setting(model, caps, reasoning)
    limit = LENGTH_LIMITS.get(length, LENGTH_LIMITS["normal"])
    # With Reasoning off, a model that reasons anyway (Qwen's brief think) is held to the short limit.
    think_cap = REASONING_LIMITS.get(reasoning, 0) or REASONING_LIMITS["short"]
    test = _test_case()
    if test.startswith("think-limit="):
        think_cap = int(test.split("=", 1)[1])
    # The length limit is for the answer: reasoning comes on top of it, since Ollama counts both.
    options = {"num_ctx": 32768, "num_predict": -1 if limit < 0 or think_cap < 0 else limit + think_cap,
               **SAMPLING.get(family(model), {"temperature": 0.7})}
    sources, seen, tokens, seconds, cut_off, looked, unopened, named = {}, {}, 0, 0.0, False, False, [], None
    dropped = False
    earlier = any(m.get("role") == "tool" for m in messages)  # lookups from earlier questions in this chat
    known = set().union(_used_ids(messages), *(_ids(m.get("content")) for m in messages if m.get("role") == "tool"))
    read_before = _read_earlier(messages)
    if library and not can_call:
        for event in attach_excerpts(library, messages):
            sources.setdefault(event["id"], {k: event.get(k) for k in ("title", "source", "official")})
            yield event
    must_search = bool(tools) and bool(ASKED_SEARCH.search(question))  # they asked it to look something up
    round_no, nudge = 0, None  # nudge: a note from the app for the next round
    while True:
        answer_now = nudge == THINK_NUDGE
        use_tools = tools if round_no < MAX_TOOL_ROUNDS and not answer_now else None  # last round: must answer
        if tools and not use_tools and not nudge:
            nudge = FINAL_NUDGE
        if nudge:
            messages.append({"role": "user", "content": nudge})
        content, calls, final, held, thought, over = [], [], {}, [], 0, False
        stream = _stream(model, messages, use_tools, False if answer_now else think, options)
        for chunk in stream:
            msg = chunk.get("message", {})
            if msg.get("thinking"):
                yield {"type": "thinking", "text": msg["thinking"]}  # its reasoning, which the person can read
                thought += 1  # it streams about a token at a time
                if 0 < think_cap < thought and not content and not calls and not answer_now:
                    over = True
                    break
            elif not msg.get("content"):
                yield {"type": "tick"}  # nothing to show: lets the server notice a closed page
            if msg.get("content"):
                content.append(msg["content"])
                # Some models write a tool call out as text before Ollama turns it into tool_calls; keep that
                # markup off the screen, and hold back text that may still turn out to be the start of it.
                text = "".join(content).lstrip()
                if tools and text.startswith(TOOL_MARKUP):  # also on the last round, where it can't be run
                    yield {"type": "tick"}
                elif tools and any(t.startswith(text) for t in TOOL_MARKUP):
                    held.append(msg["content"])
                else:
                    yield {"type": "token", "text": "".join(held) + msg["content"]}
                    held = []
            calls.extend(msg.get("tool_calls") or [])
            if chunk.get("done"):
                final = chunk
        if hasattr(stream, "close"):
            stream.close()  # stops Ollama generating when the loop above ended early
        sent, nudge = nudge, None
        if sent:
            messages.pop()  # keep the app's notes out of the saved conversation
        if over:  # reasoning in circles: answer now from what it has, with no more reasoning or lookups
            yield {"type": "think_limit", "limit": think_cap}
            nudge = THINK_NUDGE
            continue
        if held and not calls:
            yield {"type": "token", "text": "".join(held)}
        tokens += final.get("eval_count", 0)
        cut_off = cut_off or final.get("done_reason") == "length"
        seconds += final.get("eval_duration", 0) / 1e9
        if not use_tools:
            dropped = bool(calls)
            calls = []  # the last round is for answering: a lookup asked for anyway isn't run
        if must_search and use_tools and not looked and not calls:  # asked to look it up, it answered from memory
            must_search, nudge = False, SEARCH_NUDGE
            yield {"type": "retry", "why": "search"}  # what streamed so far isn't the answer
            continue
        entry = {"role": "assistant", "content": "".join(content)}
        if calls:
            entry["tool_calls"] = calls
        messages.append(entry)
        if not calls:
            break
        looked = True
        for call in calls:
            fn, args = call.get("function", {}), _args(call)
            try:
                pid = int(args.get("id"))
            except (TypeError, ValueError):
                pid = None
            if fn.get("name") in ("read_article", "show_article") and pid is not None and pid not in known:
                result, event = UNSEEN_ID, None
            else:
                result, event = run_tool(library, fn.get("name"), args)
            known |= _ids(result)
            if event:
                if event["type"] in ("read", "show"):
                    sources.setdefault(event["id"], {k: event.get(k) for k in ("title", "source", "official")})
                for hit in event.get("results", []):
                    seen.setdefault(hit["id"], {k: hit.get(k) for k in ("title", "source", "official")})
                yield event
            messages.append({"role": "tool", "tool_name": fn.get("name"), "content": result})
        round_no += 1
    if test == "no-answer" and tools:  # as if it had written a lookup instead of its answer
        messages[-1]["content"] = '<tool_call>{"name": "search_library"}</tool_call>'
    answer, unfinished, discarded = messages[-1]["content"], False, None
    # No answer: a lookup written out as text, or cut off inside one, nothing at all, a tool's error repeated as the
    # answer, or "Let me check one more source." before a lookup it wasn't given.
    no_answer = lambda text: text.lstrip().startswith(TOOL_MARKUP) or not text.strip() \
        or text.strip().strip('"') in TOOL_ERRORS or bool(dropped and LOOKUP_PREAMBLE.match(text.strip()))  # noqa: E731
    if tools and no_answer(answer):
        discarded = answer  # kept for the eval logs
        rescue = yield from _rescue(model, library, messages, question, sources, seen, options)
        if rescue:
            tokens, seconds, cut_off = tokens + rescue["tokens"], seconds + rescue["seconds"], cut_off or rescue["cut_off"]
            if not no_answer(rescue["text"]):
                answer = messages[-1]["content"] = rescue["text"]  # the saved chat keeps the answer it gave
    read = _one_per_article([{"id": k, **v} for k, v in sources.items()])
    found = _one_per_article(read + [{"id": k, **v} for k, v in seen.items()])  # read first, then the rest
    if no_answer(answer):
        answer, unfinished = "", True  # nothing to show
    elif library:
        answer = TOOL_SOURCES.sub("", answer).strip("\n")  # the Sources line added below says what it really read
        # The model names the sources it used, and the screen shows every article it opened. Models still name sources
        # they never opened (evals/citation_check.py), so a Sources line that does is replaced by what it read.
        if read:
            line = "Sources: " + "; ".join(f"{s['title']} ({s['source']})" for s in read[:6])
        elif looked:
            line = "Sources: none opened (it only saw the search results below)"
        elif earlier:
            line = "Sources: what it read earlier in this chat"
        else:
            line = "Sources: none (from its own knowledge)"
        # Articles it only saw in search results count too: they exist, and it saw their excerpts.
        shown, ids = read_before + [{"id": k, **v} for k, v in seen.items()], set(sources) | set(seen)
        by_id = {**seen, **sources}
        made_up = lambda items: [n for n in items or [] if not _opened(n, read, shown, ids)]  # noqa: E731
        # "...add it to the file. Sources: X" at the very end goes on a line of its own, but only when X names what it
        # read or saw: in "Heat one room. Source: a wood stove, never a grill indoors" it is part of the answer.
        moved = INLINE_SOURCES.sub(r"\1\n\n\2", answer)
        if moved != answer and cited_sources(moved) and not made_up(cited_sources(moved)):
            answer = moved
        named = cited_sources(answer)
        unopened = made_up(named)
        # "OK, I'll forget where you live." answers a request, not a question: no "from its own knowledge" line. Only
        # when the message asks nothing else and the reply reads as a short acknowledgment ("Remember my son weighs
        # 16 kg. how much Tylenol can he have" still gets the line).
        just_memory = not named and not read and not looked and not earlier and asked_memory(question) \
            and not INFO_ASK.search(question) and ACKNOWLEDGED.search(answer.replace("’", "'")) and len(answer) < 300
        if (not named or unopened) and not just_memory:
            answer = _with_sources_line(answer, line)
        elif named and any(_known_ids(item, by_id) for item in named):  # named by id, meaningless to the person
            answer = _with_sources_line(answer, "Sources: " + "; ".join(_titled(item, by_id) for item in named))
        # "(ids 1403312, 1400192, etc.)" in the text goes; "(ID 4471203)" from the person's insurance card doesn't.
        block, pool = _sources_block(answer), known | ids | {s["id"] for s in read_before if s.get("id") is not None}
        cut = block[0] if block else len(answer)
        answer = ID_REMARK.sub(lambda m: "" if _known_ids(m.group(0), pool, every=True) else m.group(0), answer[:cut]) \
            + answer[cut:]
    yield {"type": "done", "tokens": tokens, "seconds": seconds, "answer": answer, "cut_off": cut_off,
           "unfinished": unfinished, "unopened": unopened, "named": named if library and not unfinished else None,
           "sources": read, "seen": found[len(read):], "think": think, "discarded": discarded}
    # Only when they said something about themselves or their family, or asked it to remember or forget something: the
    # step takes a few seconds. Not after an answer cut off at the length limit, which "Keep going" continues. It reads
    # only what the person said, so an answer that didn't finish doesn't stop it.
    if memory is not None and memory.ai_writes and not cut_off and _about_them(question, messages, memory):
        try:
            yield from memory_check(model, messages, memory, think_setting(model, caps), options)
        except Exception:  # noqa: BLE001 - the answer is out; a failed memory step only means nothing new was saved
            yield {"type": "memory_failed"}


def _test_case():
    """A case a dev copy forces so it can be tried with a real model (bin/dev --test): "no-answer" (every answer comes
    out as a lookup written as text) or "think-limit=N" (reasoning stops after N tokens). Ignored outside dev copies."""
    case = os.environ.get("SURVIVAL_LLM_TEST", "") if os.environ.get("SURVIVAL_LLM_DEV") else ""
    return case if case == "no-answer" or re.fullmatch(r"think-limit=\d+", case) else ""


def _rescue(model, library, messages, question, sources, seen, options):
    """It looked things up but wrote no answer: show it the best passages its searches found (what it read first, else
    the top search results, else a search for the question) and ask once more, without tools or reasoning. Yields a
    read event for each passage it is given; returns {"text", "tokens", "seconds", "cut_off"}, or None with nothing to
    give it."""
    picks = list(sources) + [pid for pid in seen if pid not in sources]
    picks = picks or [h["id"] for h in library.search(question, limit=4)]
    blocks = []
    for pid in picks:
        doc = library.read(pid, max_chars=2500)
        if not doc:
            continue
        blocks.append(f"[{doc['title']} ({doc['source']})]\n{doc['text']}")
        if pid not in sources:
            sources[pid] = {k: doc[k] for k in ("title", "source", "official")}
            yield {"type": "read", "id": pid, **sources[pid]}
        if len(blocks) == 4:
            break
    if not blocks:
        return None
    yield {"type": "retry", "why": "excerpts"}  # what streamed so far isn't the answer
    messages.append({"role": "user", "content": RESCUE_NOTE + "\n\n" + "\n\n".join(blocks)})
    content, final = [], {}
    try:
        for chunk in _stream(model, messages, None, False, options):
            msg = chunk.get("message", {})
            if msg.get("thinking"):
                yield {"type": "thinking", "text": msg["thinking"]}
            if msg.get("content"):
                content.append(msg["content"])
                yield {"type": "token", "text": msg["content"]}
            elif not msg.get("thinking"):
                yield {"type": "tick"}
            if chunk.get("done"):
                final = chunk
    finally:
        messages.pop()  # the note and its excerpts stay out of the saved conversation
    return {"text": "".join(content), "tokens": final.get("eval_count", 0),
            "seconds": final.get("eval_duration", 0) / 1e9, "cut_off": final.get("done_reason") == "length"}


# The notes in MEMORY_CHECK's examples: Granite once saved the generator-manual example's note for
# someone's EU2200i manual.
EXAMPLE_NOTES = {n.lower() for n in re.findall(r'"(?:remember": \[|new": )"([^"]+)"', MEMORY_CHECK)}
NOT_NAMES = set("How What When Where Why Which Who Whose Can Could Should Would Will Does Did Do The This That These "
                "Those Is Are Was Were Has Have Had Takes Lives Uses Owns Keeps Their They There Please Also And But "
                "Then Actually Okay Yes Our Its Any Some Every".split())


def _about_them(question, messages, memory):
    """Whether the person's message may say something about them worth a note: "my", a family word or a memory
    request, or someone their notes name ("Leo is allergic to peanuts too"), or he/she right after they spoke about
    their family ("Actually he's 9, not 8")."""
    if PERSONAL.search(question) or asked_memory(question):
        return True
    notes = " ".join(memory.notes())
    if any(re.search(rf"\b{w}\b", notes) for w in set(re.findall(r"\b[A-Z][a-z]{2,}\b", question)) - NOT_NAMES):
        return True
    said = [m["content"] for m in messages if m.get("role") == "user"]
    return bool(re.search(r"\b(he|she|him|her|his|hers)\b|\b(he|she)['’]s\b", question, re.I)) \
        and any(PERSONAL.search(m) for m in said[-5:-1])


def memory_check(model, messages, memory, think, options):
    """Let the model save, change or delete notes about the person, from what they just said (and, for context, a
    few of their earlier messages in this chat)."""
    said = [m["content"].split("\n\nLibrary excerpts:", 1)[0]  # models without tools get excerpts added to questions
            for m in messages if m.get("role") == "user"]
    notes = "\n".join(f"- {n}" for n in memory.notes()) or "(none yet)"
    earlier = "".join(f'早先在这个对话里，对方说过：“{m[:300]}”\n' for m in said[-4:-1])
    fill = {"notes": notes, "earlier": earlier + ("\n" if earlier else ""), "said": said[-1] if said else ""}
    prompt = re.sub(r"\{(notes|earlier|said)\}", lambda m: fill[m.group(1)], MEMORY_CHECK)  # one pass: notes may hold braces
    yield {"type": "memory_check"}
    reply = []
    # The same num_ctx as the answer: a different one would make Ollama load the model again.
    for chunk in _stream(model, [{"role": "user", "content": prompt}], None, think,
                         {**options, "num_predict": 600, "temperature": 0.3}):
        reply.append(chunk.get("message", {}).get("content") or "")
        yield {"type": "tick"}
    changed = False
    plan = memory_plan("".join(reply))
    words = _stems(said[-1] if said else "")
    copied = lambda note: note.strip().lower() in EXAMPLE_NOTES and not _stems(note) <= words  # noqa: E731
    asked = lambda note: _is_question(note, said[-1] if said else "")  # noqa: E731
    plan["remember"] = [n for n in plan["remember"] if not copied(n) and not asked(n)]  # not a fact about them
    plan["change"] = [c for c in plan["change"] if not copied(c["new"]) and not asked(c["new"])]
    for event in memory.apply(forgets(plan, said[-1] if said else "", memory.notes())):
        changed = True
        yield event
    if not changed and asked_memory(said[-1] if said else ""):
        yield {"type": "memory_unchanged"}  # they asked it to remember or forget something, and nothing changed


def _is_question(note, said):
    """Whether a note the model wants to keep is the person's question rather than a fact about them: Lightning saved
    "Where can I safely run a generator?" both times it was asked (0.3.1 Windows test)."""
    text, ask = note.strip(" \"'“”‘’"), said.strip(" \"'“”‘’")
    return text.endswith(("?", "？")) or (ask.endswith(("?", "？")) and _stems(text) == _stems(ask))


def memory_plan(reply):
    """The model's JSON reply as {"forget": [...], "change": [{"old", "new"}], "remember": [...]}; empty if unreadable.
    Takes the first JSON object in the reply that has any of those keys, and a single item where a list belongs."""
    plan, decoder = {}, json.JSONDecoder()
    # Small slips that make the rest unreadable: a stray quote before the closing brace, a comma before it.
    reply = reply + "\n" + re.sub(r",\s*([}\]])", r"\1", re.sub(r'(\])\s*"\s*(\})', r"\1\2", reply))
    for i, ch in enumerate(reply):
        if ch != "{":
            continue
        try:
            found = decoder.raw_decode(reply, i)[0]
        except ValueError:
            continue
        if isinstance(found, dict) and {"forget", "change", "remember"} & set(found):
            plan = found
            break

    def items(key):
        value = plan.get(key)
        return value if isinstance(value, list) else [value] if isinstance(value, (str, dict)) else []

    texts = lambda key: [x for x in items(key) if isinstance(x, str) and x.strip()]  # noqa: E731
    return {"forget": texts("forget"), "remember": texts("remember"),
            "change": [c for c in items("change") if isinstance(c, dict)
                       and isinstance(c.get("old"), str) and isinstance(c.get("new"), str)]}


def _sources_block(answer):
    """The answer's closing list of sources as (start, end, items), or None. That is the last "Sources" line or heading,
    with any list right under it and at most a short remark after; a lone "Source:" line counts only as the very last
    line, since one higher up may be part of the answer ("Source: rain barrel")."""
    found = list(SOURCES_LINE.finditer(answer))
    if not found:
        return None
    line = found[-1]
    plural = bool(re.match(r"^[*_# ]*Sources", line.group(0), re.IGNORECASE))
    head = re.sub(r"^[*_# ]*Sources?[*_ ]*:?", "", line.group(0), flags=re.IGNORECASE)
    items, end = [p.strip(" *_.") for p in _split_outside_brackets(head)], line.end()
    if plural:
        bare = not [i for i in items if i]  # "Sources:" alone: the rows right under it are its list, bulleted or not
        for row in answer[end:].split("\n")[1:]:
            if LIST_ITEM.match(row):
                items.append(row[LIST_ITEM.match(row).end():].strip(" *_."))
            elif ID_ROW.match(row):  # "[id 1403312] Water storage (Ready.gov)", the way search results list them
                items.append(row.strip(" *_."))
            elif bare and row.strip() and not row.lstrip().startswith("|") \
                    and ("(" in row or not row.rstrip(" *_").endswith((".", "!", "?"))):  # a sentence is the answer's
                items += [p.strip(" *_.") for p in _split_outside_brackets(row)]
            elif row.strip():
                break
            elif bare and any(items):
                break  # a blank line ends a list without bullets
            end = min(len(answer), end + 1 + len(row))
    tail = answer[end:].strip()
    if (tail and not plural) or len(tail) > 300:
        return None
    return line.start(), end, [item for item in items if item]


def cited_sources(answer):
    """What the answer's closing Sources line names, item by item; None if it has none."""
    block = _sources_block(answer)
    return block[2] if block else None


def _split_outside_brackets(text, separators=(";", " | ")):
    """Split text at the separators, but not inside parentheses or brackets."""
    parts, depth, start, i = [], 0, 0, 0
    while i < len(text):
        depth += text[i] in "([" and 1 or text[i] in ")]" and -1 or 0
        sep = next((x for x in separators if depth <= 0 and text.startswith(x, i)), None)
        if sep:
            parts.append(text[start:i])
            start = i = i + len(sep)
            continue
        i += 1
    return parts + [text[start:]]


GENERIC = STOPWORDS | set("manual manuals guide guides guideline guidelines guidance article articles page pages "
                          "section chapter book document entry entries website site library offline pdf via id "
                          "information info recommendation recommendations".split())


def _content_words(text):
    return {w for w in re.findall(r"[a-z0-9]+", re.sub(r"\bid\s*\d+", " ", text.lower())) if w not in GENERIC}


TRAILING_PARENS = re.compile(r"^(.*?)\s*\(((?:[^()]|\([^()]*\))*)\)\s*$")


PUBLISHERS = re.compile(r"\b(mayo|webmd|healthline|cleveland clinic|johns hopkins|harvard|red cross|aap|fda|epa|osha|"
                        r"noaa|usda|nhs|cdc|nih|fema|ready\.?gov|medlineplus|wikem|wikimed|wikipedia|wikihow|ifixit|"
                        r"stack exchange|appropedia|energypedia|ifrc|your files)\b", re.IGNORECASE)


def _claims_source(paren, articles):
    """Whether words in parentheses name who published a source ("Mayo Clinic", "Ready.gov", a library collection)
    rather than describe it ("FEMA's advice on bleach" is caught too; "Emergency Visual Signals" isn't)."""
    words = _content_words(paren)
    return bool(words) and (bool(PUBLISHERS.search(paren) or re.search(r"\bWHO\b", paren))
                            or any(words <= _content_words(a["source"]) for a in articles))


def _names_article(text, article, articles, full=None):
    """Whether one named source is this article: (nearly) its whole title or a shortened form of it, or just its
    collection's name. A publisher in parentheses at the end of the full item must be the article's own."""
    title, source = _content_words(article["title"]), _content_words(article["source"])
    found = TRAILING_PARENS.match(full or text)
    if found and _claims_source(found.group(2), articles) and not _content_words(found.group(2)) <= title | source:
        return False  # "Fever (Mayo Clinic)" when it read MedlinePlus
    found = TRAILING_PARENS.match(text)
    words = _content_words(found.group(1) if found else text)
    if not words:
        return bool(found)
    allowed = 1 if len(title) > 2 else 0  # a short title fits inside many made-up ones ("Fever in Children")
    if title and len(title & words) >= max(1, 0.8 * len(title)) and len(words - title - source) <= allowed:
        return True
    if title and len(words - source) >= 2 and words - source <= title:  # a shortened title
        return True
    return words <= source  # just the collection: fine if it read something from it


def _opened(item, read, read_before=(), opened_ids=()):
    """Whether a source the model named is one it opened: by passage id, by title or by its collection's name.
    Models describe a source after a dash or colon; a list of several in one item must check out one by one."""
    if re.match(r"none\b", item.strip(" *_\"'“”‘’").lower()):  # saying it used none is never a made-up source
        return True
    ids = [int(n) for n in re.findall(r"\b\d{5,}\b", item)]
    if ids and all(i in opened_ids for i in ids):
        return True
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", item)  # a Markdown link: its text, not its address
    text = re.sub(r"https?://\S+", " ", text).strip(" *_.\"'“”‘’")
    articles = list(read) + list(read_before)
    collections = [_content_words(a["source"]) for a in articles]
    # "WikEM: ACE inhibitor dose table": before the colon or dash is just a collection's name, so what comes after
    # names the article, and has to be one it opened (a made-up title passed the check in the 0.3.0 Windows test).
    collection_only = lambda head: bool(_content_words(head)) and any(_content_words(head) <= c for c in collections)  # noqa: E731
    variants = [(text, text)]  # (what names the source, the text whose closing parentheses must fit)
    variants += [(text.split(sep, 1)[0],) * 2 for sep in (" – ", " — ", " - ")  # after a dash: a description
                 if sep in text and not collection_only(text.split(sep, 1)[0])]
    if ": " in text and not collection_only(text.split(": ", 1)[0]):  # a colon may be part of the title, so the
        variants.append((text.split(": ", 1)[0], text))                 # full item's parentheses still count
    if any(_names_article(v.strip(" \"'“”‘’"), a, articles, full) for v, full in variants for a in articles):
        return True
    parts = [p for p in _split_outside_brackets(text, (", ", " and ", " & ")) if p.strip()]
    return len(parts) > 1 and all(_opened(p, read, read_before, opened_ids) for p in parts)


def _read_earlier(messages):
    """Articles opened for earlier questions in this chat ({title, source}), from the tool results kept in it."""
    found = []
    for m in messages:
        if m.get("role") == "tool" and m.get("tool_name") == "read_article":
            first = (m.get("content") or "").split("\n", 1)[0]
            parsed = re.match(r"^(.*) \(((?:[^()]|\([^()]*\))*)\)$", first)
            if parsed:
                found.append({"title": parsed.group(1), "source": parsed.group(2)})
    return found


# A message that asks for information as well as "remember this", and a reply that only acknowledges a memory request.
INFO_ASK = re.compile(r"\?|\b(how (much|many|long|often|do|does|can|should)|what|which|tell me|explain|is it safe|safe "
                      r"to|can (i|he|she|we|they|you)|should (i|he|she|we|they)|doses?|dosage)\b|"
                      r"？|多少|多久|多远|怎么办|能不能|可不可以|要不要|是否", re.I)
# The Chinese half must cover what the prompt tells the model to answer (memory.prompt_section: "好的，我记住了。"),
# or an acknowledgment is taken for an answer and gets a "Sources: none" line of its own.
ACKNOWLEDGED = re.compile(r"\b(i'll remember|i will remember|i've noted|noted|got it|i'll keep|i've saved|saved|"
                          r"i've forgotten|forgotten|i'll forget|deleted|removed|no longer|won't remember)\b|"
                          r"好的，我记住了|我记住了|记住了|好的，我记下了|我记下了|好的，我忘掉了|我忘掉了|"
                          r"已经删除|已删除|已经移除|已移除|好的", re.I)


def _with_sources_line(answer, line):
    """The answer with its closing Sources block (the line and any list right under it) replaced by line, or with
    line added at the end when it has none."""
    block = _sources_block(answer)
    if not block:
        return f"{answer.rstrip()}\n\n{line}"
    after = answer[block[1]:].strip()
    return f"{answer[:block[0]].rstrip()}\n\n{line}" + (f"\n\n{after}" if after else "")


def _known_ids(text, known, every=False):
    """The passage ids text names that are in known (with every: [] unless all its numbers are)."""
    found = [int(n) for n in re.findall(r"\b\d{5,}\b", text) if len(n) < 19]
    hits = [n for n in found if n in known]
    return hits if hits and (not every or len(hits) == len(found)) else []


def _titled(item, by_id):
    """A Sources item that names passages by id, in words: the ids go, and if nothing else is left, the titles of those
    passages take their place ("1403312 (Ready.gov)" becomes "Generator Safety (Ready.gov)"). Numbers that aren't
    passage ids ("Champion 100891 Owner's Manual") stay."""
    passages = []

    def drop(m):
        hits = _known_ids(m.group(0), by_id, every=True)
        passages.extend(by_id[n] for n in hits)
        return " " if hits else m.group(0)

    rest = ID_REF.sub(drop, item)
    for _ in range(2):
        rest = re.sub(r"[(\[][\s,;:*_]*[)\]]", "", rest)  # brackets left empty
        rest = re.sub(r"[\s,;:]+(?=[)\]])|(?<=[(\[])[\s,;:]+", "", rest)  # "(Ready.gov, )"
    rest = re.sub(r"\s{2,}", " ", rest).strip(" ,;:–—-*_#")
    if re.sub(r"\([^)]*\)", "", rest).strip(" ,;:–—-\"'“”*_#"):  # it still names the article itself
        return rest
    named = _one_per_article([p for p in passages if p.get("title")])
    return "; ".join(f"{p['title']} ({p['source']})" for p in named) or rest


def _one_per_article(items):
    """Several passages of one article share its title; list each article once, at its first passage."""
    out, keys = [], set()
    for item in items:
        if (item["title"], item["source"]) not in keys:
            keys.add((item["title"], item["source"]))
            out.append(item)
    return out


def trim(messages, budget=60000):
    """Blank out old tool results so long chats stay inside the context window."""
    total = sum(len(m.get("content") or "") for m in messages)
    for m in messages[1:-6]:
        if total <= budget:
            break
        # A tool's error stays: it is short, and trimmed it would look like a result (_used_ids).
        if m["role"] == "tool" and m["content"] not in TOOL_ERRORS \
                and not m["content"].endswith("[old result removed]"):
            total -= len(m["content"])
            title = m["content"].split("\n", 1)[0] if m.get("tool_name") == "read_article" else ""
            m["content"] = f"{title}\n[old result removed]" if title else "[old result removed]"  # keeps what it read


def installed_models():
    try:
        with urllib.request.urlopen(HOST + "/api/tags", timeout=5) as resp:
            return [m["name"] for m in json.load(resp).get("models", [])]
    except OSError:
        return None  # Ollama is not running
