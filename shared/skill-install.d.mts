export { MAX_SKILL_BYTES, checkSkillMd } from './skill-check.mjs';
export function installSkill(skillsDir: string, text: string, options?: { replace?: boolean }): { name: string; description: string; dir: string; replaced: boolean };
