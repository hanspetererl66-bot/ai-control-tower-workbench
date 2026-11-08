import assert from 'node:assert/strict';
import test from 'node:test';
import { clampWidth, parseWidths, DEFAULT_WIDTHS } from '../src/pane-width.ts';

test('pane widths stay inside their limits and fall back to the defaults', () => {
  assert.equal(clampWidth('list', 10), 180);
  assert.equal(clampWidth('list', 9999), 520);
  assert.equal(clampWidth('dock', 400.4), 400);
  assert.equal(clampWidth('dock', NaN), DEFAULT_WIDTHS.dock);
  assert.deepEqual(parseWidths('not json'), DEFAULT_WIDTHS);
  assert.deepEqual(parseWidths(null), DEFAULT_WIDTHS);
  assert.deepEqual(parseWidths('{"list":300,"dock":99999}'), { list: 300, dock: 720 });
});

test('the Activity tab has seven invented example runs and the monitor tops up a thin database catalog', async () => {
  const { exampleLog } = await import('../src/job-log.ts');
  const { supplementWithExamples, lifecycleCalls } = await import('../src/skill-health-db.ts');
  const { emptyCatalog, exampleCatalog } = await import('../src/skill-health.ts');
  const log = exampleLog(Date.UTC(2026, 10, 8));
  assert.equal(log.length, 7);
  assert.ok(log.every((e) => e.example && e.status && e.at));
  const now = Date.now();
  const thin = { ...emptyCatalog(), skills: [{ ...exampleCatalog(now).skills[0], id: 'real-1', example: undefined }] };
  const { catalog, added } = supplementWithExamples(thin, now);
  assert.ok(added > 30 && catalog.skills.some((s) => s.id === 'real-1'));
  // example skills never produce database calls
  const next = { ...catalog, skills: catalog.skills.map((s) => (s.example ? { ...s, state: 'retired' } : s)) };
  assert.equal(lifecycleCalls(catalog, next, now).length, 0);
  assert.equal(supplementWithExamples(catalog, now).added, 0);
});
