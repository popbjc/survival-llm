# Survival LLM 离线生存助手

一个免费的 AI 助手加生存知识库，完全跑在你自己的电脑上，不需要联网。问它停电时怎么让食物不变质、烧伤怎么处理、水怎么净化：它会搜索一个离线的医学、急救、操作与百科知识库，用它查到的内容作答，并给你看每个答案出自哪一段原文。

> **本版本为简体中文版**（由社区汉化）。`Sources:` 等机器标签、工具名，以及 `SOURCES.md`（各来源的许可原文）保留英文。

- **离线、私密。** AI 模型和知识库都在你的电脑上。你的问题不会离开这台电脑；设置好之后，断网也能用。
- **给出来源。** 每个答案都会列出它读过的文章；点一篇就能自己读，被引用的那一段会高亮，还附有许可协议。问它“你从哪知道的”，它会把来源打开给你。
- **显示推理过程。** 显示推理过程在每个答案下面，点开会看到 AI 在回答前想了什么，一步一步，中间还有它做过的搜索和读过的文章。不点开就一直藏着。它想多久由你决定：发送旁边的“推理”是一个预算（关、1,000、4,000 或 16,000 token，或者不限制），到了上限它就停止思考，用现有的内容回答。
- **随你调整。** “指令”按钮显示 AI 在你提问前收到的指令（应用会在后面加上今天的日期、你的文件清单和你的记忆条目）；改完点保存就能改变它的回答方式（恢复默认可以拿回原始版本）。发送旁边的“长度上限”决定一个回答最多能写多长，也可以关掉上限。
- **加上你自己的文件。** 顶部的“我的文件”接受 PDF、Word 文档、EPUB 电子书、网页和纯文本文件（把它们拖到窗口上，或者选择文件），这样 AI 可以一边搜知识库，一边搜你发电机的说明书、你的用药清单或你家的应急预案。它们只留在你的电脑上，放在主文件夹里的 `Survival LLM Files` 文件夹中；你放进那个文件夹或在那里改动的文件会被自动识别。它现在还读不了扫描件和照片。
- **记得住你。** 告诉它你女儿对青霉素过敏，或者你有一台本田发电机，它会存一条简短条目，之后的对话里也知道；每个答案都会显示它存了什么，可以撤销。顶部的“记忆”把每条条目列在一起，你可以编辑；还有一个开关可以关掉 AI 自己写入（你写的条目它照样会读）。这些条目留在你的电脑上，一个纯文本文件，和应用设置放在一起。
- **自己更新。** 窗口底部的“检查更新”会找新版本（运行期间每天也会查一次，只从项目网页取一个小文件，不会发送任何关于你的信息）。“立即更新”会下载、校验并重启到新版本，保留你的模型、知识库、文件和设置。有新知识库时也会在那里提示。
- **为紧急情况而做。** 约 150 万篇文章（较小那个下载里是 50 万篇）：约 93 万篇维基百科上最常读的条目、WikiMed、MedlinePlus、英国用药指南、WikEM、Ready.gov、CDC、美军与 FEMA 的生存和急救手册、USDA 的罐藏指南、用来估算微死亡（micromort）的风险参考资料（寿命表、美国死亡率）、wikiHow、iFixit、Appropedia、Energypedia，以及实用问答。见 [SOURCES.md](SOURCES.md)。

## 安装

请在能联网的时候做这一步。之后就完全不需要网络了。设置要 20 分钟到约 2 个半小时，取决于你的电脑和网速（最大的 AI 模型是 80 GB）；需要你动手点的部分大约 5 分钟。

**Mac**（Apple Silicon，macOS 14 Sonoma 或更新）
1. 下载 `Survival-LLM-mac.zip`，双击解压。想的话可以把 **Survival LLM** 移到“应用程序”里。
2. 双击 **Survival LLM**。第一次打开时 macOS 会说无法验证这个应用，因为它没有通过 Apple 销售。点 **Done**，打开**系统设置 > 隐私与安全性**，往下找到“Survival LLM was blocked”，点 **Open Anyway**（仍要打开），然后输入密码确认。这一步只做一次。

**Windows**（10 或 11，64 位）
1. 下载 `Survival-LLM-windows.zip`，右键选**全部解压缩**。（直接在压缩包里运行是不行的。）
2. 打开解压出来的 **Survival LLM** 文件夹，双击 **Survival LLM.bat**。如果 Windows 说它保护了你的电脑，点 **More info**（更多信息），再点 **Run anyway**（仍要运行）。

