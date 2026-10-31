export type ChatBubbleCopyContent = {
  text: string;
  source: "selection" | "bubble";
};

export function getChatBubbleCopyContent(
  bubble: HTMLElement | null,
  fallbackText: string,
  selection: Selection | null,
): ChatBubbleCopyContent {
  const selectedText = selection?.toString() ?? "";
  const selectionIsInsideBubble = Boolean(
    bubble &&
      selection &&
      !selection.isCollapsed &&
      selection.anchorNode &&
      selection.focusNode &&
      bubble.contains(selection.anchorNode) &&
      bubble.contains(selection.focusNode) &&
      selectedText.trim(),
  );

  if (selectionIsInsideBubble) {
    return { text: selectedText, source: "selection" };
  }

  return {
    text: bubble?.innerText.trim() || fallbackText,
    source: "bubble",
  };
}

export async function writeTextToClipboard(text: string, target: Window = window) {
  // React portals run in the opener's realm, but clipboard access and the DOM
  // fallback must belong to the window where the user clicked Copy.
  const { navigator, document } = target;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the DOM copy path for restricted browser contexts.
    }
  }

  const activeElement = document.activeElement as HTMLElement | null;
  const input = activeElement?.tagName === "INPUT" || activeElement?.tagName === "TEXTAREA"
    ? activeElement as HTMLInputElement | HTMLTextAreaElement : null;
  const inputSelection = input && input.selectionStart !== null
    ? { start: input.selectionStart, end: input.selectionEnd!, direction: input.selectionDirection! } : null;
  const selection = target.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
  const anchor = selection?.anchorNode;
  const focus = selection?.focusNode;
  const anchorOffset = selection?.anchorOffset ?? 0;
  const focusOffset = selection?.focusOffset ?? 0;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.inset = "0 auto auto 0";
  textarea.style.opacity = "0";
  textarea.tabIndex = -1;
  document.body.appendChild(textarea);
  let copied = false;
  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    copied = typeof document.execCommand === "function" && document.execCommand("copy");
  } finally {
    textarea.remove();
    if (activeElement?.isConnected) activeElement.focus({ preventScroll: true });
    if (selection) {
      selection.removeAllRanges();
      if (ranges.length === 1 && anchor?.isConnected && focus?.isConnected) {
        selection.setBaseAndExtent(anchor, anchorOffset, focus, focusOffset);
      } else {
        for (const range of ranges) selection.addRange(range);
      }
    }
    if (input?.isConnected && inputSelection) input.setSelectionRange(inputSelection.start, inputSelection.end, inputSelection.direction);
  }
  if (!copied) throw new Error("浏览器未允许写入剪贴板。");
}
