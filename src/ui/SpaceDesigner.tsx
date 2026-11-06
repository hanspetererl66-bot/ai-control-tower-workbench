import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import designCss from '../../examples/shared/design-system.css?raw';
import type { Preferences } from '../preferences';
import { applySpacePrefs } from '../preferences-style';
import { applySpaceScale, applySpaceTheme, type SpaceScale } from '../space-scale';
import { diffLayouts, diffText, layoutPrompt, parseLayoutAnswer, type LayoutAnswer } from '../space-designer-ai';
import { canRedo, canUndo, commit, parsePreviewMessage, redo, startHistory, undo, withPreview, type History } from '../space-designer-state';
import {
  BLOCK_INFO, CHART_KINDS, MAX_BLOCKS, MAX_COLUMNS, MAX_DATASETS, MAX_ROWS, TONES, addBlock, duplicateBlock, moveBlock, parseTable, pointBlockAt, removeBlock, setDataset, updateBlock,
  type Block, type Dataset, type Layout, type Tone,
} from '../space-layout';
import { isDesignedPage, layoutFromHtml, renderSpacePage } from '../space-layout-render';
import { LAYOUT_TEMPLATES } from '../space-layout-templates';
import { saveDesignedSpaceFile } from '../space-share';
import { fetchSpaceHtml, type Space } from '../spaces';

type Generate = (prompt: string, title: string, session?: string) => Promise<string>;
type Props = {
  /** Folder name of the Space to edit; null starts a new one. */
  slug: string | null;
  spaces: Space[];
  domains: string[];
  theme: 'light' | 'dark';
  prefs?: Preferences;
  textScale: SpaceScale;
  generate?: Generate;
  onStop?: () => void;
  ready?: boolean;
  onBack: () => void;
  /** After a save: the Spaces list is reloaded and the folder name is returned. */
  onSaved: (slug: string) => void | Promise<void>;
};

const msg = (e: unknown) => String((e as { message?: unknown })?.message ?? e).slice(0, 240);
const labelOf = (type: string) => BLOCK_INFO.find((i) => i.type === type)?.label ?? type;

/** One line that tells blocks of the same type apart in the outline. */
function blockLine(b: Block): string {
  const s = (v: string) => v.replace(/\s+/g, ' ').trim().slice(0, 48);
  switch (b.type) {
    case 'heading': return s(b.text);
    case 'text': case 'columns': case 'table': case 'chart': case 'progress': case 'steps': case 'timeline': case 'compare': case 'matrix': case 'accordion': return s(b.title);
    case 'callout': return s(b.title || b.text);
    case 'quote': return s(b.text);
    case 'ask': return s(b.label);
    case 'kpis': return `${b.items.length} figures`;
    default: return '';
  }
}

/* ---------- small field editors ---------- */

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="sd-field"><span>{label}</span>{children}</label>;
}
function Text({ label, value, onChange, max }: { label: string; value: string; onChange: (v: string) => void; max?: number }) {
  return <Field label={label}><input value={value} maxLength={max} onChange={(e) => onChange(e.target.value)} /></Field>;
}
function Area({ label, value, onChange, rows = 4 }: { label: string; value: string; onChange: (v: string) => void; rows?: number }) {
  return <Field label={label}><textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} /></Field>;
}
function Pick<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <Field label={label}>
      <select value={String(value)} onChange={(e) => onChange(options.find((o) => String(o.value) === e.target.value)!.value)}>
        {options.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
      </select>
    </Field>
  );
}
const toneOptions = TONES.map((t) => ({ value: t, label: { info: 'Neutral', ok: 'Good', warn: 'Warning', bad: 'Problem' }[t] }));

type Col = { key: string; label: string; kind?: 'text' | 'area' | 'num' | 'tone' };

