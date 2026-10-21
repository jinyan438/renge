import { Copy } from "lucide-react";
import { memo, useMemo } from "react";
import { getToolOutputPreview } from "./toolOutputPreviewUtils";

export const ChatToolOutputPreview = memo(function ChatToolOutputPreview({ text, mode, command = "", waiting = false, onCopy }: {
  text: string;
  mode: "read" | "shell" | "result";
  command?: string;
  waiting?: boolean;
  onCopy: (text: string) => void;
}) {
  const preview = useMemo(() => getToolOutputPreview(text, mode !== "read"), [text, mode]);
  const commandPreview = useMemo(() => getToolOutputPreview(command, false, 8_000, 80), [command]);
  return <>
    {preview.truncated && <div className="pi-tool-output-notice">
      <span>{mode === "read" ? "输出较长，显示开头部分" : "输出较长，显示最近部分"}</span>
      <button type="button" className="chat-diff-copy" aria-label="复制完整工具输出" title="复制完整工具输出" onClick={() => onCopy(text)}><Copy size={14} /></button>
    </div>}
    {mode === "read" ? <div className="pi-tool-code-preview"><pre>{preview.text.split("\n").map((line, index) =>
      <span key={index}><i>{index + 1}</i>{line || " "}</span>,
    )}</pre></div> : mode === "shell" ? <div className="pi-tool-terminal-preview">
      {command && <div className="command"><b>$</b>{commandPreview.text}
        {commandPreview.truncated && <button type="button" className="chat-diff-copy" aria-label="复制完整命令" title="复制完整命令" onClick={() => onCopy(command)}><Copy size={14} /></button>}
      </div>}
      <pre>{preview.text || (waiting ? "等待输出…" : "无输出")}</pre>
    </div> : <pre className="pi-tool-result-preview">{preview.text}</pre>}
  </>;
});
