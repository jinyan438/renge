type ParentFrameSnapshot = {
  currentMessageIndex: number;
  currentHtmlPartIndex?: number;
  parentMessageFrames?: Array<{ partIndex: number; attributes: Record<string, string> }>;
  parentGlobals?: Record<string, { get: unknown }>;
};

function installHtmlPreviewParentBridge(snapshot: ParentFrameSnapshot) {
  let mirrorKey = "";
  let mirror: Document;
  const getMessageDocument = () => {
    const frames = snapshot.parentMessageFrames ?? [{ partIndex: snapshot.currentHtmlPartIndex ?? 0, attributes: {} }];
    const key = JSON.stringify([snapshot.currentMessageIndex, snapshot.currentHtmlPartIndex, frames]);
    if (mirror && key === mirrorKey) return mirror;
    mirrorKey = key;
    mirror = document.implementation.createHTMLDocument("Message context");
    const chat = mirror.createElement("div");
    chat.id = "chat";
    const message = mirror.createElement("div");
    message.className = "mes";
    message.setAttribute("mesid", String(snapshot.currentMessageIndex));
    const text = mirror.createElement("div");
    text.className = "mes_text";
    message.append(text);
    chat.append(message);
    mirror.body.append(chat);
    frames.forEach(({ partIndex, attributes }) => {
      const frame = mirror.createElement("iframe");
      const frameDocument = document.implementation.createHTMLDocument("");
      Object.entries(attributes).forEach(([name, value]) => frameDocument.documentElement.setAttribute(name, value));
      Object.defineProperty(frame, "contentDocument", { value: frameDocument });
      Object.defineProperty(frame, "contentWindow", {
        value: partIndex === (snapshot.currentHtmlPartIndex ?? 0) ? window : null,
      });
      text.append(frame);
    });
    return mirror;
  };
  // A detached message snapshot supports legacy parent aliases without exposing
  // the host document or weakening the preview's separate origin.
  const parentFacade = new Proxy(window, {
    get(target, property) {
      if (property === "document") return getMessageDocument();
      if (typeof property === "string" && snapshot.parentGlobals?.[property]) {
        return { get: () => snapshot.parentGlobals?.[property]?.get };
      }
      if (property === "parent" || property === "top" || property === "window" || property === "self") return parentFacade;
      if (property === "postMessage") return window.parent.postMessage.bind(window.parent);
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  Object.defineProperty(window, "__rengeTavernParent", { configurable: true, value: parentFacade });
}

export const HTML_PREVIEW_PARENT_BRIDGE_SOURCE = `(${installHtmlPreviewParentBridge.toString()})(snapshot);`;