/** A list of small records (figures, steps, boxes ...): edit, reorder, add, remove. */
function ListEditor<T extends Record<string, unknown>>({ items, cols, blank, onChange, noun, min = 0, max = 24 }: {
  items: T[]; cols: Col[]; blank: T; onChange: (next: T[]) => void; noun: string; min?: number; max?: number;
}) {
  const set = (i: number, key: string, v: unknown) => onChange(items.map((it, j) => (j === i ? { ...it, [key]: v } : it)));
  const swap = (i: number, to: number) => { if (to < 0 || to >= items.length) return; const next = items.slice(); [next[i], next[to]] = [next[to], next[i]]; onChange(next); };
  return (
    <div className="sd-list">
      {items.map((it, i) => (
        <fieldset key={i} className="sd-item">
          <legend>{noun} {i + 1}</legend>
          {cols.map((c) => {
            const v = it[c.key];
            if (c.kind === 'area') return <Area key={c.key} label={c.label} rows={3} value={String(v ?? '')} onChange={(x) => set(i, c.key, x)} />;
            if (c.kind === 'tone') return <Pick key={c.key} label={c.label} value={(v as Tone) ?? 'info'} options={toneOptions} onChange={(x) => set(i, c.key, x)} />;
            if (c.kind === 'num') return <Field key={c.key} label={c.label}><input type="number" value={Number(v ?? 0)} onChange={(e) => set(i, c.key, Number(e.target.value))} /></Field>;
            return <Text key={c.key} label={c.label} value={String(v ?? '')} onChange={(x) => set(i, c.key, x)} />;
          })}
          <div className="sd-item-actions">
            <button type="button" className="ghost-btn" onClick={() => swap(i, i - 1)} disabled={i === 0} aria-label={`Move ${noun} ${i + 1} up`}>↑</button>
            <button type="button" className="ghost-btn" onClick={() => swap(i, i + 1)} disabled={i === items.length - 1} aria-label={`Move ${noun} ${i + 1} down`}>↓</button>
            <button type="button" className="ghost-btn" onClick={() => onChange(items.filter((_, j) => j !== i))} disabled={items.length <= min} aria-label={`Remove ${noun} ${i + 1}`}>Remove</button>
          </div>
        </fieldset>
      ))}
      <button type="button" className="ghost-btn" onClick={() => onChange([...items, { ...blank }])} disabled={items.length >= max}>+ Add {noun.toLowerCase()}</button>
    </div>
  );
}

