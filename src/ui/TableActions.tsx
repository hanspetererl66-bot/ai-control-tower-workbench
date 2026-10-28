import { useEffect, useRef, useState } from 'react';
import { isTableFile, type BulkUploadResult, type ChatAttachment } from '../attachments';
import { buildTableSpaceHtml, checkWebhookUrl, slugify, DEFAULT_BATCH_SIZE } from '../../shared/table-ingest.mjs';
import { buildSpacePackage } from '../../shared/space-package.mjs';

const URL_KEY = 'werkbank.bulkWebhook';

type Props = {
  attachments: ChatAttachment[];
  /** Hands a Space file to the app, which installs it and opens it. */
  onCreateSpace?: (file: File) => void | Promise<void>;
};

type Run = { state: 'idle' | 'running' | 'done' | 'failed'; text: string; batch: number; total: number; next?: number };

/**
 * Shown under the attached files when some of them are tables (csv, tsv, xlsx):
 * turn them into one Space, or send their rows to a webhook in batches.
 */
export default function TableActions({ attachments, onCreateSpace }: Props) {
  const tables = attachments.filter((a) => isTableFile(a.name));
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [url, setUrl] = useState(() => { try { return window.localStorage.getItem(URL_KEY) ?? ''; } catch { return ''; } });
  const [token, setToken] = useState('');
  const [batchSize, setBatchSize] = useState(DEFAULT_BATCH_SIZE);
  const [fileIndex, setFileIndex] = useState(0);
  const [run, setRun] = useState<Run>({ state: 'idle', text: '', batch: 0, total: 0 });
  const batchId = useRef('');

  useEffect(() => window.host?.onBulkUploadProgress?.((p) => {
    setRun((r) => ({ ...r, state: 'running', batch: p.batch, total: p.total, text: `${p.sentRows.toLocaleString('en-US')} of ${p.totalRows.toLocaleString('en-US')} rows sent` }));
  }), []);

  if (tables.length === 0) return null;
  const current = tables[Math.min(fileIndex, tables.length - 1)];

  async function makeSpace() {
    if (!window.host?.readTables || !onCreateSpace) { setMessage('Tables become Spaces in the Electron app.'); return; }
    setBusy(true);
    setMessage('');
    try {
      const all: { name: string; table: { columns: string[]; rows: string[][]; truncated: boolean } }[] = [];
      for (const file of tables) {
        const res = await window.host.readTables(file.path);
        if (!res.ok) { setMessage(`${file.name}: ${res.detail}`); continue; }
        for (const t of res.tables) all.push({ name: res.tables.length > 1 ? `${file.name} / ${t.name}` : file.name, table: t.table });
      }
      if (!all.length) { setBusy(false); return; }
      const title = tables.length === 1 ? tables[0].name.replace(/\.[^.]+$/, '') : `Tables (${tables.length} files)`;
      const slug = `${slugify(title)}-${Date.now().toString(36).slice(-4)}`;
      const html = buildTableSpaceHtml({ title, tables: all });
      const pkg = buildSpacePackage({ slug, title, files: { 'index.html': html, 'space.json': JSON.stringify({ title, description: `Table Space from ${tables.map((t) => t.name).join(', ')}.`, prompt: 'Table Space created from uploaded files.' }) } });
      await onCreateSpace(new File([JSON.stringify(pkg)], `${slug}.werkbank-space.json`, { type: 'application/json' }));
      setMessage('Space created. Find it under Spaces.');
    } catch (e: any) {
      setMessage(e?.message ?? 'The Space could not be created.');
    } finally {
      setBusy(false);
    }
  }

  async function send(startAt = 1) {
    if (!window.host?.bulkUploadRows) { setMessage('Sending rows works in the Electron app.'); return; }
    try { checkWebhookUrl(url); } catch (e: any) { setMessage(e.message); return; }
    try { window.localStorage.setItem(URL_KEY, url.trim()); } catch { /* ignore */ }
    if (startAt === 1) batchId.current = crypto.randomUUID();
    setBusy(true);
    setMessage('');
    setRun({ state: 'running', text: 'Starting…', batch: 0, total: 0 });
    const result: BulkUploadResult = await window.host.bulkUploadRows({ path: current.path, tableIndex: 0, url: url.trim(), token: token || undefined, batchSize, batchId: batchId.current, startAt });
    setBusy(false);
    if (result.ok) setRun({ state: 'done', batch: result.total ?? 0, total: result.total ?? 0, text: `Done: ${(result.totalRows ?? 0).toLocaleString('en-US')} rows in ${result.total} batches.` });
    else setRun({ state: 'failed', batch: result.sentBatches ?? 0, total: result.total ?? 0, next: result.nextBatch, text: result.cancelled ? `Stopped after ${result.sentBatches ?? 0} batches.` : `Stopped at batch ${result.failedBatch ?? '?'}: ${result.error ?? 'unknown error'}` });
  }

  return (
    <div className="table-actions" role="group" aria-label="Table actions">
      <span className="table-actions-label">{tables.length} table{tables.length > 1 ? 's' : ''} attached</span>
      <button className="ghost-btn small" onClick={makeSpace} disabled={busy} title="Build one Space with a sortable, searchable table for each file">Make a table Space</button>
      <button className="ghost-btn small" onClick={() => setOpen((v) => !v)} aria-expanded={open} title="Send the rows in batches to a webhook, for example an n8n workflow that fills a database">Send rows to n8n…</button>
      {message && <span className="table-actions-note" role="status">{message}</span>}
      {open && (
        <div className="table-send">
          <p className="table-send-help">
            Sends the rows of one file in batches of JSON to a webhook. Import <code>examples/n8n-workflows/09-bulk-table-ingest.json</code> into n8n, activate it, and paste its <strong>production</strong> URL here. The token is optional and is not saved.
          </p>
          {tables.length > 1 && (
            <label>File
              <select value={fileIndex} onChange={(e) => setFileIndex(Number(e.target.value))} disabled={busy}>
                {tables.map((t, i) => <option key={t.path} value={i}>{t.name}</option>)}
              </select>
            </label>
          )}
          <label>Webhook URL<input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-instance.app.n8n.cloud/webhook/bulk-table-ingest" disabled={busy} /></label>
          <label>Token (optional)<input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="sent as header x-upload-token" autoComplete="off" disabled={busy} /></label>
          <label>Rows per batch
            <select value={batchSize} onChange={(e) => setBatchSize(Number(e.target.value))} disabled={busy}>
              {[50, 100, 200, 500].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <div className="table-send-row">
            <button className="ghost-btn" onClick={() => void send(1)} disabled={busy || !url.trim()}>Send {current.name}</button>
            {run.state === 'failed' && run.next && <button className="ghost-btn" onClick={() => void send(run.next)} disabled={busy}>Continue at batch {run.next}</button>}
            {busy && <button className="ghost-btn ghost-danger" onClick={() => window.host?.cancelBulkUpload?.()}>Stop</button>}
          </div>
          {run.state !== 'idle' && (
            <div className={`table-send-status table-send-${run.state}`} role="status">
              {run.total > 0 && <progress max={run.total} value={run.batch} />}
              <span>{run.text}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
