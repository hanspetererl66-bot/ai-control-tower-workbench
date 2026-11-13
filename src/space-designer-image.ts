/**
 * Picture for an image block: a file is shrunk so that it fits the page (at most MAX_IMAGE_BYTES), re-drawn from its pixels
 * (which also drops EXIF data such as place and camera) and stored as data inside the block. Pure planning here; the window
 * supplies `encode`, which draws the picture at a size and quality and returns a data address.
 */
import { MAX_IMAGE_BYTES, isImageSrc } from './space-layout.ts';

export const MAX_SOURCE_BYTES = 10_000_000;
/** Longest side, then quality, tried in this order until the result fits. */
const SIDES = [1280, 960, 720, 480, 320];
const QUALITIES = [0.85, 0.72, 0.6, 0.48, 0.36];

export type Encode = (width: number, height: number, quality: number) => string;

/** The size in bytes of the data in a data address. */
export const dataBytes = (src: string): number => {
  const b64 = src.split(',')[1] ?? '';
  return Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
};

/** The largest picture (by side, then by quality) that fits; null when even the smallest does not. Never makes a picture larger than the original. */
export function fitImage(width: number, height: number, encode: Encode): { src: string; width: number; height: number; bytes: number } | null {
  if (!(width > 0) || !(height > 0)) return null;
  const longest = Math.max(width, height);
  const sides = [...new Set(SIDES.map((s) => Math.min(s, longest)))];
  for (const side of sides) {
    const scale = side / longest;
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    for (const q of QUALITIES) {
      const src = encode(w, h, q);
      if (isImageSrc(src) && dataBytes(src) <= MAX_IMAGE_BYTES) return { src, width: w, height: h, bytes: dataBytes(src) };
    }
  }
  return null;
}

/** What kind of picture the first bytes are, or null (the file name is not trusted). */
export function sniffImage(bytes: Uint8Array): 'png' | 'jpeg' | 'webp' | 'gif' | null {
  const at = (i: number, ...v: number[]) => v.every((x, k) => bytes[i + k] === x);
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'jpeg';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'webp';
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'gif';
  return null;
}
