/**
 * Skins: four ready-made palettes for the app and for all Spaces. A skin sets the neutral surfaces, the text colours,
 * the lines and the accent family in light and dark. The meaning colours (green, amber, red) stay the same in every skin
 * so a status never changes its message. Pure data and functions, so the output can be tested.
 *
 *   violet  the original: black, white and warm greys with one purple accent (the look of accenture.com); no override
 *   mono    black, white and greys only
 *   azure   white and blues (the look of snowflake.com)
 *   signal  deep navy, white and a fresh green (the look of servicenow.com)
 *
 * The palettes are original sets of values inspired by those sites; no logos, fonts or assets are used.
 */
export const SKINS = ['violet', 'mono', 'azure', 'signal'] as const;
export type SkinId = (typeof SKINS)[number];
export const DEFAULT_SKIN: SkinId = 'violet';

/** Values for the Spaces (design-system tokens). */
type SpaceTokens = {
  canvas: string; surface: string; ink: string; ink2: string; muted: string; faint: string; line: string; line2: string; wash: string;
  accent: string; accentMid: string; accentDeep: string; accentDim: string; accentBorder: string; accentLight: string;
  shadow: string; shadowLg: string;
};
/** Values for the app window (Werkbank tokens). */
type AppTokens = { bg: string; panel: string; ink: string; muted: string; line: string; wash: string; accent: string; send: string; bubble: string };
type Skin = {
  name: string;
  description: string;
  /** Four colours for the preview in the settings: canvas, surface, text, accent. */
  swatch: [string, string, string, string];
  space: { light: SpaceTokens; dark: SpaceTokens };
  /** Empty for the original skin: the app keeps its own stylesheet. */
  app: { light: AppTokens; dark: AppTokens } | null;
};

const NEUTRAL_SHADOW = '0 1px 2px rgba(20,18,30,.04),0 6px 20px rgba(20,18,30,.05)';

