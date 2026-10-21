/**
 * Agent Activity Space: aggregates the production agents of the Control Tower registry into families, platforms and
 * systems and embeds the result (plus the shared design system) into the Space page.
 *   npm run sync:agent-activity            write
 *   npm run sync:agent-activity -- --check fail when the page is out of date
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { embedDesignSystem } from './sync-design-system.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = 'examples/agent-activity/index.html';
const BLOCK = /(<script type="application\/json" id="aa-data">)([\s\S]*?)(<\/script>)/;
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const count = (list, key) => list.reduce((acc, item) => ({ ...acc, [item[key]]: (acc[item[key]] ?? 0) + 1 }), {});
const sum = (list, key) => list.reduce((total, item) => total + item[key], 0);

/** Pure: Control Tower data + links -> what the Space draws. Throws on links that point nowhere. */
export function buildActivity(tower, links) {
  const registry = tower.agents.registry;
  const production = registry.filter((agent) => agent.lifecycle === 'production');
  const systemIds = new Set(links.systems.map((system) => system.id));

  const names = [...new Set(production.map((agent) => agent.family))];
  for (const name of names) {
    const linked = links.families[name];
    if (!linked?.length) throw new Error(`links.json has no systems for the agent family "${name}"`);
    for (const id of linked) if (!systemIds.has(id)) throw new Error(`links.json: unknown system "${id}" for "${name}"`);
  }
  for (const name of Object.keys(links.families)) {
    if (!names.includes(name)) throw new Error(`links.json lists "${name}", which has no production agents`);
  }

  const families = names
    .map((name) => {
      const agents = production.filter((agent) => agent.family === name);
      return {
        id: slug(name),
        name,
        agents: agents.length,
        runsPerDay: sum(agents, 'runsPerDay'),
        costPerWeekEur: sum(agents, 'costPerWeekEur'),
        overprivileged: agents.filter((agent) => agent.overprivileged).length,
        euHighRisk: agents.filter((agent) => agent.euRisk === 'high').length,
        types: count(agents, 'type'),
        platforms: count(agents, 'platform'),
        teams: [...new Set(agents.map((agent) => agent.ownerTeam))].sort(),
        dataClasses: count(agents, 'dataClass'),
        systems: links.families[name],
      };
    })
    .sort((a, b) => b.runsPerDay - a.runsPerDay || a.name.localeCompare(b.name));

  const platforms = Object.entries(count(production, 'platform'))
    .map(([name, agents]) => ({ id: slug(name), name, agents, runsPerDay: sum(production.filter((a) => a.platform === name), 'runsPerDay') }))
    .sort((a, b) => b.runsPerDay - a.runsPerDay);
  const systems = links.systems.map((system) => {
    const used = families.filter((family) => family.systems.includes(system.id));
    return { ...system, families: used.length, agents: sum(used, 'agents') };
  });

  return {
    note: 'Fictional sample data. Calls in this Space are simulated from the registry field runsPerDay; nothing here is measured live. Links to business systems are illustrative.',
    totals: {
      productionAgents: production.length,
      runsPerDay: sum(production, 'runsPerDay'),
      costPerWeekEur: sum(production, 'costPerWeekEur'),
      pendingReview: registry.filter((agent) => agent.lifecycle === 'pending_review').length,
      overprivileged: production.filter((agent) => agent.overprivileged).length,
      euHighRisk: production.filter((agent) => agent.euRisk === 'high').length,
    },
    families,
    platforms,
    systems,
  };
}

export const repoActivity = () => buildActivity(JSON.parse(read('examples/control-tower/data.json')), JSON.parse(read('examples/agent-activity/links.json')));
const serialise = (data) => JSON.stringify(data, null, 1).replaceAll('<', '\\u003c');

export function embedActivity(html, data, css) {
  if (!BLOCK.test(html)) throw new Error(`${PAGE} has no <script id="aa-data"> block`);
  const withData = html.replace(BLOCK, (_m, open, _body, close) => `${open}\n${serialise(data)}\n${close}`);
  return embedDesignSystem(withData, css);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const html = read(PAGE);
  const next = embedActivity(html, repoActivity(), read('examples/shared/design-system.css'));
  if (process.argv.includes('--check')) {
    if (next !== html) { console.error('Agent Activity is out of sync — run: npm run sync:agent-activity'); process.exit(1); }
    console.log('Agent Activity is in sync.');
  } else {
    writeFileSync(join(ROOT, PAGE), next);
    console.log('Embedded the agent activity data and the design system.');
  }
}
