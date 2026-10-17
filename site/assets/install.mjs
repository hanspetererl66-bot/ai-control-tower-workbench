export const DEFAULT_BUNDLE_URL =
  'https://github.com/marianfoo/sap-mcp-servers/releases/download/sap-notes-latest/sap-notes.mcpb';

// Future production URL. The site is intentionally kept local until Werkbank is released.
export const PAGES_BASE_URL = 'https://getwerkbank.com/';

const ALLOWED_COMMANDS = new Set(['npx', 'uvx', 'node', 'python3', 'bunx', 'deno']);
const ALLOWED_MCP_KEYS = new Set([
  'type',
  'command',
  'args',
  'env',
  'url',
  'timeout',
  'description',
  'user_config',
]);

export function normalizeBundleUrl(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return null;

  try {
    const url = new URL(raw);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      (url.port && url.port !== '443')
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function normalizeDisplayName(raw, fallback) {
  if (typeof raw !== 'string') return fallback;
  const value = raw.trim().replace(/\s+/g, ' ');
  return value.length > 0 && value.length <= 80 ? value : fallback;
}

function encodeBase64Url(value) {
  const json = typeof value === 'string' ? value : JSON.stringify(value);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 4096) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) return null;

  try {
    const base64 = raw.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(raw.length / 4) * 4, '=');
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export function normalizeMcpName(raw) {
  return typeof raw === 'string' && /^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/.test(raw)
    ? raw
    : null;
}

export function normalizeMcpConfig(raw) {
  let config;
  try {
    config = typeof raw === 'string' ? JSON.parse(decodeBase64Url(raw) ?? '') : raw;
  } catch {
    return null;
  }

  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  if (Object.keys(config).some((key) => !ALLOWED_MCP_KEYS.has(key))) return null;

  const env = config.env ?? {};
  const userConfig = config.user_config ?? {};
  if (!env || typeof env !== 'object' || Array.isArray(env)) return null;
  if (Object.values(env).some((value) => typeof value !== 'string')) return null;
  if (!userConfig || typeof userConfig !== 'object' || Array.isArray(userConfig)) return null;
  if (Object.keys(userConfig).length > 20) return null;

  if (config.url) {
    const url = normalizeBundleUrl(config.url);
    if (!url) return null;
    if (config.type && !['http', 'streamable_http'].includes(config.type)) return null;
    const normalized = { ...config, url };
    return { config: normalized, encoded: encodeBase64Url(normalized) };
  }

  if (!ALLOWED_COMMANDS.has(config.command)) return null;
  const args = config.args ?? [];
  if (!Array.isArray(args) || args.some((argument) => typeof argument !== 'string')) return null;
  const normalized = { ...config, args };
  return { config: normalized, encoded: encodeBase64Url(normalized) };
}

export function normalizeSkillRepository(raw) {
  if (typeof raw !== 'string' || raw.length > 200) return null;
  const match = /^https:\/\/github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(raw);
  return match ? `https://github.com/${match[1]}/${match[2]}` : null;
}

export function buildWerkbankUrl(rawBundleUrl) {
  const bundleUrl = normalizeBundleUrl(rawBundleUrl);
  if (!bundleUrl) return null;
  return `werkbank://install-mcpb?url=${encodeURIComponent(bundleUrl)}`;
}

export function buildMcpWerkbankUrl(name, rawConfig) {
  const safeName = normalizeMcpName(name);
  const normalized = normalizeMcpConfig(rawConfig);
  if (!safeName || !normalized) return null;
  return `werkbank://install-mcp?name=${encodeURIComponent(safeName)}&config=${encodeURIComponent(normalized.encoded)}`;
}

export function buildSkillWerkbankUrl(repository, name, origin = 'getwerkbank.com') {
  const safeRepository = normalizeSkillRepository(repository);
  const safeName = normalizeMcpName(name);
  const safeOrigin = normalizeDisplayName(origin, 'unknown').slice(0, 100);
  if (!safeRepository || !safeName) return null;
  const params = new URLSearchParams({ repository: safeRepository, name: safeName, origin: safeOrigin });
  return `werkbank://install-skill?${params}`;
}

export function buildInstallPageUrl(
  rawBundleUrl,
  baseUrl = PAGES_BASE_URL,
  displayName = 'SAP Notes MCP'
) {
  const bundleUrl = normalizeBundleUrl(rawBundleUrl);
  if (!bundleUrl) return null;
  const params = new URLSearchParams({ url: bundleUrl, title: normalizeDisplayName(displayName, 'Connector') });
  return new URL(`install-mcpb/?${params}`, baseUrl).href;
}

export function buildMcpInstallPageUrl(name, rawConfig, baseUrl = PAGES_BASE_URL, displayName = name) {
  const safeName = normalizeMcpName(name);
  const normalized = normalizeMcpConfig(rawConfig);
  if (!safeName || !normalized) return null;
  const params = new URLSearchParams({
    name: safeName,
    config: normalized.encoded,
    title: normalizeDisplayName(displayName, safeName),
  });
  return new URL(`install-mcp/?${params}`, baseUrl).href;
}

export function buildSkillInstallPageUrl(
  repository,
  name,
  baseUrl = PAGES_BASE_URL,
  displayName = name
) {
  const safeRepository = normalizeSkillRepository(repository);
  const safeName = normalizeMcpName(name);
  if (!safeRepository || !safeName) return null;
  const params = new URLSearchParams({
    repository: safeRepository,
    name: safeName,
    title: normalizeDisplayName(displayName, safeName),
  });
  return new URL(`install-skill/?${params}`, baseUrl).href;
}

function setText(document, selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
}

function installRequestForPage(page, params, location) {
  const title = normalizeDisplayName(params.get('title'), page === 'install-skill' ? 'Skill' : 'Connector');

  if (page === 'install-mcpb') {
    const bundleUrl = normalizeBundleUrl(params.get('url') ?? '');
    if (!bundleUrl) return null;
    return {
      title,
      deepLink: buildWerkbankUrl(bundleUrl),
      source: new URL(bundleUrl).host,
      sourceLabel: 'Bundle source',
      downloadUrl: bundleUrl,
    };
  }

  if (page === 'install-mcp') {
    const name = normalizeMcpName(params.get('name') ?? '');
    const config = normalizeMcpConfig(params.get('config') ?? '');
    if (!name || !config) return null;
    return {
      title,
      deepLink: buildMcpWerkbankUrl(name, config.config),
      source: config.config.url ? new URL(config.config.url).host : config.config.command,
      sourceLabel: config.config.url ? 'Remote endpoint' : 'Local command',
    };
  }

  if (page === 'install-skill') {
    const repository = normalizeSkillRepository(params.get('repository') ?? '');
    const name = normalizeMcpName(params.get('name') ?? '');
    if (!repository || !name) return null;
    return {
      title,
      deepLink: buildSkillWerkbankUrl(repository, name, location.host || 'getwerkbank.com'),
      source: repository.replace('https://github.com/', ''),
      sourceLabel: 'Skill repository',
    };
  }

  return null;
}

export function initializePage({ document, location, openProtocol } = {}) {
  if (!document || !location) return { mode: 'server' };

  const landingLinks = document.querySelectorAll('[data-default-install-link]');
  const installPageUrl = buildInstallPageUrl(DEFAULT_BUNDLE_URL, location.href);
  for (const link of landingLinks) link.href = installPageUrl;

  const page = document.body?.dataset.page ?? 'landing';
  if (!page.startsWith('install-')) return { mode: 'landing' };

  const params = new URLSearchParams(location.search);
  const request = installRequestForPage(page, params, location);
  const panel = document.querySelector('[data-install-panel]');
  const invalid = document.querySelector('[data-invalid-panel]');

  if (!request?.deepLink) {
    panel?.setAttribute('hidden', '');
    invalid?.removeAttribute('hidden');
    return { mode: 'invalid' };
  }

  setText(document, '[data-install-name]', request.title);
  setText(document, '[data-source-label]', request.sourceLabel);
  setText(document, '[data-source-value]', request.source);

  for (const link of document.querySelectorAll('[data-open-werkbank]')) {
    link.href = request.deepLink;
    link.addEventListener('click', () => {
      setText(document, '[data-install-status]', 'Werkbank launch requested. Confirm inside the app.');
    });
  }

  const download = document.querySelector('[data-download-bundle]');
  if (download && request.downloadUrl) download.href = request.downloadUrl;
  else download?.setAttribute('hidden', '');

  const copy = document.querySelector('[data-copy-link]');
  copy?.addEventListener('click', async () => {
    await globalThis.navigator?.clipboard?.writeText(request.deepLink);
    setText(document, '[data-copy-label]', 'Copied');
  });

  if (params.get('auto') !== '0') {
    globalThis.setTimeout(() => {
      setText(document, '[data-install-status]', 'Opening Werkbank…');
      openProtocol?.(request.deepLink);
    }, 450);
  }

  return { mode: page, ...request };
}

if (typeof document !== 'undefined' && typeof location !== 'undefined') {
  initializePage({
    document,
    location,
    openProtocol: (url) => location.assign(url),
  });
}
