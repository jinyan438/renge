import { getActiveDesktopWindow } from "./NativeDesktopWindow";
import "./desktop-dialogs.css";

const pendingWindows = new WeakSet<Window>();

function showDesktopDialog(message: string, target: Window, confirmation: boolean): Promise<boolean> {
  // Synchronous JavaScript dialogs can leave an Electron portal window unable
  // to accept keyboard input. Keep the dialog and its focus in the same document.
  if (target.closed || pendingWindows.has(target)) return Promise.resolve(false);
  pendingWindows.add(target);
  return new Promise(resolve => {
    const doc = target.document;
    const dialog = doc.createElement("dialog");
    dialog.className = "desktop-message-dialog";
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "desktop-message-title");
    dialog.setAttribute("aria-describedby", "desktop-message-text");
    const title = doc.createElement("h2");
    title.id = "desktop-message-title";
    title.textContent = confirmation ? "确认操作" : "提示";
    const text = doc.createElement("p");
    text.id = "desktop-message-text";
    text.textContent = message;
    const actions = doc.createElement("div");
    actions.className = "desktop-message-actions";
    let settled = false;
    const finish = (accepted: boolean) => {
      if (settled) return;
      settled = true;
      target.removeEventListener("pagehide", cancel);
      target.removeEventListener("beforeunload", cancel);
      if (dialog.open) dialog.close();
      dialog.remove();
      pendingWindows.delete(target);
      resolve(accepted);
    };
    const cancel = () => finish(false);
    const addButton = (label: string, accepted: boolean) => {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = accepted ? "small-action" : "ghost-action";
      button.textContent = label;
      button.addEventListener("click", () => finish(accepted));
      actions.append(button);
      return button;
    };
    const initialFocus = confirmation ? addButton("取消", false) : null;
    const confirm = addButton("确定", true);
    dialog.append(title, text, actions);
    dialog.addEventListener("cancel", event => {
      event.preventDefault();
      cancel();
    });
    dialog.addEventListener("close", cancel);
    // Escape/Enter must not also reach the portal's global app shortcuts.
    dialog.addEventListener("keydown", event => event.stopPropagation());
    dialog.addEventListener("keyup", event => event.stopPropagation());
    target.addEventListener("pagehide", cancel);
    target.addEventListener("beforeunload", cancel);
    doc.body.append(dialog);
    try {
      // showModal supplies the focus trap, background inertness and focus
      // restoration without changing the native BrowserWindow's active state.
      dialog.showModal();
      (initialFocus ?? confirm).focus({ preventScroll: true });
    } catch {
      cancel();
    }
  });
}

export async function confirmAction(message: string, target = getActiveDesktopWindow()): Promise<boolean> {
  if (target.closed) return false;
  if (!window.rengeDesktop?.isElectron) return target.confirm(message);
  return showDesktopDialog(message, target, true);
}

export async function alertMessage(message: string, target = getActiveDesktopWindow()): Promise<void> {
  if (target.closed) return;
  if (!window.rengeDesktop?.isElectron) target.alert(message);
  else await showDesktopDialog(message, target, false);
}
