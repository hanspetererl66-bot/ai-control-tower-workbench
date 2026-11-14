import AdminHero from './AdminHero';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { SkillSource } from '../skill-health-db';
import {
  HEALTH_LABEL, LEVEL_NAMES, PROPOSAL_LABEL, act, applyProposal, clusters, daysSince, dismiss, healthOf, metrics, proposals, reviewDue,
  type ActionKind, type Catalog, type CSkill, type Health, type Policy, type Proposal,
} from '../skill-health';

type Tab = 'overview' | 'actions' | 'duplicates' | 'catalog' | 'policy';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' }, { id: 'actions', label: 'Actions' }, { id: 'duplicates', label: 'Duplicates' }, { id: 'catalog', label: 'Catalog' }, { id: 'policy', label: 'Policy & log' },
];
const pct = (x: number) => `${Math.round(x * 100)} %`;
const date = (t: number | null | undefined) => (t ? new Date(t).toLocaleDateString([], { day: '2-digit', month: 'short', year: '2-digit' }) : '–');
const ago = (t: number | null | undefined, now: number) => (t == null ? 'never' : `${daysSince(t, now)} d ago`);
const HEALTH_ORDER: Health[] = ['active', 'rare', 'unused', 'orphan', 'broken', 'deprecated', 'retired'];

/** What the detail panel shows: one skill, or the group of skills behind a number. */
type Detail = { title: string; note?: string; skills: CSkill[] };
type OnDetail = (d: Detail) => void;
const HINT = 'Double-click a number, a row or a bar for the details.';

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A number that counts up to its value (and from the old value to a new one). Text without a leading number is shown as it is. */
function useCountUp(text: string): string {
  const m = /^(\d+)(.*)$/.exec(text);
  const target = m ? Number(m[1]) : null;
  const from = useRef<number>(0);
  const [n, setN] = useState<number | null>(() => (target == null || reducedMotion() ? target : 0));
  useEffect(() => {
    if (target == null) return;
    if (reducedMotion() || from.current === target) { from.current = target; setN(target); return; }
    const start = from.current; const t0 = performance.now(); let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / 700);
      setN(Math.round(start + (target - start) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step); else from.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); from.current = target; };
  }, [target]);
  return m ? `${n ?? target}${m[2]}` : text;
}

/** Share of the catalog in use, as a ring in the header. */
function Ring({ share }: { share: number }) {
  const r = 26; const c = 2 * Math.PI * r; const s = Math.max(0, Math.min(1, share));
  return (
    <svg className="sh-ring" viewBox="0 0 64 64" role="img" aria-label={`${Math.round(s * 100)} % of the skills are in use`}>
      <circle className="sh-ring-bg" cx="32" cy="32" r={r} />
      <circle className="sh-ring-prog" cx="32" cy="32" r={r} strokeDasharray={`${(c * s).toFixed(1)} ${c.toFixed(1)}`} transform="rotate(-90 32 32)" />
      <text x="32" y="37" textAnchor="middle">{Math.round(s * 100)}%</text>
    </svg>
  );
}

