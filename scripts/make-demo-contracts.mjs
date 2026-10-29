/**
 * Writes the demo files for the mass-upload use case: a fictional contract list as Excel and as CSV.
 * Deterministic (fixed seed, fixed reference date), no network. Run: node scripts/make-demo-contracts.mjs
 * The xlsx is built by hand (zip of the minimal OOXML parts), so no spreadsheet library is needed.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = join(ROOT, 'examples/demo-data');
export const AS_OF = '2026-10-19';
export const COLUMNS = ['Contract ID', 'Customer', 'Product', 'Region', 'Contract end', 'Notice days', 'Annual value EUR', 'Owner'];

const PRODUCTS = ['Ariba Procurement', 'SuccessFactors Employee Central', 'Business Technology Platform', 'S/4HANA Cloud Private Edition', 'AI units (Joule, AI Core, Document AI)', 'Concur Travel', 'Integrated Business Planning', 'Signavio Process Manager'];
const CUSTOMERS = ['Nordwind Logistik', 'Alpenblick Maschinenbau', 'Rheintal Pharma', 'Hanse Retail Group', 'Baumgart Energie', 'Lindenhof Versicherung', 'Kraichgau Foods', 'Donau Automotive', 'Spreewald Medien', 'Taunus Chemie', 'Odenwald Bau', 'Neckar Software'];
const REGIONS = ['DACH', 'DACH', 'DACH', 'EMEA', 'EMEA', 'Nordics'];
const OWNERS = ['A. Weber', 'M. Hoffmann', 'S. Keller', 'J. Brandt', 'L. Fischer'];

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}

const addDays = (iso, days) => new Date(Date.parse(iso) + days * 864e5).toISOString().slice(0, 10);

/**
 * 60 fictional contracts. The first twelve end so that their notice deadline falls between 25 days before and
 * 45 days after the reference date (some alerts, some already passed); the rest end later.
 */
export function demoContracts() {
  const r = rng(20261019);
  const pick = (list) => list[Math.floor(r() * list.length)];
  const rows = [];
  for (let i = 0; i < 60; i += 1) {
    const noticeDays = pick([30, 60, 90, 90, 180]);
    const deadlineOffset = i < 12 ? Math.floor(r() * 70) - 25 : 60 + Math.floor(r() * 600);
    const end = addDays(AS_OF, deadlineOffset + noticeDays);
    rows.push([
      `C-${2023 + (i % 4)}-${String(100 + i * 7).padStart(4, '0')}`,
      pick(CUSTOMERS), pick(PRODUCTS), pick(REGIONS),
      end, String(noticeDays), String(Math.round((20 + r() * 480) * 1000)), pick(OWNERS),
    ]);
  }
  return rows;
}

const xml = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const colName = (i) => String.fromCharCode(65 + i);

export function buildXlsx(file, header, rows, sheetName = 'Contracts') {
  const strings = [];
  const index = new Map();
  const sid = (t) => { if (!index.has(t)) { index.set(t, strings.length); strings.push(t); } return index.get(t); };
  const isNum = (v) => /^\d+$/.test(v);
  const rowXml = (cells, r) => `<row r="${r}">${cells.map((v, c) => (isNum(v) && r > 1
    ? `<c r="${colName(c)}${r}"><v>${v}</v></c>`
    : `<c r="${colName(c)}${r}" t="s"><v>${sid(v)}</v></c>`)).join('')}</row>`;
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${[header, ...rows].map((c, i) => rowXml(c, i + 1)).join('')}</sheetData></worksheet>`;
  const parts = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': sheet,
    'xl/sharedStrings.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((s) => `<si><t>${xml(s)}</t></si>`).join('')}</sst>`,
  };
  const dir = mkdtempSync(join(tmpdir(), 'demo-xlsx-'));
  try {
    for (const [p, c] of Object.entries(parts)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), c); }
    rmSync(file, { force: true });
    execFileSync('zip', ['-qr', '-X', file, '[Content_Types].xml', '_rels', 'xl'], { cwd: dir });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

export function csvOf(header, rows) {
  const q = (v) => (/[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [header, ...rows].map((r) => r.map(q).join(',')).join('\n') + '\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(OUT, { recursive: true });
  const rows = demoContracts();
  buildXlsx(join(OUT, 'contracts-demo.xlsx'), COLUMNS, rows);
  writeFileSync(join(OUT, 'contracts-demo.csv'), csvOf(COLUMNS, rows));
  console.log(`Wrote ${rows.length} fictional contracts to examples/demo-data/ (reference date ${AS_OF}).`);
}
