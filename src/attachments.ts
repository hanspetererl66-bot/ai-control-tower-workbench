export type AttachmentKind = 'presentation' | 'document' | 'text' | 'image';

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