**然后**应用会在自己的窗口里打开，带你走一遍设置：
1. **AI 引擎：** Mac 应用里自带。在 Windows 上点一下就会下载（Ollama，1.6 GB）。
2. **AI 模型：** 它会推荐最适合你这台电脑内存的模型（见下），然后下载。
3. **知识库：**“全量包”（下载 8.8 GB）或“必备包”（1.3 GB，不含维基百科和 iFixit）。

**需要的可用磁盘空间：** 模型大小加 5 GB，装全量知识库时另外还要约 27 GB（装好之后占 21 GB），必备包约 10 GB（装好之后占 3 GB）。

## 卸载

删掉应用，再删这几个文件夹：AI 模型在 `~/.ollama/models`（这台电脑上其他 Ollama 也共用，如果你在别处用 Ollama 就留着），还有知识库。应用的知识库窗口（搜索知识库，然后切换或移动知识库）会显示知识库在哪：如果你是在 0.4 之前装的，就在 `~/Survival LLM Library`；否则在应用的设置文件夹里，除非你移动过。你自己的文件在 `~/Survival LLM Files` 里，除非你选了别的文件夹；想留着就留着。应用自己的设置在 Mac 上位于 `~/Library/Application Support/Survival LLM`；在 Windows 上位于 `%APPDATA%\Survival LLM`，AI 引擎和知识库位于 `%LOCALAPPDATA%\Survival LLM`。

## 你的电脑会用哪个模型

应用会检查你的内存，然后推荐一个模型。内存越大，模型越聪明。

| 你的电脑 | 模型 | 下载大小 |
|---|---|---|
| 128 GB 或更多的 Mac | NVIDIA Nemotron 3.5 Super（`nemotron-3.5-super:120b-a12b-nvfp4`） | 80 GB |
| 32-96 GB 的 Mac | Qwen3.8 27B（`qwen3.8:27b-mlx`） | 18 GB |
| 32 GB 或更多的 Windows 电脑 | NVIDIA Nemotron 3.5 Lightning（`nemotron-3.5-lightning:30b-a3b`） | 25 GB |
| 16-31 GB 的 Mac 或 PC | IBM Granite 4.2 8B（`granite4.2:8b`） | 6 GB |

Nemotron Super 需要 128 GB，因为 macOS 只让图形部分使用大约四分之三的内存。

Gemma 4 E4B（`gemma4`，10 GB）作为 16 GB 电脑上更快的选项提供。8 GB 的电脑仍然可以搜索知识库；我们测试过的模型里，没有一个同时做到足够小又足够安全，可以推荐给它们。

## 各个模型的表现

每个模型用完整的应用（它的提示词、工具和知识库检索）回答了 22 个停电与急救问题（食物、发电机、水、一氧化碳、失温、出血、烧伤、胰岛素、倒下的电线、放射性沉降、肉毒中毒等）。然后由独立的 AI 评审盲评每一个答案（模型名隐藏、顺序打乱），对照 USDA、CDC、FEMA、EPA、NHS、WHO 和红十字会的官方指引：一位评审看准确性，一位看安全性，还有一位怀疑者复核每一个被标记为有害的答案。

这些数字是怎么测出来的，说清楚一点：测试跑在知识库的一个较早版本上，那时还没有加入维基百科，而且里面还包含一些不在公开下载里的材料（Kiwix 的 “zimgit” 合集，以及 MedlinePlus 有授权的百科与药物页面；每个模型有 1 到 10 个答案读到了其中之一）。应用的指令后来也加过规则：一氧化碳规则和“一定要给出你最好的估计”。请把这张表当作模型之间的比较，而不是对你下载的那个版本的保证。

| 模型 | 准确性 | 要点答对 | 有害答案 | 每个答案的秒数* |
|---|---|---|---|---|
| Nemotron 3.5 Super | 86% | 22 个里 21 个 | 0 | 12 |
| Qwen3.8 27B | 80% | 22 个里 21 个 | 0 | 40 |
| Nemotron 3.5 Lightning | 77% | 22 个里 19 个 | 1 | 8 |
| Qwen 3.6（36B MoE） | 59% | 22 个里 15 个 | 1 | 24 |
| Granite 4.2 8B | 55% | 22 个里 14 个 | 0 | 29 |
| Granite 4.2 30B | 55% | 22 个里 11 个 | 2 | 55 |
| Gemma 4 E4B | 48% | 22 个里 11 个 | 0 | 3 |
| Granite 4.2 3B | 44% | 22 个里 8 个 | 5（2 个可能致命） | 12 |

