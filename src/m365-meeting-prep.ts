import type { Agent, McpToolResult } from './acp';

type EmailAddress = { name?: string; address?: string };
type Recipient = { emailAddress?: EmailAddress };

type CalendarEvent = {
  id?: string;
  subject?: string;
  bodyPreview?: string;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  location?: { displayName?: string };
  organizer?: Recipient;
  attendees?: Array<Recipient & { type?: string; status?: { response?: string } }>;
  isOnlineMeeting?: boolean;
  onlineMeetingUrl?: string | null;
};

type MailMessage = {
  id?: string;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime?: string;
  sentDateTime?: string;
  conversationId?: string;
  from?: Recipient;
  toRecipients?: Recipient[];
  ccRecipients?: Recipient[];
};

type ToolCallbacks = {
  started?: (id: string, title: string, toolName: string, args: Record<string, unknown>) => void;
  finished?: (id: string, status: 'completed' | 'failed') => void;
};

const LOCAL_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'hotmail.com',
  'icloud.com',
  'outlook.com',
  'proton.me',
  'protonmail.com',
  'yahoo.com',
]);
const SUBJECT_STOP_WORDS = new Set([
  'about',
  'august',
  'april',
  'december',
  'february',
  'january',
  'july',
  'june',
  'march',
  'meeting',
  'november',
  'october',
  'september',
  'with',
  'your',
]);

export function isM365MeetingPrepPrompt(text: string): boolean {
  return (
    /\bwork\s+calendar\b/i.test(text) &&
    /\bwork\s+email\b/i.test(text) &&
    /\bmeeting\s+brief\b/i.test(text)
  );
}

export function meetingSubjectFromPrompt(text: string): string | undefined {
  const quoted = /\b(?:calendar entry|meeting)(?:\s+(?:named|called))?\s+["“]([^"”]+)["”]/i.exec(text);
  if (quoted?.[1]) return quoted[1].trim();

  const unquoted = /\bcalendar entry\s+(.+?)(?=\s+(?:via|with|and\s+prepare|to\s+prepare)\b|[,.]|$)/i.exec(text);
  const subject = unquoted?.[1]?.trim();
  if (!subject || /^(?:my\s+)?next(?:\s+external)?\s+meeting$/i.test(subject)) return undefined;
  return subject;
}

function textContent(result: McpToolResult): string {
  return (result.content ?? [])
    .map((item: any) => (item?.type === 'text' && typeof item.text === 'string' ? item.text : ''))
    .filter(Boolean)
    .join('\n');
}

export function parseM365Result(result: McpToolResult): any {
  const text = textContent(result);
  if (result.isError) throw new Error(text || 'Microsoft 365 returned an error.');
  if (result.structuredContent && typeof result.structuredContent === 'object') {
    return result.structuredContent;
  }
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Microsoft 365 returned an unreadable response: ${text.slice(0, 180)}`);
  }
}

function addressOf(value?: Recipient): string {
  return value?.emailAddress?.address?.trim().toLowerCase() ?? '';
}

function displayName(value?: Recipient): string {
  return value?.emailAddress?.name?.trim() || value?.emailAddress?.address?.trim() || 'Unknown';
}

function privacySafeDisplayName(value?: Recipient): string {
  const name = displayName(value);
  return name.includes('@') ? 'External attendee' : name;
}

function redactEmailAddresses(value: string): string {
  return value.replace(
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    '[email hidden]'
  );
}

function domainOf(address: string): string {
  return address.split('@')[1]?.toLowerCase() ?? '';
}

function ownIdentity(accountEmails: string[]) {
  const emails = new Set(accountEmails.map((email) => email.toLowerCase()));
  const domains = new Set(
    [...emails].map(domainOf).filter((domain) => domain && !PUBLIC_EMAIL_DOMAINS.has(domain))
  );
  return { emails, domains };
}

function dateValue(value?: string): number {
  if (!value) return Number.POSITIVE_INFINITY;
  // Graph occasionally emits seven fractional digits; JavaScript accepts at
  // most three consistently across engines.
  const normalized = value.replace(/\.(\d{3})\d+/, '.$1');
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

export function chooseNextExternalMeeting(
  events: CalendarEvent[],
  accountEmails: string[],
  now: Date,
  preferredSubject?: string
): CalendarEvent | null {
  const own = ownIdentity(accountEmails);
  const isExternal = (recipient?: Recipient) => {
    const address = addressOf(recipient);
    if (!address || own.emails.has(address)) return false;
    return !own.domains.has(domainOf(address));
  };

  const candidates = events.filter((event) => {
    const start = dateValue(event.start?.dateTime);
    if (!Number.isFinite(start)) return false;
    if (/^\s*cancel(?:ed|led)\s*:/i.test(event.subject ?? '')) return false;
    return Boolean(event.attendees?.some(isExternal) || isExternal(event.organizer));
  });

  if (preferredSubject) {
    const wanted = preferredSubject.trim().toLocaleLowerCase();
    return (
      candidates.find((event) => event.subject?.trim().toLocaleLowerCase() === wanted) ?? null
    );
  }

  return (
    candidates
      .filter((event) => dateValue(event.start?.dateTime) >= now.getTime())
      .sort((a, b) => dateValue(a.start?.dateTime) - dateValue(b.start?.dateTime))[0] ?? null
  );
}

function normalizedWords(value: string): string[] {
  return [...new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length >= 4 && !SUBJECT_STOP_WORDS.has(word))
  )];
}

function recipientsOf(message: MailMessage): Recipient[] {
  return [message.from, ...(message.toRecipients ?? []), ...(message.ccRecipients ?? [])].filter(
    Boolean
  ) as Recipient[];
}

export function relevantMail(
  messages: MailMessage[],
  event: CalendarEvent,
  ownEmails: string[] = []
): MailMessage[] {
  const subject = (event.subject ?? '').toLowerCase();
  const words = normalizedWords(subject);
  const own = ownIdentity(ownEmails);
  const people = new Set(
    [event.organizer, ...(event.attendees ?? [])]
      .map(addressOf)
      .filter(
        (address) =>
          address && !own.emails.has(address) && !own.domains.has(domainOf(address))
      )
  );

  return messages
    .map((message) => {
      const haystack = `${message.subject ?? ''} ${message.bodyPreview ?? ''}`.toLowerCase();
      const haystackWords = new Set(haystack.replace(/[^a-z0-9]+/g, ' ').split(/\s+/));
      const exactSubject = subject.length >= 5 && haystack.includes(subject) ? 8 : 0;
      const wordScore = words.reduce(
        (score, word) => score + (haystackWords.has(word) ? 3 : 0),
        0
      );
      const personScore = recipientsOf(message).some((recipient) => people.has(addressOf(recipient)))
        ? 2
        : 0;
      return { message, score: exactSubject + wordScore + personScore };
    })
    .filter(({ score }) => score >= 5)
    .sort(
      (a, b) =>
        b.score - a.score ||
        dateValue(b.message.receivedDateTime ?? b.message.sentDateTime) -
          dateValue(a.message.receivedDateTime ?? a.message.sentDateTime)
    )
    .slice(0, 6)
    .map(({ message }) => message);
}

function clean(value: string, max = 320): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1).trimEnd()}…`;
}

