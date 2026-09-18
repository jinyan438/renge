# Renge Agent Lab

Renge Agent Lab 是一个本地优先的 AI Agent 工作台。它把 **Pi 编码内核**、人格设定、角色卡、模型渠道、多 Agent 会话、MCP 工具、Skill、原生扩展、右侧栏浏览器/终端/文件工具和本地工作区操作整合进一个桌面式界面，并可在浏览器、Electron 桌面端和 Android App 上运行。

> 当前版本：`v0.1.0`（Android `versionName 0.1.3`）。项目仍在快速迭代，界面和数据结构可能继续调整；打包脚本目前主要面向 Windows。

## 核心特色

### Pi 内核驱动

会话执行由 [`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) 驱动（当前 `0.85.1`），`server.mjs` 通过 `pi/renge-pi-host.mjs` 把 Pi 的 `AgentSession` 包装成 SSE 流式接口：

- **原生工具**：`read` / `grep` / `find` / `ls` / `write` / `edit` / `powershell`（Windows）或 `bash`（Unix）等由 Pi 内核直接执行，不经过前端桥接。
- **可恢复写入**：Pi 原生 `write` 被替换为带偏移校验的分块式 `write` 工具（`pi/resumable-write-tool.mjs`），本地网关截断长流时不会留下永久运行的写入调用。
- **持续重试**：`pi/continuous-retry.mjs` 在内核层接管重试，配合 `flushIncompleteStreamingToolCalls` 清理未执行完的工具预览。
- **原生压缩**：按上下文窗口和保留 Token 自动执行 Pi 的 `compact()`；网关谎报用量时使用本地估算兜底，并在首次超限报错后从错误信息中解析真实窗口并重试同一轮。
- **Pi 原生扩展**：`pi/pi-package-manager.mjs` 让扩展中心可以直接安装、更新、启停和卸载 npm 上的 Pi 包，以及 `pi:` 前缀的 Git / 本地包。

### 右侧栏工具组

聊天窗口右侧是一个可切换的工具侧栏，每一项都是真实能力而非占位：

| 工具 | 说明 |
| --- | --- |
| 浏览器 | 内嵌网页标签页，支持导航、下载管理、评论摘录、独立浏览器配置（Electron 下密码经 `safeStorage` 加密） |
| 终端 | 基于 `node-pty` + xterm.js 的交互式终端，支持多会话、增量读取输出缓冲、按工作区保留会话 |
| 文件 | 工作区与电脑文件树浏览、文本/二进制读写、搜索、新建、删除 |
| 状态栏 | 可视化编辑状态栏数据项（时间、心理、属性、进度、条目、分割线等），支持预设保存 |
| 连接电脑 | 通过 PC 服务连接电脑工作区，浏览并选择远程工作区 |
| 手机 | 手机与电脑工作区之间的文件传输与协作 |
| 审阅 | 浏览器评论、工具调用差异等内容的集中审阅 |
| 心跳 | 为会话设置周期性心跳事件与循环次数 |

### 桌面式多窗口

Electron 端和 Web 端共用同一套「项目化桌面」外壳（`src/DesktopHome.tsx`、`WindowResizeHandles`、`WindowSnapPreview`）：工作室、角色卡、扩展、设置、聊天各自是独立窗口，可拖拽、缩放、吸附、最大化和层叠。

## 主要能力

- **人格 Agent**：按身份、背景、偏好、行为、关系、记忆、边界等类型组织条目，可设置影响强度；支持头像裁剪、人格导入导出与可用的 Prompt 文本预览。
- **角色卡**：导入/导出 PNG 内嵌元数据的角色卡，支持世界书绑定、开场白、宏替换、字段翻译与提示词拼装。
- **世界书与预设**：世界书条目的位置、深度、触发方式和局部更新；Chat 预设与状态栏预设管理。
- **正则与脚本**：正则脚本管理，以及酒馆脚本运行时（见下）。
- **模型渠道**：OpenAI-compatible 的 Chat Completions / Responses API 渠道，每个渠道独立保存 API 类型；支持拉取模型列表、独立设置最大输出 Token（默认 65,536）和上下文窗口，内置火山方舟 Coding Plan 预设。
- **单 Agent / 多 Agent 会话**：既可直接对话，也可为多个 Agent 分别选择模型并顺序多轮讨论，支持委派给子 Agent、自动停止条件和停止条件判断。
- **系统提示词与用户资料**：组合多个系统提示词，可选择是否注入用户昵称与简介；支持对话续写、对白改写、上下文压缩等内置提示词。
- **MCP 工具**：导入 MCP JSON、发现服务器工具，通过 `pi-mcp-adapter` 以 Pi 原生扩展方式接入会话。
- **Skill**：从文件夹或 ZIP 导入 Pi 原生 `SKILL.md`，校验 YAML frontmatter 后交由 Pi 原生 Skill 加载器使用。
- **扩展中心**：支持三类扩展——Renge 原生（内置能力）、酒馆 Web 兼容（Git 仓库 `manifest.json`）和 Pi 包。
- **附件与图片**：文本、图片和二进制附件；可对接视觉模型或图像识别 MCP，图片按会话存入 `session-images` 目录。
- **会话记忆与心跳**：保存工作区会话，支持周期性心跳事件、循环次数和聊天提醒。
- **微信侧栏**：把会话消息同步到微信侧栏，并可对单聊/群聊批量生成回复。
- **数据备份**：完整备份导入导出（`renge-agent-complete-backup` 格式，含资源），以及 `app-data.json` 的多代自动备份与回滚。

## 酒馆（SillyTavern）兼容层

这是本项目与普通 Agent 客户端最大的差异点之一。Renge 并不运行 SillyTavern，而是在自己内部实现了兼容运行时：

- **模块代理**：`server.mjs` 拦截 jsDelivr 上的角色卡脚本模块，重写 import 后经 `/api/tavern-module-proxy` 转发，并提供 `/script.js`、`/scripts/extensions.js`、`/scripts/slash-commands/*` 等兼容模块。
- **全局 API 桥接**：`src/tavernScriptRuntime.ts` 在隔离运行时中注入 jQuery、Lodash、Vue、Zod、YAML 等依赖，并桥接 `SillyTavern.getContext()`、`eventSource`、`extension_settings`、`world_info`、`executeSlashCommandsWithOptions` 等接口。
- **持久化**：脚本扩展设置保存到 `app-data.json` 的 `tavernExtensionSettings` 字段；脚本数据、聊天元数据、消息中的数据库表和世界书一并随应用数据保存；星河璀璨数据库使用的向量文件存放在数据目录的 `tavern-files` 下。
- **已验证兼容**：针对星河璀璨数据库 `spv9.2.5.1` 的设置桥接、世界书局部更新、文件接口和 OpenAI-compatible 自定义 API 做过适配；`ST-Prompt-Template`（EJS 提示词模板）有原生兼容层。

已知边界：脚本本体及其依赖仍需联网加载；原生 Claude / Gemini 协议和酒馆连接管理器预设不是完整实现，建议使用本应用主 API 或 OpenAI-compatible 自定义接口。

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

Windows 上也可以直接双击 `run_server.bat`（构建并启动 Web 服务）或 `run.bat`（直接启动桌面端），脚本会自动检查 Node.js 并在缺少 `node_modules` 时安装依赖。

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
npm run desktop
```

该命令会先构建前端，再启动 Electron。桌面端会在本机启动内嵌服务（端口 `5191`），并提供更完整的能力：

- 选择和恢复电脑工作区，读取当前系统账户有权访问的任意目录
- 文件读写、搜索、移动与删除（工作区外变更按「完全访问」设置直接执行或逐次审批）
- 运行项目中已有的 npm script 和安全白名单命令（`npm`、`pnpm`、`yarn`、`node`、`git`）
- 查看 Git 状态与 Git diff，高风险 Git 操作（`reset`、`clean`、`push`、`rebase` 等）额外弹窗确认
- 侧栏浏览器（独立分区与 Cookie 配置）和基于 `node-pty` 的交互式终端
- 原生右键文本菜单、窗口吸附预览、硬件加速自动降级（Linux X11 + NVIDIA 默认关闭）

如果 Windows 环境无法在线下载 Electron Runtime，可以准备官方 Windows x64 运行时压缩包：

```text
electron-v42.4.1-win32-x64.zip
```

把它放在项目根目录，然后运行：

```powershell
npm run electron:install-local
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
.pi/sessions/                                     Pi 会话 JSONL
skills/                                           已导入的 Pi 原生 Skill
extensions/                                       已安装的酒馆扩展
session-images/                                   按会话存放的图片
```

可以通过 `RENGE_DATA_DIR` 修改数据目录：

```powershell
$env:RENGE_DATA_DIR = "D:\RengeData"
npm start
```

写入使用「原子替换 + 写入队列 + 备份轮转」：主文件损坏时自动回退到最近的可用备份。浏览器在后端持久化接口不可用时会退回 `localStorage`。供应商配置可能包含 API Key，因此不要把数据目录、浏览器配置或 `app-data.json` 上传到公开位置，也不要把 API Key 写入仓库文件。

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
| `RENGE_HARDWARE_ACCELERATION` | 自动 | `1` 强制启用，`0` 强制关闭 Electron 硬件加速；Linux X11 + NVIDIA 默认关闭 |
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
| `npm run desktop` / `npm run electron` | 构建并启动 Electron 桌面端 |
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
├─ run.bat                       Windows 桌面端快速启动
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
