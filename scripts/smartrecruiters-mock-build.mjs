/**
 * Builds the SmartRecruiters mock fixture (connectors/_lib/server/smartrecruiters-mock.json) from the Recruiting Workbench sample data.
 *   npm run smartrecruiters:mock
 * The fixture is shaped like Customer API answers and carries INVENTED names, e-mail addresses and phone numbers on purpose, so the
 * import can show (and a test can prove) that none of them reaches the database. Ids: mock-job-<n> and mock-cand-<n>, the same
 * numbers as REQ-<n> and C-<n>, so the seed can mark the sample rows as "already imported".
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIRST = ['Anna', 'Jonas', 'Mira', 'Tobias', 'Selin', 'Lukas', 'Nadia', 'Felix', 'Clara', 'Omar', 'Hanna', 'Paul', 'Iris', 'Mats'];
const LAST = ['Beispiel', 'Muster', 'Testmann', 'Probst', 'Nordmann', 'Kuhn', 'Demir', 'Sommer', 'Winter', 'Falk', 'Lorenz', 'Brandt'];
const STATUS_OF = { Applied: 'NEW', Screening: 'IN_REVIEW', Interview: 'INTERVIEW', Offer: 'OFFER' };

export const jobRef = (reqId) => `mock-job-${reqId.replace(/^REQ-/, '')}`;
export const candRef = (candId) => `mock-cand-${candId.replace(/^C-/, '')}`;

export function buildFixture(data) {
  const jobs = data.jobs.map((j) => ({
    id: jobRef(j.id), refNumber: j.id, title: j.title, status: 'SOURCING', createdOn: `${j.opened}T08:00:00.000Z`,
    department: { label: j.dept },
    location: { city: j.location.replace(/ \/ remote$/, ''), remote: / \/ remote$/.test(j.location) },
    customField: { hiringManagerRole: j.manager, targetDays: j.target },
  }));
  const candidates = {};
  data.candidates.forEach((c, i) => {
    const first = FIRST[i % FIRST.length], last = LAST[(i * 5 + 3) % LAST.length];
    const list = (candidates[jobRef(c.job)] ??= []);
    list.push({
      id: candRef(c.id), firstName: first, lastName: last, email: `${first}.${last}@example.org`.toLowerCase(), phoneNumber: `+49 40 5550 ${String(1000 + i * 7)}`,
      appliedOn: `${c.applied}T09:00:00.000Z`, status: STATUS_OF[c.stage],
      primaryAssignment: { status: STATUS_OF[c.stage], createdOn: `${c.applied}T09:00:00.000Z`, statusChangedOn: `${c.since}T09:00:00.000Z` },
      experienceYears: c.years ?? undefined,
      // The first candidate carries a contact line, as pasted CVs often do: the import must drop it.
      resumeLines: c.cv ? [...c.cv, ...(i === 0 ? [`Contact: ${first.toLowerCase()}.${last.toLowerCase()}@example.org, +49 40 5550 1000`] : [])] : [],
    });
  });
  // Two candidates who are no longer in the process: the import must skip them.
  const extra = [['HIRED', 'mock-cand-9001'], ['REJECTED', 'mock-cand-9002']];
  for (const [status, id] of extra) {
    candidates[jobRef('REQ-2201')].push({ id, firstName: 'Ex', lastName: 'Kandidat', email: 'ex.kandidat@example.org', appliedOn: '2026-09-20T09:00:00.000Z', status,
      primaryAssignment: { status, createdOn: '2026-09-20T09:00:00.000Z', statusChangedOn: '2026-10-01T09:00:00.000Z' }, resumeLines: [] });
  }
  return { note: 'SmartRecruiters-shaped MOCK. Invented people. Not verified against the real API.', jobs, candidates };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const data = JSON.parse(readFileSync(join(ROOT, 'examples/recruiting-workbench/data.json'), 'utf8'));
  const out = join(ROOT, 'connectors/_lib/server/smartrecruiters-mock.json');
  writeFileSync(out, `${JSON.stringify(buildFixture(data), null, 2)}\n`);
  console.log(`Wrote ${out}`);
}
