import { useSyncExternalStore } from "react";
import type { ChatFileTarget } from "./chatFileLinks";

export type ChatFileAction = "default" | "openWith" | "reveal" | "download";
type Actions = { native: boolean; run: (target: ChatFileTarget, action: ChatFileAction) => Promise<void> };
let actions: Actions | undefined;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());
export function registerChatFileActions(next: Actions) {
  actions = next; notify();
  return () => { if (actions === next) { actions = undefined; notify(); } };
}
export function useChatNativeFileActions() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => actions?.native ?? false, () => false);
}
export async function runChatFileAction(target: ChatFileTarget, action: ChatFileAction) {
  if (!actions) throw new Error("当前没有可用的文件工作区。");
  await actions.run(target, action);
}
