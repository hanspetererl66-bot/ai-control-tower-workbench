/**
 * n8n Cloud integration helpers (pure, no Electron imports so they can be tested).
 *  - the instance URL the user configures (only the origin is kept)
 *  - which navigations the embedded n8n view may follow
 *  - the settings file (the URL is not a secret; tokens never live here)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const N8N_EXTENSION = 'n8n';

import { normalizeInstanceUrl } from '../connectors/_lib/server/n8n.mjs';
export { normalizeInstanceUrl };

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
