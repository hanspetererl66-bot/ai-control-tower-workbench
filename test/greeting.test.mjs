import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { DAY_SHARE, FUNNY, FUNNY_BY_PERIOD, FUNNY_SHARE, GREETINGS, OCCASIONS, greetingFor, occasionOf, periodOf } from '../src/greeting.ts';

const at = (hour) => new Date(2026, 10, 12, hour, 30);
const seq = (...values) => { let i = 0; return () => values[Math.min(i++, values.length - 1)]; };

test('the periods follow the hour: morning, midday, afternoon, evening, night', () => {
  const by = (hours) => hours.map(periodOf);
  assert.deepEqual(by([5, 10]), ['morning', 'morning']);
  assert.deepEqual(by([11, 13]), ['midday', 'midday']);
  assert.deepEqual(by([14, 17]), ['afternoon', 'afternoon']);
  assert.deepEqual(by([18, 21]), ['evening', 'evening']);
  assert.deepEqual(by([22, 23, 0, 4]), ['night', 'night', 'night', 'night']);
  assert.equal(periodOf(24), 'night'); assert.equal(periodOf(-1), 'night', 'an odd hour still lands somewhere');
  for (let h = 0; h < 24; h++) assert.ok(['morning', 'midday', 'afternoon', 'evening', 'night'].includes(periodOf(h)), String(h));
});

test('a plain greeting fits the time of day; a low first draw gives a light question instead', () => {
  for (const [hour, period] of [[8, 'morning'], [12, 'midday'], [15, 'afternoon'], [20, 'evening'], [23, 'night']]) {
    const plain = greetingFor(at(hour), seq(0.9, 0));
    assert.equal(plain.period, period); assert.equal(plain.funny, false);
    assert.deepEqual(plain.lines, GREETINGS[period][0]);
    const funny = greetingFor(at(hour), seq(0, 0));
    assert.equal(funny.funny, true);
    assert.deepEqual(funny.lines, FUNNY[0]);
  }
  assert.deepEqual(greetingFor(at(8), seq(0.9, 0.9999)).lines, GREETINGS.morning.at(-1), 'the last variant can be reached');
  assert.deepEqual(greetingFor(at(23), seq(0, 0.9999)).lines, FUNNY_BY_PERIOD.night.at(-1), 'the questions of the time of day are part of the pool');
});

test('every text is short English, one or two lines, and no text is used twice', () => {
  const all = [...Object.values(GREETINGS).flat(), ...FUNNY, ...Object.values(FUNNY_BY_PERIOD).flat(), ...Object.values(OCCASIONS).flat()];
  assert.ok(all.length >= 30);
  for (const lines of all) {
    assert.ok(lines.length >= 1 && lines.length <= 2, lines.join('|'));
    for (const line of lines) {
      assert.ok(line.trim() === line && line.length >= 3 && line.length <= 48, `"${line}"`);
      assert.ok(!/[äöüß]/i.test(line), `English only: ${line}`);
    }
  }
  assert.equal(new Set(all.map((l) => l.join(' '))).size, all.length, 'no duplicates');
});

test('every random draw gives a valid greeting and about one in four is a question', () => {
  let funny = 0, n = 0;
  for (let hour = 0; hour < 24; hour++) {
    for (let a = 0; a < 20; a++) {
      for (let b = 0; b < 20; b++) {
        const g = greetingFor(at(hour), seq(a / 20, b / 20));
        assert.ok(Array.isArray(g.lines) && g.lines.length > 0 && g.lines.every((l) => l.length > 0));
        funny += g.funny ? 1 : 0; n++;
      }
    }
  }
  assert.ok(Math.abs(funny / n - FUNNY_SHARE) < 0.02, `${funny / n}`);
  assert.deepEqual(greetingFor(at(9), seq(0.5, 0.5)), greetingFor(at(9), seq(0.5, 0.5)), 'same date and draw, same greeting');
  assert.ok(greetingFor(at(9)).lines.length > 0, 'works with the default random function');
});

