# Survival LLM 汉化术语表（唯一标准 · 工程师必读）

版本：v1（对应 Survival LLM 0.4.1）
适用：`app/static/*`（界面）、`app/server.py`、`core.py`、`memory.py`、`README.md`、`docs/index.html`
规则：**本表是唯一译法来源。表里没有的词，先按「§0 总则」推断，再在 PR 说明里记一笔，不要各自发明第二套译法。**

---

## §0 总则（比逐词更重要，务必先读）

| # | 规则 | 说明 |
|---|---|---|
| R1 | **人称统一用「你」，不用「您」** | 原文语气平实、直接、没有敬语（"Ask anything."），中文照此，不要加敬语、不要加「亲」。 |
| R2 | **不加感叹号** | 原文几乎不用 `!`。汉化时不要为了"亲切"加「！」。 |
| R3 | **短句、动词开头** | 原文是短句风格。宁可两句短句，不要一句长从句。 |
| R4 | **产品名不译** | `Survival LLM` 永远原样；不写成「生存大模型」「生存 LLM」。 |
| R5 | **`AI` 保留拉丁大写** | 不写「人工智能」（仅 README 首次出现可写「AI（人工智能）」）。 |
| R6 | **`token` 保留小写英文** | 不译「词元」。数量写法：`1,000 token`（数字与 token 之间一个空格）。 |
| R7 | **单位保留拉丁** | `GB` `MB` `GB/s`→不用；`Mb/s`、`RAM` 原样；数字与单位之间一个半角空格：`1.3 GB`、`18 GB`。数字与中文之间**不**加空格：`494,574 篇文章`。 |
| R8 | **标点用全角** | `，。：；？！（）`；引号用全角弯引号 `“…”`；强调/按钮内标签不加句号；完整提示句末加「。」。 |
| R9 | **省略号用 `…`（单字符）** | 原文 `…` 一律保持 `…`，不要 `...`。 |
| R10 | **中文后接英文/数字不空格，英文与英文之间保留原空格** | `Ollama 版本 0.12.3`。 |
| R11 | **复数不加「们」「些」** | 原文 `note${n===1?"":"s"}` 这类单复数分支**整段删除**，中文不区分单复数。 |
| R12 | **不加书名号给软件/功能名** | 写 `记忆`、`我的文件`，不写《记忆》。 |
| R13 | **来源专名原样** | `Ready.gov` `CDC` `MedlinePlus` `WikEM` `WikiMed` `wikiHow` `iFixit` `Appropedia` `Wikipedia` `NHS` `FEMA` `USDA` 全部保留英文，不译、不加引号。 |
| R14 | **模型名原样** | `Nemotron 3.5 Super` `Qwen3.8 27B` `Nemotron 3.5 Lightning` `Granite 4.2 8B` `Gemma 4 E4B`；Ollama 名（`qwen3.8:27b-mlx`、`granite4.2:8b` 等）永远不译、不改大小写、不加空格。 |
| R15 | **不译代码标识** | 函数名、变量名、CSS 类名、HTML id、JSON 键、URL、文件路径、`data-*` 值、`localStorage` 键、事件名一律不动。代码注释与 docstring **保持英文**（不是用户可见内容，改动它们只会增加回归风险）。 |
| R16 | **工具名保留** | `search_library`、`read_article`、`show_article` 在提示词、Instructions 文本、推理说明里**永远英文小写下划线**原样。 |
| R17 | **`Sources:` 保留英文** | 见 §4 专项。这是机器契约，不是界面文案。 |
| R18 | **术语一改到底** | 同一个概念全文只能有一个译法（例：library 只能叫「知识库」，不能一半「资料库」一半「图书馆」）。 |

---

## §1 产品与身份

| 英文 | 中文 | 使用场景 | 保留英文 |
|---|---|---|---|
| Survival LLM | **Survival LLM** | 标题、版本行、窗口标题、退出页、状态文案 | ✅ 全保留 |
| Survival LLM (dev: …) | Survival LLM（开发副本：…） | pywebview 窗口标题 | 产品名保留 |
| Dev（badge） | **Dev** | 顶栏徽标文字本体不改；`title` 译作「开发副本：…」 | ✅ 徽标保留 |
| dev copy | 开发副本 | tooltip、版本行 | — |
| the app | 本应用 / 应用 | 泛指时用；紧邻功能名时可省 | — |
| offline | 离线 | `离线知识库`、`离线运行` | — |
| no internet / without internet | 无需联网 / 断网也能用 | 状态行、欢迎语 | — |

