/**
 * Mass upload of tables: parse CSV/TSV/Excel sheets, describe a table compactly for a language model,
 * cut rows into batches for a webhook, and build a self-contained table Space.
 * Pure functions, shared by the Electron main process, the renderer and the tests.
 */

export const MAX_TABLE_ROWS = 20_000;
export const MAX_SPACE_ROWS = 2_000;
export const DEFAULT_BATCH_SIZE = 200;

/* ---------------- parsing ---------------- */

/** Picks the delimiter (tab, semicolon, comma or pipe) that is most common on the first lines outside quotes. */
export function sniffDelimiter(text) {
  const sample = String(text).split(/\r?\n/).slice(0, 5).join('\n');
  let best = ',';
  let bestCount = 0;
  for (const d of ['\t', ';', ',', '|']) {
    let count = 0;
    let quoted = false;
    for (const ch of sample) {
      if (ch === '"') quoted = !quoted;
      else if (!quoted && ch === d) count += 1;
    }
    if (count > bestCount) { best = d; bestCount = count; }
  }
  return best;
}

/** RFC 4180 style parser: quotes, doubled quotes, line breaks inside quotes. Returns an array of rows. */
export function parseDelimited(text, delimiter = sniffDelimiter(text)) {
  const src = String(text).replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell); cell = '';
      rows.push(row); row = [];
      if (rows.length > MAX_TABLE_ROWS + 1) break;
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

/** Cleans column names: trimmed, never empty, unique. */
export function cleanColumns(header) {
  const seen = new Map();
  return header.map((raw, i) => {
    let name = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) || `column_${i + 1}`;
    const n = (seen.get(name.toLowerCase()) ?? 0) + 1;
    seen.set(name.toLowerCase(), n);
    if (n > 1) name = `${name}_${n}`;
    return name;
  });
}

/** Builds { columns, rows, truncated } from raw rows (first row = header). Rows are padded or cut to the header width. */
export function toTable(rawRows) {
  if (!Array.isArray(rawRows) || rawRows.length === 0) return { columns: [], rows: [], truncated: false };
  const columns = cleanColumns(rawRows[0]);
  const body = rawRows.slice(1, MAX_TABLE_ROWS + 1).map((r) => columns.map((_, i) => String(r[i] ?? '').trim()));
  return { columns, rows: body, truncated: rawRows.length - 1 > MAX_TABLE_ROWS };
}

export function parseTableText(text) {
  return toTable(parseDelimited(text));
}

/* ---------------- Excel (.xlsx) ---------------- */

function decodeXml(t) {
  return t.replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

/** The shared string table of an xlsx file (xl/sharedStrings.xml). */
export function parseSharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  for (const si of xml.match(/<si\b[\s\S]*?<\/si>/g) ?? []) {
    const parts = [...si.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1]));
    out.push(parts.join(''));
  }
  return out;
}

function columnIndex(ref) {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** One worksheet (xl/worksheets/sheetN.xml) as raw rows. Dates stay numbers; formulas give their cached value. */
export function parseSheetXml(xml, shared = []) {
  const rows = [];
  for (const rowXml of xml.match(/<row\b[\s\S]*?<\/row>/g) ?? []) {
    const row = [];
    for (const m of rowXml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = m[1];
      const ref = /\br="([A-Z]+\d+)"/i.exec(attrs)?.[1] ?? '';
      const type = /\bt="(\w+)"/.exec(attrs)?.[1] ?? 'n';
      const inner = m[2] ?? '';
      let value = '';
      if (type === 's') value = shared[Number(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1])] ?? '';
      else if (type === 'inlineStr') value = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => decodeXml(x[1])).join('');
      else value = decodeXml(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '');
      if (type === 'b') value = value === '1' ? 'true' : 'false';
      const idx = ref ? columnIndex(ref) : row.length;
      while (row.length < idx) row.push('');
      row[idx] = value;
    }
    rows.push(row);
    if (rows.length > MAX_TABLE_ROWS + 1) break;
  }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

/* ---------------- describing a table for a language model ---------------- */

const NUMBER = /^-?\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d+)?$|^-?\d+(?:[.,]\d+)?$/;
const DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?$|^\d{1,2}\.\d{1,2}\.\d{2,4}$|^\d{1,2}\/\d{1,2}\/\d{2,4}$/;

/** text | number | date | boolean | empty, by what the filled cells look like. */
export function inferType(values) {
  const filled = values.filter((v) => v !== '');
  if (filled.length === 0) return 'empty';
  const all = (re) => filled.every((v) => re.test(v));
  if (filled.every((v) => /^(true|false|yes|no|ja|nein)$/i.test(v))) return 'boolean';
  if (all(NUMBER)) return 'number';
  if (all(DATE)) return 'date';
  return 'text';
}

