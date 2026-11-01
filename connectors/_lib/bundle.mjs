/**
 * Stages one connector the way an extracted .mcpb looks:
 *   manifest.json
 *   connectors/_lib/server/*          shared code
 *   connectors/_lib/data/*            the sample data this connector reads
 *   connectors/<id>/server/index.mjs  the connector itself
 * Used by `npm run build:connectors` (zip) and by the one-click install in the desktop app (no zip).
 */
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractSub4MeData } from './server/sub4me.mjs';
import { extractMarketplaceData } from './server/skill-profiles.mjs';
import { extractGraph } from './server/graph.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

/** Connectors that run on the shared library, in the order they are shown. */
export const LIBRARY_CONNECTORS = ['ai-control-tower', 'sub4me', 'n8n-automation', 'skill-marketplace', 'knowledge-graph', 'web-sources', 'werkbank-workspace'];

const read = (path) => readFileSync(join(ROOT, path), 'utf8');

/** Connectors that only bring a manifest: the server is a published package that the manifest starts (for example with uvx). */
export const MANIFEST_ONLY_CONNECTORS = ['cognee-memory'];

/** Every connector Werkbank ships, in the order they are shown. */
export const BUNDLED_CONNECTORS = [...LIBRARY_CONNECTORS, ...MANIFEST_ONLY_CONNECTORS];

/** Sample data files per connector, written into connectors/_lib/data/. */
const DATA = {
  'ai-control-tower': (put) => put.copy('examples/control-tower/data.json', 'data.json'),
  sub4me: (put) => {
    put.copy('examples/control-tower/data.json', 'data.json');
    put.json('sub4me.json', extractSub4MeData(read('examples/sub4me/index.html')));
  },
  'n8n-automation': (put) => {
    put.copy('examples/automation-dashboard/categories.json', 'n8n-categories.json');
    put.copy('examples/infra-ops/data.json', 'infra-ops.json');
  },
  'skill-marketplace': (put) => put.json('skill-marketplace.json', extractMarketplaceData(read('examples/skill-marketplace/index.html'))),
  'knowledge-graph': (put) => put.json('knowledge-graph.json', extractGraph(read('examples/knowledge-graph/index.html'))),
  'web-sources': () => {},
  'werkbank-workspace': () => {},
};

/** Copy manifest, shared code, the connector and its data into `target` (an empty folder). */
export function stageConnector(id, target) {
  if (!BUNDLED_CONNECTORS.includes(id)) throw new Error(`unknown connector: ${id}`);
  const source = join(ROOT, 'connectors', id);
  cpSync(join(source, 'manifest.json'), join(target, 'manifest.json'));
  if (MANIFEST_ONLY_CONNECTORS.includes(id)) return target;
  cpSync(join(ROOT, 'connectors/_lib/server'), join(target, 'connectors/_lib/server'), { recursive: true });
  cpSync(join(source, 'server'), join(target, 'connectors', id, 'server'), { recursive: true });
  const dataDir = join(target, 'connectors/_lib/data');
  mkdirSync(dataDir, { recursive: true });
  DATA[id]({
    copy: (from, name) => cpSync(join(ROOT, from), join(dataDir, name)),
    json: (name, value) => writeFileSync(join(dataDir, name), JSON.stringify(value, null, 2)),
  });
  return target;
}
