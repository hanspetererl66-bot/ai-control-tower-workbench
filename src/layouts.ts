/**
 * Layouts: three ready-made ways the app and all Spaces are laid out. A layout changes shape, space and depth
 * (corner radius, padding, shadows, header, tabs, card surface, size of the big numbers); it never changes colours,
 * which belong to the skin. So every layout works with every skin, in light and dark. Colours appear only as tokens.
 * Pure data and functions, so the output can be tested.
 *
 *   minimal        flat, small corners, tight spacing, hairlines instead of shadows, calm type. The default.
 *   bold           graphic and loud: square corners, thick outlines, hard offset shadows, monospace numbers, graph paper.
 *   contemporary   "bento and glass": translucent cards with a blur, soft accent glow in the background, segmented tabs.
 *
 * Original CSS written for this app; it imitates the general direction of current product design, no site or asset.
 */
export const LAYOUTS = ['minimal', 'bold', 'contemporary'] as const;
export type LayoutId = (typeof LAYOUTS)[number];
export const DEFAULT_LAYOUT: LayoutId = 'minimal';

type LayoutDef = {
  name: string;
  description: string;
  /** What the little preview in the settings draws. */
  preview: { radius: number; shadow: boolean; glass: boolean; pill: boolean; hard?: boolean; gap: number };
  /** Rules for a Space page (design-system classes; `html` in front raises the weight above the Space's own styles). */
  space: string[];
  /** Rules for the app window. */
  app: string[];
};

const CARDS = 'html .mc,html .card,html .ns,html .dtier,html .pc,html .cc';
const HEADER = 'html .ct .hdr,html .s4m header';
const TABBAR = 'html .ct .tbar,html .s4m nav';
const TAB = 'html .ct .tb,html .s4m nav button';
const TAB_ON = 'html .ct .tb.on,html .s4m nav button[aria-selected=true]';
const PAGE = 'html .ct .pg,html .s4m main';
const BIG = 'html .mv,html .v';
const HEAD = 'html .sh,html .s4m h2';
const BUTTONS = 'html button.primary,html button.ghost,html button.small';
const NO_MOTION = '@media (prefers-reduced-motion:no-preference)';

