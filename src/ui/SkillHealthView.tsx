import { useMemo, useState } from 'react';
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

  return (
    <main className="sh">
      <header className="sh-head">
        <button className="sh-back" onClick={onBack} aria-label="Back">←</button>
        <div>
          <h1>Skill health</h1>
          <p>{m.total} skills in the catalog · {m.live} in use · {m.openProposals} proposals waiting</p>
        </div>
      </header>
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
      {tab === 'overview' && <Overview m={m} catalog={catalog} now={now} onTab={setTab} />}
      {tab === 'actions' && <Actions open={open} catalog={catalog} now={now} actor={actor} onCatalog={onCatalog} />}
      {tab === 'duplicates' && <Duplicates catalog={catalog} now={now} actor={actor} onCatalog={onCatalog} />}
      {tab === 'catalog' && <CatalogTab catalog={catalog} now={now} actor={actor} onCatalog={onCatalog} />}
      {tab === 'policy' && <PolicyTab catalog={catalog} onCatalog={onCatalog} onResetExamples={onResetExamples} />}
    </main>
  );
}

function Tile({ label, value, hint, tone, onClick }: { label: string; value: string; hint?: string; tone?: 'good' | 'warn' | 'bad'; onClick?: () => void }) {
  const body = <><span className="sh-tile-v">{value}</span><span className="sh-tile-l">{label}</span>{hint && <span className="sh-tile-h">{hint}</span>}</>;
  return onClick ? <button className={`sh-tile sh-tone-${tone ?? 'none'}`} onClick={onClick}>{body}</button> : <div className={`sh-tile sh-tone-${tone ?? 'none'}`}>{body}</div>;
}

function Overview({ m, catalog, now, onTab }: { m: ReturnType<typeof metrics>; catalog: Catalog; now: number; onTab: (t: Tab) => void }) {
  const max = Math.max(1, ...HEALTH_ORDER.map((h) => m.byHealth[h]));
  return (
    <div className="sh-body">
      <div className="sh-tiles">
        <Tile label="Skills in use" value={String(m.live)} hint={`of ${m.total} in the catalog`} />
        <Tile label="Duplicates" value={pct(m.duplicateRate)} hint={`${m.duplicateSkills} skills could go`} tone={m.duplicateRate > 0.2 ? 'bad' : m.duplicateRate > 0.1 ? 'warn' : 'good'} onClick={() => onTab('duplicates')} />
        <Tile label="Unused or rare" value={pct(m.unusedShare)} hint={`limit ${catalog.policy.unusedDays} days`} tone={m.unusedShare > 0.3 ? 'bad' : m.unusedShare > 0.15 ? 'warn' : 'good'} onClick={() => onTab('catalog')} />
        <Tile label="No owner" value={String(m.byHealth.orphan)} hint="owner left the company" tone={m.byHealth.orphan ? 'warn' : 'good'} onClick={() => onTab('actions')} />
        <Tile label="Broken" value={String(m.byHealth.broken)} hint="needs a missing connector" tone={m.byHealth.broken ? 'bad' : 'good'} onClick={() => onTab('actions')} />
        <Tile label="Confirmation due" value={String(m.reviewDue)} hint={`every ${catalog.policy.reviewDays} days`} tone={m.reviewDue ? 'warn' : 'good'} />
        <Tile label="Runs, last 30 days" value={String(m.runs30)} hint={`${pct(m.avgSuccess)} succeeded`} />
        <Tile label="Open proposals" value={String(m.openProposals)} hint={`could remove ${m.potential} skills`} tone={m.openProposals ? 'warn' : 'good'} onClick={() => onTab('actions')} />
      </div>
      <div className="sh-cols">
        <section className="sh-card">
          <h2>Health of all skills</h2>
          {HEALTH_ORDER.map((h) => (
            <div className="sh-bar" key={h}><span>{HEALTH_LABEL[h]}</span><i className={`sh-fill sh-h-${h}`} style={{ width: `${(m.byHealth[h] / max) * 100}%` }} /><b>{m.byHealth[h]}</b></div>
          ))}
        </section>
        <section className="sh-card">
          <h2>By department</h2>
          <table className="sh-table"><thead><tr><th>Department</th><th>Skills</th><th>In use</th><th>Unused / rare</th><th>Duplicates</th><th>Runs 30 d</th></tr></thead>
            <tbody>{m.byDepartment.map((d) => <tr key={d.department}><td>{d.department}</td><td>{d.total}</td><td>{d.live}</td><td>{d.unused}</td><td>{d.duplicates}</td><td>{d.uses30}</td></tr>)}</tbody></table>
        </section>
      </div>
      <div className="sh-cols">
        <section className="sh-card"><h2>Most used (30 days)</h2><SkillList list={m.top} value={(s) => `${s.uses30} runs · ${s.users90} people`} /></section>
        <section className="sh-card"><h2>Least used</h2><SkillList list={m.flop} value={(s) => `${s.uses90} runs in 90 d · last ${ago(s.lastUsed, now)}`} /></section>
      </div>
    </div>
  );
}

