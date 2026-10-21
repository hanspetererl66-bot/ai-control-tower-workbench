import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BOARD_AREAS, LOBS, MATURITIES, SCOPES, knownTools, parseSkill, publishSkills, sha256, syncSkills, validateSkill } from '../scripts/skills-registry.mjs';

const ROOT = join(import.meta.dirname, '..');
const skillText = (name, extra = '') => `---\nname: ${name}\ndescription: Testskill ${name}\n---\n\n# ${name}\n${extra}\n`;

/** Fake of the two read functions; `rows` maps slug -> { text, version }. */
function fakeRegistry(rows, { similar = [] } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const fn = url.split('/rpc/')[1];
    const args = JSON.parse(init.body);
    calls.push({ fn, args, key: init.headers.apikey });
    if (fn === 'skills_list') {
      const body = Object.entries(rows).map(([slug, r]) => ({ slug, description: `d ${slug}`, owner: '', version: r.version, sha256: r.sha ?? sha256(r.text) }));
      return new Response(JSON.stringify(body));
    }
    if (fn === 'skills_get') {
      const r = rows[args.p_slug];
      return new Response(JSON.stringify({ slug: args.p_slug, version: r.version, sha256: r.sha ?? sha256(r.text), body: r.text }));
    }
    if (fn === 'skills_track') {
      if (init.failTrack) return new Response('no', { status: 500 });
      return new Response(JSON.stringify({ recorded: args.p_slugs.length }));
    }
    if (fn === 'skills_similar') return new Response(JSON.stringify(similar));
    if (fn === 'skills_publish') {
      return new Response(JSON.stringify({ slug: args.p_slug, version: 1, status: 'draft', changed: true }));
    }
    return new Response('{}', { status: 404 });
  };
  return { fetchImpl, calls };
}

const tmp = () => mkdtempSync(join(tmpdir(), 'werkbank-skillsync-'));

