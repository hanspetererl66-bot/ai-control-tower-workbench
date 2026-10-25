export const PACKAGE_FORMAT: string;
export const MAX_PACKAGE_BYTES: number;
export const SLUG: RegExp;
export function buildSpacePackage(input: { slug: string; title?: string; files: Record<string, string>; now?: Date }): { format: string; version: number; slug: string; title: string; exportedAt: string; files: Record<string, string> };
export function parseSpacePackage(text: string): { slug: string; title: string; files: Record<string, string> };
export function uniqueSlug(slug: string, existing: string[]): string;
export function packageFileName(slug: string): string;
