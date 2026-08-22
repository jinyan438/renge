export type LocalTaskMessage = {
  role?: string;
  content?: string;
  attachments?: Array<{ name?: string }>;
};

export function shouldRequireLocalToolCall(
  messages: LocalTaskMessage[],
  workspaceAvailable: boolean,
  toolsAvailable = false,
) {
  if (!workspaceAvailable && !toolsAvailable) return false;

  const recentText = messages
    .slice(-4)
    .map((message) =>
      [
        message.content,
        ...(message.attachments ?? []).map((attachment) => attachment.name),
      ].join("\n"),
    )
    .join("\n")
    .toLowerCase();

  if (!recentText.trim()) return false;

  const operationPattern =
    /(安装|部署|启动|运行|构建|打包|验证|检查|创建|新建|写|编写|撰写|实现|开发|写入|生成|保存|存进|存入|存到|放到|放进|放入|放至|加到|拷贝|传输|上传|下载|发给我|发送|复制|还原|导出|导入|重命名|改名|名字改|文件夹名|移动|挪到|mkdir|删除|删掉|移除|读取|阅读|预览|查看|搜索|查找|筛选|比较|覆盖|编辑|替换|执行|代码|项目|html|npm run|build|test|lint|install|deploy|setup|start|serve|rename|move|create|delete|remove|read|preview|search|write|edit|replace|save|transfer|upload|download|send|copy|export|import)/i;
  const fileContextPattern =
    /(项目|网页|网站|游戏|html|css|依赖|脚本|附件|二进制|base64|zip|apk|图片|音频|视频|bat|cmd|文件|文件夹|目录|工作区|路径|package\.json|\.html|\.css|\.tsx|\.ts|\.js|\.json|\.md|\.txt|\.zip|\.apk|\.png|\.jpg|\.jpeg|\.webp|folder|directory|file|path|script|project|attachment|binary)/i;
  const shortExecutionPattern = /^(执行|执行吧|开始|开始吧|可以|确认|继续|run|go|ok|yes)$/i;
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");
  const latestText = latestUserMessage?.content?.trim().toLowerCase() ?? "";

  return (
    (operationPattern.test(recentText) && fileContextPattern.test(recentText)) ||
    (shortExecutionPattern.test(latestText) && operationPattern.test(recentText))
  );
}

export function shouldAutoContinueLocalTask(content: string) {
  const normalizedContent = content.trim();
  if (!normalizedContent) return false;

  return (
    /(还没有完成|尚未完成|需要继续|继续执行|下一步|还需要|待完成|未完成|没有完成|需要安装|需要创建|需要构建|need to continue|not complete|next step|still need)/i.test(
      normalizedContent,
    ) ||
    /(直接(?:开始|开)?写|开始(?:写|编写|撰写|创建)|现在(?:开始)?(?:写|编写|创建)|准备(?:写|编写|创建)|我(?:来|将|会|先)(?:为你)?(?:写|编写|撰写|创建|修改|测试|验证)|let me (?:write|apply|test|verify|start)|writing now|start writing|begin writing|write it out|i(?:'ll| will) (?:write|apply|test|verify|start))/i.test(
      normalizedContent,
    )
  );
}
