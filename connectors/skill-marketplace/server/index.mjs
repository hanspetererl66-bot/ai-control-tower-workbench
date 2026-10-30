#!/usr/bin/env node
import { SKILL_TOOL_DEFINITIONS, createSkillHandlers } from '../../_lib/server/skills.mjs';
import { SKILL_PROFILE_TOOL_DEFINITIONS, createSkillProfileHandlers } from '../../_lib/server/skill-profiles.mjs';
import { SKILL_RATING_TOOL_DEFINITIONS, createSkillRatingHandlers } from '../../_lib/server/skill-ratings.mjs';
import { serve } from '../../_lib/server/runtime.mjs';

serve({
  name: 'skill-marketplace',
  version: '1.0.0',
  instructions: "Skill marketplace: search the approved skills before building a new one, and read impact, governance, lifecycle and ratings. Rating a skill is the only write.",
  tools: [...SKILL_TOOL_DEFINITIONS, ...SKILL_PROFILE_TOOL_DEFINITIONS, ...SKILL_RATING_TOOL_DEFINITIONS],
  handlers: ({ rpc }) => ({ ...createSkillHandlers(rpc), ...createSkillProfileHandlers(undefined, rpc), ...createSkillRatingHandlers(undefined, rpc) }),
});
