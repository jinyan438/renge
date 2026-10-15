import { randomUUID } from "node:crypto";
import { Type } from "typebox";

const DEFAULT_YIELD_MS = 10_000;
const MAX_YIELD_MS = 60_000;
const yieldParameter = Type.Optional(Type.Number({
  description: "How long to wait for a result in milliseconds (0-60000, default 10000). This only yields control; it never stops the command or changes its timeout.",
  minimum: 0,
  maximum: MAX_YIELD_MS,
}));

function yieldDuration(value = DEFAULT_YIELD_MS) {
  if (!Number.isFinite(value) || value < 0 || value > MAX_YIELD_MS) {
    throw new Error(`yield_time_ms must be between 0 and ${MAX_YIELD_MS}`);
  }
  return value;
}

function checkSignal(signal) {
  if (signal?.aborted) throw new Error("Operation aborted");
}

/** Retains Pi's shell execution, output limits, exit codes and process-tree cleanup. */
export function createShellSessionManager({ onBackgroundUpdate } = {}) {
  const sessions = new Map();
  let disposed = false;
  let disposal;

  const findSession = (id) => {
    const session = sessions.get(id);
    if (!session) throw new Error("Unknown shell session. Use the session_id returned by this run's shell command; do not restart the command to check its status.");
    return session;
  };

  const snapshot = (session) => {
    const running = !session.finished;
    const status = running
      ? (session.controller.signal.aborted ? "stopping" : "running")
      : (session.controller.signal.aborted ? "stopped" : session.error ? "failed" : "completed");
    const result = session.result ?? session.latest ?? { content: [] };
    const text = result.content?.filter((block) => block.type === "text").map((block) => block.text).join("\n") || "(no output yet)";
    const notice = running
      ? `Command still ${status}. session_id: ${session.id}\nThe command has NOT timed out and continues running with its original timeout. Call shell_status with this session_id to read output and wait for completion, or shell_stop to stop it. Do not rerun the original command. Do not report success until completion. Sessions are stopped when this agent run ends.`
      : `Command ${status}. session_id: ${session.id}`;
    return {
      ...result,
      content: [{ type: "text", text: `${text}\n\n[${notice}]` }],
      details: { ...result.details, shellSession: { id: session.id, status, command: session.command, shell: session.shell } },
    };
  };

  const wait = async (session, duration, signal, onUpdate) => {
    checkSignal(signal);
    let timer;
    let onAbort;
    let onFinish;
    if (onUpdate) session.listeners.add(onUpdate);
    try {
      if (onUpdate && session.latest) onUpdate(session.latest);
      if (!session.finished) {
        await new Promise((resolve, reject) => {
          timer = setTimeout(resolve, duration);
          onAbort = () => reject(new Error("Operation aborted"));
          signal?.addEventListener("abort", onAbort, { once: true });
          onFinish = resolve;
          session.waiters.add(onFinish);
          if (signal?.aborted) onAbort();
        });
      }
      checkSignal(signal);
      if (!session.finished) session.yielded = true;
      const result = snapshot(session);
      if (session.finished && session.error && !session.controller.signal.aborted) {
        throw new Error(result.content[0].text);
      }
      return result;
    } finally {
      clearTimeout(timer);
      if (onAbort) signal?.removeEventListener("abort", onAbort);
      if (onFinish) session.waiters.delete(onFinish);
      if (onUpdate) session.listeners.delete(onUpdate);
    }
  };

  return {
    wrap(tool, authorize) {
      return {
        ...tool,
        description: `${tool.description} Commands that outlast yield_time_ms return a running session_id and current output while continuing in the background. Use shell_status to wait/read output and shell_stop to cancel. timeout still applies to the entire command; yielding does not reset or shorten it.`,
        parameters: Type.Object({ ...tool.parameters.properties, yield_time_ms: yieldParameter }),
        execute: async (id, args, signal, onUpdate, ctx) => {
          const duration = yieldDuration(args.yield_time_ms);
          await authorize(args, signal);
          checkSignal(signal);
          if (disposed) throw new Error("Shell sessions have been disposed");
          const controller = new AbortController();
          const session = {
            id: randomUUID(), command: args.command, shell: tool.name, controller,
            latest: undefined, result: undefined, error: false, finished: false,
            listeners: new Set(), waiters: new Set(), completion: undefined, yielded: false,
          };
          const publish = () => {
            if ((!disposed || session.finished) && session.yielded) onBackgroundUpdate?.({
              toolCallId: id, toolName: tool.name, result: snapshot(session),
              finished: session.finished, isError: session.error && !controller.signal.aborted,
            });
          };
          const abort = () => controller.abort();
          signal?.addEventListener("abort", abort, { once: true });
          sessions.set(session.id, session);
          const finish = (result, error) => {
            session.result = result;
            session.error = error;
            session.finished = true;
            signal?.removeEventListener("abort", abort);
            publish();
            for (const resolve of session.waiters) resolve();
            session.waiters.clear();
          };
          // Capture rejection immediately so commands that finish between polls
          // never become unhandled rejections or lose their diagnostic output.
          session.completion = Promise.resolve().then(() => tool.execute(id, args, controller.signal, (result) => {
            session.latest = result;
            for (const listener of session.listeners) listener(result);
            publish();
          }, ctx)).then(
            // Pi 1.2 shell tools return flagged error results for nonzero exits.
            (result) => finish(result, result?.isError === true),
            (error) => finish({ content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] }, true),
          );
          return wait(session, duration, signal, onUpdate);
        },
      };
    },
    tools: [
      {
        name: "shell_status",
        label: "Shell status",
        description: "Read the current output and status of a shell command from this agent run. Waits up to yield_time_ms for completion without stopping the process or changing/resetting its timeout. Poll the same session_id until completed/failed; never restart a running command to get output.",
        parameters: Type.Object({ session_id: Type.String(), yield_time_ms: yieldParameter }),
        execute: async (_id, args, signal, onUpdate) => wait(findSession(args.session_id), yieldDuration(args.yield_time_ms), signal, onUpdate),
      },
      {
        name: "shell_stop",
        label: "Stop shell command",
        description: "Stop a running shell command and its child process tree from this agent run. Returns output and status. If still stopping, use shell_status to confirm termination.",
        parameters: Type.Object({ session_id: Type.String() }),
        execute: async (_id, args, signal, onUpdate) => {
          checkSignal(signal);
          const session = findSession(args.session_id);
          if (!session.finished) session.controller.abort();
          return wait(session, DEFAULT_YIELD_MS, signal, onUpdate);
        },
      },
    ],
    dispose() {
      if (disposal) return disposal;
      disposed = true;
      const completions = [];
      for (const session of sessions.values()) {
        session.listeners.clear();
        if (!session.finished) session.controller.abort();
        completions.push(session.completion);
      }
      sessions.clear();
      disposal = Promise.allSettled(completions);
      return disposal;
    },
  };
}
