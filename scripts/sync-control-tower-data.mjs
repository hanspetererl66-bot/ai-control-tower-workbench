import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'examples/control-tower');

// The sandboxed Space iframe cannot fetch files, so data.json is embedded in the page.
const BLOCK = /(<script type="application\/json" id="ct-data">)([\s\S]*?)(<\/script>)/;

/** Serialise so the JSON can never close the script tag early. */
export function serialise(data) {
  return JSON.stringify(data, null, 2).replaceAll('<', '\\u003c');
}

export function embeddedData(html) {
  const match = BLOCK.exec(html);
  if (!match) throw new Error('index.html has no <script id="ct-data"> block');
  return JSON.parse(match[2]);
}

export function embedData(html, data) {
  if (!BLOCK.test(html)) throw new Error('index.html has no <script id="ct-data"> block');
  return html.replace(BLOCK, (_m, open, _body, close) => `${open}\n${serialise(data)}\n${close}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const htmlPath = join(DIR, 'index.html');
  const data = JSON.parse(readFileSync(join(DIR, 'data.json'), 'utf8'));
  const html = readFileSync(htmlPath, 'utf8');
  const next = embedData(html, data);
  if (process.argv.includes('--check')) {
    if (next !== html) {
      console.error('index.html is out of sync with data.json — run: npm run sync:control-tower');
      process.exit(1);
    }
    console.log('Control Tower data is in sync.');
  } else {
    writeFileSync(htmlPath, next);
    console.log('Embedded data.json into examples/control-tower/index.html');
  }
}
