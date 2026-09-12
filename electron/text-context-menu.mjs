export function createTextContextMenuTemplate({
  hasSelection = false,
  hasClipboardText = false,
} = {}) {
  return [
    {
      label: "复制",
      action: "copy",
      enabled: Boolean(hasSelection),
    },
    {
      label: "粘贴",
      action: "paste",
      enabled: Boolean(hasClipboardText),
    },
    {
      label: "剪切",
      action: "cut",
      enabled: Boolean(hasSelection),
    },
  ];
}
