/**
 * Job postings in the shared database (Supabase, migration 034): the step before the recruiting process.
 * A posting is written from a template, checked, released by the hiring manager and published on channels.
 *
 * What the agent may do: READ templates, postings and the per-channel texts; WRITE a template of the person, a DRAFT, an edit of a
 * draft, and send a draft to the hiring manager for review. Nothing it writes becomes public.
 * What the agent may NOT do: release, publish or withdraw. `releasePosting`, `publishPostingMock`, `sendBackPosting` and
 * `withdrawPosting` are not tools; only the Werkbank's main process calls them after the hiring manager clicks, and the database accepts
 * them only from the manager of the requisition. Publishing is a simulation: no channel is connected, the database accepts no other mode.
 *
 * The text comes from `recruiting-logic.mjs` (same code as the Space page): every {{field}} the requisition can fill is filled, the
 * rest stays visible. Joule invents no tasks, no benefits and no pay; an empty field blocks "send for review".
 */
import { ToolError } from './tools.mjs';
import { actorOf } from './skill-lifecycle.mjs';
import { makeLogic } from './recruiting-logic.mjs';

const obj = (properties, required) => ({ type: 'object', properties, required, additionalProperties: false });
const ACTOR = { type: 'string', description: 'E-mail of the person acting (identity label, set once in the Werkbank). Never use someone else’s e-mail.' };
const REQ = { type: 'string', description: 'Requisition id, for example REQ-2204.' };
const POSTING = { type: 'integer', minimum: 1, description: 'Posting number, as listed by recruiting_list_job_postings.' };
const SECTION = obj({
  key: { type: 'string', description: 'Section key, for example title, role, must, nice, offer, pay.' },
  label: { type: 'string' },
  text: { type: 'string', description: 'Text of the section. Plain text; fields look like {{pay}}.' },
}, ['key', 'text']);

export const POSTING_TOOL_DEFINITIONS = [
  {
    name: 'recruiting_list_posting_templates',
    description: 'Read: the job posting templates the person can use: the company standard and saved templates (own or shared), with sections, locked sections, who owns them and how often they were used.',
    inputSchema: obj({ actor: ACTOR }, ['actor']),
  },
  {
    name: 'recruiting_save_posting_template',
    description: 'Write: save a new template of the person from the sections given. The locked sections of the company standard (company text, equal-opportunity text) are added and cannot be changed; the database refuses a template that changes them. Fields stay as {{field}}.',
    inputSchema: obj({
      actor: ACTOR, name: { type: 'string', description: 'Name of the template, up to 80 characters. A name of your own can be used once.' },
      sections: { type: 'array', items: SECTION, description: 'The sections of the template, with a "title" section.' },
      shared: { type: 'boolean', description: 'Let other people use the template. Default false (private).' },
    }, ['actor', 'name', 'sections']),
  },
  {
    name: 'recruiting_draft_job_posting',
    description: 'Write a DRAFT of a job posting for an open requisition from a template. Fills title, department, place, team and the criteria (must-haves, nice-to-haves) from the requisition. "role" is what the person will do, in the hiring manager’s words: without it the field stays empty and the check says so. Never fills in pay. Returns the draft, the check and what is missing. Nothing becomes public.',
    inputSchema: obj({
      actor: ACTOR, requisition: REQ,
      template: { type: 'integer', minimum: 1, description: 'Template number from recruiting_list_posting_templates. Default: the company standard.' },
      role: { type: 'string', description: 'What the person will do, as the hiring manager described it. Do not make this up.' },
      pay: { type: 'string', description: 'Pay range only if the hiring manager gave one. Never estimate.' },
    }, ['actor', 'requisition']),
  },
  {
    name: 'recruiting_update_job_posting',
    description: 'Write: change the text of unlocked sections of a DRAFT posting. Locked sections cannot be changed. Returns the check.',
    inputSchema: obj({
      actor: ACTOR, posting: POSTING,
      sections: { type: 'array', items: obj({ key: { type: 'string' }, text: { type: 'string' } }, ['key', 'text']), description: 'Sections to change: key and the new text.' },
    }, ['actor', 'posting', 'sections']),
  },
  {
    name: 'recruiting_list_job_postings',
    description: 'Read: job postings (draft, in_review, released, withdrawn) with their sections, who released them and where they were published (simulated).',
    inputSchema: obj({
      actor: ACTOR, status: { type: 'string', enum: ['draft', 'in_review', 'released', 'withdrawn'] }, requisition: REQ,
      limit: { type: 'integer', minimum: 1, maximum: 200 },
    }, ['actor']),
  },
  {
    name: 'recruiting_preview_posting_channels',
    description: 'Read: the text one posting would get on each channel (SAP career portal, LinkedIn, Xing, Monster.de, company social posts), its length against the limit of the channel and the link with its source. Sends nothing.',
    inputSchema: obj({ actor: ACTOR, posting: POSTING }, ['actor', 'posting']),
  },
  {
    name: 'recruiting_submit_job_posting',
    description: 'Write: send a draft to the hiring manager for review. The database checks the text again (title marker, empty fields, personal traits, credentials). Nothing becomes public: only the hiring manager can release and publish, and that is not a tool.',
    inputSchema: obj({ actor: ACTOR, posting: POSTING }, ['actor', 'posting']),
  },
];

