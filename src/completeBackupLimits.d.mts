export const COMPLETE_BACKUP_MAX_ARCHIVE_BYTES: number;
export const COMPLETE_BACKUP_MAX_EXTRACTED_BYTES: number;
export function completeBackupSizeLimitError(kind: string, bytes: number): string;
