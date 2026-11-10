import { conversationFileName, conversationToMarkdown, type ConversationRecord } from './conversations.ts';

/** The "@" button in the chat bar: the conversation goes into a new e-mail as an attachment, with a suggested text. */
export type ChatMail = { subject: string; body: string; fileName: string; markdown: string };

type Source = Pick<ConversationRecord, 'title' | 'messages' | 'files'>;

const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};

/** Subject, body suggestion and the attachment (Markdown) for a conversation. The body names the topic and the last answer in short; nothing is sent. */
export function chatMail(conversation: Source, assistant = 'Joule', now = Date.now()): ChatMail {
  const title = clip(conversation.title, 80) || 'Conversation';
  const lastAnswer = [...conversation.messages].reverse().find((m) => m.role === 'agent' && (m.text ?? '').trim());
  const lines = [
    'Hello,',
    '',
    `attached is my conversation with ${assistant} about "${title}".`,
  ];
  if (lastAnswer) lines.push('', 'In short:', clip(lastAnswer.text ?? '', 400));
  lines.push('', 'Please have a look and tell me what you think.', '', 'Best regards');
  return {
    subject: `Conversation: ${title}`,
    body: lines.join('\n'),
    fileName: conversationFileName(conversation.title, now),
    markdown: conversationToMarkdown(conversation, assistant),
  };
}

/** Browser fallback: a mail draft cannot carry an attachment, so the text tells the sender to attach the saved file. */
export function chatMailtoUrl(mail: ChatMail): string {
  const body = `${mail.body}\n\n(Please attach the file ${mail.fileName}.)`;
  return `mailto:?subject=${encodeURIComponent(mail.subject)}&body=${encodeURIComponent(body)}`;
}
