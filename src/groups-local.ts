import type { GroupCall, GroupRole, MemoryKind } from './groups';

/**
 * The groups backend on this computer only (localStorage). It answers the same group_* tools as the team server,
 * so the Groups screen works without a database: for trying things out and for demos. Nothing leaves the computer
 * and nobody else sees it; the two colleagues in the sample group are made up.
 */
type Member = { email: string; name: string; role: GroupRole };
type Mem = { id: string; kind: MemoryKind; text: string; createdBy: string; createdAt: string };
type Sp = { slug: string; title: string; version: number; publishedBy: string; publishedAt: string; package: string };
type Group = { id: string; name: string; description: string; rev: number; members: Member[]; spaces: Sp[]; memory: Mem[]; config: { instructions?: string }; audit: Array<{ actor: string; action: string; detail: string; at: string }> };
type Db = { groups: Group[]; seq: number; seeded: boolean };
type Store = Pick<Storage, 'getItem' | 'setItem'>;

export const LOCAL_GROUPS_KEY = 'werkbank.localGroups';
export const GROUP_MODE_KEY = 'werkbank.groupMode';
export const DEMO_COLLEAGUES: Member[] = [
  { email: 'anna.schmidt@example.com', name: 'Anna Schmidt', role: 'member' },
  { email: 'tom.becker@example.com', name: 'Tom Becker', role: 'viewer' },
];

const iso = (d: Date) => d.toISOString();
const clean = (t: unknown, max: number) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function load(store: Store): Db {
  try {
    const v = JSON.parse(store.getItem(LOCAL_GROUPS_KEY) ?? 'null');
    if (v && Array.isArray(v.groups)) return { groups: v.groups, seq: Number(v.seq) || v.groups.length, seeded: v.seeded === true };
  } catch { /* fresh */ }
  return { groups: [], seq: 0, seeded: false };
}
const save = (store: Store, db: Db) => { try { store.setItem(LOCAL_GROUPS_KEY, JSON.stringify(db)); } catch { /* full or blocked */ } };

function seed(db: Db, actor: string, now: Date): void {
  const at = iso(now);
  const g: Group = {
    id: `g${++db.seq}`, name: 'Sales EMEA (sample)', description: 'Sample group: how a team shares Spaces, rules and memory.', rev: 1,
    members: [{ email: actor, name: '', role: 'admin' }, ...DEMO_COLLEAGUES],
    spaces: [],
    config: { instructions: 'Answer in German unless asked otherwise. Keep it short: result first, then the reason. Name the source for every number.' },
    memory: [
      { id: 'm1', kind: 'rule', text: 'Quotes above 50k EUR need a second review before they are sent.', createdBy: DEMO_COLLEAGUES[0].email, createdAt: at },
      { id: 'm2', kind: 'decision', text: 'Renewals are worked in the Renewals Space; the health colours red, yellow, green are binding.', createdBy: actor, createdAt: at },
      { id: 'm3', kind: 'fact', text: 'The fiscal year starts on 1 October.', createdBy: DEMO_COLLEAGUES[0].email, createdAt: at },
    ],
    audit: [{ actor, action: 'group_created', detail: 'Sample group', at }],
  };
  db.groups.push(g);
  db.seeded = true;
}

const roleOf = (g: Group, actor: string): GroupRole | undefined => g.members.find((m) => m.email === actor)?.role;
const log = (g: Group, actor: string, action: string, detail = '') => { g.rev += 1; g.audit.unshift({ actor, action, detail: detail.slice(0, 120), at: iso(new Date()) }); g.audit = g.audit.slice(0, 50); };

