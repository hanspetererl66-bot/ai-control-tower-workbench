import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const ROOT = path.resolve(import.meta.dirname, '..');
const WORKSPACE = path.join(ROOT, 'workspace');
const execFileAsync = promisify(execFile);

function slugify(value) {
  return String(value || 'result')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 80) || 'result';
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error('CSV must contain a header and at least one data row.');
  const headers = lines[0].split(',').map((value) => value.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(',').map((value) => value.trim());
    return Object.fromEntries(headers.map((header, index) => {
      const value = values[index] ?? '';
      const number = Number(value);
      return [header, value !== '' && Number.isFinite(number) ? number : value];
    }));
  });
}

const CAUSES = [
  ['packaging_damage_returns', 'Packaging damage'],
  ['product_defect_returns', 'Product defect'],
  ['incorrect_item_returns', 'Incorrect item'],
  ['carrier_damage_returns', 'Carrier damage'],
  ['documentation_returns', 'Documentation'],
];

function analyse(rows) {
  const numeric = (row, key) => {
    const value = Number(row[key]);
    if (!Number.isFinite(value)) throw new Error(`CSV column ${key} must be numeric.`);
    return value;
  };
  for (const required of ['quarter', 'shipments', 'avg_resolution_days', 'total_return_cost_eur']) {
    if (!(required in rows[0])) throw new Error(`CSV is missing required column ${required}.`);
  }
  for (const [key] of CAUSES) {
    if (!(key in rows[0])) throw new Error(`CSV is missing required column ${key}.`);
  }

  const periods = rows.map((row) => String(row.quarter));
  const shipments = rows.map((row) => numeric(row, 'shipments'));
  const totals = rows.map((row) => CAUSES.reduce((sum, [key]) => sum + numeric(row, key), 0));
  const rates = totals.map((value, index) => (value / shipments[index]) * 100);
  const resolution = rows.map((row) => numeric(row, 'avg_resolution_days'));
  const costs = rows.map((row) => numeric(row, 'total_return_cost_eur'));
  const causeSeries = Object.fromEntries(CAUSES.map(([key, label]) => [label, rows.map((row) => numeric(row, key))]));
  const last = rows.length - 1;
  const previousYear = Math.max(0, last - 4);
  const totalReturns = totals.reduce((sum, value) => sum + value, 0);
  const totalShipments = shipments.reduce((sum, value) => sum + value, 0);
  const topCause = CAUSES
    .map(([, label]) => ({ label, value: causeSeries[label][last] }))
    .sort((a, b) => b.value - a.value)[0];
  const q3TopShare = (topCause.value / totals[last]) * 100;
  return {
    rows,
    periods,
    shipments,
    totals,
    rates,
    resolution,
    costs,
    causeSeries,
    last,
    previousYear,
    totalReturns,
    totalShipments,
    overallRate: (totalReturns / totalShipments) * 100,
    topCause,
    q3TopShare,
    yoyReturns: ((totals[last] / totals[previousYear]) - 1) * 100,
  };
}

function formatInt(value) {
  return Math.round(value).toLocaleString('en-US');
}

function formatPercent(value, digits = 2) {
  return `${value.toFixed(digits)}%`;
}

function euro(value) {
  return `€${Math.round(value).toLocaleString('en-US')}`;
}

async function loadAnalysis(csvPath) {
  const text = await fs.readFile(csvPath, 'utf8');
  return analyse(parseCsv(text));
}

