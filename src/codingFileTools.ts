// The same argument contracts as Pi's read/edit and the app's resumable write.
export const CODING_FILE_TOOL_DEFINITIONS = [
  { type: "function" as const, function: { name: "read", description: "读取文件；offset 从 1 开始，limit 指定行数。",
    parameters: { type: "object", properties: { path: { type: "string" }, offset: { type: "number" }, limit: { type: "number" } }, required: ["path"] } } },
  { type: "function" as const, function: { name: "edit", description: "精确编辑文件。edits 中每项的 oldText 必须在原文件中唯一，多个替换不能重叠。",
    parameters: { type: "object", properties: { path: { type: "string" }, edits: { type: "array", items: { type: "object", properties: {
      oldText: { type: "string" }, newText: { type: "string" },
    }, required: ["oldText", "newText"] } } }, required: ["path", "edits"] } } },
  { type: "function" as const, function: { name: "write", description: "写入文件。首块使用 operation=overwrite、expected_bytes=0；后续块使用 append 并复制上次结果中的 nextExpectedBytes，避免重复写入。",
    parameters: { type: "object", properties: { path: { type: "string", minLength: 1 }, operation: { anyOf: [{ const: "overwrite", type: "string" }, { const: "append", type: "string" }] },
      expected_bytes: { type: "integer", minimum: 0 }, content: { type: "string", minLength: 1 } }, required: ["path", "operation", "expected_bytes", "content"] } } },
];

export type CodingFileToolResult = {
  result: { content: { type: string; text?: string }[]; details?: Record<string, unknown> };
  content?: string;
};
export type ExecuteCodingFileTool = (name: string, args: Record<string, unknown>, content: string | null,
  initialized: boolean, signal: AbortSignal) => Promise<CodingFileToolResult>;

export function httpCodingFileTools(signal: AbortSignal): ExecuteCodingFileTool {
  return async (name, args, content, initialized) => {
    const response = await fetch("/api/pi/file-tool", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal,
      body: JSON.stringify({ name, args, content, initialized }),
    });
    const result = await response.json();
    if (!response.ok || result.error) throw new Error(result.error || `文件工具执行失败：${response.status}`);
    return result;
  };
}