export default function SkillHealthView({ catalog, actor, onCatalog, onBack, onResetExamples, source, onReload }: {
  catalog: Catalog;
  actor: string;
  onCatalog: (next: Catalog) => void;
  onBack: () => void;
  onResetExamples: () => void;
  source: SkillSource;
  onReload: () => void;
}) {
  const [tab, setTab] = useState<Tab>('overview');
  const [now] = useState(() => Date.now());
  const m = useMemo(() => metrics(catalog, now), [catalog, now]);
  const open = useMemo(() => proposals(catalog, now), [catalog, now]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const health = useMemo(() => new Map(catalog.skills.map((s) => [s.id, healthOf(s, catalog, now)])), [catalog, now]);
  useEffect(() => {
    if (!detail) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDetail(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detail]);

  return (
    <main className="sh">
      <AdminHero screen="Skill Health Monitor" lead="See which skills earn their place," accent="and which should go." onBack={onBack} backLabel="Back to the Admin console"
        lede={`${m.total} skills in the catalog · ${m.live} in use · ${m.openProposals} proposals waiting`}>
        <Ring share={m.total ? m.live / m.total : 0} />
      </AdminHero>
      <div className={`sh-source sh-source-${source.kind}`} role="status">
        <span>
          {source.kind === 'database' ? 'Live data from the shared database. Phase out, retire and restore are saved there; reviews, reminders and owner changes stay on this computer.'
            : source.kind === 'offline' ? 'Database not reachable: this is the last stored copy.' : 'Example data: the numbers are invented.'}
          {source.detail ? ` ${source.detail}` : ''}
        </span>
        <button onClick={onReload}>Reload</button>
      </div>
      <nav className="sh-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'sh-tab-on' : ''} onClick={() => setTab(t.id)}>
            {t.label}{t.id === 'actions' && open.length > 0 && <span className="sh-count">{open.length}</span>}
          </button>
        ))}
      </nav>
      {tab === 'overview' && <Overview m={m} catalog={catalog} now={now} onTab={setTab} health={health} onDetail={setDetail} />}
      {tab === 'actions' && <Actions open={open} catalog={catalog} now={now} actor={actor} onCatalog={onCatalog} onDetail={setDetail} />}
      {tab === 'duplicates' && <Duplicates catalog={catalog} now={now} actor={actor} onCatalog={onCatalog} onDetail={setDetail} />}
      {tab === 'catalog' && <CatalogTab catalog={catalog} now={now} actor={actor} onCatalog={onCatalog} onDetail={setDetail} />}
      {tab === 'policy' && <PolicyTab catalog={catalog} onCatalog={onCatalog} onResetExamples={onResetExamples} />}
      {detail && <DetailPanel detail={detail} catalog={catalog} health={health} now={now} onClose={() => setDetail(null)} onDetail={setDetail} />}
    </main>
  );
}

function Tile({ label, value, hint, tone, onClick, onDouble, i = 0 }: { label: string; value: string; hint?: string; tone?: 'good' | 'warn' | 'bad'; onClick?: () => void; onDouble?: () => void; i?: number }) {
  const shown = useCountUp(value);
  const body = <><span className="sh-tile-v">{shown}</span><span className="sh-tile-l">{label}</span>{hint && <span className="sh-tile-h">{hint}</span>}</>;
  // A single click opens the tab after a short wait, so that a double-click can show the details instead of leaving the page.
  const timer = useRef<number | undefined>(undefined);
  const single = () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => onClick?.(), onDouble ? 260 : 0); };
  const double = () => { window.clearTimeout(timer.current); onDouble?.(); };
  const style = { '--i': i } as CSSProperties;
  return onClick ? <button className={`sh-tile sh-tone-${tone ?? 'none'}`} style={style} onClick={single} onDoubleClick={double}>{body}</button> : <div className={`sh-tile sh-tone-${tone ?? 'none'} ${onDouble ? 'sh-dbl' : ''}`} style={style} onDoubleClick={onDouble}>{body}</div>;
}

