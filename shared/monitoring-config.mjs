/**
 * The settings of the monitoring access, for the Settings dialog. Runs only in the main process.
 * The token goes in and is never given back: the dialog only learns THAT a token is saved, not what it is.
 * Storage is the app's encrypted secret store (OS keychain); this module only decides what may be stored and what may be shown.
 */
import { checkBaseUrl, checkToken, MonitoringError } from './monitoring-read.mjs';

const NAME = 'monitoring';

/** Settings that belong to the main process alone. The agent runtime (and every other child process) must never receive them. */
export const MAIN_ONLY_OWNERS = new Set([NAME]);
export const MAIN_ONLY_ENV = ['MONITORING_BASE_URL', 'MONITORING_READ_TOKEN', 'MONITORING_ADAPTER'];

/** Take the monitoring variables out of an environment: returns them and removes them from it, so no child process inherits them. */
export function takeMainOnlyEnv(env) {
  const taken = {};
  for (const k of MAIN_ONLY_ENV) { if (env[k] !== undefined) taken[k] = env[k]; delete env[k]; }
  return taken;
}

/** The saved secrets that may go to the agent runtime: every owner except the main-only ones. store: { owner: { KEY: value } }. */
export function agentSecrets(store) {
  return Object.assign({}, ...Object.entries(store).filter(([owner]) => !MAIN_ONLY_OWNERS.has(owner)).map(([, v]) => v));
}
const KEYS = { url: 'MONITORING_BASE_URL', token: 'MONITORING_READ_TOKEN' };

/**
 * store: { read(name) -> object of saved values, write(name, values), forget(name) }; env: process environment (settings from there count too);
 * monitoring: the read-only access (createMonitoringRead) used for the test.
 */
export function createMonitoringConfig({ store, env = {}, monitoring }) {
  const saved = () => store.read(NAME) || {};
  const view = () => {
    const s = saved();
    const fromApp = !!(s[KEYS.url] && s[KEYS.token]);
    const fromEnv = !fromApp && !!(env[KEYS.url] && env[KEYS.token]);
    return { configured: fromApp || fromEnv, source: fromApp ? 'app' : fromEnv ? 'environment' : 'none', baseUrl: String(s[KEYS.url] || ''), tokenSet: !!s[KEYS.token], adapter: 'http-json' };
  };
  return {
    /** What the dialog may see. Never the token. */
    get: view,
    /** Save the address and, when one is given, a new token. Without a token the saved token stays. */
    set({ baseUrl, token } = {}) {
      const url = checkBaseUrl(baseUrl);
      const next = { [KEYS.url]: url };
      if (typeof token === 'string' && token.trim()) next[KEYS.token] = checkToken(token);
      else if (!saved()[KEYS.token]) throw new MonitoringError('A token is needed: paste a token that may only read.');
      store.write(NAME, next);
      return view();
    },
    clear() { store.forget(NAME); return view(); },
    /** Try the connection: how many alerts the last hour has, nothing more. The error text never contains the token. */
    async test() {
      const r = await monitoring.alerts({ sinceHours: 1 });
      return { adapter: r.adapter, count: r.alerts.length };
    },
  };
}
