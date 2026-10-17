import assert from 'node:assert/strict';
import test from 'node:test';

import {
  chooseNextExternalMeeting,
  formatMeetingBrief,
  isM365MeetingPrepPrompt,
  meetingSubjectFromPrompt,
  parseM365Result,
  relevantMail,
} from '../src/m365-meeting-prep.ts';

const exactPrompt =
  'Use Work Calendar and Work Email to find the calendar entry Customer planning workshop via Teams and prepare a one-page meeting brief.';

test('recognises meeting-brief intent and extracts an optional requested subject', () => {
  assert.equal(isM365MeetingPrepPrompt(exactPrompt), true);
  assert.equal(meetingSubjectFromPrompt(exactPrompt), 'Customer planning workshop');
  assert.equal(
    meetingSubjectFromPrompt('Use Work Calendar and Work Email to prepare a meeting brief for my next meeting.'),
    undefined
  );
  assert.equal(isM365MeetingPrepPrompt('Use ms365 to summarise my inbox.'), false);
});

test('parses JSON text from a live MCP response and surfaces tool errors', () => {
  assert.deepEqual(
    parseM365Result({ content: [{ type: 'text', text: '{"value":[1]}' }], isError: false }),
    { value: [1] }
  );
  assert.throws(
    () => parseM365Result({ content: [{ type: 'text', text: 'not logged in' }], isError: true }),
    /not logged in/
  );
});

test('selects the earliest live external meeting and ignores cancelled events', () => {
  const event = chooseNextExternalMeeting(
    [
      {
        subject: 'Canceled: earlier',
        start: { dateTime: '2026-08-06T09:00:00.0000000' },
        attendees: [{ emailAddress: { address: 'external@example.com' } }],
      },
      {
        subject: 'Internal',
        start: { dateTime: '2026-08-06T10:00:00.0000000' },
        attendees: [{ emailAddress: { address: 'owner@company.example' } }],
      },
      {
        subject: 'Customer workshop',
        start: { dateTime: '2026-08-06T11:00:00.0000000' },
        attendees: [{ emailAddress: { address: 'alex@customer.example' } }],
      },
    ],
    ['owner@company.example'],
    new Date('2026-08-05T12:00:00Z')
  );

  assert.equal(event?.subject, 'Customer workshop');
});

test('selects a requested calendar entry instead of an earlier external meeting', () => {
  const event = chooseNextExternalMeeting(
    [
      {
        subject: 'Earlier customer call',
        start: { dateTime: '2026-08-06T14:00:00.0000000' },
        attendees: [{ emailAddress: { address: 'external@example.com' } }],
      },
      {
        subject: 'Customer planning workshop',
        start: { dateTime: '2026-08-06T15:15:00.0000000' },
        organizer: { emailAddress: { name: 'Alex Example', address: 'alex@example.com' } },
      },
    ],
    ['owner@company.example'],
    new Date('2026-08-06T13:00:00Z'),
    'Customer planning workshop'
  );

  assert.equal(event?.subject, 'Customer planning workshop');
  assert.equal(event?.organizer?.emailAddress?.name, 'Alex Example');
});

test('matches supporting mail by meeting subject and emits every required brief section', () => {
  const event = {
    subject: 'Customer planning workshop',
    bodyPreview: 'The customer wants to review the implementation plan and open decisions.',
    start: { dateTime: '2026-08-06T15:15:00.0000000', timeZone: 'Europe/Berlin' },
    end: { dateTime: '2026-08-06T16:00:00.0000000', timeZone: 'Europe/Berlin' },
    location: { displayName: 'via YouTube' },
    organizer: { emailAddress: { name: 'Alex', address: 'alex@example.com' } },
    attendees: [
      { emailAddress: { name: 'Owner', address: 'owner@company.example' } },
      { emailAddress: { name: 'Taylor', address: 'taylor@example.com' } },
    ],
  };
  const messages = [
    {
      subject: 'Invitation: Customer planning workshop',
      receivedDateTime: '2026-08-05T13:33:35Z',
      from: { emailAddress: { name: 'Alex', address: 'alex@example.com' } },
      bodyPreview: 'Taylor will walk through the plan.',
    },
    {
      subject: 'Unrelated steering committee',
      receivedDateTime: '2026-08-05T11:32:05Z',
      from: { emailAddress: { name: 'Other', address: 'other@example.com' } },
    },
  ];
  const matched = relevantMail(messages, event, ['owner@company.example']);
  assert.equal(matched.length, 1);

  const brief = formatMeetingBrief(event, matched, ['owner@company.example']);
  for (const heading of [
    'Meeting Logistics',
    'Relationship History',
    'Open Commitments',
    'Risks',
    'Three Questions to Raise',
  ]) {
    assert.match(brief, new RegExp(`## ${heading}`));
  }
  assert.match(brief, /05 Aug 2026/);
  assert.match(brief, /Invitation: Customer planning workshop/);
  assert.match(brief, /Work Calendar and Work Email only/);
  assert.doesNotMatch(brief, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
});

test('redacts addresses embedded in attendee fallbacks, subjects, and previews', () => {
  const brief = formatMeetingBrief(
    {
      subject: 'Customer planning workshop',
      start: { dateTime: '2026-08-06T15:15:00.0000000', timeZone: 'Europe/Berlin' },
      end: { dateTime: '2026-08-06T16:00:00.0000000', timeZone: 'Europe/Berlin' },
      organizer: { emailAddress: { name: 'Alex Example', address: 'alex@example.com' } },
      attendees: [{ emailAddress: { address: 'guest@example.com' } }],
    },
    [
      {
        subject: 'Invitation (owner@example.com)',
        bodyPreview: 'Reply to host@example.com.',
        from: { emailAddress: { address: 'alex@example.com' } },
      },
    ],
    ['owner@example.com']
  );

  assert.match(brief, /External attendee/);
  assert.match(brief, /email hidden/);
  assert.doesNotMatch(brief, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
});

test('does not confuse a subject word with a substring in unrelated personal mail', () => {
  const event = {
    subject: 'Customer planning workshop',
    organizer: { emailAddress: { address: 'alex@example.com' } },
    attendees: [{ emailAddress: { address: 'owner@company.example' } }],
  };
  const matched = relevantMail(
    [
      {
        subject: 'Your order will be delivered tomorrow',
        from: { emailAddress: { address: 'shop@example.org' } },
        toRecipients: [{ emailAddress: { address: 'owner@company.example' } }],
      },
    ],
    event,
    ['owner@company.example']
  );
  assert.deepEqual(matched, []);
});
