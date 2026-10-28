# Renge Agent Lab

Renge Agent Lab 是一个本地优先的 AI Agent 工作台。它把 **Pi 编码内核**、人格设定、角色卡、模型渠道、多 Agent 会话、MCP 工具、Skill、原生扩展、右侧栏浏览器/终端/文件工具和本地工作区操作整合进一个桌面式界面，并可在浏览器、Electron 桌面端和 Android App 上运行。

> 当前版本：`v0.1.0`（Android `versionName 0.1.3`）。项目仍在快速迭代，界面和数据结构可能继续调整；打包脚本目前主要面向 Windows。

## 核心特色

### Pi 内核驱动

会话执行由 [`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) 驱动（当前 `0.87.1`），`server.mjs` 通过 `pi/renge-pi-host.mjs` 把 Pi 的 `AgentSession` 包装成 SSE 流式接口：

- **原生工具**：`read` / `grep` / `find` / `ls` / `write` / `edit` / `powershell`（Windows）或 `bash`（Unix）等由 Pi 内核直接执行，不经过前端桥接。
- **长命令回传**：原生 Shell 实时显示输出；超过单次等待窗口（默认 10 秒）先返回输出和 `session_id`，命令继续运行，AI 可用 `shell_status` 继续读取结果，或用 `shell_stop` 停止进程树。`yield_time_ms` 只控制交还控制权的时间，不缩短或重置命令的 `timeout`；本轮结束、断开或停止时会清理剩余命令。
- **可恢复写入**：Pi 原生 `write` 被替换为带偏移校验的分块式 `write` 工具（`pi/resumable-write-tool.mjs`），本地网关截断长流时不会留下永久运行的写入调用。
- **持续重试**：`pi/continuous-retry.mjs` 在内核层接管重试，配合 `flushIncompleteStreamingToolCalls` 清理未执行完的工具预览。
- **实时上下文与原生压缩**：生成期间节流刷新 Token 用量，每轮工具结果与压缩完成后立即更新；在任务中的安全轮次边界按上下文窗口和预留 Token 自动压缩，再继续原任务。网关少报用量时以本地估算兜底，并在首次超限报错后解析真实窗口并重试同一轮。回归：`npm run test:live-context`；构建后可运行 `node test/chatComposerStatusBrowser.test.mjs` 验证用量实时变化和压缩后的回落。
- **实时用量性能**：Token 更新只刷新独立计数器，后台会话按会话与模型隔离订阅；流式计数复用历史、接口用量与工具定义快照，仅累加新片段，保留请求边界的完整压缩检查。构建后运行 `npm run test:live-context-performance` 验证长会话中的更新和输入响应。
- **请求体超限恢复**：模型接口返回 HTTP 413 时，按实际 JSON 字节大小缩减较早的图片、过长工具输出和完整历史消息组，并有限次自动重试；保留当前用户消息、最新工具调用及其结果和原始会话记录。当前附件或系统提示词仍过大时显示处理建议。回归：`npm run test:request-body`。
- **Pi 原生扩展**：`pi/pi-package-manager.mjs` 让扩展中心可以直接安装、更新、启停和卸载 npm 上的 Pi 包，以及 `pi:` 前缀的 Git / 本地包。

### 聊天文件路径与任务变更

聊天正文、行内代码和 Markdown 链接中的本地文件路径显示为蓝色，点击后打开右侧文件预览。支持 Windows / Unix 绝对路径、工作区相对路径、带空格的 Markdown 文件链接和 `:行号` / `#L行号` 引用；访问范围保持在当前选定工作区内。代码块内的源码保留原样。

Pi 任务执行完毕后，回复下方会列出本次任务**新增、修改、删除**的文件及增删行数，默认展示四个文件，可展开全部列表。点击现存文件可预览；删除文件标记为删除。摘要随会话保存，重新打开后仍可查看。

Git 工作区通过任务首次写入或 Shell 执行前后的独立快照比较，覆盖原生 `write` / `edit` 与原生 Shell 的改动，不把此前的未提交改动算进本轮，也不改变用户暂存区和提交。没有 Git 仓库时记录原生文件工具直接编辑的文件；仅由 Shell 改动的非 Git 文件、MCP 或外部终端产生的改动不保证收录。二进制和超大文件单独标记，最多展示 500 个文件。任务运行期间其他程序对同一仓库的修改也可能被计入。

验证：`npm run build` 后运行 `npm run test:chat-files`，覆盖快照、路径点击、会话持久化、移动端布局和 Electron 窗口。

AI 可通过 `chat_present_files` 交付已经存在的最终文件（每次 1–8 个），填写路径和一句话用途说明。任务回复下方显示独立文件卡片，包含文件类型图标、名称、说明和操作菜单；点击卡片在侧栏预览，也可以复制路径、下载文件。Electron 对支持系统操作的文件工作区额外提供默认应用打开、选择打开方式、在文件夹中显示。文件交付记录随会话保存；卡片打开当前源文件，源文件被删除或移动后会显示读取错误。验证：构建后运行 `npm run test:presented-files`。

### 角色扮演文件记忆

在「设置 → LLM → 角色扮演文件记忆」开启，默认关闭，仅用于角色扮演的文本生成，需要模型支持工具调用。工作区与会话共同确定独立记忆目录，首次生成自动建立；普通发送、重生成、续写及对白/局部重写都使用同一流程：

1. AI 先列目录、搜索关键词并按需读取 Markdown 文件，再把实际读到的片段用于本轮剧情；不会整库注入。
2. 对话正文只发送最近 **3 条消息（用户与角色合计）**。角色卡、系统提示词、预设、世界书触发扫描、脚本和状态栏等其他注入保留原有规则。
3. 正文完成后，AI 再读取相关文件并创建或更新分类记忆。读取、编辑和写入复用应用编码工具 `read` / `edit` / `write`，支持按行读取、多处精确替换及带字节偏移校验的分块写入。工具在隔离草稿中执行，整轮成功后再保存。人物、关系、世界、地点、事件、物品、装备、金钱等都可以自由细分为多级目录和多个 `.md`，没有固定分类表。已有文件先读后改。

既有剧情自动逐条存入 AI 只读的 `剧情原文/`（用户仍可通过文件栏更正），中途启用时仍能搜索早期事实。被舍弃剧情的 AI 记忆修改会随重生成、修改或删除历史而回退，已手动编辑的文件会保留。记忆更新按轮次提交，失败或停止时保留原有分类记忆和已完成正文，并显示错误。

记忆直接保存在会话所属工作区的 `角色记忆/会话-<会话ID>/`，默认工作区使用右侧文件模块的临时文件夹。每个会话都有独立子目录。通过右侧栏「文件」统一浏览 Markdown、点击「编辑文件」修改并保存；下次生成会从实际文件重新读取，删除的文件不会被旧缓存重新创建。LLM 设置只保留功能开关与说明。

旧版会话内记忆首次访问时会自动迁移到该目录，保留目标目录中已有的 Markdown。会话数据继续保留记忆快照和撤销记录用于备份恢复；生成期间若文件被手动修改，会保留手动版本并提示冲突，未完成的本轮文件修改会回退。

构建后运行 `npm run test:file-memory`，覆盖按需读取、隔离、迁移、文件修改回读、失败保护、三条正文窗口、其他注入、右侧栏编辑与设置持久化。

### 右侧栏工具组

聊天窗口右侧是一个可切换的工具侧栏，每一项都是真实能力而非占位：

| 工具 | 说明 |
| --- | --- |
| 浏览器 | 内嵌网页标签页，支持导航、下载管理、评论摘录、独立浏览器配置（Electron 下密码经 `safeStorage` 加密） |
| 终端 | 基于 `node-pty` + xterm.js 的交互式终端，支持多会话、增量读取输出缓冲、按工作区保留会话 |
| 文件 | 工作区与电脑文件树浏览、文本/二进制读写、搜索、新建、删除 |
| 状态栏 | 可视化编辑状态栏数据项（时间、心理、属性、进度、条目、分割线等），支持预设保存 |
| 连接电脑 | 通过 PC 服务连接电脑工作区，浏览并选择远程工作区 |
| 手机 | 可爱手机桌面，包含微信角色聊天、通讯录与外观设置 |
| 审阅 | Git 未暂存、已暂存、分支变更与最近提交；文件筛选、统一/并排差异、行级评论、已阅标记、AI 审阅及交给会话修复 |
| 心跳 | 为会话设置周期性心跳事件与循环次数 |

### 桌面式多窗口

工作室、角色卡、扩展、设置、聊天各自是独立窗口，可拖拽、缩放、吸附、最大化和层叠。Electron 桌面端使用系统窗口，可以拖到主页主窗口之外、放到其他显示器，支持系统任务栏切换和最小化恢复；各窗口共享同一份应用状态，移动或最小化不打断聊天，也不丢失输入草稿。主页介绍、最近会话和关于窗口同样可以独立移动。Web 和 Android 端保留应用内窗口。

独立窗口回归：先运行 `npm run build`，再运行 `npm run test:desktop-windows`，使用隔离数据验证窗口边界、草稿、最小化与最大化、重开、图片预览、消息编辑、侧栏浏览器及主页重载清理。

桌面端的确认和提示使用所属窗口内的异步弹窗，关闭后可以继续输入；普通点击不会重复激活已聚焦的系统窗口。构建后运行 `npm run test:desktop-focus`，通过真实键盘事件验证删除会话、删除工作区、重置、取消、窗口切换和主页最小化后的输入。

## 主要能力

- **人格 Agent**：按身份、背景、偏好、行为、关系、记忆、边界等类型组织条目，可设置影响强度；支持头像裁剪、人格导入导出与可用的 Prompt 文本预览。
- **用户资料**：在设置中新增多份用户资料并选择当前使用的一份，各自保存头像、昵称、简介和发送给 AI 的开关；切换后用于聊天显示和后续请求，原有单份资料会自动迁移，资料列表与选择随应用数据和完整备份保存。回归：`npm run build` 后运行 `npm run test:user-profiles`。
- **角色卡**：导入/导出 PNG 内嵌元数据的角色卡，支持世界书绑定、开场白、宏替换、字段翻译与提示词拼装。
- **世界书与预设**：世界书条目的位置、深度、触发方式和局部更新；Chat 预设与状态栏预设管理。
- **正则与脚本**：正则脚本管理，以及酒馆脚本运行时（见下）。
- **模型渠道**：OpenAI-compatible 的 Chat Completions / Responses API 渠道，每个渠道独立保存 API 类型；支持拉取模型列表、独立设置最大输出 Token（默认 65,536）和上下文窗口，内置火山方舟 Coding Plan 预设。
- **单 Agent / 多 Agent 会话**：既可直接对话，也可为多个 Agent 分别选择模型并顺序多轮讨论，支持委派给子 Agent、自动停止条件和停止条件判断。
- **会话独立运行**：每个会话独立保存运行控制器、回复、进度、计时与输入草稿。生成期间可切换或新建会话，并同时运行多个任务；会话列表显示「运行中」，停止按钮只停止当前会话。各会话仍使用所选工作区的真实文件，未自动创建 worktree。
- **运行中追加消息**：运行中输入区为空时显示停止按钮；输入文字或添加附件后变为发送按钮，点击发送（或按回车）再选择「排队」或「立即纠偏」。排队按发送顺序在本轮完成后执行；桌面/Web 的文本纠偏使用 Pi 原生 steering，在下一个处理边界加入当前任务。Android、多 Agent、图像生成及带附件的纠偏保留已有输出，停止当前生成后携带新消息继续。可查看和取消尚未提交的消息；手动停止或调用失败会暂停队列，点击「继续排队」恢复。待处理消息随会话保存，刷新或重启后以暂停状态恢复。
- **系统提示词与用户资料**：组合多个系统提示词，可选择是否注入用户昵称与简介；支持对话续写、对白改写、上下文压缩等内置提示词。
- **MCP 工具**：导入 MCP JSON、发现服务器工具，通过 `pi-mcp-adapter` 以 Pi 原生扩展方式接入会话。
- **Skill**：从文件夹或 ZIP 导入 Pi 原生 `SKILL.md`，校验 YAML frontmatter 后交由 Pi 原生 Skill 加载器使用。
- **扩展中心**：支持三类扩展——Renge 原生（内置能力）、酒馆 Web 兼容（Git 仓库 `manifest.json`）和 Pi 包。
- **附件与图片**：文本、图片和二进制附件；可对接视觉模型或图像识别 MCP，图片按会话存入 `session-images` 目录。
- **会话记忆与心跳**：保存工作区会话，支持周期性心跳事件、循环次数和聊天提醒。
- **口袋手机**：右侧栏的独立手机桌面，微信支持创建联系人或从角色卡、人格导入角色，与角色进行一对一对话；设置支持三种主题、昵称、字号以及聊天模型。联系人与消息按主会话分开保存在当前设备，模型请求支持 Chat Completions / Responses，失败可重试，也可停止等待。
  - 手机设置按「操作、外观、接口、生成」分为折叠卡片。「提示词修改」按微信、ta 的手机、便签、朋友圈、小红书与通用时间分类展示 38 项默认提示词，可直接编辑保存、单项恢复默认或全部恢复默认。提示词在当前设备全局共用，切换或新建会话后，手机应用及 ta 的手机继续使用已保存的修改，刷新后保留。角色、资料与历史记录通过变量在请求时填入，各会话的手机记录与外观仍独立。已有自定义提示词会自动迁移，同一项有多个旧版本时优先保留当前会话的版本；恢复默认全局生效，不改动聊天或应用记录。可运行 `npm run test:pocket-settings` 验证界面、存储及实际请求。
  - 桌面「ta 的手机」可选择微信角色作为手机主人，再打开 ta 的微信。界面及聊天、群聊、附件、钱包功能复用用户的微信；「生成联系人」同时添加其他人物、群聊和成员资料，「生成聊天记录」同时生成或续写 ta 与其他人的私聊和群聊，保留已有记录。群成员优先复用联系人，也可仅在群里出现；生成排除真实用户，发言按主人或具体群成员保存，群聊记录注入共享上下文。续写保留群及成员的身份，过滤重复群消息，整批校验失败或取消时不保存部分结果。
  - ta 与用户的聊天共用用户手机的原始记录，进入时反转消息方向；两边发信、收回复及主会话编辑、删除都会同步，生成其他联系人时排除用户。可使用 ta 的身份发消息，再点击发送按钮生成对方回复。
  - 角色手机的聊天同样参考主会话、启用的世界书及手机主人绑定的角色卡世界书，并按实际发言人注入共享上下文。每个主会话和角色的联系人、群聊及钱包分别保存。用户资料从应用用户资料和用户手机昵称读取。
  - ta 的手机桌面「便签」移植芋圆备忘录的暖白、金色列表及详情样式，支持生成、搜索、新建、编辑和删除。生成读取与微信相同的共享主会话、角色卡和世界书，新增内容保留已有便签；每个主会话、每位手机主人分别保存。便签以「便签 · 手机主人」按产生顺序注入上下文，供主会话和微信参考；两边编辑、删除同步，重载不重复注入。便签保留创建时的虚拟时间，其中的待办日期不会改变当前剧情时钟。
  - 便签回归：`npm run build` 后运行 `npm run test:pocket-notes`，验证上下文、世界书、主会话与微信引用、搜索和编辑、角色隔离、持久化、双向同步及取消生成。
  - 用户手机和 ta 的手机均可从微信「发现」或「我」打开朋友圈，共用动态与互动记录。支持发帖、配图描述或上传图片、定位、更换封面、可见范围、点赞、评论及回复、编辑和删除；可生成好友近况、好友互动、帖主回复，以及 ta 自己的动态。生成沿用微信的主会话、角色卡和世界书背景，保留已有动态，不代替真实用户发帖或互动。朋友圈按产生顺序注入共享上下文，主会话的编辑、删除同步回手机；私密和部分可见范围同时限制角色手机显示及模型请求中的朋友圈背景，动态日期不会修改剧情时钟。
  - 朋友圈回归：`npm run build` 后运行 `npm run test:pocket-moments`，验证跨手机共享、发布和图片、权限、生成、主会话/微信/便签参考、双向编辑删除、持久化及取消生成。
  - ta 的朋友圈「生成 ta 的动态」同时追加手机主人和 ta 的微信联系人的近况（排除真实用户）。主人与联系人分别读取其可见的朋友圈背景，私密内容不会用于联系人生成；两批都成功后一起保存，中途失败或取消不保存半批动态。没有其他联系人时只生成主人动态。
  - 微信使用按主会话保存的独立虚拟时钟，用户手机和 ta 的手机共用。首次使用生成初始日期与时间，现实只提供经过的时长，关闭手机或刷新后仍等速推进；主会话正文中的明确日期、钟点及「次日」「几小时后」等剧情时间优先校准。未来约定、回忆、引用及微信聊天里的日期不会改动当前时钟。历史消息和账单保存发出时的虚拟时间，正文校准后保留原来的时间。
  - 虚拟时间回归：`npm run build` 后运行 `npm run test:pocket-wechat-clock`，验证跨天推进、正文优先、两边同步、关闭手机及重载后的时间连续性。
  - 手机桌面「日历」支持翻月选日期、输入年月日和时分并跳转。选定时间同步到用户手机与 ta 的手机，以日历时间更新记录加入当前主会话上下文；后续正文时间仍优先，旧微信消息保留发送时的时间。
  - 日历回归：`npm run build` 后运行 `npm run test:pocket-calendar`，验证选日期、时间跳转、上下文注入、保存和重载、失败重试及窄侧栏布局。
  - 角色手机回归：`npm run build` 后运行 `npm run test:pocket-character-phone`，使用隔离数据和本地测试响应验证生成、双向同步、身份、世界书、重载及取消。
  - 微信底部「我 → 服务 → 钱包 → 零钱」使用微信样式，零钱默认 `¥0.00`，点击「修改余额」保存自定义金额；账单记录余额修改、转账支出、收款和退款，按主会话保存。
  - 聊天输入框旁的「＋」提供从芋圆机移植的转账、图片与文字语音卡。转账检查余额并支持收款、退还；群聊可选择收款人。图片支持画面描述卡和本地图片上传、预览；语音填写秒数与文字，点击气泡展开内容，沿用原项目交互。
  - 角色可在回复中发送 `[转账:金额:留言]`、`[图片:描述]`、`[语音:秒数:内容]`，待收款编号通过上下文提供，角色用 `[收款:编号]` 或 `[退还:编号]` 处理。消息描述与收款状态同步至主会话，用户收款后也会生成确认记录。
  - 新功能回归：先运行 `npm run build`，再运行 `npm run test:pocket-wechat`；测试使用隔离数据及本地模型响应，不修改真实会话。
- **数据备份**：v3 ZIP 完整备份导入导出（分块打包；完整解压及 CRC 校验通过后再替换旧数据），支持小于 2 GB 的 ZIP 文件、最多 8 GB 的解压总量，包含应用数据目录中的配置、会话、图片与导入文件；以及 `app-data.json` 的多代自动备份与回滚。Android 流式返回恢复后的本地设置，避免大备份响应占满内存；恢复失败或结果不明时保留错误提示并暂停保存。构建后运行 `npm run test:backup-import-browser` 验证导入失败保护，运行 `npm run test:backup-large` 验证 520 MiB 文件的实际导出与恢复。

## 酒馆（SillyTavern）兼容层

这是本项目与普通 Agent 客户端最大的差异点之一。Renge 并不运行 SillyTavern，而是在自己内部实现了兼容运行时：

- **模块代理**：`server.mjs` 拦截 jsDelivr 上的角色卡脚本模块，重写 import 后经 `/api/tavern-module-proxy` 转发，并提供 `/script.js`、`/scripts/extensions.js`、`/scripts/slash-commands/*` 等兼容模块。
- **全局 API 桥接**：`src/tavernScriptRuntime.ts` 在隔离运行时中注入 jQuery、Lodash、Vue、Zod、YAML 等依赖，并桥接 `SillyTavern.getContext()`、`eventSource`、`extension_settings`、`world_info`、`executeSlashCommandsWithOptions` 等接口。
- **持久化**：脚本扩展设置保存到 `app-data.json` 的 `tavernExtensionSettings` 字段；脚本数据、聊天元数据、消息中的数据库表和世界书一并随应用数据保存；星河璀璨数据库使用的向量文件存放在数据目录的 `tavern-files` 下。
- **已验证兼容**：针对星河璀璨数据库 `spv9.2.5.1` 的设置桥接、世界书局部更新、文件接口和 OpenAI-compatible 自定义 API 做过适配；`ST-Prompt-Template`（EJS 提示词模板）有原生兼容层。

已知边界：脚本本体及其依赖仍需联网加载；原生 Claude / Gemini 协议和酒馆连接管理器预设不是完整实现，建议使用本应用主 API 或 OpenAI-compatible 自定义接口。

### 本地芋圆机脚本

已有 `yuyuan.readable.js`、`assets-list.txt` 和 `yuyuan-assets` 的本地资源包时，在项目目录运行：

```powershell
node scripts/install-yuyuan.mjs E:\AI\yuyuan
```

安装器将源码和资源写入应用数据目录的 `tavern-script-assets/yuyuan`，并输出可导入的 `yuyuan.renge.script.json` 路径。在「酒馆脚本」导入该 JSON 后启用，再进入会话点「芋圆机按钮」。默认数据目录为 `%APPDATA%\Renge Agent Lab`，可通过 `RENGE_DATA_DIR` 或安装器第二个参数指定。

本地资源通过 `/tavern-script-assets/` 提供，旧加载器的 `/yuyuan/` 路径也可使用。文件随完整备份保存，重新构建或启动 Electron 不会清除；更新芋圆机资源包时再运行安装器。脚本 iframe 使用 `document.baseURI` 定位宿主页地址。缺失资源返回 404，不会被应用首页 HTML 替代。

## 运行形态

| 形态 | 启动方式 | 适合场景 | 主要限制或特性 |
| --- | --- | --- | --- |
| Web 服务 | `npm start` 或 `run_server.bat` | 浏览器访问、局域网共享、给手机端提供电脑服务 | 默认监听网络接口并打印局域网地址；文件能力受服务设置限制 |
| Electron 桌面端 | `npm run desktop` 或 `run.bat` | 完整工作区、终端、内嵌浏览器、Git 与脚本操作 | 内嵌服务端口 `5191`；离线安装脚本面向 Windows x64 |
| Android App | `npm run android:apk` | 手机端 Agent、手机工作区、内嵌浏览器、连接电脑 | 需要 Android SDK；App 内部运行 `LocalWebServer` 提供同构 API |

## 技术栈

- React 19 + TypeScript 5 + Vite 7
- Node.js HTTP 服务（`server.mjs`，无 Web 框架）
- Pi 编码内核 `@earendil-works/pi-coding-agent` / `pi-ai` / `pi-tui`
- Electron 42（`webview` 侧栏浏览器、`node-pty` 终端、`safeStorage` 凭据）
- Android Java + Gradle（`compileSdk 35`、`minSdk 24`、Termux 终端仿真库、SnakeYAML）
- xterm.js、highlight.js、EJS、Lucide React

## 环境要求

### Web 与桌面端

- Web：Node.js `20.19+` 或 `22.12+`
- Electron 桌面端：Node.js `22.12+`
- npm 10 或兼容版本
- Git（开发、版本恢复，以及从 Git 安装酒馆扩展时使用）

本仓库当前已在 Node.js 22 环境下完成构建验证。

### Android

- JDK 17 或更高版本
- Android SDK，包含 Android API 35
- Windows 下可直接运行仓库提供的 APK 构建脚本

## 快速开始

### 手动启动

```powershell
git clone https://github.com/jinyan438/renge.git
cd renge
npm install
npm run build
npm start
```

默认访问地址：

```text
http://localhost:5190
```

启动时终端还会输出可用的局域网地址。除非已经配置防火墙、访问控制或可信网络，否则不要把服务直接暴露到公网。

Windows 桌面端分为两个脚本：首次使用或更新代码后先双击 `build.bat`，检查环境、安装缺失的依赖并构建；日常双击 `run.bat`，只运行已构建的应用，不安装依赖、不重新构建。缺少依赖或构建结果时，`run.bat` 会提示先运行 `build.bat`。`run_server.bat` 仍用于构建并启动 Web 服务。

通过 `run.bat` 启动桌面端时，正常关闭应用后启动终端会自动退出；启动失败或异常退出时保留错误提示，方便排查。

### Linux 一键启动

双击仓库根目录的 `Renge Agent Lab.desktop`，会自动完成环境检查、依赖安装和构建并打开 Electron 桌面客户端。首次启动需要联网下载 Node.js、项目依赖和 Electron Runtime；后续启动仅在依赖变化时重新安装。

如果桌面环境首次提示启动器不受信任，请右键选择「允许运行」或「允许启动」。也可以在终端运行：

```bash
./start-client.sh          # Electron 桌面端
./start-renge.sh           # Web 服务（浏览器访问）
```

启动器要求 Linux x86_64；未安装合格 Node.js 时，它会把经过 SHA-256 校验的便携 Node.js 22 安装到被 Git 忽略的 `.runtime` 目录，不会修改系统 Node.js。

## 开发模式

```powershell
npm run dev
```

Vite 默认使用 `http://localhost:5173`。这个命令主要用于前端界面开发；模型代理、Pi 内核、持久化、MCP 和电脑文件服务等完整后端能力由 `server.mjs` 提供，日常完整体验建议执行 `npm run build` 后再 `npm start`。

构建完成后也可以仅预览静态前端：

```powershell
npm run preview
```

## Electron 桌面端

```powershell
npm run build
npm run desktop
```

`npm run build` 只构建，`npm run desktop` / `npm run electron` 只启动已有构建。代码更新后需要重新构建，日常启动可以直接运行后者；Windows 下对应 `build.bat` 和 `run.bat`。桌面端会在本机启动内嵌服务（端口 `5191`），并提供更完整的能力：

- 选择和恢复电脑工作区，读取当前系统账户有权访问的任意目录
- 文件读写、搜索、移动与删除（工作区外变更按「完全访问」设置直接执行或逐次审批）
- 运行项目中已有的 npm script 和安全白名单命令（`npm`、`pnpm`、`yarn`、`node`、`git`）
- 查看 Git 状态与 Git diff，高风险 Git 操作（`reset`、`clean`、`push`、`rebase` 等）额外弹窗确认
- 侧栏浏览器（独立分区与 Cookie 配置）和基于 `node-pty` 的交互式终端
- 原生右键文本菜单、窗口吸附预览、渲染兼容策略（Linux X11 + NVIDIA 默认关闭硬件加速；Windows 虚拟显示驱动环境使用软件窗口合成，保留 WebGL 与视频 GPU 加速）

如果 Windows 环境无法在线下载 Electron Runtime，可以准备官方 Windows x64 运行时压缩包：

```text
electron-v42.4.1-win32-x64.zip
```

把它放在项目根目录，然后运行：

```powershell
npm run electron:install-local
npm run build
npm run desktop
```

## 构建 Android APK

先在 `renge_android/local.properties` 中配置 Android SDK 路径：

```properties
sdk.dir=C:/Users/your-name/AppData/Local/Android/Sdk
```

然后在 Windows PowerShell 或命令提示符中运行：

```powershell
npm run android:apk
```

构建流程会自动：

1. 由 Gradle 调用 `npm run build` 构建前端；
2. 把 `dist` 同步到 Android Web Assets（`app/src/main/assets/www`）；
3. 运行 Gradle `clean assembleDebug`；
4. 用 `scripts/verify-android-apk.ps1` 检查 APK 的 Manifest、资源、DEX、Web Assets 和签名；
5. 验证成功后把 Gradle 临时产物移动到项目根目录，避免留下两个易混淆的 APK。

成功后的 APK 路径：

```text
Renge-Agent-Lab-debug.apk
```

这是唯一应安装和分发的 APK。`renge_android/app/build/outputs/apk/debug/app-debug.apk`
只在 Gradle 构建期间临时生成，脚本完成后会被移动走。请统一使用
`npm run android:apk` 或根目录的 `build_android_apk.bat`，不要直接分发 Gradle 临时产物。

APK、Android 构建目录、`local.properties` 和生成的 Web Assets 已加入 `.gitignore`，不会被提交到仓库。

## 首次使用

1. 打开「设置」窗口。
2. 在「供应商渠道」中选择 Chat Completions 或 Responses API，填写模型服务名称、API Base URL 和 API Key（每个渠道独立保存 API 类型）。
3. 拉取模型列表或手动填写模型 ID，选择当前模型，并按需设置最大输出 Token 和上下文窗口。
4. 按需配置系统提示词、用户资料、世界书、预设、正则、MCP 服务器、Skill 和扩展。
5. 创建或选择一个人格 Agent / 角色卡。
6. 打开聊天窗口，选择单 Agent 或多 Agent 模式。
7. 如果需要让 Agent 操作文件，先选择并授权工作区。

OpenAI 官方接口的 API Base URL 示例：

```text
https://api.openai.com/v1
```

其他供应商需要提供与所选 OpenAI Chat Completions 或 Responses API 协议兼容的地址。不同服务对流式响应、推理参数、工具调用、图片生成和图片编辑的兼容程度可能不同。

## 数据存储

完整 Web 服务和 Electron 桌面端会把持久化数据写入 `app-data.json`。Windows 默认目录为：

```text
%APPDATA%\Renge Agent Lab\app-data.json
```

同一数据目录下还会生成：

```text
app-data.backup-1.json ~ app-data.backup-3.json   多代自动备份
app-data-assets/                                  角色卡封面等应用图片
.pi/                                              Pi 会话与本地配置
skills/                                           已导入的 Pi 原生 Skill 文件
extensions/                                       已安装的酒馆扩展及资源
session-images/、generated-images/                 聊天图片与生成图片
tavern-files/                                     酒馆扩展上传的数据文件
```

可以通过 `RENGE_DATA_DIR` 修改数据目录：

```powershell
$env:RENGE_DATA_DIR = "D:\RengeData"
npm start
```

写入使用「原子替换 + 写入队列 + 备份轮转」：主文件损坏时自动回退到最近的可用备份。Android 增量保存逐项读取并写入主数据，保留会话版本冲突检查，避免导入大备份后的自动保存把整份数据反复复制到内存而闪退。浏览器在后端持久化接口不可用时会退回 `localStorage`；Android 主数据读取失败时会显示错误并暂停自动保存，避免用空的缓存覆盖已恢复的数据。供应商配置可能包含 API Key，因此不要把数据目录、浏览器配置或 `app-data.json` 上传到公开位置，也不要把 API Key 写入仓库文件。

## 测试

仓库包含大量 Node 测试（`test/`），绝大多数覆盖纯逻辑工具模块，无需构建即可运行：

```powershell
npm test
```

该命令使用 `node --test`（配合 `--experimental-strip-types`）运行 `test/*.test.mjs`，覆盖 Pi 桥接与流式时间线、工具消息排序、Android 适配与契约、工作区访问、命令策略、上下文压缩、酒馆兼容、角色卡、状态栏等模块，最后追加 `npm run test:preset`。

其他专项测试：

| 命令 | 说明 |
| --- | --- |
| `npm run test:mcp` | Pi MCP 适配器桥接测试 |
| `npm run test:preset` | 预设工具测试（经 tsx） |
| `npm run test:tavern` | 浏览器端酒馆运行时回归测试 |
| `npm run test:task-responsiveness` | 构建后运行：使用约 215 MB 隔离历史、连续工具调用、输入、滚动和保存，对比运行中与结束后的帧耗时；覆盖浏览器、原生桌面及大图片结果，报告写入 `.runtime/task-responsiveness-*.json` |
| `npm run test:task-startup` | 构建后运行：真实加载约 48 MB Pi 历史，测量主循环阻塞及桌面启动帧耗时，验证鼠标和回车发送期间连续输入、焦点保持与主动移开焦点；使用隔离数据与本地模型响应 |
| `npm run test:pi-worker` | 在独立 Pi 线程中验证原生工具、授权、停止、断开、压缩、会话恢复及本地扩展包操作 |

酒馆浏览器回归测试需要先构建前端并安装 Playwright 浏览器：

```powershell
npm run build
npx playwright install chromium
npm run test:tavern
```

也可以用环境变量 `PLAYWRIGHT_CHANNEL=chrome` 使用本机 Chrome。设置 `TAVERN_SCRIPT_FILE` 为酒馆脚本 JSON 的路径后，同一测试会加载真实脚本并验证界面中的 API 预设、开关在浏览器与服务重启后恢复。测试使用独立临时数据目录，不读取日常应用数据。

提交前至少应运行：

```powershell
npm run build
npm test
```

涉及 Android 的修改还应运行：

```powershell
npm run android:apk
```

## 环境变量

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `PORT` | `5190` | 设置独立 Web 服务监听端口（Electron 内嵌服务固定 `5191`） |
| `RENGE_DATA_DIR` | `%APPDATA%\Renge Agent Lab` | 设置持久化数据目录 |
| `RENGE_PC_FILES` | 启用 | 设为 `0` 可关闭电脑文件服务 API |
| `RENGE_ELECTRON_CACHE_DIR` | `%LOCALAPPDATA%\Renge Agent Lab\ElectronCache` | 设置 Electron 缓存目录 |
| `RENGE_HARDWARE_ACCELERATION` | 自动 | `1` 强制启用完整 GPU 路径，`0` 强制关闭 Electron 硬件加速；Linux X11 + NVIDIA 默认关闭；Windows 检测到虚拟显示驱动时默认只关闭 GPU 窗口合成，保留 WebGL 与视频 GPU 加速 |
| `PLAYWRIGHT_CHANNEL` | 空 | 设为 `chrome` 时酒馆浏览器测试使用本机 Chrome |
| `TAVERN_SCRIPT_FILE` | 空 | 指定酒馆脚本 JSON，让回归测试加载真实脚本 |

例如，仅在本机使用 Web 服务并关闭电脑文件服务：

```powershell
$env:RENGE_PC_FILES = "0"
npm start
```

`server.mjs` 还会读取标准代理环境变量（`http_proxy` / `https_proxy` / `no_proxy`）；Windows 上若未设置环境变量，会回退读取注册表中的 Internet Settings 代理配置。

## HTTP API 概览

`server.mjs` 同时扮演静态资源服务和后端 API，主要端点：

| 端点 | 说明 |
| --- | --- |
| `POST /api/pi/chat` | Pi 内核会话入口，返回 SSE（`run_start`、`tool_call_*`、`tool_start` / `tool_end`、`context_usage` 等事件） |
| `POST /api/pi/tool-result` | 把前端工具执行结果回填给等待中的 Pi 工具调用 |
| `POST /api/pi/abort` | 中止指定 run |
| `POST /api/pi/compact` | 对空闲的 Pi 会话执行手动压缩 |
| `POST /api/pi/set-auto-compaction` | 开关该会话的自动压缩 |
| `/api/providers/models` | 从兼容接口拉取模型列表 |
| `POST /api/chat/completions` | 非 Pi 的直连补全代理 |
| `/api/app-data` | 读写持久化数据，支持完整备份导入导出与资源访问 |
| `/api/skills/*` | Skill 导入（文件夹 / ZIP）、元数据校验与上下文注入 |
| `/api/mcp/tools`、`/api/mcp/call-tool` | MCP 工具发现与调用 |
| `/api/extensions/*` | 扩展安装（Git）、更新、文件服务 |
| `/api/pc/*` | 电脑文件服务：浏览、读写、搜索、上传下载、创建与删除 |
| `/api/session-images/*` | 会话图片读写 |
| `/api/tavern-module-proxy` | 酒馆脚本模块代理 |
| `/api/backends/chat-completions/*` | 酒馆脚本使用的补全状态与生成兼容端点 |
| `/script.js`、`/scripts/extensions/*` 等 | 酒馆兼容模块 |

## 安全说明

- 独立 Web 服务默认监听网络接口并打印局域网访问地址。请只在可信网络中使用，不要直接映射到公网。
- API Key 和应用配置存放在本地持久化数据中；请自行保护操作系统账户和数据目录。
- Electron 桌面版的读取工具可访问当前系统账户有权读取的任意目录；关闭「完全访问」时，工作区外的创建、写入、编辑、移动和删除会逐次请求授权。命令执行和 Git 操作仍可能改变文件或仓库状态，请在授权前确认操作内容。
- 高风险 Git 命令会额外请求确认；不要在不理解影响的情况下批准历史重写、强制推送或清理命令。
- Pi 原生工具会在授权工作区内直接读写文件并执行 Shell 命令，这是设计行为；请为主要使用场景选择合适的工作区。
- MCP Server 与 Pi 包都是外部程序或服务。只导入可信来源，并了解它能够访问的数据和系统资源。
- 酒馆扩展经 Git 克隆后会在应用内被加载执行；安装前请确认仓库来源可信。
- 侧栏浏览器使用独立分区；仅在你明确导入时保存凭据，密码在 Electron 下经系统安全存储加密。
- Android App 允许明文局域网 HTTP 通信，以便连接电脑服务；请避免在不可信网络中传输敏感文件。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动 Vite 前端开发服务器 |
| `npm run build` | 执行 TypeScript 检查并构建前端 |
| `npm run preview` | 预览已构建的静态前端 |
| `npm start` / `npm run serve` | 启动完整 Web 服务，默认端口 5190 |
| `build.bat` | Windows 构建入口，准备缺失的依赖并构建，不启动应用 |
| `run.bat` | Windows 运行入口，只启动已有构建 |
| `npm run desktop` / `npm run electron` | 启动已构建的 Electron 桌面端 |
| `npm run electron:install-local` | 从项目根目录的 Electron ZIP 安装 Windows x64 Runtime |
| `npm run android:apk` | 构建并验证 Android Debug APK |
| `npm test` | 运行 Node 测试套件并追加预设测试 |
| `npm run test:mcp` / `test:preset` / `test:tavern` | 专项测试 |

## 项目结构

```text
renge/
├─ src/                         React 前端：桌面外壳、聊天、人格、角色卡、酒馆运行时与各类工具
│  ├─ App.tsx                   主应用与多窗口编排
│  ├─ DesktopHome.tsx           项目化桌面主页
│  ├─ BrowserSidebarPanel.tsx   侧栏浏览器
│  ├─ FilesSidebarPanel.tsx     侧栏文件
│  ├─ TerminalSidebarPanel.tsx  侧栏终端
│  ├─ StatusBarSidebar.tsx      侧栏状态栏
│  ├─ WechatSidebar.tsx         微信侧栏
│  ├─ tavernScriptRuntime.ts    酒馆脚本隔离运行时
│  └─ piBridgeUtils.mjs         前后端共用的 Pi 桥接工具
├─ pi/                          Pi 内核宿主层
│  ├─ renge-pi-host.mjs         AgentSession 封装与 SSE 事件映射
│  ├─ pi-mcp-adapter-bridge.mjs MCP 适配
│  ├─ pi-package-manager.mjs    Pi 原生包安装与管理
│  ├─ continuous-retry.mjs      内核层持续重试
│  └─ resumable-write-tool.mjs  可恢复分块写入工具
├─ electron/                    Electron 主进程、预加载桥接与各能力模块
├─ renge_android/               Android 原生工程（Activity、LocalWebServer、工作区桥接）
├─ test/                        Node 测试套件与 Playwright 回归测试
├─ scripts/                     Electron 安装与 APK 验证脚本
├─ server.mjs                   Web 服务、API、Pi 宿主接入、酒馆模块代理与文件服务
├─ build_android_apk.bat        Android APK 一键构建脚本
├─ build.bat                    Windows 桌面端构建
├─ run.bat                      Windows 桌面端运行（不构建）
├─ run_server.bat                Windows Web 服务快速启动
├─ start-client.sh              Linux Electron 客户端一键启动
├─ start-renge.sh               Linux Web 服务一键启动
├─ package.json                 Node.js 依赖与 npm scripts
├─ AGENTS.md                    AI 修改代码时的版本控制与安全规则
└─ README.md                    项目说明
```

## 版本管理与恢复

本项目要求每次 AI 修改对应一个独立 Git 提交，并在完成验证后推送到 `origin`。具体规则见 [`AGENTS.md`](./AGENTS.md)。

查看版本历史：

```powershell
git log --oneline --decorate --graph --all
```

从稳定标签建立恢复分支：

```powershell
git switch -c recovery/v0.1.0 v0.1.0
```

撤销一个已经提交的错误版本，同时保留历史：

```powershell
git revert <commit-id>
git push origin main
```

除非已经备份并明确理解后果，否则不要使用 `git reset --hard`、`git clean` 或 `git push --force`。

## License

仓库当前尚未添加开源许可证。在许可证明确之前，请不要默认该项目允许复制、再分发或商业使用。