export const LAYOUT_DEFS: Record<LayoutId, LayoutDef> = {
  minimal: {
    name: 'Minimal',
    description: 'Flat and quiet. Small corners, tight spacing, thin lines instead of shadows. The numbers and the content come first.',
    preview: { radius: 3, shadow: false, glass: false, pill: false, gap: 3 },
    space: [
      'html:root{--radius:8px;--radius-s:6px;--shadow:none;--shadow-lg:0 12px 32px rgba(20,18,30,.14)}',
      `${CARDS}{box-shadow:none}`,
      'html .card,html .ns{padding:16px;margin-bottom:10px}',
      'html .mc{padding:12px 14px}',
      'html .dtier,html .pc,html .cc{padding:12px}',
      `${BIG}{font-size:22px;font-weight:600;letter-spacing:-.01em}`,
      `${HEAD}{margin:22px 0 10px;font-size:12px;font-weight:600;color:var(--muted)}`,
      `${HEADER}{backdrop-filter:none;background:var(--surface)}`,
      'html .ct .hdr{height:48px;padding:0 24px}',
      'html .s4m header{min-height:48px;padding:0 24px}',
      `${TABBAR}{padding:0 24px;gap:0}`,
      `${TAB}{padding:12px 12px 10px}`,
      `${PAGE}{padding:24px 24px 40px}`,
      'html .ct .mr{gap:10px;margin-bottom:18px}',
      'html .ct .g2,html .ct .g3,html .ct .g4{gap:12px}',
      'html .s4m .grid{gap:10px;margin-bottom:18px}',
      'html .tag{padding:1px 8px}',
      'html button.primary{box-shadow:none}',
      'html button.small{background:transparent}',
      'html .tbl th,html table th{padding:7px 10px}',
      'html .tbl td,html table td{padding:8px 10px}',
      'html .ab{padding:12px 14px}',
      'html .ag-box{padding:20px 22px;border-radius:12px}',
    ],
    app: [
      ':root{--radius:8px}',
      '.composer{border-radius:10px;box-shadow:none}',
      '.msg-user{border-radius:10px;padding:7px 12px}',
      '.briefing-card{border-radius:8px;box-shadow:none}',
      '.sov-tile,.sov-card,.sov-kid{border-radius:8px;box-shadow:none}',
    ],
  },
  bold: {
    name: 'Bold',
    description: 'Graphic and loud. Square corners, thick outlines, hard offset shadows, monospace numbers and a graph-paper background.',
    preview: { radius: 0, shadow: true, glass: false, pill: false, hard: true, gap: 5 },
    space: [
      'html:root,html:root[data-theme="light"],html:root[data-theme="dark"]{--radius:0px;--radius-s:0px;--shadow:4px 4px 0 var(--ink);--shadow-lg:8px 8px 0 var(--ink)}',
      '@media (prefers-color-scheme:dark){html:root:not([data-theme="light"]){--shadow:4px 4px 0 var(--purple);--shadow-lg:8px 8px 0 var(--purple)}}',
      'html:root[data-theme="dark"]{--shadow:4px 4px 0 var(--purple);--shadow-lg:8px 8px 0 var(--purple)}',
      'html body{background-image:radial-gradient(var(--line) 1px,transparent 1px);background-size:16px 16px}',
      `${CARDS}{border:2px solid var(--ink)}`,
      'html .card,html .ns{padding:20px;margin-bottom:20px}',
      'html .mc{padding:16px 18px}',
      'html .dtier,html .pc,html .cc{padding:16px}',
      `${BIG}{font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-size:34px;font-weight:800;letter-spacing:-.03em}`,
      `${HEAD}{margin:34px 0 16px;padding-bottom:6px;font-size:14px;font-weight:800;border-bottom:2px solid var(--ink)}`,
      `${HEADER}{background:var(--surface);border-bottom:3px solid var(--ink);-webkit-backdrop-filter:none;backdrop-filter:none}`,
      'html .ct .hdr-title,html .s4m .logo{font-weight:800}',
      `${TABBAR}{padding:10px 24px;gap:6px;border-bottom:2px solid var(--ink)}`,
      `${TAB}{padding:8px 14px;border:2px solid transparent;border-radius:0;font-weight:700}`,
      `${TAB_ON}{background:var(--ink);color:var(--surface);border-color:var(--ink)}`,
      `${PAGE}{padding:32px 28px 56px}`,
      'html .ct .mr{gap:20px;margin-bottom:32px}',
      'html .ct .g2,html .ct .g3,html .ct .g4{gap:20px}',
      'html .s4m .grid{gap:20px;margin-bottom:30px}',
      'html .tag{border:2px solid currentColor;border-radius:0;font-weight:700;padding:1px 8px}',
      `${BUTTONS}{border:2px solid var(--ink);border-radius:0;font-weight:700;box-shadow:2px 2px 0 var(--ink)}`,
      'html button.primary{border-color:var(--ink)}',
      `${NO_MOTION}{${BUTTONS.split(',').map((x) => `${x}:hover:not(:disabled)`).join(',')}{transform:translate(-1px,-1px);box-shadow:3px 3px 0 var(--ink)}}`,
      `${BUTTONS.split(',').map((x) => `${x}:active:not(:disabled)`).join(',')}{transform:translate(2px,2px);box-shadow:none}`,
      'html input,html select,html textarea{border:2px solid var(--ink);border-radius:0}',
      'html .tbl th,html table th{border-bottom:2px solid var(--ink);color:var(--ink);font-weight:700}',
      'html .ab{border-width:2px;border-radius:0}',
      'html .ag-box{border:2px solid var(--ink);border-radius:0}',
    ],
    app: [
      ':root{--radius:2px}',
      '.composer{border:2px solid var(--ink);border-radius:2px;box-shadow:4px 4px 0 var(--ink)}',
      '.composer:focus-within{border-color:var(--accent);box-shadow:4px 4px 0 var(--accent)}',
      '.msg-user{border:2px solid var(--ink);border-radius:2px;padding:8px 14px}',
      '.briefing-card{border:2px solid var(--ink);border-radius:2px;box-shadow:3px 3px 0 var(--ink)}',
      '.sov-tile,.sov-card,.sov-kid{border:2px solid var(--ink);border-radius:2px;box-shadow:3px 3px 0 var(--ink)}',
    ],
  },
  contemporary: {
    name: 'Contemporary',
    description: 'Bento and glass, as in current product design. Translucent cards with a blur, a soft glow in the background, segmented tabs.',
    preview: { radius: 7, shadow: true, glass: true, pill: false, gap: 4 },
    space: [
      'html:root{--radius:18px;--radius-s:12px;--shadow:0 1px 0 rgba(255,255,255,.6) inset,0 1px 2px rgba(20,18,30,.05),0 8px 24px rgba(20,18,30,.06)}',
      'html body{background:radial-gradient(900px 520px at 10% -10%,var(--purple-dim),transparent 60%),radial-gradient(760px 460px at 100% 0,var(--blue-dim),transparent 55%),var(--canvas);background-attachment:fixed}',
      `${CARDS}{background:color-mix(in srgb,var(--surface) 72%,transparent);-webkit-backdrop-filter:blur(18px) saturate(1.4);backdrop-filter:blur(18px) saturate(1.4);border-color:color-mix(in srgb,var(--line) 70%,transparent)}`,
      'html .card,html .ns{padding:22px;margin-bottom:14px}',
      'html .mc{padding:18px 20px}',
      `${BIG}{font-size:32px;font-weight:650;letter-spacing:-.03em}`,
      `${HEADER}{background:color-mix(in srgb,var(--surface) 62%,transparent);-webkit-backdrop-filter:blur(20px) saturate(1.5);backdrop-filter:blur(20px) saturate(1.5)}`,
      `${TABBAR}{background:transparent;border-bottom:0;padding:14px 32px 0;gap:4px}`,
      `${TAB}{padding:8px 14px;border-radius:12px;border-bottom:0}`,
      `${TAB_ON}{background:var(--surface);border-bottom:0;box-shadow:var(--shadow)}`,
      'html button.primary{background:linear-gradient(180deg,var(--purple-mid),var(--purple));box-shadow:0 1px 0 rgba(255,255,255,.25) inset,0 4px 12px var(--purple-border)}',
      'html .ab{background:color-mix(in srgb,var(--surface) 72%,transparent)}',
    ],
    app: [
      ':root{--radius:16px}',
      '.composer{border-radius:18px;background:color-mix(in srgb,var(--panel) 78%,transparent);-webkit-backdrop-filter:blur(16px) saturate(1.3);backdrop-filter:blur(16px) saturate(1.3);box-shadow:0 8px 28px color-mix(in srgb,var(--ink) 8%,transparent)}',
      '.msg-user{border-radius:18px}',
      '.briefing-card{border-radius:16px;background:color-mix(in srgb,var(--panel) 80%,transparent);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}',
      '.sov-tile,.sov-card,.sov-kid{border-radius:18px}',
    ],
  },
};

export const LAYOUT_LIST = LAYOUTS.map((id) => ({ id, ...LAYOUT_DEFS[id] }));

export const isLayout = (value: unknown): value is LayoutId => typeof value === 'string' && (LAYOUTS as readonly string[]).includes(value);

/** Rules for a Space page, to be put after the skin rules. */
export function layoutSpaceRules(layout: LayoutId): string[] {
  return LAYOUT_DEFS[layout].space;
}

/** CSS for the app window, to be put after the skin. */
export function layoutAppCss(layout: LayoutId): string[] {
  return LAYOUT_DEFS[layout].app;
}