const text = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '');
const longText = (v, n) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ').trim().slice(0, n) : '');
const REQ_ID = /^[A-Za-z0-9._-]{1,40}$/;

const idOf = (v, what) => {
  if (!Number.isInteger(v) || v < 1) throw new ToolError(`${what} must be a whole number from 1`);
  return v;
};
const requisitionId = (v) => {
  const id = text(v, 40);
  if (!REQ_ID.test(id)) throw new ToolError('requisition must be an id such as REQ-2204');
  return id;
};

/** The data the shared logic needs: the recruiting snapshot plus templates, channels, company and link base. */
export function postingData(snapshot, context) {
  return {
    ...snapshot,
    company: context.company,
    posting: { templates: context.templates, channels: context.channels, apply: context.applyBase, briefs: {} },
  };
}

const findingsOf = (L, sections, template) => L.lintPosting({ sections }, template).map((f) => ({ level: f.level, section: f.key, message: f.msg }));

const sectionsOf = (sections) => {
  if (!Array.isArray(sections) || !sections.length || sections.length > 20) throw new ToolError('sections must be a list of 1 to 20 sections');
  return sections.map((s) => {
    const key = text(s && s.key, 31);
    if (!/^[a-z][a-z0-9_]{0,30}$/.test(key)) throw new ToolError('a section key looks like "title" or "role"');
    return { key, label: text(s.label || key, 60) || key, locked: false, text: longText(s.text, 4000) };
  });
};

