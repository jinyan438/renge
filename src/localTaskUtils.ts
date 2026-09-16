export type LocalTaskMessage = {
  role?: string;
  content?: string;
  attachments?: Array<{ name?: string }>;
};

const LOCAL_TASK_PENDING_PATTERN =
  /(还没有完成|还没完成|尚未完成|需要继续|继续执行|继续(?:实现|编写|撰写|写|做|改)|接下来|下一步|还需要|待完成|未完成|没有完成|需要安装|需要创建|需要构建|need to continue|not complete|next step|still need|followed by)/i;
const LOCAL_TASK_ACTION_PATTERN =
  /(直接(?:开始|开)?写|开始(?:写|编写|撰写|创建)|现在(?:开始)?(?:写|编写|创建)|准备(?:写|编写|创建)|我(?:来|将|会|先)(?:为你)?(?:写|编写|撰写|创建|修改|测试|验证)|let me (?:write|apply|test|verify|start)|writing now|start writing|begin writing|write it out|i(?:'ll| will) (?:write|apply|test|verify|start))/i;
const LOCAL_TASK_COMPLETION_PATTERN =
  /((?:任务|工作|网页|网站|游戏|文件|代码|实现|修改|构建|测试|验证)?(?:已经|已)(?:全部)?(?:完成|创建|生成|写入|保存|构建|实现|修复|通过)|(?:完成|通过)(?:并)?(?:验证|测试)|(?:测试|构建|编译|检查|验证|运行)(?:全部)?(?:通过|成功)|(?:全部)?(?:通过|成功)(?:了)?[。！!]|\b(?:completed|done|finished)\b|\b(?:task|work|implementation|file|page|site|game|code|build|tests?|verification)\s+(?:(?:is|are|has been|have been)\s+)?(?:completed|done|finished|created|generated|written|saved|built|implemented|fixed|verified|passed)\b|\btests?\s+passed\b|\bbuild\s+(?:succeeded|passed)\b)/i;
const LOCAL_TASK_USER_BOUNDARY_PATTERN =
  /(需要的话|如果(?:你)?需要|如需|告诉我|请选择|选一个|是否(?:需要|要)|要不要|你想(?:要|先)|可选(?:功能|项)?|\bif you(?:'d| would)? (?:like|want|need)\b|\blet me know\b|\btell me which\b|\bwould you like\b|\bdo you want\b|\boptional\b)/i;
const LOCAL_TASK_TRUNCATED_FINISH_PATTERN =
  /^(length|max_tokens|max_output_tokens|token_limit)$/i;

/**
 * The model is explicitly blocked on the user: it asked a question, requested
 * missing input, or is awaiting a decision. Auto-continuing here is always
 * wrong, no matter how many "next step" phrases surround it, because no amount
 * of extra turns can supply the answer the model is waiting for.
 */
const LOCAL_TASK_USER_BLOCKING_PATTERN =
  /(请问|请确认|请你(?:确认|选择|提供|告知|决定)|需要你(?:先)?(?:提供|确认|选择|告知|决定)|等你(?:确认|回复|提供)|等待你|待你(?:确认|回复)|等你回复|等待(?:用户|你)(?:确认|输入|回复)|能否(?:提供|告知)|可以(?:提供|告知)吗|要不要我|需要我(?:继续|接着|帮你)?吗|是否要我|请示|由你决定|你决定|任你选|听你的|\bplease (?:confirm|provide|choose|select|specify|clarify|decide)\b|\bwaiting for you\b|\bawait(?:ing)? your\b|\bcould you (?:provide|confirm|clarify)\b|\bcan you (?:provide|confirm|clarify)\b|\bwhich (?:one|approach|option) (?:should|do you want)\b|\bneed (?:your|the) (?:input|confirmation|approval|api key|credentials)\b|\bcannot proceed without\b|\bunable to proceed without\b|\bblocked (?:on|by|until)\b)/i;

/**
 * A question mark ending the final sentence is a strong signal that the model
 * handed the turn back to the user. Only the trailing region is inspected so
 * that rhetorical questions mid-explanation do not suppress real work.
 */
const LOCAL_TASK_TRAILING_QUESTION_PATTERN = /[?？]\s*(?:[”"』」)】]*)\s*$/;

/**
 * Explicit stop/handoff phrasing. Even if earlier sentences mention pending
 * work, a closing handoff means the model considers its turn finished and is
 * waiting for the user to speak next.
 */
const LOCAL_TASK_HANDOFF_PATTERN =
  /(请(?:告诉我|告知|回复|吩咐)|告诉我即可|随时(?:告诉|说|找我)|听候(?:吩咐|指示)|等待(?:你的)?(?:指示|进一步|回复)|(?:有|还有)(?:其他|别的|其它)?(?:需要|问题)?(?:随时|可以)(?:说|告诉|找我)|\blet me know\b|\btell me (?:if|when|what)\b|\bfeel free to\b|\bawaiting (?:your )?(?:instructions|reply|response|feedback)\b|\bhappy to (?:help|continue) if\b)/i;

function getLastPatternIndex(value: string, pattern: RegExp) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const matcher = new RegExp(pattern.source, flags);
  let lastIndex = -1;
  for (const match of value.matchAll(matcher)) {
    lastIndex = match.index;
  }
  return lastIndex;
}

function hasPattern(value: string, pattern: RegExp) {
  return new RegExp(pattern.source, pattern.flags.replace("g", "")).test(value);
}

function getTrailingRegion(value: string, length = 240) {
  const normalized = value.trim();
  return normalized.length <= length ? normalized : normalized.slice(-length);
}

/**
 * True when the final sentence of the turn is a completion claim and nothing
 * after it reopens work. Used to keep a genuinely finished job from being
 * extended just because the provider reported a length-limited finish.
 */
function isTrailingCompletionClaim(value: string, completionIndex: number) {
  if (completionIndex < 0) return false;
  const tail = value.slice(completionIndex);
  // Anything after the completion claim that reopens work invalidates it.
  if (
    hasPattern(tail, LOCAL_TASK_PENDING_PATTERN) ||
    hasPattern(tail, LOCAL_TASK_ACTION_PATTERN)
  ) {
    return false;
  }
  // The claim must sit near the end of the turn, not in an early paragraph.
  const trailingRegion = getTrailingRegion(value, 80);
  return hasPattern(trailingRegion, LOCAL_TASK_COMPLETION_PATTERN);
}

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

export function shouldAutoContinueLocalTask(content: string, finishReason = "") {
  const normalizedContent = content.trim();
  const truncated = LOCAL_TASK_TRUNCATED_FINISH_PATTERN.test(finishReason.trim());

  // An empty turn carries no state of its own: only a truncated one is worth
  // re-entering, since a clean empty finish means the model simply stopped.
  if (!normalizedContent) return truncated;

  const trailingRegion = getTrailingRegion(normalizedContent);

  // The model is blocked on the user. Extra turns cannot resolve a question,
  // so never auto-continue; this takes priority over every progress signal.
  if (hasPattern(trailingRegion, LOCAL_TASK_USER_BLOCKING_PATTERN)) return false;

  const userBoundaryIndex = getLastPatternIndex(
    normalizedContent,
    LOCAL_TASK_USER_BOUNDARY_PATTERN,
  );
  const handoffIndex = getLastPatternIndex(normalizedContent, LOCAL_TASK_HANDOFF_PATTERN);
  const completionIndex = getLastPatternIndex(normalizedContent, LOCAL_TASK_COMPLETION_PATTERN);
  const pendingIndex = getLastPatternIndex(normalizedContent, LOCAL_TASK_PENDING_PATTERN);
  const actionIndex = getLastPatternIndex(normalizedContent, LOCAL_TASK_ACTION_PATTERN);

  // A closing handoff or an "if you need..." offer means the model ended its
  // turn on purpose and is waiting for the user, even if it named pending work.
  if (handoffIndex >= 0 && handoffIndex >= Math.max(pendingIndex, actionIndex)) return false;
  if (userBoundaryIndex >= 0 && userBoundaryIndex >= Math.max(pendingIndex, actionIndex)) {
    return false;
  }
  if (LOCAL_TASK_TRAILING_QUESTION_PATTERN.test(normalizedContent)) return false;

  // Work is explicitly still pending after the last completion claim.
  if (pendingIndex > completionIndex) return true;

  // A truncated turn cannot be trusted to have finished, even when the partial
  // text contains a completion phrase. The provider cut the model off, so there
  // is almost always a half-written file or unfinished step behind that phrase.
  // The one exception is a turn whose closing sentence is itself a completion
  // claim with no pending work after it: that is a finished job that merely hit
  // the output limit on trailing prose.
  if (truncated && !isTrailingCompletionClaim(normalizedContent, completionIndex)) return true;

  // A completion claim must be the latest progress state to end the run.
  if (completionIndex >= 0 && completionIndex >= Math.max(pendingIndex, actionIndex)) {
    return false;
  }

  // The model announced an imminent action but produced no tool call.
  if (actionIndex >= 0) return true;

  // No recognizable state at all: only a truncated turn justifies re-entering
  // with a generic nudge. A clean finish with no pending work is truly done.
  return truncated;
}
