import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
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
  const { SKILL_RATING_TOOL_DEFINITIONS } = await import('../connectors/control-tower/server/skill-ratings.mjs');
  const { SAP_HELP_TOOL_DEFINITIONS } = await import('../connectors/control-tower/server/sap-help.mjs');
  const real = new Set([...TOOL_DEFINITIONS, ...TICKET_TOOL_DEFINITIONS, ...SKILL_TOOL_DEFINITIONS, ...SUB4ME_TOOL_DEFINITIONS, ...N8N_TOOL_DEFINITIONS, ...SKILL_PROFILE_TOOL_DEFINITIONS, ...GRAPH_TOOL_DEFINITIONS, ...SKILL_RATING_TOOL_DEFINITIONS, ...SAP_HELP_TOOL_DEFINITIONS].map((t) => t.name));
  for (const tool of real) assert.ok(knownTools().has(tool), `manifest lists ${tool}`);
  const dir = mkdtempSync(join(tmpdir(), 'werkbank-skills-'));
  try {
    const names = installExampleSkills({ root: ROOT, skillsDir: dir });
    assert.deepEqual(names.sort(), ['access-review-prep', 'automation-health-check', 'board-briefing', 'business-case-builder', 'call-followup', 'competitive-battlecard', 'contract-checker', 'customer-call-prep', 'deal-risk-check', 'discovery-meddpicc', 'handover-onboarding-plan', 'interest-logger', 'lead-qualifier', 'lead-router', 'opportunity-planner', 'pipeline-review', 'pricing-guard', 'rate-skill', 'rfp-responder', 'security-questionnaire-helper', 'skill-finder', 'skill-search', 'ticket-triage', 'ticket-writer']);
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
  assert.equal(data.skills.filter((s) => !s.sample).length, 24);
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

test('mockup Spaces: embedded data is in sync, fictional, internally consistent and safe to render', async () => {
  const { MOCKUPS, embedMockupData } = await import('../scripts/sync-mockup-spaces.mjs');
  for (const { page, data } of MOCKUPS) {
    const html = readFileSync(join(ROOT, page), 'utf8');
    assert.equal(embedMockupData(html, JSON.parse(readFileSync(join(ROOT, data), 'utf8'))), html, `${page}: run npm run sync:mockups`);
    assert.match(html, /Mockup with fictional data/);
    assert.doesNotMatch(html.replace(/<script type="application\/json"[\s\S]*?<\/script>/, ''), /\bfetch\(|XMLHttpRequest|localStorage|type="submit"/);
  }
  const calls = JSON.parse(readFileSync(join(ROOT, 'examples/call-transcripts/calls.json'), 'utf8')).calls;
  assert.equal(new Set(calls.map((c) => c.id)).size, calls.length);
  for (const c of calls) {
    const inRange = (n) => Number.isInteger(n) && n >= 0 && n < c.turns.length;
    for (const x of [...c.decisions, ...c.actions, ...c.risks]) assert.ok(inRange(x.turn), `${c.id}: turn reference ${x.turn}`);
    assert.ok(c.turns.every((t) => c.people.some((p) => p.name === t.who)), `${c.id}: every speaker is a participant`);
  }
  const threads = JSON.parse(readFileSync(join(ROOT, 'examples/customer-emails/threads.json'), 'utf8')).threads;
  const callIds = new Set(calls.map((c) => c.id));
  assert.ok(threads.some((t) => t.ai.flags.length && t.messages.some((m) => m.untrusted)), 'one conversation demonstrates the untrusted-content flag');
  for (const t of threads) {
    assert.ok(t.messages.every((m) => !m.email.includes('@') || /\.example$/.test(m.email.split('@')[1])), `${t.id}: only reserved .example domains`);
    for (const x of t.ai.cross) assert.ok(callIds.has(x.id), `${t.id}: references an existing call`);
  }
});

test('Sales Space: offers and contracts match the Sub4Me sample data, gates and links are consistent', () => {
  const sales = JSON.parse(readFileSync(join(ROOT, 'examples/sales/pipeline.json'), 'utf8'));
  const subAll = JSON.parse(/id="s4m-data">([\s\S]*?)<\/script>/.exec(readFileSync(join(ROOT, 'examples/sub4me/index.html'), 'utf8'))[1]);
  const sub = { offers: [subAll, ...subAll.otherCustomers].flatMap((r) => r.offers), contracts: [subAll, ...subAll.otherCustomers].flatMap((r) => r.contracts) };
  const calls = new Set(JSON.parse(readFileSync(join(ROOT, 'examples/call-transcripts/calls.json'), 'utf8')).calls.map((c) => c.id));
  const threads = new Set(JSON.parse(readFileSync(join(ROOT, 'examples/customer-emails/threads.json'), 'utf8')).threads.map((t) => t.id));
  const skills = new Set(readdirSync(join(ROOT, 'examples/skills')));
  const stages = Object.fromEntries(sales.stages.map((s) => [s.id, s]));
  assert.deepEqual(sales.stages.map((s) => s.id), ['interest', 'lead', 'opportunity', 'sell', 'contract']);
  assert.equal(new Set(sales.deals.map((d) => d.id)).size, sales.deals.length);
  for (const d of sales.deals) {
    const st = stages[d.stage];
    assert.ok(st, d.id);
    assert.equal(d.met.length, st.exit.length, `${d.id}: one flag per exit criterion`);
    assert.ok(skills.has(d.next.skill) || ['customer-call-prep', 'renewal-radar'].includes(d.next.skill), `${d.id}: next skill exists`);
    const following = sales.stages[sales.stages.indexOf(st) + 1];
    assert.ok(st.skills.includes(d.next.skill) || following?.skills.includes(d.next.skill), `${d.id}: next skill belongs to this or the next stage`);
    for (const c of d.links?.calls ?? []) assert.ok(calls.has(c), `${d.id} -> ${c}`);
    for (const t of d.links?.threads ?? []) assert.ok(threads.has(t), `${d.id} -> ${t}`);
    if (d.breakdown) assert.equal(d.breakdown.reduce((a, b) => a + b[1], 0), d.score, `${d.id}: the score is the sum of its parts`);
    if (d.offerId) {
      const o = sub.offers.find((x) => x.id === d.offerId);
      assert.ok(o, d.offerId);
      assert.equal(d.value, o.annualEur); assert.equal(d.discountPct, o.discountPct); assert.equal(d.approval, o.approval);
      assert.equal(d.competitor, o.competitor); assert.equal(d.valid, o.validUntil); assert.equal(d.owner, o.owner.name);
      if (o.discountPct > sales.discountThresholdPct) assert.equal(d.met[1], false, `${d.id}: discount above the threshold is not cleared`);
    }
    if (d.stage === 'contract') {
      const c = sub.contracts.find((x) => x.id === d.contractId);
      assert.ok(c, d.contractId);
      assert.equal(d.value, c.annualEur); assert.equal(d.end, c.end); assert.equal(d.noticeDays, c.noticeDays); assert.equal(d.autoRenew, c.autoRenew);
    }
  }
  assert.ok(sales.deals.some((d) => d.risks.some((r) => /instruction/i.test(r))), 'the untrusted-content case is visible');
  const html = readFileSync(join(ROOT, 'examples/sales/index.html'), 'utf8');
  assert.match(html, /class="panel card/);
});

test('Sales Space: forecast categories follow the stated rules and meetings link to real deals, calls and threads', () => {
  const sales = JSON.parse(readFileSync(join(ROOT, 'examples/sales/pipeline.json'), 'utf8'));
  const calls = JSON.parse(readFileSync(join(ROOT, 'examples/call-transcripts/calls.json'), 'utf8')).calls;
  const threads = new Set(JSON.parse(readFileSync(join(ROOT, 'examples/customer-emails/threads.json'), 'utf8')).threads.map((t) => t.id));
  const skills = new Set(readdirSync(join(ROOT, 'examples/skills')));
  const byId = Object.fromEntries(sales.deals.map((d) => [d.id, d]));
  for (const d of sales.deals) {
    const open = d.stage === 'opportunity' || d.stage === 'sell';
    assert.equal(Boolean(d.category), open, `${d.id}: only opportunity and sell deals are in the forecast`);
    if (!open) continue;
    assert.ok(d.closeDate > sales.asOf, `${d.id}: close date is in the future`);
    const want = d.score >= 70 ? 'commit' : d.score >= 50 ? 'best' : 'pipeline';
    assert.equal(d.category, want, `${d.id}: category follows the probability rule`);
    if (d.category === 'commit') assert.ok(d.discountPct <= sales.discountThresholdPct, `${d.id}: commit needs a cleared discount`);
  }
  assert.ok(sales.forecast.quotaEur > 0);
  const ids = new Set();
  for (const m of sales.meetings) {
    assert.ok(!ids.has(m.id), m.id); ids.add(m.id);
    const d = byId[m.dealId]; assert.ok(d, `${m.id}: deal exists`);
    assert.ok(skills.has(m.skill) || ['customer-call-prep'].includes(m.skill), `${m.id}: skill exists`);
    if (m.callId) assert.ok((d.links?.calls ?? []).includes(m.callId), `${m.id}: call is linked to the deal`);
    if (m.threadId) { assert.ok(threads.has(m.threadId)); assert.ok((d.links?.threads ?? []).includes(m.threadId), `${m.id}: thread is linked to the deal`); }
    for (const p of m.people) assert.ok(['us', 'customer'].includes(p.side));
    if (m.date >= sales.asOf) {
      assert.ok(m.prep?.brief.length && m.prep.questions.length, `${m.id}: upcoming meetings have a brief`);
      assert.equal(m.followup, undefined);
    } else {
      const call = calls.find((c) => c.id === m.callId);
      assert.ok(call, `${m.id}: a finished meeting is a recorded call`);
      assert.equal(m.date, call.date); assert.equal(m.time, call.time); assert.equal(m.minutes, call.minutes);
      assert.deepEqual(m.followup.actions, call.actions.map((a) => ({ text: a.text, owner: a.owner, due: a.due })), `${m.id}: actions equal the call actions`);
      assert.equal(m.followup.mail.sent, false, `${m.id}: the mail draft is never sent`);
      assert.match(m.followup.mail.to, /\.example$/); assert.match(m.followup.mail.from, /\.example$/);
      for (const c of m.followup.crm) {
        if (c.field === 'Next step') assert.equal(c.from, d.next.text, `${m.id}: CRM next step starts from the deal`);
        if (c.field === 'Probability') assert.equal(c.from, d.score + ' %', `${m.id}: CRM probability starts from the deal`);
        if (c.field === 'Competitor') assert.equal(c.from, d.competitor);
      }
    }
  }
  assert.ok(sales.meetings.some((m) => m.date < sales.asOf) && sales.meetings.some((m) => m.date >= sales.asOf));
  const html = readFileSync(join(ROOT, 'examples/sales/index.html'), 'utf8');
  assert.match(html, /data-tab="forecast"/); assert.match(html, /data-tab="meetings"/);
  assert.match(html, /nothing is written to a CRM and nothing is sent/);
});

test('MCP Marketplace Space: data is in sync, sourced, and the built-in entries match the connector manifests', async () => {
  const { CATALOGS, embedMockupData } = await import('../scripts/sync-mockup-spaces.mjs');
  for (const { page, data } of CATALOGS) {
    const html = readFileSync(join(ROOT, page), 'utf8');
    assert.equal(embedMockupData(html, JSON.parse(readFileSync(join(ROOT, data), 'utf8'))), html, `${page}: run npm run sync:mockups`);
    assert.doesNotMatch(html.replace(/<script type="application\/json"[\s\S]*?<\/script>/, ''), /\bfetch\(|XMLHttpRequest|localStorage|type="submit"/);
  }
  const d = JSON.parse(readFileSync(join(ROOT, 'examples/mcp-marketplace/servers.json'), 'utf8'));
  assert.equal(new Set(d.servers.map((s) => s.id)).size, d.servers.length);
  for (const s of d.servers) {
    assert.ok(s.tools.length && s.tools.every((t) => d.classes[t.class]), `${s.id}: every tool has a known class`);
    assert.equal(new Set(s.tools.map((t) => t.name)).size, s.tools.length, `${s.id}: unique tools`);
    if (s.status === 'candidate') {
      assert.match(s.source, /^https:\/\//); assert.ok(s.assessment.checks.length, `${s.id}: open checks are listed`);
      assert.ok(s.tools.filter((t) => t.class !== 'read').every((t) => t.default === 'off'), `${s.id}: nothing that can change or read data is on by default`);
      assert.match(d.note, /not run by us/);
    }
  }
  const arc = d.servers.find((s) => s.id === 'arc-1');
  assert.equal(arc.tools.length, 12);
  assert.deepEqual(d.servers.find((s) => s.id === 'sap-notes').tools.map((t) => t.name), ['search', 'fetch']);
  assert.ok(arc.switches.some((w) => w.name === 'SAP_ALLOW_FREE_SQL' && w.default === 'false'));
  for (const [id, dir] of [['ai-control-tower', 'control-tower'], ['gmail-drafts', 'gmail']]) {
    const m = JSON.parse(readFileSync(join(ROOT, 'connectors', dir, 'manifest.json'), 'utf8'));
    const s = d.servers.find((x) => x.id === id);
    assert.deepEqual(s.tools.map((t) => t.name), m.tools.map((t) => t.name), `${id}: tools equal the manifest`);
    assert.equal(s.version, m.version);
  }
});

test('Sales Space: evidence, inbox and briefing context point to real mails, calls, tickets, invoices and contracts', async () => {
  const { extractSub4MeData } = await import('../connectors/control-tower/server/sub4me.mjs');
  const sales = JSON.parse(readFileSync(join(ROOT, 'examples/sales/pipeline.json'), 'utf8'));
  const sub = extractSub4MeData(readFileSync(join(ROOT, 'examples/sub4me/index.html'), 'utf8'));
  sub.otherCustomers ??= [];
  const calls = new Set(JSON.parse(readFileSync(join(ROOT, 'examples/call-transcripts/calls.json'), 'utf8')).calls.map((c) => c.id));
  const threads = new Set(JSON.parse(readFileSync(join(ROOT, 'examples/customer-emails/threads.json'), 'utf8')).threads.map((t) => t.id));
  const recs = [{ ...sub, id: sub.customer.id }, ...sub.otherCustomers];
  const all = (k) => recs.flatMap((r) => r[k]);
  const ids = {
    mail: threads, call: calls,
    ticket: new Set(all('tickets').map((t) => t.id)), invoice: new Set(all('invoices').map((i) => i.id)),
    contract: new Set(all('contracts').map((c) => c.id)), offer: new Set(all('offers').map((o) => o.id)),
    crm: new Set(sales.deals.map((d) => d.id)),
  };
  const check = (b, where) => assert.ok(ids[b.kind]?.has(b.ref), `${where}: ${b.kind} ${b.ref} exists`);
  for (const d of sales.deals) for (const e of d.evidence ?? []) {
    assert.ok(['high', 'medium', 'low'].includes(e.confidence) && e.basis.length, `${d.id}: evidence is complete`);
    for (const b of e.basis) check(b, d.id);
  }
  const byId = Object.fromEntries(sales.deals.map((d) => [d.id, d]));
  const inbox = sales.inbox;
  assert.equal(new Set(inbox.map((x) => x.id)).size, inbox.length);
  for (const x of inbox) {
    assert.ok(byId[x.dealId], `${x.id}: deal exists`);
    check(x.source, x.id);
    assert.ok(['auto', 'suggest', 'approve', 'never'].includes(x.policy));
    if (x.policy === 'approve') assert.ok(x.approver, `${x.id}: needs a named approver`);
    if (x.policy === 'never') assert.equal(x.status, 'blocked');
    else assert.equal(x.status, 'pending');
  }
  assert.ok(inbox.some((x) => x.policy === 'never' && /instruction/i.test(x.summary)), 'an instruction in customer text is blocked');
  // the Sub4Me rows quoted in the briefings equal the Sub4Me data
  for (const t of sales.sub4me.tickets) { const s = all('tickets').find((k) => k.id === t.id); assert.deepEqual({ ...t }, { id: s.id, title: s.title, product: s.product, priority: s.priority, status: s.status, customer: recs.find((r) => r.tickets.includes(s)).id }); }
  for (const i of sales.sub4me.invoices) { const s = all('invoices').find((k) => k.id === i.id); assert.deepEqual({ ...i }, { id: s.id, contractId: s.contractId, status: s.status, due: s.due, grossEur: s.grossEur, customer: recs.find((r) => r.invoices.includes(s)).id }); }
  for (const m of sales.meetings) {
    const c = m.prep?.context; if (!c) continue;
    for (const id of c.tickets) assert.ok(sales.sub4me.tickets.some((t) => t.id === id), `${m.id}: ticket ${id} is in the data`);
    for (const id of c.invoices) assert.ok(sales.sub4me.invoices.some((t) => t.id === id), `${m.id}: invoice ${id} is in the data`);
  }
  // last week's snapshot follows the same category rule as today's data
  const rule = (s) => (s >= 70 ? 'commit' : s >= 50 ? 'best' : 'pipeline');
  for (const d of sales.deals) {
    if (!d.prev) continue;
    assert.equal(d.prev.category, rule(d.prev.score), `${d.id}: previous category follows the rule`);
    assert.ok(d.changeWhy?.text, `${d.id}: changes carry a reason`);
  }
  assert.ok(sales.governance.audit.length && sales.governance.levels.length === 4);
});