export function createPostingHandlers(rpc) {
  const call = async (fn, body) => {
    if (!rpc) throw new ToolError('The shared database is not set up: enter the Supabase URL and the secret key in the settings of this connector.');
    return rpc(fn, body);
  };
  const context = async (actor) => {
    const c = await call('recruiting_posting_context', { p_actor: actor });
    if (!c || !Array.isArray(c.templates)) throw new ToolError('The database returned no posting data. Is migration 034 applied?');
    return c;
  };
  const listPostings = async (actor, args = {}) => {
    const rows = await call('recruiting_postings_list', { p_actor: actor, p_status: args.status ?? null, p_requisition: args.requisition ?? null, p_limit: args.limit ?? 200 });
    return Array.isArray(rows) ? rows : [];
  };
  const getPosting = async (actor, id) => {
    const p = (await listPostings(actor)).find((x) => x.id === id);
    if (!p) throw new ToolError('unknown posting, or no access');
    return p;
  };
  const snap = async (actor) => {
    const D = await call('recruiting_snapshot', { p_actor: actor, p_with_cv: false, p_as_of: null });
    if (!D || !Array.isArray(D.jobs)) throw new ToolError('The database returned no recruiting data. Is migration 028 applied?');
    return D;
  };

  return {
    async recruiting_list_posting_templates(args) {
      const c = await context(actorOf(args));
      return {
        company: c.company,
        note: 'Locked sections belong to the company and cannot be changed. Fields such as {{role}} are filled from the requisition when a draft is written.',
        templates: c.templates.map((t) => ({
          id: t.id, name: t.name, kind: t.kind, owner: t.owner, shared: t.shared, uses: t.uses, lastUsed: t.lastUsed,
          sections: t.sections.map((s) => ({ key: s.key, label: s.label, locked: !!s.locked })),
        })),
      };
    },

    async recruiting_save_posting_template(args) {
      const actor = actorOf(args);
      const name = text(args.name, 80);
      if (!name) throw new ToolError('the template needs a name');
      const c = await context(actor);
      const standard = c.templates.find((t) => t.kind === 'standard');
      if (!standard) throw new ToolError('there is no company standard template');
      const given = sectionsOf(args.sections);
      const keys = new Set(given.map((s) => s.key));
      // Locked sections are the company's: added from the standard, never taken from the agent. A given section with a locked key is refused by the database.
      const sections = [...given];
      for (const s of standard.sections) if (s.locked && !keys.has(s.key)) sections.splice(Math.min(sections.length, standard.sections.indexOf(s)), 0, { key: s.key, label: s.label, locked: true, text: s.text });
      const out = await call('recruiting_posting_template_save', { p_actor: actor, p_name: name, p_sections: sections, p_shared: args.shared === true });
      return { ...out, message: 'Saved. The locked company sections were kept as they are.' };
    },

    async recruiting_draft_job_posting(args) {
      const actor = actorOf(args);
      const requisition = requisitionId(args.requisition);
      const c = await context(actor);
      const templateId = args.template === undefined ? (c.templates.find((t) => t.kind === 'standard') || {}).id : idOf(args.template, 'template');
      const tpl = c.templates.find((t) => t.id === templateId);
      if (!tpl) throw new ToolError('unknown template or no access');
      const D = await snap(actor);
      if (!D.jobs.some((j) => j.id === requisition)) throw new ToolError('unknown requisition, not open, or no access');
      const L = makeLogic(postingData(D, c));
      const brief = L.postingBrief(requisition);
      brief.role = longText(args.role, 1500);
      brief.pay = text(args.pay, 200);
      const draft = L.draftPosting(tpl, brief);
      const created = await call('recruiting_posting_create', { p_actor: actor, p_requisition: requisition, p_template: tpl.id, p_sections: draft.sections });
      const findings = findingsOf(L, draft.sections, tpl);
      return {
        posting: created.id, status: created.status, requisition, template: tpl.name,
        sections: draft.sections.map((s) => ({ key: s.key, label: s.label, locked: s.locked, text: s.text })),
        check: findings,
        readyForReview: !findings.some((f) => f.level === 'error'),
        message: findings.some((f) => f.level === 'error')
          ? 'Draft saved. It cannot be sent for review yet: see the check. Joule does not invent tasks or pay; ask the hiring manager.'
          : 'Draft saved. Nothing is public. Send it for review with recruiting_submit_job_posting; only the hiring manager can release and publish it.',
      };
    },

    async recruiting_update_job_posting(args) {
      const actor = actorOf(args);
      const id = idOf(args.posting, 'posting');
      const p = await getPosting(actor, id);
      if (p.status !== 'draft') throw new ToolError('only a draft can be edited. A released posting stays as it was: withdraw it and write a new one.');
      const changes = sectionsOf(args.sections);
      const sections = p.sections.map((s) => ({ ...s }));
      for (const ch of changes) {
        const s = sections.find((x) => x.key === ch.key);
        if (!s) throw new ToolError(`this posting has no section "${ch.key}"`);
        if (s.locked) throw new ToolError(`"${s.label}" is a locked company section and cannot be changed`);
        s.text = ch.text;
      }
      await call('recruiting_posting_update', { p_actor: actor, p_id: id, p_sections: sections });
      const c = await context(actor);
      const tpl = c.templates.find((t) => t.id === p.template);
      const L = makeLogic(postingData(await snap(actor), c));
      const findings = findingsOf(L, sections, tpl);
      return { posting: id, status: 'draft', check: findings, readyForReview: !findings.some((f) => f.level === 'error') };
    },

    async recruiting_list_job_postings(args) {
      const actor = actorOf(args);
      const rows = await listPostings(actor, {
        status: args.status, requisition: args.requisition === undefined ? null : requisitionId(args.requisition), limit: args.limit === undefined ? 50 : args.limit,
      });
      return { count: rows.length, postings: rows };
    },

    async recruiting_preview_posting_channels(args) {
      const actor = actorOf(args);
      const p = await getPosting(actor, idOf(args.posting, 'posting'));
      const c = await context(actor);
      const L = makeLogic(postingData(await snap(actor), c));
      return {
        posting: p.id, status: p.status,
        note: 'Preview only. No channel is connected and nothing is sent.',
        channels: c.channels.map((ch) => {
          const pk = L.channelPackage({ sections: p.sections }, ch, p.requisition);
          return { channel: ch.id, name: ch.name, countedAs: ch.source, length: pk.length, limit: pk.limit, fits: pk.fits, link: pk.link, text: pk.text };
        }),
      };
    },

    async recruiting_submit_job_posting(args) {
      const actor = actorOf(args);
      const out = await call('recruiting_posting_submit', { p_actor: actor, p_id: idOf(args.posting, 'posting') });
      return { ...out, message: 'Sent to the hiring manager for review. Nothing is public. Only the hiring manager can release and publish it.' };
    },
  };
}

