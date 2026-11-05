/**
 * Layouts: three ready-made ways the app and all Spaces are laid out. A layout changes shape, space and depth
 * (corner radius, padding, shadows, header, tabs, card surface, size of the big numbers); it never changes colours,
 * which belong to the skin. So every layout works with every skin, in light and dark. Colours appear only as tokens.
 * Pure data and functions, so the output can be tested.
 *
 *   minimal        flat, small corners, tight spacing, hairlines instead of shadows, calm type. The default.
 *   expressive     big corners, soft accent-tinted cards, depth, pill tabs and pill buttons, large numbers.
 *   contemporary   "bento and glass": translucent cards with a blur, soft accent glow in the background, segmented tabs.
 *
 * Original CSS written for this app; it imitates the general direction of current product design, no site or asset.
 */
export const LAYOUTS = ['minimal', 'expressive', 'contemporary'] as const;
export type LayoutId = (typeof LAYOUTS)[number];
export const DEFAULT_LAYOUT: LayoutId = 'minimal';

type LayoutDef = {
  name: string;
  description: string;
  /** What the little preview in the settings draws. */
  preview: { radius: number; shadow: boolean; glass: boolean; pill: boolean; gap: number };
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
  expressive: {
    name: 'Expressive',
    description: 'Rich and confident. Big rounded cards with a soft accent tint and depth, pill tabs and buttons, large numbers.',
    preview: { radius: 11, shadow: true, glass: false, pill: true, gap: 6 },
    space: [
      'html:root{--radius:28px;--radius-s:16px;--shadow:0 2px 4px rgba(20,18,30,.05),0 14px 36px rgba(60,0,110,.12);--shadow-lg:0 32px 80px rgba(60,0,110,.32)}',
      `${CARDS}{background:linear-gradient(160deg,var(--surface) 0%,color-mix(in srgb,var(--purple) 7%,var(--surface)) 100%);border-color:var(--purple-border)}`,
      'html .card,html .ns{padding:30px;margin-bottom:22px}',
      'html .mc{padding:26px 28px}',
      'html .dtier,html .pc,html .cc{padding:22px}',
      `${BIG}{font-size:40px;font-weight:700;letter-spacing:-.035em}`,
      `${HEAD}{margin:44px 0 18px;font-size:16px;font-weight:700}`,
      `${HEADER}{background:color-mix(in srgb,var(--purple) 9%,var(--surface));border-bottom:2px solid var(--purple-border)}`,
      'html .ct .hdr{height:72px;padding:0 40px}',
      'html .s4m header{min-height:72px;padding:0 40px}',
      `${TABBAR}{padding:10px 40px;gap:6px}`,
      `${TAB}{padding:9px 18px;margin:0;border-radius:99px;border-bottom:2px solid transparent}`,
      `${TAB_ON}{background:var(--purple-dim);border-bottom-color:transparent}`,
      `${PAGE}{padding:56px 40px 88px}`,
      'html .ct .mr{gap:22px;margin-bottom:40px}',
      'html .ct .g2,html .ct .g3,html .ct .g4{gap:26px}',
      'html .s4m .grid{gap:22px;margin-bottom:36px}',
      'html .tag{padding:4px 12px}',
      `${BUTTONS}{border-radius:99px}`,
      'html button.primary{padding:11px 22px;background:linear-gradient(135deg,var(--purple),var(--purple-mid));box-shadow:0 6px 18px var(--purple-border)}',
      'html .ab{padding:22px 24px}',
      `${NO_MOTION}{${CARDS}{transition:transform .2s ease,box-shadow .2s ease}${CARDS.split(',').map((s) => `${s}:hover`).join(',')}{transform:translateY(-3px);box-shadow:var(--shadow-lg)}}`,
    ],
    app: [
      ':root{--radius:20px}',
      '.composer{border-radius:26px;border-color:color-mix(in srgb,var(--accent) 45%,var(--line));box-shadow:0 10px 32px color-mix(in srgb,var(--accent) 16%,transparent)}',
      '.msg-user{border-radius:22px;padding:11px 18px}',
      '.briefing-card{border-radius:22px;box-shadow:0 8px 24px color-mix(in srgb,var(--accent) 12%,transparent)}',
      '.sov-tile,.sov-card,.sov-kid{border-radius:24px}',
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
