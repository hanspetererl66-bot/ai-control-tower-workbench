/**
 * Turns the personal settings into CSS for the app and into a small override for Spaces.
 * Pure functions: the App only puts the result into a <style> element, so the output can be tested.
 */
import { FONT_STACKS, type Preferences } from './preferences.ts';

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const toHex = (c: number[]) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
export const mix = (a: string, b: string, amount: number): string => {
  const [x, y] = [rgb(a), rgb(b)];
  return toHex(x.map((v, i) => v + (y[i] - v) * amount));
};
/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Accent values for the light and dark theme. White text must stay readable on it; a light colour is darkened. */
export function accentVariants(hex: string): { light: string; dark: string; lightMid: string; darkMid: string; lightWash: string; darkWash: string } {
  let base = hex.toUpperCase();
  while (luminance(base) > 0.3 && base !== '#000000') base = mix(base, '#000000', 0.15);
  const dark = mix(base, '#FFFFFF', 0.3);
  return {
    light: base,
    dark,
    lightMid: mix(base, '#FFFFFF', 0.35),
    darkMid: mix(base, '#FFFFFF', 0.55),
    lightWash: mix(base, '#FFFFFF', 0.9),
    darkWash: mix(base, '#000000', 0.7),
  };
}

const DENSITY = { compact: 0.75, normal: 1, roomy: 1.3 } as const;

/** CSS for the app window. Empty settings give an empty string. */
export function buildPreferenceCss(prefs: Preferences): string {
  const css: string[] = [];
  if (prefs.accent) {
    const a = accentVariants(prefs.accent);
    css.push(`:root{--accent:${a.light};--send:${a.light}}`, `:root[data-theme="dark"]{--accent:${a.dark};--send:${a.dark}}`);
  }
  const stack = FONT_STACKS[prefs.font];
  if (stack) css.push(`html,body,button,input,textarea,select{font-family:${stack}}`);
  if (prefs.density !== 'normal') css.push(`:root{--dens:${DENSITY[prefs.density]}}`);
  if (prefs.contrast === 'high') {
    css.push(
      ':root{--line:#6b7280;--muted:#374151}',
      ':root[data-theme="dark"]{--line:#9ca3af;--muted:#e5e7eb}',
      ':focus-visible{outline:3px solid var(--accent)!important;outline-offset:2px}',
      'button,input,textarea,select{border-width:max(1px,var(--bw,1px))}'
    );
  }
  if (prefs.reduceMotion) css.push('*,*::before,*::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important;scroll-behavior:auto!important}');
  return css.join('\n');
}

const MARK = 'werkbank-space-prefs';

/** Spaces use --purple, --purple-mid and --purple-light; set them from the accent. Also reduces motion. */
export function applySpacePrefs(html: string, prefs: Pick<Preferences, 'accent' | 'reduceMotion' | 'contrast' | 'font'>): string {
  const rules: string[] = [];
  if (prefs.accent) {
    const a = accentVariants(prefs.accent);
    rules.push(
      `html:root,html:root[data-theme="light"]{--purple:${a.light};--purple-mid:${a.lightMid};--purple-light:${a.lightWash}}`,
      `html:root[data-theme="dark"]{--purple:${a.dark};--purple-mid:${a.darkMid};--purple-light:${a.darkWash}}`
    );
  }
  const stack = FONT_STACKS[prefs.font];
  if (stack) rules.push(`html body,html button,html input,html textarea,html select{font-family:${stack}}`);
  if (prefs.contrast === 'high') rules.push('html:root{--line:#6b7280;--muted:#374151}html:root[data-theme="dark"]{--line:#9ca3af;--muted:#e5e7eb}');
  if (prefs.reduceMotion) rules.push('*,*::before,*::after{animation-duration:.001ms!important;transition-duration:.001ms!important}');
  if (!rules.length || html.includes(`id="${MARK}"`)) return html;
  const block = `<style id="${MARK}">${rules.join('')}</style>`;
  return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${block}</head>`) : block + html;
}
