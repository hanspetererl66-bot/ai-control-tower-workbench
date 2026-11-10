/**
 * Trigger tests for skills: example requests that SHOULD make the agent pick a skill and requests that should NOT.
 * The agent chooses a skill only from its name and description, so these examples test exactly that text.
 * The file `triggers.json` sits next to SKILL.md: { "should": ["…", "…"], "shouldNot": ["…", "…"] }.
 * No Node imports: the same code runs in the browser, the scripts and the tests.
 *
 * Two ways to decide which skill a request picks (`choose(prompt, skills) -> name | null`):
 *  - lexicalChoose: offline word overlap on name and description. Free and repeatable, a rough proxy (it cannot read meaning),
 *    good at catching two skills whose descriptions overlap and a description that lacks the words people use.
 *  - a model: scripts/skill-trigger-eval.mjs --live asks a Claude model the way the agent would.
 */
export const MIN_EXAMPLES = 2;
export const MAX_EXAMPLES = 12;
const MIN_LEN = 8;
const MAX_LEN = 240;

/** Optional third list "shouldNotLive": near misses only a model can judge (negations such as "writes no new code"). Offline runs skip it. */
/** Problems in a triggers.json value, as sentences. Empty list = fine. */
export function checkTriggers(value) {
  const problems = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['triggers.json must be an object with "should" and "shouldNot".'];
  const seen = new Set();
  for (const key of ['should', 'shouldNot', 'shouldNotLive']) {
    const list = value[key];
    if (key === 'shouldNotLive' && list === undefined) continue;
    if (!Array.isArray(list)) { problems.push(`"${key}" must be a list.`); continue; }
    if (key !== 'shouldNotLive' && list.length < MIN_EXAMPLES) problems.push(`"${key}" needs at least ${MIN_EXAMPLES} examples (has ${list.length}).`);
    if (list.length > MAX_EXAMPLES) problems.push(`"${key}" has more than ${MAX_EXAMPLES} examples.`);
    for (const item of list) {
      if (typeof item !== 'string' || item.trim().length < MIN_LEN || item.length > MAX_LEN) { problems.push(`"${key}": every example is a sentence of ${MIN_LEN} to ${MAX_LEN} characters.`); continue; }
      const k = item.trim().toLowerCase();
      if (seen.has(k)) problems.push(`"${item.slice(0, 40)}" appears twice.`);
      seen.add(k);
    }
  }
  return problems;
}

const STOP = new Set(('der die das den dem des ein eine einen einem einer und oder mit von für fuer auf aus bei zu zum zur im in am an ist sind wird werden ich mir mein meine bitte kannst du wir wie was wer wo welche welcher welches dass nicht noch auch nur ' +
  'the and for with from into that this are was were has have not you your our can will all any per use used using get new out via about when then than also each such more most over only very please could would should what who which how does need want make ' +
  'agent nutzen bei').split(' '));

/** Lower-case words without stop words, cut to five letters so "Verträge"/"Vertrag" and "approval"/"approve" meet. */
export function words(text) {
  return String(text).toLowerCase().normalize('NFC').split(/[^a-z0-9äöüß]+/).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss').slice(0, 5));
}

/** Best skill by word overlap, or null when nothing matches well enough. skills: [{ name, description }]. */
export function lexicalChoose(prompt, skills, { min = 1.5 } = {}) {
  const docs = skills.map((s) => ({ name: s.name, name_t: new Set(words(s.name.replace(/-/g, ' '))), t: new Set(words(s.description)) }));
  const df = new Map();
  for (const d of docs) for (const w of new Set([...d.name_t, ...d.t])) df.set(w, (df.get(w) ?? 0) + 1);
  const idf = (w) => Math.log(1 + docs.length / (df.get(w) ?? 1));
  const q = [...new Set(words(prompt))];
  let best = null;
  for (const d of docs) {
    let score = 0;
    for (const w of q) {
      if (d.name_t.has(w)) score += 2 * idf(w);
      else if (d.t.has(w)) score += idf(w);
    }
    if (!best || score > best.score) best = { name: d.name, score };
  }
  return best && best.score >= min ? best.name : null;
}

/**
 * Runs all triggers. all: [{ name, description, triggers }] (triggers may be missing = reported as missing).
 * choose: (prompt, skills) -> name | null (may be async). Returns { results, failures }.
 */
export async function evaluateTriggers(all, choose, { live = false } = {}) {
  const skills = all.map(({ name, description }) => ({ name, description }));
  const results = [];
  for (const s of all) {
    if (!s.triggers) { results.push({ skill: s.name, missing: true, cases: [] }); continue; }
    const cases = [];
    for (const prompt of s.triggers.should) { const picked = await choose(prompt, skills); cases.push({ prompt, expect: 'pick', picked, ok: picked === s.name }); }
    for (const prompt of [...s.triggers.shouldNot, ...(live ? s.triggers.shouldNotLive ?? [] : [])]) { const picked = await choose(prompt, skills); cases.push({ prompt, expect: 'not pick', picked, ok: picked !== s.name }); }
    results.push({ skill: s.name, missing: false, cases });
  }
  const failures = results.flatMap((r) => r.cases.filter((c) => !c.ok).map((c) => ({ skill: r.skill, ...c })));
  return { results, failures, missing: results.filter((r) => r.missing).map((r) => r.skill) };
}
