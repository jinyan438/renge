export type ChatInputMode = "queue" | "steer";
export type SessionRunStatus = {
  status: "idle" | "loading" | "success" | "error" | "info" | "warning";
  message: string;
};

/** Runtime state belongs to a conversation, never to the selected sidebar row. */
export function createChatSessionRuntime<Input>() {
  const sessions = new Map<string, {
    status: SessionRunStatus;
    inputMode: ChatInputMode;
    generationState: "idle" | "running" | "stopping";
    startedAt: number;
    controller: AbortController | null;
    piRunId: string;
    piReady: boolean;
    supportsSteering: boolean;
    queued: Input[];
    steering: Map<string, Input>;
    queuePaused: boolean;
    stopRequested: boolean;
    continueWith?: (input: Input) => Promise<void>;
  }>();
  const owners = new WeakMap<AbortController, string>();
  const runtime = {
    onChange: () => {},
    get(sessionId: string) {
      let session = sessions.get(sessionId);
      if (!session) {
        session = {
          status: { status: "idle", message: "" }, inputMode: "queue", generationState: "idle", startedAt: 0,
          controller: null, piRunId: "", piReady: false, supportsSteering: false,
          queued: [], steering: new Map(), queuePaused: false, stopRequested: false,
        };
        sessions.set(sessionId, session);
      }
      return session;
    },
    begin(sessionId: string) {
      const session = runtime.get(sessionId);
      if (session.controller) throw new Error("当前会话已有任务正在运行。");
      const controller = new AbortController();
      session.controller = controller;
      session.generationState = "running";
      session.startedAt = Date.now();
      session.piRunId = "";
      session.piReady = false;
      session.supportsSteering = false;
      session.stopRequested = false;
      owners.set(controller, sessionId);
      runtime.onChange();
      return controller;
    },
    owner(controller: AbortController) { return owners.get(controller); },
    finish(controller: AbortController) {
      const sessionId = owners.get(controller);
      if (sessionId === undefined) return;
      const session = runtime.get(sessionId);
      if (session.controller !== controller) return;
      session.controller = null;
      session.generationState = "idle";
      session.piReady = false;
      session.piRunId = "";
      runtime.onChange();
      return sessionId;
    },
    stop(sessionId: string, reason?: unknown) {
      const session = runtime.get(sessionId);
      session.queuePaused = true;
      session.stopRequested = true;
      if (session.controller) {
        session.generationState = "stopping";
        session.controller.abort(reason);
      }
      runtime.onChange();
    },
    takeNext(sessionId: string) {
      const session = runtime.get(sessionId);
      if (session.controller || session.queuePaused) return;
      const input = session.queued.shift();
      runtime.onChange();
      return input;
    },
    reset(sessionId: string) {
      const session = sessions.get(sessionId);
      if (session?.controller) throw new Error("请先停止此会话的任务，再重置会话。");
      sessions.delete(sessionId);
      runtime.onChange();
    },
    dispose() {
      for (const session of sessions.values()) session.controller?.abort();
      sessions.clear();
    },
  };
  return runtime;
}
