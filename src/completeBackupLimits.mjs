export const COMPLETE_BACKUP_MAX_ARCHIVE_BYTES = 2 * 1024 ** 3 - 1;
export const COMPLETE_BACKUP_MAX_EXTRACTED_BYTES = 8 * 1024 ** 3;

export function completeBackupSizeLimitError(kind, bytes) {
  const size = bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(0)} GB`
    : `${bytes} 字节`;
  return `完整备份${kind}超过 ${size} 上限。`;
}