export const SKIN_DEFS: Record<SkinId, Skin> = {
  violet: {
    name: 'Violet',
    description: 'Black, white and soft greys with one purple accent. The calm original.',
    swatch: ['#f6f5f8', '#ffffff', '#1b1a22', '#A100FF'],
    space: {
      light: { canvas: '#f6f5f8', surface: '#ffffff', ink: '#1b1a22', ink2: '#46444f', muted: '#6c6a78', faint: '#c3c1cd', line: '#e6e4ec', line2: '#f1f0f5', wash: '#faf9fc', accent: '#A100FF', accentMid: '#7500C0', accentDeep: '#460073', accentDim: 'rgba(161,0,255,.07)', accentBorder: 'rgba(161,0,255,.22)', accentLight: '#efe8fb', shadow: NEUTRAL_SHADOW, shadowLg: '0 24px 60px rgba(20,18,30,.22)' },
      dark: { canvas: '#0f0e13', surface: '#18171d', ink: '#f4f3f8', ink2: '#d3d1dc', muted: '#9e9cab', faint: '#5b5967', line: '#2b2a33', line2: '#222129', wash: '#1d1c24', accent: '#BE82FF', accentMid: '#DCAFFF', accentDeep: '#E6DCFF', accentDim: 'rgba(190,130,255,.14)', accentBorder: 'rgba(190,130,255,.34)', accentLight: '#2a2040', shadow: 'none', shadowLg: '0 24px 60px rgba(0,0,0,.65)' },
    },
    app: null,
  },
  mono: {
    name: 'Mono',
    description: 'Black, white and greys only. Nothing competes with the content.',
    swatch: ['#f5f5f5', '#ffffff', '#1a1a1a', '#2e2e2e'],
    space: {
      light: { canvas: '#f5f5f5', surface: '#ffffff', ink: '#1a1a1a', ink2: '#404040', muted: '#6b6b6b', faint: '#bdbdbd', line: '#e3e3e3', line2: '#efefef', wash: '#fafafa', accent: '#2e2e2e', accentMid: '#555555', accentDeep: '#111111', accentDim: 'rgba(0,0,0,.05)', accentBorder: 'rgba(0,0,0,.2)', accentLight: '#e8e8e8', shadow: '0 1px 2px rgba(0,0,0,.04),0 6px 20px rgba(0,0,0,.05)', shadowLg: '0 24px 60px rgba(0,0,0,.22)' },
      dark: { canvas: '#101010', surface: '#1a1a1a', ink: '#f2f2f2', ink2: '#d0d0d0', muted: '#a0a0a0', faint: '#5c5c5c', line: '#2e2e2e', line2: '#242424', wash: '#202020', accent: '#d6d6d6', accentMid: '#ececec', accentDeep: '#f5f5f5', accentDim: 'rgba(255,255,255,.1)', accentBorder: 'rgba(255,255,255,.28)', accentLight: '#2c2c2c', shadow: 'none', shadowLg: '0 24px 60px rgba(0,0,0,.65)' },
    },
    app: {
      light: { bg: '#f4f4f4', panel: '#ffffff', ink: '#1a1a1a', muted: '#6b6b6b', line: '#e3e3e3', wash: '#fafafa', accent: '#2e2e2e', send: '#2e2e2e', bubble: '#ebebeb' },
      dark: { bg: '#161616', panel: '#0d0d0d', ink: '#f2f2f2', muted: '#a0a0a0', line: '#2e2e2e', wash: '#1b1b1b', accent: '#d6d6d6', send: '#5c5c5c', bubble: '#262626' },
    },
  },
  azure: {
    name: 'Azure',
    description: 'White and clear blues, cool and technical.',
    swatch: ['#f3f8fc', '#ffffff', '#0f2a3d', '#0b6fa4'],
    space: {
      light: { canvas: '#f3f8fc', surface: '#ffffff', ink: '#0f2a3d', ink2: '#35546b', muted: '#5f7a8e', faint: '#b4c7d6', line: '#dbe7f0', line2: '#e9f1f7', wash: '#f7fbfe', accent: '#0b6fa4', accentMid: '#29b5e8', accentDeep: '#11567f', accentDim: 'rgba(11,111,164,.07)', accentBorder: 'rgba(11,111,164,.26)', accentLight: '#d8eefa', shadow: '0 1px 2px rgba(15,42,61,.04),0 6px 20px rgba(15,42,61,.06)', shadowLg: '0 24px 60px rgba(15,42,61,.22)' },
      dark: { canvas: '#0b1722', surface: '#112231', ink: '#eaf4fb', ink2: '#c3d8e8', muted: '#8fa9bd', faint: '#4a6378', line: '#1f3547', line2: '#182b3b', wash: '#152738', accent: '#56c6ef', accentMid: '#8bd9f5', accentDeep: '#bfe9fa', accentDim: 'rgba(86,198,239,.14)', accentBorder: 'rgba(86,198,239,.34)', accentLight: '#14384d', shadow: 'none', shadowLg: '0 24px 60px rgba(0,0,0,.65)' },
    },
    app: {
      light: { bg: '#f1f6fa', panel: '#ffffff', ink: '#0f2a3d', muted: '#5f7a8e', line: '#dbe7f0', wash: '#f7fbfe', accent: '#0b6fa4', send: '#0b6fa4', bubble: '#d8eefa' },
      dark: { bg: '#0f1b27', panel: '#0a141d', ink: '#eaf4fb', muted: '#8fa9bd', line: '#1f3547', wash: '#112231', accent: '#56c6ef', send: '#13709f', bubble: '#17303f' },
    },
  },
  signal: {
    name: 'Signal',
    description: 'Deep navy, white and a fresh green for what needs action.',
    swatch: ['#f2f5f6', '#ffffff', '#032d42', '#1c7f36'],
    space: {
      light: { canvas: '#f2f5f6', surface: '#ffffff', ink: '#032d42', ink2: '#2f5568', muted: '#5d7886', faint: '#b6c7cf', line: '#dce5e9', line2: '#eaf0f2', wash: '#f7fafb', accent: '#1c7f36', accentMid: '#62d84e', accentDeep: '#032d42', accentDim: 'rgba(31,138,59,.08)', accentBorder: 'rgba(31,138,59,.3)', accentLight: '#dff6d9', shadow: '0 1px 2px rgba(3,45,66,.04),0 6px 20px rgba(3,45,66,.06)', shadowLg: '0 24px 60px rgba(3,45,66,.24)' },
      dark: { canvas: '#04202e', surface: '#08303f', ink: '#eaf5f0', ink2: '#c0d8d2', muted: '#8fb0ac', faint: '#46666b', line: '#14455a', line2: '#0e3a4c', wash: '#0b3445', accent: '#62d84e', accentMid: '#8be67a', accentDeep: '#c3f5ba', accentDim: 'rgba(98,216,78,.14)', accentBorder: 'rgba(98,216,78,.34)', accentLight: '#0f4a40', shadow: 'none', shadowLg: '0 24px 60px rgba(0,0,0,.65)' },
    },
    app: {
      light: { bg: '#eef3f5', panel: '#ffffff', ink: '#032d42', muted: '#5d7886', line: '#dce5e9', wash: '#f7fafb', accent: '#1c7f36', send: '#1c7f36', bubble: '#dcebe6' },
      dark: { bg: '#06222f', panel: '#031821', ink: '#eaf5f0', muted: '#8fb0ac', line: '#14455a', wash: '#08303f', accent: '#62d84e', send: '#237a30', bubble: '#0d3a48' },
    },
  },
};

export const SKIN_LIST = SKINS.map((id) => ({ id, ...SKIN_DEFS[id] }));

export const isSkin = (value: unknown): value is SkinId => typeof value === 'string' && (SKINS as readonly string[]).includes(value);

const spaceVars = (t: SpaceTokens) =>
  `--canvas:${t.canvas};--surface:${t.surface};--ink:${t.ink};--ink-2:${t.ink2};--muted:${t.muted};--faint:${t.faint};--line:${t.line};--line-2:${t.line2};--wash:${t.wash};` +
  `--purple:${t.accent};--purple-mid:${t.accentMid};--purple-deep:${t.accentDeep};--purple-dim:${t.accentDim};--purple-border:${t.accentBorder};--purple-light:${t.accentLight};` +
  `--shadow:${t.shadow};--shadow-lg:${t.shadowLg}`;

/** Rules for a Space page. Empty for the original skin, whose values are the design system itself. */
export function skinSpaceRules(skin: SkinId): string[] {
  if (skin === DEFAULT_SKIN) return [];
  const { light, dark } = SKIN_DEFS[skin].space;
  return [`html:root,html:root[data-theme="light"]{${spaceVars(light)}}`, `html:root[data-theme="dark"]{${spaceVars(dark)}}`];
}

const appVars = (t: AppTokens) => `--bg:${t.bg};--panel:${t.panel};--ink:${t.ink};--muted:${t.muted};--line:${t.line};--wash:${t.wash};--accent:${t.accent};--send:${t.send};--user-bubble:${t.bubble}`;

/** CSS for the app window. Empty for the original skin. */
export function skinAppCss(skin: SkinId): string[] {
  const app = SKIN_DEFS[skin].app;
  if (!app) return [];
  return [`:root{${appVars(app.light)}}`, `:root[data-theme="dark"]{${appVars(app.dark)}}`];
}
