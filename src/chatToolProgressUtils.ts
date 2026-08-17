export type ChatToolProgressLink = {
  label: string;
  href?: string;
};

export type ChatToolProgressBlock = {
  variant: "action" | "success" | "error";
  title: string;
  badge: string;
  links: ChatToolProgressLink[];
  details: string[];
};

type ReplayableToolCall = {
  function: {
    name: string;
    arguments: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export function compactToolCallForReplay<T extends ReplayableToolCall>(toolCall: T): T {
  const toolName = toolCall.function.name;
  if (toolName !== "local_write_file" && toolName !== "local_write_binary_file") {
    return toolCall;
  }

  try {
    const args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
    const payloadKey = toolName === "local_write_file" ? "content" : "base64";
    const payload = typeof args[payloadKey] === "string" ? args[payloadKey] : "";
    if (payload.length <= 4096) return toolCall;
    return {
      ...toolCall,
      function: {
        ...toolCall.function,
        arguments: JSON.stringify({
          ...args,
          [payloadKey]: `[工具执行时已提供，后续上下文省略 ${payload.length} 个字符]`,
        }),
      },
    } as T;
  } catch {
    return toolCall;
  }
}

export const toolActionTitleMap: ReadonlyArray<readonly [string, string]> = [
  ["打开网页", "浏览器导航"],
  ["预览临时文件：", "预览临时文件"],
  ["控制浏览器历史", "浏览器导航"],
  ["读取网页", "读取网页"],
  ["点击网页元素", "浏览器点击"],
  ["悬浮网页元素", "浏览器悬浮"],
  ["输入网页内容", "浏览器输入"],
  ["选择网页选项", "浏览器选择"],
  ["滚动网页", "浏览器滚动"],
  ["拖拽网页元素", "浏览器拖拽"],
  ["发送网页按键", "浏览器按键"],
  ["编辑网页", "编辑网页"],
  ["执行页面脚本", "页面脚本"],
  ["列出右侧栏终端。", "列出终端"],
  ["新建终端：", "新建终端"],
  ["读取终端：", "读取终端"],
  ["输入终端：", "终端输入"],
  ["在终端运行：", "运行终端命令"],
  ["调整终端：", "调整终端"],
  ["重启终端：", "重启终端"],
  ["关闭终端：", "关闭终端"],
  ["列出文件", "列出文件"],
  ["预览电脑图片", "预览图片"],
  ["读取二进制文件", "读取二进制"],
  ["读取文件片段", "读取文件片段"],
  ["读取文件", "读取文件"],
  ["查看路径信息", "查看路径信息"],
  ["搜索文件", "搜索文件"],
  ["创建目录", "创建目录"],
  ["重命名/移动", "重命名/移动"],
  ["运行脚本", "运行脚本"],
  ["运行命令", "运行命令"],
  ["查看 Git 状态", "查看 Git 状态"],
  ["查看 Git diff", "查看 Git diff"],
  ["检测项目技术栈", "检测项目技术栈"],
  ["查找符号", "查找符号"],
  ["正则搜索", "正则搜索"],
  ["读取 package.json", "读取 package.json"],
  ["扫描 TODO/FIXME", "扫描 TODO/FIXME"],
  ["写入文件", "写入文件"],
  ["写入二进制文件", "写入二进制"],
  ["上传附件直传电脑", "附件直传"],
  ["手机传到电脑", "文件直传"],
  ["电脑传到手机", "文件直传"],
  ["发送电脑文件给用户", "发送文件"],
  ["修改文件", "修改文件"],
  ["删除路径", "删除路径"],
  ["主 Agent 正在委派给", "委派子任务"],
];

const browserResultTitleMap: Record<string, string> = {
  navigate: "浏览器导航",
  history: "浏览器导航",
  read_page: "读取网页",
  click: "浏览器点击",
  hover: "浏览器悬浮",
  type: "浏览器输入",
  select: "浏览器选择",
  scroll: "浏览器滚动",
  drag: "浏览器拖拽",
  press_key: "浏览器按键",
  edit_page: "编辑网页",
  execute_script: "页面脚本",
};

function parseMarkdownLinks(content: string) {
  const links: ChatToolProgressLink[] = [];
  const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;

  while ((match = linkPattern.exec(content))) {
    links.push({
      label: match[1],
      href: match[2],
    });
  }

  return links;
}

function parseBareUrlLinks(lines: string[]) {
  return lines.flatMap((line) => {
    const normalizedLine = stripMarkdownLinks(line).trim();
    return /^https?:\/\/\S+$/i.test(normalizedLine)
      ? [{ label: normalizedLine, href: normalizedLine }]
      : [];
  });
}

export function stripMarkdownLinks(content: string) {
  return content.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
}

function uniqueToolLinks(links: ChatToolProgressLink[]) {
  const seenLinks = new Set<string>();
  return links.filter((link) => {
    const key = `${link.label}\n${link.href ?? ""}`;
    if (seenLinks.has(key)) return false;
    seenLinks.add(key);
    return true;
  });
}

function isLikelyToolPath(value: string) {
  const trimmedValue = value.trim();
  if (!trimmedValue || trimmedValue.length > 180) return false;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(trimmedValue)) return false;
  if (trimmedValue === ".") return true;
  return /[\\/]/.test(trimmedValue) || /\.[A-Za-z0-9]{1,12}$/.test(trimmedValue);
}

function parseToolPathFromLine(line: string) {
  const normalizedLine = stripMarkdownLinks(line).trim();
  const colonValue = normalizedLine.includes("：")
    ? normalizedLine.slice(normalizedLine.indexOf("：") + 1).trim()
    : "";
  const candidates = [
    colonValue,
    normalizedLine.replace(/^已修改\s+/, "").split(/[，(（]/)[0]?.trim() ?? "",
    normalizedLine.replace(/^已删除路径：/, "").trim(),
    normalizedLine.replace(/^已创建目录：/, "").trim(),
    normalizedLine.replace(/^已写入文件：/, "").trim(),
    normalizedLine.replace(/^已写入二进制文件：/, "").split(/[，(（]/)[0]?.trim() ?? "",
    normalizedLine.replace(/^已读取二进制文件：/, "").split(/[，(（]/)[0]?.trim() ?? "",
    normalizedLine.replace(/^已生成图片预览：/, "").split(/[，(（]/)[0]?.trim() ?? "",
    normalizedLine.replace(/^已读取文件：/, "").split(/[，(（]/)[0]?.trim() ?? "",
  ];
  return candidates.find(isLikelyToolPath) ?? "";
}

function getBrowserResultTitle(firstLine: string) {
  if (firstLine.startsWith("网页已打开：")) return browserResultTitleMap.navigate;
  if (firstLine.startsWith("临时文件已在浏览器打开：")) return "预览临时文件";
  if (firstLine.startsWith("浏览器操作完成：")) return browserResultTitleMap.history;
  if (firstLine.startsWith("网页读取完成：")) return browserResultTitleMap.read_page;
  if (!firstLine.startsWith("网页操作完成：")) return "";

  const operation = firstLine.slice(firstLine.indexOf("：") + 1).trim();
  return browserResultTitleMap[operation] ?? "浏览器操作";
}

function getTerminalResultTitle(firstLine: string) {
  if (/^已列出 \d+ 个终端。?$/.test(firstLine)) return "列出终端";
  if (firstLine.startsWith("已新建终端：")) return "新建终端";
  if (firstLine.startsWith("已读取终端：")) return "读取终端";
  if (/^已向终端 .+ 发送输入。?$/.test(firstLine)) return "终端输入";
  if (firstLine.startsWith("终端命令已发送：")) return "运行终端命令";
  if (/^已调整终端 .+ 的尺寸。?$/.test(firstLine)) return "调整终端";
  if (firstLine.startsWith("已重启终端：")) return "重启终端";
  if (firstLine.startsWith("已关闭终端：")) return "关闭终端";
  return "";
}

export function parseToolProgressContent(content: string): ChatToolProgressBlock | null {
  const lines = content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;

  const firstLine = lines[0];
  const links = uniqueToolLinks([
    ...parseMarkdownLinks(content),
    ...parseBareUrlLinks(lines),
  ]);
  const details = lines
    .map(stripMarkdownLinks)
    .map((line) => line.trim())
    .filter(Boolean);

  if (firstLine.startsWith("执行 MCP 工具：")) {
    const toolLabel = firstLine.replace("执行 MCP 工具：", "").trim();
    return {
      variant: "action",
      title: "MCP 工具",
      badge: "执行中",
      links: toolLabel ? [{ label: toolLabel }] : links,
      details: details.slice(1),
    };
  }

  if (firstLine.startsWith("MCP 工具失败：")) {
    const toolLabel = firstLine.replace("MCP 工具失败：", "").trim();
    return {
      variant: "error",
      title: "MCP 工具失败",
      badge: "失败",
      links: toolLabel ? [{ label: toolLabel }] : links,
      details: details.slice(1),
    };
  }

  if (firstLine.startsWith("操作失败：")) {
    const toolLabel = firstLine.replace("操作失败：", "").trim();
    return {
      variant: "error",
      title: "操作失败",
      badge: "失败",
      links: toolLabel ? [{ label: toolLabel }, ...links] : links,
      details: details.slice(1),
    };
  }

  const actionTitle = toolActionTitleMap.find(([prefix]) => firstLine.startsWith(prefix))?.[1];
  if (actionTitle) {
    const inlineDetail = firstLine.includes("：")
      ? stripMarkdownLinks(firstLine.slice(firstLine.indexOf("：") + 1)).trim()
      : "";
    const actionDetails = [
      inlineDetail && inlineDetail !== actionTitle ? inlineDetail : "",
      ...details.slice(1),
    ].filter(Boolean);

    return {
      variant: "action",
      title: actionTitle,
      badge: "执行中",
      links,
      details: actionDetails,
    };
  }

  let title = getBrowserResultTitle(firstLine) || getTerminalResultTitle(firstLine);
  if (/^列出 \d+ 个条目。?$/.test(firstLine)) title = "列出文件";
  else if (/^找到 \d+ 条结果。?$/.test(firstLine)) title = "搜索结果";
  else if (firstLine.startsWith("已生成图片预览：")) title = "预览图片";
  else if (firstLine.startsWith("已读取二进制文件：")) title = "读取二进制";
  else if (firstLine.startsWith("已写入二进制文件：")) title = "写入二进制";
  else if (firstLine.startsWith("附件直传完成：")) title = "附件直传";
  else if (firstLine.startsWith("文件直传完成：")) title = "文件直传";
  else if (firstLine.startsWith("已读取文件：") || /^已读取 .+ 第 /.test(firstLine)) title = "读取文件";
  else if (firstLine.startsWith("已查看路径信息：")) title = "查看路径信息";
  else if (firstLine.startsWith("已创建目录：")) title = "创建目录";
  else if (firstLine.startsWith("已重命名/移动：")) title = "重命名/移动";
  else if (firstLine.startsWith("已写入文件：")) title = "写入文件";
  else if (firstLine.startsWith("编辑了 ")) title = "修改文件";
  else if (firstLine.startsWith("已删除路径：")) title = "删除路径";
  else if (firstLine.startsWith("脚本执行完成：")) title = "运行脚本";
  else if (firstLine.startsWith("命令执行完成：")) title = "运行命令";
  else if (firstLine.startsWith("命令执行失败")) title = "运行命令";
  else if (firstLine.startsWith("用户取消授权")) title = "运行命令";
  else if (firstLine.startsWith("Git 状态读取完成")) title = "Git 状态";
  else if (firstLine.startsWith("Git diff 读取完成")) title = "Git diff";
  else if (firstLine.startsWith("技术栈检测完成：")) title = "技术栈检测";
  else if (firstLine.startsWith("已读取 package.json")) title = "读取 package.json";
  else if (firstLine.startsWith("MCP 工具执行完成")) title = "MCP 工具";

  if (!title) return null;

  const inferredLinks = lines
    .map(parseToolPathFromLine)
    .filter(Boolean)
    .map((label) => ({ label }));

  return {
    variant: firstLine.startsWith("命令执行失败") || firstLine.startsWith("用户取消授权")
      ? "error"
      : "success",
    title,
    badge: firstLine.startsWith("命令执行失败") ? "失败" : "完成",
    links: uniqueToolLinks([...links, ...inferredLinks]),
    details,
  };
}
