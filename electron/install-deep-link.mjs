export function normalizeHttpsBundleUrl(raw) {
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

export function parseSkillUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'werkbank:') return null;
  const action = url.hostname || url.pathname.replace(/^\/+/, '');
  if (action !== 'install-skill') return null;

  const repository = url.searchParams.get('repository') ?? '';
  const name = url.searchParams.get('name') ?? '';
  const origin = url.searchParams.get('origin') ?? 'unknown';
  const repoMatch = /^https:\/\/github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(
    repository
  );
  if (!repoMatch) return null;
  if (!/^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/.test(name)) return null;

  return { slug: `${repoMatch[1]}/${repoMatch[2]}`, name, origin: origin.slice(0, 100) };
}

const ALLOWED_COMMANDS = new Set(['npx', 'uvx', 'node', 'python3', 'bunx', 'deno']);

export function parseMcpUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'werkbank:') return null;
  const action = url.hostname || url.pathname.replace(/^\/+/, '');
  if (action !== 'install-mcp') return null;

  const name = url.searchParams.get('name') ?? '';
  if (!/^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/.test(name)) return null;

  const raw64 = url.searchParams.get('config') ?? '';
  if (raw64.length > 4096) return null;

  let cfg;
  try {
    cfg = JSON.parse(Buffer.from(raw64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return null;

  const allowed = new Set([
    'type',
    'command',
    'args',
    'env',
    'url',
    'timeout',
    'description',
    'user_config',
  ]);
  if (Object.keys(cfg).some((key) => !allowed.has(key))) return null;

  const env = cfg.env ?? {};
  if (typeof env !== 'object' || Array.isArray(env)) return null;
  if (Object.values(env).some((value) => typeof value !== 'string')) return null;

  const userConfig = cfg.user_config ?? {};
  if (typeof userConfig !== 'object' || Array.isArray(userConfig)) return null;
  const fields = [];
  for (const [key, spec] of Object.entries(userConfig)) {
    if (!/^[a-z0-9_]{1,64}$/i.test(key)) return null;
    if (!spec || typeof spec !== 'object') return null;
    fields.push({
      key,
      title: String(spec.title ?? key).slice(0, 120),
      description: String(spec.description ?? '').slice(0, 300),
      required: spec.required === true,
      sensitive: spec.sensitive === true,
      default: typeof spec.default === 'string' ? spec.default : '',
    });
  }
  if (fields.length > 20) return null;

  if (cfg.url) {
    const safeUrl = normalizeHttpsBundleUrl(cfg.url);
    if (!safeUrl) return null;
    return {
      kind: 'mcp',
      name,
      source: 'link',
      remote: true,
      url: safeUrl,
      env,
      fields,
      description: cfg.description,
    };
  }

  if (!ALLOWED_COMMANDS.has(cfg.command)) return null;
  const args = cfg.args ?? [];
  if (!Array.isArray(args) || args.some((argument) => typeof argument !== 'string')) return null;

  return {
    kind: 'mcp',
    name,
    source: 'link',
    remote: false,
    command: cfg.command,
    args,
    env,
    fields,
    description: cfg.description,
  };
}

/** Parse the URL contract used by the Werkbank web install handoff. */
export function parseMcpbUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== 'werkbank:') return null;
  const action = url.hostname || url.pathname.replace(/^\/+/, '');
  if (action !== 'install-mcpb') return null;

  const src = normalizeHttpsBundleUrl(url.searchParams.get('url') ?? '');
  return src ? { kind: 'mcpb-url', src } : null;
}
