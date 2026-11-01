export type AttachmentKind = 'presentation' | 'document' | 'text' | 'image' | 'table';

/** Chat files at once (the dialog and drag and drop). Keep in step with MAX_ATTACHMENTS in electron/attachments.mjs. */
export const MAX_CHAT_ATTACHMENTS = 25;

export type BulkUploadResult = {
  ok: boolean;
  cancelled?: boolean;
  error?: string;
  failedBatch?: number;
  nextBatch?: number;
  sentBatches?: number;
  sentRows?: number;
  total?: number;
  totalRows?: number;
  batchId?: string;
};

/** csv, tsv and xlsx files can be turned into a Space or sent to a webhook. */
export function isTableFile(name: string): boolean {
  return /\.(csv|tsv|xlsx)$/i.test(name);
}

export type ChatAttachment = {
  id: string;
  name: string;
  path: string;
  uri: string;
  size: number;
  mimeType: string;
  kind: AttachmentKind;
  extractedText: string;
  imageData: string;
  warning: string;
};

export type AttachmentPickerResult = {
  files: ChatAttachment[];
  errors: string[];
};

export type MessageAttachment = Pick<ChatAttachment, 'name' | 'kind' | 'mimeType'>;

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
