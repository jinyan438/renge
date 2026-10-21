import { CircleCheck, CircleAlert, Info, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatComposerElapsed } from "./chatComposerStatusUtils";
import { ChatStatusSpinner } from "./ChatStatusSpinner";

export function ChatComposerStatus({ status, message, persistent = false, runStartedAt, onDismiss }: {
  status: "idle" | "loading" | "success" | "error" | "info" | "warning";
  message: string;
  persistent?: boolean;
  runStartedAt?: number;
  onDismiss: () => void;
}) {
  const loading = status === "loading";
  const startedAt = useRef(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    setElapsed(loading && runStartedAt ? Math.floor((Date.now() - runStartedAt) / 1_000) : 0);
    if (!loading) return;
    startedAt.current = runStartedAt || Date.now();
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt.current) / 1_000));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [loading, runStartedAt]);

  useEffect(() => {
    if (persistent || (status !== "success" && status !== "idle" && status !== "info")) return;
    const timer = window.setTimeout(onDismiss, 6_000);
    return () => window.clearTimeout(timer);
  }, [status, message, persistent, onDismiss]);

  const Icon = status === "success" ? CircleCheck
    : status === "error" ? CircleAlert
    : status === "warning" ? TriangleAlert : Info;

  return (
    <div className={`chat-status ${status}`}>
      {loading ? <ChatStatusSpinner size={15} aria-hidden="true" /> : <Icon size={15} aria-hidden="true" />}
      <span className="chat-status-message" role={status === "error" ? "alert" : "status"} aria-live={status === "error" ? "assertive" : "polite"} aria-atomic="true">
        {message}
      </span>
      {loading ? (
        <span className="chat-status-elapsed" aria-hidden="true" title="本次处理已用时间">{formatComposerElapsed(elapsed)}</span>
      ) : (
        <button type="button" className="chat-status-dismiss" onClick={onDismiss} aria-label="关闭提示" title="关闭提示">
          <X size={14} />
        </button>
      )}
    </div>
  );
}
