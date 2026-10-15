import { useEffect, useRef, useState } from "react";
import "./pi-extension-dialog.css";

export type PiExtensionEventFields = {
  id?: string;
  method?: string;
  title?: string;
  message?: unknown;
  options?: string[];
  placeholder?: string;
  prefill?: string;
  notifyType?: "info" | "warning" | "error";
  statusKey?: string;
  statusText?: string;
  widgetKey?: string;
  widgetLines?: string[];
  text?: string;
  entry?: { id?: string; customType?: string; data?: unknown };
  extensionPath?: string;
  path?: string;
  error?: string;
};
type DialogRequest = PiExtensionEventFields & { runId?: string };
type PendingDialog = { event: DialogRequest; cleanup: () => void; onError: (message: string) => void };

export function usePiExtensionDialogs() {
  const pending = useRef(new Map<string, PendingDialog>());
  const [dialogs, setDialogs] = useState<PendingDialog[]>([]);
  const sync = () => setDialogs([...pending.current.values()]);
  const cancel = (event: DialogRequest) => {
    const key = `${event.runId}:${event.id}`;
    pending.current.get(key)?.cleanup();
    pending.current.delete(key);
    sync();
  };
  useEffect(() => () => {
    for (const dialog of pending.current.values()) dialog.cleanup();
    pending.current.clear();
  }, []);
  const request = (event: DialogRequest, signal: AbortSignal | undefined, onError: (message: string) => void) => {
    if (!event.runId || !event.id || signal?.aborted) return;
    const key = `${event.runId}:${event.id}`;
    if (pending.current.has(key)) return;
    const onAbort = () => cancel(event);
    signal?.addEventListener("abort", onAbort, { once: true });
    pending.current.set(key, { event, onError, cleanup: () => signal?.removeEventListener("abort", onAbort) });
    sync();
  };
  const respond = async (dialog: PendingDialog, answer: { cancelled?: boolean; confirmed?: boolean; value?: string }) => {
    try {
      const response = await fetch("/api/pi/extension-ui-response", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: dialog.event.runId, id: dialog.event.id, ...answer }),
      });
      if (!response.ok && response.status !== 404) throw new Error(`扩展交互提交失败：${response.status}`);
      cancel(dialog.event);
    } catch (error) {
      dialog.onError(error instanceof Error ? error.message : String(error));
      throw error;
    }
  };
  const first = dialogs[0];
  return {
    request, cancel,
    dialog: first ? <PiExtensionDialog key={`${first.event.runId}:${first.event.id}`} event={first.event}
      respond={(answer) => respond(first, answer)} /> : null,
  };
}

function PiExtensionDialog({ event, respond }: {
  event: DialogRequest;
  respond: (answer: { cancelled?: boolean; confirmed?: boolean; value?: string }) => Promise<void>;
}) {
  const [value, setValue] = useState(event.prefill ?? event.options?.[0] ?? "");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submit = (answer: Parameters<typeof respond>[0]) => {
    if (submitting) return;
    setSubmitting(true);
    void respond(answer).catch((reason) => {
      setError(reason instanceof Error ? reason.message : String(reason));
      setSubmitting(false);
    });
  };
  return <div className="modal-backdrop pi-extension-dialog-backdrop" role="dialog" aria-modal="true"
    aria-label={event.title || "Pi 扩展交互"} onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); submit({ cancelled: true }); }
    }}>
    <form className="pi-extension-dialog" onSubmit={(e) => {
      e.preventDefault();
      submit(event.method === "confirm" ? { confirmed: true } : { value });
    }}>
      <h2>{event.title || "Pi 扩展交互"}</h2>
      {typeof event.message === "string" && <p>{event.message}</p>}
      {event.method === "select" ? <select autoFocus aria-label={event.title} value={value}
        onChange={(e) => setValue(e.target.value)}>{event.options?.map((option) =>
          <option key={option} value={option}>{option}</option>)}</select>
        : event.method === "editor" ? <textarea autoFocus aria-label={event.title} value={value}
          onChange={(e) => setValue(e.target.value)} />
          : event.method === "input" ? <input autoFocus aria-label={event.title} placeholder={event.placeholder}
            value={value} onChange={(e) => setValue(e.target.value)} /> : null}
      {error && <p role="alert">{error}</p>}
      <div className="pi-extension-dialog-actions">
        <button type="button" className="ghost-action" disabled={submitting}
          onClick={() => submit({ cancelled: true })}>取消</button>
        <button type="submit" className="primary-action" autoFocus={event.method === "confirm"}
          disabled={submitting || (event.method === "select" && !event.options?.length)}>确定</button>
      </div>
    </form>
  </div>;
}
