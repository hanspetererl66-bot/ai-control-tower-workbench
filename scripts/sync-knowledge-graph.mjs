/**
 * Knowledge Graph Space: builds the graph from the other example Spaces (Sub4Me portfolio, Skill Marketplace profiles,
 * Control Tower data, n8n sample data) plus examples/knowledge-graph/links.json and embeds it into the Space page.
 *   npm run sync:knowledge-graph            write
 *   npm run sync:knowledge-graph -- --check fail when the page is out of date
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGraph, extractAutomationData } from '../connectors/control-tower/server/graph.mjs';
import { extractMarketplaceData } from '../connectors/control-tower/server/skill-profiles.mjs';
import { extractSub4MeData } from '../connectors/control-tower/server/sub4me.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = 'examples/knowledge-graph/index.html';
const BLOCK = /(<script type="application\/json" id="kg-data">)([\s\S]*?)(<\/script>)/;
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

export function sourcesFromRepo() {
  return {
    sub4me: extractSub4MeData(read('examples/sub4me/index.html')),
    marketplace: extractMarketplaceData(read('examples/skill-marketplace/index.html')),
    controlTower: JSON.parse(read('examples/control-tower/data.json')),
    automation: extractAutomationData(read('examples/automation-dashboard/index.html')),
    links: JSON.parse(read('examples/knowledge-graph/links.json')),
  };
}

export const repoGraph = () => buildGraph(sourcesFromRepo());
export const serialise = (graph) => JSON.stringify(graph, null, 1).replaceAll('<', '\\u003c');
export function embedGraph(html, graph) {
  if (!BLOCK.test(html)) throw new Error(`${PAGE} has no <script id="kg-data"> block`);
  return html.replace(BLOCK, (_m, open, _body, close) => `${open}\n${serialise(graph)}\n${close}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const html = read(PAGE);
  const graph = repoGraph();
  if (graph.unresolvedLinks) throw new Error(`links.json points to missing nodes: ${JSON.stringify(graph.unresolvedLinks)}`);
  const next = embedGraph(html, graph);
  if (process.argv.includes('--check')) {
    if (next !== html) { console.error('Knowledge graph is out of sync — run: npm run sync:knowledge-graph'); process.exit(1); }
    console.log('Knowledge graph is in sync.');
  } else {
    writeFileSync(join(ROOT, PAGE), next);
    console.log(`Embedded ${graph.nodes.length} nodes and ${graph.edges.length} edges.`);
  }
}
