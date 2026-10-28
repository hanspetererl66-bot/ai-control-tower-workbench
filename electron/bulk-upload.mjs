/**
 * Sends the batches of a table to a webhook (for example an n8n workflow that fills Supabase).
 * One batch after the other, a few retries per batch, progress after each one. A failed batch stops the run,
 * and the result says how many batches went through so the person can start again from there.
 * fetchImpl is injectable for the tests.
 */
import { checkWebhookUrl } from '../shared/table-ingest.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function uploadBatches({ url, batches, token = '', startAt = 1, fetchImpl = fetch, onProgress = () => {}, retries = 2, retryDelayMs = 800, timeoutMs = 60_000, isCancelled = () => false }) {
  const target = checkWebhookUrl(url);
  let sentBatches = 0;
  let sentRows = 0;
  for (const batch of batches) {
    if (batch.index < startAt) continue;
    if (isCancelled()) return { ok: false, cancelled: true, sentBatches, sentRows, total: batches.length, nextBatch: batch.index };
    let lastError = '';
    let done = false;
    for (let attempt = 0; attempt <= retries && !done; attempt += 1) {
      try {
        const res = await fetchImpl(target, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(token ? { 'x-upload-token': token } : {}) },
          body: JSON.stringify(batch),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.ok) done = true;
        else {
          // The answer text is for the person; it never contains the token we sent.
          lastError = `HTTP ${res.status}${res.status === 404 ? ' (is the workflow active? a test URL only works once)' : ''}`;
          if (res.status >= 400 && res.status < 500 && res.status !== 429) break; // retrying will not help
        }
      } catch (error) {
        lastError = error?.name === 'TimeoutError' ? 'timeout' : String(error?.message ?? error).replaceAll(token || '\u0000', '***').slice(0, 200);
      }
      if (!done && attempt < retries) await sleep(retryDelayMs * (attempt + 1));
    }
    if (!done) return { ok: false, error: lastError, failedBatch: batch.index, sentBatches, sentRows, total: batches.length, nextBatch: batch.index };
    sentBatches += 1;
    sentRows += batch.rows.length;
    onProgress({ batch: batch.index, total: batches.length, sentRows, totalRows: batch.totalRows });
  }
  return { ok: true, sentBatches, sentRows, total: batches.length };
}
