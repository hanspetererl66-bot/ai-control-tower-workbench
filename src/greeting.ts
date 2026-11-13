/**
 * The line above the empty chat. It used to be one fixed sentence; now it follows the time of day, sometimes the day (Monday, Friday,
 * the weekend, a month or quarter end, Friday the 13th) and, about one time in four, asks a light personal question instead. The pick is made once per conversation (see App.tsx), not on every render.
 * Pure and deterministic for a given date and random function, so it can be tested. Texts are English like the rest of the UI.
 * Nothing here knows who the person is: no name, nothing about health, age or family.
 */
export type Period = 'morning' | 'midday' | 'afternoon' | 'evening' | 'night';
export type Occasion = 'new-year' | 'friday13' | 'quarter-end' | 'month-end' | 'month-start' | 'weekend' | 'monday' | 'friday' | 'wednesday';
export type Greeting = { lines: string[]; funny: boolean; period: Period; occasion: Occasion | null };

/** Share of the empty chats that get a light personal question instead of the plain greeting. */
export const FUNNY_SHARE = 0.25;
/** On a day with an occasion, the share of the plain greetings that speak about the day instead of the time of day. */
export const DAY_SHARE = 0.4;

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

/** Greetings for a day with an occasion, two short lines each. */
export const OCCASIONS: Record<Occasion, string[][]> = {
  'new-year': [['Happy new year.', 'What is the first thing to get done?']],
  friday13: [['Friday the 13th.', 'Nothing can go wrong. Where do we start?']],
  'quarter-end': [['Quarter end is close.', 'What has to be in before it?'], ['End of the quarter.', 'What still needs a decision?']],
  'month-end': [['The month is almost over.', 'What still needs closing?'], ['Month end ahead.', 'What must be done before it?']],
  'month-start': [['A new month.', 'What do you want to get done by its end?'], ['Fresh month.', 'What comes first?']],
  weekend: [['Working on a weekend?', 'Then let us make it count.'], ['The weekend is quiet.', 'What do you want to finish?']],
  monday: [['New week.', 'What comes first?'], ['Monday.', 'Let us start with what matters most.'], ['A fresh week.', 'What is on the list?']],
  friday: [['Almost the weekend.', 'What must be done before?'], ['Friday.', 'One last push, or one last clean-up?'], ['Friday.', 'What would make the week feel done?']],
  wednesday: [['Midweek.', 'What needs a push?'], ['Halfway through the week.', 'What is still open?']],
};

/** The occasion of a day, by the local date; the first that applies wins (new year, Friday the 13th, quarter end, month end, month start, weekend, Monday, Friday, Wednesday). */
export function occasionOf(date: Date): Occasion | null {
  const day = date.getDate(), month = date.getMonth(), weekday = date.getDay();
  const last = new Date(date.getFullYear(), month + 1, 0).getDate();
  if (month === 0 && day === 1) return 'new-year';
  if (weekday === 5 && day === 13) return 'friday13';
  if ([2, 5, 8, 11].includes(month) && day > last - 3) return 'quarter-end';
  if (day > last - 2) return 'month-end';
  if (day <= 2) return 'month-start';
  if (weekday === 0 || weekday === 6) return 'weekend';
  if (weekday === 1) return 'monday';
  if (weekday === 5) return 'friday';
  if (weekday === 3) return 'wednesday';
  return null;
}

const pick = <T,>(list: T[], r: number): T => list[Math.min(list.length - 1, Math.max(0, Math.floor(r * list.length)))];

export function greetingFor(date: Date, rand: () => number = Math.random): Greeting {
  const period = periodOf(date.getHours());
  const funny = rand() < FUNNY_SHARE;
  if (funny) return { lines: pick([...FUNNY, ...FUNNY_BY_PERIOD[period]], rand()), funny, period, occasion: null };
  // A day with an occasion sometimes speaks about the day. Without an occasion no extra draw is made.
  const occasion = occasionOf(date);
  if (occasion && rand() < DAY_SHARE) return { lines: pick(OCCASIONS[occasion], rand()), funny, period, occasion };
  return { lines: pick(GREETINGS[period], rand()), funny, period, occasion };
}