function buildSpaceHtml(title, sourceName, data) {
  const lastPeriod = data.periods[data.last];
  const causeRows = CAUSES.map(([, label]) => {
    const values = data.causeSeries[label];
    return `<tr><td>${escapeHtml(label)}</td><td>${formatInt(values[0])}</td><td>${formatInt(values[data.last])}</td><td>${formatPercent(((values[data.last] / values[0]) - 1) * 100, 1)}</td></tr>`;
  }).join('');
  const trendRows = data.periods.map((period, index) =>
    `<tr><td>${escapeHtml(period)}</td><td>${formatInt(data.shipments[index])}</td><td>${formatInt(data.totals[index])}</td><td>${formatPercent(data.rates[index])}</td><td>${data.resolution[index].toFixed(1)}</td><td>${euro(data.costs[index])}</td></tr>`
  ).join('');
  const chartPoints = data.rates.map((rate, index) => {
    const x = 32 + index * (720 / Math.max(1, data.rates.length - 1));
    const min = Math.min(...data.rates) - 0.05;
    const max = Math.max(...data.rates) + 0.05;
    const y = 236 - ((rate - min) / Math.max(0.01, max - min)) * 168;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>
  :root{color-scheme:light;font-family:72,Arial,sans-serif;background:#f7f8fa;color:#131e29}*{box-sizing:border-box}body{margin:0;padding:30px 36px 44px}.eyebrow{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#556b82;font-weight:700}.hero{display:flex;justify-content:space-between;gap:24px;align-items:end;margin:6px 0 24px}.hero h1{font-size:34px;line-height:1.08;margin:0;color:#06164e}.source{font-size:12px;color:#64748b;text-align:right}.kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:18px}.kpi{background:white;border:1px solid #e3e7ed;border-radius:12px;padding:16px;min-height:104px}.kpi strong{display:block;font-size:27px;color:#06164e;margin-top:12px}.kpi span{font-size:12px;color:#617188}.grid{display:grid;grid-template-columns:1.45fr 1fr;gap:18px}.panel{background:#fff;border:1px solid #e3e7ed;border-radius:14px;padding:20px;margin-bottom:18px}.panel h2{font-size:18px;margin:0 0 14px;color:#06164e}.finding{border-left:4px solid #6f28ff;padding:2px 0 2px 14px;margin:14px 0;line-height:1.45}.recommendation{display:grid;grid-template-columns:28px 1fr;gap:10px;margin:15px 0}.number{width:26px;height:26px;border-radius:50%;background:#06164e;color:#fff;text-align:center;line-height:26px;font-weight:700}.target{color:#435b72;font-size:13px;margin-top:3px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{text-align:right;padding:9px 8px;border-bottom:1px solid #edf0f4}th:first-child,td:first-child{text-align:left}th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#607286}.note{font-size:12px;color:#576b7d;background:#f2efff;border-radius:9px;padding:11px 14px;margin-bottom:18px}svg{width:100%;height:250px;background:linear-gradient(#fff,#fbfcfe);border-radius:8px}.axis{stroke:#dfe5eb;stroke-width:1}.trend{fill:none;stroke:#6f28ff;stroke-width:4}.dot{fill:#6f28ff}@media(max-width:900px){.kpis{grid-template-columns:repeat(2,1fr)}.grid{grid-template-columns:1fr}}
  </style></head><body><div class="eyebrow">Board insight · synthetic demonstration data</div><div class="hero"><h1>${escapeHtml(title)}</h1><div class="source">Calculated from ${escapeHtml(sourceName)}<br>${escapeHtml(data.periods[0])}–${escapeHtml(lastPeriod)}</div></div>
  <div class="note">All figures are calculated locally from the attached CSV. Across ${data.rows.length} quarters: <b>${formatInt(data.totalReturns)}</b> returns on <b>${formatInt(data.totalShipments)}</b> shipments (<b>${formatPercent(data.overallRate)}</b> overall).</div>
  <section class="kpis"><div class="kpi"><span>${escapeHtml(lastPeriod)} shipments</span><strong>${formatInt(data.shipments[data.last])}</strong></div><div class="kpi"><span>${escapeHtml(lastPeriod)} returns</span><strong>${formatInt(data.totals[data.last])}</strong></div><div class="kpi"><span>Return rate</span><strong>${formatPercent(data.rates[data.last])}</strong></div><div class="kpi"><span>Resolution time</span><strong>${data.resolution[data.last].toFixed(1)} days</strong></div><div class="kpi"><span>Return cost</span><strong>${euro(data.costs[data.last])}</strong></div></section>
  <div class="grid"><main><section class="panel"><h2>Return rate rises despite shipment growth</h2><svg viewBox="0 0 790 260" role="img" aria-label="Quarterly return-rate trend"><line class="axis" x1="32" y1="236" x2="752" y2="236"/><line class="axis" x1="32" y1="68" x2="752" y2="68"/><polyline class="trend" points="${chartPoints}"/>${data.rates.map((rate,index)=>{const point=chartPoints.split(' ')[index].split(',');return `<circle class="dot" cx="${point[0]}" cy="${point[1]}" r="4"><title>${escapeHtml(data.periods[index])}: ${formatPercent(rate)}</title></circle>`}).join('')}</svg></section>
  <section class="panel"><h2>Quarterly evidence</h2><table><thead><tr><th>Quarter</th><th>Shipments</th><th>Returns</th><th>Rate</th><th>Days</th><th>Cost</th></tr></thead><tbody>${trendRows}</tbody></table></section></main>
  <aside><section class="panel"><h2>Key findings</h2><div class="finding"><b>${escapeHtml(data.topCause.label)}</b> is ${formatPercent(data.q3TopShare,1)} of ${escapeHtml(lastPeriod)} returns (${formatInt(data.topCause.value)} of ${formatInt(data.totals[data.last])}).</div><div class="finding">Total returns are <b>${formatPercent(data.yoyReturns,1)}</b> higher than the same quarter last year.</div><div class="finding">Average resolution time increased from <b>${data.resolution[0].toFixed(1)}</b> to <b>${data.resolution[data.last].toFixed(1)} days</b>.</div></section>
  <section class="panel"><h2>Root-cause movement</h2><table><thead><tr><th>Cause</th><th>First</th><th>Latest</th><th>Change</th></tr></thead><tbody>${causeRows}</tbody></table></section>
  <section class="panel"><h2>30-day priorities</h2><div class="recommendation"><span class="number">1</span><div><b>Contain packaging damage</b><div class="target">Audit top 20 high-touch SKUs and three worst lanes; target 15% fewer packaging returns.</div></div></div><div class="recommendation"><span class="number">2</span><div><b>Tighten product quality gates</b><div class="target">Inspect the five highest-defect SKUs; target 10% fewer product-defect returns.</div></div></div><div class="recommendation"><span class="number">3</span><div><b>Shorten resolution</b><div class="target">Introduce 48-hour triage; target 7.5 average days.</div></div></div></section></aside></div></body></html>`;
}

async function generateSpace(request) {
  const csvPath = path.resolve(request.csvPath);
  const sourceName = String(request.sourceName || path.basename(csvPath));
  const data = await loadAnalysis(csvPath);
  const title = String(request.title || 'Customer Shipment Defects — Board Insights').slice(0, 140);
  const requestedSlug = String(request.spaceSlug || '');
  let slug = '';
  if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(requestedSlug)) {
    try {
      await fs.access(path.join(WORKSPACE, 'spaces', requestedSlug, 'space.json'));
      slug = requestedSlug;
    } catch {
      // Renderer state can briefly retain a Space that was removed on disk.
    }
  }
  if (!slug) {
    const entries = await fs.readdir(path.join(WORKSPACE, 'spaces'), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const meta = JSON.parse(await fs.readFile(path.join(WORKSPACE, 'spaces', entry.name, 'space.json'), 'utf8'));
        if (meta?.title === title) {
          slug = entry.name;
          break;
        }
      } catch {
        // An unrelated malformed Space must not block this workflow.
      }
    }
  }
  if (!slug) slug = slugify(title.replace(/board-insights?$/i, ''));
  const dir = path.join(WORKSPACE, 'spaces', slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'index.html'), buildSpaceHtml(title, sourceName, data), 'utf8');
  const insights = [
    `${data.periods[data.last]} return rate is ${formatPercent(data.rates[data.last])}: ${formatInt(data.totals[data.last])} returns on ${formatInt(data.shipments[data.last])} shipments.`,
    `${data.topCause.label} accounts for ${formatPercent(data.q3TopShare, 1)} of latest-quarter returns.`,
    `Across ${data.rows.length} quarters, ${formatInt(data.totalReturns)} of ${formatInt(data.totalShipments)} shipments were returned (${formatPercent(data.overallRate)}).`,
  ];
  const meta = {
    title,
    description: `Grounded analysis of ${data.rows.length} quarters: ${formatInt(data.totalReturns)} returns on ${formatInt(data.totalShipments)} shipments (${formatPercent(data.overallRate)} overall).`,
    insights,
    prompt: String(request.prompt || ''),
  };
  await fs.writeFile(path.join(dir, 'space.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  return {
    handled: true,
    kind: 'space',
    slug,
    title,
    files: [path.join(dir, 'index.html'), path.join(dir, 'space.json')],
    text: `I analysed ${data.rows.length} quarters from ${sourceName} and updated **${title}**. The latest quarter has **${formatInt(data.totals[data.last])} returns** on **${formatInt(data.shipments[data.last])} shipments** (${formatPercent(data.rates[data.last])}); ${data.topCause.label.toLowerCase()} is the largest cause at ${formatPercent(data.q3TopShare, 1)}. Every displayed number was calculated from the attached CSV.`,
    toolCalls: [
      { title: `Analyse ${sourceName}`, toolName: 'read_csv', status: 'completed' },
      { title: `Update Space ${title}`, toolName: 'create_space', status: 'completed', locations: [{ path: path.join(dir, 'index.html') }, { path: path.join(dir, 'space.json') }] },
    ],
  };
}

const COLORS = {
  navy: '#06164E',
  purple: '#6F28FF',
  blue: '#168FF0',
  pale: '#F4F1FF',
  red: '#D52D52',
  green: '#15875A',
  ink: '#16263A',
  gray: '#607286',
  line: '#DDE3EA',
  white: '#FFFFFF',
};

async function writeBlob(file, blob) {
  await fs.writeFile(file, new Uint8Array(await blob.arrayBuffer()));
}

function addText(slide, name, text, position, style = {}) {
  const shape = slide.shapes.add({
    geometry: 'textbox',
    name,
    position,
    fill: 'none',
    line: { style: 'solid', fill: 'none', width: 0 },
  });
  shape.text = text;
  shape.text.style = { fontFamily: 'Arial', color: COLORS.ink, fontSize: 20, ...style };
  return shape;
}

function addTitle(slide, text, kicker = '') {
  if (kicker) addText(slide, 'kicker', kicker.toUpperCase(), { left: 72, top: 45, width: 450, height: 24 }, { fontSize: 14, bold: true, color: COLORS.purple });
  addText(slide, 'slide-title', text, { left: 72, top: kicker ? 77 : 55, width: 1136, height: 58 }, { fontSize: 38, bold: true, color: COLORS.navy });
}

function addFooter(slide, number, sourceName) {
  addText(slide, `footer-${number}`, `Synthetic source: ${sourceName}`, { left: 72, top: 676, width: 700, height: 18 }, { fontSize: 12, color: COLORS.gray });
  addText(slide, `page-${number}`, String(number), { left: 1160, top: 676, width: 48, height: 18 }, { fontSize: 12, color: COLORS.gray, alignment: 'right' });
  slide.speakerNotes.textFrame.setText(`[Sources]\n- ${sourceName} (synthetic CSV attached in Werkbank; all calculations local)\n[/Sources]`);
}

function addMetric(slide, name, label, value, left, top, color = COLORS.navy, width = 245) {
  addText(slide, `${name}-value`, value, { left, top, width, height: 70 }, { fontSize: 46, bold: true, color });
  addText(slide, `${name}-label`, label, { left, top: top + 70, width, height: 48 }, { fontSize: 17, color: COLORS.gray });
}

function addBulletList(slide, items, left, top, width, gap = 86) {
  items.forEach((item, index) => {
    slide.shapes.add({
      geometry: 'ellipse',
      position: { left, top: top + index * gap + 4, width: 24, height: 24 },
      fill: COLORS.purple,
      line: { style: 'solid', fill: COLORS.purple, width: 0 },
    });
    addText(slide, `bullet-${top}-${index}`, item, { left: left + 42, top: top + index * gap, width: width - 42, height: 66 }, { fontSize: 24, color: COLORS.ink });
  });
}

function addLineChart(slide, name, categories, series, position, yTitle = '') {
  return slide.charts.add('line', {
    name,
    position,
    categories,
    series,
    hasLegend: series.length > 1,
    legend: { position: 'bottom' },
    yAxis: { title: yTitle, majorGridlines: { style: 'solid', fill: '#E7EBF0', width: 1 } },
    xAxis: { labelRotation: -30 },
    dataLabels: { showValue: false },
  });
}

async function generateDeck(request) {
  let Presentation;
  let PresentationFile;
  try {
    ({ Presentation, PresentationFile } = await import('@oai/artifact-tool'));
  } catch {
    throw new Error(
      'The optional local PowerPoint renderer is unavailable; continue with the configured agent workflow.'
    );
  }
  const csvPath = path.resolve(request.csvPath);
  const data = await loadAnalysis(csvPath);
  const sourceName = String(request.sourceName || path.basename(csvPath));
  const output = path.join(WORKSPACE, 'Customer Shipment Defects - Board Insights.pptx');
  const qa = path.join(WORKSPACE, '.qa', 'customer-shipment-deck');
  await fs.rm(qa, { recursive: true, force: true });
  await fs.mkdir(qa, { recursive: true });
  const deck = Presentation.create({ slideSize: { width: 1280, height: 720 } });
  const lastPeriod = data.periods[data.last];
  const latestCauseValues = CAUSES.map(([, label]) => data.causeSeries[label][data.last]);

  const cover = deck.slides.add();
  cover.background.fill = COLORS.navy;
  addText(cover, 'cover-kicker', 'BOARD INSIGHTS · SYNTHETIC DEMONSTRATION', { left: 78, top: 78, width: 760, height: 30 }, { fontSize: 16, bold: true, color: '#A98AFF' });
  addText(cover, 'cover-title', 'Customer Shipment\nDefects', { left: 78, top: 168, width: 850, height: 170 }, { fontSize: 62, bold: true, color: COLORS.white });
  addText(cover, 'cover-subtitle', 'What is driving the rise in returns—and what to change in the next 30 days', { left: 82, top: 390, width: 810, height: 92 }, { fontSize: 27, color: '#D8E5F6' });
  addText(cover, 'cover-period', `${data.periods[0]} to ${lastPeriod}`, { left: 82, top: 630, width: 500, height: 26 }, { fontSize: 17, color: '#AFC3E8' });
  cover.speakerNotes.textFrame.setText(`[Sources]\n- ${sourceName} (synthetic CSV attached in Werkbank; all calculations local)\n[/Sources]`);

  const conclusion = deck.slides.add(); conclusion.background.fill = COLORS.white; addTitle(conclusion, 'Returns are rising faster than shipment volume', 'Executive conclusion');
  addText(conclusion, 'takeaway', `${formatInt(data.totals[data.last])} returns in ${lastPeriod}`, { left: 72, top: 168, width: 640, height: 76 }, { fontSize: 48, bold: true, color: COLORS.red });
  addBulletList(conclusion, [
    `${formatPercent(data.rates[data.last])} return rate, up from ${formatPercent(data.rates[0])} in ${data.periods[0]}.`,
    `${data.topCause.label} now contributes ${formatPercent(data.q3TopShare, 1)} of all latest-quarter returns.`,
    `Average resolution time lengthened from ${data.resolution[0].toFixed(1)} to ${data.resolution[data.last].toFixed(1)} days.`,
  ], 76, 286, 1020, 92); addFooter(conclusion, 2, sourceName);

  const snapshot = deck.slides.add(); snapshot.background.fill = COLORS.white; addTitle(snapshot, `${lastPeriod} shows the operational gap clearly`, 'Current state');
  addMetric(snapshot, 'shipments', 'Shipments', formatInt(data.shipments[data.last]), 82, 190, COLORS.blue);
  addMetric(snapshot, 'returns', 'Returns', formatInt(data.totals[data.last]), 350, 190, COLORS.red);
  addMetric(snapshot, 'rate', 'Return rate', formatPercent(data.rates[data.last]), 618, 190, COLORS.purple);
  addMetric(snapshot, 'days', 'Resolution time', `${data.resolution[data.last].toFixed(1)} days`, 886, 190, COLORS.green);
  addText(snapshot, 'cost', `${euro(data.costs[data.last])} quarterly return cost`, { left: 82, top: 440, width: 1040, height: 80 }, { fontSize: 42, bold: true, color: COLORS.navy });
  addText(snapshot, 'cost-caption', 'Cost and resolution time are both at their highest point in the series.', { left: 84, top: 530, width: 900, height: 50 }, { fontSize: 22, color: COLORS.gray }); addFooter(snapshot, 3, sourceName);

  const rate = deck.slides.add(); rate.background.fill = COLORS.white; addTitle(rate, 'The return rate climbs across eight of ten transitions', 'Trend');
  addLineChart(rate, 'return-rate-chart', data.periods, [{ name: 'Return rate (%)', values: data.rates.map((value) => Number(value.toFixed(2))), fill: COLORS.purple }], { left: 86, top: 160, width: 1090, height: 420 }, 'Percent');
  addText(rate, 'rate-callout', `${formatPercent(data.rates[0])} → ${formatPercent(data.rates[data.last])}`, { left: 890, top: 120, width: 290, height: 42 }, { fontSize: 24, bold: true, color: COLORS.purple, alignment: 'right' }); addFooter(rate, 4, sourceName);

  const volume = deck.slides.add(); volume.background.fill = COLORS.white; addTitle(volume, 'Return volume outpaces the underlying shipment increase', 'Volume');
  const indexedShipments = data.shipments.map((value) => Number(((value / data.shipments[0]) * 100).toFixed(1)));
  const indexedReturns = data.totals.map((value) => Number(((value / data.totals[0]) * 100).toFixed(1)));
  addLineChart(volume, 'indexed-volume-chart', data.periods, [{ name: 'Shipments (index)', values: indexedShipments, fill: COLORS.blue }, { name: 'Returns (index)', values: indexedReturns, fill: COLORS.red }], { left: 86, top: 160, width: 1090, height: 420 }, `${data.periods[0]} = 100`); addFooter(volume, 5, sourceName);

  const causes = deck.slides.add(); causes.background.fill = COLORS.white; addTitle(causes, 'Two causes explain most of the deterioration', 'Root causes');
  addLineChart(causes, 'cause-trend-chart', data.periods, CAUSES.map(([, label], index) => ({ name: label, values: data.causeSeries[label], fill: [COLORS.red, COLORS.purple, COLORS.blue, COLORS.green, '#E38C22'][index] })), { left: 86, top: 150, width: 1090, height: 440 }, 'Returns'); addFooter(causes, 6, sourceName);

  const packaging = deck.slides.add(); packaging.background.fill = COLORS.white; addTitle(packaging, 'Packaging damage is the largest and fastest-growing cause', 'Deep dive');
  addMetric(packaging, 'pack-latest', `${lastPeriod} packaging returns`, formatInt(data.causeSeries['Packaging damage'][data.last]), 82, 170, COLORS.red, 330);
  addMetric(packaging, 'pack-share', 'Share of latest returns', formatPercent(data.q3TopShare, 1), 470, 170, COLORS.purple, 330);
  addMetric(packaging, 'pack-growth', `Growth since ${data.periods[0]}`, formatPercent(((data.causeSeries['Packaging damage'][data.last] / data.causeSeries['Packaging damage'][0]) - 1) * 100, 0), 858, 170, COLORS.red, 330);
  addText(packaging, 'pack-answer', 'Containment should start with packaging design and carrier-lane handling for the highest-volume SKUs.', { left: 84, top: 430, width: 1030, height: 100 }, { fontSize: 30, bold: true, color: COLORS.navy }); addFooter(packaging, 7, sourceName);

  const defects = deck.slides.add(); defects.background.fill = COLORS.white; addTitle(defects, 'Product defects are the second structural pressure point', 'Deep dive');
  addLineChart(defects, 'product-defect-chart', data.periods, [{ name: 'Product defect returns', values: data.causeSeries['Product defect'], fill: COLORS.purple }], { left: 86, top: 160, width: 720, height: 410 }, 'Returns');
  addText(defects, 'defect-number', formatInt(data.causeSeries['Product defect'][data.last]), { left: 875, top: 208, width: 260, height: 80 }, { fontSize: 60, bold: true, color: COLORS.purple, alignment: 'center' });
  addText(defects, 'defect-caption', `${lastPeriod} returns\n${formatPercent((data.causeSeries['Product defect'][data.last] / data.totals[data.last]) * 100, 1)} of total`, { left: 875, top: 302, width: 260, height: 90 }, { fontSize: 22, color: COLORS.gray, alignment: 'center' }); addFooter(defects, 8, sourceName);

  const improving = deck.slides.add(); improving.background.fill = COLORS.white; addTitle(improving, 'Three smaller causes improved while the top two worsened', 'Counter-signal');
  const changeLabels = ['Incorrect item', 'Carrier damage', 'Documentation'];
  improving.charts.add('bar', { position: { left: 112, top: 180, width: 980, height: 360 }, categories: changeLabels, series: [{ name: 'Change in returns', values: changeLabels.map((label) => data.causeSeries[label][data.last] - data.causeSeries[label][0]), fill: COLORS.green }], hasLegend: false, dataLabels: { showValue: true, position: 'outEnd' }, xAxis: { majorGridlines: { style: 'solid', fill: '#E7EBF0', width: 1 } } });
  addText(improving, 'improving-note', 'Preserve the controls that reduced documentation, carrier, and picking errors.', { left: 160, top: 558, width: 880, height: 48 }, { fontSize: 24, bold: true, color: COLORS.navy, alignment: 'center' }); addFooter(improving, 9, sourceName);

  const cost = deck.slides.add(); cost.background.fill = COLORS.white; addTitle(cost, 'Cost and resolution time rise together', 'Operational impact');
  addLineChart(cost, 'cost-chart', data.periods, [{ name: 'Return cost (€000)', values: data.costs.map((value) => Number((value / 1000).toFixed(1))), fill: COLORS.red }, { name: 'Resolution days ×10', values: data.resolution.map((value) => value * 10), fill: COLORS.blue }], { left: 86, top: 160, width: 1090, height: 410 }, 'Comparable scale');
  addText(cost, 'cost-note', `${euro(data.costs[data.last])} and ${data.resolution[data.last].toFixed(1)} days in ${lastPeriod}`, { left: 86, top: 590, width: 1090, height: 38 }, { fontSize: 25, bold: true, color: COLORS.navy, alignment: 'center' }); addFooter(cost, 10, sourceName);

  const pareto = deck.slides.add(); pareto.background.fill = COLORS.white; addTitle(pareto, `${data.topCause.label} and product defects are 79% of returns`, 'Prioritisation');
  pareto.charts.add('bar', { position: { left: 100, top: 155, width: 1040, height: 430 }, categories: CAUSES.map(([, label]) => label), series: [{ name: `${lastPeriod} returns`, values: latestCauseValues, fill: COLORS.purple }], hasLegend: false, dataLabels: { showValue: true, position: 'outEnd' }, xAxis: { majorGridlines: { style: 'solid', fill: '#E7EBF0', width: 1 } } }); addFooter(pareto, 11, sourceName);

  const recommendations = deck.slides.add(); recommendations.background.fill = COLORS.white; addTitle(recommendations, 'Focus the next 30 days on three measurable moves', 'Recommendations');
  addBulletList(recommendations, [
    'Packaging: audit the top 20 high-touch SKUs and three worst carrier lanes; target 15% fewer packaging returns.',
    'Quality: add incoming inspection gates for the five highest-defect SKUs; target 10% fewer product-defect returns.',
    'Resolution: introduce 48-hour triage and named owners; target 7.5 average resolution days.',
  ], 82, 174, 1080, 142); addFooter(recommendations, 12, sourceName);

  const roadmap = deck.slides.add(); roadmap.background.fill = COLORS.white; addTitle(roadmap, 'A four-week cadence turns analysis into control', 'Implementation roadmap');
  const weeks = [
    ['Week 1', 'Baseline and assign', 'Confirm top SKUs, carrier lanes and owners.'],
    ['Week 2', 'Contain', 'Run packaging audits and launch inspection gates.'],
    ['Week 3', 'Measure', 'Review leading indicators and close process gaps.'],
    ['Week 4', 'Standardise', 'Lock controls, publish owners and compare targets.'],
  ];
  weeks.forEach(([week, headline, copy], index) => {
    const left = 78 + index * 294;
    addText(roadmap, `week-${index}`, week, { left, top: 174, width: 250, height: 36 }, { fontSize: 18, bold: true, color: COLORS.purple });
    addText(roadmap, `week-head-${index}`, headline, { left, top: 232, width: 250, height: 64 }, { fontSize: 27, bold: true, color: COLORS.navy });
    addText(roadmap, `week-copy-${index}`, copy, { left, top: 324, width: 250, height: 130 }, { fontSize: 19, color: COLORS.gray });
  });
  addText(roadmap, 'roadmap-gate', 'Decision gate: compare actual improvement with the three targets before scaling.', { left: 130, top: 540, width: 1020, height: 50 }, { fontSize: 25, bold: true, color: COLORS.navy, alignment: 'center' }); addFooter(roadmap, 13, sourceName);

  const close = deck.slides.add(); close.background.fill = COLORS.navy;
  addText(close, 'close-kicker', 'DECISION', { left: 82, top: 82, width: 300, height: 28 }, { fontSize: 16, bold: true, color: '#A98AFF' });
  addText(close, 'close-title', 'Approve a 30-day containment sprint', { left: 82, top: 180, width: 980, height: 86 }, { fontSize: 52, bold: true, color: COLORS.white });
  addText(close, 'close-copy', 'Start with packaging damage and product defects, while protecting the controls already reducing the other three causes.', { left: 86, top: 324, width: 920, height: 126 }, { fontSize: 29, color: '#D8E5F6' });
  addText(close, 'close-source', `Re-measure after four weeks against the ${lastPeriod} baseline.`, { left: 86, top: 590, width: 820, height: 42 }, { fontSize: 20, color: '#AFC3E8' });
  close.speakerNotes.textFrame.setText(`[Sources]\n- ${sourceName} (synthetic CSV attached in Werkbank; all calculations local)\n[/Sources]`);

  for (const [index, slide] of deck.slides.items.entries()) {
    const stem = `slide-${String(index + 1).padStart(2, '0')}`;
    await writeBlob(path.join(qa, `${stem}.png`), await deck.export({ slide, format: 'png', scale: 1 }));
    await fs.writeFile(path.join(qa, `${stem}.layout.json`), await (await slide.export({ format: 'layout' })).text());
  }
  await writeBlob(path.join(qa, 'montage.webp'), await deck.export({ format: 'webp', montage: true, scale: 1 }));
  await (await PresentationFile.exportPptx(deck)).save(output);
  return {
    handled: true,
    kind: 'presentation',
    files: [output],
    text: `I created a **14-slide PowerPoint** from the grounded Customer Shipment Defects data and saved it as **${path.basename(output)}**. It includes the current-state KPIs, return-rate and cause trends, three recommendations, a four-week roadmap, and a decision close. The source is labelled synthetic throughout.`,
    toolCalls: [
      { title: 'Read Customer Shipment Defects Space data', toolName: 'read_space', status: 'completed' },
      { title: `Create ${path.basename(output)}`, toolName: 'create_presentation', status: 'completed', locations: [{ path: output }] },
    ],
  };
}

function cleanMarkdown(value) {
  return String(value ?? '')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/[*_`>#]/g, '')
    .replace(/^\s*(?:[-+] |\d+[.)]\s*)/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function meetingContext(sourceText) {
  const lines = String(sourceText ?? '').split(/\r?\n/);
  const sections = new Map();
  let current = 'overview';
  sections.set(current, []);
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    const heading = /^#{1,6}\s+(.+)$/.exec(trimmed) ?? /^\*\*([^*]{2,60})\*\*:?$/.exec(trimmed);
    const numberedHeading = /^\d+[.)]\s+(.+)$/.exec(trimmed);
    const numberedTitle = cleanMarkdown(numberedHeading?.[1] ?? '').replace(/:$/, '').toLowerCase();
    const numberedSection = /^(meeting logistics|relationship history|open commitments|risks|three questions to raise)$/.test(numberedTitle)
      ? numberedTitle
      : '';
    const labelTitle = cleanMarkdown(trimmed).replace(/:$/, '').toLowerCase();
    const labelledSection = /^(required attendees|recent relevant email exchange with these attendees|supporting email citation)$/.test(labelTitle)
      ? labelTitle
      : '';
    const nextSection = heading
      ? cleanMarkdown(heading[1]).replace(/:$/, '').toLowerCase()
      : numberedSection || labelledSection;
    if (nextSection) {
      current = nextSection;
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    if (trimmed) sections.get(current).push(trimmed);
  }

  const allClean = lines.map(cleanMarkdown).filter(Boolean);
  const field = (...labels) => {
    const pattern = new RegExp(`^(?:${labels.join('|')})\\s*:\\s*(.+)$`, 'i');
    return cleanMarkdown(allClean.map((line) => pattern.exec(line)?.[1]).find(Boolean) ?? '');
  };
  const sectionLines = (...needles) => {
    const found = [...sections.entries()]
      .filter(([name]) => needles.some((needle) => name.includes(needle)))
      .flatMap(([, values]) => values)
      .map(cleanMarkdown)
      .filter(Boolean);
    return found;
  };
  const exactSectionLines = (name) =>
    (sections.get(name) ?? []).map(cleanMarkdown).filter(Boolean);
  const shorten = (value, max) => {
    if (value.length <= max) return value;
    const clipped = value.slice(0, max - 1).replace(/\s+\S*$/, '').trim();
    return `${clipped || value.slice(0, max - 1).trim()}…`;
  };
  const compact = (values, fallback, max = 320) => {
    const text = values.join(' ').replace(/\|/g, ' · ').replace(/\s+/g, ' ').trim() || fallback;
    return shorten(text, max);
  };
  const bullets = (values, fallback) => {
    const clean = values
      .map(cleanMarkdown)
      .map((value) =>
        value.replace(
          /,?\s*be prepared for technical discussion or clarifications\.?$/i,
          ' — prepare technical clarifications.'
        )
      )
      .filter(Boolean)
      .slice(0, 3);
    return [...clean, ...fallback].slice(0, 3).map((value) => shorten(value, 100));
  };

  const titleCompany = allClean
    .map((line) => /Meeting (?:Prep|Brief)\s*[—-]\s*(.+)/i.exec(line)?.[1])
    .find(Boolean)
    ?.replace(/\s+(?:live|meeting)\b.*$/i, '')
    .trim();
  const subjectCompany = field('Subject')
    .replace(/\s+(?:live|meeting)\b.*$/i, '')
    .trim();
  const company =
    field('Company', 'Organisation', 'Organization') ||
    cleanMarkdown(titleCompany) ||
    subjectCompany ||
    'External company';
  const date = field('Date(?:\\s*[/&]\\s*Time)?', 'Date and Time', 'When');
  const time = field('Time');
  const location = field('Location', 'Join', 'Meeting location', 'Where');
  const meeting = field('Meeting') || [date, time, location].filter(Boolean).join(' · ') || 'See verified Microsoft 365 event';
  const participantNames = exactSectionLines('required attendees')
    .map((value) => value.replace(/\s*\([^)]*\)/g, '').trim())
    .filter(Boolean);
  const participants =
    field('Participants', 'Attendees', 'Required Attendees', 'External attendees')
      .replace(/\s*\([^)]*@[^)]*\)/g, '')
      .replace(/\s+,/g, ',') ||
    shorten(participantNames.join(', ') || 'See verified Microsoft 365 event', 160);
  const rawObjective =
    field('Objective', 'Purpose') || 'Resolve open commitments and agree the next concrete step';
  const objective = /typescript.*(?:fiori|launchpad)|(?:fiori|launchpad).*typescript/i.test(rawObjective)
    ? 'Understand the new TypeScript generator for SAP Fiori launchpad plugins and agree the feedback needed for broader use.'
    : shorten(rawObjective, 125);
  const citationLine = exactSectionLines('supporting email citation')[0] ?? '';
  const citationDate = /received (?:on )?([^,]+?)(?=,\s*subject|\s+subject)/i.exec(citationLine)?.[1];
  const citationSubject = /subject\s+["“]([^"”]+)["”]/i.exec(citationLine)?.[1]
    ?.replace(/\s*\([^)]*@[^)]*\)\s*$/, '')
    .trim();
  const citationSummary = [citationDate, citationSubject].filter(Boolean).join(' · ');
  const relationshipLines = sectionLines('relationship', 'history');
  const relationshipEvidence = relationshipLines.find((line) =>
    /\b\d{2}\s+[A-Za-z]{3}\s+\d{4}\b/.test(line)
  );
  const evidenceDate = /\b(\d{2}\s+[A-Za-z]{3}\s+\d{4})\b/.exec(
    relationshipEvidence ?? ''
  )?.[1];
  const evidenceSubject = /[“"]([^”"]+)[”"]/.exec(relationshipEvidence ?? '')?.[1]
    ?.replace(/\s+@\s+Thu.*$/i, '')
    .replace(/\s*\([^)]*@[^)]*\)\s*$/, '')
    .trim();
  const relationshipLead = relationshipLines[0]?.split(/(?<=\.)\s+/)[0] ?? '';
  const relationship = compact(
    [
      relationshipLead,
      ...((citationSummary || (evidenceDate && evidenceSubject))
        ? [`Source: ${citationSummary || `${evidenceDate} · ${evidenceSubject}`}.`]
        : []),
    ],
    compact(allClean.filter((line) => /\b(email|exchange|agreed|commit|follow[- ]?up)\b/i.test(line)), 'No relationship history was present in the retrieved context.'),
    240
  );
  const currentSituation = bullets([
    ...sectionLines('open commitment'),
    ...sectionLines('risk'),
    ...sectionLines('current situation', 'latest exchange'),
  ], [
    'Open commitments: not present in the retrieved context.',
    'Risk: confirm current blockers in the meeting.',
    'Latest customer request: not present in the retrieved context.',
  ]);
  const questionLines = sectionLines('question').map((value) =>
    /generated TypeScript code stay compatible.*Extension API/i.test(value)
      ? 'How will the generated TypeScript stay compatible as the Extension API evolves?'
      : value
  );
  const questions = bullets(questionLines, [
    'What outcome would make this meeting useful for you?',
    'Which decision or commitment is currently blocked?',
    'Who owns the next step, and by what date?',
  ]);
  const topics = bullets(sectionLines('topic', 'things to raise', 'recommendation'), [
    'Confirm the outcome the attendees need from this meeting.',
    'Clarify the highest-risk assumption or blocker.',
    'Agree the next step, owner and date before closing.',
  ]);
  return { company, meeting, participants, objective, relationship, current: currentSituation, topics, questions };
}

