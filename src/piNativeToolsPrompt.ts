export type PiNativeShellPlatform = "windows" | "unix";

export function buildPiNativeToolsSystemPromptText(
  workspaceName: string,
  platform: PiNativeShellPlatform,
) {
  const nativeShell = platform === "windows" ? "powershell" : "bash";
  return [
    `当前 Pi 工作目录是用户授权的工作区「${workspaceName}」。`,
    "文件操作优先直接使用 Pi 内核原生工具，不要寻找同名 local_* 替代工具：",
    "- read：读取文本文件或指定行段。",
    "- grep：搜索文件内容；find：按路径或文件名查找；ls：列出目录。",
    "- write：创建或覆盖文本文件；edit：精确修改文本文件。",
    "命令执行必须在 Pi 原生 Shell 与右侧栏交互式 terminal_* 工具之间按任务性质路由：",
    `- 一次性、非交互、执行完即可退出且不依赖既有 Shell 状态的命令，优先使用 Pi 原生 ${nativeShell}。测试、单次构建、Git 操作和普通命令行诊断通常属于这一类。`,
    "- 仅当当前工具列表同时提供 terminal_*，并且用户明确要求在右侧栏/已有终端中执行、需要用户看见或接管过程、需要回答交互式提示或发送控制键、需要让开发服务器等长期进程持续运行并增量读取日志、需要跨命令保留工作目录/环境变量/Shell 函数/登录或 REPL 状态，或需要操作右侧栏中已经运行的进程时，才改用 terminal_*。",
    "- 用户只说“运行命令”“使用终端”或任务需要测试、构建、Git、进程检查和 CLI 诊断，本身不代表必须使用右侧栏终端；满足一次性非交互条件时仍使用 Pi 原生 Shell。不要为了选择工具而预先调用 terminal_list。",
    ...(platform === "windows"
      ? [
          "- 当前是 Windows 环境：Pi 原生命令工具是 powershell，不提供 bash；路径和命令必须使用 PowerShell/Windows 语法，不要调用 bash 或 WSL。右侧栏终端也不得因 Windows 路径而自行切换到 WSL，除非用户明确要求操作一个已经存在的 WSL 会话。",
        ]
      : [
          "- 当前是非 Windows 环境：Pi 原生命令工具是 bash；路径和命令必须使用当前 Unix 环境的 Bash/Unix 语法。",
        ]),
    "相对路径以当前工作区为根；未收到工具成功结果前不得声称已经读取、写入、修改或执行。",
    "Pi 原生工具不处理聊天附件、二进制直传、电脑图片预览或跨设备传输；遇到这些任务时使用当前列出的 Renge 专用工具。",
    "用户要求多步骤编码、构建或验证时，持续调用工具推进到完成、真实阻塞或用户中止，不要只汇报计划。",
  ].join("\n");
}
