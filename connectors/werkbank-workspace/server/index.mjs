#!/usr/bin/env node
import { PREFERENCE_TOOL_DEFINITIONS, createPreferenceHandlers } from '../../_lib/server/preferences.mjs';
import { GROUP_TOOL_DEFINITIONS, createGroupHandlers } from '../../_lib/server/groups.mjs';
import { WORK_ITEM_TOOL_DEFINITIONS, createWorkItemHandlers } from '../../_lib/server/work-items.mjs';
import { JOB_RUN_TOOL_DEFINITIONS, createJobRunHandlers } from '../../_lib/server/job-runs.mjs';
import { RECRUITING_TOOL_DEFINITIONS, createRecruitingHandlers } from '../../_lib/server/recruiting.mjs';
import { POSTING_TOOL_DEFINITIONS, createPostingHandlers } from '../../_lib/server/job-postings.mjs';
import { INTERVIEW_TOOL_DEFINITIONS, createInterviewHandlers } from '../../_lib/server/interviews.mjs';
import { serve } from '../../_lib/server/runtime.mjs';

serve({
  name: 'werkbank-workspace',
  version: '1.6.0',
  instructions: "Personal settings sync (never secrets) and shared groups with roles, Spaces, configuration and team memory. Agents, workflows and code of any kind are saved as revisions in the shared database (save_work_item, get_work_item, list_work_items, work_item_history, archive_work_item). Writes ask the person first and name the actor by e-mail. The Scheduler run log can be read (list_job_runs: who ran which job, when, and how it ended); the agent cannot write to it. Recruiting (recruiting_get_pipeline, recruiting_get_shortlist, recruiting_list_proposals, recruiting_create_proposal, recruiting_list_hire_requests, recruiting_create_hire_request): hiring control tower and shortlist against the criteria a hiring manager set, on pseudonymous candidates. The agent may write a proposal only; it cannot decide, reject a candidate, approve a hire or change anything in a recruiting system. Hiring approvals (hiring manager, HR, finance, optional department head) are decided by those people in the Hiring Approvals space. Job postings (recruiting_list_posting_templates, recruiting_save_posting_template, recruiting_draft_job_posting, recruiting_update_job_posting, recruiting_list_job_postings, recruiting_preview_posting_channels, recruiting_submit_job_posting): drafts from a template, never public. Only the hiring manager releases and publishes (simulated); the agent cannot. It never invents tasks or pay. Online interview records (recruiting_interview_records): read-only; answers, task result per criterion and a summary, no score.",
  tools: [...PREFERENCE_TOOL_DEFINITIONS, ...GROUP_TOOL_DEFINITIONS, ...WORK_ITEM_TOOL_DEFINITIONS, ...JOB_RUN_TOOL_DEFINITIONS, ...RECRUITING_TOOL_DEFINITIONS, ...POSTING_TOOL_DEFINITIONS, ...INTERVIEW_TOOL_DEFINITIONS],
  handlers: ({ rpc }) => ({ ...createPreferenceHandlers(rpc), ...createGroupHandlers(rpc), ...createWorkItemHandlers(rpc), ...createJobRunHandlers(rpc), ...createRecruitingHandlers(rpc), ...createPostingHandlers(rpc), ...createInterviewHandlers(rpc) }),
});
