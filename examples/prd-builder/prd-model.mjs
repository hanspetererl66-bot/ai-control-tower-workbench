// BEGIN-MODEL
/* PRD model: Jira issues in, a product requirements document (Markdown) out. Plain functions, no network.
   The page embeds this block (npm run sync:prd-builder); the tests import the same file. */
const PRIORITY_ORDER = ['Highest', 'Very high', 'High', 'Medium', 'Low', 'Lowest'];
const prioRank = (p) => { const i = PRIORITY_ORDER.indexOf(p || ''); return i < 0 ? PRIORITY_ORDER.length : i; };

/** Description text -> { need, criteria[] }: the sentence before "Acceptance criteria" and the bullets after it. */
function parseDescription(text) {
  const t = String(text || '').replace(/\r/g, '').trim();
  const m = /acceptance criteria:?/i.exec(t);
  const need = (m ? t.slice(0, m.index) : t).replace(/\s+/g, ' ').trim();
  const rest = m ? t.slice(m.index + m[0].length) : '';
  const criteria = rest.split('\n').map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean);
  return { need, criteria };
}
const roleOf = (need) => { const m = /^as an? ([^,]+?)\s+i want/i.exec(need); return m ? m[1].trim().toLowerCase() : ''; };

/** Epics with their stories (tickets of other types, or without epic, go under "No epic"). */
function groupByEpic(issues) {
  const epics = issues.filter((i) => i.type === 'Epic');
  const groups = epics.map((e) => ({ epic: e, items: issues.filter((i) => i.type !== 'Epic' && i.parentKey === e.key) }));
  const known = new Set(epics.map((e) => e.key));
  const loose = issues.filter((i) => i.type !== 'Epic' && !known.has(i.parentKey));
  if (loose.length) groups.push({ epic: null, items: loose });
  return groups;
}

function openQuestions(items, groups, selected) {
  const q = [];
  for (const i of items) {
    const d = parseDescription(i.description);
    if (!d.criteria.length) q.push(`${i.key}: no acceptance criteria yet. How do we know it is done?`);
    if (!i.priority) q.push(`${i.key}: no priority set.`);
    if (!roleOf(d.need)) q.push(`${i.key}: the user role is not named (As a ...).`);
  }
  for (const g of groups) if (g.epic && selected.has(g.epic.key) && !g.items.some((s) => selected.has(s.key))) q.push(`${g.epic.key}: the epic has no selected story. Which stories belong to the first release?`);
  return q;
}

/** The PRD as Markdown for the selected issue keys. `today` is an ISO date. */
function buildPrd({ project, issues, selectedKeys, today }) {
  const selected = new Set(selectedKeys);
  const groups = groupByEpic(issues);
  const chosen = issues.filter((i) => selected.has(i.key));
  const stories = chosen.filter((i) => i.type !== 'Epic');
  const L = [];
  L.push(`# Product requirements: ${project}`, '', `Draft from Jira, ${today}. ${stories.length} requirements from ${chosen.length} tickets of project ${project}. Every requirement names its ticket.`, '');
  const epicsChosen = groups.filter((g) => g.epic && (selected.has(g.epic.key) || g.items.some((s) => selected.has(s.key))));
  L.push('## 1. Overview', '');
  if (!epicsChosen.length && !stories.length) L.push('Nothing selected yet. Tick epics or stories on the left.', '');
  for (const g of epicsChosen) L.push(`- **${g.epic.summary}** (${g.epic.key}): ${parseDescription(g.epic.description).need || 'no description'}`);
  if (epicsChosen.length) L.push('');
  L.push('## 2. Goals', '');
  for (const g of epicsChosen) L.push(`- ${g.epic.summary}`);
  if (!epicsChosen.length) L.push('- To be defined.');
  L.push('', '## 3. Users', '');
  const roles = {};
  for (const s of stories) { const r = roleOf(parseDescription(s.description).need) || 'unnamed role'; (roles[r] = roles[r] || []).push(s.key); }
  for (const [r, keys] of Object.entries(roles)) L.push(`- **${r}**: ${keys.join(', ')}`);
  if (!Object.keys(roles).length) L.push('- To be defined.');
  L.push('', '## 4. Requirements', '');
  let n = 0;
  for (const g of groups) {
    const items = g.items.filter((s) => selected.has(s.key)).sort((a, b) => prioRank(a.priority) - prioRank(b.priority) || a.key.localeCompare(b.key, 'en', { numeric: true }));
    if (!items.length) continue;
    L.push(`### ${g.epic ? `${g.epic.summary} (${g.epic.key})` : 'No epic'}`, '');
    for (const s of items) {
      n += 1; const d = parseDescription(s.description);
      L.push(`**R${n} · ${s.summary}** (${s.key}, priority ${s.priority || 'not set'}, status ${s.status || 'unknown'})`, '');
      if (d.need) L.push(d.need, '');
      if (d.criteria.length) { L.push('Acceptance criteria:'); d.criteria.forEach((c) => L.push(`- ${c}`)); L.push(''); }
    }
  }
  if (!n) L.push('No requirements selected.', '');
  L.push('## 5. Out of scope for this release', '');
  const left = issues.filter((i) => i.type !== 'Epic' && !selected.has(i.key));
  if (left.length) left.forEach((i) => L.push(`- ${i.key}: ${i.summary}`)); else L.push('- Nothing left out.');
  L.push('', '## 6. Open questions', '');
  const q = openQuestions(stories, groups, selected);
  if (q.length) q.forEach((x) => L.push(`- ${x}`)); else L.push('- None found from the tickets alone.');
  L.push('', '## 7. Source tickets', '');
  chosen.forEach((i) => L.push(`- ${i.key} · ${i.type || 'Issue'} · ${i.status || '-'} · ${i.priority || '-'} · ${i.summary}`));
  return L.join('\n') + '\n';
}
// END-MODEL
export { parseDescription, roleOf, groupByEpic, openQuestions, buildPrd, prioRank };