/* ---------- Main-process writers (NOT tools): the hiring manager's steps, after a click ---------- */

export async function releasePosting(rpc, actor, id, note = '') {
  return rpc('recruiting_posting_release', { p_actor: actorOf({ actor }), p_id: idOf(id, 'id'), p_note: text(note, 300) });
}
export async function sendBackPosting(rpc, actor, id, note = '') {
  return rpc('recruiting_posting_send_back', { p_actor: actorOf({ actor }), p_id: idOf(id, 'id'), p_note: text(note, 300) });
}
export async function withdrawPosting(rpc, actor, id, reason) {
  return rpc('recruiting_posting_withdraw', { p_actor: actorOf({ actor }), p_id: idOf(id, 'id'), p_reason: text(reason, 300) });
}
export async function deletePostingTemplate(rpc, actor, id) {
  return rpc('recruiting_posting_template_delete', { p_actor: actorOf({ actor }), p_id: idOf(id, 'id') });
}

/**
 * Publishing, simulated. The main process builds the channel texts itself from the stored posting (the page cannot hand in a text),
 * and the database refuses a text above the limit of the channel. Nothing is sent anywhere.
 */
export async function publishPostingMock(rpc, actor, id, channelIds) {
  const who = actorOf({ actor });
  const pid = idOf(id, 'id');
  if (!Array.isArray(channelIds) || !channelIds.length) throw new ToolError('choose at least one channel');
  const rows = await rpc('recruiting_postings_list', { p_actor: who, p_status: null, p_requisition: null, p_limit: 200 });
  const p = (Array.isArray(rows) ? rows : []).find((x) => x.id === pid);
  if (!p) throw new ToolError('unknown posting, or no access');
  const c = await rpc('recruiting_posting_context', { p_actor: who });
  const D = await rpc('recruiting_snapshot', { p_actor: who, p_with_cv: false, p_as_of: null });
  const L = makeLogic(postingData(D, c));
  const packages = channelIds.map((cid) => {
    const ch = c.channels.find((x) => x.id === cid);
    if (!ch) throw new ToolError(`unknown channel: ${text(cid, 40)}`);
    const pk = L.channelPackage({ sections: p.sections }, ch, p.requisition);
    return { channel: ch.id, chars: pk.length };
  });
  return rpc('recruiting_posting_publish', { p_actor: who, p_id: pid, p_packages: packages });
}
