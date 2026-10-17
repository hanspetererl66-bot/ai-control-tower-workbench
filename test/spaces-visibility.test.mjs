import assert from 'node:assert/strict';
import test from 'node:test';

import { listSpaces } from '../src/spaces.ts';

test('returns every generated Space without a hard-coded featured filter', async () => {
  const originalFetch = globalThis.fetch;
  const spaces = [
    { slug: 'inbox-overview', title: 'Inbox Overview' },
    { slug: 'transport-backlog', title: 'Transport Backlog' },
    { slug: 'abap-cloud-readiness', title: 'ABAP Cloud Readiness' },
  ];
  globalThis.fetch = async () => ({ ok: true, json: async () => spaces });

  try {
    assert.deepEqual((await listSpaces()).map((space) => space.title), [
      'Inbox Overview',
      'Transport Backlog',
      'ABAP Cloud Readiness',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
