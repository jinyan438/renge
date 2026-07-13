# Renge Agent Lab

Renge Agent Lab 是一个本地优先、跨端运行的 AI Agent 工作台。它把人格设定、系统提示词、模型渠道、单/多 Agent 会话、MCP 工具、Skill 和本地工作区操作放在同一个界面中，并提供 Web 服务、Electron 桌面端和 Android 端。

> 当前版本：`v0.1.0`。项目仍处于早期开发阶段，界面、数据结构和端侧能力可能继续调整；当前构建脚本主要面向 Windows。

## 主要能力

- **人格 Agent**：创建和编辑人格，按身份、背景、偏好、行为、关系、记忆、边界等类型组织条目，并设置影响强度。
- **人格导入与 Prompt 预览**：在人格结构与可直接使用的 Prompt 文本之间转换。
- **OpenAI-compatible 模型渠道**：配置 API Base URL、API Key 和模型 ID，支持从兼容接口拉取模型列表。
- **单 Agent / 多 Agent 会话**：既可直接对话，也可为多个 Agent 分别选择模型并按顺序进行多轮讨论。
- **系统提示词与用户资料**：组合多个系统提示词，可选择是否把用户昵称和简介注入上下文。
- **MCP 工具**：导入 MCP JSON、发现服务器工具，并让模型在会话中按需调用。
- **Skill**：从文件夹或 ZIP 导入 Skill，启用后自动读取说明并注入模型上下文。
- **工作区工具**：在授权范围内列出、读取、搜索、创建、写入、移动和删除文件；桌面端还支持运行 npm 脚本、安全白名单命令以及查看 Git 状态和差异。
- **附件与图片**：支持文本、图片和二进制附件；可对接视觉模型或图像识别 MCP，也可在手机与电脑工作区之间流式传输文件。
- **会话记忆与心跳**：保存工作区会话，可为会话设置周期性心跳事件和循环次数。
- **多端运行**：同一套前端可通过浏览器、Electron 桌面端和 Android App 使用。

## 运行形态

| 形态 | 启动方式 | 适合场景 | 主要限制或特性 |
| --- | --- | --- | --- |
| Web 服务 | `npm start` | 浏览器访问、局域网共享 | 服务默认监听本机网络接口；文件能力受浏览器授权和服务设置限制 |
| Electron 桌面端 | `npm run desktop` | 本地完整工作区、脚本和 Git 操作 | 当前离线安装辅助脚本面向 Windows x64 |
| Android App | `npm run android:apk` | 手机端 Agent、手机工作区、连接电脑传输文件 | 需要 Android SDK；ROOT 工作区能力取决于设备权限 |

## 技术栈

- React 19
- TypeScript 5
- Vite 7
- Node.js HTTP 服务
- Electron 42
- Android Java + Gradle
- Lucide React

## 环境要求

### Web 与桌面端

- Node.js `20.19+` 或 `22.12+`
- npm 10 或兼容版本
- Git（开发和版本恢复时使用）

本仓库当前已在 Node.js 22 环境下完成构建验证。

### Android

- JDK 17 或更高版本
- Android SDK，包含 Android API 35
- Windows 下可直接运行仓库提供的 APK 构建脚本

## 快速开始

克隆仓库并安装依赖：

```powershell
git clone https://github.com/jinyan438/renge.git
cd renge
npm install
```

构建前端：

```powershell
npm run build
```

启动完整 Web 服务：

```powershell
npm start
```

默认访问地址：

```text
http://localhost:5190
```

启动时终端还会输出可用的局域网地址。除非你已经配置防火墙、访问控制或可信网络，否则不要把服务直接暴露到公网。

## 开发模式

启动 Vite 前端开发服务器：

```powershell
npm run dev
```

Vite 默认使用 `http://localhost:5173`。这个命令主要用于前端界面开发；模型代理、持久化、MCP 和电脑文件服务等完整后端能力由 `server.mjs` 提供，日常完整体验建议先执行 `npm run build`，再执行 `npm start`。

构建完成后也可以仅预览静态前端：

```powershell
npm run preview
```

## Electron 桌面端

安装依赖后运行：

```powershell
npm run desktop
```

该命令会先构建前端，再启动 Electron。桌面端会在本机启动内嵌服务，并提供更完整的工作区能力，包括：

- 选择和恢复电脑工作区
- 文件读写、搜索、移动与删除
- 读取项目结构和 `package.json`
- 运行项目中已有的 npm script
- 运行安全白名单命令
- 查看 Git 状态与 Git diff
- 对高风险 Git 操作弹出授权确认

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

先在 `renge_android/local.properties` 中配置 Android SDK 路径，例如：

```properties
sdk.dir=C:/Users/your-name/AppData/Local/Android/Sdk
```

