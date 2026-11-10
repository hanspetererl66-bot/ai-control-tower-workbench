import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { TOOL_CARDS, cardState, checkToolName, findExtension, readCheck, scrub } from '../src/connect-tools.ts';

const root = join(import.meta.dirname, '..');
const text = (r) => ({ isError: false, content: [{ text: JSON.stringify(r) }] });

test('three cards, each says what it reads, what it writes only after confirmation and where the key comes from', () => {
  assert.deepEqual(TOOL_CARDS.map((c) => c.id), ['jira', 'slack', 'linear']);
  for (const c of TOOL_CARDS) {
    assert.match(c.writes, /only after you confirmed/i);
    assert.ok(c.reads && c.key && c.addCommand.includes(`--only ${c.id}`));
  }
});

test('the state comes from the connectors goose reports', () => {
  const ext = [{ configKey: 'jira', enabled: true }, { configKey: 'slack', enabled: false }];
  assert.deepEqual(cardState('jira', ext), { state: 'connected', configKey: 'jira' });
  assert.deepEqual(cardState('slack', ext), { state: 'off', configKey: 'slack' });
  assert.deepEqual(cardState('linear', ext), { state: 'not-added', configKey: null });
  assert.equal(findExtension('jira', [{ configKey: 'Jira-Cloud' }])?.configKey, 'Jira-Cloud');
});

test('the test calls the read-only check tool of that connector', () => {
  assert.equal(checkToolName('linear', 'linear'), 'linear__linear_check_connection');
  for (const c of TOOL_CARDS) assert.match(readFileSync(join(root, `connectors/${c.id}/server/${c.id}.mjs`), 'utf8'), new RegExp(`${c.id}_check_connection`));
});

test('the answers of the three connectors are read', () => {
  assert.deepEqual(readCheck(text({ ok: true, user: 'Hans', site: 'acme.atlassian.net' })), { ok: true, text: 'Connected as Hans in acme.atlassian.net.' });
  assert.equal(readCheck(text({ ok: true, workspace: 'Acme', bot: 'werkbank' })).text, 'Connected as werkbank in Acme.');
  assert.equal(readCheck(text({ ok: true, name: 'Hans', workspace: 'Acme' })).text, 'Connected as Hans in Acme.');
});

test('errors and unreadable answers are failures, and no key is ever shown', () => {
  assert.equal(readCheck({ isError: true, content: [{ text: 'Linear said 401 for lin_api_AbC123xyz' }] }).ok, false);
  assert.doesNotMatch(readCheck({ isError: true, content: [{ text: 'bad token xoxb-123-456-abcDEF' }] }).text, /xoxb/);
  assert.equal(readCheck({ content: [{ text: 'not json' }] }).ok, false);
  assert.equal(readCheck(undefined).ok, false);
  assert.equal(readCheck(text({ ok: false, error: 'nope' })).ok, false);
  assert.ok(scrub('x'.repeat(500)).length <= 200);
});

test('the Connectors page shows the cards, with a logo each, and only there', () => {
  const view = readFileSync(join(root, 'src/ui/ManageView.tsx'), 'utf8');
  const card = readFileSync(join(root, 'src/ui/ConnectTools.tsx'), 'utf8');
  assert.match(view, /\{showConnectors && \(\s*<>\s*<ConnectTools /);
  for (const id of ['jira', 'slack', 'linear']) assert.match(card, new RegExp(`id === '${id}'|return \\(\\s*<svg[^]*#5E6AD2`));
  assert.match(card, /<ToolLogo id=\{card\.id\}/);
  assert.match(card, /Test connection/);
  assert.match(card, /callTool\(checkToolName/);
});
