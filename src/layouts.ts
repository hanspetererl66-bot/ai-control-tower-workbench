/**
 * Layouts: three ready-made ways the app and all Spaces are laid out. A layout changes shape, space and depth
 * (corner radius, padding, shadows, header, tabs, card surface, size of the big numbers); it never changes colours,
 * which belong to the skin. So every layout works with every skin, in light and dark. Colours appear only as tokens.
 * Pure data and functions, so the output can be tested.
 *
 *   minimal        flat, small corners, tight spacing, hairlines instead of shadows, calm type. The default.
 *   structural     editorial and exact: no boxes, fine rules, square corners, serif headlines, ledger-style numbers.
 *   contemporary   "bento and glass": translucent cards with a blur, soft accent glow in the background, segmented tabs.
 *   aurora         glowing mesh background, luminous glass cards with a coloured rim, gradient numbers, pill tabs.
 *   clay           soft 3D: puffy, rounded, pillowy cards and buttons with inner highlights and soft shadows.
 *
 * Original CSS written for this app; it imitates the general direction of current product design, no site or asset.
 */
export const LAYOUTS = ['minimal', 'structural', 'contemporary', 'aurora', 'clay'] as const;
export type LayoutId = (typeof LAYOUTS)[number];
export const DEFAULT_LAYOUT: LayoutId = 'minimal';

