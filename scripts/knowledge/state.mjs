/** State of the feeder (data/knowledge/state.json): per repo the blob hash of every file already processed, per feed the ids already seen. */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const emptyState = () => ({ version: 1, git: {}, feeds: {} });

export function loadState(file) {
  if (!existsSync(file)) return emptyState();
  try {
    const s = JSON.parse(readFileSync(file, 'utf8'));
    if (s?.version !== 1 || typeof s.git !== 'object' || typeof s.feeds !== 'object') return emptyState();
    return { version: 1, git: s.git ?? {}, feeds: s.feeds ?? {} };
  } catch {
    return emptyState(); // a damaged file means: start over, never crash a scheduled run
  }
}

export function saveState(file, state) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(tmp, file);
}