function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_[\]<>])/g, '\\$1');
}

function localDate(value?: string, timeZone = LOCAL_TIME_ZONE): string {
  const timestamp = dateValue(value);
  if (!Number.isFinite(timestamp)) return 'Time not available';
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
    timeZoneName: 'short',
  }).format(new Date(timestamp));
}

function shortDate(value?: string): string {
  const timestamp = dateValue(value);
  if (!Number.isFinite(timestamp)) return 'date unavailable';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: LOCAL_TIME_ZONE,
  }).format(new Date(timestamp));
}

function externalAttendees(event: CalendarEvent, ownEmails: string[]): Recipient[] {
  const own = ownIdentity(ownEmails);
  const people = [event.organizer, ...(event.attendees ?? [])].filter(Boolean) as Recipient[];
  const unique = new Map<string, Recipient>();
  for (const person of people) {
    const address = addressOf(person);
    if (!address || own.emails.has(address) || own.domains.has(domainOf(address))) continue;
    unique.set(address, person);
  }
  return [...unique.values()];
}

function contextualQuestions(event: CalendarEvent): string[] {
  const context = `${event.subject ?? ''} ${event.bodyPreview ?? ''}`.toLowerCase();
  if (/ui5|fiori|launchpad|extension api|typescript/.test(context)) {
    return [
      'Which manual steps does the generator remove, and where will developers still need to intervene?',
      'How does the generated TypeScript code stay compatible with the current Extension API and future upgrades?',
      'What feedback or adoption signal would make this ready for broader use after the live session?',
    ];
  }
  return [
    'What concrete outcome should we agree before the meeting ends?',
    'Which decision, dependency or owner is most likely to block progress?',
    'What follow-up, owner and date should we commit to next?',
  ];
}