export function describeColumns(table) {
  return table.columns.map((name, i) => {
    const values = table.rows.map((r) => r[i]);
    const filled = values.filter((v) => v !== '');
    const distinct = new Set(filled);
    const type = inferType(values);
    const info = { name, type, filled: filled.length, empty: values.length - filled.length, distinct: distinct.size };
    if (type === 'number') {
      const nums = filled.map((v) => Number(v.replace(/\s/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'))).filter(Number.isFinite);
      if (nums.length) { info.min = Math.min(...nums); info.max = Math.max(...nums); }
    } else if (type === 'text' && distinct.size > 0 && distinct.size <= 8) info.values = [...distinct];
    return info;
  });
}

/**
 * A compact description of a table: size, columns with types and ranges, and a few sample rows.
 * A model gets this instead of tens of thousands of raw lines, and the file path to read the rest.
 */
export function summarizeTable(name, table, { sampleRows = 5 } = {}) {
  const cols = describeColumns(table);
  const lines = [`Table "${name}": ${table.rows.length.toLocaleString('en-US')} rows, ${table.columns.length} columns${table.truncated ? ` (only the first ${MAX_TABLE_ROWS.toLocaleString('en-US')} rows read)` : ''}.`, 'Columns:'];
  for (const c of cols) {
    const bits = [c.type];
    if (c.empty) bits.push(`${c.empty} empty`);
    if (c.min !== undefined) bits.push(`range ${c.min}–${c.max}`);
    if (c.values) bits.push(`values: ${c.values.join(' | ')}`);
    else if (c.type === 'text') bits.push(`${c.distinct} distinct`);
    lines.push(`- ${c.name} (${bits.join(', ')})`);
  }
  const sample = table.rows.slice(0, sampleRows);
  if (sample.length) {
    lines.push(`First ${sample.length} rows:`, table.columns.join(' | '), ...sample.map((r) => r.map((c) => c.slice(0, 60)).join(' | ')));
  }
  return lines.join('\n');
}

/* ---------------- batches for a webhook ---------------- */

/** Rows as objects keyed by column name. */
export function rowsAsObjects(table) {
  return table.rows.map((r) => Object.fromEntries(table.columns.map((c, i) => [c, r[i]])));
}

/**
 * Cuts a table into batches. Every batch has the same batchId (one upload), its own index, and the total,
 * so the receiving workflow can be idempotent and show progress.
 */
export function buildBatches({ fileName, table, batchSize = DEFAULT_BATCH_SIZE, batchId }) {
  const size = Math.max(1, Math.min(1000, Math.floor(Number(batchSize)) || DEFAULT_BATCH_SIZE));
  const objects = rowsAsObjects(table);
  const total = Math.max(1, Math.ceil(objects.length / size));
  const batches = [];
  for (let i = 0; i < total; i += 1) {
    batches.push({
      batchId,
      source: String(fileName).slice(0, 180),
      index: i + 1,
      total,
      totalRows: objects.length,
      offset: i * size,
      columns: table.columns,
      rows: objects.slice(i * size, (i + 1) * size),
    });
  }
  return batches;
}

/** Only https (plain http only on this computer), no credentials in the address. */
export function checkWebhookUrl(raw) {
  let url;
  try { url = new URL(String(raw).trim()); } catch { throw new Error('This is not a web address.'); }
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('The webhook address must use https.');
  if (url.username || url.password) throw new Error('Do not put a user name or password in the address.');
  return url.href;
}

/* ---------------- a table Space ---------------- */

const escHtml = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Slug from a title: lower case, a-z 0-9 and hyphens. */
export function slugify(title, fallback = 'tables') {
  return String(title).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || fallback;
}

/**
 * A self-contained Space page for one or more tables: tabs, search, sortable columns, a column summary and a
 * button that asks the chat about what is on screen. No network, no external files. At most MAX_SPACE_ROWS rows per table.
 */
export function buildTableSpaceHtml({ title, tables }) {
  const data = tables.map((t) => ({
    name: String(t.name).slice(0, 120),
    columns: t.table.columns,
    types: describeColumns(t.table).map((c) => c.type),
    rows: t.table.rows.slice(0, MAX_SPACE_ROWS),
    total: t.table.rows.length,
  }));
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(title)}</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--ink:#1d2330;--muted:#667085;--line:#e4e7ec;--head:#f5f6f8;--acc:#6d28d9}
@media (prefers-color-scheme:dark){:root{--bg:#14161b;--ink:#e8eaf0;--muted:#98a2b3;--line:#2a2f3a;--head:#1c2027;--acc:#a78bfa}}
body{margin:0;font:14px/1.45 system-ui,sans-serif;background:var(--bg);color:var(--ink);padding:18px}
h1{font-size:18px;margin:0 0 4px}.sub{color:var(--muted);margin:0 0 14px;font-size:13px}
.tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
.tabs button,.bar button{border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:8px;padding:5px 10px;font:inherit;cursor:pointer}
.tabs button[aria-pressed=true]{border-color:var(--acc);color:var(--acc);font-weight:600}
.bar{display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap}
.bar input{flex:1;min-width:180px;border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:8px;padding:6px 10px;font:inherit}
.cols{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 10px}.cols span{font-size:12px;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:1px 8px}
.wrap{overflow:auto;max-height:68vh;border:1px solid var(--line);border-radius:8px}
table{border-collapse:collapse;width:100%}th,td{padding:6px 10px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap;max-width:360px;overflow:hidden;text-overflow:ellipsis}
th{position:sticky;top:0;background:var(--head);cursor:pointer;user-select:none}td.n{text-align:right;font-variant-numeric:tabular-nums}
.note{color:var(--muted);font-size:12px;margin-top:8px}
</style></head><body>
<h1>${escHtml(title)}</h1>
<p class="sub" id="sub"></p>
<div class="tabs" id="tabs"></div>
<div class="bar"><input id="q" type="search" placeholder="Search all columns" aria-label="Search all columns"><span id="count" class="sub"></span><button id="ask">Ask about this table</button></div>
<div class="cols" id="cols"></div>
<div class="wrap"><table><thead id="head"></thead><tbody id="body"></tbody></table></div>
<p class="note" id="note"></p>
<script type="application/json" id="data">${json}</script>
<script>
const D=JSON.parse(document.getElementById('data').textContent);
const $=s=>document.querySelector(s);const esc=t=>String(t).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const st={t:0,q:'',sort:-1,dir:1};
const num=v=>Number(String(v).replace(/\\s/g,'').replace(/\\.(?=\\d{3}\\b)/g,'').replace(',','.'));
function rows(){const t=D[st.t];let r=t.rows;const q=st.q.trim().toLowerCase();
 if(q)r=r.filter(x=>x.some(c=>c.toLowerCase().includes(q)));
 if(st.sort>=0){const i=st.sort,isN=t.types[i]==='number';r=[...r].sort((a,b)=>(isN?num(a[i])-num(b[i]):a[i].localeCompare(b[i]))*st.dir)}
 return r}
function draw(){const t=D[st.t],r=rows();
 $('#sub').textContent=D.length+' table'+(D.length>1?'s':'')+' · '+t.total.toLocaleString('en-US')+' rows · '+t.columns.length+' columns';
 $('#tabs').innerHTML=D.map((x,i)=>'<button aria-pressed="'+(i===st.t)+'" data-t="'+i+'">'+esc(x.name)+'</button>').join('');
 $('#cols').innerHTML=t.columns.map((c,i)=>'<span>'+esc(c)+' · '+t.types[i]+'</span>').join('');
 $('#head').innerHTML='<tr>'+t.columns.map((c,i)=>'<th data-c="'+i+'">'+esc(c)+(st.sort===i?(st.dir>0?' ▲':' ▼'):'')+'</th>').join('')+'</tr>';
 $('#body').innerHTML=r.slice(0,500).map(x=>'<tr>'+x.map((c,i)=>'<td'+(t.types[i]==='number'?' class="n"':'')+' title="'+esc(c)+'">'+esc(c)+'</td>').join('')+'</tr>').join('');
 $('#count').textContent=r.length.toLocaleString('en-US')+' shown'+(r.length>500?' (first 500)':'');
 $('#note').textContent=t.total>t.rows.length?'This Space holds the first '+t.rows.length.toLocaleString('en-US')+' of '+t.total.toLocaleString('en-US')+' rows.':''}
document.addEventListener('click',e=>{const b=e.target.closest('[data-t]');if(b){st.t=+b.dataset.t;st.sort=-1;draw();return}
 const h=e.target.closest('th[data-c]');if(h){const c=+h.dataset.c;st.dir=st.sort===c?-st.dir:1;st.sort=c;draw()}});
$('#q').addEventListener('input',e=>{st.q=e.target.value;draw()});
$('#ask').addEventListener('click',()=>{const t=D[st.t];const p='Analyse the table "'+t.name+'" ('+t.total+' rows; columns: '+t.columns.join(', ')+')'+(st.q?', filtered by "'+st.q+'"':'')+'. What stands out?';
 window.parent.postMessage({type:'wb:ask',prompt:p.slice(0,600)},'*')});
draw();
</script></body></html>
`;
}