type LayoutDef = {
  name: string;
  description: string;
  /** What the little preview in the settings draws. */
  preview: { radius: number; shadow: boolean; glass: boolean; pill: boolean; ledger?: boolean; aurora?: boolean; clay?: boolean; gap: number };
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
const SERIF = "'Iowan Old Style','Charter','Palatino Linotype',Georgia,serif";

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
  structural: {
    name: 'Structural',
    description: 'Editorial and exact. No boxes: fine rules, square corners, serif headlines and ledger-style numbers on a quiet page.',
    preview: { radius: 0, shadow: false, glass: false, pill: false, ledger: true, gap: 6 },
    space: [
      'html:root{--radius:2px;--radius-s:2px;--shadow:none;--shadow-lg:0 12px 32px rgba(20,18,30,.14)}',
      `${CARDS}{background:transparent;border:0;border-top:1px solid var(--ink);border-radius:0;box-shadow:none;padding:14px 0 0}`,
      'html .card,html .ns{margin-bottom:30px}',
      'html td,html th,html .mv,html .v{font-variant-numeric:lining-nums tabular-nums}',
      `${BIG}{font-family:${SERIF};font-size:38px;font-weight:500;letter-spacing:-.02em}`,
      `${HEAD}{margin:44px 0 16px;padding-top:10px;border-top:1px solid var(--ink);font-family:${SERIF};font-size:19px;font-weight:500;color:var(--ink)}`,
      `${HEADER}{background:var(--canvas);border-bottom:1px solid var(--ink);-webkit-backdrop-filter:none;backdrop-filter:none}`,
      'html .ct .hdr-title,html .s4m .logo{font-family:' + SERIF + ';font-weight:500}',
      `${TABBAR}{padding:0 48px;gap:24px;border-bottom:1px solid var(--line)}`,
      `${TAB}{padding:12px 2px 10px;border:0;border-bottom:2px solid transparent;border-radius:0;font-weight:500;color:var(--muted)}`,
      `${TAB_ON}{background:transparent;color:var(--ink);font-weight:600;border-bottom-color:var(--ink)}`,
      `${PAGE}{padding:36px 48px 72px}`,
      'html .ct .mr{gap:36px;margin-bottom:34px}',
      'html .ct .g2,html .ct .g3,html .ct .g4{gap:36px}',
      'html .s4m .grid{gap:36px;margin-bottom:34px}',
      'html .tag{background:transparent;border:1px solid currentColor;border-radius:0;padding:0 7px;font-weight:600}',
      `${BUTTONS}{border:1px solid var(--ink);border-radius:0;box-shadow:none;font-weight:500}`,
      'html button.primary{background:var(--ink);color:var(--surface)}',
      'html button.ghost,html button.small{background:transparent;color:var(--ink)}',
      'html input,html select,html textarea{border:1px solid var(--ink);border-radius:0}',
      'html .tbl th,html table th{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--ink)}',
      'html .tbl td,html table td{border-bottom:1px solid var(--line)}',
      'html .ab{border-radius:0;border-left-width:4px}',
      'html .ag-box{border-radius:0}',
    ],
    app: [
      ':root{--radius:2px}',
      '.composer{border:1px solid var(--ink);border-radius:2px;box-shadow:none}',
      '.composer:focus-within{border-color:var(--accent);box-shadow:none}',
      '.msg-user{border-radius:2px}',
      '.briefing-card{border:1px solid var(--line);border-top:1px solid var(--ink);border-radius:0;box-shadow:none}',
      '.sov-tile,.sov-card,.sov-kid{border-radius:2px;box-shadow:none}',
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
  aurora: {
    name: 'Aurora',
    description: 'Luminous. A glowing colour mesh behind frosted glass, bright rims, gradient numbers and pill-shaped tabs. Made to stand out.',
    preview: { radius: 8, shadow: true, glass: true, pill: true, aurora: true, gap: 5 },
    space: [
      'html:root{--radius:22px;--radius-s:14px;--shadow:0 0 0 1px color-mix(in srgb,var(--purple-mid) 28%,transparent),0 12px 40px color-mix(in srgb,var(--purple) 18%,transparent)}',
      'html body{background:radial-gradient(620px 420px at 8% 0,color-mix(in srgb,var(--purple-mid) 38%,transparent),transparent 70%),radial-gradient(560px 420px at 92% 6%,color-mix(in srgb,var(--blue) 30%,transparent),transparent 70%),radial-gradient(700px 480px at 50% 108%,color-mix(in srgb,var(--purple) 26%,transparent),transparent 70%),var(--canvas);background-attachment:fixed}',
      `${CARDS}{background:color-mix(in srgb,var(--surface) 55%,transparent);-webkit-backdrop-filter:blur(26px) saturate(1.8);backdrop-filter:blur(26px) saturate(1.8);border:1px solid color-mix(in srgb,var(--purple-mid) 38%,transparent);box-shadow:0 10px 36px color-mix(in srgb,var(--purple) 16%,transparent)}`,
      'html .card,html .ns{padding:24px;margin-bottom:16px}',
      'html .mc{padding:20px 22px}',
      `${BIG}{font-size:36px;font-weight:700;letter-spacing:-.035em;background:linear-gradient(120deg,var(--purple),var(--blue));-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent}`,
      `${HEAD}{margin:30px 0 14px;font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--purple)}`,
      `${HEADER}{background:color-mix(in srgb,var(--surface) 50%,transparent);-webkit-backdrop-filter:blur(24px) saturate(1.8);backdrop-filter:blur(24px) saturate(1.8);border-bottom:1px solid color-mix(in srgb,var(--purple-mid) 30%,transparent)}`,
      `${TABBAR}{background:transparent;border-bottom:0;padding:16px 32px 0;gap:6px}`,
      `${TAB}{padding:8px 18px;border:1px solid transparent;border-radius:999px;border-bottom-width:1px}`,
      `${TAB_ON}{background:linear-gradient(120deg,var(--purple),var(--blue));color:white;border-color:transparent;box-shadow:0 6px 20px color-mix(in srgb,var(--purple) 40%,transparent)}`,
      `${PAGE}{padding:28px 32px 56px}`,
      'html .ct .mr{gap:16px;margin-bottom:22px}',
      'html .ct .g2,html .ct .g3,html .ct .g4{gap:16px}',
      'html .s4m .grid{gap:16px;margin-bottom:22px}',
      'html .tag{border-radius:999px;padding:1px 10px}',
      `${BUTTONS}{border-radius:999px}`,
      'html button.primary{background:linear-gradient(120deg,var(--purple),var(--blue));border:0;color:white;box-shadow:0 8px 24px color-mix(in srgb,var(--purple) 42%,transparent)}',
      'html input,html select,html textarea{border-radius:14px;background:color-mix(in srgb,var(--surface) 60%,transparent)}',
      'html .ab{background:color-mix(in srgb,var(--surface) 55%,transparent);border-radius:16px}',
      `${NO_MOTION}{html button.primary:hover{transform:translateY(-1px);box-shadow:0 12px 30px color-mix(in srgb,var(--purple) 50%,transparent)}}`,
    ],
    app: [
      ':root{--radius:20px}',
      '.composer{border-radius:24px;background:color-mix(in srgb,var(--panel) 60%,transparent);-webkit-backdrop-filter:blur(22px) saturate(1.7);backdrop-filter:blur(22px) saturate(1.7);border:1px solid color-mix(in srgb,var(--accent) 40%,transparent);box-shadow:0 10px 36px color-mix(in srgb,var(--accent) 22%,transparent)}',
      '.msg-user{border-radius:22px}',
      '.briefing-card{border-radius:20px;background:color-mix(in srgb,var(--panel) 60%,transparent);-webkit-backdrop-filter:blur(18px);backdrop-filter:blur(18px);border:1px solid color-mix(in srgb,var(--accent) 32%,transparent)}',
      '.sov-tile,.sov-card,.sov-kid{border-radius:22px}',
    ],
  },
  clay: {
    name: 'Clay',
    description: 'Soft and tactile. Puffy rounded cards and chunky buttons that look pressed from clay, with inner highlights and gentle shadows.',
    preview: { radius: 10, shadow: true, glass: false, pill: true, clay: true, gap: 6 },
    space: [
      'html:root{--radius:28px;--radius-s:18px;--shadow:0 14px 26px rgba(20,18,30,.12),inset 0 3px 6px rgba(255,255,255,.55),inset 0 -5px 10px rgba(20,18,30,.07)}',
      'html body{background:var(--canvas)}',
      `${CARDS}{border:0;border-radius:28px;background:color-mix(in srgb,var(--surface) 88%,var(--purple-dim));box-shadow:0 14px 26px rgba(20,18,30,.12),inset 0 3px 6px rgba(255,255,255,.55),inset 0 -5px 10px rgba(20,18,30,.07)}`,
      'html .card,html .ns{padding:26px;margin-bottom:20px}',
      'html .mc{padding:22px 24px}',
      `${BIG}{font-size:34px;font-weight:800;letter-spacing:-.03em;color:var(--purple)}`,
      `${HEAD}{margin:30px 0 14px;font-size:16px;font-weight:800;color:var(--ink)}`,
      `${HEADER}{background:var(--canvas);border-bottom:0;box-shadow:0 8px 18px rgba(20,18,30,.08)}`,
      `${TABBAR}{background:transparent;border-bottom:0;padding:18px 32px 4px;gap:10px}`,
      `${TAB}{padding:10px 20px;border:0;border-radius:999px;background:color-mix(in srgb,var(--surface) 88%,var(--purple-dim));box-shadow:0 6px 12px rgba(20,18,30,.10),inset 0 2px 4px rgba(255,255,255,.5);font-weight:700}`,
      `${TAB_ON}{background:var(--purple);color:white;box-shadow:inset 0 3px 8px rgba(0,0,0,.28),0 2px 4px rgba(20,18,30,.10)}`,
      `${PAGE}{padding:28px 36px 64px}`,
      'html .ct .mr{gap:20px;margin-bottom:26px}',
      'html .ct .g2,html .ct .g3,html .ct .g4{gap:20px}',
      'html .s4m .grid{gap:20px;margin-bottom:26px}',
      'html .tag{border-radius:999px;padding:2px 12px;font-weight:700;box-shadow:inset 0 2px 3px rgba(255,255,255,.5)}',
      `${BUTTONS}{border:0;border-radius:999px;padding:10px 20px;font-weight:700;background:color-mix(in srgb,var(--surface) 88%,var(--purple-dim));box-shadow:0 8px 14px rgba(20,18,30,.14),inset 0 3px 5px rgba(255,255,255,.55),inset 0 -4px 8px rgba(20,18,30,.08)}`,
      'html button.primary{background:var(--purple);color:white;box-shadow:0 10px 18px color-mix(in srgb,var(--purple) 40%,transparent),inset 0 3px 5px rgba(255,255,255,.35),inset 0 -5px 9px rgba(0,0,0,.22)}',
      'html input,html select,html textarea{border:0;border-radius:18px;background:color-mix(in srgb,var(--canvas) 70%,var(--surface));box-shadow:inset 0 3px 7px rgba(20,18,30,.14),inset 0 -2px 4px rgba(255,255,255,.5)}',
      'html .ab{border-radius:20px;border:0;box-shadow:0 8px 16px rgba(20,18,30,.10),inset 0 2px 4px rgba(255,255,255,.5)}',
      'html .ag-box{border-radius:28px}',
      `${NO_MOTION}{html button.primary,html button.ghost,html button.small{transition:transform .15s ease,box-shadow .15s ease}html button.primary:hover,html button.ghost:hover,html button.small:hover{transform:translateY(-2px)}html button.primary:active,html button.ghost:active,html button.small:active{transform:translateY(1px)}}`,
    ],
    app: [
      ':root{--radius:24px}',
      '.composer{border:0;border-radius:28px;box-shadow:0 14px 26px rgba(20,18,30,.12),inset 0 3px 6px rgba(255,255,255,.4),inset 0 -5px 10px rgba(20,18,30,.06)}',
      '.msg-user{border-radius:24px;box-shadow:inset 0 3px 5px rgba(255,255,255,.35),0 6px 12px rgba(20,18,30,.10)}',
      '.briefing-card{border:0;border-radius:24px;box-shadow:0 12px 22px rgba(20,18,30,.12),inset 0 3px 5px rgba(255,255,255,.4)}',
      '.sov-tile,.sov-card,.sov-kid{border:0;border-radius:26px;box-shadow:0 12px 22px rgba(20,18,30,.12),inset 0 3px 5px rgba(255,255,255,.4)}',
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