/** The data behind a table or chart: pick or create a dataset, edit cells, paste from a spreadsheet. */
function DataEditor({ layout, block, onLayout }: { layout: Layout; block: Extract<Block, { type: 'table' | 'chart' }>; onLayout: (next: Layout) => void }) {
  const ds = layout.datasets.find((d) => d.id === block.dataset);
  const [paste, setPaste] = useState('');
  const [note, setNote] = useState('');
  if (!ds) return <p className="sd-hint">No data yet.</p>;
  const users = layout.blocks.filter((b) => (b.type === 'table' || b.type === 'chart') && b.dataset === ds.id && b.id !== block.id).length;
  const put = (next: Dataset) => onLayout(setDataset(layout, next));
  const setCell = (r: number, c: number, v: string) => put({ ...ds, rows: ds.rows.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row)) });
  const setHead = (c: number, v: string) => put({ ...ds, columns: ds.columns.map((x, j) => (j === c ? v : x)) });
  const addRow = () => ds.rows.length < MAX_ROWS && put({ ...ds, rows: [...ds.rows, ds.columns.map(() => '')] });
  const addCol = () => ds.columns.length < MAX_COLUMNS && put({ ...ds, columns: [...ds.columns, `Column ${ds.columns.length + 1}`], rows: ds.rows.map((r) => [...r, '']) });
  const delRow = (r: number) => put({ ...ds, rows: ds.rows.filter((_, i) => i !== r) });
  const delCol = (c: number) => ds.columns.length > 1 && put({ ...ds, columns: ds.columns.filter((_, j) => j !== c), rows: ds.rows.map((r) => r.filter((_, j) => j !== c)) });
  const applyPaste = () => {
    const parsed = parseTable(paste);
    if (!parsed) { setNote('Nothing to read. Copy the cells in your spreadsheet, including the header row.'); return; }
    put({ ...ds, columns: parsed.columns, rows: parsed.rows });
    setPaste(''); setNote(`Replaced by ${parsed.rows.length} rows and ${parsed.columns.length} columns.`);
  };
  return (
    <div className="sd-data">
      <Field label="Data set">
        <select value={ds.id} onChange={(e) => onLayout(pointBlockAt(layout, block.id, e.target.value))}>
          {layout.datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          {layout.datasets.length < MAX_DATASETS && <option value="new">+ New data set</option>}
        </select>
      </Field>
      <Text label="Name of the data set" value={ds.name} onChange={(v) => put({ ...ds, name: v })} max={60} />
      {users > 0 && <p className="sd-hint">{users} other block{users > 1 ? 's' : ''} show these numbers too.</p>}
      <div className="sd-grid-wrap">
        <table className="sd-grid">
          <thead>
            <tr>
              {ds.columns.map((c, j) => (
                <th key={j}>
                  <input aria-label={`Column ${j + 1} name`} value={c} onChange={(e) => setHead(j, e.target.value)} />
                  <button type="button" className="sd-x" onClick={() => delCol(j)} disabled={ds.columns.length <= 1} aria-label={`Remove column ${j + 1}`}>×</button>
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {ds.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => <td key={c}><input aria-label={`Row ${r + 1}, ${ds.columns[c]}`} value={cell} onChange={(e) => setCell(r, c, e.target.value)} /></td>)}
                <td><button type="button" className="sd-x" onClick={() => delRow(r)} aria-label={`Remove row ${r + 1}`}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="sd-item-actions">
        <button type="button" className="ghost-btn" onClick={addRow} disabled={ds.rows.length >= MAX_ROWS}>+ Row</button>
        <button type="button" className="ghost-btn" onClick={addCol} disabled={ds.columns.length >= MAX_COLUMNS}>+ Column</button>
      </div>
      <Area label="Paste from a spreadsheet (replaces the cells)" rows={3} value={paste} onChange={setPaste} />
      <button type="button" className="ghost-btn" onClick={applyPaste} disabled={!paste.trim()}>Use pasted cells</button>
      {note && <p className="sd-hint" role="status">{note}</p>}
      {block.type === 'table' && <p className="sd-hint">Status colour in a cell: start it with {'{ok}'}, {'{warn}'}, {'{bad}'} or {'{info}'}, for example “{'{ok}'} On track”.</p>}
    </div>
  );
}

/** Fields of the selected block. */
function Inspector({ layout, block, onLayout }: { layout: Layout; block: Block; onLayout: (next: Layout) => void }) {
  const up = (patch: Record<string, unknown>) => onLayout(updateBlock(layout, block.id, patch));
  switch (block.type) {
    case 'heading':
      return <>
        <Text label="Heading" value={block.text} onChange={(v) => up({ text: v })} />
        <Text label="Line below" value={block.sub} onChange={(v) => up({ sub: v })} />
        <Pick label="Size" value={block.level} options={[{ value: 1, label: 'Large' }, { value: 2, label: 'Medium' }] as const} onChange={(v) => up({ level: v })} />
      </>;
    case 'text':
      return <>
        <Text label="Title" value={block.title} onChange={(v) => up({ title: v })} />
        <Area label="Text" rows={8} value={block.text} onChange={(v) => up({ text: v })} />
        <p className="sd-hint">Empty line = new paragraph. Start a line with “- ” for a bullet. **bold** works.</p>
      </>;
    case 'quote':
      return <>
        <Area label="Statement" value={block.text} onChange={(v) => up({ text: v })} />
        <Text label="Source" value={block.by} onChange={(v) => up({ by: v })} />
      </>;
    case 'callout':
      return <>
        <Pick label="Kind" value={block.tone} options={toneOptions} onChange={(v) => up({ tone: v })} />
        <Text label="Title" value={block.title} onChange={(v) => up({ title: v })} />
        <Area label="Text" value={block.text} onChange={(v) => up({ text: v })} />
      </>;
    case 'columns':
      return <>
        <Text label="Title above the boxes" value={block.title} onChange={(v) => up({ title: v })} />
        <Pick label="Boxes side by side" value={block.count} options={[{ value: 2, label: '2 boxes' }, { value: 3, label: '3 boxes' }, { value: 4, label: '4 boxes' }] as const}
          onChange={(count) => up({ count, boxes: Array.from({ length: count }, (_, i) => block.boxes[i] ?? { title: `Box ${i + 1}`, text: '' }) })} />
        <ListEditor noun="Box" items={block.boxes} cols={[{ key: 'title', label: 'Title' }, { key: 'text', label: 'Text', kind: 'area' }]} blank={{ title: '', text: '' }}
          onChange={(boxes) => up({ boxes })} min={block.count} max={block.count} />
      </>;
    case 'compare':
      return <>
        <Text label="Title" value={block.title} onChange={(v) => up({ title: v })} />
        {(['left', 'right'] as const).map((side) => (
          <fieldset key={side} className="sd-item">
            <legend>{side === 'left' ? 'Left box' : 'Right box'}</legend>
            <Text label="Title" value={block[side].title} onChange={(v) => up({ [side]: { ...block[side], title: v } })} />
            <Pick label="Colour" value={block[side].tone} options={toneOptions} onChange={(v) => up({ [side]: { ...block[side], tone: v } })} />
            <Area label="Lines (one per line, “- ” for bullets)" value={block[side].lines} onChange={(v) => up({ [side]: { ...block[side], lines: v } })} />
          </fieldset>
        ))}
      </>;
    case 'accordion':
      return <>
        <Text label="Title" value={block.title} onChange={(v) => up({ title: v })} />
        <ListEditor noun="Question" items={block.items} cols={[{ key: 'title', label: 'Question' }, { key: 'text', label: 'Answer', kind: 'area' }]} blank={{ title: 'Question', text: '' }} onChange={(items) => up({ items })} min={1} />
      </>;
    case 'steps':
      return <>
        <Text label="Title" value={block.title} onChange={(v) => up({ title: v })} />
        <ListEditor noun="Step" items={block.items} cols={[{ key: 'title', label: 'Step' }, { key: 'text', label: 'Text', kind: 'area' }]} blank={{ title: 'Step', text: '' }} onChange={(items) => up({ items })} min={1} max={12} />
      </>;
    case 'timeline':
      return <>
        <Text label="Title" value={block.title} onChange={(v) => up({ title: v })} />
        <ListEditor noun="Entry" items={block.items} cols={[{ key: 'when', label: 'When' }, { key: 'title', label: 'Title' }, { key: 'text', label: 'Text', kind: 'area' }]} blank={{ when: '', title: 'Milestone', text: '' }} onChange={(items) => up({ items })} min={1} max={16} />
      </>;
    case 'kpis':
      return <ListEditor noun="Figure" items={block.items} cols={[
        { key: 'label', label: 'Label' }, { key: 'value', label: 'Value' }, { key: 'delta', label: 'Change (e.g. +6% vs last month)' },
        { key: 'tone', label: 'Colour', kind: 'tone' }, { key: 'trend', label: 'Trend (up to 12 numbers, separated by commas)' },
      ]} blank={{ label: 'Figure', value: '0', delta: '', tone: 'info', trend: '' }} onChange={(items) => up({ items })} min={1} max={6} />;
    case 'progress':
      return <>
        <Text label="Title" value={block.title} onChange={(v) => up({ title: v })} />
        <Pick label="Kind" value={block.mode} options={[{ value: 'progress', label: 'Progress (more is better)' }, { value: 'limit', label: 'Limit (turns red when full)' }] as const} onChange={(v) => up({ mode: v })} />
        <ListEditor noun="Bar" items={block.items} cols={[{ key: 'label', label: 'Label' }, { key: 'value', label: 'Value', kind: 'num' }, { key: 'max', label: 'Maximum', kind: 'num' }]} blank={{ label: 'Item', value: 0, max: 100 }} onChange={(items) => up({ items })} min={1} max={12} />
      </>;
    case 'matrix':
      return <>
        <Text label="Title" value={block.title} onChange={(v) => up({ title: v })} />
        <Text label="Horizontal axis" value={block.xLabel} onChange={(v) => up({ xLabel: v })} />
        <Text label="Vertical axis" value={block.yLabel} onChange={(v) => up({ yLabel: v })} />
        <ListEditor noun="Point" items={block.points} cols={[{ key: 'label', label: 'Label' }, { key: 'x', label: 'Horizontal (0–100)', kind: 'num' }, { key: 'y', label: 'Vertical (0–100)', kind: 'num' }]} blank={{ label: 'Item', x: 50, y: 50 }} onChange={(points) => up({ points })} max={20} />
      </>;
    case 'table':
      return <>
        <Text label="Title" value={block.title} onChange={(v) => up({ title: v })} />
        <label className="sd-check"><input type="checkbox" checked={block.sortable} onChange={(e) => up({ sortable: e.target.checked })} /> Readers can sort by clicking a column</label>
        <label className="sd-check"><input type="checkbox" checked={block.totals} onChange={(e) => up({ totals: e.target.checked })} /> Add a totals row for number columns</label>
        <DataEditor layout={layout} block={block} onLayout={onLayout} />
      </>;
    case 'chart':
      return <>
        <Text label="Title" value={block.title} onChange={(v) => up({ title: v })} />
        <Text label="Line below" value={block.sub} onChange={(v) => up({ sub: v })} />
        <Pick label="Chart type" value={block.kind} options={CHART_KINDS.map((k) => ({ value: k, label: { bar: 'Bars', stacked: 'Stacked bars', line: 'Lines', area: 'Areas', donut: 'Donut' }[k] }))} onChange={(v) => up({ kind: v })} />
        <p className="sd-hint">First column = labels, every other column = one series. A donut uses the first number column.</p>
        <DataEditor layout={layout} block={block} onLayout={onLayout} />
      </>;
    case 'ask':
      return <>
        <Text label="Button text" value={block.label} onChange={(v) => up({ label: v })} />
        <Area label="What Joule is asked (max. 600 characters)" value={block.prompt} onChange={(v) => up({ prompt: v.slice(0, 600) })} />
      </>;
    case 'divider':
      return <p className="sd-hint">A thin line between two parts of the page. Nothing to set.</p>;
  }
}

/* ---------- the Designer ---------- */

export default function SpaceDesigner({ slug: initialSlug, spaces, domains, theme, prefs, textScale, generate, onStop, ready = false, onBack, onSaved }: Props) {
  const [hist, setHist] = useState<History>(() => startHistory({ version: 1, datasets: [], blocks: [] }));
  const layout = hist.present;
  const [slug, setSlug] = useState<string | null>(initialSlug);
  const [title, setTitle] = useState('New Space');
  const [description, setDescription] = useState('');
  const [domain, setDomain] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(initialSlug));
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState('');
  const [saving, setSaving] = useState(false);
  const [dragFrom, setDragFrom] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [tab, setTab] = useState<'edit' | 'joule'>('edit');
  const [request, setRequest] = useState('');
  const [asking, setAsking] = useState(false);
  const [proposal, setProposal] = useState<(LayoutAnswer & { text: string }) | null>(null);
  const [jouleNote, setJouleNote] = useState('');
  const scrollY = useRef(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const [pageHtml, setPageHtml] = useState('');

  const snapshot = (l: Layout, t: string, d: string, dm: string) => JSON.stringify([l, t, d, dm]);
  const dirty = !loading && snapshot(layout, title, description, domain) !== saved;

  // Open an existing Space of the Designer.
  useEffect(() => {
    if (!initialSlug) { setSaved(snapshot(hist.present, title, description, domain)); return; }
    let live = true;
    (async () => {
      try {
        const html = await fetchSpaceHtml(initialSlug, Date.now());
        if (!live) return;
        const found = layoutFromHtml(html);
        if (!found || !isDesignedPage(html)) { setError('This Space was not made in the Designer, so it cannot be opened here. Use “Change with Joule” in the Space, or start a new design.'); setLoading(false); return; }
        const meta = spaces.find((s) => s.slug === initialSlug);
        const t = meta?.title ?? initialSlug;
        setHist(startHistory(found)); setTitle(t); setDescription(meta?.description ?? ''); setDomain('');
        setSaved(snapshot(found, t, meta?.description ?? '', ''));
        setLoading(false);
      } catch (e) { if (live) { setError(msg(e)); setLoading(false); } }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSlug]);

  // Preview page, regenerated shortly after each change.
  useEffect(() => {
    const t = setTimeout(() => {
      let html = renderSpacePage({ title, layout, css: designCss });
      html = applySpaceTheme(html, theme);
      if (prefs) html = applySpacePrefs(html, prefs);
      html = applySpaceScale(html, textScale);
      setPageHtml(withPreview(html, selected, scrollY.current));
    }, 200);
    return () => clearTimeout(t);
  }, [layout, title, selected, theme, prefs, textScale]);

  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const m = parsePreviewMessage(e.data, layout);
      if (!m) return;
      if (m.type === 'scroll') scrollY.current = m.y;
      else { setSelected(m.id); setTab('edit'); }
    };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, [layout]);

  // Ctrl/Cmd+Z and Shift+Z, but not while typing in a field (the field has its own undo).
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      e.preventDefault();
      setHist((h) => (e.shiftKey ? redo(h) : undo(h)));
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const on = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', on);
    return () => window.removeEventListener('beforeunload', on);
  }, [dirty]);

  const change = (next: Layout, select?: string | null) => { setHist((h) => commit(h, next)); if (select !== undefined) setSelected(select); };
  const block = layout.blocks.find((b) => b.id === selected) ?? null;
  const index = block ? layout.blocks.indexOf(block) : -1;
  const groups = useMemo(() => [...new Set(BLOCK_INFO.map((i) => i.group))], []);

  function add(type: Block['type']) {
    if (layout.blocks.length >= MAX_BLOCKS) { setNote(`A page can have up to ${MAX_BLOCKS} blocks.`); return; }
    const r = addBlock(layout, type, selected);
    change(r.layout, r.id); setTab('edit'); setNote('');
  }
  function leave() {
    if (dirty && !window.confirm('You have unsaved changes. Leave the Designer anyway?')) return;
    onBack();
  }
  function template(id: string) {
    const t = LAYOUT_TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    if (layout.blocks.length && !window.confirm('Replace the page with this template? You can undo this.')) return;
    change(t.layout, null);
    if (!slug) setTitle(t.title);
  }
  async function save(asNew: boolean) {
    setSaving(true); setError(''); setNote('');
    try {
      const r = await saveDesignedSpaceFile({ slug: asNew ? undefined : slug ?? undefined, title, description, domain, layout, asNew });
      setSlug(r.slug); setTitle(r.title);
      setSaved(snapshot(layout, r.title, description, domain));
      setNote(r.created ? `Saved as a new Space: “${r.title}”.` : 'Saved.');
      await onSaved(r.slug);
    } catch (e) { setError(msg(e)); } finally { setSaving(false); }
  }
  async function askJoule() {
    if (!generate || !request.trim()) return;
    setAsking(true); setJouleNote(''); setProposal(null);
    try {
      const text = await generate(layoutPrompt(title, layout, request), 'Space Designer', 'space-designer');
      if (!text) { setJouleNote('Stopped.'); return; }
      const answer = parseLayoutAnswer(text);
      if (!answer) { setJouleNote('Joule did not send a layout I can read. Ask again, or say what should change in other words.'); return; }
      setProposal({ ...answer, text });
    } catch (e) { setJouleNote(msg(e)); } finally { setAsking(false); }
  }
  function applyProposal() {
    if (!proposal) return;
    change(proposal.layout, proposal.layout.blocks.some((b) => b.id === selected) ? selected : null);
    setProposal(null); setRequest(''); setJouleNote('Applied. Undo brings back the page as it was.');
  }

  const diff = proposal ? diffLayouts(layout, proposal.layout) : null;
  const domainList = useMemo(() => [...new Set(domains.filter(Boolean))], [domains]);

  return (
    <main className="sh sd" aria-label="Space Designer">
      <header className="sd-head">
        <button className="ghost-btn" onClick={leave} aria-label="Back to Spaces">← Spaces</button>
        <input className="sd-title" aria-label="Title of the Space" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        <div className="sd-head-actions">
          <select aria-label="Start from a template" value="" onChange={(e) => { if (e.target.value) template(e.target.value); }}>
            <option value="">Template…</option>
            {LAYOUT_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button className="ghost-btn" onClick={() => setHist(undo)} disabled={!canUndo(hist)} aria-label="Undo">Undo</button>
          <button className="ghost-btn" onClick={() => setHist(redo)} disabled={!canRedo(hist)} aria-label="Redo">Redo</button>
          {slug && <button className="ghost-btn" onClick={() => void save(true)} disabled={saving || loading}>Save as new</button>}
          <button className="send-btn sd-save" onClick={() => void save(false)} disabled={saving || loading || (Boolean(slug) && !dirty)}>{saving ? 'Saving…' : slug ? 'Save' : 'Save Space'}</button>
        </div>
      </header>
      {(error || note || dirty) && (
        <p className={`sd-status ${error ? 'sd-status-bad' : ''}`} role="status">{error || note || 'Unsaved changes'}</p>
      )}

      {loading ? <p className="sh-empty">Opening the Space…</p> : (
        <div className="sd-body">
          <aside className="sd-left" aria-label="Blocks">
            <section>
              <h2>Add a block</h2>
              {groups.map((g) => (
                <div key={g} className="sd-group">
                  <h3>{g}</h3>
                  <div className="sd-palette">
                    {BLOCK_INFO.filter((i) => i.group === g).map((i) => (
                      <button key={i.type} className="sd-add" onClick={() => add(i.type)} title={i.hint}>{i.label}</button>
                    ))}
                  </div>
                </div>
              ))}
            </section>
            <section>
              <h2>Page <span className="sd-count">{layout.blocks.length}</span></h2>
              {layout.blocks.length === 0 && <p className="sd-hint">Empty. Add a block, or pick a template above.</p>}
              <ol className="sd-outline" onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropAt(null); }}>
                {layout.blocks.map((b, i) => (
                  <li key={b.id}
                    className={`sd-row ${b.id === selected ? 'sd-row-on' : ''} ${dropAt === i && dragFrom !== b.id ? 'sd-row-drop' : ''}`}
                    draggable
                    onDragStart={(e) => { setDragFrom(b.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', b.id); }}
                    onDragOver={(e) => { if (dragFrom) { e.preventDefault(); setDropAt(i); } }}
                    onDrop={(e) => { e.preventDefault(); if (dragFrom && dragFrom !== b.id) change(moveBlock(layout, dragFrom, i)); setDragFrom(null); setDropAt(null); }}
                    onDragEnd={() => { setDragFrom(null); setDropAt(null); }}>
                    <button className="sd-row-main" onClick={() => { setSelected(b.id); setTab('edit'); }} aria-pressed={b.id === selected}>
                      <span className="sd-grip" aria-hidden="true">⋮⋮</span>
                      <span className="sd-row-type">{labelOf(b.type)}</span>
                      <span className="sd-row-line">{blockLine(b)}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          </aside>

          <section className="sd-center" aria-label="Preview">
            <iframe ref={frame} className="sd-frame" title="Preview of the Space" srcDoc={pageHtml} sandbox="allow-scripts" />
          </section>

          <aside className="sd-right" aria-label="Properties">
            <div className="sd-tabs" role="tablist">
              <button role="tab" aria-selected={tab === 'edit'} className={tab === 'edit' ? 'sd-tab-on' : ''} onClick={() => setTab('edit')}>Edit</button>
              <button role="tab" aria-selected={tab === 'joule'} className={tab === 'joule' ? 'sd-tab-on' : ''} onClick={() => setTab('joule')}>Change with Joule</button>
            </div>
            {tab === 'edit' ? (
              block ? (
                <div className="sd-inspector">
                  <div className="sd-inspector-head">
                    <h2>{labelOf(block.type)}</h2>
                    <div className="sd-item-actions">
                      <button className="ghost-btn" onClick={() => change(moveBlock(layout, block.id, index - 1))} disabled={index <= 0} aria-label="Move block up">↑</button>
                      <button className="ghost-btn" onClick={() => change(moveBlock(layout, block.id, index + 1))} disabled={index >= layout.blocks.length - 1} aria-label="Move block down">↓</button>
                      <button className="ghost-btn" onClick={() => { const r = duplicateBlock(layout, block.id); change(r.layout, r.id); }} disabled={layout.blocks.length >= MAX_BLOCKS}>Duplicate</button>
                      <button className="ghost-btn sd-danger" onClick={() => { const next = layout.blocks[index + 1] ?? layout.blocks[index - 1]; change(removeBlock(layout, block.id), next?.id ?? null); }}>Delete</button>
                    </div>
                  </div>
                  <Inspector layout={layout} block={block} onLayout={(l) => change(l)} />
                </div>
              ) : (
                <div className="sd-inspector">
                  <h2>Space</h2>
                  <Area label="Short description (shown in the Spaces list)" rows={2} value={description} onChange={setDescription} />
                  <Field label="Domain">
                    <select value={domain} onChange={(e) => setDomain(e.target.value)}>
                      <option value="">{slug ? 'Keep as is' : 'None'}</option>
                      {domainList.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </Field>
                  <p className="sd-hint">Click a block in the preview or in the list to edit it. Drag blocks in the list to change the order.</p>
                  <p className="sd-hint">Colours, text size and light or dark follow your settings. Nothing here is connected to live data: the numbers are the ones you enter.</p>
                </div>
              )
            ) : (
              <div className="sd-inspector">
                <h2>Change with Joule</h2>
                <p className="sd-hint">Describe what the page should look like or what to change. Joule sends a proposal; nothing changes until you apply it, and Undo brings the old page back.</p>
                <Area label="Your request" rows={5} value={request} onChange={setRequest} />
                <div className="sd-item-actions">
                  <button className="send-btn" onClick={() => void askJoule()} disabled={!ready || asking || !request.trim() || !generate}>{asking ? 'Joule is working…' : 'Ask Joule'}</button>
                  {asking && <button className="ghost-btn" onClick={onStop}>Stop</button>}
                </div>
                {!ready && <p className="sd-hint">The agent is not connected yet.</p>}
                {jouleNote && <p className="sd-hint" role="status">{jouleNote}</p>}
                {proposal && diff && (
                  <div className="sd-proposal">
                    <h3>Proposal</h3>
                    {proposal.message && <p>{proposal.message}</p>}
                    <p><strong>{diffText(diff)}</strong></p>
                    {proposal.notes.length > 0 && <ul className="sd-hint">{proposal.notes.slice(0, 5).map((n, i) => <li key={i}>{n}</li>)}</ul>}
                    <div className="sd-item-actions">
                      <button className="send-btn" onClick={applyProposal} disabled={diff.same}>Apply</button>
                      <button className="ghost-btn" onClick={() => setProposal(null)}>Discard</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
