# Pi 0.87.1 → 1.2.0 逐项兼容验收

验收日期：2026-10-15。适用对象：Renge 桌面／Node 服务；Android 兼容服务器不运行 Node Pi 插件，不属于本报告的原生插件运行承诺。

依据锁定的 @earendil-works/pi-coding-agent 1.2.0 发布包 CHANGELOG，覆盖 0.87.1 之后的 10 个发布版本、259 个列表条目（包含 New Features 与 Added 的重复概要）。没有把未发布的版本号补成记录，也没有将内核回退到每个旧版分别启动。这里验收的是每项变化在最终 1.2.0 宿主上的迁移影响。

来源：[官方源码仓库](https://github.com/earendil-works/pi/tree/v1.2.0/packages/coding-agent)、本机 node_modules/@earendil-works/pi-coding-agent/CHANGELOG.md。本机截取范围为文件开头至 0.87.1 标题之前，统一 LF。

source-sha256: b3383f7ac04966446ef2d6b8cd101f8d86404bd7ab3c9284b7a471d8e91f26ec

## 判定方法

| 状态 | 条目数 | 含义 |
|---|---:|---|
| T | 64 | 有本地可重复测试证据；具体覆盖范围见每行及证据索引 |
| S | 57 | 锁定 SDK／静态审查承接，未独立复现该条全部边界，不算实测通过 |
| E | 44 | 真实云服务／OAuth／计费场景待外部验收，不算实测通过 |
| N | 71 | SDK 嵌入应用不走此 CLI／终端路径，不是新增应用功能 |
| B | 23 | 明确产品或接口边界，不能声称完整兼容 |

T 不是云端效果、吞吐或上游宣称性能提升的保证；一个复杂条目只验了核心路径时，备注明确说明。S/E/B 不会因应用整体测试通过而自动转成 T。

## 本次修复

- 用 SDK 导出的工厂注册 builtin:codemode、builtin:tool-search、builtin:mcp；保留 defaultActive:false 与 settings.defaultTools。应用 UI 提供 mcpConfig 时仍用现有 pi-mcp-adapter，两个 MCP 引擎互斥，不重复连接。插件 registerMcpServer 与全局／受信任项目 mcp.json 由原生引擎处理；在旧适配器模式中不承诺这些原生配置生效。
- 原生 MCP 的配置、凭据、日志都使用传入的 agentDir；关闭所有工具时不启动原生 MCP。MCP config/OAuth store 的 3 个包内部模块访问封装在 pi/builtin-extensions.mjs，依赖精确锁定 1.2.0；升级内核必须重跑本验收。
- 扩展命令的 pi.sendMessage(triggerTurn:true) 启动模型后，HTTP 流等待会话空闲；保留系统提示并报告本轮真实 finish reason。before_agent_start 期间停止可阻止请求发往提供商。
- 嵌套工具不再借用后续同名顶层调用的预览 ID；保留 parentToolCallId、durationMs、structuredContent 与 agent_settled.aborted。前端保存和显示 SDK 记录耗时。
- 重载、替换、删除和关闭前派发并等待 session_shutdown；服务提供 dispose() 以便等待异步资源释放。移除 0.87 时代 isError 钩子，1.2 内核已原生处理普通和嵌套返回值。
- 追加输入经过 SDK 的输入转换与队列 API，返回 handled/queued 并保持应用输入 ID。文本主题补足 style/colors/appearance，仍不执行任意终端组件。

## 证据索引

| 代号 | 可重复证据／实现位置 |
|---|---|
| 本地协议、工具、生命周期、队列、模型、采样、图像、脚本、压缩 | test/piVersionMigration.test.mjs（每个 test 名含来源版本和实际断言） |
| 耗时及文本 UI | test/piExtensionCompatibilityBrowser.test.mjs；test/piExtensionCompatibility.test.mjs |
| 包管理、真实插件 | test/piPackageManager.test.mjs；test/piGptSearch.test.mjs；test/piGptWithTaste.test.mjs |
| MCP 旧适配器与 Electron | test/piMcpAdapterBridge.test.mjs；test/fixtures/mcp-electron-runtime.mjs |
| 新版协议的 Electron 实测 | test/piVersionElectron.test.mjs；test/fixtures/pi-migration-electron.mjs：在 Electron 内运行全部 16 项迁移协议测试 |
| 会话、Shell、压缩、重试、权限 | test/piHost.test.mjs；test/sessionRuntime.test.mjs；test/piShellRuntime.test.mjs；test/shellSessions.test.mjs；test/piSafetyRegression.test.mjs |
| SDK 静态项 | 锁定包 dist/core、dist/extensions、dist/utils 与 pi-ai/dist/api；细节仍以条目注明的未实测边界为准 |
| 清单完整性 | test/piReleaseAudit.test.mjs：源码摘要、版本顺序、每条唯一编号和全部原始发布条目一一对应 |

## 按版本验收

### 0.99.0（65 项）

| 编号 | 上游分类／变更摘要 | 判定 | 验收说明 |
|---|---|---|---|
| 0.99.0-01 | New Features：Codemode and MCP — Connect MCP servers and let models run JavaScript that calls tools in parallel. See MCP Servers and Enable codemode. | T 本地协议实测 | 原生 MCP／codemode 已接入宿主；测试覆盖基础调用，不等于每个第三方服务都通过。（上游行 330） |
| 0.99.0-02 | New Features：System theme — Pi's colors now come from your terminal's own palette by default. See Use your terminal's colors. | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 331） |
| 0.99.0-03 | New Features：Sign in with ChatGPT — Use a ChatGPT subscription with the OpenAI provider through /login openai. See Authenticate interactively. | B 提供商登录边界 | 应用主聊天只接 OpenAI 兼容 Chat Completions／Responses 渠道，未提供 Pi /login 模型选择界面。扩展可用 ModelRuntime；真实登录仍待验。（上游行 332） |
| 0.99.0-04 | New Features：Virtual models — Extensions can route each request to a different physical model. See Virtual Models. | T 模型接口实测 | 虚拟路由或图像／分类操作已用本地实现验证；未验证云端模型质量和计费。（上游行 333） |
| 0.99.0-05 | New Features：Classifier models — Run Jev classifiers from codemode scripts, or use any llama.cpp model as a classifier. See How codemode works and Classification. | E 外部服务待验 | 需要真实提供商、OAuth 服务器／账号或特定部署才能验证；本次没有用用户凭据进行在线登录、生成或计费请求。（上游行 334） |
| 0.99.0-06 | Added：Added codemode, tool search, and MCP support as built-in extensions. The codemode tool runs model-written JavaScript in a QuickJS sandbox that calls pi's tools; enable it with defaultTools or --tools and config… | T 本地协议实测 | 原生 MCP／codemode 已接入宿主；测试覆盖基础调用，不等于每个第三方服务都通过。（上游行 338） |
| 0.99.0-07 | Added：Added extension tool APIs for orchestrating tools: exposure (direct, model-only, codemode, deferred, or hidden), namespace, annotations, outputSchema with structuredContent, isError results, prepareLoadout(), a… | T 工具协议实测 | 嵌套调用、父子 ID、错误标志、结构化结果、usage、约束声明与 namespace aliases 已实测。（上游行 339） |
| 0.99.0-08 | Added：Added a warning when an extension that registers the same tool, command, or flag replaces a built-in extension (#10174 by @cristinaponcela). | S SDK 继承／静态核对 | 此项由锁定 SDK 承担，当前应用未改写该实现；未独立复现此项特定边界／性能案例。（上游行 340） |
| 0.99.0-09 | Added：Added experimental virtual models: extensions register them with pi.registerVirtualModel() and pick a physical model and thinking level for each request. The footer shows the routed model, /session lists cost p… | T 模型接口实测 | 虚拟路由或图像／分类操作已用本地实现验证；未验证云端模型质量和计费。（上游行 341） |
| 0.99.0-10 | Added：Added Sign in with ChatGPT to the OpenAI provider in /login, which uses a ChatGPT subscription with the OpenAI API. Pi stores a stable deviceId in the global settings for this login and omits it from bug report… | B 提供商登录边界 | 应用主聊天只接 OpenAI 兼容 Chat Completions／Responses 渠道，未提供 Pi /login 模型选择界面。扩展可用 ModelRuntime；真实登录仍待验。（上游行 342） |
| 0.99.0-11 | Added：Added the system theme, now the default, which derives pi's colors from the terminal's reported foreground, background, and ANSI palette and rebuilds them when the terminal switches between light and dark. See … | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 343） |
| 0.99.0-12 | Added：Added #rgb, oklch(), and okhsl() colors and an optional appearance field to theme files, and theme.style(), theme.colors, and theme.appearance for extensions. See Themes and TUI. | B 终端组件边界 | 完整 TUI factory／自定义工具 renderer 无网页等价实现；文本／标准对话框可用，不能声称完整 TUI 兼容。（上游行 344） |
| 0.99.0-13 | Added：Added a classifier model for every llama.cpp chat model, answered from next-token label probabilities. See Classification. | B llama.cpp 内置扩展边界 | 宿主未加载 CLI 的内置 llama.cpp 服务发现扩展；已有 OpenAI 兼容聊天渠道可用，但不自动发现本地决策模型，扩展可自行注册 classifier provider。（上游行 345） |
| 0.99.0-14 | Added：Added inherited Jev classifier models on OpenRouter, Cloudflare Workers AI, Vercel AI Gateway, and OpenCode Zen. | S 目录承接待复验 | 上游目录／提供商实现随锁定版本承接；应用聊天模型由用户渠道配置指定，未核验对应账号的可见目录或调用对应真实模型。（上游行 346） |
| 0.99.0-15 | Added：Added the fullscreenWheelScrollLines setting and /settings entry for fullscreen mouse-wheel scrolling. The default "auto" accelerates fast wheel spins outside local macOS terminals (#9758). | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 347） |
| 0.99.0-16 | Added：Added per-input disposition to successful RPC prompt, steer, and follow_up responses, AgentSession.steer()/followUp(), and RpcClient.prompt()/steer()/followUp(); RpcClient.prompt() also accepts streamingBehavio… | T 追加输入实测 | 应用走 SDK steer/followUp；输入转换／吞掉与 disposition、输入 ID 关联已实测。（上游行 348） |
| 0.99.0-17 | Added：Added image generation to ModelRuntime: generateImages() with runtime-resolved auth (stored credentials, OAuth, runtime API keys, models.json headers), plus getModelsOfType(), getModelOfType(), getAvailableOfTy… | T 模型接口实测 | 虚拟路由或图像／分类操作已用本地实现验证；未验证云端模型质量和计费。（上游行 349） |
| 0.99.0-18 | Added：Added classifier support to ModelRuntime, including classify(), classifier model accessors, runtime-resolved authentication, and the built-in TypeSafe jev-latest model. | T 模型接口实测 | 虚拟路由或图像／分类操作已用本地实现验证；未验证云端模型质量和计费。（上游行 350） |
| 0.99.0-19 | Added：Added types=chat,image,classifier to pi.dev model catalog requests so remote refreshes overlay every supported model type; entries of unknown model types are ignored. | S SDK 继承／静态核对 | 此项由锁定 SDK 承担，当前应用未改写该实现；未独立复现此项特定边界／性能案例。（上游行 351） |
| 0.99.0-20 | Added：Added the provider_stream_event extension event for observing parsed provider events before normalization, with an opt-in /debug-provider example viewer (#9784, #9901 by @davidbrai). | T 生命周期实测 | user/custom 启动、busy、取消、工具后系统提示保留、agent_settled 与 shutdown 已实测。（上游行 352） |
| 0.99.0-21 | Added：Added a show/hide toggle (H) in HTML exports for custom messages marked display: false. Messages remain hidden by default and can also be revealed from the sidebar (#8896, #10020 by @rwachtler). | N CLI 路径不适用 | 应用通过 Node SDK 嵌入，未启动 Pi CLI／print／全局安装器；该 CLI 变化不在应用执行路径。（上游行 353） |
| 0.99.0-22 | Added：Added inherited Claude Sonnet 5.5 support for Anthropic with adaptive thinking and a 1M context window. | S 目录承接待复验 | 上游目录／提供商实现随锁定版本承接；应用聊天模型由用户渠道配置指定，未核验对应账号的可见目录或调用对应真实模型。（上游行 354） |
| 0.99.0-23 | Added：Added a Built-in section in pi config to disable the built-in mcp, llama.cpp, codemode, and tool-search extensions globally or per project, stored as -builtin:<name> in the extensions setting. SDK inline extens… | N CLI 路径不适用 | 应用通过 Node SDK 嵌入，未启动 Pi CLI／print／全局安装器；该 CLI 变化不在应用执行路径。（上游行 355） |
| 0.99.0-24 | Added：Added +name and -name entries to the defaultTools setting to add or remove tools without repeating the defaults, for example "defaultTools": ["+codemode"]. Project entries of this form apply on top of the user … | T 本地协议实测 | 原生 MCP／codemode 已接入宿主；测试覆盖基础调用，不等于每个第三方服务都通过。（上游行 356） |
| 0.99.0-25 | Added：Added the token usage and cost of codemode models.classify() calls to the codemode tool result, so they count toward the session cost; the codemode result shows each call's cost. | E 外部服务待验 | 需要真实提供商、OAuth 服务器／账号或特定部署才能验证；本次没有用用户凭据进行在线登录、生成或计费请求。（上游行 357） |
| 0.99.0-26 | Changed：Switched the build from the TypeScript native preview to TypeScript 7.0 with an ES2024 target, and replaced tsx with Node's built-in type stripping for running from source (#9965). | N CLI 路径不适用 | 应用通过 Node SDK 嵌入，未启动 Pi CLI／print／全局安装器；该 CLI 变化不在应用执行路径。（上游行 361） |
| 0.99.0-27 | Changed：Removed the [Themes] section from the startup banner. Custom themes remain available in /settings, and theme conflicts are still reported. | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 362） |
| 0.99.0-28 | Changed：Changed the startup header to show the pi logo with the version instead of the app name. | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 363） |
| 0.99.0-29 | Changed：Changed the built-in dark and light themes to the revised pi colors, written in OKHSL. | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 364） |
| 0.99.0-30 | Changed：Changed light/dark terminal detection to use the reported background color first, then the terminal's light/dark report, then COLORFGBG. The first-time setup no longer shows the detected appearance. | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 365） |
| 0.99.0-31 | Changed：Renamed the inherited OpenAI Codex provider to "OpenAI Codex (legacy)"; Sign in with ChatGPT on the OpenAI provider supersedes it. | B 提供商登录边界 | 应用主聊天只接 OpenAI 兼容 Chat Completions／Responses 渠道，未提供 Pi /login 模型选择界面。扩展可用 ModelRuntime；真实登录仍待验。（上游行 366） |
| 0.99.0-32 | Changed：Changed inherited terminal detection to treat TERM=*-direct as truecolor. | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 367） |
| 0.99.0-33 | Changed：Built-in extensions and tools are named builtin:<name> (for example builtin:mcp and builtin:read) in errors, diagnostics, RPC source info, and bug reports, instead of <inline:name> and <builtin:name>. Their sla… | S SDK 继承／静态核对 | 此项由锁定 SDK 承担，当前应用未改写该实现；未独立复现此项特定边界／性能案例。（上游行 368） |
| 0.99.0-34 | Changed：--no-extensions also disables the built-in extensions, including the llama.cpp provider. Load one explicitly with -e builtin:<name>, for example pi -ne -e builtin:mcp. | N CLI 路径不适用 | 应用通过 Node SDK 嵌入，未启动 Pi CLI／print／全局安装器；该 CLI 变化不在应用执行路径。（上游行 369） |
| 0.99.0-35 | Changed：Tool calls without a custom call renderer, including direct MCP tool calls, now show their arguments: as key=value pairs on the title line when collapsed and one key: value line per argument when expanded. MCP … | B 前端展示边界 | 应用用自己的参数／结果组件；保留底层工具 API，不执行 Pi 自定义 TUI renderer，也不承诺相同折叠高度。（上游行 370） |
| 0.99.0-36 | Changed：bash and powershell structured results, which codemode scripts receive, now hold up to 1 MiB of output instead of the model-facing 2000 lines or 50KB, and add truncated and full_output_path. Longer output keeps… | T Shell 回归 | 保留 SDK 新结构化结果；非零退出 isError、后台轮询和运行中取消由现有测试验证。（上游行 371） |
| 0.99.0-37 | Fixed：Fixed X11 clipboard text being misidentified as an image when the clipboard owner accepts unadvertised image targets (#9786). | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 375） |
| 0.99.0-38 | Fixed：Prevented managed git packages from automatically installing Pi peer dependencies and added warnings for extension packages that list host-provided modules in dependencies (#9863). | S SDK 继承／静态核对 | 此项由锁定 SDK 承担，当前应用未改写该实现；未独立复现此项特定边界／性能案例。（上游行 376） |
| 0.99.0-39 | Fixed：Fixed pinned git extensions loaded with -e continuing to use the first downloaded commit after the ref changes (#9982). | S SDK 继承／静态核对 | 此项由锁定 SDK 承担，当前应用未改写该实现；未独立复现此项特定边界／性能案例。（上游行 377） |
| 0.99.0-40 | Fixed：Fixed RpcClient skipping the next event listener when a listener unsubscribes while handling an event, which could make waitForIdle() time out after collectEvents() (#9990). | S SDK 继承／静态核对 | 此项由锁定 SDK 承担，当前应用未改写该实现；未独立复现此项特定边界／性能案例。（上游行 378） |
| 0.99.0-41 | Fixed：Fixed full-file read calls rendering as :1 when models send null for omitted offset and limit (#9996). | B 前端展示边界 | 应用用自己的参数／结果组件；保留底层工具 API，不执行 Pi 自定义 TUI renderer，也不承诺相同折叠高度。（上游行 379） |
| 0.99.0-42 | Fixed：Fixed new sessions being lost when pi exits before the first assistant response. The session file is now created when the first user message is sent (#10000). | T 会话回归 | 宿主 SessionManager 持久化与停止、并发、历史恢复测试；未复现每个上游性能场景。（上游行 380） |
| 0.99.0-43 | Fixed：Fixed unloaded llama.cpp autoload presets overwriting a cached runtime context window with the GGUF training context (#10077, #10158 by @cristinaponcela). | S 目录承接待复验 | 上游目录／提供商实现随锁定版本承接；应用聊天模型由用户渠道配置指定，未核验对应账号的可见目录或调用对应真实模型。（上游行 381） |
| 0.99.0-44 | Fixed：Fixed custom themes ignoring terminal.trueColor and other terminal capability overrides and rendering with 256 colors (#9973, #10039 by @christianklotz). | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 382） |
| 0.99.0-45 | Fixed：Fixed pasting files copied in Finder inserting the file icon image instead of the file paths; paths are quoted in bash mode (#9999, #10136 by @christianklotz). | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 383） |
| 0.99.0-46 | Fixed：Fixed the startup header, loaded resources, and chat notices keeping their old colors after a theme change. | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 384） |
| 0.99.0-47 | Fixed：Fixed the Fireworks default model pointing at the removed Kimi K2.6 model; it now defaults to Kimi K3. | S 目录承接待复验 | 上游目录／提供商实现随锁定版本承接；应用聊天模型由用户渠道配置指定，未核验对应账号的可见目录或调用对应真实模型。（上游行 385） |
| 0.99.0-48 | Fixed：Fixed the OpenCode Go default model pointing at the removed Kimi K2.6 model; it now defaults to Kimi K3. | S 目录承接待复验 | 上游目录／提供商实现随锁定版本承接；应用聊天模型由用户渠道配置指定，未核验对应账号的可见目录或调用对应真实模型。（上游行 386） |
| 0.99.0-49 | Fixed：Fixed the Together default model pointing at the removed Kimi K2.6 model; it now defaults to Kimi K3. | S 目录承接待复验 | 上游目录／提供商实现随锁定版本承接；应用聊天模型由用户渠道配置指定，未核验对应账号的可见目录或调用对应真实模型。（上游行 387） |
| 0.99.0-50 | Fixed：Reduced CPU use while streaming in long sessions and when previewing themes: the footer caches session usage totals, collapsed bash results cache their preview, and sanitizeBinaryOutput() no longer splits outpu… | S SDK 继承／静态核对 | 此项由锁定 SDK 承担，当前应用未改写该实现；未独立复现此项特定边界／性能案例。（上游行 388） |
| 0.99.0-51 | Fixed：Fixed the usage of tools called through ctx.executeTool(), for example from codemode scripts, being dropped from the session cost; it is now added to the calling tool's result usage. | T 工具协议实测 | 嵌套调用、父子 ID、错误标志、结构化结果、usage、约束声明与 namespace aliases 已实测。（上游行 389） |
| 0.99.0-52 | Fixed：Fixed inherited /skill autocomplete appearing empty when loaded skill names did not contain the letters in skill (#9944). | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 390） |
| 0.99.0-53 | Fixed：Fixed inherited path and @ autocomplete not working after opening wrappers such as (, [, {, <, or a backtick. | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 391） |
| 0.99.0-54 | Fixed：Fixed inherited image stretching in terminals that use the Kitty graphics protocol (#8938, #9957 by @rwachtler). | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 392） |
| 0.99.0-55 | Fixed：Fixed inherited shell cursor staying hidden after exit when an extension closed an overlay during shutdown (#10026). | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 393） |
| 0.99.0-56 | Fixed：Fixed inherited keyboard input being lost after a mouse click in a /settings submenu closed it. | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 394） |
| 0.99.0-57 | Fixed：Fixed inherited 1-hour Anthropic cache writes through Vercel AI Gateway being priced at the 5-minute rate (#9210). | E 外部服务待验 | 需要真实提供商、OAuth 服务器／账号或特定部署才能验证；本次没有用用户凭据进行在线登录、生成或计费请求。（上游行 395） |
| 0.99.0-58 | Fixed：Fixed inherited model-level samplingParams being dropped by direct stream()/complete() calls on OpenAI-compatible APIs (#9506). | T 采样实测 | ModelRuntime 本地 HTTP 请求确认基础 samplingParams 和 high 覆盖值。（上游行 396） |
| 0.99.0-59 | Fixed：Fixed inherited Mistral GLM requests failing with "Expected at most one leading ThinkChunk" after empty content deltas (#9674). | E 外部服务待验 | 需要真实提供商、OAuth 服务器／账号或特定部署才能验证；本次没有用用户凭据进行在线登录、生成或计费请求。（上游行 397） |
| 0.99.0-60 | Fixed：Fixed inherited OpenAI Fast mode requests being priced at the standard rate (#10034). | E 外部服务待验 | 需要真实提供商、OAuth 服务器／账号或特定部署才能验证；本次没有用用户凭据进行在线登录、生成或计费请求。（上游行 398） |
| 0.99.0-61 | Fixed：Fixed inherited Mistral reasoning models ignoring the requested thinking level (#9678). | E 外部服务待验 | 需要真实提供商、OAuth 服务器／账号或特定部署才能验证；本次没有用用户凭据进行在线登录、生成或计费请求。（上游行 399） |
| 0.99.0-62 | Fixed：Fixed inherited OpenCode Zen and OpenCode Go qwen3.8-flash thinking being replayed as plain text on later turns (#10047). | E 外部服务待验 | 需要真实提供商、OAuth 服务器／账号或特定部署才能验证；本次没有用用户凭据进行在线登录、生成或计费请求。（上游行 400） |
| 0.99.0-63 | Fixed：Fixed inherited OpenAI Responses streams from servers that omit output_index, such as llama.cpp, running mixed-up tool calls; such streams now end with an error (#9974). | E 外部服务待验 | 需要真实提供商、OAuth 服务器／账号或特定部署才能验证；本次没有用用户凭据进行在线登录、生成或计费请求。（上游行 401） |
| 0.99.0-64 | Fixed：Fixed inherited Anthropic and OpenAI Codex browser sign-in waiting indefinitely after the provider redirected with an authorization error, and Anthropic sign-in failing when its callback port is in use. | B 提供商登录边界 | 应用主聊天只接 OpenAI 兼容 Chat Completions／Responses 渠道，未提供 Pi /login 模型选择界面。扩展可用 ModelRuntime；真实登录仍待验。（上游行 402） |
| 0.99.0-65 | Fixed：Fixed inherited GitHub Copilot Claude Opus 5.5 offering unsupported thinking levels when upstream model metadata is incomplete. | S 目录承接待复验 | 上游目录／提供商实现随锁定版本承接；应用聊天模型由用户渠道配置指定，未核验对应账号的可见目录或调用对应真实模型。（上游行 403） |

### 0.99.1（4 项）

| 编号 | 上游分类／变更摘要 | 判定 | 验收说明 |
|---|---|---|---|
| 0.99.1-01 | New Features：GPT-6.1 Sol — Available on OpenAI, Azure OpenAI, and OpenAI Codex, and now the default OpenAI Codex model. See Select a model. | S 目录承接待复验 | 上游目录／提供商实现随锁定版本承接；应用聊天模型由用户渠道配置指定，未核验对应账号的可见目录或调用对应真实模型。（上游行 312） |
| 0.99.1-02 | Added：Added GPT-6.1 Sol (gpt-6.1-sol) to the OpenAI, Azure OpenAI Responses, and OpenAI Codex providers. | S 目录承接待复验 | 上游目录／提供商实现随锁定版本承接；应用聊天模型由用户渠道配置指定，未核验对应账号的可见目录或调用对应真实模型。（上游行 316） |
| 0.99.1-03 | Changed：Changed the default OpenAI Codex model to GPT-6.1 Sol (gpt-6.1-sol). | S 目录承接待复验 | 上游目录／提供商实现随锁定版本承接；应用聊天模型由用户渠道配置指定，未核验对应账号的可见目录或调用对应真实模型。（上游行 320） |
| 0.99.1-04 | Fixed：Fixed /login with OpenAI failing in the bundled release with a missing openai-chatgpt.js module error. | B 提供商登录边界 | 应用主聊天只接 OpenAI 兼容 Chat Completions／Responses 渠道，未提供 Pi /login 模型选择界面。扩展可用 ModelRuntime；真实登录仍待验。（上游行 324） |

### 0.99.2（26 项）

| 编号 | 上游分类／变更摘要 | 判定 | 验收说明 |
|---|---|---|---|
| 0.99.2-01 | New Features：MCP servers stay out of the way: servers with the default codemode exposure are no longer listed in the codemode description and no longer block the first prompt. They appear in a short system prompt section, a… | T 本地协议实测 | 原生 MCP／codemode 已接入宿主；测试覆盖基础调用，不等于每个第三方服务都通过。（上游行 272） |
| 0.99.2-02 | New Features：More MCP authentication options: oauth.clientName for servers that only accept known OAuth clients, and "auth": { "provider": "<provider>" } to authenticate HTTP servers with a provider's /login token. See Auth… | E 外部服务待验 | 需要真实提供商、OAuth 服务器／账号或特定部署才能验证；本次没有用用户凭据进行在线登录、生成或计费请求。（上游行 273） |
| 0.99.2-03 | New Features：Anthropic workload identity federation from the Anthropic SDK environment variables. See Use an API key from the environment. | E 外部服务待验 | 需要真实提供商、OAuth 服务器／账号或特定部署才能验证；本次没有用用户凭据进行在线登录、生成或计费请求。（上游行 274） |
| 0.99.2-04 | New Features：/reload enables tools newly added to the defaultTools setting. See Tools. | T 工具协议实测 | 嵌套调用、父子 ID、错误标志、结构化结果、usage、约束声明与 namespace aliases 已实测。（上游行 275） |
| 0.99.2-05 | Added：Added a description field for MCP servers (pi mcp add --description), shown with the server in the system prompt and used to rank its tools in tool search, and a describeNamespace(name) codemode helper that ret… | T 本地协议实测 | 原生 MCP／codemode 已接入宿主；测试覆盖基础调用，不等于每个第三方服务都通过。（上游行 279） |
| 0.99.2-06 | Added：Added an oauth.clientName setting for MCP servers (pi mcp add --oauth-client-name) to change the client name sent during OAuth client registration, for servers that only accept known clients (#10226). | E 外部服务待验 | 需要真实提供商、OAuth 服务器／账号或特定部署才能验证；本次没有用用户凭据进行在线登录、生成或计费请求。（上游行 280） |
| 0.99.2-07 | Added：Added "auth": { "provider": "<provider>" } for HTTP MCP servers to send a provider's current /login token as the bearer token instead of using MCP OAuth. The token is read on every request, so provider refreshe… | E 外部服务待验 | 需要真实提供商、OAuth 服务器／账号或特定部署才能验证；本次没有用用户凭据进行在线登录、生成或计费请求。（上游行 281） |
| 0.99.2-08 | Added：Added Anthropic workload identity federation from the ANTHROPIC_FEDERATION_RULE_ID, ANTHROPIC_ORGANIZATION_ID, and ANTHROPIC_IDENTITY_TOKEN_FILE environment variables (see Providers) (#10177, #10242 by @philfre… | E 外部服务待验 | 需要真实提供商、OAuth 服务器／账号或特定部署才能验证；本次没有用用户凭据进行在线登录、生成或计费请求。（上游行 282） |
| 0.99.2-09 | Added：/reload now enables tools newly added to the defaultTools setting. Tools removed from it stay enabled, tools turned off during the session stay off unless newly added, and --tools, --no-tools, and --no-builtin-… | T 工具协议实测 | 嵌套调用、父子 ID、错误标志、结构化结果、usage、约束声明与 namespace aliases 已实测。（上游行 283） |
| 0.99.2-10 | Changed：MCP servers with the default codemode exposure no longer appear in the codemode description; scripts find them with searchTools(). codemode-deferred is now an alias for codemode. Use direct exposure for tools t… | T 本地协议实测 | 原生 MCP／codemode 已接入宿主；测试覆盖基础调用，不等于每个第三方服务都通过。（上游行 287） |
| 0.99.2-11 | Changed：The codemode description no longer includes deferred tools, tool counts, or MCP server instructions, so it no longer changes when MCP servers connect or change their tools. The tool_search description no longer… | T 本地协议实测 | 原生 MCP／codemode 已接入宿主；测试覆盖基础调用，不等于每个第三方服务都通过。（上游行 288） |
| 0.99.2-12 | Changed：The first prompt no longer waits for MCP servers without direct tools. They connect in the background and are waited for when a codemode script names them, a script searches tools, or tool_search runs (#10212). | T 本地协议实测 | 原生 MCP／codemode 已接入宿主；测试覆盖基础调用，不等于每个第三方服务都通过。（上游行 289） |
| 0.99.2-13 | Fixed：Fixed new sessions intermittently ignoring the saved default model, or warning that no models are available, when it belongs to an extension-registered native provider with a stored credential (#9962, #10190 by… | S SDK 继承／静态核对 | 此项由锁定 SDK 承担，当前应用未改写该实现；未独立复现此项特定边界／性能案例。（上游行 293） |
| 0.99.2-14 | Fixed：Fixed the /mcp sign-in URL not being clickable when it wraps across lines, by emitting it as a terminal hyperlink with a Cmd/Ctrl+click to open line like /login (#10186). | T 文本界面回归 | OSC8 链接转换、隐藏消息与文本工具结果已有单元／浏览器回归。（上游行 294） |
| 0.99.2-15 | Fixed：Fixed codemode image() accepting malformed base64 data or unsupported image types, which persisted an invalid image block that made every later provider request fail with HTTP 400 (#10215). | T 脚本图像实测 | read → codemode image、非法图像拒绝及输出文件提示已实测；未逐一测所有图像格式。（上游行 295） |
| 0.99.2-16 | Fixed：Fixed codemode failing to start its script worker from the standalone Windows executable (#10204). | N CLI 路径不适用 | 应用通过 Node SDK 嵌入，未启动 Pi CLI／print／全局安装器；该 CLI 变化不在应用执行路径。（上游行 296） |
| 0.99.2-17 | Fixed：Fixed prompt submission slowing down with session length, because resolving the session's model selection looked up the model catalog once per assistant message (#10198). | S SDK 继承／静态核对 | 此项由锁定 SDK 承担，当前应用未改写该实现；未独立复现此项特定边界／性能案例。（上游行 297） |
| 0.99.2-18 | Fixed：Fixed model lookups slowing down for providers with a refreshed pi.dev catalog, because merging remote catalog models took quadratic time. | S SDK 继承／静态核对 | 此项由锁定 SDK 承担，当前应用未改写该实现；未独立复现此项特定边界／性能案例。（上游行 298） |
| 0.99.2-19 | Fixed：Fixed the built-in-tool-renderer.ts and minimal-mode.ts extension examples removing the built-in tools' summaries and guidelines from the system prompt (#10072, #10193 by @christianklotz). | S SDK 继承／静态核对 | 此项由锁定 SDK 承担，当前应用未改写该实现；未独立复现此项特定边界／性能案例。（上游行 299） |
| 0.99.2-20 | Fixed：Fixed context overflow detection for Z.AI CN endpoint Prompt exceeds max length errors (#10208). | S SDK 继承／静态核对 | 此项由锁定 SDK 承担，当前应用未改写该实现；未独立复现此项特定边界／性能案例。（上游行 300） |
| 0.99.2-21 | Fixed：Fixed Anthropic requests failing when a tool schema uses keywords Anthropic strict tool use rejects, such as minimum/maximum; such tools are now sent non-strict (#9953). | E 外部服务待验 | 需要真实提供商、OAuth 服务器／账号或特定部署才能验证；本次没有用用户凭据进行在线登录、生成或计费请求。（上游行 301） |
| 0.99.2-22 | Fixed：Fixed provider retries firing immediately when a Retry-After header contains an unparseable date; they now use exponential backoff (#9571). | E 外部服务待验 | 需要真实提供商、OAuth 服务器／账号或特定部署才能验证；本次没有用用户凭据进行在线登录、生成或计费请求。（上游行 302） |
| 0.99.2-23 | Fixed：Fixed extension commands registered without a string name or handler crashing pi when typing /; the extension now fails to load with an error instead (#10054). | T 包管理回归 | 现有安装／禁用／更新测试及两款实际插件安装、加载、指令执行通过；未重新发布上游包。（上游行 303） |
| 0.99.2-24 | Fixed：Fixed collapsed codemode and MCP tool results filling the screen when the output is one long line, such as minified JSON. Like bash output, the preview is now limited to wrapped lines instead of logical lines. | B 前端展示边界 | 应用用自己的参数／结果组件；保留底层工具 API，不执行 Pi 自定义 TUI renderer，也不承诺相同折叠高度。（上游行 304） |
| 0.99.2-25 | Fixed：Fixed codemode.mode: "only" listing read, bash, edit, and write in the system prompt's tool list although requests only declare codemode (#10192). | T 工具协议实测 | 嵌套调用、父子 ID、错误标志、结构化结果、usage、约束声明与 namespace aliases 已实测。（上游行 305） |
| 0.99.2-26 | Fixed：Fixed codemode scripts calling the wrong MCP tool when two tool names differ only in - and _, such as read-file and read_file. Like in Codex, MCP tool and namespace names now replace - with _ (mcp__my-server__x… | T 本地协议实测 | 原生 MCP／codemode 已接入宿主；测试覆盖基础调用，不等于每个第三方服务都通过。（上游行 306） |

### 1.0.0（32 项）

| 编号 | 上游分类／变更摘要 | 判定 | 验收说明 |
|---|---|---|---|
| 1.0.0-01 | New Features：Fullscreen by default — The TUI now runs fullscreen. Set tuiMode to "regular" to keep the terminal's normal scrollback. See Terminal and display. | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 226） |
| 1.0.0-02 | New Features：Leaner codemode — About 40% fewer prompt tokens, and errors that tell the model how to recover. See Codemode. | S SDK 继承／静态核对 | 此项由锁定 SDK 承担，当前应用未改写该实现；未独立复现此项特定边界／性能案例。（上游行 227） |
| 1.0.0-03 | New Features：Image generation in codemode — Scripts call models.generateImages() with the session's credentials. See Generate images and Use image models. | T 模型接口实测 | 虚拟路由或图像／分类操作已用本地实现验证；未验证云端模型质量和计费。（上游行 228） |
| 1.0.0-04 | New Features：Radius in /login — Sign in with Radius and set up its MCP server in one step. See Radius. | B 提供商登录边界 | 应用主聊天只接 OpenAI 兼容 Chat Completions／Responses 渠道，未提供 Pi /login 模型选择界面。扩展可用 ModelRuntime；真实登录仍待验。（上游行 229） |
| 1.0.0-05 | New Features：Anthropic copy code login — Sign in when the browser runs on another machine. See Authenticate interactively. | B 提供商登录边界 | 应用主聊天只接 OpenAI 兼容 Chat Completions／Responses 渠道，未提供 Pi /login 模型选择界面。扩展可用 ModelRuntime；真实登录仍待验。（上游行 230） |
| 1.0.0-06 | New Features：MCP OAuth hardening — oauth.authServerMetadataUrl, RFC 9207 iss checks, credentials per server, and step-up sign-in that keeps granted scopes. See Authenticate with OAuth. | E 外部服务待验 | 需要真实提供商、OAuth 服务器／账号或特定部署才能验证；本次没有用用户凭据进行在线登录、生成或计费请求。（上游行 231） |
| 1.0.0-07 | New Features：Header-only quiet startup — quietStartup: "header" keeps the version and key hints and hides the rest. See Terminal and display. | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 232） |
| 1.0.0-08 | Added：Added an oauth.authServerMetadataUrl setting for MCP servers that advertise a wrong OAuth authorization server or none. Pi uses the configured metadata document instead of discovery (#10172). | E 外部服务待验 | 需要真实提供商、OAuth 服务器／账号或特定部署才能验证；本次没有用用户凭据进行在线登录、生成或计费请求。（上游行 236） |
| 1.0.0-09 | Added：Added quietStartup: "header", which keeps the startup header with version and key hints but hides the model scope line and loaded-resource listing. | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 237） |
| 1.0.0-10 | Added：Added models.generateImages() to codemode scripts. It runs image models such as OpenRouter's with the session's credentials and returns base64 image blocks that image() attaches to the result; usage counts towa… | T 模型接口实测 | 虚拟路由或图像／分类操作已用本地实现验证；未验证云端模型质量和计费。（上游行 238） |
| 1.0.0-11 | Added：Added a copy code login method to Anthropic /login for headless setups where the browser runs on another machine (#10194 by @lucasmeijer). | B 提供商登录边界 | 应用主聊天只接 OpenAI 兼容 Chat Completions／Responses 渠道，未提供 Pi /login 模型选择界面。扩展可用 ModelRuntime；真实登录仍待验。（上游行 239） |
| 1.0.0-12 | Changed：Changed the default TUI mode to fullscreen. Set tuiMode to "regular" or pass --tui-mode regular to keep the terminal's normal scrollback. | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 243） |
| 1.0.0-13 | Changed：/login now offers "Sign in with Radius" at the top level, as the last option, with its status. After a Radius sign-in, /login offers to configure the Radius MCP server in the global mcp.json with "auth": { "pro… | B 提供商登录边界 | 应用主聊天只接 OpenAI 兼容 Chat Completions／Responses 渠道，未提供 Pi /login 模型选择界面。扩展可用 ModelRuntime；真实登录仍待验。（上游行 244） |
| 1.0.0-14 | Changed：The provider docs page is renamed to Providers, its "Cloud Providers" section is now "Provider Specific Config", and it documents Radius first. | S SDK 继承／静态核对 | 此项由锁定 SDK 承担，当前应用未改写该实现；未独立复现此项特定边界／性能案例。（上游行 245） |
| 1.0.0-15 | Changed：MCP OAuth credentials are now stored per server name and URL, so MCP servers with the same URL can sign in with different accounts. Credentials stored by URL alone move to the first server that uses them (#1025… | E 外部服务待验 | 需要真实提供商、OAuth 服务器／账号或特定部署才能验证；本次没有用用户凭据进行在线登录、生成或计费请求。（上游行 246） |
| 1.0.0-16 | Changed：Codemode costs far fewer prompt tokens: with the default tools and codemode active, a GPT-5.6 request shrinks from about 5,300 to 3,300 tokens. The codemode description lists the script globals in one line each… | S SDK 继承／静态核对 | 此项由锁定 SDK 承担，当前应用未改写该实现；未独立复现此项特定边界／性能案例。（上游行 247） |
| 1.0.0-17 | Changed：Codemode errors now say how to recover: reading a tool or models member that does not exist names the close matches (tools.Bash suggests tools.bash), models.classify() and models.generateImages() reject malform… | T 脚本输出实测 | 非首行 @options 拒绝、文本分隔、冻结内建对象与后续脚本可继续运行已实测。（上游行 248） |
| 1.0.0-18 | Changed：/login and /logout now label providers without credentials as "not configured" instead of "unconfigured". | B 提供商登录边界 | 应用主聊天只接 OpenAI 兼容 Chat Completions／Responses 渠道，未提供 Pi /login 模型选择界面。扩展可用 ModelRuntime；真实登录仍待验。（上游行 249） |
| 1.0.0-19 | Changed：OAuth browser pages now show the color Pi logo. | B 提供商登录边界 | 应用主聊天只接 OpenAI 兼容 Chat Completions／Responses 渠道，未提供 Pi /login 模型选择界面。扩展可用 ModelRuntime；真实登录仍待验。（上游行 250） |
| 1.0.0-20 | Fixed：Fixed MCP OAuth sign-in accepting an authorization response whose iss parameter names another authorization server; the code is now rejected before it is exchanged (RFC 9207). | E 外部服务待验 | 需要真实提供商、OAuth 服务器／账号或特定部署才能验证；本次没有用用户凭据进行在线登录、生成或计费请求。（上游行 254） |
| 1.0.0-21 | Fixed：Fixed MCP OAuth sign-in failing with Invalid scope when the token response contains "scope": "", and similar failures for other empty or null optional OAuth fields (#10266). | E 外部服务待验 | 需要真实提供商、OAuth 服务器／账号或特定部署才能验证；本次没有用用户凭据进行在线登录、生成或计费请求。（上游行 255） |
| 1.0.0-22 | Fixed：Fixed the sign-in URL printed by /mcp login not being clickable when it wraps (#10186). | T 文本界面回归 | OSC8 链接转换、隐藏消息与文本工具结果已有单元／浏览器回归。（上游行 256） |
| 1.0.0-23 | Fixed：Fixed --provider without --model being silently ignored and running the default model from another provider; it now fails with an error (#10236). | N CLI 路径不适用 | 应用通过 Node SDK 嵌入，未启动 Pi CLI／print／全局安装器；该 CLI 变化不在应用执行路径。（上游行 257） |
| 1.0.0-24 | Fixed：Fixed MCP servers that ask for more scope (insufficient_scope) requesting sign-in over and over. The new sign-in requested only the missing scopes, so the new token lost access the previous one had; it now keep… | E 外部服务待验 | 需要真实提供商、OAuth 服务器／账号或特定部署才能验证；本次没有用用户凭据进行在线登录、生成或计费请求。（上游行 258） |
| 1.0.0-25 | Fixed：Fixed user messages in the transcript keeping two full-width copies of every rendered line; they keep one, with identical output. | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 259） |
| 1.0.0-26 | Fixed：Fixed /login and /logout labeling every OAuth sign-in, including Radius, as a subscription; only subscription-backed providers say "subscription", other OAuth sign-ins say "account". | B 提供商登录边界 | 应用主聊天只接 OpenAI 兼容 Chat Completions／Responses 渠道，未提供 Pi /login 模型选择界面。扩展可用 ModelRuntime；真实登录仍待验。（上游行 260） |
| 1.0.0-27 | Fixed：Fixed the startup header logo rendering with gaps in Apple Terminal; it now shows a colored "Pi" with the version instead. | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 261） |
| 1.0.0-28 | Fixed：Fixed deferred MCP tools that tool_search loaded being dropped on resume and /reload even when their server reconnected before the next prompt, because the session restored its tools before the MCP servers reco… | S SDK 继承／静态核对 | 此项由锁定 SDK 承担，当前应用未改写该实现；未独立复现此项特定边界／性能案例。（上游行 262） |
| 1.0.0-29 | Fixed：Fixed the system theme making pastel palettes such as Catppuccin Frappe much more vivid; palette colors now keep their chroma (#10255, #10293 by @dgtlntv). | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 263） |
| 1.0.0-30 | Fixed：Fixed slash command autocompletion not triggering when the input starts with whitespace (#10218 by @haoqixu). | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 264） |
| 1.0.0-31 | Fixed：Fixed color bleeding past mouse selections and search highlights in fullscreen mode when a styled token ends at the highlight boundary (#10169). | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 265） |
| 1.0.0-32 | Fixed：Fixed memory retained per rendered message in the transcript; a long assistant message keeps about a fifth of the heap it kept before. | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 266） |

### 1.0.1（27 项）

| 编号 | 上游分类／变更摘要 | 判定 | 验收说明 |
|---|---|---|---|
| 1.0.1-01 | New Features：Nix flake — nix run github:earendil-works/pi/stable runs the latest release, and nix profile add github:earendil-works/pi/stable installs it. See Install pi. | N CLI 路径不适用 | 应用通过 Node SDK 嵌入，未启动 Pi CLI／print／全局安装器；该 CLI 变化不在应用执行路径。（上游行 182） |
| 1.0.1-02 | New Features：Project overrides for MCP servers — .pi/mcp.json and /mcp can enable, disable, or change the exposure of a user-level server for one project. See Configure servers. | T 本地协议实测 | 原生 MCP／codemode 已接入宿主；测试覆盖基础调用，不等于每个第三方服务都通过。（上游行 183） |
| 1.0.1-03 | New Features：MCP Client ID Metadata Documents — oauth.clientRegistration: "cimd" lets authorization servers allow pi by its document URL instead of dynamic registration. See Authenticate with OAuth. | E 外部服务待验 | 需要真实提供商、OAuth 服务器／账号或特定部署才能验证；本次没有用用户凭据进行在线登录、生成或计费请求。（上游行 184） |
| 1.0.1-04 | New Features：Tool renderers for any tool — pi.registerToolRenderer() draws calls to tools that are not registered yet, such as MCP tools in resumed sessions. See Tool rendering. | B 终端组件边界 | 完整 TUI factory／自定义工具 renderer 无网页等价实现；文本／标准对话框可用，不能声称完整 TUI 兼容。（上游行 185） |
| 1.0.1-05 | New Features：Cloudflare Clef classifiers — @cf/cloudflare/clef and @cf/cloudflare/clef-flash are usable from codemode scripts and extensions. See Use classifier models. | S 目录承接待复验 | 上游目录／提供商实现随锁定版本承接；应用聊天模型由用户渠道配置指定，未核验对应账号的可见目录或调用对应真实模型。（上游行 186） |
| 1.0.1-06 | Added：Added a copy key (app.message.copy, default ctrl+x) to OAuth sign-in screens in /login, /mcp, and /mcp login, which copies the sign-in URL when the browser cannot be opened or the wrapped link cannot be selecte… | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 190） |
| 1.0.1-07 | Added：Added oauth.clientRegistration: "cimd" for MCP servers, which identifies pi with its Client ID Metadata Document on pi.dev instead of dynamic client registration, so authorization servers can allow pi by URL (#… | E 外部服务待验 | 需要真实提供商、OAuth 服务器／账号或特定部署才能验证；本次没有用用户凭据进行在线登录、生成或计费请求。（上游行 191） |
| 1.0.1-08 | Added：Added project overrides for user-level MCP servers: a .pi/mcp.json entry without command or url sets only enabled, exposure, and toolExposure of the user-level server, and /mcp can enable or disable a server fo… | T 本地协议实测 | 原生 MCP／codemode 已接入宿主；测试覆盖基础调用，不等于每个第三方服务都通过。（上游行 192） |
| 1.0.1-09 | Added：Added Cloudflare's Clef and Clef Flash classifier models to cloudflare-workers-ai, usable from codemode scripts and extensions (#10316 by @ndisidore, #10322 by @RealAlexandreAI) | S 目录承接待复验 | 上游目录／提供商实现随锁定版本承接；应用聊天模型由用户渠道配置指定，未核验对应账号的可见目录或调用对应真实模型。（上游行 193） |
| 1.0.1-10 | Added：Added pi.registerToolRenderer(), which chooses how calls to a tool are drawn, including tools that are not registered (#10285) | B 终端组件边界 | 完整 TUI factory／自定义工具 renderer 无网页等价实现；文本／标准对话框可用，不能声称完整 TUI 兼容。（上游行 194） |
| 1.0.1-11 | Added：Added a Nix flake for macOS and Linux: nix run github:earendil-works/pi/stable runs the latest release, and nix profile add github:earendil-works/pi/stable installs it. See Install pi (#9137) | N CLI 路径不适用 | 应用通过 Node SDK 嵌入，未启动 Pi CLI／print／全局安装器；该 CLI 变化不在应用执行路径。（上游行 195） |
| 1.0.1-12 | Changed：pi update on global npm installations now recommends migrating to the managed installation from the pi.dev installer, which pins all dependencies. | N CLI 路径不适用 | 应用通过 Node SDK 嵌入，未启动 Pi CLI／print／全局安装器；该 CLI 变化不在应用执行路径。（上游行 199） |
| 1.0.1-13 | Changed：Anthropic tools added or redefined mid-conversation are now defined inline in the conversation, so redefining a tool under the same name keeps the prompt cache instead of resending the full tool list. | E 外部服务待验 | 需要真实提供商、OAuth 服务器／账号或特定部署才能验证；本次没有用用户凭据进行在线登录、生成或计费请求。（上游行 200） |
| 1.0.1-14 | Fixed：Fixed installations resolving vulnerable brace-expansion 5.0.9 by pinning brace-expansion 5.0.12 as a direct dependency (GHSA-q2hr-2g5m-vwhr, GHSA-qhr7-859c-m2p7, GHSA-6j4f-fj2g-mc7p) (#10288) | S SDK 继承／静态核对 | 此项由锁定 SDK 承担，当前应用未改写该实现；未独立复现此项特定边界／性能案例。（上游行 204） |
| 1.0.1-15 | Fixed：Fixed a trailing comma in --models adding an extra model to the model cycle (#10334) | N CLI 路径不适用 | 应用通过 Node SDK 嵌入，未启动 Pi CLI／print／全局安装器；该 CLI 变化不在应用执行路径。（上游行 205） |
| 1.0.1-16 | Fixed：Fixed a codemode script that prints in a loop crashing pi by running out of memory: a script fails once its output passes 16 Mi characters or 100000 items (#10283) | S SDK 继承／静态核对 | 此项由锁定 SDK 承担，当前应用未改写该实现；未独立复现此项特定边界／性能案例。（上游行 206） |
| 1.0.1-17 | Fixed：Fixed JPEG, GIF, and WebP images rendered by extensions through Image not appearing in Kitty, Ghostty, WezTerm, and Warp (#10292) | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 207） |
| 1.0.1-18 | Fixed：Fixed MCP tool calls in resumed sessions and HTML exports rendering fully expanded until their server connected, or for good if it never did (#10285) | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 208） |
| 1.0.1-19 | Fixed：Fixed fullscreen Kitty images collapsing to a one-row strip after scrolling in WezTerm (#10319) | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 209） |
| 1.0.1-20 | Fixed：Fixed "Selected model is at capacity" provider errors ending the turn instead of being retried (#10278) | S SDK 继承／静态核对 | 此项由锁定 SDK 承担，当前应用未改写该实现；未独立复现此项特定边界／性能案例。（上游行 210） |
| 1.0.1-21 | Fixed：Fixed Cloudflare AI Gateway Claude models failing with a 404 by using dashed model IDs (claude-opus-5-5 instead of claude-opus-5.5) | E 外部服务待验 | 需要真实提供商、OAuth 服务器／账号或特定部署才能验证；本次没有用用户凭据进行在线登录、生成或计费请求。（上游行 211） |
| 1.0.1-22 | Fixed：Fixed Sign in with ChatGPT continuing when its callback port is taken by another login, which made the browser show "OAuth state mismatch"; it now fails with a port-in-use error (#10265) | E 外部服务待验 | 需要真实提供商、OAuth 服务器／账号或特定部署才能验证；本次没有用用户凭据进行在线登录、生成或计费请求。（上游行 212） |
| 1.0.1-23 | Fixed：Fixed Amazon Bedrock OpenAI models costing requests above 272k input tokens at the short-context rate; Bedrock models now include the pricing tiers listed on models.dev (#10326) | E 外部服务待验 | 需要真实提供商、OAuth 服务器／账号或特定部署才能验证；本次没有用用户凭据进行在线登录、生成或计费请求。（上游行 213） |
| 1.0.1-24 | Fixed：Fixed Amazon Bedrock Claude requests failing with "Invalid signature in thinking block" after the system prompt or tools changed (#10324) | E 外部服务待验 | 需要真实提供商、OAuth 服务器／账号或特定部署才能验证；本次没有用用户凭据进行在线登录、生成或计费请求。（上游行 214） |
| 1.0.1-25 | Fixed：Fixed Together DeepSeek V4 Pro losing its thinking level controls after Together renamed it to deepseek-ai/DeepSeek-V4-Pro-0813 (#10336 by @cv) | S 目录承接待复验 | 上游目录／提供商实现随锁定版本承接；应用聊天模型由用户渠道配置指定，未核验对应账号的可见目录或调用对应真实模型。（上游行 215） |
| 1.0.1-26 | Fixed：Fixed the default NVIDIA model pointing at nvidia/nemotron-3-super-120b-a12b, which NVIDIA no longer serves; the default is now nvidia/nemotron-3-ultra-550b-a55b | S 目录承接待复验 | 上游目录／提供商实现随锁定版本承接；应用聊天模型由用户渠道配置指定，未核验对应账号的可见目录或调用对应真实模型。（上游行 216） |
| 1.0.1-27 | Removed：Removed npm-shrinkwrap.json from the published package. npm installations no longer pin transitive dependencies, and library consumers can now override them. Use the pi.dev installer for pinned installations (#… | S SDK 继承／静态核对 | 此项由锁定 SDK 承担，当前应用未改写该实现；未独立复现此项特定边界／性能案例。（上游行 220） |

### 1.0.2（2 项）

| 编号 | 上游分类／变更摘要 | 判定 | 验收说明 |
|---|---|---|---|
| 1.0.2-01 | New Features：Sampling by thinking level — samplingParamsByThinkingLevel in models.json sets sampling parameters such as temperature and top_p for each thinking level on OpenAI-compatible APIs. See Configure sampling by thin… | T 采样实测 | ModelRuntime 本地 HTTP 请求确认基础 samplingParams 和 high 覆盖值。（上游行 172） |
| 1.0.2-02 | Added：Added samplingParamsByThinkingLevel to models.json for per-thinking-level sampling parameter overrides on OpenAI-compatible APIs. See Configure sampling by thinking level (#9776 by @mrexodia) | T 采样实测 | ModelRuntime 本地 HTTP 请求确认基础 samplingParams 和 high 覆盖值。（上游行 176） |

### 1.0.3（10 项）

| 编号 | 上游分类／变更摘要 | 判定 | 验收说明 |
|---|---|---|---|
| 1.0.3-01 | New Features：Azure Foundry Chat Completions — The azure provider (renamed from azure-openai-responses) now also serves Foundry Chat Completions deployments, starting with azure/deepseek-v4-pro. See Azure OpenAI. | S 目录承接待复验 | 上游目录／提供商实现随锁定版本承接；应用聊天模型由用户渠道配置指定，未核验对应账号的可见目录或调用对应真实模型。（上游行 145） |
| 1.0.3-02 | New Features：Codemode images saved to files — image() also writes each image to a temp file and names the path in the result, so later turns can copy or move generated images. See Generate images. | T 脚本图像实测 | read → codemode image、非法图像拒绝及输出文件提示已实测；未逐一测所有图像格式。（上游行 146） |
| 1.0.3-03 | Breaking Changes：Renamed the Azure provider from azure-openai-responses to azure. Rename the provider key in auth.json (or run /login again), in models.json, and in settings.json (defaultProvider, enabledModels patterns, and mo… | B Azure 名称迁移边界 | 上游要求将 azure-openai-responses 改为 azure；已检查本机 Pi settings/auth 无旧键、models.json 不存在，当前无需迁移，未实现任意外部旧配置自动迁移。（上游行 150） |
| 1.0.3-04 | Added：Added Azure Foundry Chat Completions deployments, starting with azure/deepseek-v4-pro (#9645, #9714 by @jsanter27) | S 目录承接待复验 | 上游目录／提供商实现随锁定版本承接；应用聊天模型由用户渠道配置指定，未核验对应账号的可见目录或调用对应真实模型。（上游行 154） |
| 1.0.3-05 | Changed：Codemode image() now also saves each image to a temp file and names the path in the result, so later turns can copy or move generated images (#10310) | T 脚本图像实测 | read → codemode image、非法图像拒绝及输出文件提示已实测；未逐一测所有图像格式。（上游行 158） |
| 1.0.3-06 | Changed：Output files (full text of truncated tool output, binary MCP resources, codemode images) are now readable only by the user | S SDK 继承／静态核对 | 此项由锁定 SDK 承担，当前应用未改写该实现；未独立复现此项特定边界／性能案例。（上游行 159） |
| 1.0.3-07 | Changed：Home/End now always move the editor cursor to the line start/end; fullscreen transcript top/bottom moved to Ctrl+Home/Ctrl+End, which no longer move the editor cursor (#10314) | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 160） |
| 1.0.3-08 | Fixed：Fixed subscription logins such as Sign in with ChatGPT failing with refresh_token_invalidated after a request was cancelled during an OAuth token refresh | E 外部服务待验 | 需要真实提供商、OAuth 服务器／账号或特定部署才能验证；本次没有用用户凭据进行在线登录、生成或计费请求。（上游行 164） |
| 1.0.3-09 | Fixed：Fixed codemode failing for the rest of a session after a pnpm global update removed the running install, and added a restart hint when errors occur after pi was updated or removed on disk (#10439) | S SDK 继承／静态核对 | 此项由锁定 SDK 承担，当前应用未改写该实现；未独立复现此项特定边界／性能案例。（上游行 165） |
| 1.0.3-10 | Fixed：Fixed interactive sessions reporting a read EIO or setRawMode EIO crash (and asking to run /bug) when the terminal went away, e.g. after closing the window or resuming a suspended pi in a closed terminal | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 166） |

### 1.0.4（12 项）

| 编号 | 上游分类／变更摘要 | 判定 | 验收说明 |
|---|---|---|---|
| 1.0.4-01 | New Features：Tool patterns and --no-mcp: --tools and --exclude-tools accept * patterns, for example --tools read,codemode,'mcp__radius__*' keeps only one MCP server's tools. --tools now keeps MCP tools unless an entry start… | N CLI 路径不适用 | 应用通过 Node SDK 嵌入，未启动 Pi CLI／print／全局安装器；该 CLI 变化不在应用执行路径。（上游行 122） |
| 1.0.4-02 | New Features：Codemode persists images: tools.read() on an image file now gives back an image block that image() can show. See Call tools. | T 脚本图像实测 | read → codemode image、非法图像拒绝及输出文件提示已实测；未逐一测所有图像格式。（上游行 123） |
| 1.0.4-03 | Added：Added * patterns to --tools and --exclude-tools, for example --tools read,codemode,'mcp__radius__*' | N CLI 路径不适用 | 应用通过 Node SDK 嵌入，未启动 Pi CLI／print／全局安装器；该 CLI 变化不在应用执行路径。（上游行 127） |
| 1.0.4-04 | Added：Added --no-mcp to disable the built-in MCP support for one run | N CLI 路径不适用 | 应用通过 Node SDK 嵌入，未启动 Pi CLI／print／全局安装器；该 CLI 变化不在应用执行路径。（上游行 128） |
| 1.0.4-05 | Fixed：Fixed syntax highlighting losing colors after the first line of multiline strings and comments in fenced code blocks (#10143) | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 132） |
| 1.0.4-06 | Fixed：Fixed codemode scripts not receiving images from read: tools.read() now resolves to an image block for image files, which image() shows (#10251) | T 脚本图像实测 | read → codemode image、非法图像拒绝及输出文件提示已实测；未逐一测所有图像格式。（上游行 133） |
| 1.0.4-07 | Fixed：Fixed MCP OAuth sign-in failing with invalid_redirect_uri on servers with OpenID Connect client registration, such as mcp.modem.dev: pi now registers as a native client (#10493) | E 外部服务待验 | 需要真实提供商、OAuth 服务器／账号或特定部署才能验证；本次没有用用户凭据进行在线登录、生成或计费请求。（上游行 134） |
| 1.0.4-08 | Fixed：Fixed --tools removing MCP tools, which left pi --tools codemode without any MCP servers. --tools now keeps MCP tools unless an entry starts with mcp__ | N CLI 路径不适用 | 应用通过 Node SDK 嵌入，未启动 Pi CLI／print／全局安装器；该 CLI 变化不在应用执行路径。（上游行 135） |
| 1.0.4-09 | Fixed：Fixed MCP session shutdown returning while a server was still connecting, leaving its transport open until the server answered or timed out (#10249) | T 生命周期实测 | user/custom 启动、busy、取消、工具后系统提示保留、agent_settled 与 shutdown 已实测。（上游行 136） |
| 1.0.4-10 | Fixed：Fixed system prompt rules and the skills hint naming tools hidden by prepareLoadout. Hidden tools are left out of the rules, the skills hint names no tool when the file reader is hidden, and codemode shows each… | T 工具协议实测 | 嵌套调用、父子 ID、错误标志、结构化结果、usage、约束声明与 namespace aliases 已实测。（上游行 137） |
| 1.0.4-11 | Fixed：Fixed Bedrock requests that fail with The pending stream has been canceled after a stalled HTTP/2 connection not being retried automatically (#10379) | E 外部服务待验 | 需要真实提供商、OAuth 服务器／账号或特定部署才能验证；本次没有用用户凭据进行在线登录、生成或计费请求。（上游行 138） |
| 1.0.4-12 | Fixed：Fixed codemode scripts that patch built-ins (for example Array.prototype.toJSON = ...) crashing pi and leaving the tool call unsettled. Built-ins are now frozen before the script runs, so such patches have no e… | T 脚本输出实测 | 非首行 @options 拒绝、文本分隔、冻结内建对象与后续脚本可继续运行已实测。（上游行 139） |

### 1.1.0（38 项）

| 编号 | 上游分类／变更摘要 | 判定 | 验收说明 |
|---|---|---|---|
| 1.1.0-01 | New Features：Program status reporting: terminals and agent dashboards that support OSC 7501 see whether Pi is working, blocked on a dialog or login, done, or failed. See Program status. | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 70） |
| 1.1.0-02 | New Features：Claude Haiku 5.5: anthropic/claude-haiku-5-5, with adaptive thinking up to xhigh/max effort. | S 目录承接待复验 | 上游目录／提供商实现随锁定版本承接；应用聊天模型由用户渠道配置指定，未核验对应账号的可见目录或调用对应真实模型。（上游行 71） |
| 1.1.0-03 | New Features：Adjust default tools with +name/-name: --tools entries like pi -t +codemode,-write change the default selection instead of replacing it. See Tools. | N CLI 路径不适用 | 应用通过 Node SDK 嵌入，未启动 Pi CLI／print／全局安装器；该 CLI 变化不在应用执行路径。（上游行 72） |
| 1.1.0-04 | New Features：GPT-6 Luna and image classification: OpenAI's GPT-6 Luna is available as a classifier model through the Decisions API, and codemode's models.classify() accepts images for classifiers that support them. See Use … | T 模型接口实测 | 虚拟路由或图像／分类操作已用本地实现验证；未验证云端模型质量和计费。（上游行 73） |
| 1.1.0-05 | New Features：Native llama.cpp decision models: Julia-1, Laya, Kev, lev, and OpenJev served by llama.cpp 0.6.0 or later run natively as classifiers through /v1/systemone. See Classification. | B llama.cpp 内置扩展边界 | 宿主未加载 CLI 的内置 llama.cpp 服务发现扩展；已有 OpenAI 兼容聊天渠道可用，但不自动发现本地决策模型，扩展可自行注册 classifier provider。（上游行 74） |
| 1.1.0-06 | Added：Added +name and -name entries to --tools, which change the default tool selection instead of replacing it, for example pi -t +codemode | N CLI 路径不适用 | 应用通过 Node SDK 嵌入，未启动 Pi CLI／print／全局安装器；该 CLI 变化不在应用执行路径。（上游行 78） |
| 1.1.0-07 | Added：Added durationMs to the tool render context and to tool_execution_end extension events: the recorded execution time of a final tool result (#10549) | T 耗时实测 | durationMs 从 SDK 透传并在前端显示／持久化；实际执行耗时与回放后仍保留已验证。（上游行 79） |
| 1.1.0-08 | Added：Added outputPad to the tool render context (#10557 by @rwachtler) | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 80） |
| 1.1.0-09 | Added：Added OpenAI's GPT-6 Luna as a classifier model through the Decisions API, available with OPENAI_API_KEY (see Use classifier models) | S 目录承接待复验 | 上游目录／提供商实现随锁定版本承接；应用聊天模型由用户渠道配置指定，未核验对应账号的可见目录或调用对应真实模型。（上游行 81） |
| 1.1.0-10 | Added：Added images to codemode's models.classify() context, so classifiers that accept images, such as GPT-6 Luna, can judge them | T 模型接口实测 | 虚拟路由或图像／分类操作已用本地实现验证；未验证云端模型质量和计费。（上游行 82） |
| 1.1.0-11 | Added：Added program status reporting with OSC 7501: terminals and agent dashboards that support it see whether Pi is working, blocked on a dialog or login, done, or failed. PI_PROGRAM_STATUS=1\|0 overrides detection … | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 83） |
| 1.1.0-12 | Added：Added aborted to agent_settled session, extension, and JSON events, so integrations can tell a cancelled run from a finished one (#10607) | T 生命周期实测 | user/custom 启动、busy、取消、工具后系统提示保留、agent_settled 与 shutdown 已实测。（上游行 84） |
| 1.1.0-13 | Added：Added Claude Haiku 5.5 (anthropic/claude-haiku-5-5), with adaptive thinking up to xhigh/max effort and prompt caching on Bedrock | S 目录承接待复验 | 上游目录／提供商实现随锁定版本承接；应用聊天模型由用户渠道配置指定，未核验对应账号的可见目录或调用对应真实模型。（上游行 85） |
| 1.1.0-14 | Added：Added native llama.cpp decision models: Julia-1, Laya, Kev, lev, and OpenJev served by llama.cpp 0.6.0 or later are listed only as classifiers through /v1/systemone instead of as chat models (see Classification… | B llama.cpp 内置扩展边界 | 宿主未加载 CLI 的内置 llama.cpp 服务发现扩展；已有 OpenAI 兼容聊天渠道可用，但不自动发现本地决策模型，扩展可自行注册 classifier provider。（上游行 86） |
| 1.1.0-15 | Changed：Changed outputPad to also apply to ! command output, tool output, and summary blocks (#9946, #10557 by @rwachtler) | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 90） |
| 1.1.0-16 | Changed：Changed pi mcp login --timeout to limit the whole sign-in, including requests to the authorization server, instead of only the wait for the browser (#10565) | E 外部服务待验 | 需要真实提供商、OAuth 服务器／账号或特定部署才能验证；本次没有用用户凭据进行在线登录、生成或计费请求。（上游行 91） |
| 1.1.0-17 | Fixed：Fixed bash and PowerShell results losing Took after reloading a session, and the live Took including wall-clock steps; both now show the recorded execution time (#10549) | T 耗时实测 | durationMs 从 SDK 透传并在前端显示／持久化；实际执行耗时与回放后仍保留已验证。（上游行 95） |
| 1.1.0-18 | Fixed：Fixed managed installs keeping every old release; pi update now keeps only the new release and the one it updated from (#10392, #10511 by @davidbrai) | N CLI 路径不适用 | 应用通过 Node SDK 嵌入，未启动 Pi CLI／print／全局安装器；该 CLI 变化不在应用执行路径。（上游行 96） |
| 1.1.0-19 | Fixed：Fixed standalone binaries loading .env, .env.local, and .env.development from the launch directory into Pi's environment (#10473) | N CLI 路径不适用 | 应用通过 Node SDK 嵌入，未启动 Pi CLI／print／全局安装器；该 CLI 变化不在应用执行路径。（上游行 97） |
| 1.1.0-20 | Fixed：Fixed !! command headers losing their dim color once output arrives (#10557 by @rwachtler) | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 98） |
| 1.1.0-21 | Fixed：Fixed the codemode description not marking searchTools(), describeTool(), and describeNamespace() as async, which led models to serialize the unawaited promise as {} (#10555) | T 脚本输出实测 | 非首行 @options 拒绝、文本分隔、冻结内建对象与后续脚本可继续运行已实测。（上游行 99） |
| 1.1.0-22 | Fixed：Fixed codemode output items running together, so models could not tell where one text() or console.log() output ended and the next began. With several text items, each now starts with a ==> text N/M <== line, a… | T 脚本输出实测 | 非首行 @options 拒绝、文本分隔、冻结内建对象与后续脚本可继续运行已实测。（上游行 100） |
| 1.1.0-23 | Fixed：Fixed /mcp waiting for all servers to connect before opening; the manager now updates live and remains usable while enabling, reconnecting, or disabling servers (#10562) | B 终端组件边界 | 完整 TUI factory／自定义工具 renderer 无网页等价实现；文本／标准对话框可用，不能声称完整 TUI 兼容。（上游行 101） |
| 1.1.0-24 | Fixed：Fixed images being dropped as "could not be resized" when running under node --watch on Node 24.19+ and 26.x, where Node posts its own messages on the image resize worker channel (#10527) | S SDK 继承／静态核对 | 此项由锁定 SDK 承担，当前应用未改写该实现；未独立复现此项特定边界／性能案例。（上游行 102） |
| 1.1.0-25 | Fixed：Fixed clipboard paste doing nothing in Termux, and failed copies there omitting the Termux:API install hint (#10391) | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 103） |
| 1.1.0-26 | Fixed：Fixed ! and RPC bash output keeping fragments of color codes, such as a stray m, when a code was split across output chunks (#10504) | S SDK 继承／静态核对 | 此项由锁定 SDK 承担，当前应用未改写该实现；未独立复现此项特定边界／性能案例。（上游行 104） |
| 1.1.0-27 | Fixed：Fixed MCP OAuth sign-ins that could not be cancelled while waiting on the authorization server and kept running after the session ended. The sign-in screen now cancels with Esc at every step, session shutdown a… | E 外部服务待验 | 需要真实提供商、OAuth 服务器／账号或特定部署才能验证；本次没有用用户凭据进行在线登录、生成或计费请求。（上游行 105） |
| 1.1.0-28 | Fixed：Fixed shutdown waiting up to 15 seconds to refresh an MCP OAuth token that was about to expire, only to close the server's session (#10565) | T 生命周期实测 | user/custom 启动、busy、取消、工具后系统提示保留、agent_settled 与 shutdown 已实测。（上游行 106） |
| 1.1.0-29 | Fixed：Fixed the fullscreen text selection surviving session switches and other transcript rebuilds, which highlighted unrelated text in the new transcript (#9311, #10567 by @christianklotz) | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 107） |
| 1.1.0-30 | Fixed：Fixed OpenAI models on Bedrock ignoring the thinking level and always running at Bedrock's default reasoning effort (#9331, #10142 by @jsanter27) | E 外部服务待验 | 需要真实提供商、OAuth 服务器／账号或特定部署才能验证；本次没有用用户凭据进行在线登录、生成或计费请求。（上游行 108） |
| 1.1.0-31 | Fixed：Fixed model headers in models.json not overriding the originator and User-Agent headers of Codex requests (#10429 by @lucasmeijer) | E 外部服务待验 | 需要真实提供商、OAuth 服务器／账号或特定部署才能验证；本次没有用用户凭据进行在线登录、生成或计费请求。（上游行 109） |
| 1.1.0-32 | Fixed：Fixed server_busy and servers are currently busy provider errors ending the turn instead of being retried (#10543) | S SDK 继承／静态核对 | 此项由锁定 SDK 承担，当前应用未改写该实现；未独立复现此项特定边界／性能案例。（上游行 110） |
| 1.1.0-33 | Fixed：Fixed Mistral responses that end with finish_reason: "error" not being retried (#10487) | S SDK 继承／静态核对 | 此项由锁定 SDK 承担，当前应用未改写该实现；未独立复现此项特定边界／性能案例。（上游行 111） |
| 1.1.0-34 | Fixed：Reduced context-limit request failures by estimating input at 3.5 characters per token instead of 4 when calculating output limits (#10497) | S SDK 继承／静态核对 | 此项由锁定 SDK 承担，当前应用未改写该实现；未独立复现此项特定边界／性能案例。（上游行 112） |
| 1.1.0-35 | Fixed：Fixed Radius models disabled by an organization owner still being listed | S 目录承接待复验 | 上游目录／提供商实现随锁定版本承接；应用聊天模型由用户渠道配置指定，未核验对应账号的可见目录或调用对应真实模型。（上游行 113） |
| 1.1.0-36 | Fixed：Fixed Anthropic browser login failing with "localhost refused to connect" when port 53692 is reserved or in use, for example by Hyper-V/WSL port exclusions on Windows: login now falls back to a free loopback po… | E 外部服务待验 | 需要真实提供商、OAuth 服务器／账号或特定部署才能验证；本次没有用用户凭据进行在线登录、生成或计费请求。（上游行 114） |
| 1.1.0-37 | Fixed：Fixed session costs undercounting long prompts on models with prompt-length pricing tiers, such as Claude Haiku 5.5, Gemini 3.1 Pro, and GPT-5.4, through OpenCode, OpenCode Go, OpenRouter, Vercel AI Gateway, Go… | E 外部服务待验 | 需要真实提供商、OAuth 服务器／账号或特定部署才能验证；本次没有用用户凭据进行在线登录、生成或计费请求。（上游行 115） |
| 1.1.0-38 | Fixed：Fixed Markdown links not being clickable in Herdr (#10573) | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 116） |

### 1.2.0（43 项）

| 编号 | 上游分类／变更摘要 | 判定 | 验收说明 |
|---|---|---|---|
| 1.2.0-01 | New Features：Per-key OpenRouter model lists: with an OpenRouter key, Pi lists only the models that key may use, with the key's context size, max output, and prices, including regional endpoints set in models.json. See OpenR… | E 外部服务待验 | 需要真实提供商、OAuth 服务器／账号或特定部署才能验证；本次没有用用户凭据进行在线登录、生成或计费请求。（上游行 7） |
| 1.2.0-02 | New Features：Published configuration schemas: add $schema to settings.json, models.json, keybindings, and themes for editor validation and completion. See Settings, Models, Keybindings, and Themes. | S 配置静态核对 | 随包 schemas／配置加载器存在；应用配置与 Pi 配置分开，未实现网页端终端主题验证编辑器。（上游行 8） |
| 1.2.0-03 | New Features：Clipboard copies over remote sessions: PI_CLIPBOARD_OSC52=1 sends copied text to a remote client's clipboard when Pi cannot detect the remote session, such as a multiplexer attached from another machine. See Pi… | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 9） |
| 1.2.0-04 | New Features：Codemode improvements: tool declarations show input constraints such as integer, minimum/maximum, and default, and codemode rows show elapsed and total time. See Codemode. | T 工具协议实测 | 嵌套调用、父子 ID、错误标志、结构化结果、usage、约束声明与 namespace aliases 已实测。（上游行 10） |
| 1.2.0-05 | New Features：before_agent_start for extension-triggered runs: runs started by pi.sendMessage(..., { triggerTurn: true }) go through the same setup as prompts. See Events and concurrency. | T 生命周期实测 | user/custom 启动、busy、取消、工具后系统提示保留、agent_settled 与 shutdown 已实测。（上游行 11） |
| 1.2.0-06 | Breaking Changes：Published generated configuration schemas for models, settings, keybindings, and themes at https://pi.dev/schemas/*.schema.json. The theme schema moved to https://pi.dev/schemas/theme.schema.json; themes loaded… | S 配置静态核对 | 随包 schemas／配置加载器存在；应用配置与 Pi 配置分开，未实现网页端终端主题验证编辑器。（上游行 15） |
| 1.2.0-07 | Breaking Changes：Changed before_agent_start to also fire for runs started by pi.sendMessage(..., { triggerTurn: true }) while idle. BeforeAgentStartEvent is now a union on messageType: "user" events carry prompt and images, and… | T 生命周期实测 | user/custom 启动、busy、取消、工具后系统提示保留、agent_settled 与 shutdown 已实测。（上游行 16） |
| 1.2.0-08 | Breaking Changes：Changed the session to count as busy while a run starts, including during before_agent_start handlers: ctx.isIdle() is false, pi.sendMessage() queues into the starting run instead of starting a second run that … | T 生命周期实测 | user/custom 启动、busy、取消、工具后系统提示保留、agent_settled 与 shutdown 已实测。（上游行 17） |
| 1.2.0-09 | Breaking Changes：Changed pi mcp list --json to report resources: true for servers that offer resources instead of resources and resourceTemplates counts; Pi no longer lists resources when connecting (#10526) | N CLI 路径不适用 | 应用通过 Node SDK 嵌入，未启动 Pi CLI／print／全局安装器；该 CLI 变化不在应用执行路径。（上游行 18） |
| 1.2.0-10 | Added：Added reachesTools to tool definitions, so tools that reach other tools (such as codemode and tool_search) declare which tools a call may reach; the MCP extension uses it to wait for the servers a call needs an… | T 工具协议实测 | 嵌套调用、父子 ID、错误标志、结构化结果、usage、约束声明与 namespace aliases 已实测。（上游行 22） |
| 1.2.0-11 | Added：Added aliases to tool namespaces; codemode's describeNamespace() and the namespace option of searchTools() match them, and MCP namespaces use the server name | T 工具协议实测 | 嵌套调用、父子 ID、错误标志、结构化结果、usage、约束声明与 namespace aliases 已实测。（上游行 23） |
| 1.2.0-12 | Added：Added per-key OpenRouter model lists: with an OpenRouter key, Pi lists only the chat models that key may use, with the key's context size, max output, and prices, including guardrails and regional endpoints set… | E 外部服务待验 | 需要真实提供商、OAuth 服务器／账号或特定部署才能验证；本次没有用用户凭据进行在线登录、生成或计费请求。（上游行 24） |
| 1.2.0-13 | Added：Added PI_CLIPBOARD_OSC52=1 to send copied text to the terminal with OSC 52 after the local clipboard write, so copies reach a remote client's clipboard when Pi cannot detect the remote session, such as multiple… | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 25） |
| 1.2.0-14 | Added：Added elapsed time while a codemode script runs and its total time once finished to the codemode tool row, like bash rows (#10708) | T 耗时实测 | durationMs 从 SDK 透传并在前端显示／持久化；实际执行耗时与回放后仍保留已验证。（上游行 26） |
| 1.2.0-15 | Changed：Changed the showHardwareCursor setting to use only the terminal cursor instead of also drawing Pi's reverse-video cursor | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 30） |
| 1.2.0-16 | Changed：Changed codemode tool declarations to show input constraints such as integer, minimum/maximum, length, pattern, and default as @ tags on property comments, so scripts see them without the tool repeating them in… | T 工具协议实测 | 嵌套调用、父子 ID、错误标志、结构化结果、usage、约束声明与 namespace aliases 已实测。（上游行 31） |
| 1.2.0-17 | Changed：Changed codemode declarations of MCP tools to spell out the result type (content, structuredContent, isError) instead of referring to CallToolResult<T>, which describeTool(), searchTools(), and ALL_TOOLS showed… | T 工具协议实测 | 嵌套调用、父子 ID、错误标志、结构化结果、usage、约束声明与 namespace aliases 已实测。（上游行 32） |
| 1.2.0-18 | Changed：Changed serializeConversation() (compaction, branch summaries, bug reports) to omit thinking blocks; replayed thinking is often not in the live context, so including it could make a summarization request larger… | T 压缩实测 | serializeConversation 排除 thinking；既有宿主压缩与上下文恢复回归覆盖当前应用链路。（上游行 33） |
| 1.2.0-19 | Fixed：Fixed codemode ignoring a // @options: line that is not the first line of the script, which ran the script without the requested timeout_ms; the call now fails with an error before the script runs (#10631) | T 脚本输出实测 | 非首行 @options 拒绝、文本分隔、冻结内建对象与后续脚本可继续运行已实测。（上游行 37） |
| 1.2.0-20 | Fixed：Fixed Mistral streams being aborted mid-generation (e.g. during long thinking) after the request timeout; the timeout now applies only to waiting for response headers (#10609) | E 外部服务待验 | 需要真实提供商、OAuth 服务器／账号或特定部署才能验证；本次没有用用户凭据进行在线登录、生成或计费请求。（上游行 38） |
| 1.2.0-21 | Fixed：Fixed a symlinked AGENTS.md in a git worktree nested inside its main repo causing no project context file to load (#10681) | S SDK 继承／静态核对 | 此项由锁定 SDK 承担，当前应用未改写该实现；未独立复现此项特定边界／性能案例。（上游行 39） |
| 1.2.0-22 | Fixed：Fixed the code mode tool description claiming every failed tool call rejects; a tool that declares an output schema resolves with its value on failure too (e.g. bash with a nonzero exit) | T 工具协议实测 | 嵌套调用、父子 ID、错误标志、结构化结果、usage、约束声明与 namespace aliases 已实测。（上游行 40） |
| 1.2.0-23 | Fixed：Fixed runs started by pi.sendMessage(..., { triggerTurn: true }) removing system prompt sections added in before_agent_start after their first tool call, which changed the prompt mid-run and broke the provider … | T 生命周期实测 | user/custom 启动、busy、取消、工具后系统提示保留、agent_settled 与 shutdown 已实测。（上游行 41） |
| 1.2.0-24 | Fixed：Fixed codemode blocking the process for seconds to minutes after scripts with many text() calls; joining the output items was quadratic (#10678) | S SDK 继承／静态核对 | 此项由锁定 SDK 承担，当前应用未改写该实现；未独立复现此项特定边界／性能案例。（上游行 42） |
| 1.2.0-25 | Fixed：Fixed print mode (-p) exiting 0 without a warning when the final response was cut off at the model's output token limit; it now prints the partial text, writes a warning to stderr, and exits 1 (#10799) | N CLI 路径不适用 | 应用通过 Node SDK 嵌入，未启动 Pi CLI／print／全局安装器；该 CLI 变化不在应用执行路径。（上游行 43） |
| 1.2.0-26 | Fixed：Fixed pi mcp login --help and the CLI docs describing --timeout as only the wait for the browser; it limits the whole sign-in (#10636) | N CLI 路径不适用 | 应用通过 Node SDK 嵌入，未启动 Pi CLI／print／全局安装器；该 CLI 变化不在应用执行路径。（上游行 44） |
| 1.2.0-27 | Fixed：Fixed ~ not being expanded in !pattern, +path, and -path entries of the extensions, skills, prompts, and themes settings, so entries like !~/skills/pdf matched nothing (#10765) | S SDK 继承／静态核对 | 此项由锁定 SDK 承担，当前应用未改写该实现；未独立复现此项特定边界／性能案例。（上游行 45） |
| 1.2.0-28 | Fixed：Fixed MCP servers with resources registering no tools until every resource was listed; Pi no longer lists resources when connecting, so /mcp and pi mcp list show that a server offers resources instead of counti… | T 本地协议实测 | 原生 MCP／codemode 已接入宿主；测试覆盖基础调用，不等于每个第三方服务都通过。（上游行 46） |
| 1.2.0-29 | Fixed：Fixed MCP tool calls failing when the server returns structured content that is not an object (an array, null, or a primitive, as MCP 2026-07-28 allows); codemode declarations of MCP tools without an output sch… | T 本地协议实测 | 原生 MCP／codemode 已接入宿主；测试覆盖基础调用，不等于每个第三方服务都通过。（上游行 47） |
| 1.2.0-30 | Fixed：Fixed reading or writing auth.json on Windows failing with EPERM when the previous lock folder was still being deleted; Pi now retries briefly before reporting the error (#10801) | S SDK 继承／静态核对 | 此项由锁定 SDK 承担，当前应用未改写该实现；未独立复现此项特定边界／性能案例。（上游行 48） |
| 1.2.0-31 | Fixed：Fixed OpenRouter router models such as openrouter/auto showing a cost of -$1,000,000 per 1M tokens; OpenRouter's negative placeholder prices are now 0 (#10672 by @davidbrai) | E 外部服务待验 | 需要真实提供商、OAuth 服务器／账号或特定部署才能验证；本次没有用用户凭据进行在线登录、生成或计费请求。（上游行 49） |
| 1.2.0-32 | Fixed：Fixed Anthropic requests failing when the provider rejects the strict tool set for grammar size, tool count, or union limits; Pi now retries once with preferred tools non-strict (#10409) | E 外部服务待验 | 需要真实提供商、OAuth 服务器／账号或特定部署才能验证；本次没有用用户凭据进行在线登录、生成或计费请求。（上游行 50） |
| 1.2.0-33 | Fixed：Fixed "The upstream provider returned an error" not being retried as a transient provider error (#10842) | S SDK 继承／静态核对 | 此项由锁定 SDK 承担，当前应用未改写该实现；未独立复现此项特定边界／性能案例。（上游行 51） |
| 1.2.0-34 | Fixed：Fixed focused fullscreen overlays blocking mouse-wheel scrolling of the transcript (#10769) | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 52） |
| 1.2.0-35 | Fixed：Fixed fragmented terminal color replies leaking hex values into the prompt and opening the external editor (related reports: #10256, #10657) | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 53） |
| 1.2.0-36 | Fixed：Fixed inline images not rendering in Herdr since 1.1.0 (#10774 by @ogulcancelik) | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 54） |
| 1.2.0-37 | Fixed：Fixed key bindings that name a shifted symbol, such as + or ctrl++, not matching under the Kitty keyboard protocol or modifyOtherKeys (#9880 by @christianklotz) | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 55） |
| 1.2.0-38 | Fixed：Fixed the compaction status indicator embedded in a custom editor using the default muted colors instead of the editor border or thinking-level color, as the working indicator does (#10809, #10810 by @Jay-Madde… | N 终端显示不适用 | 聊天界面为 React／RPC；不运行 Pi 终端输入、键盘协议或终端绘制器。（上游行 56） |
| 1.2.0-39 | Fixed：Fixed MCP tool calls that were cancelled or timed out while waiting for an OAuth refresh still being sent to the server once the refresh finished (#10598) | E 外部服务待验 | 需要真实提供商、OAuth 服务器／账号或特定部署才能验证；本次没有用用户凭据进行在线登录、生成或计费请求。（上游行 57） |
| 1.2.0-40 | Fixed：Fixed MCP OAuth sign-in accepting an authorization response with an iss parameter that could not be checked because no authorization server metadata was discovered; sign-in now fails with an issuer mismatch. Re… | E 外部服务待验 | 需要真实提供商、OAuth 服务器／账号或特定部署才能验证；本次没有用用户凭据进行在线登录、生成或计费请求。（上游行 58） |
| 1.2.0-41 | Fixed：Fixed codemode failing with a broken bridge error when Pi runs under node --watch on Node 24 or 26 (#10725) | S SDK 继承／静态核对 | 此项由锁定 SDK 承担，当前应用未改写该实现；未独立复现此项特定边界／性能案例。（上游行 59） |
| 1.2.0-42 | Removed：Removed the unreleased experimental server, client, and plugin stack (src/experimental, src/cli/experimental) and its source-only ./client and ./experimental/plugin exports; none of it was part of the published… | S SDK 继承／静态核对 | 此项由锁定 SDK 承担，当前应用未改写该实现；未独立复现此项特定边界／性能案例。（上游行 63） |
| 1.2.0-43 | Removed：Removed the dependency on @earendil-works/chord | S SDK 继承／静态核对 | 此项由锁定 SDK 承担，当前应用未改写该实现；未独立复现此项特定边界／性能案例。（上游行 64） |

## 结论与运行范围

本次验证：完整串行回归 490/490；迁移专项 78/78；两款本机真实插件测试没有跳过；构建、扩展浏览器（含耗时保存和重新打开）、并发会话浏览器通过。Worldbook 9 项、预设 5 项、角色卡 4 项补充检查通过。测试数量与上游变更条目数量是两个统计口径。

已完成每个发布条目的迁移影响检查，并修复本次发现的宿主接口缺口。不能将 259 条全部表述成运行实测通过：仍有 TUI／登录产品边界、上游静态承接项及需要真实服务复现的项目。当前协议测试使用临时目录、虚拟凭据和本地服务，不修改用户聊天数据、不进行付费模型调用。

Pi 原生 MCP 配置文件和应用 UI 的旧 MCP 配置是两个可选入口。/mcp 的自定义终端管理屏仍受 TUI 边界限制，不能把底层 MCP 调用成功等同于管理屏完全兼容。高级分类／图像／虚拟模型接口可由扩展使用，应用主聊天模型选择器没有因此变成 Pi 的完整模型目录。

当前版本代码提交后，运行中的桌面应用仍需重启加载。未来改动版本、builtin 桥接或提供商实现时，运行 npm run test:pi-migration 并更新此清单；真实服务 E 项需要对应环境单独验收。

## 桌面角色卡渲染补验

后续在 Electron 独立聊天窗口复现了所有 HTML 角色卡白屏：React 回调运行在主窗口，直接向子窗口中的 iframe 发送初始化消息时，消息来源不是 iframe 的父窗口，被预览页来源校验拒绝。此前浏览器回归与 Electron 内核协议测试未覆盖这一组合场景。

现由 iframe 所在窗口发送初始化、上下文、命令回复、生成事件及活动消息，并从聊天窗口读取视口与焦点。新增 `npm run test:html-desktop`，覆盖实际 Electron 窗口中的渲染、开场白切换、缩放、主窗口最小化、变量、消息创建、输入回填及全屏；`npm run test:desktop-windows` 同时执行此项回归。使用临时数据和独立 Chromium 配置目录，避免干扰正在运行的应用。

## HTML 加载提速补验

基础库改为随应用打包：脚本环境不再串行下载 jQuery、Lodash、Vue、Zod、YAML。预览使用带内容哈希、可长期缓存的经典脚本资源，每个文档减少约 790 KB 的源码复制；主应用 JS 从约 2.50 MB 降至 1.78 MB。经典脚本保持解析顺序，卡片的 `<head>` 脚本仍能同步读取完整基础库。Android 隔离域直接读取包内资源，LAN／不透明 srcdoc 保留绝对资源地址。

可见预览改用按帧挂载队列，继续串行、避让滚动并保留大型内容的加载间隔。去掉固定 80 ms 等待，继续等待运行时、会话事件及绘制屏障。对需要具体聊天节点的旧观察器增加可取消的 DOM 挂载等待，避免依赖旧网络延迟；普通后台脚本、字符串内的帮助函数和有空值保护的装饰器继续提前运行。加载后的定时同步读取最新上下文，避免覆盖刚完成的消息修改。

本机中性用例（三次独立浏览器上下文，启用一个后台脚本、一个内联 HTML，统计点击进入聊天到自动化探测到首屏可见的耗时，含探测开销）：优化前为 1986／2034／3493 ms，最终复测为 1092／1089／1099 ms，均值约 2.50 s → 1.09 s。基础库外网请求从每次 5 个降至 0；真实卡片自己的远程 HTML、模块和图片耗时不在此保证范围内。

新增 `test/htmlPreviewStartupBrowser.test.mjs`，纳入 `npm run test:tavern`：覆盖离线基础库、异步初始化顺序、经典 head 脚本、跨文档缓存、srcdoc、Android 隔离域和按钮交互。其他检查包括酒馆脚本装饰、双向消息与变量同步、多个预览、普通／大型布局、图片解码、桌面原生窗口，以及 Android Java 编译与前端资源同步。Android 隔离域在浏览器中模拟，未进行 Android 真机性能测量。