function Overview({ m, catalog, now, onTab, health, onDetail }: { m: ReturnType<typeof metrics>; catalog: Catalog; now: number; onTab: (t: Tab) => void; health: Map<string, Health>; onDetail: OnDetail }) {
  const max = Math.max(1, ...HEALTH_ORDER.map((h) => m.byHealth[h]));
  const by = (...hs: Health[]) => catalog.skills.filter((s) => hs.includes(health.get(s.id)!));
  const dupes = clusters(catalog).flatMap((c) => c.ids.filter((i) => i !== c.master)).map((i) => catalog.skills.find((s) => s.id === i)).filter((s): s is CSkill => !!s);
  const groups = {
    live: { title: 'Skills in use', skills: by('active', 'rare', 'unused', 'orphan', 'broken').filter((s) => s.uses30 > 0) },
    dup: { title: 'Duplicates: skills that could go', note: 'The best skill of each group stays; these do almost the same.', skills: dupes },
    unused: { title: 'Unused or rare', skills: by('unused', 'rare') },
    orphan: { title: 'No owner', note: 'The owner left the company.', skills: by('orphan') },
    broken: { title: 'Broken', note: 'These skills need a connector that does not exist (any more).', skills: by('broken') },
    due: { title: 'Confirmation due', skills: catalog.skills.filter((s) => reviewDue(s, catalog, now)) },
    runs: { title: 'Most runs, last 30 days', skills: [...catalog.skills].sort((a, b) => b.uses30 - a.uses30).slice(0, 12) },
  };
  return (
    <div className="sh-body">
      <p className="sh-note">{HINT}</p>
      <div className="sh-tiles">
        <Tile i={0} label="Skills in use" value={String(m.live)} hint={`of ${m.total} in the catalog`} onDouble={() => onDetail(groups.live)} />
        <Tile i={1} label="Duplicates" value={pct(m.duplicateRate)} hint={`${m.duplicateSkills} skills could go`} tone={m.duplicateRate > 0.2 ? 'bad' : m.duplicateRate > 0.1 ? 'warn' : 'good'} onClick={() => onTab('duplicates')} onDouble={() => onDetail(groups.dup)} />
        <Tile i={2} label="Unused or rare" value={pct(m.unusedShare)} hint={`limit ${catalog.policy.unusedDays} days`} tone={m.unusedShare > 0.3 ? 'bad' : m.unusedShare > 0.15 ? 'warn' : 'good'} onClick={() => onTab('catalog')} onDouble={() => onDetail(groups.unused)} />
        <Tile i={3} label="No owner" value={String(m.byHealth.orphan)} hint="owner left the company" tone={m.byHealth.orphan ? 'warn' : 'good'} onClick={() => onTab('actions')} onDouble={() => onDetail(groups.orphan)} />
        <Tile i={4} label="Broken" value={String(m.byHealth.broken)} hint="needs a missing connector" tone={m.byHealth.broken ? 'bad' : 'good'} onClick={() => onTab('actions')} onDouble={() => onDetail(groups.broken)} />
        <Tile i={5} label="Confirmation due" value={String(m.reviewDue)} hint={`every ${catalog.policy.reviewDays} days`} tone={m.reviewDue ? 'warn' : 'good'} onDouble={() => onDetail(groups.due)} />
        <Tile i={6} label="Runs, last 30 days" value={String(m.runs30)} hint={`${pct(m.avgSuccess)} succeeded`} onDouble={() => onDetail(groups.runs)} />
        <Tile i={7} label="Open proposals" value={String(m.openProposals)} hint={`could remove ${m.potential} skills`} tone={m.openProposals ? 'warn' : 'good'} onClick={() => onTab('actions')} />
      </div>
      <div className="sh-cols">
        <section className="sh-card">
          <h2>Health of all skills</h2>
          <div className="sh-band" role="img" aria-label={HEALTH_ORDER.filter((x) => m.byHealth[x] > 0).map((x) => `${HEALTH_LABEL[x]} ${m.byHealth[x]}`).join(', ')}>
            {HEALTH_ORDER.filter((x) => m.byHealth[x] > 0).map((x) => <span key={x} className={`sh-seg sh-h-${x}`} style={{ flexGrow: m.byHealth[x] }} title={`${HEALTH_LABEL[x]}: ${m.byHealth[x]}`} />)}
          </div>
          {HEALTH_ORDER.map((h, idx) => (
            <div className="sh-bar sh-dbl" key={h} title="Double-click for the skills" onDoubleClick={() => onDetail({ title: HEALTH_LABEL[h], skills: by(h) })}><span>{HEALTH_LABEL[h]}</span><i className={`sh-fill sh-h-${h}`} style={{ width: `${(m.byHealth[h] / max) * 100}%`, '--i': idx } as CSSProperties} /><b>{m.byHealth[h]}</b></div>
          ))}
        </section>
        <section className="sh-card">
          <h2>By department</h2>
          <table className="sh-table"><thead><tr><th>Department</th><th>Skills</th><th>In use</th><th>Unused / rare</th><th>Duplicates</th><th>Runs 30 d</th></tr></thead>
            <tbody>{m.byDepartment.map((d) => <tr key={d.department} className="sh-dbl" title="Double-click for the skills" onDoubleClick={() => onDetail({ title: d.department, skills: catalog.skills.filter((s) => s.department === d.department) })}><td>{d.department}</td><td>{d.total}</td><td>{d.live}</td><td>{d.unused}</td><td>{d.duplicates}</td><td>{d.uses30}</td></tr>)}</tbody></table>
        </section>
      </div>
      <div className="sh-cols">
        <section className="sh-card"><h2>Most used (30 days)</h2><SkillList list={m.top} onDetail={onDetail} value={(s) => `${s.uses30} runs · ${s.users90} people`} /></section>
        <section className="sh-card"><h2>Least used</h2><SkillList list={m.flop} onDetail={onDetail} value={(s) => `${s.uses90} runs in 90 d · last ${ago(s.lastUsed, now)}`} /></section>
      </div>
    </div>
  );
}