function SkillList({ list, value }: { list: CSkill[]; value: (s: CSkill) => string }) {
  return <ul className="sh-list">{list.map((s) => <li key={s.id}><span>{s.name}<small>{s.department} · {LEVEL_NAMES[s.level]}</small></span><em>{value(s)}</em></li>)}</ul>;
}

function Actions({ open, catalog, now, actor, onCatalog }: { open: Proposal[]; catalog: Catalog; now: number; actor: string; onCatalog: (c: Catalog) => void }) {
  const [sel, setSel] = useState<string[]>([]);
  const [kind, setKind] = useState<'all' | Proposal['kind']>('all');
  const shown = open.filter((p) => kind === 'all' || p.kind === kind);
  const kinds = [...new Set(open.map((p) => p.kind))];
  const chosen = shown.filter((p) => sel.includes(p.id));
  const apply = (list: Proposal[]) => { onCatalog(list.reduce((c, p) => applyProposal(c, p, now, actor), catalog)); setSel([]); };
  if (open.length === 0) return <div className="sh-body"><p className="sh-empty">Nothing to do. All skills are healthy under the current policy.</p></div>;
  return (
    <div className="sh-body">
      <p className="sh-note">Each proposal is only a suggestion. Nothing happens until you confirm it, and every change goes into the log.</p>
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
          <li key={p.id}>
            <input type="checkbox" checked={sel.includes(p.id)} onChange={() => setSel(sel.includes(p.id) ? sel.filter((x) => x !== p.id) : [...sel, p.id])} aria-label={`Select ${p.title}`} />
            <div><span className={`sh-kind sh-kind-${p.kind}`}>{PROPOSAL_LABEL[p.kind]}</span><strong>{p.title}</strong><p>{p.detail}</p></div>
            <span className="sh-row-actions"><button className="sh-primary" onClick={() => apply([p])}>Confirm</button><button onClick={() => onCatalog(dismiss(catalog, p.id))}>Not now</button></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Duplicates({ catalog, now, actor, onCatalog }: { catalog: Catalog; now: number; actor: string; onCatalog: (c: Catalog) => void }) {
  const list = useMemo(() => clusters(catalog), [catalog]);
  const [master, setMaster] = useState<Record<string, string>>({});
  const byId = new Map(catalog.skills.map((s) => [s.id, s]));
  if (list.length === 0) return <div className="sh-body"><p className="sh-empty">No similar skills found at a similarity of {pct(catalog.policy.similarity)}.</p></div>;
  return (
    <div className="sh-body">
      <p className="sh-note">Skills that do almost the same. Pick the one to keep; the others are phased out and point to it. The similarity limit is in Policy.</p>
      {list.map((c) => {
        const keep = master[c.key] ?? c.master;
        return (
          <section className="sh-card" key={c.key}>
            <h2>{c.ids.length} similar skills <small>similarity {pct(c.score)}</small></h2>
            <table className="sh-table"><thead><tr><th>Keep</th><th>Skill</th><th>Owner</th><th>Level</th><th>Runs 90 d</th><th>People</th><th>Success</th><th>Last used</th></tr></thead>
              <tbody>{c.ids.map((id) => { const s = byId.get(id)!; return (
                <tr key={id} className={id === keep ? 'sh-keep' : ''}>
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

function CatalogTab({ catalog, now, actor, onCatalog }: { catalog: Catalog; now: number; actor: string; onCatalog: (c: Catalog) => void }) {
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
              <tr key={s.id}>
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
      <p className="sh-note">{rows.length > shown.length ? `Showing the first ${shown.length} of ${rows.length}. Narrow the filter to see the rest.` : `${rows.length} skills`}</p>
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
