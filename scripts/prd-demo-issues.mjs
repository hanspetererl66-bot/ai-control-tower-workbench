/** The sample backlog (examples/jira-demo) in the shape the Jira connector returns it: for the demo mode of the PRD Builder. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export function demoIssues(project = 'DEMO') {
  const b = JSON.parse(readFileSync(join(ROOT, 'examples/jira-demo/sales-app-backlog.json'), 'utf8'));
  const key = new Map(); let n = 0;
  const issues = [];
  for (const e of b.epics) { key.set(e.ref, `${project}-${++n}`); issues.push({ key: key.get(e.ref), summary: e.summary, type: 'Epic', status: 'To Do', priority: e.priority, parentKey: null, parentSummary: null, labels: e.labels, description: e.description }); }
  for (const s of b.stories) {
    const k = `${project}-${++n}`; const e = b.epics.find((x) => x.ref === s.epic);
    issues.push({ key: k, summary: s.summary, type: 'Story', status: 'To Do', priority: s.priority, parentKey: key.get(s.epic), parentSummary: e.summary, labels: s.labels, description: `${s.story}\n\nAcceptance criteria\n${s.criteria.map((c) => `- ${c}`).join('\n')}` });
  }
  return issues;
}