function SkillList({ list, value, onDetail }: { list: CSkill[]; value: (s: CSkill) => string; onDetail: OnDetail }) {
  return <ul className="sh-list">{list.map((s) => <li key={s.id} className="sh-dbl" title="Double-click for the details" onDoubleClick={() => onDetail({ title: s.name, skills: [s] })}><span>{s.name}<small>{s.department} · {LEVEL_NAMES[s.level]}</small></span><em>{value(s)}</em></li>)}</ul>;
}

function Actions({ open, catalog, now, actor, onCatalog, onDetail }: { open: Proposal[]; catalog: Catalog; now: number; actor: string; onCatalog: (c: Catalog) => void; onDetail: OnDetail }) {
  const [sel, setSel] = useState<string[]>([]);
  const [kind, setKind] = useState<'all' | Proposal['kind']>('all');
  const shown = open.filter((p) => kind === 'all' || p.kind === kind);
  const kinds = [...new Set(open.map((p) => p.kind))];
  const chosen = shown.filter((p) => sel.includes(p.id));
  const apply = (list: Proposal[]) => { onCatalog(list.reduce((c, p) => applyProposal(c, p, now, actor), catalog)); setSel([]); };
  if (open.length === 0) return <div className="sh-body"><p className="sh-empty">Nothing to do. All skills are healthy under the current policy.</p></div>;
  return (
    <div className="sh-body">
      <p className="sh-note">Each proposal is only a suggestion. Nothing happens until you confirm it, and every change goes into the log. {HINT}</p>
      <div className="sh-bulk">
        <select value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); setSel([]); }} aria-label="Type of proposal">
          <option value="all">All types ({open.length})</option>
          {kinds.map((k) => <option key={k} value={k}>{PROPOSAL_LABEL[k]} ({open.filter((p) => p.kind === k).length})</option>)}
        </select>
        <button onClick={() => setSel(sel.length === shown.length ? [] : shown.map((p) => p.id))}>{sel.length === shown.length ? 'Select none' : 'Select all'}</button>
        <button className="sh-primary" disabled={chosen.length === 0} onClick={() => apply(chosen)}>Confirm {chosen.length || ''} selected</button>
      </div>
      <ul className="sh-props">
        {shown.map((p) => (
          <li key={p.id} className="sh-dbl" title="Double-click for the details" onDoubleClick={() => onDetail({ title: p.title, note: p.detail, skills: p.ids.map((i) => catalog.skills.find((x) => x.id === i)).filter((x): x is CSkill => !!x) })}>
            <input type="checkbox" checked={sel.includes(p.id)} onChange={() => setSel(sel.includes(p.id) ? sel.filter((x) => x !== p.id) : [...sel, p.id])} aria-label={`Select ${p.title}`} />
            <div><span className={`sh-kind sh-kind-${p.kind}`}>{PROPOSAL_LABEL[p.kind]}</span><strong>{p.title}</strong><p>{p.detail}</p></div>
            <span className="sh-row-actions"><button className="sh-primary" onClick={() => apply([p])}>Confirm</button><button onClick={() => onCatalog(dismiss(catalog, p.id))}>Not now</button></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Duplicates({ catalog, now, actor, onCatalog, onDetail }: { catalog: Catalog; now: number; actor: string; onCatalog: (c: Catalog) => void; onDetail: OnDetail }) {
  const list = useMemo(() => clusters(catalog), [catalog]);
  const [master, setMaster] = useState<Record<string, string>>({});
  const byId = new Map(catalog.skills.map((s) => [s.id, s]));
  if (list.length === 0) return <div className="sh-body"><p className="sh-empty">No similar skills found at a similarity of {pct(catalog.policy.similarity)}.</p></div>;
  return (
    <div className="sh-body">
      <p className="sh-note">Skills that do almost the same. Pick the one to keep; the others are phased out and point to it. The similarity limit is in Policy. {HINT}</p>
      {list.map((c) => {
        const keep = master[c.key] ?? c.master;
        return (
          <section className="sh-card" key={c.key}>
            <h2 className="sh-dbl" title="Double-click to compare all of them" onDoubleClick={() => onDetail({ title: `${c.ids.length} similar skills`, note: `Similarity ${pct(c.score)}. Suggested to keep: ${byId.get(c.master)?.name ?? ''}.`, skills: c.ids.map((i) => byId.get(i)).filter((x): x is CSkill => !!x) })}>{c.ids.length} similar skills <small>similarity {pct(c.score)}</small></h2>
            <table className="sh-table"><thead><tr><th>Keep</th><th>Skill</th><th>Owner</th><th>Level</th><th>Runs 90 d</th><th>People</th><th>Success</th><th>Last used</th></tr></thead>
              <tbody>{c.ids.map((id) => { const s = byId.get(id)!; return (
                <tr key={id} className={`sh-dbl ${id === keep ? 'sh-keep' : ''}`} title="Double-click for the details" onDoubleClick={() => onDetail({ title: s.name, skills: [s] })}>
                  <td><input type="radio" name={c.key} checked={id === keep} onChange={() => setMaster({ ...master, [c.key]: id })} aria-label={`Keep ${s.name}`} /></td>
                  <td>{s.name}<small>{s.description}</small></td><td>{s.owner.split('@')[0]}</td><td>{LEVEL_NAMES[s.level]}</td><td>{s.uses90}</td><td>{s.users90}</td><td>{pct(s.success)}</td><td>{ago(s.lastUsed, now)}</td>
                </tr>); })}</tbody></table>
            <div className="sh-bulk">
              <button className="sh-primary" onClick={() => onCatalog(act(catalog, 'deprecate', c.ids.filter((i) => i !== keep), { replacedBy: keep }, now, actor))}>Merge into "{byId.get(keep)?.name}"</button>
              <button onClick={() => onCatalog(dismiss(catalog, c.key))}>Not duplicates</button>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function CatalogTab({ catalog, now, actor, onCatalog, onDetail }: { catalog: Catalog; now: number; actor: string; onCatalog: (c: Catalog) => void; onDetail: OnDetail }) {
  const [q, setQ] = useState('');
  const [h, setH] = useState<'all' | Health>('all');
  const [dept, setDept] = useState('all');
  const [sort, setSort] = useState<'name' | 'uses' | 'last'>('name');
  const [sel, setSel] = useState<string[]>([]);
  const [owner, setOwner] = useState('');
  const health = useMemo(() => new Map(catalog.skills.map((s) => [s.id, healthOf(s, catalog, now)])), [catalog, now]);
  const depts = [...new Set(catalog.skills.map((s) => s.department))].sort();
  const rows = catalog.skills.filter((s) => (h === 'all' || health.get(s.id) === h) && (dept === 'all' || s.department === dept) && (!q || `${s.name} ${s.description} ${s.owner}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => sort === 'uses' ? b.uses90 - a.uses90 : sort === 'last' ? (a.lastUsed ?? 0) - (b.lastUsed ?? 0) : a.name.localeCompare(b.name));
  const shown = rows.slice(0, 200);
  const run = (kind: ActionKind, opt = {}) => { onCatalog(act(catalog, kind, sel, opt, now, actor)); setSel([]); };
  return (
    <div className="sh-body">
      <div className="sh-bulk">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, description, owner" aria-label="Search" />
        <select value={h} onChange={(e) => setH(e.target.value as typeof h)} aria-label="Health"><option value="all">All states</option>{HEALTH_ORDER.map((x) => <option key={x} value={x}>{HEALTH_LABEL[x]}</option>)}</select>
        <select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department"><option value="all">All departments</option>{depts.map((d) => <option key={d} value={d}>{d}</option>)}</select>
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort"><option value="name">Sort: name</option><option value="uses">Sort: most runs</option><option value="last">Sort: longest unused</option></select>
      </div>
      <div className="sh-bulk sh-bar-actions">
        <span>{sel.length} selected</span>
        <button disabled={!sel.length} onClick={() => run('deprecate')}>Phase out</button>
        <button disabled={!sel.length} onClick={() => run('retire')}>Retire</button>
        <button disabled={!sel.length} onClick={() => run('restore')}>Restore</button>
        <button disabled={!sel.length} onClick={() => run('review')}>Mark as reviewed</button>
        <button disabled={!sel.length} onClick={() => run('remind')}>Ask owner to confirm</button>
        <button disabled={!sel.length} onClick={() => run('promote')}>Request next level</button>
        <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="new owner (e-mail)" aria-label="New owner" />
        <button disabled={!sel.length || !owner.includes('@')} onClick={() => { run('reassign', { owner: owner.trim() }); setOwner(''); }}>Reassign</button>
      </div>
      <div className="sh-scroll">
        <table className="sh-table">
          <thead><tr><th><input type="checkbox" aria-label="Select all shown" checked={shown.length > 0 && shown.every((s) => sel.includes(s.id))} onChange={() => setSel(shown.every((s) => sel.includes(s.id)) ? [] : shown.map((s) => s.id))} /></th><th>Skill</th><th>State</th><th>Owner</th><th>Level</th><th>Runs 30 d</th><th>Runs 90 d</th><th>People</th><th>Last used</th><th>Confirmed</th></tr></thead>
          <tbody>
            {shown.map((s) => (
              <tr key={s.id} className="sh-dbl" title="Double-click for the details" onDoubleClick={() => onDetail({ title: s.name, skills: [s] })}>
                <td><input type="checkbox" checked={sel.includes(s.id)} onChange={() => setSel(sel.includes(s.id) ? sel.filter((x) => x !== s.id) : [...sel, s.id])} aria-label={`Select ${s.name}`} /></td>
                <td>{s.name}{s.example && <span className="sched-example">Example</span>}<small>{s.department}{s.replacedBy ? ` · replaced by ${catalog.skills.find((x) => x.id === s.replacedBy)?.name ?? '…'}` : ''}{s.sunsetAt && s.state === 'deprecated' ? ` · ends ${date(s.sunsetAt)}` : ''}{s.promotionRequested ? ` · ${LEVEL_NAMES[s.promotionRequested]} requested` : ''}</small></td>
                <td><span className={`sh-pill sh-h-${health.get(s.id)}`}>{HEALTH_LABEL[health.get(s.id)!]}</span></td>
                <td>{s.owner.split('@')[0]}</td><td>{LEVEL_NAMES[s.level]}</td><td>{s.uses30}</td><td>{s.uses90}</td><td>{s.users90}</td><td>{ago(s.lastUsed, now)}</td>
                <td className={reviewDue(s, catalog, now) ? 'sh-late' : ''}>{date(s.reviewedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="sh-note">{rows.length > shown.length ? `Showing the first ${shown.length} of ${rows.length}. Narrow the filter to see the rest.` : `${rows.length} skills`} {HINT}</p>
    </div>
  );
}

function PolicyTab({ catalog, onCatalog, onResetExamples }: { catalog: Catalog; onCatalog: (c: Catalog) => void; onResetExamples: () => void }) {
  const p = catalog.policy;
  const set = (patch: Partial<Policy>) => onCatalog({ ...catalog, policy: { ...p, ...patch } });
  const field = (key: keyof Policy, label: string, hint: string, step = 1) => (
    <label key={key}>{label}<input type="number" step={step} value={p[key]} onChange={(e) => set({ [key]: Number(e.target.value) } as Partial<Policy>)} /><small>{hint}</small></label>
  );
  return (
    <div className="sh-body">
      <div className="sh-cols">
        <section className="sh-card sh-policy">
          <h2>Policy</h2>
          {field('unusedDays', 'Unused after (days)', 'No run for this long = unused')}
          {field('rareUses', 'Rarely used below (runs in 90 days)', 'Fewer runs than this = rarely used')}
          {field('reviewDays', 'Owner confirms every (days)', 'Then the owner is asked; no answer after 14 days = phase out')}
          {field('sunsetDays', 'Phase-out period (days)', 'A phased-out skill still works for this long')}
          {field('similarity', 'Duplicate limit (0.3 to 0.95)', 'Lower finds more, but also more false matches', 0.05)}
          {field('promoteUsers', 'Offer next level from (people)', 'Distinct users in 90 days')}
          <p className="sh-note">Values are kept inside sensible limits.</p>
          <button onClick={onResetExamples}>Reset to example catalog</button>
        </section>
        <section className="sh-card">
          <h2>Log</h2>
          {catalog.log.length === 0 ? <p className="sh-empty">No changes yet.</p> : (
            <ul className="sh-log">{catalog.log.slice(0, 60).map((l) => (
              <li key={l.id}><b>{l.action}</b> · {l.ids.map((i) => catalog.skills.find((s) => s.id === i)?.name ?? i).slice(0, 3).join(', ')}{l.ids.length > 3 ? ` +${l.ids.length - 3}` : ''}<small>{new Date(l.at).toLocaleString()} · {l.actor}{l.note ? ` · ${l.note}` : ''}</small></li>
            ))}</ul>
          )}
        </section>
      </div>
    </div>
  );
}

const STATE_NOTE: Record<string, string> = { active: 'Active', deprecated: 'Being phased out', retired: 'Retired' };

/** The side panel: one skill with all its figures, or the skills behind a number. Escape or the scrim closes it. */
function DetailPanel({ detail, catalog, health, now, onClose, onDetail }: { detail: Detail; catalog: Catalog; health: Map<string, Health>; now: number; onClose: () => void; onDetail: OnDetail }) {
  const single = detail.skills.length === 1 ? detail.skills[0] : null;
  const similar = useMemo(() => {
    if (!single) return [] as CSkill[];
    const c = clusters(catalog).find((x) => x.ids.includes(single.id));
    return c ? c.ids.filter((i) => i !== single.id).map((i) => catalog.skills.find((x) => x.id === i)).filter((x): x is CSkill => !!x) : [];
  }, [single, catalog]);
  const replaced = single?.replacedBy ? catalog.skills.find((x) => x.id === single.replacedBy) : undefined;
  return (
    <>
      <div className="sh-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="sh-drawer" role="dialog" aria-label={detail.title}>
        <header>
          <div><h2>{detail.title}{single?.example && <span className="sched-example">Example</span>}</h2>{!single && <p>{detail.skills.length} {detail.skills.length === 1 ? 'skill' : 'skills'}</p>}</div>
          <button onClick={onClose} aria-label="Close">×</button>
        </header>
        {detail.note && <p className="sh-drawer-note">{detail.note}</p>}
        {single ? (
          <>
            <p className="sh-drawer-note">{single.description || 'No description.'}</p>
            <span className={`sh-pill sh-h-${health.get(single.id)}`}>{HEALTH_LABEL[health.get(single.id)!]}</span>
            <dl className="sh-facts">
              <dt>Level</dt><dd>{LEVEL_NAMES[single.level]}</dd>
              <dt>Department</dt><dd>{single.department}</dd>
              <dt>Owner</dt><dd>{single.owner || '–'}</dd>
              <dt>Created</dt><dd>{date(single.createdAt)}</dd>
              <dt>Last used</dt><dd>{ago(single.lastUsed, now)}</dd>
              <dt>Runs</dt><dd>{single.uses30} in 30 days · {single.uses90} in 90 days</dd>
              <dt>People</dt><dd>{single.users90} in 90 days</dd>
              <dt>Success</dt><dd>{pct(single.success)}</dd>
              <dt>Last confirmed</dt><dd>{date(single.reviewedAt)}</dd>
              <dt>Needs</dt><dd>{single.deps.length ? single.deps.map((d) => <code key={d} className={catalog.available.includes(d) ? '' : 'sh-late'}>{d}</code>) : 'no connector'}</dd>
              <dt>State</dt><dd>{STATE_NOTE[single.state] ?? single.state}{single.sunsetAt ? ` · until ${date(single.sunsetAt)}` : ''}{replaced ? ` · replaced by ${replaced.name}` : ''}</dd>
            </dl>
            {similar.length > 0 && (
              <>
                <h3>Does almost the same</h3>
                <ul className="sh-drawer-list">{similar.map((x) => <li key={x.id}><button onClick={() => onDetail({ title: x.name, skills: [x] })}>{x.name}<small>{x.department} · {x.uses90} runs in 90 d</small></button></li>)}</ul>
              </>
            )}
          </>
        ) : (
          <ul className="sh-drawer-list">
            {detail.skills.map((x) => (
              <li key={x.id}><button onClick={() => onDetail({ title: x.name, skills: [x] })}>
                <span>{x.name}{x.example && <span className="sched-example">Example</span>}<small>{x.department} · {LEVEL_NAMES[x.level]} · {x.owner.split('@')[0] || 'no owner'}</small></span>
                <span><span className={`sh-pill sh-h-${health.get(x.id)}`}>{HEALTH_LABEL[health.get(x.id)!]}</span><small>{x.uses30} runs / 30 d · last {ago(x.lastUsed, now)}</small></span>
              </button></li>
            ))}
            {detail.skills.length === 0 && <li className="sh-empty">Nothing in this group.</li>}
          </ul>
        )}
      </aside>
    </>
  );
}
