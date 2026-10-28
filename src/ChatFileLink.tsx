import type { ReactNode } from "react";
import { openChatFile, type ChatFileTarget } from "./chatFileLinks";

export function ChatFileLink({ target, children, markdown = false }: { target: ChatFileTarget; children: ReactNode; markdown?: boolean }) {
  return <a className="chat-file-link" href={`#file=${encodeURIComponent(target.path)}`}
    data-file-path={target.path} data-file-line={target.line} data-file-markdown={markdown || undefined} title={`打开 ${target.path}${target.line ? `:${target.line}` : ""}`}
    onClick={event => { event.preventDefault(); event.stopPropagation(); if (!event.currentTarget.closest('[contenteditable="true"]')) openChatFile(target); }}>
    {children}
  </a>;
}