## §2 知识库与检索

| 英文 | 中文 | 使用场景 | 保留英文 |
|---|---|---|---|
| library | **知识库** | 顶栏按钮、窗口标题、状态行、设置页 | ❌ 不保留 |
| a library | 知识库（不加量词「一个」除非必要） | — | — |
| library pack / pack | 知识库包 / 包 | 设置页、知识库窗口 | — |
| Essentials（pack id `lite`） | **必备包（Essentials）** 首次出现；之后只写「必备包」 | 设置页选项、知识库窗口、更新窗 | 首次括注 |
| Everything（pack id `full`） | **全量包（Everything）** 首次出现；之后只写「全量包」 | 同上 | 首次括注 |
| Search library（按钮） | 搜索知识库 | 顶栏 | — |
| Search the library yourself… | 自己搜索知识库… | 输入框 placeholder | — |
| source | **来源** | 来源标签、引用行 | — |
| article | **文章** | 「494,574 篇文章」 | — |
| passage | **段落** | 高亮片段、「这一段」 | — |
| excerpt | 摘录 | 提示词内部、`Library excerpts`（见 §4） | — |
| search（动作） | 搜索 | — | — |
| results | 结果 / N 条结果 | 「“X”的 3 条结果」 | — |
| snippet | 摘要 | 搜索结果摘要（一般不出现在界面） | — |
| topic | 主题 | `topic` 枚举值不动（见 §4） | — |
| Official（badge） | **官方** | 来源徽标 | ❌ 不保留 |
| License: | 许可协议： | 文章头部 | 协议名保留 |
| micromort / micromorts | **微死亡（micromort）** | 提示词、README、docs | 括注保留 |
| citation | 引用 | README、提示词说明 | — |
| Sources: | **Sources:** | 见 §4，硬性英文 | ✅ 全保留 |

## §3 顶部按钮与窗口（含动作译法）

| 英文 | 中文 | 备注 |
|---|---|---|
| Model: | 模型： | 顶栏按钮前缀 |
| none yet | 尚未选择 | 无模型时 |
| Your files | **我的文件** | 顶栏按钮 + 窗口标题 |
| Memory | **记忆** | 顶栏按钮 + 窗口标题 |
| Instructions / AI instructions | **指令 / AI 指令** | 顶栏按钮、窗口标题 |
| New chat | 新对话 | — |
| Quit | 退出 | — |
| Close | 关闭 | aria-label |
| Not now | 稍后 | 更新横幅 |
| See what's new | 看看更新了什么 | 更新横幅主按钮 |
| Check for updates | 检查更新 | 页脚 |
| Update available | 有可用更新 | 页脚按钮态 |
| Updates | 更新 | 窗口标题 |
| AI models | AI 模型 | 窗口标题 |
| Chat | 对话 | `aria-label` |
| Library and sources | 知识库与来源 | `aria-label` |
| Send / Stop | 发送 / 停止 | 按钮 + aria-label「发送问题」/「停止回答」 |
| Change model | 更换模型 | — |
| Use this / In use | 使用此模型 / 使用中 | 模型行 |
| Downloaded | 已下载 | — |
| Download N GB | 下载 18 GB | — |
| Try again | 重试 | — |
| Keep going | 继续 | 达到长度上限后 |
| Recommended for this computer / Best for this computer | 适合本机 / 本机最佳 | 徽标 |
| Other models on this computer | 本机上的其他模型 | 分组标题 |
| Open the folder | 打开文件夹 | — |
| Use another folder… | 使用其他文件夹… | — |
| Show the folder | 显示文件夹 | — |
| Move it… / Switch to… | 移动… / 切换到… | 知识库窗口 |
| Choose files | 选择文件 | — |
| Drop files here, or | 把文件拖到这里，或者 | 拖放区 |
| Drop to add to Your files | 松开即可加入我的文件 | 全屏拖放提示 |
| Replace it / Keep both / Don't add it | 替换 / 两者都保留 / 不添加 | 重名询问 |
| Remove | 移除 | 文件列表 |
| Save / Delete all / Reset to default | 保存 / 全部删除 / 恢复默认 | — |
| Undo | 撤销 | 记忆条目 |
| See memory | 查看记忆 | — |
| Recycle Bin（Windows）/ Trash（macOS） | 回收站 / 废纸篓 | 见 §4 的字符串比较 |
| Open Anyway / More info / Run anyway | 保留原文（系统按钮名） | README 里指 macOS/Windows 系统对话框按钮，译成「仍要打开」会指错按钮 → **保留英文原文并括注中文** |

