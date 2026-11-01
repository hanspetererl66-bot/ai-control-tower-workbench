#!/usr/bin/env node
import { SKILL_TOOL_DEFINITIONS, createSkillHandlers } from '../../_lib/server/skills.mjs';
import { SKILL_PROFILE_TOOL_DEFINITIONS, createSkillProfileHandlers } from '../../_lib/server/skill-profiles.mjs';
import { SKILL_RATING_TOOL_DEFINITIONS, createSkillRatingHandlers } from '../../_lib/server/skill-ratings.mjs';
import { SKILL_LIFECYCLE_TOOL_DEFINITIONS, createSkillLifecycleHandlers } from '../../_lib/server/skill-lifecycle.mjs';
import { SKILL_FILE_TOOL_DEFINITIONS, createSkillFileHandlers } from '../../_lib/server/skill-files.mjs';
import { serve } from '../../_lib/server/runtime.mjs';

serve({
  name: 'skill-marketplace',
  version: '1.2.0',
  instructions: "Skill marketplace: search the approved skills before building a new one (search_skills, check_skill_duplicates), and read impact, governance, lifecycle and ratings. Skill lifecycle: the marketplace card (get_skill_card, set_skill_card), the approval flow (request_skill_promotion, decide_skill_request, withdraw_skill_request) and deprecate, retire and restore, with the history in get_skill_status. These tools write to the shared registry: ask the person first, name the actor by e-mail, and never decide an approval for someone else. Extra files of a skill (scripts, templates) are kept with it: list_skill_files, get_skill_file, set_skill_file, delete_skill_file. Rating a skill is the other write.",
  tools: [...SKILL_TOOL_DEFINITIONS, ...SKILL_PROFILE_TOOL_DEFINITIONS, ...SKILL_RATING_TOOL_DEFINITIONS, ...SKILL_LIFECYCLE_TOOL_DEFINITIONS, ...SKILL_FILE_TOOL_DEFINITIONS],
  handlers: ({ rpc }) => ({
    ...createSkillHandlers(rpc),
    ...createSkillProfileHandlers(undefined, rpc),
    ...createSkillRatingHandlers(undefined, rpc),
    ...createSkillLifecycleHandlers(rpc),
    ...createSkillFileHandlers(rpc),
  }),
});
