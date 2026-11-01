/**
 * Automatic review of a skill before it is published one level up. Five checks, each pass / warn / fail:
 * secrets, scripts, permissions (tools that change things), harness (does it try to switch off the safety rules)
 * and data class. A fail blocks the request, a warn goes to the human reviewer with the finding attached.
 * The same rules run on the server (supabase migration 019); this copy lets the person see the result before sending.
 */
export type CheckId = 'secrets' | 'scripts' | 'permissions' | 'harness' | 'data';
export type CheckStatus = 'pass' | 'warn' | 'fail';
export type CheckResult = { id: CheckId; title: string; question: string; status: CheckStatus; detail: string };
export type ReviewTarget = 'department' | 'organization';

export const CHECK_INFO: Record<CheckId, { title: string; question: string }> = {
  secrets: { title: 'Secrets scan', question: 'Does the skill contain passwords, keys or tokens?' },
  scripts: { title: 'Script review', question: 'Does it ship or call scripts and downloads?' },
  permissions: { title: 'Permissions', question: 'Which tools can change data?' },
  harness: { title: 'Harness policy', question: 'Does it try to bypass approvals or safety rules?' },
  data: { title: 'Data class', question: 'Is the data class allowed on the target level?' },
};

const SECRET = /(sb_secret_|eyJ[A-Za-z0-9_-]{20,}\.|-----BEGIN [A-Z ]*PRIVATE KEY|AIza[0-9A-Za-z_-]{30,}|ya29\.[0-9A-Za-z_-]{20,}|\b(?:api[_-]?key|secret|password|passwort|token)\s*[:=]\s*['"]?[A-Za-z0-9_\-./+]{8,})/i;
const DANGEROUS = /(rm\s+-rf|\|\s*(?:ba)?sh\b|base64\s+-d|\beval\s*\(|chmod\s+\+x|Invoke-Expression|powershell\s+-enc)/i;
const SCRIPTY = /(```(?:bash|sh|shell|zsh|python|py|js|javascript|ts|powershell|ps1|bat)\b|\b(?:curl|wget)\s+\S|\bnpx?\s+(?:-y\s+)?\S|\bpip\s+install\b)/i;
const WRITES = /(^|_)(send|delete|remove|create|update|post|write|drop|approve|pay|transfer)(_|$)/i;
const BYPASS = /(ignore (?:all |any )?(?:previous|prior|safety|the) ?(?:instructions|rules|guardrails)?|without (?:asking|approval|confirmation)|skip (?:the )?(?:approval|confirmation|permission)|disable (?:the )?(?:approval|permission|safety|guardrail)|never ask (?:for )?(?:approval|permission))/i;

export function parseTools(body: string): string[] {
  const m = /^tools:\s*\[([^\]]*)\]/m.exec(body);
  if (m) return m[1].split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  const list = /^tools:\s*\r?\n((?:\s*-\s*\S+\r?\n?)+)/m.exec(body);
  return list ? list[1].split(/\r?\n/).map((l) => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean) : [];
}

export function parseDataClass(body: string): 'öffentlich' | 'intern' | 'vertraulich' {
  const m = /^data_class:\s*["']?(öffentlich|intern|vertraulich)/mi.exec(body);
  return (m?.[1]?.toLowerCase() as 'öffentlich' | 'intern' | 'vertraulich') ?? 'intern';
}

export function reviewSkill(body: string, target: ReviewTarget): CheckResult[] {
  const out = (id: CheckId, status: CheckStatus, detail: string): CheckResult => ({ id, ...CHECK_INFO[id], status, detail });
  const secret = SECRET.exec(body);
  const danger = DANGEROUS.exec(body);
  const scripty = SCRIPTY.exec(body);
  const tools = parseTools(body);
  const writes = tools.filter((t) => WRITES.test(t));
  const bypass = BYPASS.exec(body);
  const cls = parseDataClass(body);
  return [
    secret ? out('secrets', 'fail', `Looks like a credential: “${secret[0].slice(0, 18)}…”. Remove it and use a connector instead.`) : out('secrets', 'pass', 'No keys, tokens or passwords found.'),
    danger ? out('scripts', 'fail', `Dangerous command: “${danger[0]}”. Skills must not delete files or run downloaded code.`)
      : scripty ? out('scripts', 'warn', `Contains a script or download (“${scripty[0].trim().slice(0, 28)}”). The reviewer reads it before approving.`)
      : out('scripts', 'pass', 'Instructions only: no scripts, no downloads.'),
    writes.length ? out('permissions', 'warn', `Can change data: ${writes.join(', ')}. Every call still needs the person’s approval.`)
      : out('permissions', 'pass', tools.length ? `Read-only tools: ${tools.join(', ')}.` : 'Uses no tools.'),
    bypass ? out('harness', 'fail', `Tries to bypass the safety rules: “${bypass[0]}”. The harness never allows this.`) : out('harness', 'pass', 'Respects approvals, tool limits and the active harness profile.'),
    cls === 'vertraulich' && target === 'organization' ? out('data', 'fail', 'Confidential data may not be published organization-wide.')
      : cls === 'vertraulich' ? out('data', 'warn', 'Confidential data: only people of the department may use it.')
      : out('data', 'pass', `Data class “${cls}” is fine for ${target === 'organization' ? 'the organization' : 'the department'}.`),
  ];
}

/** blocked: a check failed, nothing goes to the reviewer. review: goes to the human, with warnings attached. */
export function reviewOutcome(results: CheckResult[]): 'blocked' | 'review' {
  return results.some((r) => r.status === 'fail') ? 'blocked' : 'review';
}