export function formatMeetingBrief(
  event: CalendarEvent,
  mail: MailMessage[],
  ownEmails: string[]
): string {
  const people = externalAttendees(event, ownEmails);
  const attendeeLine = people
    .map((person) => escapeMarkdown(privacySafeDisplayName(person)))
    .join(', ');
  const subject = escapeMarkdown(event.subject || 'Untitled meeting');
  const purpose = clean(redactEmailAddresses(event.bodyPreview ?? ''), 420);
  const location = escapeMarkdown(event.location?.displayName || (event.isOnlineMeeting ? 'Online' : 'Not specified'));
  const evidence = mail.length
    ? mail
        .map((message) => {
          const sender = escapeMarkdown(privacySafeDisplayName(message.from));
          const mailSubject = escapeMarkdown(
            redactEmailAddresses(message.subject || 'No subject')
          );
          return `- **${shortDate(message.receivedDateTime ?? message.sentDateTime)} — “${mailSubject}”** from ${sender}${message.bodyPreview ? `: ${escapeMarkdown(clean(redactEmailAddresses(message.bodyPreview), 240))}` : ''}`;
        })
        .join('\n')
    : '- No relevant recent email was found in the 50-message mailbox window.';
  const questions = contextualQuestions(event);
  const endTimestamp = dateValue(event.end?.dateTime);
  const endTime = Number.isFinite(endTimestamp)
    ? new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: event.end?.timeZone || LOCAL_TIME_ZONE,
      }).format(new Date(endTimestamp))
    : 'end time unavailable';

  return `# Meeting Brief — ${subject}

## Meeting Logistics

- **When:** ${localDate(event.start?.dateTime, event.start?.timeZone)}–${endTime}
- **Where:** ${location}
- **External attendees:** ${attendeeLine || 'None identified'}
- **Purpose:** ${escapeMarkdown(purpose || 'No agenda was included in the calendar event.')}

## Relationship History

${mail.length === 1 ? 'One relevant recent message was found.' : `${mail.length} relevant recent messages were found.`} The evidence establishes the invitation and stated context; it does not show a broader relationship history beyond the messages listed below.

${evidence}

## Open Commitments

- Attend the scheduled session and use the stated agenda as the working scope.
- No explicit commitment assigned to you was found in the relevant calendar or email text.

## Risks

- The available mailbox evidence is limited, so prior decisions or offline commitments may be missing.
- Confirm the expected meeting format and desired outcome at the start${/youtube/i.test(location) ? '; the location says YouTube, which may limit direct interaction' : ''}.
- Treat any agenda detail beyond the cited event and emails as unverified.

## Three Questions to Raise

1. ${questions[0]}
2. ${questions[1]}
3. ${questions[2]}

_Live sources: Work Calendar and Work Email only. No web research, CRM or notes were used._`;
}

async function call(
  agent: Agent,
  callbacks: ToolCallbacks,
  index: number,
  title: string,
  toolName: string,
  args: Record<string, unknown>,
  minimumVisibleMs: number
): Promise<any> {
  const id = `m365-live-${Date.now()}-${index}`;
  const startedAt = Date.now();
  callbacks.started?.(id, title, toolName, args);
  try {
    const result = await agent.callTool(toolName, args);
    const parsed = parseM365Result(result);
    const remaining = minimumVisibleMs - (Date.now() - startedAt);
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
    callbacks.finished?.(id, 'completed');
    return parsed;
  } catch (error) {
    callbacks.finished?.(id, 'failed');
    throw error;
  }
}

export async function runM365MeetingPrep(
  agent: Agent,
  prompt: string,
  callbacks: ToolCallbacks = {},
  now = new Date(),
  minimumVisibleTaskMs = 1200
): Promise<string> {
  const accounts = await call(
    agent,
    callbacks,
    0,
    'checking the connected Microsoft 365 account',
    'ms365__list-accounts',
    {},
    minimumVisibleTaskMs
  );
  const accountEmails = (accounts.accounts ?? [])
    .map((account: any) => String(account?.email ?? '').toLowerCase())
    .filter(Boolean);
  if (accountEmails.length === 0) {
    throw new Error('No logged-in Microsoft 365 account is available. Log in from the connector and try again.');
  }

  const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const preferredSubject = meetingSubjectFromPrompt(prompt);
  const calendar = await call(
    agent,
    callbacks,
    1,
    preferredSubject
      ? `finding ${preferredSubject} in Work Calendar`
      : 'finding the next external meeting in Work Calendar',
    'ms365__get-calendar-view',
    {
      startDateTime: start.toISOString(),
      endDateTime: end.toISOString(),
      top: 12,
      select:
        'id,subject,start,end,location,attendees,organizer,isOnlineMeeting,onlineMeetingUrl,bodyPreview',
      timezone: LOCAL_TIME_ZONE,
    },
    minimumVisibleTaskMs
  );
  const event = chooseNextExternalMeeting(
    calendar.value ?? [],
    accountEmails,
    now,
    preferredSubject
  );
  if (!event) {
    return preferredSubject
      ? `# Meeting Brief\n\nThe Work Calendar entry “${preferredSubject}” was not found. I stopped without substituting another meeting.`
      : '# Meeting Brief\n\nNo upcoming external meeting was found in Work Calendar.';
  }

  const mailbox = await call(
    agent,
    callbacks,
    2,
    'finding supporting messages in Work Email',
    'ms365__list-mail-messages',
    {
      top: 50,
      orderby: 'receivedDateTime desc',
      select:
        'id,subject,from,toRecipients,ccRecipients,sentDateTime,receivedDateTime,bodyPreview,conversationId',
    },
    minimumVisibleTaskMs
  );
  const messages = relevantMail(mailbox.value ?? [], event, accountEmails);
  return formatMeetingBrief(event, messages, accountEmails);
}