export function createLocalGroupCall(store: Store, now: () => Date = () => new Date()): GroupCall {
  return async (tool, args) => {
    const actor = String(args.actor ?? '').toLowerCase();
    if (!actor) throw new Error('Your e-mail address is missing.');
    const db = load(store);
    if (!db.seeded && !db.groups.length) seed(db, actor, now());
    const mine = () => db.groups.filter((g) => roleOf(g, actor));
    const group = () => {
      const g = db.groups.find((x) => x.id === args.group);
      if (!g || !roleOf(g, actor)) throw new Error('This group does not exist or you are not a member.');
      return g;
    };
    const need = (g: Group, ...roles: GroupRole[]) => { if (!roles.includes(roleOf(g, actor)!)) throw new Error(`This needs the role ${roles.join(' or ')}; you are ${roleOf(g, actor)}.`); };
    let out: unknown = { ok: true };

    switch (tool) {
      case 'group_list':
        out = { groups: mine().map((g) => ({ id: g.id, name: g.name, description: g.description, role: roleOf(g, actor), rev: g.rev, members: g.members.length, spaces: g.spaces.length, memory: g.memory.length })) };
        break;
      case 'group_get': {
        const g = group();
        out = { role: roleOf(g, actor), group: { id: g.id, name: g.name, description: g.description, rev: g.rev }, config: g.config, members: g.members,
          spaces: g.spaces.map((s) => ({ slug: s.slug, title: s.title, version: s.version, publishedBy: s.publishedBy, publishedAt: s.publishedAt, bytes: s.package.length })), memory: g.memory, audit: g.audit };
        return JSON.parse(JSON.stringify(out));
      }
      case 'group_create': {
        const name = clean(args.name, 60);
        if (!name) throw new Error('The group needs a name.');
        const g: Group = { id: `g${++db.seq}`, name, description: clean(args.description, 200), rev: 1, members: [{ email: actor, name: clean(args.actor_name, 60), role: 'admin' }], spaces: [], memory: [], config: {}, audit: [] };
        log(g, actor, 'group_created', name);
        db.groups.push(g);
        out = { id: g.id };
        break;
      }
      case 'group_delete': { const g = group(); need(g, 'admin'); db.groups = db.groups.filter((x) => x !== g); break; }
      case 'group_set_member': {
        const g = group(); need(g, 'admin');
        const email = String(args.email ?? '').trim().toLowerCase(), role = args.role as GroupRole;
        if (!email || !['admin', 'member', 'viewer'].includes(role)) throw new Error('E-mail and role are needed.');
        const cur = g.members.find((m) => m.email === email);
        if (cur?.role === 'admin' && role !== 'admin' && g.members.filter((m) => m.role === 'admin').length === 1) throw new Error('A group needs at least one admin.');
        if (cur) { cur.role = role; if (args.name) cur.name = clean(args.name, 60); } else g.members.push({ email, name: clean(args.name, 60), role });
        log(g, actor, 'member_set', `${email} → ${role}`);
        break;
      }
      case 'group_remove_member': {
        const g = group(); const email = String(args.email ?? '').toLowerCase();
        if (email !== actor) need(g, 'admin');
        const target = g.members.find((m) => m.email === email);
        if (target?.role === 'admin' && g.members.filter((m) => m.role === 'admin').length === 1) throw new Error('The last admin cannot leave. Make someone else admin first.');
        g.members = g.members.filter((m) => m.email !== email);
        log(g, actor, 'member_removed', email);
        if (!g.members.length) db.groups = db.groups.filter((x) => x !== g);
        break;
      }
      case 'group_publish_space': {
        const g = group(); need(g, 'admin', 'member');
        const slug = String(args.slug ?? ''), pkg = String(args.package ?? '');
        if (!slug || !pkg) throw new Error('The Space package is missing.');
        const cur = g.spaces.find((s) => s.slug === slug);
        if (cur && roleOf(g, actor) !== 'admin' && cur.publishedBy !== actor) throw new Error('Only the publisher or an admin can publish a new version.');
        const sp: Sp = { slug, title: clean(args.title, 120) || slug, version: (cur?.version ?? 0) + 1, publishedBy: actor, publishedAt: iso(now()), package: pkg };
        g.spaces = [sp, ...g.spaces.filter((s) => s.slug !== slug)];
        log(g, actor, 'space_published', `${sp.title} v${sp.version}`);
        out = { version: sp.version };
        break;
      }
      case 'group_get_space': {
        const g = group(); const s = g.spaces.find((x) => x.slug === args.slug);
        if (!s) throw new Error('This Space is not in the group.');
        return { slug: s.slug, title: s.title, version: s.version, package: s.package };
      }
      case 'group_remove_space': {
        const g = group(); need(g, 'admin', 'member'); const s = g.spaces.find((x) => x.slug === args.slug);
        if (!s) throw new Error('This Space is not in the group.');
        if (roleOf(g, actor) !== 'admin' && s.publishedBy !== actor) throw new Error('Only the publisher or an admin can remove it.');
        g.spaces = g.spaces.filter((x) => x !== s); log(g, actor, 'space_removed', s.title);
        break;
      }
      case 'group_save_config': {
        const g = group(); need(g, 'admin');
        const cfg = (args.config ?? {}) as { instructions?: unknown };
        g.config = { ...g.config, instructions: clean(cfg.instructions, 1000) };
        log(g, actor, 'config_saved');
        break;
      }
      case 'group_memory_add': {
        const g = group(); need(g, 'admin', 'member');
        const text = clean(args.text, 600); if (!text) throw new Error('The entry is empty.');
        if (g.memory.length >= 100) throw new Error('The team memory is full (100 entries).');
        g.memory.unshift({ id: `m${Date.now().toString(36)}${g.memory.length}`, kind: args.kind as MemoryKind, text, createdBy: actor, createdAt: iso(now()) });
        log(g, actor, 'memory_added', text.slice(0, 60));
        break;
      }
      case 'group_memory_update': case 'group_memory_delete': {
        const g = group(); const m = g.memory.find((x) => x.id === args.id);
        if (!m) throw new Error('This entry does not exist.');
        if (roleOf(g, actor) !== 'admin' && !(roleOf(g, actor) === 'member' && m.createdBy === actor)) throw new Error('Only its author or an admin can change this entry.');
        if (tool === 'group_memory_delete') { g.memory = g.memory.filter((x) => x !== m); log(g, actor, 'memory_deleted'); }
        else { const t = clean(args.text, 600); if (!t) throw new Error('The entry is empty.'); m.text = t; m.kind = args.kind as MemoryKind; log(g, actor, 'memory_updated'); }
        break;
      }
      default: throw new Error(`Unknown group tool: ${tool}`);
    }
    save(store, db);
    return out;
  };
}

/** For the demo: Anna adds a rule, as a colleague working in the same group would. */
export function simulateColleague(store: Store, groupId: string, now: Date = new Date()): string {
  const db = load(store); const g = db.groups.find((x) => x.id === groupId);
  if (!g) return '';
  const lines = ['Discounts above 15 percent need approval from the regional lead.', 'Customer names are never pasted into external tools.', 'Every offer shows the AI-unit runway of the customer.', 'Steering committee decks use the Control Tower figures only.'];
  const text = lines.find((l) => !g.memory.some((m) => m.text === l));
  if (!text) return '';
  const a = DEMO_COLLEAGUES[0];
  if (!g.members.some((m) => m.email === a.email)) g.members.push(a);
  g.memory.unshift({ id: `m${now.getTime().toString(36)}`, kind: 'rule', text, createdBy: a.email, createdAt: iso(now) });
  log(g, a.email, 'memory_added', text.slice(0, 60));
  save(store, db);
  return text;
}