\* 在一台 M4 Max MacBook Pro（128 GB）上，Ollama 0.40.9。Qwen3.8 27B 测的是 mlx-community 的 4 位量化版（`evals/results` 里的 `local-ai2`）；应用下载的是同一个模型的 Ollama NVFP4 版本。Nemotron Super 在那里叫 `local-ai1`（同一个模型，用应用的设置）。Windows 下载的 Nemotron Lightning 文件和这里测的 Mac 版本不同（Q4_K_M）。准确性是每个答案在 0-3 分制上的得分占比；“有害”指照着做可能会伤到人。Granite 4.2 3B 原本计划给 8 GB 电脑用，现在不提供：它让人不要在上臂用止血带，还让人离倒下的电线保持 3 英尺（指引是 35 英尺）。Qwen 3.6 也不提供：它在两个问题上卡在自我重复里（有一次重复了 94 分钟），这也是回答有长度上限的原因（你可以在发送旁边改，或者关掉）。

测试为每个模型发现并修好了两个问题：有的模型会一直查下去，把查询次数用完却始终不回答（现在会告诉它用读到的内容作答）；还有几个模型对在房子附近开汽车和发电机给出了“如果实在没办法”的例外（提示词现在明确禁止了）。

重现方式见 `evals/retrieval_eval.py`、`evals/make_judging_batches.py` 和 `evals/score_judging.py`；答案在 `evals/results/`，评分在 `evals/judging/`。注意：`evals/` 里的评测脚本是按英文版写的，中文版不适用。

**编造来源。** 每个答案结尾都有一行模型自己写的 “Sources:”，它的指令里也说明了应用会显示它打开过的每一篇文章。模型仍然会写它根本没见过的来源。在另一个 14 个问题的测试里（`evals/citation_check.py`，2026 年 10 月 24 日），这些答案写了一个模型既没打开、也没在搜索结果里见过的来源：Nemotron Super 6 次（多数是凭记忆回答，然后写 Ready.gov 或 CDC），Lightning 3 次，Gemma 3 次，Granite 2 次，Qwen3.8 27B 1 次。所以应用会拿这一行和模型实际打开或看到的内容对照，只要写了别的东西，就把它替换成它真正读过的文章清单。

## 工作原理

```
你的问题 ─► 本地模型（Ollama）─► search_library ─► SQLite 全文索引 ─► 段落
                    ▲            read_article  ─► 纯文本知识库文件
                    └──── 带 "Sources:" 的回答 ◄──┘   show_article ─► 在屏幕上打开它
```

- `app/server.py` 只在 `127.0.0.1` 上提供聊天页面，并把每一轮交给 `core.py` 处理。
- `core.py` 流式转发模型的回答，并执行它的知识库工具：`search_library`、`read_article`、`show_article`。
- `library/search.py` 搜索 `index.sqlite`（FTS5，对约 1,500 字符的段落做 BM25 排序，官方来源排在前面），并读取纯文本的 Markdown 分片。
- `memory.py` 保存 AI 关于这个人的条目（`survival-llm-memory.txt`，和应用设置放在一起）；在对方允许的情况下，`core.py` 会在回答之后，针对提到本人或家人的消息，给模型一次简短的额外回合，让它说出要记住、修改或忘记什么（一个 JSON 回复，应用会校验并执行）。对话开始时，条目、今天的日期和对方文件的名字会加在指令之后。
- `library/myfiles.py` 把对方自己的文件读进一个独立的小索引（和应用设置放在一起），并和知识库一起搜索。
- 除了 Ollama、应用窗口（pywebview）、PDF 读取（pypdf）和用系统自己的证书库校验网站证书（truststore），其余都用 Python 标准库。

## 从源码运行

```bash
python3 app/server.py          # 在自己的窗口里跑应用（需要 pip install pywebview pypdf truststore，否则用浏览器）
python3 app/server.py --browser                     # 改用浏览器
python3 chat.py "停电时冰箱里的食物能放多久？"   # 终端；--model NAME 指定模型
```

知识库的查找顺序是 `$SURVIVAL_LLM_LIBRARY`、应用里选的文件夹（它 `settings.json` 里的 `library_dir`）、`~/Survival LLM Library`，最后是代码旁边的 `library.noindex/`；新建的知识库放在应用的设置文件夹里（Mac 上是 `Library.noindex`，Windows 上是 `%LOCALAPPDATA%\Survival LLM\Library`）。
没有自带引擎时，应用会用你已安装的 Ollama（`ollama serve`）。

