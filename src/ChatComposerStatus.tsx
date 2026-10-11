import { CircleCheck, CircleAlert, Info, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatComposerElapsed } from "./chatComposerStatusUtils";

export function ChatComposerStatus({ status, message, persistent = false, onDismiss }: {
  status: "idle" | "loading" | "success" | "error" | "info" | "warning";
  message: string;
  persistent?: boolean;
  onDismiss: () => void;
}) {
  const loading = status === "loading";
  const startedAt = useRef(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    setElapsed(0);
    if (!loading) return;
    startedAt.current = Date.now();
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt.current) / 1_000));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [loading]);

  useEffect(() => {
    if (persistent || (status !== "success" && status !== "idle" && status !== "info")) return;
    const timer = window.setTimeout(onDismiss, 6_000);
    return () => window.clearTimeout(timer);
  }, [status, message, persistent, onDismiss]);

  const Icon = loading ? LoaderCircle
    : status === "success" ? CircleCheck
    : status === "error" ? CircleAlert
    : status === "warning" ? TriangleAlert : Info;

  return (
    <div className={`chat-status ${status}`}>
      <Icon size={15} className={loading ? "chat-status-spinner" : undefined} aria-hidden="true" />
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
