export const MAX_DESCRIPTION: number;
export const MAX_SKILL_CHARS: number;
export const SECRET_LIKE: RegExp;
export function parseRequires(value: unknown): string[];
export function missingConnectors(requires: string[] | undefined, available: Iterable<string>): string[];
