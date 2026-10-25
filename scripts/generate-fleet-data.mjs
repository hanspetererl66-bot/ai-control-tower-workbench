/**
 * IT Fleet Space: generates examples/it-fleet/fleet.json (fictional customers with their VMs) from a fixed seed,
 * so the file is reproducible. Rules and task definitions are copied from examples/it-infrastructure/vms.json.
 *   node scripts/generate-fleet-data.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const infra = JSON.parse(readFileSync(join(ROOT, 'examples/it-infrastructure/vms.json'), 'utf8'));

let seed = 5;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const int = (a, b) => Math.floor(a + rnd() * (b - a + 1));
const pick = (list) => list[Math.floor(rnd() * list.length)];

const NAMES = [
  ['Muster Industrie AG', 'EMEA Central', 'Gold', '0010048211'], ['Hanse Handelsgruppe AG', 'EMEA North', 'Gold', '0010073904'],
  ['Nordwind Handel GmbH', 'EMEA North', 'Silver'], ['Kranich Logistik GmbH', 'EMEA Central', 'Silver'], ['Brauhaus Keller AG', 'EMEA Central', 'Bronze'],
  ['Alpenwerk Maschinenbau AG', 'EMEA Central', 'Gold'], ['Rheintal Chemie GmbH', 'EMEA Central', 'Gold'], ['Saarland Stahl AG', 'EMEA Central', 'Silver'],
  ['Baltic Energy Oy', 'EMEA North', 'Gold'], ['Fjord Seafood AS', 'EMEA North', 'Bronze'], ['Nordlicht Versicherung AG', 'EMEA North', 'Silver'],
  ['Iberia Retail S.A.', 'EMEA South', 'Gold'], ['Lombardia Moda S.p.A.', 'EMEA South', 'Silver'], ['Provence Cosmetics SAS', 'EMEA South', 'Silver'],
  ['Adriatic Shipping d.o.o.', 'EMEA South', 'Bronze'], ['Tejo Telecom S.A.', 'EMEA South', 'Bronze'], ['Bosporus Textil A.S.', 'MEE', 'Silver'],
  ['Gulf Logistics LLC', 'MEE', 'Gold'], ['Sahara Solar Ltd', 'MEE', 'Bronze'], ['Cape Mining Pty', 'MEE', 'Silver'], ['Nile Foods S.A.E.', 'MEE', 'Bronze'],
  ['Savanna Bank Ltd', 'MEE', 'Silver'], ['Sakura Precision K.K.', 'APEC', 'Gold'], ['Kanto Electronics K.K.', 'APEC', 'Silver'], ['Pacific Trade Pte', 'APEC', 'Silver'],
  ['Harbour Retail Pty', 'APEC', 'Bronze'], ['Mekong Textiles Co', 'APEC', 'Bronze'], ['Himalaya Pharma Ltd', 'APEC', 'Silver'], ['Outback Resources Pty', 'APEC', 'Gold'],
  ['Great Lakes Auto Inc', 'NALA', 'Gold'], ['Prairie Agro Inc', 'NALA', 'Silver'], ['Bayou Energy LLC', 'NALA', 'Silver'], ['Maple Insurance Ltd', 'NALA', 'Bronze'],
  ['Andes Mining S.A.', 'NALA', 'Silver'], ['Amazonia Foods Ltda', 'NALA', 'Bronze'], ['Pampas Retail S.A.', 'NALA', 'Bronze'], ['Sierra Medical Inc', 'NALA', 'Silver'],
  ['Cascade Software Inc', 'NALA', 'Bronze'], ['Lone Star Oil Corp', 'NALA', 'Gold'], ['Empire Finance Corp', 'NALA', 'Silver'], ['Lakeside Utilities Inc', 'NALA', 'Bronze'],
];
const SIZE = { Gold: [40, 56], Silver: [20, 34], Bronze: [8, 16] };
const ROLES = ['app', 'app', 'db', 'web', 'web', 'int', 'mon', 'bkp', 'fs', 'dc', 'prx'];

const ids = new Set(NAMES.map((n) => n[3]).filter(Boolean));
const nextId = () => { let id; do id = '00100' + String(int(10000, 99999)); while (ids.has(id)); ids.add(id); return id; };
const idx = NAMES.map((_, i) => i);
const certSet = new Set(idx.filter((i) => i >= 2).sort(() => rnd() - 0.5).slice(0, 9));
const patchSet = new Set(idx.filter((i) => i >= 2).sort(() => rnd() - 0.5).slice(0, 6));
const troubled = new Set(idx.filter((i) => i >= 2).sort(() => rnd() - 0.5).slice(0, 8));

const customers = NAMES.map(([name, region, tier, sap], i) => {
  const slug = name.replace(/[^A-Za-z ]/g, '').split(' ').slice(0, 2).map((w) => w.slice(0, 3).toLowerCase()).join('');
  const n = int(...SIZE[tier]);
  const p = i < 2 ? (i === 0 ? 0.03 : 0.02) : troubled.has(i) ? 0.045 : 0.004;
  const vms = [];
  for (let k = 0; k < n; k++) {
    const role = k < 2 ? 'app' : k >= n - 2 && n > 12 ? pick(['test', 'dev']) : pick(ROLES);
    const env = role === 'test' ? 'test' : role === 'dev' ? 'dev' : 'prod';
    const vm = { name: `${slug}-${role}${String(k + 1).padStart(2, '0')}`, env, cpu: int(8, 70), mem: int(25, 78), disk: int(22, 80), backup: env === 'prod' ? int(2, 20) : null, patch: int(0, 12), cert: int(45, 320), reach: 1 };
    if (env === 'prod' && certSet.has(i) && rnd() < 0.3) vm.cert = rnd() < 0.05 ? int(3, 7) : int(8, 29);
    if (patchSet.has(i) && rnd() < 0.25) vm.patch = int(15, 29);
    if (rnd() < p) {
      const kind = pick(['cpu', 'mem', 'disk', 'disk', 'backup', 'backup', 'patch', 'patch', 'unreachable']);
      if (kind === 'cpu') vm.cpu = int(76, 92); if (kind === 'mem') vm.mem = int(86, 97); if (kind === 'disk') vm.disk = int(86, 98);
      if (kind === 'backup' && env === 'prod') vm.backup = int(26, 60); if (kind === 'patch') vm.patch = int(15, 29);
      if (kind === 'unreachable') Object.assign(vm, { reach: 0, cpu: 0, mem: 0, disk: 0 });
    }
    vms.push(vm);
  }
  return { id: slug, name, region, tier, sapCustomerId: sap ?? nextId(), vms };
});

// Demo case (IT Fleet → Infrastructure Operations): the Ariba integration VM of the Gold customer has a TLS certificate that
// expires in 6 days. It is the certificate "mi-ariba-gw" of the Infrastructure Operations inventory. Set after the random draw so
// nothing else in the file changes.
const demoVm = customers[0].vms.find((v) => v.name === 'musind-int04');
if (demoVm) demoVm.cert = 6;

const A = infra.rules;
const redShare = (c) => {
  let red = 0;
  for (const v of c.vms) {
    const r = !v.reach || v.cpu >= A.cpuPct.red || v.mem >= A.memPct.red || v.disk >= A.diskPct.red || (v.backup !== null && v.env === 'prod' && v.backup >= A.backupAgeHours.red) || v.patch >= A.patchLagDays.red || v.cert <= A.certExpiresInDays.red;
    if (r) red++;
  }
  return Math.round((red / c.vms.length) * 100);
};
const out = {
  asOf: '2026-10-24',
  note: 'Fictional customers and virtual machines, generated from a fixed seed (scripts/generate-fleet-data.mjs). Rules and task definitions are the same as in the IT Infrastructure Space.',
  rules: infra.rules,
  tasks: infra.tasks,
  customers: customers.map((c) => {
    const now = redShare(c);
    const trend = []; let x = now;
    for (let d = 0; d < 14; d++) { trend.unshift(Math.max(0, Math.round(x))); x += (rnd() - 0.45) * 4; }
    return { id: c.id, name: c.name, region: c.region, tier: c.tier, sapCustomerId: c.sapCustomerId, trend, vms: c.vms.map((v) => [v.name, v.env, v.cpu, v.mem, v.disk, v.backup, v.patch, v.cert, v.reach]) };
  }),
};
writeFileSync(join(ROOT, 'examples/it-fleet/fleet.json'), JSON.stringify(out) + '\n');
console.log(`${out.customers.length} customers, ${out.customers.reduce((n, c) => n + c.vms.length, 0)} VMs`);
