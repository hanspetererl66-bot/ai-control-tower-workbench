import { useState } from 'react';
import { diffDataset, type DataAnswer } from '../space-designer-data';
import { applyProposal, describeSource, refreshable, runSource, type RefreshHost } from '../space-designer-refresh';
import { setDataset, type Layout } from '../space-layout';
import { saveDesignedSpaceFile } from '../space-share';

type Item = { busy?: boolean; note?: string; proposal?: DataAnswer; use?: boolean };

/**
 * "Refresh data" on a finished page: every data set with a source says in plain words what refreshing does and waits for a click.
 * Nothing is saved before "Apply to page"; a failed read leaves the page as it is.
 */
export default function RefreshDataDialog({ layout, space, host, onClose, onSaved }: {
  layout: Layout;
  space: { slug: string; title: string; description: string; domain?: string };
  host: RefreshHost;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const sets = refreshable(layout);
  const [items, setItems] = useState<Record<string, Item>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const patch = (id: string, p: Item) => setItems((cur) => ({ ...cur, [id]: { ...cur[id], ...p } }));
  const chosen = sets.filter((d) => items[d.id]?.proposal && items[d.id]?.use);

  async function run(id: string) {
    const ds = sets.find((d) => d.id === id);
    if (!ds) return;
    patch(id, { busy: true, note: '', proposal: undefined, use: false });
    const r = await runSource(ds, host, space.title);
    if ('proposal' in r) patch(id, { busy: false, proposal: r.proposal, use: true, note: '' });
    else patch(id, { busy: false, note: r.note });
  }
  async function save() {
    setSaving(true); setError('');
    try {
      let next = layout;
      for (const ds of chosen) next = setDataset(next, applyProposal(ds, items[ds.id].proposal!));
      await saveDesignedSpaceFile({ slug: space.slug, title: space.title, description: space.description, domain: space.domain, layout: next });
      await onSaved();
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setSaving(false); }
  }

  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <section className="dialog dialog-wide dialog-scrollable" role="dialog" aria-modal="true" aria-labelledby="refresh-title">
        <h3 className="dialog-title" id="refresh-title">Refresh data</h3>
        <p className="dialog-body">Each source runs only when you click its button. You see what changes first; the page is rewritten only when you click Apply to page.</p>
        {sets.map((ds) => {
          const d = describeSource(ds)!;
          const it = items[ds.id] ?? {};
          const asOf = ds.source?.asOf ? `as of ${ds.source.asOf.replace('T', ' ')} UTC` : 'not filled yet';
          return (
            <div key={ds.id} className="sd-source">
              <h3>{ds.name} <span className="sd-hint">· {d.what} · {asOf}</span></h3>
              <p className="sd-hint"><b>{d.kind === 'joule' ? 'Question:' : d.kind === 'file' ? 'Source:' : 'View:'}</b> {d.detail}</p>
              <p className="sd-hint">{d.reads}</p>
              <button type="button" className="ghost-btn" onClick={() => void run(ds.id)} disabled={it.busy || saving || (d.kind === 'joule' && !host.generate)}>{it.busy ? 'Working…' : d.button}</button>
              {it.note && <p className="sd-hint" role="status">{it.note}</p>}
              {it.proposal && (
                <div className="sd-proposal">
                  <p><b>New:</b> {diffDataset(ds, it.proposal)}{it.proposal.sources ? ` Source: ${it.proposal.sources}.` : ''}</p>
                  {it.proposal.basis && <p className="sd-hint"><b>Basis, as Joule says:</b> {it.proposal.basis}{typeof it.proposal.records === 'number' ? ` (${it.proposal.records} records)` : ''}</p>}
                  {ds.source?.kind === 'joule' && <p className="sd-hint" role="note">Joule's figures are not checked. Compare them with the system before you apply.</p>}
                  {it.proposal.notes.map((n) => <p key={n} className="sd-hint">{n}</p>)}
                  <div className="sd-grid-wrap"><table className="sd-grid"><thead><tr>{it.proposal.columns.map((c, j) => <th key={j}>{c}</th>)}</tr></thead><tbody>{it.proposal.rows.slice(0, 5).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table></div>
                  {it.proposal.rows.length > 5 && <p className="sd-hint">… and {it.proposal.rows.length - 5} more rows.</p>}
                  <label className="sd-radio"><input type="checkbox" checked={!!it.use} onChange={(e) => patch(ds.id, { use: e.target.checked })} /> Use this in the page</label>
                </div>
              )}
            </div>
          );
        })}
        {error && <p className="sd-hint" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="dialog-btn" onClick={onClose} disabled={saving}>Close</button>
          <button type="button" className="dialog-btn dialog-btn-primary" onClick={() => void save()} disabled={saving || chosen.length === 0}>{saving ? 'Saving…' : `Apply to page${chosen.length ? ` (${chosen.length})` : ''}`}</button>
        </div>
      </section>
    </div>
  );
}