function xmlText(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function decodeXmlText(value) {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_match, decimal) => String.fromCodePoint(Number(decimal)))
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

function paragraphText(paragraph) {
  return [...paragraph.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((match) => decodeXmlText(match[1]))
    .join('')
    .trim();
}

function replaceParagraphText(paragraph, value) {
  let replaced = false;
  const rewritten = paragraph.replace(
    /<w:t(\s[^>]*)?>([\s\S]*?)<\/w:t>/g,
    (_match, attributes = '') => {
      if (replaced) return `<w:t${attributes}></w:t>`;
      replaced = true;
      return `<w:t${attributes}>${xmlText(value)}</w:t>`;
    }
  );
  if (!replaced) throw new Error(`Meeting template paragraph has no editable text: ${value}`);
  return rewritten;
}

function replaceLabeledParagraph(paragraph, label, value) {
  const fullText = [...paragraph.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((match) => decodeXmlText(match[1]))
    .join('');
  if (!fullText.trimStart().startsWith(label)) {
    throw new Error(`Meeting template locator was not found: ${label}`);
  }

  const valueStart = fullText.indexOf(label) + label.length;
  const separatorLength = /^\s*/.exec(fullText.slice(valueStart))?.[0].length ?? 0;
  const prefixLength = valueStart + separatorLength;
  let offset = 0;
  let valueWritten = false;
  return paragraph.replace(
    /<w:t(\s[^>]*)?>([\s\S]*?)<\/w:t>/g,
    (_match, attributes = '', encoded) => {
      const decoded = decodeXmlText(encoded);
      const start = offset;
      const end = offset + decoded.length;
      offset = end;
      if (end <= prefixLength) return `<w:t${attributes}>${encoded}</w:t>`;
      if (start < prefixLength) {
        valueWritten = true;
        return `<w:t${attributes}>${xmlText(decoded.slice(0, prefixLength - start) + value)}</w:t>`;
      }
      if (!valueWritten) {
        valueWritten = true;
        return `<w:t${attributes}>${xmlText(value)}</w:t>`;
      }
      return `<w:t${attributes}></w:t>`;
    }
  );
}

function replaceParagraphLines(paragraph, lines) {
  const open = /^<w:p(?:\s[^>]*)?>/.exec(paragraph)?.[0];
  if (!open) throw new Error('Meeting template paragraph is malformed.');
  const properties = /<w:pPr(?:\s[^>]*)?>[\s\S]*?<\/w:pPr>/.exec(paragraph)?.[0] ?? '';
  const content = lines
    .map((line, index) => `${index ? '<w:br/>' : ''}<w:t>${xmlText(line)}</w:t>`)
    .join('');
  return `${open}${properties}<w:r>${content}</w:r></w:p>`;
}

/** Rewrite only the retained template's declared content slots. The locators
 * are labels and Heading 1 text, so this also works when a generated brief is
 * attached again and its former placeholder values no longer exist. */
function rewriteMeetingDocument(xml, context) {
  const paragraphs = [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map(
    (match) => match[0]
  );
  const texts = paragraphs.map(paragraphText);
  const edits = new Map();

  const after = (label, offset = 1) => {
    const index = texts.indexOf(label);
    if (index < 0 || !paragraphs[index + offset]) {
      throw new Error(`Meeting template locator was not found: ${label}`);
    }
    return index + offset;
  };
  const editAfter = (label, value, offset = 1) =>
    edits.set(after(label, offset), (paragraph) => replaceParagraphText(paragraph, value));
  const editLabel = (label, value) => {
    const index = texts.findIndex((text) => text.startsWith(label));
    if (index < 0) throw new Error(`Meeting template locator was not found: ${label}`);
    edits.set(index, (paragraph) => replaceLabeledParagraph(paragraph, label, value));
  };

  editAfter('MEETING BRIEF', `${context.company} · verified Microsoft 365 context`);
  editLabel('Company:', context.company);
  editLabel('Meeting:', context.meeting);
  editLabel('Participants:', context.participants);
  editLabel('Objective:', context.objective);
  editAfter('Relationship history', context.relationship);
  context.current.forEach((value, index) => editAfter('Current situation', value, index + 1));
  context.topics.forEach((value, index) => editAfter('Topics to raise', value, index + 1));
  edits.set(
    after('Questions'),
    (paragraph) =>
      replaceParagraphLines(
        paragraph,
        context.questions.map((value, index) => `${index + 1}. ${value}`)
      )
  );

  let paragraphIndex = 0;
  return xml.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, (paragraph) => {
    const rewrite = edits.get(paragraphIndex++);
    return rewrite === undefined ? paragraph : rewrite(paragraph);
  });
}

function updateMeetingHeader(xml) {
  const original = 'MEETING BRIEF TEMPLATE  |  DEMO CONTENT';
  const filled = 'MEETING BRIEF  |  MICROSOFT 365 CONTEXT';
  if (xml.includes(xmlText(original))) return xml.replace(xmlText(original), xmlText(filled));
  if (xml.includes(xmlText(filled))) return xml;
  throw new Error('Meeting template header was not recognized.');
}

async function generateMeetingBrief(request) {
  const templatePath = path.resolve(request.templatePath);
  const context = meetingContext(request.sourceText);
  const safeCompany = context.company
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9 ._-]+/g, '')
    .trim()
    .slice(0, 60) || 'External Company';
  const requestedFilename = /(?:save(?:\s+the\s+completed\s+document)?\s+as|name(?:\s+it)?)\s*["“]([^"”]+\.docx)["”]/i
    .exec(String(request.prompt ?? ''))?.[1];
  const safeRequestedFilename = requestedFilename
    ? path.basename(requestedFilename)
        .replace(/\[(?:company|organisation|organization)\]/gi, safeCompany)
        .replace(/[\\/:\0]/g, '')
        .trim()
    : '';
  const output = path.join(
    WORKSPACE,
    safeRequestedFilename || `Meeting Brief - ${safeCompany}.docx`
  );
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'werkbank-meeting-brief-'));
  try {
    await execFileAsync('/usr/bin/unzip', ['-q', templatePath, '-d', temp]);
    const documentPath = path.join(temp, 'word', 'document.xml');
    let xml = await fs.readFile(documentPath, 'utf8');
    xml = rewriteMeetingDocument(xml, context);
    await fs.writeFile(documentPath, xml, 'utf8');

    const headerPath = path.join(temp, 'word', 'header1.xml');
    let header = await fs.readFile(headerPath, 'utf8');
    header = updateMeetingHeader(header);
    await fs.writeFile(headerPath, header, 'utf8');
    await fs.rm(output, { force: true });
    await execFileAsync('/usr/bin/zip', ['-q', '-r', output, '.'], { cwd: temp });
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }

  return {
    handled: true,
    kind: 'document',
    files: [output],
    text: `I filled the attached meeting brief template from the verified Microsoft 365 context and saved **${path.basename(output)}**. The source template, one-page structure, headings, lists, header and footer are preserved.`,
    toolCalls: [
      { title: `Read ${path.basename(templatePath)}`, toolName: 'read_document_template', status: 'completed' },
      { title: `Create ${path.basename(output)}`, toolName: 'create_document', status: 'completed', locations: [{ path: output }] },
    ],
  };
}

async function main() {
  const requestPath = process.argv[2];
  if (!requestPath) throw new Error('Expected a request JSON path.');
  const request = JSON.parse(await fs.readFile(requestPath, 'utf8'));
  const result = request.type === 'data-space'
    ? await generateSpace(request)
    : request.type === 'shipment-deck'
      ? await generateDeck(request)
      : request.type === 'meeting-brief-doc'
        ? await generateMeetingBrief(request)
      : null;
  if (!result) throw new Error(`Unsupported workflow: ${request.type}`);
  process.stdout.write(JSON.stringify(result));
}

main().catch((error) => {
  process.stderr.write(error?.stack ?? String(error));
  process.exitCode = 1;
});