test('sync installs approved skills, then reports unchanged, then updates on a new version', async () => {
  const dir = tmp();
  try {
    const rows = { 'alpha-skill': { text: skillText('alpha-skill'), version: 1 } };
    const reg = fakeRegistry(rows);
    let r = await syncSkills({ url: 'https://x.supabase.co', key: 'pk', skillsDir: dir, fetchImpl: reg.fetchImpl });
    assert.deepEqual(r.installed, ['alpha-skill@v1']);
    assert.equal(readFileSync(join(dir, 'alpha-skill/SKILL.md'), 'utf8'), rows['alpha-skill'].text);

    r = await syncSkills({ url: 'https://x.supabase.co', key: 'pk', skillsDir: dir, fetchImpl: reg.fetchImpl });
    assert.deepEqual(r.unchanged, ['alpha-skill']);
    assert.equal(reg.calls.filter((c) => c.fn === 'skills_get').length, 1, 'unchanged skills are not downloaded again');

    rows['alpha-skill'] = { text: skillText('alpha-skill', 'neu'), version: 2 };
    r = await syncSkills({ url: 'https://x.supabase.co', key: 'pk', skillsDir: dir, fetchImpl: reg.fetchImpl });
    assert.deepEqual(r.updated, ['alpha-skill@v2']);
    assert.match(readFileSync(join(dir, 'alpha-skill/SKILL.md'), 'utf8'), /neu/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sync counts installs and updates (not unchanged skills) and survives a failing counter', async () => {
  const dir = tmp();
  try {
    const rows = { 'alpha-skill': { text: skillText('alpha-skill'), version: 1 } };
    const reg = fakeRegistry(rows);
    await syncSkills({ url: 'https://x.supabase.co', key: 'pk', skillsDir: dir, fetchImpl: reg.fetchImpl });
    await syncSkills({ url: 'https://x.supabase.co', key: 'pk', skillsDir: dir, fetchImpl: reg.fetchImpl });
    const tracks = reg.calls.filter((c) => c.fn === 'skills_track');
    assert.equal(tracks.length, 1, 'the unchanged second sync reports nothing');
    assert.deepEqual([tracks[0].args.p_event, tracks[0].args.p_slugs], ['install', ['alpha-skill']]);
    assert.match(tracks[0].args.p_device, /^[0-9a-f]{16}$/);

    const dir2 = tmp();
    const failing = async (url, init) => (url.endsWith('skills_track') ? new Response('no', { status: 500 }) : reg.fetchImpl(url, init));
    const r = await syncSkills({ url: 'https://x.supabase.co', key: 'pk', skillsDir: dir2, fetchImpl: failing });
    assert.deepEqual(r.installed, ['alpha-skill@v1']);
    rmSync(dir2, { recursive: true, force: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sync removes retired synced skills but never touches local skills', async () => {
  const dir = tmp();
  try {
    mkdirSync(join(dir, 'my-own-skill'));
    writeFileSync(join(dir, 'my-own-skill/SKILL.md'), skillText('my-own-skill'));
    const rows = { 'alpha-skill': { text: skillText('alpha-skill'), version: 1 } };
    await syncSkills({ url: 'https://x.supabase.co', key: 'pk', skillsDir: dir, fetchImpl: fakeRegistry(rows).fetchImpl });
    delete rows['alpha-skill'];
    const r = await syncSkills({ url: 'https://x.supabase.co', key: 'pk', skillsDir: dir, fetchImpl: fakeRegistry(rows).fetchImpl });
    assert.deepEqual(r.removed, ['alpha-skill']);
    assert.ok(!existsSync(join(dir, 'alpha-skill')));
    assert.ok(existsSync(join(dir, 'my-own-skill/SKILL.md')), 'local skill without marker stays');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sync does not overwrite a local skill of the same name unless forced', async () => {
  const dir = tmp();
  try {
    mkdirSync(join(dir, 'alpha-skill'));
    writeFileSync(join(dir, 'alpha-skill/SKILL.md'), 'LOCAL');
    const rows = { 'alpha-skill': { text: skillText('alpha-skill'), version: 1 } };
    let r = await syncSkills({ url: 'https://x.supabase.co', key: 'pk', skillsDir: dir, fetchImpl: fakeRegistry(rows).fetchImpl });
    assert.match(r.skipped[0], /local skill/);
    assert.equal(readFileSync(join(dir, 'alpha-skill/SKILL.md'), 'utf8'), 'LOCAL');
    r = await syncSkills({ url: 'https://x.supabase.co', key: 'pk', skillsDir: dir, fetchImpl: fakeRegistry(rows).fetchImpl, force: true });
    assert.deepEqual(r.installed, ['alpha-skill@v1']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sync rejects checksum mismatches, wrong names and path-like names', async () => {
  const dir = tmp();
  try {
    const rows = {
      'bad-sum': { text: skillText('bad-sum'), version: 1, sha: 'f'.repeat(64) },
      'wrong-name': { text: skillText('other-name'), version: 1 },
      '../evil': { text: skillText('evil'), version: 1 },
    };
    const r = await syncSkills({ url: 'https://x.supabase.co', key: 'pk', skillsDir: dir, fetchImpl: fakeRegistry(rows).fetchImpl });
    assert.deepEqual(r.installed, []);
    assert.equal(r.skipped.length, 3);
    assert.ok(!existsSync(join(dir, '..', 'evil')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('validateSkill blocks credentials and oversized descriptions', () => {
  assert.throws(() => validateSkill('a-skill', skillText('a-skill', 'key sb_secret_abcdef')), /credential/);
  assert.throws(() => validateSkill('a-skill', skillText('b-skill')), /must equal/);
  assert.throws(() => validateSkill('a-skill', `---\nname: a-skill\ndescription: ${'x'.repeat(241)}\n---\n`), /240/);
});

test('the bundled example skills pass publishing validation and publish only as drafts', async () => {
  const reg = fakeRegistry({});
  const dirs = ['board-briefing', 'ticket-writer'].map((n) => join(ROOT, 'examples/skills', n));
  const out = await publishSkills({ url: 'https://x.supabase.co', key: 'sk', dirs, fetchImpl: reg.fetchImpl });
  assert.deepEqual(out.map((o) => o.status), ['draft', 'draft']);
  assert.ok(reg.calls.every((c) => ['skills_publish', 'skills_similar'].includes(c.fn)), 'publishing never calls the status function');
  const sent = reg.calls.find((c) => c.fn === 'skills_publish').args;
  assert.equal(sent.p_meta.domain, 'Governance & Risiko');
  assert.ok(sent.p_meta.tools.includes('get_risks'));
});

test('migration 007 exposes only approved reads to anon and keeps writes service-role only', () => {
  const sql = readFileSync(join(ROOT, 'supabase/migrations/20261018_007_skills_registry.sql'), 'utf8');
  assert.match(sql, /grant execute on function public\.skills_list\(\), public\.skills_get\(text\) to anon, authenticated, service_role/);
  assert.match(sql, /grant execute on function public\.skills_publish\(text,text,text,text\), public\.skills_set_status\(text,text\),\s*public\.skills_admin_list\(\) to service_role/);
  assert.equal((sql.match(/status = 'approved'/g) ?? []).length, 2, 'both read functions filter on approved');
  assert.equal((sql.match(/security definer\s+set search_path = ''/g) ?? []).length, 5);
});

const SIMILAR = [{ slug: 'expense-check', status: 'approved', domain: 'Service & Support', team: 'Finance', sharedTools: ['create_ticket'], similar: true }];
const ticketDir = join(ROOT, 'examples/skills/ticket-writer');

test('publishing stops when a similar skill exists and no reason or variant is given', async () => {
  const reg = fakeRegistry({}, { similar: SIMILAR });
  const [r] = await publishSkills({ url: 'https://x.supabase.co', key: 'sk', dirs: [ticketDir], fetchImpl: reg.fetchImpl });
  assert.equal(r.blocked, true);
  assert.equal(r.similar[0].slug, 'expense-check');
  assert.ok(!reg.calls.some((c) => c.fn === 'skills_publish'), 'nothing was uploaded');
});

test('a reason or a variant link lets a similar skill through and is sent with the profile', async () => {
  for (const options of [{ reason: 'anderes Ticketsystem' }, { variantOf: 'expense-check' }]) {
    const reg = fakeRegistry({}, { similar: SIMILAR });
    const [r] = await publishSkills({ url: 'https://x.supabase.co', key: 'sk', dirs: [ticketDir], fetchImpl: reg.fetchImpl, ...options });
    assert.equal(r.blocked, undefined);
    assert.equal(r.similar.length, 1);
    const meta = reg.calls.find((c) => c.fn === 'skills_publish').args.p_meta;
    assert.ok(meta.variant_reason || meta.variant_of);
  }
});

test('profile validation rejects unknown domains, data classes and connector tools', () => {
  const skill = (extra) => `---\nname: a-skill\ndescription: d\nmetadata:\n${extra}\n---\n`;
  assert.throws(() => validateSkill('a-skill', skill('  domain: Marketing')), /domain/);
  assert.throws(() => validateSkill('a-skill', skill('  data-class: geheim')), /data-class/);
  assert.throws(() => validateSkill('a-skill', skill('  tools: get_risks, hack_planet'), { tools: knownTools() }), /hack_planet/);
  assert.doesNotThrow(() => validateSkill('a-skill', skill('  domain: Finanzen\n  tools: get_risks'), { tools: knownTools() }));
  assert.deepEqual(parseSkill('---\nname: a\ndescription: d\n---\n').meta, { tools: [] });
});

test('migration 008 keeps search public-read and similarity and writes service-role only', () => {
  const sql = readFileSync(join(ROOT, 'supabase/migrations/20261018_008_skills_marketplace_s1.sql'), 'utf8');
  assert.match(sql, /grant execute on function public\.skills_list\(\), public\.skills_get\(text\), public\.skills_search\(text,integer\)\s+to anon, authenticated, service_role/);
  assert.match(sql, /grant execute on function public\.skills_publish\(text,text,text,text,jsonb\), public\.skills_similar\(text,text,text,text\[\]\),[\s\S]*?to service_role;/);
  assert.match(sql, /drop function if exists public\.skills_publish\(text, text, text, text\)/);
  assert.equal((sql.match(/status = 'approved'/g) ?? []).length, 3, 'list, get and search filter on approved');
  assert.doesNotMatch(sql, /to anon[^;]*skills_(publish|similar|set_)/);
});

test('classification: board area, LOB and scope are validated and must be consistent', () => {
  const skill = (extra) => `---\nname: a-skill\ndescription: d\nmetadata:\n${extra}\n---\n`;
  assert.doesNotThrow(() => validateSkill('a-skill', skill('  board-area: Engineering\n  lob: BTP\n  scope: lob')));
  assert.doesNotThrow(() => validateSkill('a-skill', skill('  lob: Concur\n  scope: team\n  team: Delivery')));
  assert.throws(() => validateSkill('a-skill', skill('  board-area: Legal')), /board-area/);
  assert.throws(() => validateSkill('a-skill', skill('  lob: Retail')), /lob/);
  assert.throws(() => validateSkill('a-skill', skill('  board-area: Finance\n  lob: BTP')), /belongs to Engineering/);
  assert.throws(() => validateSkill('a-skill', skill('  scope: planet')), /scope/);
  assert.throws(() => validateSkill('a-skill', skill('  scope: team')), /needs a team/);
  assert.throws(() => validateSkill('a-skill', skill('  scope: lob')), /needs a lob/);
  assert.throws(() => validateSkill('a-skill', skill('  scope: board-area')), /needs a board-area/);
  assert.deepEqual(parseSkill(skill('  board-area: Sales\n  scope: team\n  team: AM')).meta.board_area, 'Sales');
});

test('migration 009 uses the same taxonomy as the script and changes only function bodies', () => {
  const sql = readFileSync(join(ROOT, 'supabase/migrations/20261018_009_skills_classification.sql'), 'utf8');
  const list = (re) => [...re.exec(sql)[1].matchAll(/'([A-Za-z-]+)'/g)].map((m) => m[1]);
  assert.deepEqual(list(/ba not in \(([^)]*)\)/), BOARD_AREAS);
  assert.deepEqual(list(/lob not in \(([^)]*)\)/), Object.keys(LOBS));
  assert.deepEqual(list(/sc not in \(([^)]*)\)/), SCOPES);
  assert.doesNotMatch(sql.replace(/--.*/g, ''), /\b(drop|alter table|create table|grant|revoke)\b/i, 'no schema or permission change');
  assert.match(sql, /'boardArea'/);
});

test('the example skills carry a classification the registry accepts', () => {
  for (const name of ['board-briefing', 'ticket-writer', 'skill-finder']) {
    const text = readFileSync(join(ROOT, 'examples/skills', name, 'SKILL.md'), 'utf8');
    const { meta } = validateSkill(name, text, { tools: knownTools() });
    assert.ok(SCOPES.includes(meta.scope), `${name} has a scope`);
  }
});

test('migration 010: published status, approval only via skills_approve, usage counters and ranking', () => {
  const sql = readFileSync(join(ROOT, 'supabase/migrations/20261018_010_skills_maturity_ranking.sql'), 'utf8');
  const code = sql.replace(/--.*/g, '');
  assert.match(code, /check \(status in \('draft','published','retired'\)\)/);
  assert.match(code, /check \(maturity in \('pilot','empfohlen','approved'\)\)/);
  assert.equal((code.match(/status = 'published'/g) ?? []).length >= 4, true, 'list, get, search and ranking filter on published');
  assert.doesNotMatch(code.replace(/update skills\.skill set status = 'published' where status = 'approved'/, ''), /status = 'approved'/);
  assert.match(code, /grant execute on function public\.skills_approve\(text,text\),[\s\S]*?to service_role;/);
  assert.doesNotMatch(code, /to anon[^;]*skills_(approve|publish|set_)/);
  assert.match(code, /grant execute on function[^;]*skills_ranking\(integer,integer\), public\.skills_track\(text\[\],text,text\)\s+to anon, authenticated, service_role/);
  assert.match(code, /revoke all on skills\.event from anon, authenticated/);
  assert.match(code, /approved_by = '', approved_at = null, approved_version = null/, 'a new version clears the approval');
  assert.deepEqual(MATURITIES, ['pilot', 'empfohlen', 'approved']);
});

test('CLI: approve needs an approver, release and approve are different commands', async () => {
  const { execFileSync } = await import('node:child_process');
  const run = (...args) => {
    try {
      execFileSync('node', [join(ROOT, 'scripts/skills-registry.mjs'), ...args], { env: { ...process.env, SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SECRET_KEY: 'sb_secret_x', SKILL_APPROVER: '' }, encoding: 'utf8', stdio: 'pipe' });
      return '';
    } catch (error) {
      return String(error.stderr);
    }
  };
  assert.match(run('approve', 'alpha-skill'), /--by/);
  assert.match(run('approve', '--by', 'Chef'), /Usage: skills approve/);
  assert.match(run('bogus'), /release\|retire/);
});

test('every bundled example skill is valid, and migration 014 accepts exactly the domains the registry code accepts', async () => {
  const { readdirSync } = await import('node:fs');
  const { DOMAINS } = await import('../scripts/skills-registry.mjs');
  const tools = knownTools();
  for (const name of readdirSync(join(ROOT, 'examples/skills'))) {
    validateSkill(name, readFileSync(join(ROOT, 'examples/skills', name, 'SKILL.md'), 'utf8'), { tools });
  }
  const sql = readFileSync(join(ROOT, 'supabase/migrations/20261020_014_skill_domains.sql'), 'utf8');
  const listed = /dom not in \(([^)]*)\)/.exec(sql)[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
  assert.deepEqual(listed, DOMAINS);
});