## §4 对话、推理与用量

| 英文 | 中文 | 备注 |
|---|---|---|
| Reasoning（设置项） | **推理** | 下拉框标签 |
| Off / Short / Medium / Long / No limit | 关 / 短 / 中 / 长 / 不限制 | 选项值 `off/short/…` 不动 |
| Short (1,000 tokens) | 短（1,000 token） | — |
| Length limit | **长度上限** | 下拉框标签 |
| Normal / Long / None | 正常 / 长 / 不限制 | — |
| Show reasoning / Hide reasoning | 显示推理过程 / 隐藏推理过程 | — |
| reasoning (模型行为) | 推理过程 | 「它的推理过程」 |
| thinking / thought | 思考 | 时间线行标签「思考」 |
| Working on it… | 正在处理… | — |
| X is working on it… N s | X 正在处理… 12 秒 | 计时行 |
| How it found this (N steps) | 查询过程（N 步） | `<details>` 摘要；**N 的单复数分支删除** |
| Details | 详情 | 无步骤时 |
| Searched | 搜索 | 时间线 `r-kind` |
| Read | 阅读 | 同上 |
| Opened | 打开 | 同上 |
| Limit | 上限 | 思考被截断的那一行 |
| Searched the library: “q” | 在知识库中搜索了“q” | 引号用全角弯引号 |
| Read: title · source | 阅读：标题 · 来源 | — |
| Opened for you: title | 为你打开：标题 | — |
| Sources it read · click to open | 阅读过的来源 · 点击打开 | 来源区标签 |
| It searched, but didn't open any of these · click to read them | 它搜索了，但没有打开其中任何一篇 · 点击阅读 | — |
| Other search results (N) | 其他搜索结果（N） | — |
| Answering with X | 正在由 **X** 回答 | 欢迎区 |
| Answered by X in N s | 由 X 回答，用时 N 秒 | — |
| This answer came from what the AI already knows, not the library | 这个回答来自 AI 已知的内容，不是知识库，所以没有可核对的来源 | — |
| Ask “look that up” to get one. | 想让它查来源，可以问“帮我查一下”。 | 注意：这句要同时触发 `ASKED_SEARCH` 的中文词（见方案 §6.4） |
| Updating memory… | 正在更新记忆… | — |
| Remembered: “…” / Updated a memory: “…” / Forgot: “…” | 已记住：“…” / 已更新记忆：“…” / 已忘记：“…” | — |
| Memory is full, so it didn't save “…” | 记忆已满，没有保存“…” | — |
| Couldn't update memory this time. | 这次没能更新记忆。 | — |
| Answer ready from X. | X 的回答已完成。（aria 播报） | — |

## §5 记忆与我的文件