然后在 Windows PowerShell 或命令提示符中运行：

```powershell
npm run android:apk
```

构建流程会自动：

1. 使用 Vite 构建前端；
2. 把 `dist` 同步到 Android Web Assets；
3. 运行 Gradle `clean assembleDebug`；
4. 检查 APK 的 Manifest、资源、DEX、Web Assets 和签名；
5. 把可安装文件复制到项目根目录。

成功后的 APK 路径：

```text
Renge-Agent-Lab-debug.apk
```

APK、Android 构建目录、`local.properties` 和生成的 Web Assets 已加入 `.gitignore`，不会被提交到仓库。

## 首次使用

1. 打开右上角的“设置”。
2. 在“供应商设置”中填写模型服务名称、API Base URL 和 API Key。
3. 拉取模型列表或手动填写模型 ID，然后选择当前模型。
4. 根据需要配置系统提示词、用户资料、MCP 服务器和 Skill。
5. 创建或选择一个人格 Agent。
6. 进入聊天页面，选择单 Agent 或多 Agent 模式。
7. 如果需要让 Agent 操作文件，先选择并授权工作区。

OpenAI 官方接口的 API Base URL 示例：

```text
https://api.openai.com/v1
```

其他供应商需要提供与 OpenAI Chat Completions 接口兼容的地址。不同服务对流式响应、推理参数、图片生成和图片编辑的兼容程度可能不同。

## 数据存储

完整 Web 服务和 Electron 桌面端会把持久化数据写入 `app-data.json`。Windows 默认目录为：

```text
%APPDATA%\Renge Agent Lab\app-data.json
```

可以通过 `RENGE_DATA_DIR` 修改数据目录：

```powershell
$env:RENGE_DATA_DIR = "D:\RengeData"
npm start
```

浏览器在后端持久化接口不可用时会退回 `localStorage`。供应商配置可能包含 API Key，因此不要把数据目录、浏览器配置或 `app-data.json` 上传到公开位置，也不要把 API Key 写入仓库文件。

## 环境变量

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `PORT` | `5190` | 设置独立 Web 服务监听端口 |
| `RENGE_DATA_DIR` | `%APPDATA%\Renge Agent Lab` | 设置持久化数据目录 |
| `RENGE_PC_FILES` | 启用 | 设为 `0` 可关闭电脑文件服务 API |
| `RENGE_ELECTRON_CACHE_DIR` | `%LOCALAPPDATA%\Renge Agent Lab\ElectronCache` | 设置 Electron 缓存目录 |

例如，仅在本机使用 Web 服务并关闭电脑文件服务：

```powershell
$env:RENGE_PC_FILES = "0"
npm start
```

## 安全说明

- 独立 Web 服务默认监听网络接口并打印局域网访问地址。请只在可信网络中使用，不要直接映射到公网。
- API Key 和应用配置存放在本地持久化数据中；请自行保护操作系统账户和数据目录。
- 工作区工具只能操作用户授权的目录，但写入、删除、命令执行和 Git 操作仍可能改变文件或仓库状态，请在授权前确认操作内容。
- Electron 会对高风险 Git 命令请求额外确认；不要在不理解影响的情况下批准历史重写、强制推送或清理命令。
- MCP Server 是外部程序或服务。只导入可信配置，并了解它能够访问的数据和系统资源。
- Android App 允许明文局域网 HTTP 通信，以便连接电脑服务；请避免在不可信网络中传输敏感文件。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动 Vite 前端开发服务器 |
| `npm run build` | 执行 TypeScript 检查并构建前端 |
| `npm run preview` | 预览已构建的静态前端 |
| `npm start` | 启动完整 Web 服务，默认端口 5190 |
| `npm run desktop` | 构建并启动 Electron 桌面端 |
| `npm run electron:install-local` | 从项目根目录的 Electron ZIP 安装 Windows x64 Runtime |
| `npm run android:apk` | 构建并验证 Android Debug APK |

## 项目结构

```text
renge/
├─ src/                         React 前端与人格、会话、工作区逻辑
├─ electron/                    Electron 主进程与预加载桥接
├─ scripts/                     Electron 安装和 APK 验证脚本
├─ renge_android/               Android 原生工程
│  └─ app/src/main/java/        Android Activity、本地服务和工作区桥接
├─ server.mjs                   Web 服务、模型代理、MCP、Skill 和文件 API
├─ build_android_apk.bat        Android APK 一键构建脚本
├─ run.bat                      Windows 快速启动脚本
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

## 开发状态

当前仓库还没有自动化测试脚本，提交前至少应运行：

```powershell
npm run build
```

涉及 Android 的修改还应运行：

```powershell
npm run android:apk
```

## License

仓库当前尚未添加开源许可证。在许可证明确之前，请不要默认该项目允许复制、再分发或商业使用。
