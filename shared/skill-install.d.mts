export const MAX_SKILL_BYTES: number;
export function checkSkillMd(text: string): { ok: boolean; problems: string[]; warnings: string[]; name: string; description: string };
export function installSkill(skillsDir: string, text: string, options?: { replace?: boolean }): { name: string; description: string; dir: string; replaced: boolean };
