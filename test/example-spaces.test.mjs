import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { EXAMPLE_SPACES, installExampleSpace } from '../scripts/install-example-space.mjs';
import { parseSpaceMetadata } from '../shared/space-metadata.mjs';

const ROOT = join(import.meta.dirname, '..');

for (const [name, slug] of Object.entries(EXAMPLE_SPACES)) {
  test(`example space "${name}" installs and is valid`, () => {
    const spacesDir = mkdtempSync(join(tmpdir(), 'werkbank-spaces-'));
    try {
      const dest = installExampleSpace(name, { root: ROOT, spacesDir });
      assert.equal(dest, join(spacesDir, slug));

      const html = readFileSync(join(dest, 'index.html'), 'utf8');
      const meta = parseSpaceMetadata(readFileSync(join(dest, 'space.json'), 'utf8'));
      assert.equal(typeof meta.title, 'string');
      assert.ok(Array.isArray(meta.insights));

      // Spaces render in a sandboxed iframe without network: nothing may load remotely.
      assert.doesNotMatch(html, /@import\s+url\(\s*['"]?https?:/i);
      assert.doesNotMatch(html, /<(?:script|img|link|iframe)\b[^>]*\b(?:src|href)\s*=\s*["']https?:/i);
      assert.doesNotMatch(html, /url\(\s*['"]?https?:/i);

      // The desktop counts elements with class "card".
      assert.match(html, /class\s*=\s*["'][^"']*\bcard\b/);
    } finally {
      rmSync(spacesDir, { recursive: true, force: true });
    }
  });
}

test('installing an unknown example space fails clearly', () => {
  assert.throws(() => installExampleSpace('nope'), /unknown example space/);
});

test('sub4me sample data is internally consistent', () => {
  const html = readFileSync(join(ROOT, 'examples/sub4me/index.html'), 'utf8');
  const data = JSON.parse(/<script type="application\/json" id="s4m-data">([\s\S]*?)<\/script>/.exec(html)[1]);
  const used = data.aiUnits.monthly.reduce((a, b) => a + b, 0);
  assert.equal(data.products.reduce((a, p) => a + p.consumed, 0), used);
  assert.equal(data.products.reduce((a, p) => a + p.allotment, 0), data.aiUnits.allotment);
  assert.equal(new Set(data.tickets.map((t) => t.id)).size, data.tickets.length);
  assert.match(html, /not affiliated/i);
  assert.doesNotMatch(html, /\bfetch\(|XMLHttpRequest|localStorage/);
});

test('sub4me never relies on a native form submit (Spaces are sandboxed without allow-forms)', () => {
  const html = readFileSync(join(ROOT, 'examples/sub4me/index.html'), 'utf8');
  assert.doesNotMatch(html, /type="submit"|addEventListener\('submit'/);
});

test('both Spaces embed the current shared design system and use only tokens for colour', async () => {
  const { SPACE_PAGES, embedDesignSystem } = await import('../scripts/sync-design-system.mjs');
  const css = readFileSync(join(ROOT, 'examples/shared/design-system.css'), 'utf8');
  for (const rel of SPACE_PAGES) {
    const html = readFileSync(join(ROOT, rel), 'utf8');
    assert.equal(embedDesignSystem(html, css), html, `${rel} is out of sync: run npm run sync:design`);
    // Dark mode only works if surfaces are tokens, not literal white.
    assert.doesNotMatch(html.replace(/<script[\s\S]*?<\/script>/g, ''), /background:\s*#fff(?![0-9a-f])/i, rel);
    assert.match(html, /prefers-color-scheme:dark/);
  }
});

test('example skills have valid frontmatter, use only real connector tools, and install', async () => {
  const { installExampleSkills } = await import('../scripts/install-example-skills.mjs');
  const { TOOL_DEFINITIONS } = await import('../connectors/control-tower/server/tools.mjs');
  const { TICKET_TOOL_DEFINITIONS } = await import('../connectors/control-tower/server/tickets.mjs');
  const { SKILL_TOOL_DEFINITIONS } = await import('../connectors/control-tower/server/skills.mjs');
  const { parseSkill, knownTools } = await import('../scripts/skills-registry.mjs');
  const { SUB4ME_TOOL_DEFINITIONS } = await import('../connectors/control-tower/server/sub4me.mjs');
  const { N8N_TOOL_DEFINITIONS } = await import('../connectors/control-tower/server/n8n.mjs');
  const { SKILL_PROFILE_TOOL_DEFINITIONS } = await import('../connectors/control-tower/server/skill-profiles.mjs');
  const { GRAPH_TOOL_DEFINITIONS } = await import('../connectors/control-tower/server/graph.mjs');
  const real = new Set([...TOOL_DEFINITIONS, ...TICKET_TOOL_DEFINITIONS, ...SKILL_TOOL_DEFINITIONS, ...SUB4ME_TOOL_DEFINITIONS, ...N8N_TOOL_DEFINITIONS, ...SKILL_PROFILE_TOOL_DEFINITIONS, ...GRAPH_TOOL_DEFINITIONS].map((t) => t.name));
  for (const tool of real) assert.ok(knownTools().has(tool), `manifest lists ${tool}`);
  const dir = mkdtempSync(join(tmpdir(), 'werkbank-skills-'));
  try {
    const names = installExampleSkills({ root: ROOT, skillsDir: dir });
    assert.deepEqual(names.sort(), ['access-review-prep', 'automation-health-check', 'board-briefing', 'customer-call-prep', 'skill-finder', 'ticket-writer']);
    for (const name of names) {
      const text = readFileSync(join(dir, name, 'SKILL.md'), 'utf8');
      const front = parseSkill(text);
      assert.equal(front.name, name);
      assert.ok(front.description.length <= 240, `${name}: description fits the skill picker`);
      assert.ok(front.meta.domain && front.meta.process && front.meta.team, `${name}: profile is filled in`);
      assert.ok(front.meta.tools.length > 0 && front.meta.tools.every((t) => real.has(t)), `${name}: profile tools are real`);
      for (const [, tool] of text.matchAll(/`((?:get|list|create|search)_[a-z_]+)`/g)) assert.ok(real.has(tool), `${name} mentions unknown tool ${tool}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skill marketplace data is in sync, classified, and marks fictional skills as samples', async () => {
  const { embeddedData, embedData, repoSkills, buildCatalog, taxonomy } = await import('../scripts/sync-skill-marketplace.mjs');
  const { LOBS, SCOPES, BOARD_AREAS } = await import('../scripts/skills-registry.mjs');
  const html = readFileSync(join(ROOT, 'examples/skill-marketplace/index.html'), 'utf8');
  const samples = JSON.parse(readFileSync(join(ROOT, 'examples/skill-marketplace/sample-skills.json'), 'utf8')).skills;
  const data = embeddedData(html);
  const next = buildCatalog({ registered: repoSkills(), samples, source: 'repository', asOf: data.asOf });
  assert.equal(embedData(html, next), html, 'run npm run sync:skill-marketplace');
  assert.deepEqual(data.taxonomy, JSON.parse(JSON.stringify(taxonomy())));
  assert.equal(data.skills.filter((s) => !s.sample).length, 6);
  assert.ok(data.skills.filter((s) => s.sample).length >= 8);
  for (const s of data.skills) {
    assert.ok(SCOPES.includes(s.scope), `${s.name} scope`);
    if (s.boardArea) assert.ok(BOARD_AREAS.includes(s.boardArea), `${s.name} board area`);
    if (s.lob) assert.equal(LOBS[s.lob], s.boardArea, `${s.name}: LOB belongs to its board area`);
    if (s.scope === 'team') assert.ok(s.team, `${s.name} needs a team`);
    assert.ok(['pilot', 'empfohlen', 'approved'].includes(s.maturity), `${s.name} maturity`);
    if (s.maturity === 'approved' && s.sample) assert.ok(s.approvedBy && s.approvedAt && s.approvedVersion, `${s.name}: approved needs approver, date and version`);
    assert.ok(s.demand && s.demand.installs >= 0, `${s.name} has demand counters`);
  }
  assert.ok(data.skills.filter((s) => s.sample && s.demand.installs > 0).length >= 8, 'the ranking has something to show');
  assert.ok(['pilot', 'empfohlen', 'approved'].every((m) => data.skills.some((s) => s.maturity === m)), 'all three maturity levels appear');
  for (const area of BOARD_AREAS) assert.ok(data.skills.some((s) => s.boardArea === area), `${area} has a skill`);
});

test('skill marketplace overview can collapse the tree and drill into single skills', () => {
  const html = readFileSync(join(ROOT, 'examples/skill-marketplace/index.html'), 'utf8');
  for (const needle of ['aria-expanded', "addEventListener('dblclick'", 'id="expand-all"', 'id="collapse-all"', 'data-open-node', 'data-skill', 'aria-pressed']) {
    assert.ok(html.includes(needle), `missing ${needle}`);
  }
  assert.doesNotMatch(html.replace(/<script[\s\S]*?<\/script>/g, ''), /background:\s*#[0-9a-f]{3,6}\b/i, 'colours come from tokens');
});

test('live registry sync writes only into the installed Space and leaves the repository page untouched', async () => {
  const { installLive, embeddedData } = await import('../scripts/sync-skill-marketplace.mjs');
  const { readFileSync: read, mkdtempSync: mk, rmSync: rm } = await import('node:fs');
  const dir = mk(join(tmpdir(), 'werkbank-live-'));
  const repoPage = join(ROOT, 'examples/skill-marketplace/index.html');
  const before = read(repoPage, 'utf8');
  try {
    const registered = [{ name: 'live-skill', description: 'from the registry', owner: 'x', version: 2, maturity: 'approved', approvedBy: 'Chef', domain: '', process: '', boardArea: 'Finance', lob: '', team: '', scope: 'company', dataClass: '', tools: [], demand: { installs: 1, views: 0, searchHits: 0, previousScore: 0 }, sample: false }];
    const page = installLive({ registered, samples: [], root: ROOT, spacesDir: dir, asOf: '2026-10-18' });
    assert.ok(page.startsWith(dir), 'written below the spaces folder');
    const data = embeddedData(read(page, 'utf8'));
    assert.equal(data.source, 'registry');
    assert.deepEqual(data.skills.map((s) => s.name), ['live-skill']);
    assert.equal(read(repoPage, 'utf8'), before, 'the tracked page is unchanged');
  } finally {
    rm(dir, { recursive: true, force: true });
  }
});