`python3 tests/run_all.py` 用替身代替模型，检查记忆以及对模型输出的处理（忘记请求、关于不同人的条目、Sources 行）：不需要 Ollama，也不需要知识库。改动 `memory.py` 或 `core.py` 之后跑一遍；想看真实模型的表现，用 `evals/memory_eval.py --step MODEL ...`。

## 以 Mac 应用的方式试用改动

```bash
bin/dev              # “Survival LLM Dev”：用这个文件夹里的代码跑 Mac 应用（已打开的话会重启它）
bin/dev --fresh      # 同上，但像一个全新用户看到的样子：没有知识库、记忆、文件和设置
bin/dev --release    # 完全按发布的样子构建 Mac 应用（packaging/build.sh mac）并运行那个构建
bin/dev stop         # 退出；bin/dev reset 删掉它的设置、记忆和文件；bin/dev log 跟随它的日志
```

Survival LLM Dev 会一次性构建到 `~/Applications`（`--rebuild` 会重新构建），用的 Python、pywebview 和 Ollama 与正式应用相同，但它的代码是指向这个文件夹的链接，所以每次启动跑的都是当时最新的代码；Spotlight 也能打开它。它把自己的设置、记忆和文件留在 `~/Library/Application Support/Survival LLM Dev`，不会影响已安装的 Survival LLM，并且共用知识库和 AI 模型。窗口顶部的 Dev 徽标和底部那行会写明它跑的分支和提交，而且它从不自动更新。它的日志在 `~/Library/Logs/Survival LLM Dev.log`。

## 构建知识库

```bash
python3 -m venv .venv && .venv/bin/pip install libzim lxml trafilatura
python3 library/fetch_zims.py        # Kiwix ZIM 来源（约 50 GB，临时）
python3 library/fetch_manuals.py     # 美国政府、IFRC 和 WHO 的手册
.venv/bin/python library/fetch_risk.py   # 风险参考资料（死亡率统计、微死亡文章）
curl -L -o library.noindex/raw/wikihowAll.csv \
  https://huggingface.co/datasets/Lajvi/wikihowAll/resolve/main/wikihowAll.csv   # wikiHow（620 MB）
.venv/bin/python library/build_library.py      # 在 library.noindex/ 里生成纯文本和索引
```

`build_library.py` 是增量的（做完的来源会跳过），`--rebuild KEY ...` 会重做指定的来源。
它处理 PDF 手册时需要 `pdftotext`（poppler）。

**默认构建只供你自己使用：** 它包含一些不能分享的材料（见 SOURCES.md）。要构建可以分享的下载包：

```bash
LIBRARY_OUT=dist/library-full .venv/bin/python library/build_library.py --public
LIBRARY_OUT=dist/library-lite .venv/bin/python library/build_library.py --lite
python3 packaging/make_packs.py --base-url https://github.com/OWNER/survival-llm/releases/download/vX.Y.Z \
  lite=dist/library-lite full=dist/library-full   # 发布用的分片 + 给 docs/ 的 library-packs.json
```

知识库包带一个日期（`--version`，默认是今天）；已安装的副本会把日期更新的包当作一次更新来提示。

## 打包应用

```bash
packaging/build.sh     # dist/Survival-LLM-mac.zip 和 dist/Survival-LLM-windows.zip（需要 Xcode 命令行工具）
gh release create "v$(cat packaging/VERSION)" dist/Survival-LLM-mac.zip dist/Survival-LLM-windows.zip
python3 packaging/make_update.py "新版本说明" "..."   # 写出 docs/update.json；之后发布 docs/
```

先在 `packaging/VERSION` 里设定版本号。已安装的副本会从项目网页读取 `docs/update.json`，下载对应系统的压缩包，校验大小和 SHA-256，然后用它替换自己。

Mac 应用打包了一个便携版 Python、用于窗口的 pywebview 和 Ollama。Windows 应用打包了 Python 和 pywebview，并在首次使用时下载 Ollama（加上它的显卡库是 1.6 GB）。

## 许可

代码：MIT（[LICENSE](LICENSE)）。知识库内容保留其来源的许可（[SOURCES.md](SOURCES.md)）。

AI 模型会出错。每个答案都会显示来源，方便你核对。
