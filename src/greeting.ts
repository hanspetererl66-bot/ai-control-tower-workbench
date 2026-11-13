/**
 * The line above the empty chat. It used to be one fixed sentence; now it follows the time of day and, about one time in four,
 * asks a light personal question instead. The pick is made once per conversation (see App.tsx), not on every render.
 * Pure and deterministic for a given date and random function, so it can be tested. Texts are English like the rest of the UI.
 * Nothing here knows who the person is: no name, nothing about health, age or family.
 */
export type Period = 'morning' | 'midday' | 'afternoon' | 'evening' | 'night';
export type Greeting = { lines: string[]; funny: boolean; period: Period };

/** Share of the empty chats that get a light personal question instead of the plain greeting. */
export const FUNNY_SHARE = 0.25;

export function periodOf(hour: number): Period {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  if (h >= 5 && h < 11) return 'morning';
  if (h >= 11 && h < 14) return 'midday';
  if (h >= 14 && h < 18) return 'afternoon';
  if (h >= 18 && h < 22) return 'evening';
  return 'night';
}

/** Plain greetings, two short lines each. */
export const GREETINGS: Record<Period, string[][]> = {
  morning: [
    ['Good morning.', 'What are we getting done today?'],
    ['Morning!', 'Where shall we start?'],
    ['A fresh day.', 'What comes first?'],
  ],
  midday: [
    ['Midday check:', 'what is still open?'],
    ['Lunch is calling.', 'What can I take off your plate first?'],
    ['Halfway through the day.', 'What needs a push?'],
  ],
  afternoon: [
    ['Good afternoon.', 'What needs to be finished today?'],
    ['The afternoon stretch.', 'What can I take off your list?'],
    ['Good afternoon.', 'How can I help?'],
  ],
  evening: [
    ['Good evening.', 'What shall we wrap up?'],
    ['Evening.', 'What is still on your mind?'],
    ['Still at it?', 'Let us finish what matters.'],
  ],
  night: [
    ['Working late.', 'What do you need?'],
    ['It is late.', 'Let us keep it short and useful.'],
    ['Night shift.', 'What are we sorting out?'],
  ],
};

/** Light personal questions that fit any time of day. */
export const FUNNY: string[][] = [
  ['Quick question first:', 'have you had coffee yet?'],
  ['Be honest:', 'how many browser tabs are open right now?'],
  ['Which meeting today', 'could have been an e-mail?'],
  ['What is the one task', 'you keep postponing?'],
  ['Did you drink some water', 'since the last time you asked me?'],
  ['If I could do one chore for you,', 'which one would you pick?'],
  ['On a scale of 1 to snack,', 'how hungry are you?'],
];

/** Light questions that only fit one part of the day. */
export const FUNNY_BY_PERIOD: Record<Period, string[][]> = {
  morning: [['Coffee first,', 'or straight to work?']],
  midday: [['Be honest:', 'did you already eat, or only plan to?']],
  afternoon: [['Is the afternoon slump here yet?', 'Then let us do something small.']],
  evening: [['Be honest:', 'is this still work or already a hobby?']],
  night: [['Should you not be asleep by now?', 'Tell me what keeps you up.']],
};

const pick = <T,>(list: T[], r: number): T => list[Math.min(list.length - 1, Math.max(0, Math.floor(r * list.length)))];

export function greetingFor(date: Date, rand: () => number = Math.random): Greeting {
  const period = periodOf(date.getHours());
  const funny = rand() < FUNNY_SHARE;
  const lines = funny ? pick([...FUNNY, ...FUNNY_BY_PERIOD[period]], rand()) : pick(GREETINGS[period], rand());
  return { lines, funny, period };
}
