import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import "./native-desktop-window.css";

export type NativeDesktopWindowState = {
  id: string;
  closed?: boolean;
  maximized?: boolean;
  minimized?: boolean;
  focused?: boolean;
};

const DesktopWindowContext = createContext<Window | null>(null);
const nativeWindows = new Map<string, Window>();
let lastActiveDesktopWindow: Window | null = null;

export function nativeDesktopWindowsEnabled() {
  return Boolean(window.rengeDesktop?.isElectron && window.rengeDesktop.controlDesktopWindow);
}

export function useDesktopWindow() {
  return useContext(DesktopWindowContext) ?? window;
}

export function getDesktopWindow(id: string) {
  return nativeWindows.get(id) ?? window;
}

export function getActiveDesktopWindow() {
  // Portal documents can all report hasFocus() in Electron. Track actual
  // interaction instead; this also survives focus moving to a native file picker.
  return lastActiveDesktopWindow && !lastActiveDesktopWindow.closed
    ? lastActiveDesktopWindow
    : window;
}

export function NativeDesktopWindow({
  id,
  title,
  focusKey = 0,
  onClose,
  onStateChange,
  children,
}: {
  id: string;
  title: string;
  focusKey?: number;
  onClose: () => void;
  onStateChange?: (state: NativeDesktopWindowState) => void;
  children: ReactNode;
}) {
  const [host, setHost] = useState<Window | null>(null);
  const [failed, setFailed] = useState(false);
  const callbacks = useRef({ onClose, onStateChange });
  callbacks.current = { onClose, onStateChange };
  const enabled = nativeDesktopWindowsEnabled();

  useLayoutEffect(() => {
    if (!enabled) return;
    const popup = window.open(new URL("/desktop-window.html", window.location.href).href, `renge-desktop-${id}`);
    if (!popup) { setFailed(true); return; }
    let disposed = false;
    let disposeHost: (() => void) | undefined;
    const mount = () => {
      if (disposed || popup.closed) return;
      const doc = popup.document;
      doc.title = `Renge Agent Lab — ${title}`;
      doc.documentElement.lang = document.documentElement.lang;
      const base = doc.createElement("base");
      base.href = document.baseURI;
      doc.head.appendChild(base);
      const styleCopies = new Map<Element, Node>();
      const syncStyles = () => {
        for (const [source, copy] of styleCopies) {
          if (!source.isConnected) { copy.parentNode?.removeChild(copy); styleCopies.delete(source); }
        }
        for (const source of document.head.querySelectorAll('link[rel="stylesheet"], style')) {
          const oldCopy = styleCopies.get(source);
          if (oldCopy?.isEqualNode(source)) continue;
          const copy = source.cloneNode(true);
          if (oldCopy) oldCopy.parentNode?.replaceChild(copy, oldCopy);
          else doc.head.appendChild(copy);
          styleCopies.set(source, copy);
        }
      };
      syncStyles();
      const observer = new MutationObserver(syncStyles);
      observer.observe(document.head, { childList: true, subtree: true, characterData: true, attributes: true });
      doc.body.className = "native-desktop-window";
      doc.body.dataset.desktopWindow = id;
      const root = doc.createElement("div");
      root.id = "root";
      doc.body.appendChild(root);
      nativeWindows.set(id, popup);
      const activate = () => { lastActiveDesktopWindow = popup; };
      const activateHome = () => { lastActiveDesktopWindow = window; };
      popup.addEventListener("focus", activate);
      for (const event of ["pointerdown", "keydown", "change"]) {
        doc.addEventListener(event, activate, true);
        document.addEventListener(event, activateHome, true);
      }
      window.addEventListener("focus", activateHome);
      setHost(popup);
      const unsubscribe = window.rengeDesktop?.onDesktopWindowState?.((state) => {
        if (state.id !== id) return;
        if (state.focused) activate();
        if (state.closed) callbacks.current.onClose();
        else callbacks.current.onStateChange?.(state);
      });
      // Existing global keyboard shortcuts (Escape, composer actions) must also
      // receive events from the child document. React input handlers stay local.
      const forwardKey = (event: KeyboardEvent) => {
        const forwarded = new KeyboardEvent(event.type, event);
        Object.defineProperty(forwarded, "target", { value: event.target });
        if (!window.dispatchEvent(forwarded)) event.preventDefault();
      };
      popup.addEventListener("keydown", forwardKey);
      popup.addEventListener("keyup", forwardKey);
      const forwardMessage = (event: MessageEvent) => {
        window.dispatchEvent(new MessageEvent("message", {
          data: event.data, origin: event.origin, source: event.source,
        }));
      };
      popup.addEventListener("message", forwardMessage);
      const onUnload = () => callbacks.current.onClose();
      popup.addEventListener("beforeunload", onUnload);
      disposeHost = () => {
        unsubscribe?.();
        observer.disconnect();
        popup.removeEventListener("keydown", forwardKey);
        popup.removeEventListener("keyup", forwardKey);
        popup.removeEventListener("message", forwardMessage);
        popup.removeEventListener("beforeunload", onUnload);
        popup.removeEventListener("focus", activate);
        for (const event of ["pointerdown", "keydown", "change"]) {
          doc.removeEventListener(event, activate, true);
          document.removeEventListener(event, activateHome, true);
        }
        window.removeEventListener("focus", activateHome);
        if (lastActiveDesktopWindow === popup) lastActiveDesktopWindow = null;
        nativeWindows.delete(id);
      };
    };
    popup.addEventListener("load", mount, { once: true });
    return () => {
      disposed = true;
      popup.removeEventListener("load", mount);
      disposeHost?.();
      if (!popup.closed) popup.close();
    };
  }, [enabled, id, title]);

  useEffect(() => {
    if (!host) return;
    // React has mounted the portal before revealing the native window.
    void window.rengeDesktop?.controlDesktopWindow?.({ id, action: "show" });
  }, [host, id, focusKey]);

  if (!host) return enabled && !failed ? null : children;
  return createPortal(
    <DesktopWindowContext.Provider value={host}>{children}</DesktopWindowContext.Provider>,
    host.document.getElementById("root")!,
  );
}