| 英文 | 中文 | 备注 |
|---|---|---|
| Memory | **记忆** | — |
| note（记忆条目） | **条目** | 计数写「3 条」，不写「3 条笔记」 |
| notes（复数） | 条目 | 单复数分支删除：`${n} 条` |
| one note per line | 一行一条 | — |
| Let the AI add and change notes | 允许 AI 添加和修改条目 | 开关 |
| Nothing yet. Notes appear here… | 还没有内容。AI 了解到你的情况后会写在这里；你也可以自己写，一行一条。例如：我儿子 Leo（9 岁）有 1 型糖尿病。 | placeholder |
| characters（记忆计数） | 字符 | 「1,234 / 6,000 字符」 |
| Your files | **我的文件** | — |
| a file / files | 文件 | — |
| Ready: the AI searches it | 就绪：AI 会搜索它 | — |
| The AI can't search this one | AI 无法搜索这个文件 | — |
| No files yet. | 还没有文件。 | — |
| Adding a file… / Adding 3 files… | 正在添加文件… / 正在添加 3 个文件… | 单复数分支删除 |
| Reading X (2 of 5)… | 正在读取 X（第 2/5 个）… | — |
| Added X. | 已添加 X。 | — |
| Replaced X with the new version. The old one is in the Trash. | 已用新版本替换 X。旧文件在废纸篓里。 | 见 §4 平台分支 |
| Removed X. It's in the Trash… | 已移除 X。它现在在废纸篓里，需要的话可以取回。 | — |
| Survival LLM can't read this kind of file. | Survival LLM 读不了这种文件。它能读 PDF、Word、EPUB、网页和纯文本文件。 | `CANT_READ` |
| X is a folder. To add a whole folder… | X 是个文件夹。要添加整个文件夹，请点“打开文件夹”并把文件放进去。 | — |
| They're kept in <path>. | 它们保存在 <path> 里。放进或改动那个文件夹的文件会被自动识别。 | 路径原样 |

## §6 设置（首次运行）、下载、更新

| 英文 | 中文 | 备注 |
|---|---|---|
| Set up Survival LLM | 设置 Survival LLM | 首次运行标题 |
| Setting up Survival LLM | 正在设置 Survival LLM | 进度页标题 |
| Setup is done. Survival LLM now works without internet. | 设置完成。Survival LLM 现在不需要联网也能用了。 | 欢迎区 |
| Setup not finished: needs an AI model and the library | 设置未完成：还需要 AI 模型和知识库 | — |
| Not set up yet | 尚未完成设置 | — |
| The library | 知识库 | 步骤 1 标题 |
| The AI | AI | 步骤 2 标题（不写「AI 模型」，因为步骤内已说明） |
| AI engine | **AI 引擎** | 步骤名 |
| Install the free Ollama app to run it | 用它要先安装免费的 Ollama 应用 | — |
| Downloading / Starting… / Unpacking… (a few minutes) | 正在下载 / 正在启动… / 正在解包…（需要几分钟） | — |
| Leave Survival LLM open until it finishes. | 下载完成前请保持 Survival LLM 打开。如果中断了，重新打开会接着下载。 | — |
| about a minute / about 5 minutes / about 1 hour 20 minutes | 约 1 分钟 / 约 5 分钟 / 约 1 小时 20 分钟 | `timeText()` 重写：删除 hour/hours 单复数分支 |
| on typical home internet (50 Mb/s) | 按一般家庭宽带（50 Mb/s）估算 | — |
| Keep it somewhere else | 换个位置保存 | — |
| A newer library is available. | 有更新版本的知识库。 | 更新横幅 |
| Survival LLM X is available. | Survival LLM X 已发布。 | — |
| Update now | 立即更新 | — |
| Installed. Survival LLM is restarting into the new version… | 已安装。Survival LLM 正在重启到新版本… | — |
| You have the latest version of Survival LLM (X). | 你用的是最新版本（X）。 | — |
| Couldn't check for updates (no internet?). | 无法检查更新（可能是没有联网）。 | — |
| Survival LLM was restarted. / Reload this page | Survival LLM 已重启。 / 重新加载此页面 | 过期页面横幅 |
| Survival LLM has stopped. Open the app again. | Survival LLM 已停止。请重新打开应用。 | 状态行 |
| Survival LLM has stopped. You can close this window… | Survival LLM 已停止。 / 可以关闭这个窗口了；要再次使用，请重新打开 Survival LLM。 | 退出页 |
| Restarting into the new version… | 正在重启到新版本… | — |

## §7 硬件与模型描述（`app/server.py` CATALOG）

