import AdminHero from './AdminHero';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { FLOW, FLOW_LABEL, type FlowStep } from '../flow';
import {
  TYPES, TYPE_LABEL, addLink, diffRevisions, featureArgs, filterItems, hostApi, itemsForRef, keepCard, loadHistory, loadRegistry, loadRevFiles, noFilter, parseFeature,
  restoreRevision, setStage, stageText, type FileDiff, type Filter, type RItem, type Rev, type RevFile,
} from '../registry';
import { MODE_LABEL, policyGaps, revisionPolicy, widens, type RevisionPolicy } from '../policy-manifest';
import {
  CRITICALITY_LABEL, DISCOVERY_LABEL, FLAGS, FLAG_LABEL, PHASES, PHASE_LABEL, REL_KINDS, REL_LABEL, RISK_LABEL, VERIFICATION_LABEL, euro, profileOf, similarItems, summarize, type Profile,
} from '../registry-card';
import { exampleRegistry } from '../registry-examples';
import RegistryCardEditor from './RegistryCardEditor';
import { commentFor, isDone, labelsFor, loadLog, markerOf, notedAt, parseWriteback, record, saveLog, summaryOf, ticketsOf, writebackPrompt, type WriteResult } from '../writeback';

const when = (t: number) => (t ? new Date(t).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–');
const msg = (e: unknown) => String((e as any)?.message ?? e).slice(0, 240);

/**
 * Registry: everything built so far (agents, workflows, features) with the full history of each item. Reads the work items of the
 * shared database; every save there is a revision with author, time and note. Nothing here deletes a revision: "Restore" saves an old
 * revision as the newest one.
 */
type GenerateProps = { generate?: (prompt: string, title: string, session?: string) => Promise<string>; onStop?: () => void; ready?: boolean };

export default function RegistryView({ generate, onStop, ready = false, onBack }: GenerateProps & { onBack?: () => void }) {
  const api = useMemo(() => hostApi(), []);
  const example = useMemo(() => exampleRegistry(), []);
  const [items, setItems] = useState<RItem[] | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>(noFilter());
  const [openId, setOpenId] = useState<string | null>(null);
  const [exampleOn, setExampleOn] = useState(false);
  /** Without the database (a plain browser) or on request, the register shows the invented example items. */
  const showExample = !api || exampleOn;

  const load = useCallback(async () => {
    if (!api) return;
    setError('');
    try { setItems(await loadRegistry(api)); } catch (e) { setError(msg(e)); setItems((cur) => cur ?? []); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);

  const list = showExample ? example.items : items;
  const now = useMemo(() => Date.now(), [list]);
  const shown = useMemo(() => filterItems(list ?? [], filter, now), [list, filter, now]);
  const profiles = useMemo(() => new Map((list ?? []).map((i) => [i.id, profileOf(i, list ?? [], now)])), [list, now]);
  const summary = useMemo(() => summarize(list ?? [], now), [list, now]);
  const open = (list ?? []).find((i) => i.id === openId) ?? null;
  const pick = (patch: Partial<Filter>) => setFilter((f) => ({ ...noFilter(), query: f.query, ...patch }));
  const switchData = (on: boolean) => { setExampleOn(on); setOpenId(null); setFilter(noFilter()); };

  return (
    <main className="sh rg">
      <AdminHero screen="Solution register" lead="Know what was built," accent="and where it stands." onBack={onBack}
        lede={list ? `${list.filter((i) => !i.archived).length} items · agents, workflows and features with their profile and history` : 'Agents, workflows and features with their profile and history'}>
        {api && !showExample && <button className="rg-refresh" onClick={() => void load()}>Refresh</button>}
      </AdminHero>

      {showExample && (
        <p className="rg-example" role="status">
          <span className="rg-chip rg-chip-ex">Example</span>
          Invented items, people and numbers, so the register can be tried out. {api ? 'Nothing here is read from the shared database.' : 'The real register reads the shared database in the desktop app, once the connector "werkbank-workspace" has the Supabase URL and the secret key.'}
          {api && <button onClick={() => switchData(false)}>Show my own items</button>}
        </p>
      )}
      {!showExample && items !== null && items.length === 0 && !error && (
        <p className="rg-example">Nothing is saved yet. <button onClick={() => switchData(true)}>Show example items</button></p>
      )}

      {list === null ? <p className="sh-empty">Loading…</p> : (
        <>
          <div className="rg-kpis" role="group" aria-label="The register in numbers">
            <Kpi label="Active" value={summary.byPhase.active} hint={`${summary.solutions} agents and workflows in all`} on={filter.phase === 'active'} onClick={() => pick({ phase: 'active' })} />
            <Kpi label="Verified" value={`${summary.verified} of ${summary.solutions}`} hint="A person confirmed the entry" on={filter.flag === 'verification-open'} onClick={() => pick({ flag: 'verification-open' })} actionHint="Show the ones that are not" />
            <Kpi label="Need a look" value={summary.flagged} tone={summary.flagged ? 'warn' : undefined} hint="At least one hint, see the column" on={filter.flag === 'any'} onClick={() => pick({ flag: 'any' })} />
            <Kpi label="Review overdue" value={summary.byFlag['review-overdue']} tone={summary.byFlag['review-overdue'] ? 'warn' : undefined} hint="Past the date set for the next review" on={filter.flag === 'review-overdue'} onClick={() => pick({ flag: 'review-overdue' })} />
            <Kpi label="No owner" value={summary.byFlag['no-owner']} tone={summary.byFlag['no-owner'] ? 'warn' : undefined} hint="Nobody is responsible" on={filter.flag === 'no-owner'} onClick={() => pick({ flag: 'no-owner' })} />
            <Kpi label="Cost · value, 30 days" value={summary.costEur === null ? '–' : `${euro(summary.costEur)} · ${euro(summary.valueEur)}`} hint={summary.costEur === null ? 'Nothing measured yet' : `${summary.measured} items report it. Value is an estimate.`} small />
          </div>

          <div className="rg-filters">
            <input type="search" aria-label="Search the register" placeholder="Search by name, owner, system, tag or ticket (e.g. ABC-12)" value={filter.query} onChange={(e) => setFilter({ ...filter, query: e.target.value })} />
            <select aria-label="Type" value={filter.type} onChange={(e) => setFilter({ ...filter, type: e.target.value as Filter['type'] })}>
              <option value="all">All types</option>
              {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </select>
            <select aria-label="Lifecycle" value={filter.phase ?? 'all'} onChange={(e) => setFilter({ ...filter, phase: e.target.value as Filter['phase'] })}>
              <option value="all">Any lifecycle phase</option>
              {PHASES.map((p) => <option key={p} value={p}>{PHASE_LABEL[p]}</option>)}
            </select>
            <select aria-label="Needs a look" value={filter.flag ?? 'all'} onChange={(e) => setFilter({ ...filter, flag: e.target.value as Filter['flag'] })}>
              <option value="all">Everything</option>
              <option value="any">Needs a look (any hint)</option>
              {FLAGS.map((f) => <option key={f} value={f}>{FLAG_LABEL[f]}</option>)}
            </select>
            <select aria-label="Status" value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value as Filter['status'] })}>
              <option value="active">Active</option><option value="archived">Archived</option><option value="all">All</option>
            </select>
          </div>
          {error && !showExample && <p className="rg-error" role="alert">{error}</p>}
          <div className={`rg-split ${open ? 'rg-split-open' : ''}`}>
            <div className="sh-scroll rg-list">
              {shown.length === 0 ? <p className="sh-empty">{list.length === 0 ? 'Nothing here yet. Agents and workflows appear after their first save, features when you hand a cluster over from Sources.' : 'No item matches.'}</p> : (
                <table className="sh-table">
                  <thead><tr><th>Type</th><th>Name</th><th>Lifecycle</th><th className="rg-opt">Criticality</th><th>Verified</th><th className="rg-opt">Owner</th><th>Look at</th><th className="rg-opt">Changed</th></tr></thead>
                  <tbody>
                    {shown.map((i) => {
                      const p = profiles.get(i.id)!;
                      const solution = i.type === 'agent' || i.type === 'workflow';
                      return (
                        <tr key={i.id} className={`rg-row ${i.id === openId ? 'rg-row-on' : ''}`} onClick={() => setOpenId(i.id)}>
                          <td><span className={`rg-type rg-type-${i.type}`}>{TYPE_LABEL[i.type]}</span></td>
                          <td><button className="rg-name" onClick={(e) => { e.stopPropagation(); setOpenId(i.id); }}>{i.name}</button>
                            {i.card?.organization && <small>{i.card.organization}</small>}
                            {i.extendsItem && <small>extends {i.extendsItem.name}</small>}
                            {i.refs.length > 0 && <small>{i.refs.slice(0, 3).map((r) => r.key).join(', ')}{i.refs.length > 3 ? ` +${i.refs.length - 3}` : ''}</small>}</td>
                          <td>{p.phase ? <span className={`rg-ph rg-ph-${p.phase}`}>{PHASE_LABEL[p.phase]}</span> : <span className="rg-miss">–</span>}{p.phaseSource === 'derived' && stageText(i) && <small>{stageText(i)}</small>}</td>
                          <td className="rg-opt">{p.criticality ? CRITICALITY_LABEL[p.criticality] : <span className="rg-miss">{solution ? 'not declared' : '–'}</span>}</td>
                          <td>{solution ? <span className={`rg-vf rg-vf-${p.verification}`}>{VERIFICATION_LABEL[p.verification]}</span> : <span className="rg-miss">–</span>}</td>
                          <td className="rg-opt">{i.owner || (solution && !i.archived ? <span className="rg-miss rg-miss-warn">none</span> : <span className="rg-miss">–</span>)}</td>
                          <td>{p.flags.length ? <span className="rg-flagcount" title={p.flags.map((f) => f.label).join('\n')} aria-label={`${p.flags.length} hint${p.flags.length === 1 ? '' : 's'}: ${p.flags.map((f) => f.label).join(', ')}`}>{p.flags.length}</span> : <span className="rg-miss">–</span>}</td>
                          <td className="rg-opt">{when(i.updatedAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            {open && <Detail key={open.id} item={open} all={list} profile={profiles.get(open.id)!} now={now} exampleRevs={showExample ? (example.history[open.id] ?? []) : undefined} generate={generate} onStop={onStop} ready={ready} onClose={() => setOpenId(null)} onChanged={load} onOpen={(id) => setOpenId(id)} onFind={(key) => { setFilter({ ...noFilter(), status: 'all', query: key }); setOpenId(null); }} />}
          </div>
        </>
      )}
    </main>
  );
}

/** One number above the list. A tile with an `onClick` filters the list to what it counts; pressing it again is done with the filters. */
function Kpi({ label, value, hint, tone, on, onClick, small, actionHint }: { label: string; value: number | string; hint: string; tone?: 'warn'; on?: boolean; onClick?: () => void; small?: boolean; actionHint?: string }) {
  const body = (
    <>
      <span className="rg-kpi-label">{label}</span>
      <b className={`rg-kpi-value${small ? ' rg-kpi-small' : ''}${tone ? ` rg-kpi-${tone}` : ''}`}>{value}</b>
      <small>{hint}</small>
    </>
  );
  return onClick
    ? <button className={`rg-kpi${on ? ' rg-kpi-on' : ''}`} onClick={onClick} aria-pressed={on} title={actionHint ?? `Show: ${label.toLowerCase()}`}>{body}</button>
    : <div className="rg-kpi rg-kpi-static">{body}</div>;
}

const NOT_DECLARED = <span className="rg-miss">not declared</span>;
const dayText = (d: string) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '');

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return <div className={`rg-field${wide ? ' rg-field-wide' : ''}`}><dt>{label}</dt><dd>{children}</dd></div>;
}

/**
 * The register card of an item: who is responsible, where it is in its life, how critical and how risky it is, whether anybody verified it,
 * what it connects to and what it did in the last 30 days. Read only. A field nobody declared says so ("not declared"); nothing is guessed.
 * The hints at the top are computed (registry-card.ts) and only ask for a look, they block nothing.
 */
function CardPanel({ item, all, profile, now, example, onOpen, onSaved }: { item: RItem; all: RItem[]; profile: Profile; now: number; example: boolean; onOpen: (id: string) => void; onSaved: (text: string) => Promise<void> }) {
  const api = useMemo(() => hostApi(), []);
  const [editing, setEditing] = useState(false);
  const canEdit = !!api && !example && !item.archived;
  const c = item.card;
  const solution = item.type === 'agent' || item.type === 'workflow';
  const twins = similarItems(all, item.id);
  const groups = REL_KINDS.map((k) => ({ k, rels: (c?.relations ?? []).filter((r) => r.kind === k) })).filter((g) => g.rels.length);
  const t = c?.telemetry;
  const measured = !!t && (t.runs30 !== null || t.costEur !== null || t.valueEur !== null || t.users30 !== null);
  const dueOver = !!c?.reviewDue && Date.parse(c.reviewDue) + 86_400_000 <= now;
  const dates = c ? PHASES.filter((p) => c.dates[p]) : [];

  if (editing && api) {
    return (
      <section className="rg-card" aria-label="Register card">
        <div className="rg-card-head"><h3 className="rg-h">Register card · editing</h3></div>
        <RegistryCardEditor item={item} api={api} solution={solution} onCancel={() => setEditing(false)} onSaved={async (t) => { setEditing(false); await onSaved(t); }} />
      </section>
    );
  }

  return (
    <section className="rg-card" aria-label="Register card">
      <div className="rg-card-head">
        <h3 className="rg-h">Register card{example ? ' · example' : ''}</h3>
        {canEdit && !editing && <button onClick={() => setEditing(true)}>{c ? 'Edit the card' : 'Fill in the card'}</button>}
      </div>
      {profile.flags.length > 0 && (
        <ul className="rg-flags" aria-label="Hints">
          {profile.flags.map((f) => <li key={f.id}><b>{f.label}</b> {f.why}</li>)}
        </ul>
      )}
      {!c && <p className="sh-note">Nobody has filled in a card for this item yet. Only what can be read from the build is shown; the rest is not declared.</p>}
      {c?.purpose && <p className="rg-purpose">{c.purpose}</p>}

      <h4 className="rg-sub">Ownership</h4>
      <dl className="rg-dl">
        <Field label="Responsible">{item.owner || <span className="rg-miss rg-miss-warn">nobody</span>}</Field>
        <Field label="Accountable">{c?.steward || NOT_DECLARED}</Field>
        <Field label="Organization">{c?.organization || NOT_DECLARED}</Field>
        <Field label="Runs on">{c?.provider || NOT_DECLARED}</Field>
        {c && <Field label="Origin">{DISCOVERY_LABEL[c.discovery]}</Field>}
      </dl>

      <h4 className="rg-sub">Lifecycle</h4>
      <dl className="rg-dl">
        <Field label="Phase">
          {profile.phase ? <span className={`rg-ph rg-ph-${profile.phase}`}>{PHASE_LABEL[profile.phase]}</span> : <span className="rg-miss">–</span>}
          {profile.phaseSource === 'derived' && <small className="rg-note"> read from the build steps, not declared</small>}
        </Field>
      </dl>
      {dates.length > 0 && (
        <ol className="rg-life" aria-label="Lifecycle dates">
          {dates.map((p) => <li key={p} className={p === profile.phase ? 'rg-life-on' : ''}><span>{PHASE_LABEL[p]}</span><b>{dayText(c!.dates[p]!)}</b></li>)}
        </ol>
      )}

      {solution && (
        <>
          <h4 className="rg-sub">Governance</h4>
          <dl className="rg-dl">
            <Field label="Business criticality">{profile.criticality ? CRITICALITY_LABEL[profile.criticality] : NOT_DECLARED}</Field>
            <Field label="Verification">
              <span className={`rg-vf rg-vf-${profile.verification}`}>{VERIFICATION_LABEL[profile.verification]}</span>
              {c?.verifiedAt && <small className="rg-note"> {c.verifiedBy ? `by ${c.verifiedBy}, ` : ''}{dayText(c.verifiedAt)}</small>}
            </Field>
            <Field label="Next review">{c?.reviewDue ? <>{dayText(c.reviewDue)}{dueOver && <small className="rg-note rg-note-warn"> overdue</small>}</> : NOT_DECLARED}</Field>
            <Field label="Risk class (EU AI Act)">
              <span className={`rg-rk rg-rk-${profile.risk}`}>{RISK_LABEL[profile.risk]}</span>
              {c?.riskReason && <small className="rg-note"> {c.riskReason}</small>}
            </Field>
            <Field label="What it may do" wide>
              {item.policy ? `${MODE_LABEL[item.policy.mode]}${item.policy.writes ? ' · writes to systems' : ''}${item.policy.unattended ? ' · can run without a person' : ' · started by a person'}` : NOT_DECLARED}
            </Field>
          </dl>
        </>
      )}

      {groups.length > 0 && (
        <>
          <h4 className="rg-sub">Connections</h4>
          <div className="rg-rels">
            {groups.map((g) => (
              <div key={g.k} className="rg-rel">
                <span className="rg-rel-label">{REL_LABEL[g.k]}</span>
                <div>
                  {g.rels.map((r) => {
                    const target = r.kind === 'item' ? all.find((x) => x.name === r.name && x.id !== item.id) : undefined;
                    const text = `${r.name}${r.access ? ` (${r.access})` : ''}`;
                    return (
                      <span key={`${r.kind}:${r.name}`} className={`rg-chip rg-chip-rel${r.access === 'write' ? ' rg-chip-write' : ''}`} title={r.note}>
                        {target ? <button onClick={() => onOpen(target.id)}>{r.note ? `${r.note} ` : ''}{text}</button> : <>{r.note && r.kind === 'item' ? `${r.note} ` : ''}{text}</>}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {solution && (
        <>
          <h4 className="rg-sub">Last 30 days</h4>
          {measured ? (
            <dl className="rg-dl rg-dl-tight">
              <Field label="Runs">{t!.runs30 ?? '–'}</Field>
              <Field label="Success">{t!.successPct === null ? '–' : `${t!.successPct} %`}</Field>
              <Field label="People">{t!.users30 ?? '–'}</Field>
              <Field label="Cost">{euro(t!.costEur)}</Field>
              <Field label="Value (estimate)">{euro(t!.valueEur)}</Field>
              <Field label="Last run">{t!.lastRun ? dayText(t!.lastRun) : '–'}</Field>
            </dl>
          ) : <p className="sh-note">Not measured. {example ? 'This example is not live yet.' : 'The register does not receive run data for this item yet.'}</p>}
        </>
      )}

      {twins.length > 0 && (
        <>
          <h4 className="rg-sub">Looks similar to</h4>
          <ul className="rg-similar">
            {twins.map((s) => <li key={s.item.id}><button onClick={() => onOpen(s.item.id)}>{s.item.name}</button><small> shares {s.shared.join(', ')}</small></li>)}
          </ul>
        </>
      )}

      {c && c.tags.length > 0 && <p className="rg-tags">{c.tags.map((g) => <span key={g} className="rg-chip">{g}</span>)}</p>}
      <p className="rg-foot">The fields follow concepts of SAP LeanIX: lifecycle phases, business criticality, responsible and accountable, verification, and relations to capabilities, systems, models and connectors. Risk class and the hints are our own addition. See docs/registry-leanix.md.</p>
    </section>
  );
}

function Detail({ item, all, profile, now, exampleRevs, onClose, onChanged, onFind, onOpen, generate, onStop, ready }: { item: RItem; all: RItem[]; profile: Profile; now: number; exampleRevs?: Rev[]; onClose: () => void; onChanged: () => Promise<void>; onFind: (key: string) => void; onOpen: (id: string) => void } & GenerateProps) {
  const api = useMemo(() => hostApi(), []);
  /** Example items have a short invented history and no files: nothing to compare and nothing to restore. */
  const isExample = exampleRevs !== undefined;
  const [revs, setRevs] = useState<Rev[] | null>(null);
  const [sel, setSel] = useState<number>(item.rev);
  const [diff, setDiff] = useState<FileDiff[] | null>(null);
  const [pol, setPol] = useState<RevisionPolicy | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const loadRevs = useCallback(async () => {
    if (exampleRevs) { setRevs(exampleRevs); setSel(exampleRevs[0]?.rev ?? 0); return; }
    if (!api) { setRevs([]); return; }
    try { const r = await loadHistory(api, item.id); setRevs(r); setSel(r[0]?.rev ?? 0); } catch (e) { setNote(msg(e)); setRevs([]); }
  }, [api, exampleRevs, item.id]);
  useEffect(() => { void loadRevs(); }, [loadRevs, item.rev]);

  // The differences of the chosen revision to the one before it.
  useEffect(() => {
    let live = true;
    setDiff(null); setPol(null);
    if (!sel) return;
    if (isExample || !api) { setDiff([]); return; }
    (async () => {
      try {
        const nowFiles = await loadRevFiles(api, item.id, sel);
        const before: RevFile[] = sel > 1 ? await loadRevFiles(api, item.id, sel - 1) : [];
        if (live) { setDiff(diffRevisions(before, nowFiles)); setPol(revisionPolicy(before, nowFiles)); }
      } catch (e) { if (live) { setDiff([]); setPol(null); setNote(msg(e)); } }
    })();
    return () => { live = false; };
  }, [api, isExample, item.id, sel]);

  const same = (item.refs[0] ? itemsForRef(all, item.refs[0].source, item.refs[0].key) : []).filter((i) => i.id !== item.id);
  const restore = async () => {
    if (!api) return;
    if (!window.confirm(`Restore revision ${sel} of "${item.name}" as the newest revision? Nothing is deleted; the history keeps every revision.`)) return;
    setBusy(true); setNote('');
    try { const rev = await restoreRevision(api, item, sel); setNote(`Revision ${sel} is now revision ${rev}.`); await onChanged(); } catch (e) { setNote(msg(e)); } finally { setBusy(false); }
  };

  return (
    <aside className="sh-card rg-detail" aria-label={`History of ${item.name}`}>
      <div className="rg-detail-head">
        <div>
          <h2>{item.name}</h2>
          <p className="sh-note"><span className={`rg-type rg-type-${item.type}`}>{TYPE_LABEL[item.type]}</span> · {item.owner || 'no owner'} · revision {item.rev}{stageText(item) ? ` · ${stageText(item)}` : ''}{item.archived ? ' · archived' : ''}</p>
        </div>
        <button onClick={onClose} aria-label="Close the history">✕</button>
      </div>

      {(item.refs.length > 0 || item.extendsItem) && (
        <div className="rg-links">
          {item.extendsItem && <span className="rg-chip">extends {item.extendsItem.name}</span>}
          {item.refs.map((r) => (
            <span key={`${r.source}:${r.key}`} className="rg-chip" title={r.title}>
              <button onClick={() => onFind(r.key)} aria-label={`Show everything from ${r.key}`}>{r.key}</button>
              {r.url && <a href={r.url} target="_blank" rel="noreferrer" aria-label={`Open ${r.key} in ${r.source}`}>↗</a>}
            </span>
          ))}
        </div>
      )}
      {same.length > 0 && <p className="sh-note">Same source: {same.map((i) => i.name).join(', ')}</p>}

      <CardPanel key={`${item.id}:${item.rev}`} item={item} all={all} profile={profile} now={now} example={isExample} onOpen={onOpen} onSaved={async (text) => { setNote(text); await onChanged(); }} />

      {generate && !isExample && !item.archived && item.type !== 'code' && ticketsOf(item).length > 0 && <JiraPanel item={item} generate={generate} onStop={onStop} ready={Boolean(ready)} />}

      {item.type === 'feature' && api && !isExample && <FeaturePanel item={item} api={api} onSaved={async (text) => { setNote(text); await onChanged(); }} />}

      <h3 className="rg-h">History</h3>
      {revs === null ? <p className="sh-note">Loading…</p> : (
        <ol className="rg-timeline">
          {revs.map((r) => (
            <li key={r.rev} className={r.rev === sel ? 'rg-rev-on' : ''}>
              <button onClick={() => setSel(r.rev)} aria-pressed={r.rev === sel}>
                <b>Rev {r.rev}{r.rev === item.rev ? ' · current' : ''}</b>
                <span>{r.note || 'Saved'}</span>
                <small>{r.author} · {when(r.at)} · {r.files} file{r.files === 1 ? '' : 's'}</small>
              </button>
            </li>
          ))}
        </ol>
      )}

      {sel > 0 && item.type !== 'feature' && item.type !== 'code' && pol && (pol.policy || pol.note) && <PolicyPanel rev={sel} pol={pol} />}

      {sel > 0 && (
        <>
          <h3 className="rg-h">What changed in revision {sel}{sel > 1 ? ` (compared with ${sel - 1})` : ''}</h3>
          {isExample ? <p className="sh-note">Example history: no files are kept for example items, so there is nothing to compare or restore.</p> : diff === null ? <p className="sh-note">Loading…</p> : diff.filter((d) => d.status !== 'same').length === 0 ? <p className="sh-note">No file changed.</p> : (
            <div className="rg-diffs">
              {diff.filter((d) => d.status !== 'same').map((d) => (
                <details key={d.path} open={d.status === 'changed' && diff.length <= 3}>
                  <summary><code>{d.path}</code> <span className={`rg-st rg-st-${d.status}`}>{d.status}</span></summary>
                  {d.lines.length > 0 && <pre className="rg-diff">{d.lines.map((l, i) => <span key={i} className={`rg-l rg-l-${l.t === '+' ? 'add' : l.t === '-' ? 'del' : l.t === '…' ? 'gap' : 'eq'}`}>{l.t === '…' ? `… ${l.s}` : `${l.t} ${l.s}`}{'\n'}</span>)}</pre>}
                </details>
              ))}
            </div>
          )}
          {sel !== item.rev && !isExample && <button className="sh-primary rg-restore" onClick={() => void restore()} disabled={busy}>Restore revision {sel} as the newest</button>}
        </>
      )}
      {note && <p className="sh-note" role="status">{note}</p>}
    </aside>
  );
}

/**
 * What the revision declares it may do (policy.json, derived from the project) and what became wider or narrower since the revision
 * before. Declared, not enforced: nothing here stops an action. Undeclared limits are named as gaps, never shown as limits.
 */
function PolicyPanel({ rev, pol }: { rev: number; pol: RevisionPolicy }) {
  const m = pol.policy;
  if (!m) return <><h3 className="rg-h">Declared rights</h3><p className="sh-note">{pol.note}</p></>;
  const gaps = policyGaps(m);
  const wider = widens(pol.changes);
  return (
    <section className="rg-policy" aria-label={`Declared rights of revision ${rev}`}>
      <h3 className="rg-h">Declared rights in revision {rev}</h3>
      <p className="rg-pol-line">
        <span className="rg-chip">{MODE_LABEL[m.mode]}</span>
        <span className="rg-chip">{m.humanApproval ? 'A person approves changes' : 'No approval step'}</span>
        <span className="rg-chip">{m.run.unattended ? 'Can run without a person' : 'Started by a person'}</span>
        {m.limits.maxSteps !== null && <span className="rg-chip">Up to {m.limits.maxSteps} steps</span>}
      </p>
      <p className="sh-note">{m.systems.length ? `Systems: ${m.systems.map((s) => `${s.label} (${s.access})`).join(', ')}` : 'No systems named.'}</p>
      {gaps.length > 0 && <p className="sh-note">Not declared yet: {gaps.join(', ')}. These are not limits.</p>}
      {pol.note && <p className="sh-note">{pol.note}</p>}
      {pol.changes.length > 0 && (
        <>
          <p className={`rg-pol-head${wider ? ' rg-pol-wider' : ''}`}>{wider ? 'This revision gives the item more room' : 'Rights changed in this revision'}</p>
          <ul className="rg-pol-list">
            {pol.changes.map((c) => (
              <li key={c.field} className={`rg-pol-${c.direction}`}>
                <b>{c.direction === 'wider' ? '↑ wider' : c.direction === 'narrower' ? '↓ narrower' : 'changed'}</b> {c.label}: {c.from} → {c.to}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** A feature has no definition to restore from the list: its events are stage changes and links. */
function FeaturePanel({ item, api, onSaved }: { item: RItem; api: NonNullable<ReturnType<typeof hostApi>>; onSaved: (text: string) => Promise<void> }) {
  const [stage, setStageState] = useState<FlowStep>((FLOW as readonly string[]).includes(item.stage) ? (item.stage as FlowStep) : 'intent');
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async (change: (doc: NonNullable<ReturnType<typeof parseFeature>>) => { doc: ReturnType<typeof parseFeature>; note: string }) => {
    setBusy(true); setProblem('');
    try {
      const cur = await api.call('get_work_item', { id: item.id, include_content: true });
      const doc = parseFeature(cur?.files ?? []);
      if (!doc) throw new Error('This item is not a feature of the Werkbank.');
      const out = change(doc);
      if (!out.doc) throw new Error(out.note);
      await api.call('save_work_item', keepCard(featureArgs(out.doc, { id: item.id, expectedRev: Number(cur.current_rev) || item.rev, note: out.note }), cur?.files ?? []));
      setLabel(''); setUrl('');
      await onSaved(out.note);
    } catch (e) { setProblem(msg(e)); } finally { setBusy(false); }
  };

  return (
    <div className="rg-feature">
      <div className="rg-frow">
        <label>Stage
          <select value={stage} onChange={(e) => setStageState(e.target.value as FlowStep)}>
            {FLOW.map((s) => <option key={s} value={s}>{FLOW_LABEL[s]}</option>)}
          </select>
        </label>
        <button disabled={busy || stage === item.stage} onClick={() => void save((d) => ({ doc: setStage(d, stage), note: `Stage: ${FLOW_LABEL[stage]}` }))}>Save stage</button>
      </div>
      <div className="rg-frow">
        <label>Link
          <input aria-label="Link label" placeholder="Label (e.g. PR 181)" value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label className="rg-grow">Address
          <input aria-label="Link address" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
        <button disabled={busy || !url.trim()} onClick={() => void save((d) => { const next = addLink(d, label, url); return next ? { doc: next, note: `Link added: ${label.trim() || url.trim()}`.slice(0, 300) } : { doc: null, note: 'Enter a full http(s) address that is not in the list yet.' }; })}>Add link</button>
      </div>
      {problem && <p className="rg-error" role="alert">{problem}</p>}
    </div>
  );
}

/**
 * Note this entry on the Jira tickets it came from: one label and one comment. Two steps on purpose: first the exact text and the
 * tickets are shown, only the second click lets the agent write. The agent may use three Jira tools and touch only these tickets.
 */
function JiraPanel({ item, generate, onStop, ready }: { item: RItem; generate: NonNullable<GenerateProps['generate']>; onStop?: () => void; ready: boolean }) {
  const tickets = ticketsOf(item);
  const [log, setLog] = useState(() => loadLog(window.localStorage));
  const [picked, setPicked] = useState<string[]>(() => tickets.map((t) => t.key).filter((k) => !notedAt(loadLog(window.localStorage), item.id, k)));
  const [edited, setEdited] = useState<string | null>(null);
  const [step, setStep] = useState<'idle' | 'confirm' | 'running'>('idle');
  const [results, setResults] = useState<WriteResult[] | null>(null);
  const [problem, setProblem] = useState('');
  const comment = edited ?? commentFor(item);
  const labels = labelsFor(item);
  const valid = comment.startsWith(markerOf(item)) && comment.length <= 2000;

  const write = async () => {
    setStep('running'); setProblem(''); setResults(null);
    try {
      const text = await generate(writebackPrompt(picked, labels, comment), 'Note on Jira', 'jira-writeback');
      if (!text) { setProblem('Stopped. Some tickets may already have been changed; the agent skips what is already there when you try again.'); return; }
      const got = parseWriteback(text, picked);
      if (!got) { setProblem('The answer could not be read. Check the tickets in Jira before you try again.'); return; }
      setResults(got);
      const next = record(log, item.id, item.rev, got);
      setLog(next); saveLog(window.localStorage, next);
      setPicked((cur) => cur.filter((k) => !got.some((r) => r.key === k && isDone(r))));
    } catch (e) { setProblem(msg(e)); } finally { setStep('idle'); }
  };

  return (
    <section className="rg-jira" aria-label="Note on Jira">
      <h3 className="rg-h">Note on Jira</h3>
      <div className="rg-jira-tickets">
        {tickets.map((t) => {
          const was = notedAt(log, item.id, t.key);
          return (
            <label key={t.key} title={t.title}>
              <input type="checkbox" checked={picked.includes(t.key)} disabled={step !== 'idle'} onChange={() => setPicked((cur) => (cur.includes(t.key) ? cur.filter((k) => k !== t.key) : [...cur, t.key]))} />
              {t.key}{was && <small>noted {when(was.at)} (rev {was.rev})</small>}
            </label>
          );
        })}
      </div>
      {step === 'idle' && (
        <button className="sh-primary" disabled={!ready || picked.length === 0} onClick={() => { setResults(null); setProblem(''); setStep('confirm'); }}>Review the note for {picked.length} ticket{picked.length === 1 ? '' : 's'}…</button>
      )}
      {!ready && <small className="sh-note">The agent is not connected yet.</small>}
      {step !== 'idle' && (
        <div className="rg-jira-confirm">
          <p className="sx-cwarn" role="alert">This changes Jira. Label {labels.join(', ')} and this comment are added to {picked.join(', ')}. Nothing else is touched.</p>
          <textarea aria-label="Comment for Jira" rows={6} value={comment} disabled={step === 'running'} onChange={(e) => setEdited(e.target.value)} />
          {!valid && <small className="sx-cwarn">The comment has to start with {markerOf(item)} (it tells the next run that this ticket was noted already) and stay under 2000 characters.</small>}
          <div className="sh-bulk">
            {step === 'running'
              ? <button onClick={onStop}>Stop</button>
              : <><button className="sh-primary" onClick={() => void write()} disabled={!valid || picked.length === 0}>Write to Jira</button><button onClick={() => setStep('idle')}>Cancel</button></>}
            {step === 'running' && <span className="sh-note">Writing…</span>}
          </div>
        </div>
      )}
      {results && (
        <div role="status">
          <p className="sh-note">{summaryOf(results)}</p>
          <ul className="rg-jira-results">{results.map((r) => <li key={r.key}><b>{r.key}</b> {isDone(r) ? 'noted' : 'not done'}{r.skipped ? ` · ${r.skipped}` : ''}{r.error ? ` · ${r.error}` : ''}</li>)}</ul>
        </div>
      )}
      {problem && <p className="rg-error" role="alert">{problem}</p>}
    </section>
  );
}
