type FrameOwnerWindow = Window & {
  __rengePostToFrame?: (frame: HTMLIFrameElement, message: unknown, targetOrigin: string) => void;
};

export function postMessageToFrame(
  frame: HTMLIFrameElement | null,
  message: unknown,
  targetOrigin: string,
) {
  if (!frame) return;
  const owner = frame.ownerDocument.defaultView as FrameOwnerWindow | null;
  if (owner && owner !== window && owner.__rengePostToFrame) {
    owner.__rengePostToFrame(frame, message, targetOrigin);
    return;
  }
  frame.contentWindow?.postMessage(message, targetOrigin);
}
