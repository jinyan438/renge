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

export async function writeTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the DOM copy path for restricted browser contexts.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } finally {
    textarea.remove();
  }
  if (!copied) throw new Error("浏览器未允许写入剪贴板。");
}
