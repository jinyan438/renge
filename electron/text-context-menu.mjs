export function createTextContextMenuTemplate({
  hasSelection = false,
  hasClipboardText = false,
} = {}) {
  return [
    {
      label: "复制",
      role: "copy",
      enabled: Boolean(hasSelection),
    },
    {
      label: "粘贴",
      role: "paste",
      enabled: Boolean(hasClipboardText),
    },
    {
      label: "剪切",
      role: "cut",
      enabled: Boolean(hasSelection),
    },
  ];
}