test('the app uses it once per conversation and no longer has the fixed sentence', () => {
  const app = readFileSync(join(import.meta.dirname, '..', 'src/App.tsx'), 'utf8');
  assert.match(app, /const greeting = useMemo\(\(\) => greetingFor\(new Date\(\), Math\.random\), \[conversationState\.selectedId\]\)/);
  assert.match(app, /greeting\.lines\.map\(/);
  assert.ok(!app.includes('to get things done?'), 'the fixed headline is gone');
});

const day = (y, m, d, h = 9) => new Date(y, m - 1, d, h, 30);

test('the occasion of a day follows the local date, the first that applies wins', () => {
  const o = (y, m, d) => occasionOf(day(y, m, d));
  assert.equal(o(2027, 1, 1), 'new-year');
  assert.equal(o(2026, 11, 13), 'friday13', 'a Friday the 13th');
  assert.equal(o(2026, 3, 13), 'friday13');
  assert.equal(o(2026, 3, 30), 'quarter-end'); assert.equal(o(2026, 12, 31), 'quarter-end'); assert.equal(o(2026, 9, 28), 'quarter-end');
  assert.equal(o(2026, 11, 30), 'month-end'); assert.equal(o(2026, 11, 29), 'month-end'); assert.equal(o(2026, 11, 28), 'weekend', 'the third last day of a month is not a month end');
  assert.equal(o(2026, 2, 27), 'month-end', 'February has 28 days in 2026'); assert.equal(o(2028, 2, 28), 'month-end', 'and 29 in 2028 (28 is the second last day)');
  assert.equal(o(2026, 11, 1), 'month-start', 'a Sunday that starts a month is a month start first'); assert.equal(o(2026, 11, 2), 'month-start');
  assert.equal(o(2026, 11, 14), 'weekend'); assert.equal(o(2026, 11, 15), 'weekend');
  assert.equal(o(2026, 11, 9), 'monday'); assert.equal(o(2026, 11, 20), 'friday'); assert.equal(o(2026, 11, 11), 'wednesday');
  assert.equal(o(2026, 11, 12), null, 'a Thursday in the middle of a month has none'); assert.equal(o(2026, 11, 10), null, 'neither has a Tuesday');
  assert.equal(o(2026, 11, 3), null);
  assert.equal(occasionOf(day(2026, 11, 9, 23)), 'monday', 'the hour does not matter');
});

test('on a day with an occasion the plain greeting sometimes speaks about the day, a question still comes first', () => {
  const monday = day(2026, 11, 9);
  const dayGreeting = greetingFor(monday, seq(0.9, 0.1, 0));
  assert.equal(dayGreeting.occasion, 'monday'); assert.equal(dayGreeting.funny, false);
  assert.deepEqual(dayGreeting.lines, OCCASIONS.monday[0]);
  assert.deepEqual(greetingFor(monday, seq(0.9, 0.1, 0.9999)).lines, OCCASIONS.monday.at(-1));
  const timeGreeting = greetingFor(monday, seq(0.9, 0.9, 0));
  assert.deepEqual(timeGreeting.lines, GREETINGS.morning[0], 'the time of day when the day draw says no');
  assert.equal(timeGreeting.occasion, 'monday', 'the occasion is still reported');
  const q = greetingFor(monday, seq(0.1, 0));
  assert.equal(q.funny, true); assert.deepEqual(q.lines, FUNNY[0]);
  // the Friday the 13th has its own line
  assert.deepEqual(greetingFor(day(2026, 11, 13), seq(0.9, 0, 0)).lines, OCCASIONS.friday13[0]);
  // a day without an occasion makes no extra draw: the same draws give the time-of-day greeting as before
  assert.deepEqual(greetingFor(at(9), seq(0.9, 0)).lines, GREETINGS.morning[0]);
  assert.equal(greetingFor(at(9), seq(0.9, 0)).occasion, null);
});

test('on an occasion day the shares are about one in four a question and a share of the rest about the day', () => {
  let funny = 0, dayLines = 0, n = 0;
  for (let a = 0; a < 40; a++) for (let b = 0; b < 40; b++) {
    const g = greetingFor(day(2026, 11, 9), seq(a / 40, b / 40, 0.5));
    funny += g.funny ? 1 : 0; dayLines += !g.funny && OCCASIONS.monday.includes(g.lines) ? 1 : 0; n++;
  }
  assert.ok(Math.abs(funny / n - FUNNY_SHARE) < 0.03, String(funny / n));
  assert.ok(Math.abs(dayLines / n - (1 - FUNNY_SHARE) * DAY_SHARE) < 0.03, String(dayLines / n));
});
