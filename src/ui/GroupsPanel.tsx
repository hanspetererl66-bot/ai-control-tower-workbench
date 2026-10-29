import { useCallback, useEffect, useMemo, useState } from 'react';
import { EMAIL, MEMORY_KINDS, canEditMemory, canWrite, createGroupClient, groupSlug, saveIdentity, type GroupCall, type GroupDetail, type GroupRole, type GroupSummary, type Identity, type MemoryKind } from '../groups';
import { importSpaceFile } from '../space-share';
import { simulateColleague } from '../groups-local';
import { Section, type SpaceRef } from './PreferencesPanels';

export type GroupsPanelProps = {
  call: GroupCall | null;
  /** local = kept on this computer (sample group); server = the connector with a database. */
  mode: 'local' | 'server';
  serverAvailable: boolean;
  onMode: (mode: 'local' | 'server') => void;
  identity: Identity | null;
  onIdentity: (identity: Identity | null) => void;
  spaces: SpaceRef[];
  activeId: string | null;
  onActive: (id: string | null) => void;
  /** Called after a group Space was installed on this computer. */
  onSpaceInstalled: (slug: string) => void;
  /** Called after the open group changed, so the chat uses the new rules. */
  onDetail: (detail: GroupDetail) => void;
};

const ROLES: GroupRole[] = ['admin', 'member', 'viewer'];
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function GroupsPanel({ call, mode, serverAvailable, onMode, identity, onIdentity, spaces, activeId, onActive, onSpaceInstalled, onDetail }: GroupsPanelProps) {
  const [email, setEmail] = useState(identity?.email ?? '');
  const [name, setName] = useState(identity?.name ?? '');
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [openId, setOpenId] = useState<string | null>(activeId);
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [memberRole, setMemberRole] = useState<GroupRole>('member');
  const [kind, setKind] = useState<MemoryKind>('rule');
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [instructions, setInstructions] = useState('');
  const [pubSlug, setPubSlug] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);

  const client = useMemo(() => (call && identity ? createGroupClient(call, identity.email) : null), [call, identity]);

  const load = useCallback(async () => {
    if (!client) return;
    try {
      const list = await client.list();
      setGroups(list);
      if (openId && list.some((g) => g.id === openId)) {
        const d = await client.get(openId);
        setDetail(d);
        setInstructions((current) => (current === '' || d.config.instructions !== undefined ? d.config.instructions ?? '' : current));
        if (openId === activeId) onDetail(d);
      } else { setDetail(null); }
    } catch (e) { setMessage(errorText(e)); }
  }, [client, openId, activeId, onDetail]);

  useEffect(() => { void load(); }, [load]);
  // Other people work in the same group: look again while this page is open.
  useEffect(() => {
    if (!client) return undefined;
    const timer = window.setInterval(() => { void load(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [client, load]);

  const run = async (label: string, work: () => Promise<unknown>, after?: () => void) => {
    setBusy(true); setMessage('');
    try { await work(); setMessage(label); after?.(); await load(); } catch (e) { setMessage(errorText(e)); } finally { setBusy(false); }
  };

  const role = detail?.role;
  const write = canWrite(role);
  const admin = role === 'admin';

  const saveId = () => {
    if (!EMAIL.test(email.trim())) { setMessage('Please enter a valid e-mail address.'); return; }
    const id = { email: email.trim().toLowerCase(), name: name.trim() };
    saveIdentity(window.localStorage, id);
    onIdentity(id);
    setMessage('Saved.');
  };

  const publish = async () => {
    if (!client || !detail || !pubSlug) return;
    const space = spaces.find((s) => s.slug === pubSlug);
    if (!space) return;
    await run(`Published "${space.title}" to the group.`, async () => {
      const res = await fetch(`/__spaces/${encodeURIComponent(space.slug)}/package`);
      if (!res.ok) throw new Error('The Space could not be read.');
      await client.publishSpace(detail.group.id, groupSlug(space.slug), space.title, await res.text());
    });
  };
  const install = async (slug: string) => {
    if (!client || !detail) return;
    await run('', async () => {
      const got = await client.getSpace(detail.group.id, slug);
      const file = new File([got.package], `${slug}.json`, { type: 'application/json' });
      let result = await importSpaceFile(file);
      if ('exists' in result) {
        const replace = window.confirm(`A Space "${result.title}" already exists on this computer.\nOK = replace it with the group version, Cancel = install as a copy.`);
        result = await importSpaceFile(file, replace ? 'replace' : 'new');
      }
      if ('exists' in result) return;
      setMessage(`Installed "${result.title}" (group version ${got.version}).`);
      onSpaceInstalled(result.slug);
    });
  };

  const intro = (
    <>
      <Section title="What are groups?" hint="A group is a small team that works with the same assistant setup. Four things are shared:">
        <ul className="prefs-list">
          <li><div><b>1 · Shared instructions.</b> <small>One standing brief for everybody, for example “answer in German, result first, name the source”. It comes on top of each person's own settings.</small></div></li>
          <li><div><b>2 · Team memory.</b> <small>Rules, decisions and facts of the team (“quotes above 50k need a second review”). When you use the group in chat, the assistant knows them.</small></div></li>
          <li><div><b>3 · Shared Spaces.</b> <small>One person publishes a Space; the others install it. A new publish creates a new version.</small></div></li>
          <li><div><b>4 · Roles.</b> <small>Admin manages everything, member publishes and writes memory, viewer only reads. Every change lands in the activity log.</small></div></li>
        </ul>
        <p className="prefs-note"><b>Try it:</b> save your e-mail, open the sample group, press “Use in chat”, then ask something in a conversation. Use “Colleague adds a rule” to see how a teammate's rule arrives.</p>
      </Section>
      <Section title="Where the group lives">
        <div className="prefs-row" role="radiogroup" aria-label="Where groups are kept">
          <button className={`ghost-btn ${mode === 'local' ? 'ghost-btn-on' : ''}`} role="radio" aria-checked={mode === 'local'} onClick={() => onMode('local')}>On this computer (demo)</button>
          <button className={`ghost-btn ${mode === 'server' ? 'ghost-btn-on' : ''}`} role="radio" aria-checked={mode === 'server'} onClick={() => onMode('server')}>Team server (Supabase)</button>
        </div>
        <p className="prefs-note">{mode === 'local'
          ? 'Kept on this computer only, with a made-up sample team. Good for trying and for demos; nobody else sees it.'
          : serverAvailable ? 'Shared with real colleagues through the database behind the control-tower connector.' : 'Needs the control-tower connector with a Supabase URL and secret key. Connect it first (Manage), or switch back to the demo.'}</p>
      </Section>
    </>
  );

  if (!call) return <>{intro}</>;

  return (
    <>
      {intro}
      <Section title="Who you are" hint="An e-mail address is how the group knows you. It is a label, not a login: anyone who knows a member's address could act as that member, so do not put anything in a group you would not show the whole team.">
        <div className="prefs-row">
          <input type="text" aria-label="Your e-mail address" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input type="text" aria-label="Your name" placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          <button className="ghost-btn" onClick={saveId}>Save</button>
        </div>
      </Section>

      {message && <p className="prefs-note" role="status">{message}</p>}

      {identity && (
        <>
          <Section title="Your groups" hint="Members share Spaces, one set of instructions and a team memory. Roles: admin manages everything, member publishes and adds to the memory, viewer reads.">
            <ul className="prefs-list">
              {groups.map((g) => (
                <li key={g.id}>
                  <div>
                    <b>{g.name}</b> <small>{g.role} · {g.members} members · {g.spaces} Spaces · {g.memory} memory entries{g.id === activeId ? ' · used in chat' : ''}</small>
                  </div>
                  <div>
                    <button className="ghost-btn" onClick={() => setOpenId(g.id === openId ? null : g.id)} aria-expanded={g.id === openId}>{g.id === openId ? 'Close' : 'Open'}</button>
                    <button className="ghost-btn" onClick={() => onActive(g.id === activeId ? null : g.id)}>{g.id === activeId ? 'Stop using in chat' : 'Use in chat'}</button>
                    {mode === 'local' && g.id === openId && <button className="ghost-btn" onClick={() => { const t = simulateColleague(window.localStorage, g.id); setMessage(t ? `Anna Schmidt added a rule: “${t}”` : 'Anna has nothing more to add.'); void load(); }}>Colleague adds a rule</button>}
                  </div>
                </li>
              ))}
              {!groups.length && <li><small>You are not in a group yet.</small></li>}
            </ul>
            <div className="prefs-row">
              <input type="text" aria-label="New group name" placeholder="New group name" value={newName} maxLength={60} onChange={(e) => setNewName(e.target.value)} />
              <input type="text" aria-label="Description" placeholder="Description (optional)" value={newDesc} maxLength={200} onChange={(e) => setNewDesc(e.target.value)} />
              <button className="ghost-btn" disabled={busy || !newName.trim() || !client} onClick={() => client && void run(`Created "${newName.trim()}".`, () => client.create(newName.trim(), newDesc.trim(), identity.name), () => { setNewName(''); setNewDesc(''); })}>Create group</button>
            </div>
          </Section>

          {detail && client && (
            <>
              <Section title={`${detail.group.name}: members`} hint={`You are ${detail.role}.`}>
                <ul className="prefs-list">
                  {detail.members.map((m) => (
                    <li key={m.email}>
                      <div><b>{m.name || m.email}</b> <small>{m.name ? `${m.email} · ` : ''}{m.role}</small></div>
                      <div>
                        {admin && (
                          <select aria-label={`Role of ${m.email}`} value={m.role} disabled={busy} onChange={(e) => void run('Role changed.', () => client.setMember(detail.group.id, m.email, e.target.value as GroupRole, m.name))}>
                            {ROLES.map((r) => <option key={r}>{r}</option>)}
                          </select>
                        )}
                        {(admin || m.email === identity.email) && <button className="ghost-btn" disabled={busy} onClick={() => void run(m.email === identity.email ? 'You left the group.' : 'Member removed.', () => client.removeMember(detail.group.id, m.email), m.email === identity.email ? () => setOpenId(null) : undefined)}>{m.email === identity.email ? 'Leave' : 'Remove'}</button>}
                      </div>
                    </li>
                  ))}
                </ul>
                {admin && (
                  <div className="prefs-row">
                    <input type="text" aria-label="E-mail of the new member" placeholder="colleague@company.com" value={memberEmail} onChange={(e) => setMemberEmail(e.target.value)} />
                    <select aria-label="Role" value={memberRole} onChange={(e) => setMemberRole(e.target.value as GroupRole)}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
                    <button className="ghost-btn" disabled={busy || !EMAIL.test(memberEmail.trim())} onClick={() => void run('Member added.', () => client.setMember(detail.group.id, memberEmail.trim(), memberRole), () => setMemberEmail(''))}>Add</button>
                  </div>
                )}
              </Section>

              <Section title="Shared Spaces" hint="Install puts the group version on this computer (you decide whether it replaces a Space with the same name). Publish sends your version to the group.">
                <ul className="prefs-list">
                  {detail.spaces.map((s) => (
                    <li key={s.slug}>
                      <div><b>{s.title}</b> <small>version {s.version} · {s.publishedBy} · {Math.max(1, Math.round(s.bytes / 1024))} KB</small></div>
                      <div>
                        <button className="ghost-btn" disabled={busy} onClick={() => void install(s.slug)}>Install</button>
                        {write && (admin || s.publishedBy === identity.email) && (
                          confirm === `space:${s.slug}`
                            ? <><button className="ghost-btn ghost-btn-on" onClick={() => { setConfirm(null); void run('Removed from the group.', () => client.removeSpace(detail.group.id, s.slug)); }}>Yes, remove from group</button><button className="ghost-btn" onClick={() => setConfirm(null)}>Cancel</button></>
                            : <button className="ghost-btn" onClick={() => setConfirm(`space:${s.slug}`)}>Remove</button>
                        )}
                      </div>
                    </li>
                  ))}
                  {!detail.spaces.length && <li><small>No Spaces published yet.</small></li>}
                </ul>
                {write && (
                  <div className="prefs-row">
                    <select aria-label="Space to publish" value={pubSlug} onChange={(e) => setPubSlug(e.target.value)}>
                      <option value="">Choose one of your Spaces</option>
                      {spaces.map((s) => <option key={s.slug} value={s.slug}>{s.title}</option>)}
                    </select>
                    <button className="ghost-btn" disabled={busy || !pubSlug} onClick={() => void publish()}>Publish to group</button>
                  </div>
                )}
              </Section>

              <Section title="Team memory" hint="Rules, decisions and facts everybody in the group works with. When this group is used in chat, the assistant is told about them. Keep it free of personal data and secrets.">
                <ul className="prefs-list">
                  {detail.memory.map((m) => (
                    <li key={m.id}>
                      {editing === m.id ? (
                        <div className="prefs-row" style={{ flex: 1 }}>
                          <input type="text" aria-label="Edit entry" value={editText} maxLength={600} onChange={(e) => setEditText(e.target.value)} style={{ flex: 1 }} />
                          <button className="ghost-btn" disabled={busy || !editText.trim()} onClick={() => void run('Saved.', () => client.updateMemory(detail.group.id, m.id, m.kind, editText.trim()), () => setEditing(null))}>Save</button>
                          <button className="ghost-btn" onClick={() => setEditing(null)}>Cancel</button>
                        </div>
                      ) : (
                        <>
                          <div><b>{m.kind}</b> {m.text} <small>{m.createdBy}</small></div>
                          {canEditMemory(detail.role, m, identity.email) && (
                            <div>
                              <button className="ghost-btn" onClick={() => { setEditing(m.id); setEditText(m.text); }}>Edit</button>
                              {confirm === `mem:${m.id}`
                                ? <><button className="ghost-btn ghost-btn-on" onClick={() => { setConfirm(null); void run('Deleted.', () => client.deleteMemory(detail.group.id, m.id)); }}>Yes, delete</button><button className="ghost-btn" onClick={() => setConfirm(null)}>Cancel</button></>
                                : <button className="ghost-btn" onClick={() => setConfirm(`mem:${m.id}`)}>Delete</button>}
                            </div>
                          )}
                        </>
                      )}
                    </li>
                  ))}
                  {!detail.memory.length && <li><small>Nothing yet.</small></li>}
                </ul>
                {write && (
                  <div className="prefs-row">
                    <select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value as MemoryKind)}>{MEMORY_KINDS.map((k) => <option key={k}>{k}</option>)}</select>
                    <input type="text" aria-label="New entry" placeholder="For example: quotes over 50k need a second review" value={text} maxLength={600} onChange={(e) => setText(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
                    <button className="ghost-btn" disabled={busy || !text.trim()} onClick={() => void run('Added.', () => client.addMemory(detail.group.id, kind, text.trim()), () => setText(''))}>Add</button>
                  </div>
                )}
              </Section>

              <Section title="Group instructions" hint={admin ? 'Standing instructions for everybody in the group, in addition to their own settings. No keys or passwords.' : 'Set by the group admins.'}>
                <textarea className="prefs-area" aria-label="Group instructions" rows={3} maxLength={1000} value={instructions} readOnly={!admin} onChange={(e) => setInstructions(e.target.value)} />
                {admin && <div className="prefs-row"><button className="ghost-btn" disabled={busy || instructions === (detail.config.instructions ?? '')} onClick={() => void run('Saved.', () => client.saveConfig(detail.group.id, { ...detail.config, instructions: instructions.trim() }))}>Save instructions</button></div>}
              </Section>

              <Section title="Recent activity">
                <ul className="prefs-list">{detail.audit.slice(0, 8).map((a, i) => <li key={i}><small>{a.at.slice(0, 16).replace('T', ' ')} · {a.actor} · {a.action.replace(/_/g, ' ')}{a.detail ? ` · ${a.detail}` : ''}</small></li>)}</ul>
              </Section>

              {admin && (
                <Section title="Delete group" hint="Removes the group with its Spaces and memory for everybody. Spaces already installed on a computer stay there.">
                  {confirm === 'group'
                    ? <div className="prefs-row"><button className="ghost-btn ghost-btn-on" disabled={busy} onClick={() => { setConfirm(null); void run('Group deleted.', () => client.remove(detail.group.id), () => { if (activeId === detail.group.id) onActive(null); setOpenId(null); }); }}>Yes, delete "{detail.group.name}"</button><button className="ghost-btn" onClick={() => setConfirm(null)}>Cancel</button></div>
                    : <div className="prefs-row"><button className="ghost-btn" onClick={() => setConfirm('group')}>Delete group…</button></div>}
                </Section>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
