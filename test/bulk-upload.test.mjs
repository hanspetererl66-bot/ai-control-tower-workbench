import assert from 'node:assert/strict';
import test from 'node:test';
import { uploadBatches } from '../electron/bulk-upload.mjs';
import { buildBatches, parseTableText } from '../shared/table-ingest.mjs';

const batches = buildBatches({ fileName: 'a.csv', table: parseTableText('a\n1\n2\n3\n4\n5'), batchSize: 2, batchId: 'b1' });
const URL_OK = 'https://x.app.n8n.cloud/webhook/abc';

test('sends every batch in order with the token header and reports progress', async () => {
  const calls = [];
  const progress = [];
  const result = await uploadBatches({
    url: URL_OK, batches, token: 'sek', onProgress: (p) => progress.push(p.batch),
    fetchImpl: async (u, init) => { calls.push({ u, body: JSON.parse(init.body), token: init.headers['x-upload-token'] }); return { ok: true, status: 200 }; },
  });
  assert.deepEqual(result, { ok: true, sentBatches: 3, sentRows: 5, total: 3 });
  assert.deepEqual(calls.map((c) => c.body.index), [1, 2, 3]);
  assert.ok(calls.every((c) => c.token === 'sek' && c.u === URL_OK));
  assert.deepEqual(progress, [1, 2, 3]);
});

test('retries a failing batch, then goes on', async () => {
  let n = 0;
  const result = await uploadBatches({ url: URL_OK, batches, retryDelayMs: 1, fetchImpl: async () => (++n === 1 ? { ok: false, status: 503 } : { ok: true, status: 200 }) });
  assert.equal(result.ok, true);
  assert.equal(n, 4);
});

test('a client error stops at once and says where to continue; startAt resumes there', async () => {
  let seen = [];
  const result = await uploadBatches({ url: URL_OK, batches, retryDelayMs: 1, fetchImpl: async (_u, init) => { const b = JSON.parse(init.body); seen.push(b.index); return b.index === 2 ? { ok: false, status: 404 } : { ok: true, status: 200 }; } });
  assert.equal(result.ok, false);
  assert.equal(result.failedBatch, 2);
  assert.equal(result.nextBatch, 2);
  assert.equal(result.sentBatches, 1);
  assert.match(result.error, /404.*active/);
  assert.deepEqual(seen, [1, 2], 'no retry for a 404');
  seen = [];
  const resumed = await uploadBatches({ url: URL_OK, batches, startAt: 2, fetchImpl: async (_u, init) => { seen.push(JSON.parse(init.body).index); return { ok: true, status: 200 }; } });
  assert.deepEqual(seen, [2, 3]);
  assert.equal(resumed.ok, true);
});

test('network errors never leak the token, and bad addresses are refused before any request', async () => {
  const result = await uploadBatches({ url: URL_OK, batches, token: 'sek', retries: 0, fetchImpl: async () => { throw new Error('connect failed for sek'); } });
  assert.equal(result.ok, false);
  assert.doesNotMatch(result.error, /sek/);
  await assert.rejects(uploadBatches({ url: 'http://example.com/x', batches, fetchImpl: async () => { throw new Error('must not be called'); } }), /https/);
});

test('can be cancelled between batches', async () => {
  let n = 0;
  const result = await uploadBatches({ url: URL_OK, batches, isCancelled: () => n >= 1, fetchImpl: async () => { n += 1; return { ok: true, status: 200 }; } });
  assert.equal(result.cancelled, true);
  assert.equal(result.sentBatches, 1);
  assert.equal(result.nextBatch, 2);
});
