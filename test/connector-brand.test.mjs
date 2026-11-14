import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { brandOf } from '../src/connector-brand.ts';
import { collectSources } from '../src/chat-sources.ts';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('a connector name finds its tool by whole words only', () => {
  for (const [name, brand] of [['slack', 'slack'], ['Jira-Cloud', 'jira'], ['notion', 'notion'], ['linear', 'linear'], ['figma', 'figma'], ['teams', 'teams'], ['microsoft_teams', 'teams'], ['msteams', 'teams']]) assert.equal(brandOf(name), brand, name);
  for (const name of ['gmail-drafts', 'nonlinear', 'ai-control-tower', 'databricks', 'steamsets', '', undefined, null]) assert.equal(brandOf(name), null, String(name));
});

test('a connector source under an answer carries the connector name for its mark', () => {
  const tools = [{ id: '1', toolName: 'slack__slack_read_channel', status: 'completed', kind: 'other' }];
  const [source] = collectSources(tools, '');
  assert.equal(source?.kind, 'connector');
  assert.equal(brandOf(source.ext), 'slack');
});

test('the mark is shown in the Connectors list, the "Add a connector" list and the sources under an answer', () => {
  const manage = read('src/ui/ManageView.tsx');
  assert.match(manage, /<ConnectorLogo name=\{e\.configKey\} \/>/, 'installed connectors');
  assert.match(manage, /<ConnectorLogo name=\{b\.name\} \/>/, 'connectors that come with Werkbank');
  assert.match(read('src/ui/Chat.tsx'), /<ConnectorLogo name=\{source\.ext\}/, 'sources under an answer');
  assert.match(read('src/ui/ConnectorLogo.tsx'), /aria-hidden="true"/, 'decorative: the name stands next to it');
});
