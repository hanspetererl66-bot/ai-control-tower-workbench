import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const script = path.join(root, 'scripts/local-artifact-workflow.mjs');
const original = path.join(root, 'workspace/demo-files/Meeting Brief Template.docx');

function runWorkflow(templatePath, filename, requestDir) {
  const requestPath = path.join(requestDir, `${randomUUID()}.json`);
  writeFileSync(
    requestPath,
    JSON.stringify({
      type: 'meeting-brief-doc',
      templatePath,
      sourceText: [
        '# Meeting Brief — Example live',
        '## Meeting Logistics',
        '- **When:** Thu, 06 Aug 2026, 15:15 CEST',
        '- **Where:** Online',
        '- **External attendees:** Ada Example (ada@example.com)',
        '- **Purpose:** Verify a previously filled meeting brief can be refreshed.',
        '## Relationship History',
        'The invitation is the only retrieved message.',
        '## Open Commitments',
        '- Confirm the agenda.',
        '## Risks',
        '- No prior decisions were found.',
        '## Three Questions to Raise',
        '1. What outcome is required?',
        '2. Who owns the next step?',
        '3. When is it due?',
      ].join('\n'),
      prompt: `Save the completed document as “${filename}”.`,
    })
  );
  const result = JSON.parse(execFileSync(process.execPath, [script, requestPath], { encoding: 'utf8' }));
  return result.files[0];
}

test('meeting brief workflow refreshes an already-filled template by stable labels', () => {
  const requestDir = mkdtempSync(path.join(tmpdir(), 'werkbank-meeting-test-'));
  const firstName = `meeting-brief-first-${randomUUID()}.docx`;
  const secondName = `meeting-brief-refreshed-${randomUUID()}.docx`;
  let first;
  let second;
  try {
    first = runWorkflow(original, firstName, requestDir);
    second = runWorkflow(first, secondName, requestDir);
    const xml = execFileSync('/usr/bin/unzip', ['-p', second, 'word/document.xml'], {
      encoding: 'utf8',
    });
    assert.match(xml, /Example · verified Microsoft 365 context/);
    assert.match(xml, /Company:\s*<\/w:t>.*Example/s);
    assert.doesNotMatch(xml, /Customer conversation preparation template/);
    assert.doesNotMatch(xml, /\[Company name\]/);
  } finally {
    if (first) rmSync(first, { force: true });
    if (second) rmSync(second, { force: true });
    rmSync(requestDir, { recursive: true, force: true });
  }
});
