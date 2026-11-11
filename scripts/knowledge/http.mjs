/**
 * Polite HTTP for the knowledge feeder: a clear user agent, robots.txt before every host, at most one request per second per host.
 * fetch, the clock and sleep are injected so tests never touch a network. No user-agent spoofing, no auth bypass.
 */
export const USER_AGENT_NAME = 'werkbank-knowledge-feeder';
export const userAgent = (env = process.env) => `${USER_AGENT_NAME} (contact: ${String(env.KNOWLEDGE_FEEDER_CONTACT ?? 'unset').trim() || 'unset'})`;

export class RobotsDisallowedError extends Error {
  constructor(url) { super(`robots.txt of ${new URL(url).host} disallows ${new URL(url).pathname} for ${USER_AGENT_NAME}`); this.name = 'RobotsDisallowedError'; this.url = url; }
}

/** Parses robots.txt into groups of {agents, rules[{allow, path}]}. */
export function parseRobots(text) {
  const groups = [];
  let cur = null;
  let lastWasAgent = false;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (field === 'allow' || field === 'disallow') {
      lastWasAgent = false;
      if (cur) cur.rules.push({ allow: field === 'allow', path: value });
    } else lastWasAgent = false;
  }
  return groups;
}

const toRegex = (path) => new RegExp(`^${path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$')}`);

/** Is the path (with query) allowed for our agent? The group naming our agent wins, else "*"; longest matching rule wins, allow on a tie. */
export function robotsAllows(groups, pathAndQuery, agent = USER_AGENT_NAME) {
  const a = agent.toLowerCase();
  const named = groups.filter((g) => g.agents.some((x) => x !== '*' && a.includes(x)));
  const use = named.length ? named : groups.filter((g) => g.agents.includes('*'));
  let best = null;
  for (const g of use) for (const r of g.rules) {
    if (!r.path) continue;
    if (!toRegex(r.path).test(pathAndQuery)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return best ? best.allow : true;
}

export function createPoliteFetch({ fetchImpl = globalThis.fetch, env = process.env, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), minGapMs = 1000 } = {}) {
  const robots = new Map(); // host -> Promise<groups>
  const last = new Map(); // host -> time of the last request
  const headers = () => ({ 'User-Agent': userAgent(env), Accept: '*/*' });

  async function paced(url, init) {
    const host = new URL(url).host;
    const wait = (last.get(host) ?? -Infinity) + minGapMs - now();
    if (wait > 0) await sleep(wait);
    last.set(host, now());
    return fetchImpl(url, { ...init, headers: { ...headers(), ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(30_000) });
  }

  async function robotsFor(url) {
    const u = new URL(url);
    if (!robots.has(u.host)) {
      robots.set(u.host, (async () => {
        const res = await paced(`${u.protocol}//${u.host}/robots.txt`, { method: 'GET' });
        if (res.status === 404 || res.status === 410) return [];
        if (res.status >= 400) return [{ agents: ['*'], rules: [{ allow: false, path: '/' }] }]; // cannot tell: do not fetch
        return parseRobots(await res.text());
      })());
    }
    return robots.get(u.host);
  }

  /** GET that respects robots.txt. Extra headers (for example a GitHub token) go only where the caller puts them. */
  async function get(url, init = {}) {
    const u = new URL(url);
    if (u.protocol !== 'https:') throw new Error(`Only https is fetched (${u.protocol}).`);
    const groups = await robotsFor(url);
    if (!robotsAllows(groups, u.pathname + u.search)) throw new RobotsDisallowedError(url);
    return paced(url, { method: 'GET', ...init });
  }
  return { get };
}