| 英文 | 中文 | 备注 |
|---|---|---|
| memory (RAM) | 内存（RAM） | 「需要 32 GB 内存（RAM）」 |
| disk space / free disk | 磁盘空间 / 可用磁盘空间 | — |
| fits / doesn't fit | 适配 / 不适配 | `unfit` 类不动 |
| Too big for this computer | 本机带不动这个模型 | — |
| Needs 32 GB of free disk; 40 GB free | 需要 32 GB 可用磁盘空间；本机可用 40 GB | — |
| The smartest option: knows the most and is the least likely to make things up. | 最聪明的选择：知道得最多，也最不容易编造。 | blurb（mac） |
| Careful and thorough: looks things up for every question. | 细致、可靠：每个问题都会去查资料。 | blurb |
| The fastest: answers in a few seconds and saves battery. | 最快：几秒就给出回答，也省电。 | blurb |
| Another copy of a model listed above. | 上面列出的某个模型的另一份拷贝。 | — |
| Not tested with Survival LLM; answers may be worse. | 没有在 Survival LLM 上测试过，回答可能更差。 | — |
| This model needs a newer AI engine… | 这个模型需要比当前更新的 AI 引擎… | 见 `model_blocker()` |

> **注意**：`CATALOG` 里 `key` / `name` / `maker` / `mac` / `win` 不动；只译 `blurb` 与界面拼接文案（`needs … RAM`、`Downloaded`、`GB download` 等）。

## §8 错误与故障（`app/server.py` 面向用户的 `error` 字段）

统一句式：**说明发生了什么 + 怎么办**，两句以内。

| 英文 | 中文 |
|---|---|
| Couldn't save: the disk is full. Free some space and try again. | 保存失败：磁盘已满。清理一些空间后再试。 |
| Couldn't save: another program is using <path>. Close it and try again. | 保存失败：另一个程序正在使用 <path>。关闭它后再试。 |
| Couldn't save <path>: … | 保存失败（<path>）：… |
| The disk is full. Free up some space, then try again. | 磁盘已满。清理一些空间后再试。 |
| The AI engine took too long to answer. Try again, or pick a faster model under Model. | AI 引擎响应超时。请重试，或在“模型”里换一个更快的模型。 |
| The AI engine reported a problem: … | AI 引擎报错：… |
| Something went wrong: … | 出错了：… |
| The AI engine stopped. Starting it again. | AI 引擎已停止，正在重新启动。 |
| The internet connection dropped. | 网络连接中断了。 |
| The download site answered with an error (HTTP 404). | 下载站点返回了错误（HTTP 404）。 |
| That drive is read-only. Pick another place for the library. | 那个磁盘是只读的。请给知识库换一个位置。 |
| Not enough free disk space: … needs about 27 GB free, and this computer has 9 GB. | 可用磁盘空间不足：…需要约 27 GB 可用空间，本机只有 9 GB。 |
| The AI engine download was damaged in transit. Try again. | AI 引擎下载过程中损坏了，请重试。 |
| That folder is inside the library itself. Pick a folder outside it. | 那个文件夹在知识库内部。请选知识库之外的文件夹。 |
| That folder holds the library, so its articles would count as your files. | 那个文件夹就是知识库所在，里面的文章会被当成你的文件。 |
| Your files are still being read. Try again in a moment. | 还在读取你的文件，请稍后再试。 |
| Another library download or move is running. Wait for it to finish. | 另一个知识库下载或移动正在进行，请等它结束。 |
| You already have a file called X. | 你已经有一个叫 X 的文件了。 |
| This file is too big (over 4 GB). | 这个文件太大（超过 4 GB）。 |
| That file isn't in the folder any more. | 那个文件已经不在文件夹里了。 |
| Couldn't move it to the Recycle Bin. | 无法把它移到回收站。 |
| Moving the library | 正在移动知识库 |
| That's more than memory holds (6,000 characters). Shorten some notes, or put longer things in Your files. | 这超过了记忆的容量（6,000 字符）。请精简一些条目，或把较长的内容放进“我的文件”。 |
| Survival LLM is already running at <url> | Survival LLM 已经在 <url> 运行 |
| Installing Microsoft WebView2, which the app window needs. | 正在安装应用窗口需要的 Microsoft WebView2。 |

## §9 绝对不译（机器可读 / 专有）—— 碰到就打住

