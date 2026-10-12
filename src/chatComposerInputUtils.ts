export function shouldAttachPastedText(text: string) {
  return Boolean(text.trim()) && (text.length > 4_000 || text.split(/\r\n|\r|\n/).length > 40);
}

export function getPastedTextPreview(text: string) {
  return text.trim().replace(/\s+/g, " ").slice(0, 120);
}

export function resizeChatComposerInput(input: HTMLTextAreaElement) {
  const style = getComputedStyle(input);
  const minHeight = parseFloat(style.minHeight) || 0;
  const maxHeight = parseFloat(style.maxHeight) || Infinity;
  const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
  const border = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
  const scrollTop = input.scrollTop;
  input.style.height = "0px";
  input.style.overflowY = "hidden";
  const contentHeight = input.scrollHeight + (style.boxSizing === "border-box" ? border : -padding);
  input.style.height = `${Math.max(minHeight, Math.min(contentHeight, maxHeight))}px`;
  input.style.overflowY = contentHeight > maxHeight ? "auto" : "hidden";
  input.scrollTop = contentHeight > maxHeight ? scrollTop : 0;
}
