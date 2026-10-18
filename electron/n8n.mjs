/**
 * n8n Cloud integration helpers (pure, no Electron imports so they can be tested).
 *  - the instance URL the user configures (only the origin is kept)
 *  - which navigations the embedded n8n view may follow
 *  - the settings file (the URL is not a secret; tokens never live here)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const N8N_EXTENSION = 'n8n';

/** Accepts "acme.app.n8n.cloud" or a full https URL; returns the bare origin. Throws a readable error otherwise. */
export function normalizeInstanceUrl(raw) {
  const text = String(raw ?? '').trim();
  if (!text) throw new Error('Bitte die n8n-Adresse eintragen, z. B. https://firma.app.n8n.cloud');
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    throw new Error('Die n8n-Adresse ist keine gültige URL.');
  }
  if (url.protocol !== 'https:') throw new Error('Die n8n-Adresse muss mit https:// beginnen.');
  if (url.username || url.password) throw new Error('Die n8n-Adresse darf keine Zugangsdaten enthalten.');
  if (!url.hostname.includes('.')) throw new Error('Die n8n-Adresse braucht einen vollständigen Hostnamen.');
  return url.origin;
}

/** Endpoint of n8n's instance-level MCP server (Settings → Instance-level MCP). */
export function mcpUrl(origin) {
  return `${new URL(origin).origin}/mcp-server/http`;
}

/** Hosts the embedded view may navigate to: the instance itself and n8n's own cloud domain (login, SSO redirects). */
export function isAllowedNavigation(target, origin) {
  try {
    const url = new URL(target);
    if (url.protocol !== 'https:') return false;
    if (url.origin === new URL(origin).origin) return true;
    return url.hostname === 'n8n.cloud' || url.hostname.endsWith('.n8n.cloud');
  } catch {
    return false;
  }
}

export function createN8nStore(file) {
  const read = () => {
    try {
      return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
    } catch {
      return {};
    }
  };
  return {
    getUrl() {
      const url = read().url;
      try {
        return typeof url === 'string' && url ? normalizeInstanceUrl(url) : '';
      } catch {
        return '';
      }
    },
    saveUrl(raw) {
      const url = raw === '' || raw == null ? '' : normalizeInstanceUrl(raw);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify({ url }, null, 2));
      return url;
    },
  };
}

/** The goose extension entry that gives the chat access to n8n. No token: goose runs the OAuth flow. */
export function n8nExtensionEntry(origin) {
  return { enabled: true, type: 'streamable_http', name: N8N_EXTENSION, uri: mcpUrl(origin), envs: {}, timeout: 300 };
}
