"""Terminal chat with a local model that can search the offline library.

Usage: chat.py [--model NAME] [question ...]   (default: the first chat model Ollama has)
With a question it answers once and exits; without one it opens a chat.
In a chat: /sources lists what the last answer used, /open N opens one, /reasoning shows its reasoning, /new,
/think off|short|medium|long|none sets how much it may reason before answering, /limit normal|long|none sets how long
an answer may run, /bye.
"""
import os
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from core import LENGTH_LIMITS, REASONING_LIMITS, capabilities, chat_events, installed_models, system_prompt, trim  # noqa: E402
from library.search import DB_PATH, Library  # noqa: E402

DIM, BOLD, RESET = "\033[2m", "\033[1m", "\033[0m"


def open_article(library, passage_id):
    """Write the article to a Markdown file, marking the cited passage, and open it."""
    doc = library.document(passage_id)
    if not doc:
        return
    lines = [f"# {doc['title']}", f"来源：{doc['source']}" + (f" | {doc['url']}" if doc["url"] else ""), ""]
    for part in doc["parts"]:
        if part["id"] == passage_id:
            lines += ["", ">>> 答案就来自这一段 <<<", ""]
        lines.append(part["text"])
        lines.append("")
    path = os.path.join(tempfile.gettempdir(), f"survival-llm-article-{doc['doc_id']}.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    if sys.platform == "darwin":
        subprocess.run(["open", "-t", path])
    elif os.name == "nt":
        os.startfile(path)
    else:
        subprocess.run(["xdg-open", path])
    print(f"{DIM}  · 已打开：{doc['title']}（{doc['source']}）{RESET}")


def run_turn(model, library, messages, level, caps, length="normal"):
    """Print one answer as it streams; returns the sources it used and its reasoning (for /reasoning)."""
    sources, reasoning = [], []  # reasoning: what it thought, with its lookups in between
    fresh = True  # nothing printed since the last lookup; skip the blank lines models emit before tool calls
    thinking, thoughts = False, 0  # in a stretch of reasoning; how many stretches
    for ev in chat_events(model, library, messages, reasoning=level, caps=caps, length=length):
        kind = ev["type"]
        if kind not in ("token", "tick"):
            fresh = True
        if kind != "tick":
            thinking = thinking and kind == "thinking"
        if kind == "thinking":
            if not thinking and ev["text"].strip():
                print(f"{DIM}  · 思考{'' if thoughts else '（用 /reasoning 查看）'}{RESET}", flush=True)
                reasoning.append("")
                thinking, thoughts = True, thoughts + 1
            if thinking:
                reasoning[-1] += ev["text"]
        elif kind == "search":
            topic = f" [{ev['topic']}]" if ev["topic"] != "any" else ""
            print(f"{DIM}  · 搜索：{ev['query']}{topic}{RESET}", flush=True)
            reasoning.append(f"· 搜索：{ev['query']}{topic}")
        elif kind == "read":
            print(f"{DIM}  · 阅读：{ev['title']}（{ev['source']}）{RESET}", flush=True)
            reasoning.append(f"· 阅读：{ev['title']}（{ev['source']}）")
        elif kind == "think_limit":
            print(f"{DIM}  · 思考达到上限，就用现有的内容回答{RESET}", flush=True)
            reasoning.append("· 思考达到上限")
        elif kind == "retry":
            print(f"{DIM}  · {'按你的要求先搜索' if ev.get('why') == 'search' else '用找到的文章回答'}"
                  f"{RESET}", flush=True)
        elif kind == "show":
            open_article(library, ev["id"])
            reasoning.append(f"· 已打开：{ev['title']}（{ev['source']}）")
        elif kind == "token":
            if fresh and not ev["text"].strip():
                continue
            fresh = False
            print(ev["text"], end="", flush=True)
        elif kind == "done":
            sources = ev["sources"]
            speed = f" · {ev['tokens'] / ev['seconds']:.0f} tok/s" if ev["seconds"] else ""
            note = " · 用 /sources 查看它读了什么" if sources else ""
            if ev.get("cut_off"):
                print(f"\n{DIM}[已停止：回答太长了，请再问一次]{RESET}")
            elif ev.get("unfinished"):
                print(f"\n{DIM}[它一直在查资料，没有作答，请再问一次]{RESET}")
            print(f"\n{DIM}[{ev['tokens']} token{speed}{note}]{RESET}")
    return sources, "\n\n".join(r.strip() for r in reasoning if r.strip()) if thoughts else ""


def main():
    args = sys.argv[1:]
    model = None
    if args[:1] == ["--model"]:
        model, args = args[1], args[2:]
    if not model:
        names = [m for m in installed_models() or [] if not any(x in m for x in ("embed", "bge-", "nomic", "minilm"))]
        if not names:
            sys.exit("没有找到 AI 模型。请启动 Ollama，下载一个模型（ollama pull granite4.2:8b），或者用 --model 指定。")
        model = names[0]
    library = None
    if os.path.exists(DB_PATH):
        try:
            library = Library()
            if library.stats()[0] == 0:
                library = None
        except Exception:
            library = None
    caps = capabilities(model)
    messages = [{"role": "system", "content": system_prompt(library, "tools" in caps)}]
    level, length = "off", "normal"  # the Reasoning setting, and the length limit

    if args:  # one question, one answer
        messages.append({"role": "user", "content": " ".join(args)})
        run_turn(model, library, messages, level, caps)
        return

    try:
        import readline  # noqa: F401  (arrow keys and history in input())
    except ImportError:
        pass
    docs, n_sources = library.stats() if library else (0, 0)
    lib_note = f"知识库：{docs:,} 篇文章，来自 {n_sources} 个来源" if library else "没有找到知识库"
    print(f"{BOLD}{model.removesuffix(':latest')}{RESET} {DIM}· 离线 · {lib_note}{RESET}")
    print(f"{DIM}问什么都行。/sources 列出上一个回答读了什么，/open N 打开其中一篇，/reasoning 显示它怎么推理的，"
          f"/new 重新开始，/think 设置它可以思考多少，/limit 设置回答的长度上限，/bye 退出。{RESET}")
    last_sources, last_reasoning = [], ""
    while True:
        try:
            question = input("\n> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return
        if not question:
            continue
        if question in ("/bye", "/quit", "/exit"):
            return
        if question == "/new":
            messages, last_sources = messages[:1], []
            print(f"{DIM}已重新开始。{RESET}")
            continue
        if question.startswith("/think"):
            pick = question[6:].strip()
            if pick in REASONING_LIMITS:
                level = pick
                budget = REASONING_LIMITS[pick]
                print(f"{DIM}推理：{pick}" + (f"（最多 {budget:,} token，之后就用现有的内容回答）" if budget > 0 else
                      "（不限制；模型卡在反复推理里时按 Ctrl+C 停下）" if budget < 0 else "") + f"。{RESET}")
            else:
                print(f"{DIM}用法：/think off、short、medium、long 或 none（现在是：{level}）。{RESET}")
            continue
        if question.startswith("/limit"):
            pick = question[6:].strip()
            if pick in LENGTH_LIMITS:
                length = pick
                print(f"{DIM}长度上限：{pick}{'（回答卡住时按 Ctrl+C 停下）' if pick == 'none' else ''}。{RESET}")
            else:
                print(f"{DIM}用法：/limit normal、/limit long 或 /limit none（现在是：{length}）。{RESET}")
            continue
        if question == "/reasoning":
            print(f"{DIM}{last_reasoning}{RESET}" if last_reasoning else
                  f"{DIM}上一个回答没有推理过程。/think 可以让模型先推理再回答。{RESET}")
            continue
        if question == "/sources":
            if not last_sources:
                print(f"{DIM}上一个回答没有从知识库里读任何东西。{RESET}")
            for n, s in enumerate(last_sources, 1):
                print(f"  {n}. {s['title']}（{s['source']}）")
            continue
        if question.startswith("/open"):
            pick = question[5:].strip() or "1"
            if pick.isdigit() and 1 <= int(pick) <= len(last_sources) and library:
                open_article(library, last_sources[int(pick) - 1]["id"])
            else:
                print(f"{DIM}用法：/open N，N 是 /sources 里的编号。{RESET}")
            continue
        messages.append({"role": "user", "content": question})
        trim(messages)
        print()
        last_reasoning = ""
        try:
            used, last_reasoning = run_turn(model, library, messages, level, caps, length)
            last_sources = used or last_sources
        except KeyboardInterrupt:
            print(f"\n{DIM}[已停止]{RESET}")
        except OSError as exc:
            print(f"\n{DIM}[连不上本地模型：{exc}。Ollama 在运行吗？试试 ollama serve]{RESET}")


if __name__ == "__main__":
    main()