| 类别 | 具体内容 | 原因 |
|---|---|---|
| 引用行标签 | `Sources:`（含 `Source:`）、核心正则 `SOURCES_LINE` / `INLINE_SOURCES` / `TOOL_SOURCES`、`_with_sources_line()` 生成的整行 | 后端校验 + 6 个测试文件 + evals 都按英文字面匹配（详见方案 §6.1） |
| 提示词分段标记 | `"Library excerpts:"`（`core.py:240` 写入、`core.py:562` 切分） | 同一字符串两侧耦合 |
| 工具与参数 | `search_library` `read_article` `show_article`；`query` `topic` `id`；主题枚举 `medical/emergency/howto/repair/encyclopedia` | 工具 schema 与 `run_tool()` 按名分发 |
| 结果格式 | `[id 123]`、`read_article(id=…)`、`[More of this article: …]` | `KNOWN_ID` / `ID_REF` / `ID_REMARK` 正则 |
| 工具标记 | `"<tool_call"`、`"<function"` | `TOOL_MARKUP` 防模型把工具当文本输出 |
| 记忆 JSON | `{"forget": …}` `{"change": …}` `{"remember": …}` 及键 `old` / `new`；`(none yet)`（`prompt_section` 内 `listing` 占位） | `memory_plan()` 解析；`EXAMPLE_NOTES` 用正则从提示词反推 |
| 记忆文件头 | `memory.py` 的 `HEADER` / `HEADER_STARTS` | 旧版本已写入用户磁盘的文件头必须仍能被剥离（见方案 §8 风险 R6） |
| 文件系统名 | `Survival LLM`、`Application Support`、`Survival LLM Files`、`Survival LLM Library`、`.survival-llm`、`ollama`、`ollama.exe`、`server.json`、`instructions.txt`、`survival-llm-memory.txt`、`settings.json`、`my-files.sqlite`、`window`、`version.txt`、`engine.json`、`update-failed.txt` | 磁盘路径，改了等于换目录 |
| HTTP / JSON | 所有 `/api/…` 路径；请求/响应字段名（`error` `ok` `articles` `gb` `about` `name` `packs_error` `dev` `blocker` …） | 前后端契约 |
| 状态枚举 | `starting` `downloading` `unpacking` `done` `error`；`offline` `unavailable`；`retry` `stuck` `engine-starting` `install-engine`；事件名 `search` `read` `show` `retry` `token` `thinking` `think_limit` `memory` `memory_check` `memory_failed` `memory_unchanged` `done` `error`；`action` 值 `add` `change` `delete` `full`；job key 前缀 `model:` `library:` `library-move` `engine` `app-update` | 前后端逻辑分支 |
| 前端存储 | `localStorage` 键 `model` `length` `reasoning` `update-dismissed` `library-dismissed`；`${profile}:${key}` 前缀 | 旧设置要能继续读到 |
| 模板占位符 | `{{TOKEN}}`、`{{PROFILE}}`，以及 `app.js` 的 `profile.startsWith("{{")` 判断 | 服务端字符串替换 |
| 平台串 | `state.machine.os === "Windows"`、`os: "Windows"/"macOS"` | `trashName()` 与提示文案分支按此判断 |
| 已发布清单 | `docs/update.json`、`docs/library-packs.json` 的**字段与值**（`label` `notes` `sha256` `bytes` `url` `parts`） | 远端发布产物 + `valid_update()` 校验 + `pack_summary()` 解析 |
| 其它 | `LICENSE`、`SOURCES.md` 正文、`evals/**`、`packaging/**`、`bin/dev`、`library/**`（除 `myfiles.py` 的 3 条用户可见错误） | 法律文本 / 上游评测 / 构建工具 / 内部抓取 |

## §10 界面里必须一起改的非文案属性

| 位置 | 现状 | 改成 |
|---|---|---|
| `app/static/index.html` `<html>` | `lang="en"` | `lang="zh-CN"` |
| `app/static/index.html` `<title>` | `Survival LLM` | `Survival LLM 离线生存助手`（产品名在前，便于窗口列表识别） |
| `docs/index.html` `<html>` | `lang="en"` | `lang="zh-CN"` |
| `docs/index.html` `<title>` / `og:title` / `og:description` / `twitter:*` / `<meta name="description">` | 英文 | 译成中文；**URL、图片路径、`og:image:width/height` 不动** |
| 所有 `aria-label` / `title` / `placeholder` | 英文 | 一并译（§3/§4 已给译法） |
| JS 日期格式 | `toLocaleDateString(undefined, …)` | 改为 `"zh-CN"`，避免跟随系统语言出现英文月份 |
| JS 数字格式 | `toLocaleString()` | 改为 `toLocaleString("zh-CN")` |
