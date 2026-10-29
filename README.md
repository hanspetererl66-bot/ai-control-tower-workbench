# Joule Work X - Next Gen Design Study
# Werkbank - Extended by some more capabilities to showcase possible business scenarios

Joule Work X - Next Gen Design Study (a private design study, based on the open-source [Werkbank](https://github.com/marianfoo/werkbank) by marianfoo) is a local desktop workbench for AI-assisted conversations, file context,
persistent Spaces, MCP connectors, and reusable agent skills. The renderer talks to
a project-local [Goose](https://block.github.io/goose/) process through the Agent
Client Protocol; connector configuration and generated work stay in the local project
workspace.

> **Not affiliated with SAP.** "Joule" is the name of an SAP product. This is an independent design study in a similar style; it is not
> SAP software and is not endorsed by SAP. Internal identifiers (the `werkbank://` link scheme, storage keys, package name) keep
> the original name so existing links and data keep working.

## What works

- Streaming conversations with stop, permission, and mode controls
- Multiple active and archived conversations stored locally
- Word, PowerPoint, text, CSV, JSON, and image attachments
- Persistent, sandboxed HTML Spaces generated from grounded data
- Session-scoped MCP connector selection and guarded `.mcpb` imports
- Connector configuration with secret-shaped values stored through Electron safe storage
- Skill install deep links with an explicit in-app confirmation step
- Light, dark, and system appearance settings

## Local development

Werkbank currently targets macOS for source-based development. Node.js 22.12 or newer
is required.

```sh
npm install
cp .env.example .env
# Add OPENROUTER_API_KEY and choose a compatible GOOSE_MODEL in .env
npm run dev
```

The app uses the repository-local `goose-home/` and `workspace/` directories. Runtime
credentials, selected attachments, generated Spaces, and outputs are ignored by Git.
Only the files under `workspace/demo-files/` are synthetic fixtures intended for tests.

## Using the app store

The current release runs from source, so start Werkbank before using an install button:

1. Complete the local setup above and keep `npm run dev` running with the Werkbank window open.
2. Open the [Werkbank app store](https://getwerkbank.com/#store) in your browser.
3. Choose an MCP server or skill and select **Add to Werkbank** or **Add skill**.
4. On the install page, select **Open Werkbank** and allow the browser to open the
   `werkbank://` link.
5. Review the source and requested configuration inside Werkbank, provide any required
   credentials, and confirm the installation.

Installed items appear under **Connectors & Skills** in the app, where connectors can be
configured, restarted, or removed. If an install page does not return to the app, confirm
that the Werkbank window is still running, reload the install page, and select
**Open Werkbank** again.

## AI Control Tower example Space

This fork bundles an AI Control Tower dashboard (illustrative sample data) as a Space.
Install it into the spaces folder with:

```
npm run install:control-tower
```

It then appears in the Spaces list. The source lives in `examples/control-tower/`.

The risk register is data-driven: edit `examples/control-tower/data.json`, then run
`npm run sync:control-tower` to embed it into the page (a Space cannot fetch files
from inside the sandbox). `npm test` fails if the two drift apart.

### Control Tower connector (MCP)

`connectors/control-tower/` is a small, dependency-free MCP server that lets the chat
query the same `data.json` the Space renders: risks, agent registry, unregistered
assets, overprivileged agents and the AI budget. All tools are read-only.

```
npm run build:control-tower-mcpb     # writes dist/ai-control-tower.mcpb
```

Then in Werkbank open **Connectors & Skills**, choose **Import MCP bundle**, pick the
file and confirm. Ask, for example, "Which risks are below 40% mitigated?". Edits to
the bundled `data.json` apply without restarting the agent. Every result carries a
`view` field naming the Control Tower tab that shows the same information.

## Gmail connector (read + drafts)

A second bundled MCP connector (`connectors/gmail`) lets the chat search and read your Gmail and
create **draft** replies. It has four tools (`list_labels`, `search_mail`, `read_mail`, `create_draft`)
and deliberately no tool that sends or deletes mail; you review and send drafts in Gmail yourself.
Mail text is treated as untrusted and returned with a notice not to follow instructions inside it.
Google's `gmail.compose` scope technically also permits sending, so keep the refresh token private.

1. In your own Google Cloud project: enable the Gmail API, configure the OAuth consent screen
   (External, add yourself as test user), and create an OAuth client of type **Desktop app**.
2. `GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... npm run gmail:authorize` and sign in; the refresh
   token is printed to the terminal only.
3. `npm run build:gmail-mcpb` writes `dist/gmail-drafts.mcpb`. In **Connectors & Skills** choose
   **Import MCP bundle** and paste client ID, client secret and refresh token into the dialog
   (stored as secrets). Do not put them in `.env`, the repo or a chat.

Use a personal account, not a work mailbox: mail content is sent to the configured model provider.

## Sub4Me example Space (customer portal mock-up)

`examples/sub4me` is a second bundled Space: a fictional customer portal with contracts, AI-unit
consumption per product (with year-end forecast) and service tickets. All data is fictional and the
page says it is not affiliated with any vendor. Install with `npm run install:sub4me` (or
`npm run install:examples` for both Spaces), then restart or refresh the app.

**Tickets in Supabase (temporary demo storage).** Spaces have no network access, so the Space asks the
app by `postMessage`, and the app calls two fixed tools of the Control Tower connector
(`list_tickets`, `create_ticket`) over the agent session, which read/insert rows through
`public.sub4me_tickets()` / `public.sub4me_create_ticket()` (migration `006`, server-side key only).
Creating a ticket is the only write the connector can do; it cannot edit or delete rows. Without the
Supabase URL/key or without a connected agent the Space falls back to page-only tickets and says so.
You can also ask in the chat: "Eröffne ein Sub4Me-Ticket ...". To clear the tickets you added, see the
`delete` statement at the end of the migration file.

## Shared visual design

Both example Spaces use one design system: `examples/shared/design-system.css` (tokens for colour,
type, radius and spacing; light and dark via `prefers-color-scheme`; violet accent). Spaces are
single-file pages without network access, so the CSS is embedded into each page by
`npm run sync:design` (a test fails if a page is out of sync). Edit the shared file, then sync.

## Verification

```sh
npm run check
```

This runs the TypeScript check, Node test suite, and production renderer build.

## Develop: intent-based development

The **Develop** icon starts a guided process instead of opening a blank tool. For **Create a Workflow with n8n** and **Create an Agent**:

1. **Intent**: a short form (goal, what starts it, systems, data in and out, how much it may do alone, how you will know it works).
2. **Requirements**: the chat agent writes a Product Requirements Definition with numbered, testable requirements (REQ-01 …). You read it, edit it, ask for changes and approve it.
3. **Specification & Architecture**: from the approved PRD, the agent writes the specification and the solution architecture (a diagram, the n8n node plan or the skill outline, data contracts, errors, security, test plan), traced to the REQ IDs. You approve it.
4. **Build**: from both documents, the agent writes the importable n8n workflow file, or a `SKILL.md`. The result is checked (valid JSON, unique node names, no secrets, front matter) before you can download the workflow or install the skill. Changing an earlier document takes the later approvals back.

The documents are kept per project in this app and can be downloaded as Markdown. Each step runs in its own conversation, named "Develop: …". Experts can still open n8n and Connectors & Skills directly from the Develop page.
## Mass upload of tables

In the chat, attach up to **25 files** at once (the **+** button or drag and drop). CSV, TSV and Excel files are read locally; the model gets a compact description (rows, columns, types, ranges, sample rows) and the file path, not the whole table.
When tables are attached, a bar appears under the files:

- **Make a table Space** builds one Space with a tab per file (per sheet for Excel), search, sortable columns and an "Ask about this table" button. A Space holds at most 2,000 rows per table.
- **Send rows to n8n…** sends the rows of one file in batches (50 to 500 rows) to a webhook, with progress, retries and "Continue at batch N" after an error. Import `examples/n8n-workflows/09-bulk-table-ingest.json` into n8n, run `supabase/migrations/20261028_018_bulk_upload_rows.sql`, set `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` in n8n, activate the workflow and paste its production URL. Sending a batch twice does not duplicate rows. The webhook address is remembered on this computer; the optional token is not saved.

### Demo: contract notice check after an upload

`examples/demo-data/contracts-demo.xlsx` (also as `.csv`) holds 60 fictional contracts. Attach it in the chat, click **Send rows to n8n…** and note the **Upload ID** shown when it is done. Then import `examples/n8n-workflows/10-contract-notice-from-upload.json` (needs workflow 09, the migration and the same Supabase variables) and call it with that ID. It reads the uploaded rows from Supabase, computes every notice deadline (reference date 19 Oct 2026 unless you pass `asOf`) and answers with a digest per owner: which contracts must be terminated or renewed soon, which deadlines have passed, how much annual value is affected. Nothing is sent. `node scripts/make-demo-contracts.mjs` writes the files again.

## Connectors and skills

Use **Connectors & Skills** inside the app to import an MCP bundle, configure an
installed connector, restart the local agent, or remove a connector or skill. Browser
handoffs use the `werkbank://` protocol and always stop at an in-app review dialog.

[![Add SAP Notes MCP to Werkbank](https://getwerkbank.com/assets/add-to-werkbank.svg)](https://getwerkbank.com/install-mcpb/?url=https%3A%2F%2Fgithub.com%2Fmarianfoo%2Fsap-mcp-servers%2Freleases%2Fdownload%2Fsap-notes-latest%2Fsap-notes.mcpb&title=SAP%20Notes%20MCP)

Connector maintainers can use the same button in their own README. Replace the encoded
bundle URL and title in the link target; the hosted page validates the HTTPS source and
opens Werkbank's guarded in-app confirmation. See [`site/README.md`](site/README.md) for
the copyable Markdown.

## Publication status

The source, static website, and guarded install handoffs are release-prepared. A signed,
notarized desktop installer is not included yet; follow the order in
[`site/README.md`](site/README.md) before publishing the website or advertising binary
downloads.

## License

[Apache License 2.0](LICENSE)

### Supabase as data source (optional)

The connector reads the sample data from Supabase when `Supabase project URL` and
`Supabase secret key` are filled in on import; otherwise it uses the bundled `data.json`.
If Supabase is configured but unreachable, it falls back to `data.json` and every result
carries a `dataSource` field saying which one was used.

- `supabase/migrations/` creates the `control_tower` schema (RLS on, no access for `anon`/`authenticated`),
  seeds it from `data.json`, and adds `public.control_tower_snapshot()`, executable only by the server-side key.
- Use a **secret** key (`sb_secret_…`) of a project that holds only this sample data. It bypasses RLS,
  so never put it in the repo; Werkbank stores it as a secret.
- Read-only: the connector has no write tools. `data.json` stays the source for the embedded dashboard.

### Chat → dashboard

After an answer that used the Control Tower connector, the chat shows a button such as
"Im Control Tower ansehen: Risk & Compliance". It opens the Space and switches to the tab that shows the
same information (`src/control-tower-views.ts`: risks → Risk & Compliance, agents → Agent Repository,
budget → Model Governance). The Space only accepts a `ct:open-tab` message from its parent window and
only for tab ids that exist on the page. After pulling, run `npm run install:control-tower` once so the
installed Space contains the updated page.

### Cover sheet and one-click connector

- Clicking the diamond at the top of the left rail opens a full-screen cover sheet:
  "Joule Work X - Next Gen · Design Study · Built by Accenture · Demo only". Click anywhere outside the
  text, "Close" or Esc to dismiss it.
- If the AI Control Tower connector is not installed or not connected, the empty chat says so and offers
  **Jetzt installieren**. That stages the connector bundled in this repository and opens the usual approve
  dialog; the Supabase URL and key fields can stay empty to use the sample data. No `.mcpb` file is needed.


## Shared skills registry (Supabase)

Skills can be shared with colleagues through the same Supabase project (migration `007`). The Goose agent
reads skills from files, so colleagues **sync** published skills into their local `goose-home/.agents/skills/`.

- **Read (everyone):** the publishable key can call `skills_list` / `skills_get`, which only return `published` skills.
- **Write (maintainer):** the secret key uploads drafts and releases them (`release`); the agent has no tool for this.
- **Safety:** every version is checksummed (SHA-256, verified on sync); names must equal the folder name;
  skills that look like they contain credentials are refused; local skills are never overwritten (`--force` to replace).

```bash
# Colleague: pull published skills (then restart the agent)
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_KEY=<publishable key> npm run skills:sync

# Maintainer
SUPABASE_URL=… SUPABASE_SECRET_KEY=… npm run skills:publish            # upload examples/skills/* as drafts
SUPABASE_URL=… SUPABASE_SECRET_KEY=… npm run skills -- release board-briefing
SUPABASE_URL=… SUPABASE_SECRET_KEY=… npm run skills -- retire board-briefing
SUPABASE_URL=… SUPABASE_SECRET_KEY=… npm run skills -- list
```

### Skills marketplace, stage 1: profile, search, duplicate check

Every skill carries a profile in the `metadata:` block of its `SKILL.md` (migration `008`):

```yaml
metadata:
  domain: Finanzen            # Governance & Risiko | Service & Support | Finanzen | Vertrieb | HR | Entwicklung | Betrieb | Automatisierung | Sicherheit & Zugriff | Skill-Management | Sonstiges
  process: Reisekosten prüfen
  data-class: intern          # öffentlich | intern | vertraulich
  language: de
  team: Finance
  tools: create_ticket, list_tickets   # must be real connector tools (checked on publish)
```

- **Search before building:** the connector tools `search_skills` and `get_skill_info`, and the skill `skill-finder`,
  look up published skills by task description (German full-text search plus shared tools).
- **Duplicate check on publish:** `npm run skills:publish` looks up similar skills first. If one is similar, the skill is
  not uploaded until you pass `--variant-of <name>` or `--reason "neu weil …"`; the decision is stored in the profile.
- **Maturity** (see below): new and changed skills start as `pilot`.
- The tool dependencies are stored as rows in `skills.skill_tool`; they become the edges of the knowledge graph in stage 2.

### Maturity, approval and ranking

Two separate things describe a skill:

- **Publication status:** `draft` → `published` → `retired`. Only published skills are visible, searchable and synced
  (`npm run skills -- release <name>` / `retire <name>`). This was called `approved` before migration `010`.
- **Maturity:** `pilot` → `empfohlen` (recommended) → `approved`. `recommend` / `unrecommend` switch between the first two.
  **Approved** is the official review and records who approved which version and when:
  `npm run skills -- approve <name> --by "Name"` (or `SKILL_APPROVER`); the skill has to be released first.
  Any new version of a skill falls back to `pilot` and clears the approval.

**Demand ranking.** Installs (by `skills:sync`), views (`get_skill_info`) and search hits (`search_skills`) are counted per
anonymous machine hash, with no name or address. One machine counts once per skill and event within a day (install) or
ten minutes (view, search hit). Score = 3 × installs + 1 × views + 0.5 × search hits over the last 30 days, with the trend against
the 30 days before. The Space has a **Ranking** tab (top 10, filter by board area); the chat answers
"Welche Skills sind am stärksten nachgefragt?" with `get_skill_ranking` (connector 0.9.0). The counters are best-effort
and can be inflated by anyone holding the publishable key, so treat the numbers as a signal, not as proof. The skill itself
does not report its use yet.

### Skill marketplace overview: board areas, LOBs, teams, individual

Every skill profile can carry a classification in the `metadata:` block of its `SKILL.md`:
`board-area` (Finance, Sales, Marketing, Engineering), `lob` (BTP, Concur, SuccessFactors; all belong to Engineering),
`team` (free text) and `scope`, the reach of the skill: `individual` → `team` → `lob` → `board-area` → `company`.
A skill without a scope counts as `individual`; a team scope needs a team, a LOB scope a LOB. Apply migration `009`
(only function bodies change) before publishing skills with the new fields; changed skills go back to draft and need
`npm run skills -- release <name>` again.

- **Space "Skill Marketplace":** `npm run install:skill-marketplace` installs it (overview by board area, LOB and team, catalog with filters,
  hints on possible duplicates and gaps). `npm run sync:skill-marketplace` embeds the example skills of the repository;
  `SUPABASE_URL=… SUPABASE_KEY=<publishable key> npm run sync:skill-marketplace -- --registry` installs the Space and writes the published skills of the
  registry into the installed copy only (`workspace/spaces/`), so files tracked by Git stay unchanged and `git pull` never conflicts.
  Skills tagged **Sample** are fictional and only show the structure.
- **Chat:** `list_skill_catalog` (connector 0.8.0), for example "Welche Skills gibt es in Engineering?" or "Was hat das AI Programme Office gebaut?".
- **Knowledge graph later:** board area, LOB, team, scope and the tool rows in `skills.skill_tool` are the nodes and edges of stage 2;
  nothing here has to be migrated away.

### Sales: interest to contract

A mockup Space **Sales** (`npm run install:sales`) shows the whole process as a funnel and a board: Interest, Lead, Opportunity, Sell, Contract. A click on a deal opens a drawer with the gate checklist for the next stage, the reasons behind a lead score, risks, a timeline that points to the calls and mails of the other Spaces, and the next skill with the sentence to type in the chat. The tabs *Workflow and skills* and *Rules and safeguards* show the exit criteria per stage and what a person decides, what skills prepare and what is never automated. Data: `examples/sales/pipeline.json` (embedded by `npm run sync:mockups`). Offers and contracts mirror the Sub4Me sample data (a test compares them), interest, lead and opportunity are made up. No CRM is connected.

Nine new skills cover the stages, all in `examples/skills/` with domain *Vertrieb*: `interest-logger`, `lead-qualifier`, `lead-router`, `opportunity-planner`, `rfp-responder` (closes the RFP gap), `pricing-guard`, `deal-risk-check`, `contract-checker` and `pipeline-review`. They work with what the person gives in the chat and with the Sub4Me and graph tools; they prepare and check, they never send, price or sign. In the Skill Marketplace they form the capability *Sales pipeline* and the collections PB-07 to PB-11 (the last one walks the whole way). Metrics, ratings and review data of the new skills are fictional samples like the others.

Database: the domain list was out of date (four example skills could not be published). `supabase/migrations/20261020_014_skill_domains.sql` adds Vertrieb, Automatisierung, Sicherheit & Zugriff and Skill-Management. The sample data migrations 012 (profiles) and 013 (ratings) were regenerated with the new skills; both are upserts, so running them again is safe.

Six more skills close the gaps for an account executive: `discovery-meddpicc`, `competitive-battlecard`, `business-case-builder`, `security-questionnaire-helper`, `handover-onboarding-plan` and `call-followup` (23 registered skills in total). They sit in the capability *Sales pipeline* and in the collections PB-12 (Opportunity absichern), PB-13 (Sicherheit und Übergabe) and PB-14 (Nach dem Kundengespräch). None of them sends mail or writes to a CRM; `handover-onboarding-plan` creates a ticket only after confirmation.

The Sales Space has two more tabs. **Forecast** shows commit, best case and pipeline by close month with weighted totals and target coverage (category rule: probability 70 % or more and a cleared discount is commit, 50 to 69 % best case, below 50 % pipeline). **Meetings** lists upcoming meetings with a brief, questions and flags, and finished calls with proposed CRM changes, actions from the call and a follow-up mail that is only a draft. Data is in `examples/sales/pipeline.json` (`closeDate`, `category`, `forecast`, `meetings`); a test keeps it consistent with the call transcripts, e-mail threads and Sub4Me data. After a pull run `npm run sync:mockups`, `npm run sync:skill-marketplace` and `npm run install:sales`.

### MCP Marketplace

A Space **MCP Marketplace** (`npm run install:mcp-marketplace`) is a governed catalog of MCP servers. Each entry shows what the server can do (tools classed as reads only, can change the system, can read business data), which switches are off by default, authentication, install options, our assessment, a pilot plan and the checks still open. Candidates: **ARC-1** (`arc-mcp/arc-1`, ABAP development over ADT, MIT, read-only by default) and **SAP Notes** (`marianfoo/sap-mcp-servers`, search and read SAP Notes behind the S-user login; the README tells users to check SAP's terms first). The two built-in connectors appear as reference entries and a test keeps their tool lists equal to the manifests. Facts about the candidates come from their public READMEs on 2026-10-20 and were not run by us; the page says so. The Space lists and assesses only: installation stays with Connectors & Skills and its in-app review dialog. Data lives in `examples/mcp-marketplace/servers.json` (embedded by `npm run sync:mockups`).

### Skill Marketplace as a control surface for business users

The Space is now organised for business users instead of a flat list. Navigation: **Discover** (search with live hits, skills by business
capability, featured skills, collections), **Collections** (ready-made skill sequences with a role filter), **Catalog** (filters, now also by
capability), **My skills** (registered skills in this workspace with a "needs attention" list) and **Insights** (overview, ranking, impact,
governance, gaps, hints). Capabilities are defined in `examples/skill-marketplace/profiles.json` (`capabilities`; a test requires every skill
to belong to exactly one). Collections are the existing playbooks; each shows per step why, input and output, how many skills are available
(the Sample switch changes that), summed time saved, highest AI Act risk and lowest maturity. The skill detail page starts with a
"Trust & fit" strip (maturity, AI Act, DPIA, allowed data, models, region, next review, needs, collections). Sandbox runs, signatures and
install buttons are not part of this design study. After a pull run `npm run sync:skill-marketplace` and `npm run install:skill-marketplace`.

### Asking the chat about the Sub4Me Space

The connector `ai-control-tower` (0.7.0) also answers questions about the Sub4Me example Space with `list_contracts`
(filter by status, for example "Wie viele Verträge sind abgelaufen?"), `list_offers` (renewal offers and offers for new
products such as Joule Work for Desktop, for example "Welche Angebote liegen vor?") and `get_ai_consumption` (forecast and split by
product and month; optional `product` or `month`, for example "Wann ist das BTP-AI-Core-Budget aufgebraucht?"). A Space is a sandboxed page, so
the agent cannot read what a Space shows; it reads the same sample data through these tools (taken from the Space's
inline JSON in a checkout, and from `data/sub4me.json` inside the `.mcpb`). Rebuild and re-import the connector after updating.

## n8n Cloud: sidebar, chat and Automation Dashboard

**Sidebar.** The workflow icon in the rail opens your n8n Cloud instance inside the app. Enter the address once (for example `firma.app.n8n.cloud`); the page runs in its own session, separate from the app and the Spaces, and can only navigate within your instance and `n8n.cloud` (anything else opens in the browser). Login happens at n8n; the app stores no password or token, only the instance address in `goose-home/n8n.json`.

**Chat.** "Mit Chat verbinden" in that view adds n8n's instance-level MCP server (`https://<instance>/mcp-server/http`) as a connector named `n8n` and restarts the agent. goose runs the OAuth login itself on first use, so no token is written to `config.yaml`. In n8n, enable *Settings → Instance-level MCP* and switch on *Available in MCP* for each workflow the chat may find and run. Without that switch a workflow stays invisible to the chat. Every connected client sees all MCP-enabled workflows of that user, so enable only what the chat should be allowed to start.

**Automation Dashboard (Space).** `npm run install:automation` installs the Space with fictional sample data (marked "Sample"). For real data create an API key in n8n (*Settings → n8n API*) and run:

```bash
N8N_URL=https://firma.app.n8n.cloud N8N_API_KEY=… npm run sync:automation -- --live
```

It reads workflows (name, tags, active) and the last 14 days of executions (status, mode, duration; never payloads) and writes them only into the installed copy under `workspace/spaces/automation-dashboard`, so `git pull` never conflicts. The key lives only in that command.

**Categories.** The Automation Dashboard sorts workflows into categories by their n8n tags (rules and assumed minutes per run in `examples/automation-dashboard/categories.json`, first match wins). A workflow can be pinned with the n8n tag `cat:<Category name>`. Trigger and connected apps are derived from the workflow's node types. The Categories tab shows the rules, per-category figures and the workflows that are not categorized yet. Time saved is an estimate (successful runs x assumed minutes), not a measurement.

**Text size in Spaces.** All Spaces render 15% larger by default. Settings → "Text size in Spaces" offers 100%, 115% and 130%. The app injects one `zoom` rule into the page it hands to the Space frame, so it also applies to Spaces the agent builds and needs no change inside a Space.

### Asking the chat about n8n and the Sub4Me test customer

Connector 0.10.0 adds, next to the Control Tower tools:

- **Sub4Me 360°:** `get_customer_overview` (master data, contracts, offers, AI units, tickets, highlights), `get_product_overview`, `get_contract`, `get_offer`, `search_sub4me`. Contracts, offers and consumption are the sample data of the Sub4Me Space; tickets come from Supabase when connected, otherwise the sample tickets.
- **n8n Cloud:** `get_n8n_overview`, `list_n8n_workflows`, `get_n8n_workflow`, `list_n8n_executions`, `list_n8n_categories`. They read the n8n public API (last 14 days, status, mode, duration, tags, node types; never execution contents) and use the same categories as the Automation Dashboard. For this, import the connector again ("Import .mcpb…" or the Control Tower connector entry) and fill in the two new fields: the n8n address and an n8n API key. The key is stored as a secret.
- Starting or changing workflows is not part of these tools. That is what "Mit Chat verbinden" in the n8n view provides (n8n's own MCP server, only for workflows marked "Available in MCP").

Examples: "Wie läuft unsere n8n-Automatisierung?", "Welche Workflows sind in den letzten Tagen fehlgeschlagen?", "Gib mir das Gesamtbild zu unserem Testkunden", "Wann muss der Ariba-Vertrag gekündigt werden?".

### Skill Marketplace: impact, governance, lifecycle, discovery

Every skill has a profile in four fields, plus the marketplace knows process gaps and skill requests. Source: `examples/skill-marketplace/profiles.json` (fictional).
- **Impact** (tab *Impact*): runs per month, success and error rate, rating, minutes saved, hours and value (hours × hourly rate), run cost.
- **Governance** (tab *Governance*): EU AI Act class, DPIA, allowed data classes, approved models, review cycle, linked Control Tower risks and agents.
- **Lifecycle** and **Discovery**: open a skill (click a row or a catalog card) for change log, dependencies, tests, sunset, deputy, example prompts, demo flow, related skills and recommended roles. The catalog has a role filter.
- **Gaps** (tab *Gaps*): processes without a skill and requests from the teams.

`npm run sync:skill-marketplace` embeds the profiles into the Space; `npm run sync:skill-profiles` writes `supabase/migrations/20261019_012_skill_profiles.sql` (run it once in the Supabase SQL editor). Chat tools: `get_skill_impact`, `get_skill_governance`, `get_skill_lifecycle`, `find_skill_gaps`, `recommend_skills`, and `recommend_skill_workflow` (an ordered chain of skills for a role and goal, from the `playbooks` in `profiles.json`, for example Account Manager: customer-call-prep → renewal-radar → quote-drafter → ticket-writer; connector 0.13.0; live from Supabase when connected, otherwise the embedded sample data).

### Sales Space: sources, inbox and governance

Ideas taken from AI-native CRMs (sourced reasoning, auto-capture, governed agents), all mockup data in `examples/sales/pipeline.json`:

- **Why? Sources** in the deal drawer: each statement (probability, value, notice date) lists the mail, call, contract, ticket, invoice or offer it comes from, with a confidence. A test checks that every reference exists.
- **Inbox:** suggestions captured from mails and calls (new stakeholder, risk, next step, closing an open action). Nothing reaches a deal until you accept; accepted and rejected items can be undone. A discount question cannot be accepted here and goes to the deal desk; an instruction hidden in a customer mail is blocked and flagged.
- **Governance:** four levels (does it itself, you confirm, needs an approver, never) and an audit log of every decision, including undo.
- **Two accounts:** the pipeline now also carries Hanse Handelsgruppe AG (interest, lead, opportunity, three offers, two contracts) built from the Sub4Me data; its briefs and evidence use tickets, offers, contracts and invoices (there are no sample calls or mails for Hanse). The forecast target is raised to 1.5M for both accounts.
- **Forecast changes** since the previous week (category, probability, value, close date, each with its reason) and a **customer context** block in the meeting brief: open tickets, invoices and forecast changes from the Sub4Me data. The skill `customer-call-prep` now does the same through `list_tickets` and `list_invoices` and names a source for every statement.

### Sub4Me: second customer, invoices and the ticket check

**SAP customer ID:** each customer has a unique, fictional 10-digit SAP customer ID (`sapCustomerId`): Muster Industrie AG `0010048211`, Hanse Handelsgruppe AG `0010073904`. It is separate from the Sub4Me customer number. It is shown in the Sub4Me header, the Sales deal drawer and the Knowledge Graph customer node, returned by `list_customers`, and stored in `sub4me.customers.sap_customer_id` (unique; run the regenerated migration 015 again, it is safe to repeat). Source: `examples/sub4me/` data and `examples/sales/pipeline.json` (`accounts`).

The Sub4Me Space now has a customer switch in the header: **Muster Industrie AG** (industrial, S/4HANA) and **Hanse Handelsgruppe AG** (retail, Commerce Cloud, Ariba, Analytics Cloud). Each has its own profile (industry, account team, contacts, landscape), contracts, offers, AI-unit consumption, tickets and a new **Invoices** tab (invoices, credit notes, open and overdue amounts). All data is fictional and lives in `examples/sub4me/portfolio.json` (`profile`, `invoices`, `otherCustomers`, `knowledge`); `npm run sync:sub4me` embeds it and writes `supabase/migrations/20261021_015_sub4me_customers.sql` (run it once after 006 and 011; it is re-runnable).

**Ticket check.** "Check, then send ticket" first looks for (1) a solution in the SAP Help Portal and the SAP Community (connector tools `search_sap_help` and `search_sap_community`, public content, no login) plus the sample notes, and (2) the same issue in the open tickets of all customers. Nothing is created until the person confirms: also when nothing is found, the ticket is only sent after "Send ticket". Inside the app the Space asks the connector through the bridge (`s4m:check-request`; each source can fail on its own and is shown as "not available"); opened standalone in a browser only the sample notes and sample tickets are used. Community posts are labelled as not official SAP guidance. Links are shown as text because the Space sandbox cannot open pages. The Help Portal and Community search formats are not verified against the live sites. Three example buttons show the cases: a note plus a ticket of another customer (Hanse, quota error), a note only (Hanse, empty invoice fields), and no match (Hanse, PDF export). If the same issue is open at another customer, the customer can *follow* that ticket (no new ticket; a row in `sub4me.ticket_links`) or open a new ticket that is *linked* to it. The other customer's details stay hidden in the portal. The notes are fictional samples (`SAMPLE-xxxx`); with the SAP Notes MCP installed, the skill `ticket-triage` also searches the real notes. Matching is a simple word-overlap score (strong from 0.5, possible from 0.35), implemented once in `connectors/control-tower/server/ticket-match.mjs` and copied into the page; a test keeps both identical.

Connector tools: every Sub4Me and ticket tool takes an optional `customer` (`muster`, `hanse`); new are `list_customers`, `list_invoices`, `find_similar_tickets` and `link_ticket`. The knowledge graph, calls, e-mails and Sales Space stay with Muster Industrie. After a pull: `npm run install:sub4me`, run migration 015 in Supabase, `npm run build:control-tower-mcpb`, re-import the connector and restart.

### SAP Help Portal search (no S-user)

The connector tool `search_sap_help` queries the public search of help.sap.com (documentation and support content, no login) and returns title, link, product and an excerpt. It contacts only help.sap.com, drops links to other hosts, strips HTML and tells the model to treat the text as data. It runs on your computer when the connector is called, so it needs internet access there. The response format was taken from public descriptions and is covered by tests with a fake response; it has **not** been checked against the live service from the development environment. The `ticket-triage` skill uses it next to `find_similar_tickets`. After a pull: `npm run build:control-tower-mcpb`, re-import the connector and restart.

### Sub4Me: contract and offer details

`examples/sub4me/portfolio.json` is the single source for the contracts and offers of the Sub4Me test customer, each with about 25 fictional attributes (contract type, billing and payment terms, SLA, data centre, contacts, licensed vs. used units, invoicing, auto-renewal, termination; for offers list price, discount, stage, win probability, approval, competitor, next step, conditions) and line items.
`npm run sync:sub4me` embeds it into the Space (click a row in **Contracts** for the detail view) and writes `supabase/migrations/20261019_011_sub4me_contracts_offers.sql`. Run that file once in the Supabase SQL editor; it is re-runnable. The chat connector then reads contracts and offers live from Supabase (`public.sub4me_portfolio()`, secret key only) and falls back to the embedded copy.

## Sales Knowledge Graph example Space

One interactive graph over the other examples: the Sub4Me customer with contracts, offers, products and tickets, the Skill Marketplace (skills and the tools they use), the Control Tower (risks, agent families) and n8n (workflows, apps). Nothing is stored separately: `npm run sync:knowledge-graph` derives the graph from those sources plus `examples/knowledge-graph/links.json` (curated links and the guided tour) and embeds it into the Space (`-- --check` fails when it is stale). Everything is fictional sample data.

Install it with `npm run install:knowledge-graph` (or `npm run install:examples knowledge-graph`).

In the Space: search with fly-to, **Explore** (neighbours of a node), **Impact** (what hangs on a node, depth 1–4, animated by distance), **Path** (shortest connection between two nodes), three guided tours (Ariba renewal, AI governance, customer communication), type filters, pinning (double-click), minimap and keyboard controls (`+`/`-`, arrows, `0`, `Esc`). Hub nodes (systems, connector) are not followed in Impact and Path, so results stay about business relations.

The same graph is available in chat through five connector tools (connector 0.12.0): `get_graph_overview`, `search_graph`, `get_graph_neighbors`, `find_graph_path` and `analyze_graph_impact`, for example “Was ist betroffen, wenn der Ariba-Vertrag nicht verlängert wird?” or “Wie hängt Risiko R2 mit dem Kunden zusammen?”. After updating, re-import the connector in the app so the new tools appear.

## Mockup Spaces: call transcripts and e-mail communication

Two design mockups for additional sources, with fictional data only and no real connection (no mailbox, no call platform, nothing recorded, read, stored or sent):

- **Call Transcripts** (`examples/call-transcripts`): calls with summary, decisions, risks, action items (owner, due date, overdue), a mood timeline and a searchable transcript. Every decision, risk and action jumps to the passage it came from; a second tab collects all action items across calls.
- **E-Mail-Communication - Kunde: Muster Industrie AG** (`examples/customer-emails`, formerly “Customer E-Mails”): the mail conversations with one customer, with summary, open points, response times against a 48-hour target, a draft reply (mock, never sent), weekly volume, and a page on rules and privacy. One message contains instructions aimed at AI assistants; it is flagged and shown as plain text. Open points are matched with the calls (for example a mail that confirms an action still open after a call).

Install with `npm run install:call-transcripts` and `npm run install:customer-emails`. The sample data lives in `calls.json` and `threads.json` next to each page; `npm run sync:mockups` embeds it (`-- --check` fails when stale).
## Tables in chat answers

Chat answers are rendered as GitHub-flavoured Markdown (`remark-gfm`), so Markdown tables become real tables, styled in `src/theme.css` (`.md-table`): header row, soft row separators, hover, light and dark. Numeric columns (numbers, amounts, percentages) are right-aligned automatically, ids and single words stay on one line, and wide tables scroll inside the message. The helpers live in `src/markdown-table.ts`, the component in `src/ui/ChatMarkdown.tsx`.
### Skill ratings (stars)

Skills can be rated with 1 to 5 stars and an optional comment (max 280 characters), anonymously and once per person and skill; rating again replaces the earlier rating. The Skill Marketplace shows the stars in the catalog and the impact table, can sort by best rated or most ratings, and has a *Ratings* card in the skill detail (average, distribution, latest comments). Skills with fewer than 5 ratings show as "new"; the ranking uses a damped average so two five-star votes do not beat forty votes at 4.6.

- **Sample data:** `examples/skill-marketplace/ratings.json` (fictional), embedded by `npm run sync:skill-marketplace`.
- **Supabase:** `npm run sync:skill-ratings` writes `supabase/migrations/20261019_013_skill_ratings.sql`. Run it once in the Supabase SQL editor after 012 (safe to run again; it only refreshes the sample rows). It creates `skills.skill_rating` (RLS on, no access for anon/authenticated) and two functions that only the server-side secret key may call: `skills_ratings()` and `skills_rate()`. Only skills in the registry (`skills.skill`, not retired) can be rated.
- **Chat (connector 0.14.0):** `get_skill_ratings` (ranking, or one skill with distribution and comments) and `rate_skill`; the skill `rate-skill` asks for the stars and confirms before saving. `recommend_skills` and `recommend_skill_workflow` show the rating too. The rater is a hash of the local user and host (override with the env var `SKILL_RATER_ID`); no names are stored. Without a Supabase connection nothing is saved.

### Sales Knowledge Graph: value, time, questions, stakeholders

The Space opens in the **Sales view**: customers, deals (leads and opportunities), offers, contracts, calls, e-mails and contacts. Skills, tools, risks, agents, workflows and apps are **Enablers**, hidden until the **Enablers** button switches them on.

- **Value**: node size is the ACV, line width (customer to deal, offer or contract) the TCV, colour the win probability (70 % and more green, 50 to 69 % amber, below 50 % red, contracts blue). The **Value** button turns this off. Deals come from `examples/sales/pipeline.json`; TCV is ACV times the term in months divided by 12.
- **Week slider**: steps of three days over the last 18 days. Calls, e-mails, deals and contacts appear on their date (field `date` on the node), a dashed ring marks what is new in the last 7 days, the label shows what was added and the open ACV. The play button lets the graph grow.
- **Questions**: five chips (risk, contact in calls and e-mails, missing skill, changes since last week, blockers). The answer colours the matching sub-graph and lists the nodes with the reason in the side panel.
- **Stakeholder map**: person nodes carry `stake` with role (Sponsor, Decider, Blocker, Influencer) and contact strength (none, light, medium, strong). The role comes from the job title by simple rules, the strength counts shared calls and e-mails. The map lists contacts per customer and flags missing sponsors or deciders.

### Calls and e-mails in the Knowledge Graph

The mockup data of the two Spaces above is part of the graph: **Call** and **E-mail conversation** nodes connect to the customer and to the contract, offer and ticket they discuss. A mail is linked to a call (`follows up on`) where both concern the same open action, for example the mail that confirms an alert still open after the escalation call. The mail with the instruction aimed at AI assistants is linked to risk R7 (prompt injection). The graph tools understand the new types (`type: "call"` or `"thread"`), so chat can answer “Was wurde zum Ariba-Vertrag besprochen und geschrieben?” via `analyze_graph_impact`. The third tour, “Customer communication”, walks through this. `npm run sync:knowledge-graph` rebuilds the graph from `calls.json` and `threads.json`.

## Conversation search and filter

In the **Conversations** list the magnifier opens a search field (titles and message text, case-insensitive, `Esc` clears and closes) and the funnel opens a filter menu: all conversations, updated today, last 7 days, or with files. Both combine, the list shows “x of y shown” with a **Clear** link, and archived conversations that match appear automatically. Filtering is in `filterConversations` (`src/conversations.ts`).
## n8n demo workflows (simple and complex)

Importable workflows in `examples/n8n-workflows/`, fictional data only, no credentials, nothing is sent:

- `01-simple-contract-notice-check.json`: notice deadlines (contract end minus notice period) and days left, IF “within the window?” → alert or ok, a report sorted by urgency. Manual start (five sample contracts) or **POST to `/webhook/contract-notice-check`** with `{"withinDays":60,"asOf":"2026-10-24","contracts":[{"id","product","end","noticeDays"}]}`; the contracts from `list_contracts` fit as they are. Chat tool: `run_contract_notice_check` (“Which notice deadlines are due in the next 60 days?”). Also good for explaining the basic building blocks.
- `02-complex-communication-digest.json`: manual, weekday-morning or **webhook `/webhook/communication-digest`** (`{customer, mails, actions, ownDomains, asOf}`; without mails and actions the fictional sample is used; chat tool `run_communication_digest`: “Check the mails and open actions of customer X”), a Switch that splits mails and call action items, a **guardrail** that quarantines mail text containing instructions aimed at AI assistants (the same case as in the E-Mail-Communication Space), intent and 48-hour response target, overdue check, three Merge nodes and one digest per customer that ends in “create a draft, never send”. 20 nodes, two branches, IF, Switch, Merge, Code.
- `03-sales-pipeline-digest.json`: six fictional interest signals or your own through **webhook `/webhook/sales-pipeline-digest`** (`{signals:[{id, account, source, industry, region, employees, budget, decisionMaker, need, timing, text}], asOf}`; chat tool `run_sales_pipeline_digest`: “Score these five contacts from the event”; unknown facts score 0), a **guardrail** that quarantines text containing instructions aimed at AI assistants, a transparent score (ICP fit, budget, decision maker, need, timing), a Switch that routes to opportunity, nurture or watch, three Merge nodes and a digest that ends in “draft, never send”. 15 nodes, no credentials.

- `04-it-operations-alert-triage.json`: for the IT operations topic. Start with **Execute workflow** (seven fictional monitoring alerts) or by **POST to `/webhook/it-ops-triage`** with `{"alerts":[{"id","service","severity","impact","customerFacing","repeat24h","text"}]}` (activate the workflow first and use the production URL). A **guardrail** quarantines alert text aimed at AI assistants, a transparent priority (severity, business impact, customer facing, repeats) routes to P1 page on-call, P2 ticket or P3 watch, and the digest ends in “draft, never execute”. 17 nodes, no credentials.

- `05-vm-maintenance-plan.json`: the 25 VMs of the IT Infrastructure Space, rules per VM, recommended tasks (certificate, patch, disk, backup), maintenance windows, bundling per VM, plan proposal that ends in "nothing runs, a person approves". Manual or webhook start (`/webhook/vm-maintenance-plan`).

- `06-vm-operator-runbook.json`: the operator side of a VM ticket. Steps: **1 check the VM again** (same rules as the Space and workflow 05), **2 backup** if a production VM has no restore point from the last 24 h, **3 apply the task** (for example install the renewed TLS certificate), **4 check again** and report for the ticket. It only runs when the body says `approved: true` and the check still shows the reason; everything is simulated. Manual (sample ticket T-1042) or webhook `/webhook/vm-operator-runbook` with `{ticket, vm, task, approved}`; the chat tool is `run_vm_operator_runbook`.
- `07-vm-maintenance-approval.json`: the **approval step** between plan (05) and runbook (06). One request per task with the approver role from the task definition, a **Wait** node that pauses until the approver answers, rules (wrong role = invalid, **the requester can never approve their own request**, no answer = pending then expired, nothing is approved automatically) and an audit report. Approved tasks become the prepared call for workflow 06 (`approved: true`); this workflow starts nothing itself. Manual (fictional plan with sample decisions) or webhook `/webhook/vm-maintenance-approval` with `{plan, requester}`; the approver answers through the Wait resume URL with `{decisions:[{id, decision, by, role, comment}]}`.

### Overview: which workflows to import

| File | Name in n8n | Trigger | Webhook path | Used by |
| --- | --- | --- | --- | --- |
| `01-simple-contract-notice-check.json` | Demo 1 (simple) | Manual, webhook | `/webhook/contract-notice-check` | Renewals story, tool `run_contract_notice_check` |
| `02-complex-communication-digest.json` | Demo 2 (complex) | Manual, weekdays 07:30, webhook | `/webhook/communication-digest` | E-Mail-Communication story, tool `run_communication_digest` |
| `03-sales-pipeline-digest.json` | Demo 3 (sales) | Manual, webhook | `/webhook/sales-pipeline-digest` | Sales Space story, tool `run_sales_pipeline_digest` |
| `04-it-operations-alert-triage.json` | Demo 4 (IT operations) | Manual, webhook | `/webhook/it-ops-triage` | IT Operations Space, tool `run_it_ops_triage` |
| `05-vm-maintenance-plan.json` | Demo 5 (IT infrastructure) | Manual, webhook | `/webhook/vm-maintenance-plan` | IT Infrastructure Space, tool `run_vm_maintenance_plan` |
| `06-vm-operator-runbook.json` | Demo 6 (IT infrastructure) | Manual, webhook | `/webhook/vm-operator-runbook` | IT Infrastructure Space (operator ticket), tool `run_vm_operator_runbook` |
| `07-vm-maintenance-approval.json` | Demo 7 (IT infrastructure) | Manual, webhook (+ Wait resume) | `/webhook/vm-maintenance-approval` | Approval between plan (05) and runbook (06) |

All six can be started from the chat (set `N8N_URL` in the connector settings and **activate** the workflows you want to call; a workflow with only the manual trigger cannot be activated, which is why 01 to 03 now have a webhook). For a test without activating, use mode `test` and click **Execute workflow** first.

Import in n8n: **Workflows → ⋯ → Import from file**, then **Execute workflow**. The workflows stay inactive; the Code nodes use a fixed reference date (19 Oct 2026) so the result is the same every day. `test/n8n-demo-workflows.test.mjs` checks the structure and runs the Code nodes.

## IT Operations example Space

`examples/it-operations/` is a Space for IT operations alert triage: seven fictional monitoring alerts, a transparent priority (P1 page on-call, P2 ticket, P3 watch) with the reasons per alert, a guardrail that quarantines alert text aimed at AI assistants, and a form to add your own alert. The page calculates the preview itself with the same rules as the n8n workflow `examples/n8n-workflows/04-it-operations-alert-triage.json`; `test/it-operations.test.mjs` keeps both equal.

**Run in n8n**: a Space has no network, so the button asks the chat (`wb:ask`) to call the connector tool `run_it_ops_triage`. The tool posts the alerts to `<N8N_URL>/webhook/it-ops-triage` (or `/webhook-test/` with `mode: "test"`), nothing else, and returns the digest. Setup: import the workflow, switch it to active, enter the n8n address in the connector settings. Nothing is paged, restarted or changed. Install with `npm run install:it-operations`; `npm run sync:it-operations` embeds `alerts.json` and the design system.

## IT Infrastructure example Space

`examples/it-infrastructure/` is a status wall of 25 fictional virtual machines. Every VM is green, yellow or red, calculated on the page from fixed rules (`vms.json`, key `rules`): CPU, memory and disk usage, backup age (production VMs only), missing security patches, and an unreachable VM is always red. Hovering over a VM (or focusing it with the keyboard) shows why it has its colour with the measured values and the limits; clicking shows the measurements and a button that asks Joule (`wb:ask`) about the VM. Filters for red, yellow and green, KPIs and the rule table are on the page. The TLS certificate expiry is a sixth check. Every yellow or red reason becomes a **recommended task** (renew certificate, install security patch, free up disk space, catch up the backup, check an unreachable VM, analyse a CPU peak, check memory pressure) with three steps, an approver and a maintenance window (a restart needs one, several tasks of one VM are bundled). Each task runs through the flow detect, propose, approve, run (simulated), verify, and the VM is measured again afterwards. **Create ticket for operator** (VM details and task table) hands a VM and its tasks to the operator (priority follows the colour; the chat opens the ticket with `create_ticket`), and **Run runbook in n8n** lets the operator run `06-vm-operator-runbook.json` (check, backup, install the certificate, check again; simulated) through `run_vm_operator_runbook`. **Start demo** walks through the seven steps; **Reset demo** starts over. **Create the plan in n8n** asks the chat (`wb:ask`) to call the connector tool `run_vm_maintenance_plan`, which posts to `<N8N_URL>/webhook/vm-maintenance-plan` (or `/webhook-test/...` with mode `test`) of the workflow `examples/n8n-workflows/05-vm-maintenance-plan.json`; the plan is a proposal only. Fictional data, nothing is measured live and nothing is changed. `npm run sync:it-infrastructure` embeds the data and the design system, `npm run install:it-infrastructure` installs the Space (or `npm run install:examples` for all); `test/it-infrastructure.test.mjs` checks the rules and the sync.

## Renewals example Space

`examples/renewals/` is a Space only for renewals. `renewals.json` is generated from the Sub4Me sample data of both customers (`npm run sync:renewals`): every contract that ends by the end of 2027, plus the lapsed ones. The **decision date** is the contract end minus the notice period. The page calculates a **health** per renewal from fixed rules (decision date passed or near, no or expiring offer, price rise above the contract cap, competitor, usage, open tickets, overdue invoice; the worst signal wins and every signal is listed with its reason) and up to three **next actions** in a fixed priority order. Views: a time line with the decision dates and today, a table sorted by decision date, and a detail panel with usage, the offer (price rise against the cap), the reasons, the actions and a flow Detected, Prepared, Offer approved, Sent, Signed (sending and signing are simulated, a person approves). Buttons ask the chat (`wb:ask`) for the renewal talk (skill `customer-call-prep`) and the price check (skill `pricing-guard`). **Retention and customer lifetime value:** for the selected renewal a card shows the expected retention (from the health), the expected lifetime (1 / (1 − retention), capped), the lifetime value (annual value × margin × lifetime), the share of the customer's annual value, the retention levers taken from the signals, and **alternative offers** (as offered or at the contract cap, 3-year commitment with price guarantee, right-sized to usage, growth bundle, win-back entry price for lapsed ones) with annual value, term, change against today, retention and expected lifetime value. The best value within the contract cap is marked, the chosen option feeds the signed value, and a button asks the chat for the cover note. The margin and retention figures are illustrative assumptions (`RULES` in `scripts/sync-renewals.mjs`, shown on the page). **Automatic renewal:** a switch (off by default) lets renewals below an annual value of 30,000 EUR (`autoThresholdEur`) run without a person: if there is no warning signal (an approaching date and a missing offer do not block) and an offer within the contract cap exists, the best-value offer is created and a simulated e-mail goes to the customer, with a short audit list. Everything else (an overdue invoice, an open ticket, a competitor, low usage, a lapsed contract, a value of 30,000 EUR or more) is shown with its reasons and stays with a person. Six small add-on contracts (fictional, marked in `ADDONS`) show both paths. **Start demo** walks through seven steps (radar, what is due first, why is Ariba red, retention value and alternatives, approve, send and sign, automatic path). `npm run install:renewals` installs the Space; `test/renewals.test.mjs` checks the data, the rules and the sync. Fictional data, nothing is sent.

`examples/renewals/` is a Space only for renewals. `renewals.json` is generated from the Sub4Me sample data of both customers (`npm run sync:renewals`): every contract that ends by the end of 2027, plus the lapsed ones. The **decision date** is the contract end minus the notice period. The page calculates a **health** per renewal from fixed rules (decision date passed or near, no or expiring offer, price rise above the contract cap, competitor, usage, open tickets, overdue invoice; the worst signal wins and every signal is listed with its reason) and up to three **next actions** in a fixed priority order. Views: a time line with the decision dates and today, a table sorted by decision date, and a detail panel with usage, the offer (price rise against the cap), the reasons, the actions and a flow Detected, Prepared, Offer approved, Sent, Signed (sending and signing are simulated, a person approves). Buttons ask the chat (`wb:ask`) for the renewal talk (skill `customer-call-prep`) and the price check (skill `pricing-guard`). **Start demo** walks through six steps (radar, what is due first, why is Ariba red, prepare and price check, approve, send and sign). `npm run install:renewals` installs the Space; `test/renewals.test.mjs` checks the data, the rules and the sync. Fictional data, nothing is sent.
## IT Fleet example Space

`examples/it-fleet/` shows how the status wall scales to many customers: 41 fictional customers with about 1,200 VMs (generated from a fixed seed by `scripts/generate-fleet-data.mjs` into `fleet.json`; rules and task definitions are copied from the IT Infrastructure Space, a test keeps the colour logic equal). A customer is as red as its worst VM. Three views: **Treemap** (one tile per customer, area = VMs, colour = worst VM, hover for the reasons), **Heatmap** (customers against checks, a column with many customers points to a shared cause, plus a 14-day trend), and **Task inbox** (the same task on many VMs is one bundle with one approval; approving and running is simulated and the colours change). Filters: status, production only, region, customer search. Clicking a customer opens its VM wall, the SAP customer ID and buttons to ask Joule or to create a ticket for the operator (chat tool `create_ticket`). **Start demo** walks through five steps. `npm run sync:it-fleet` embeds the data and the design system, `npm run install:it-fleet` installs the Space; `test/it-fleet.test.mjs` checks data, sync and logic.

## Infrastructure change demo (Fleet → Operations → Checks → Fleet)

Three Spaces play one process, simulated end to end. In **Infra-Operations-Fleet** open the red customer Muster Industrie AG, then the red VM `musind-int04` (certificate expires in 6 days), and choose *Create ticket for operator*. The host opens **Infrastructure Operations** with the ticket in *Tickets for the operator*. *Start change* opens the New task drawer (leave *Run the whole process automatically* ticked). The process then runs by itself: pre-check in the **Pre-Checks and Post-Checks** Space (playbook in check mode with a live log, then back to the change request), approval (four-eyes, simulated after about 20 s each; production needs two), wait for the downtime window (demo clock), upgrade, post-check in Pre-Checks and Post-Checks, ticket closed, and a success message in the Fleet (the VM is green again). The *Demo speed* selector makes the whole run take about 10 s.

Spaces cannot talk to each other directly. A Space posts `{type:'wb:handoff', to, payload, open, notice}` to the host, which validates shape and size, queues it and (with `open`) opens the target Space; the target receives it as `wb:restore {state, handoffs}` when its frame has loaded. A Space keeps its working state across the trip with `wb:state`. The state lives in memory only. Nothing from a payload is executed.

## Groups (shared Spaces, instructions and team memory)

Settings → **Groups** lets a team share Spaces, one set of instructions and a team memory. Everything lives in Supabase (migration `20261025_017_werkbank_groups.sql`, schema `werkbank`, closed tables, `security definer` functions that only the connector's service key may call); the app reaches it through the 13 connector tools `group_*` (control-tower connector 0.18.0, same Supabase URL and secret key as the settings sync).

- **Roles:** admin (members, configuration, delete), member (publish Spaces, add memory), viewer (read). The rules are checked in the database; the last admin cannot be removed.
- **Spaces:** *Publish* sends the Space package (the same file as *Share*, at most 5 MB) to the group, a new publish is a new version. *Install* puts the group version on the computer and asks before replacing a Space of the same name.
- **Team memory:** rules, decisions and facts (600 characters each); author or admin edits and deletes, deleting asks first. With *Use in chat* the rules and the group instructions go to the assistant as background; they never override safety rules, tool permissions or the request. The group is read again every minute.
- **Identity:** the person types an e-mail once. This is a label, not a login: anyone who knows a member's address could act as that member. Do not put anything in a group you would not show the whole team. Real sign-in (Supabase Auth or SSO) is the next step if groups go beyond a trusted team. Anything that looks like a key, token or password is refused in the group configuration.

## Memory (personal notes for the assistant)

Settings → **Memory** holds short notes the assistant keeps in mind in every conversation: *About me*, *How I like results*, *Projects and context* (50 entries, 300 characters each). They are stored on this computer only, can be switched off, edited and forgotten (asks first). Nothing is saved by the assistant on its own: when you write something like "Merk dir: …", "Remember that …", "Ab jetzt …" or "Ich bin …", a card above the composer offers *Remember* or *No thanks*. Entries that look like passwords, keys or card numbers are refused. The notes go to the assistant as background and never override safety rules, tool permissions or the request. A group's team memory is separate (Settings → Groups).

## Cards under the chat

The empty chat shows "Heute für dich" as groups under the message box: **AI** (risks, budget, audit, agent status), **Sales** (offers waiting for the deal desk, overdue next steps), **Renewals** (decisions overdue or due within 14 days, lapsed contracts), **Infrastruktur** (certificates about to expire, red customers in the fleet) and **Board**. A group is picked with the chips; the count is the number of cards. The numbers are calculated when the chat opens from the sample data of the Spaces (`examples/control-tower`, `sales`, `renewals`, `infra-ops`, `it-fleet`) with today's date, so they match what the Spaces show. Buttons that only open a Space always work; buttons that ask the assistant need the control-tower connector and never send or change anything (drafts, plans, proposals only). In Settings → Work → *Cards under the chat* every group and every card can be switched off; this is part of the personal settings and of profiles. The rules are in `src/briefing.ts`, covered by `test/briefing.test.mjs`.

## Cover sheet typeface

The cover sheet (click the logo in the left rail) is set in the SAP “72” typeface (Light, Regular, Semibold, Bold, Black), taken from the Apache-2.0 package `@sap-theming/theming-base-content` and bundled in `src/assets/fonts/72/` with its license; see `NOTICE`. The rest of the app keeps its own fonts.

## Cover sheet animation

Behind the product name the cover sheet shows a big rectangle of small squares: mostly grey and softly shimmering with a wave travelling across, and now and then a cube lights up in a random colour and fades out again (sometimes two next to each other). Cubes near the mouse pointer brighten. It is a single canvas (`src/ui/CoverGrid.tsx`, helpers in `src/cover-grid.ts`), follows light and dark mode, stops when the sheet is closed and shows a still picture when the system asks for reduced motion.
## Integrations menu: Web Search and Model

The sparkle icon next to **+** in the composer opens a menu with two entries (the earlier placeholder entries Work Email, Charts and Work Calendar are gone; the connectors stay under the plug button):

- **Web Search** is a real switch **per conversation** (on by default, stored with the conversation). Every turn carries an instruction that tells the assistant whether it may use the web, and while the switch is off a web tool that the agent announces (for example `web_scrape` or a search MCP) stops the turn with a note. The stop is a safeguard, the instruction is what normally prevents the lookup.
- **Model** shows **OpenRouter** with the model that is actually running (`GOOSE_MODEL` in `.env`). SAP Generative AI Hub, Azure OpenAI, Anthropic and Google Gemini are listed in light grey as “not connected”; switching the provider is not part of the prototype yet.

The logic lives in `src/web-search.ts`.

**Approved web sources (connector 0.18.0).** The tools `list_web_sources`, `fetch_web_page` and `search_web_sources` read public pages of all `sap.com` sites (help, support, learning, news, community, developers, api, store, roadmaps and more), `cloud.sap`, `open.sap.com`, Handelsblatt, FAZ, CNN and finanzen.net (group Markets, with SAP Investor Relations sap.com/investors/de.html, for share prices such as SAP: finanzen.net/aktien/sap-aktie, edition.cnn.com/markets/stocks/SAP; quotes are delayed, always with exchange and time stamp, no investment advice). Read only, https only, only those hosts (every redirect is checked again), no login and no paywall bypass: SAP Notes and subscriber articles are reported as not readable. The two network tools count as web tools, so the Web Search switch stops them. Search page templates of the sites have not been checked live; the source list is in `connectors/control-tower/server/web-sources.mjs`.

## Personalisierung

Einstellungen → Tabs **Profile, Look, Work, Assistant, Storage, General**.

- **Look:** Akzentfarbe (wirkt auch in allen Spaces), App- und Space-Textgröße, Schrift, Dichte, hoher Kontrast, weniger Bewegung.
- **Profile:** fertige Profile (Standard, Vertrieb, Governance, Demo, Barrierearm) und eigene Profile speichern/löschen.
- **Work:** Start-Ansicht (Chat, letzter Space, fester Space), angeheftete Spaces (★ in der Space-Liste), Lieblings-Skills und eigene Starter-Prompts als Chips, Standard-Connectoren.
- **Domains (Bereiche):** Die Space-Liste ist nach Bereichen gruppiert. Ein Space nennt seinen Bereich in `space.json` (`"domain": "Sales"`, Standard „General“). Bereiche lassen sich frei anlegen, umbenennen und löschen (leer), Spaces per Drag-and-drop oder über die Auswahl „Domain“ am markierten Space verschieben. Die Zuordnung steckt in den Einstellungen (Export, Profile, Supabase-Sync).
- **Assistant:** Sprache, Länge, Ton und feste Anweisungen; werden jeder Anfrage als „PERSONAL PREFERENCES“-Block mitgegeben.
- **Storage:** benannte Ablageorte (Zweck → Pfad/URL), Export/Import als Datei und Abgleich mit Supabase (`werkbank.preferences`, Tools `get_preferences` / `save_preferences`; Geheimnisse werden abgelehnt). Migration: `supabase/migrations/20261022_016_werkbank_preferences.sql`.

Lokal liegt alles in `localStorage` (`werkbank.preferences.v1`). Das Modell lässt sich über Goose/ACP nicht umschalten; der Modell-Wunsch ist nur eine Erinnerung.

## Finance Pre-Close

`examples/finance-preclose/` is a Space for the daily pre-close of the month end. It runs on **mockup data**, not on an MCP server or a live S/4HANA Finance: `scripts/generate-preclose-data.mjs` creates a fictional group (four company codes, 12 P&L lines, the 22 working days of October 2026) in the shape of an S/4HANA Finance extract, seeded so it is the same every time (`npm run sync:finance-preclose` writes `preclose.json` and embeds it). A slider moves through the working days; every view follows the day: the **forecast** of revenue, gross profit and EBIT with an 80 % range that narrows during the month, a **forecast evolution** chart, a **bridge** from the budget to the forecast, the P&L with booked, forecast, budget, variance, last year and confidence, a company-code overview, the **close calendar** (32 tasks with owners, blocked and overdue states), **open items** with ageing and an intercompany matrix, **accrual proposals** that a person approves (posting is simulated and raises the booked amount of the cost line), **alerts and anomalies** and **what-if scenarios** (risks and opportunities with probabilities, best and worst case). Buttons ask the chat (`wb:ask`) to explain a variance, an anomaly or the open items, and for the daily briefing. **Start demo** walks through six steps (picture of the day, the EBIT gap, going back in time, blockers, accruals, scenarios). A later step could replace the generator with a connector to S/4HANA Finance; the page only needs the same JSON shape. Fictional data, nothing is posted. `npm run install:finance-preclose` installs the Space; `test/finance-preclose.test.mjs` checks the data, the sub-totals, the bridge, the calendar and the sync.

## Databricks connector (Genie and read-only SQL)

`connectors/databricks` is a small MCP bundle that talks to a Databricks workspace over the public REST APIs. It needs no OAuth, no extra software and no HTTP headers in Werkbank: the workspace address and a personal access token are entered once in the import dialog (the token is stored as a secret).

1. In the repository: `npm run build:databricks-mcpb` writes `dist/databricks.mcpb`.
2. In Werkbank: Connectors & Skills, import `databricks.mcpb`, enter the workspace address and the token (Databricks: user icon, Settings, Developer, Access tokens). Optional: SQL warehouse id and a default Genie space id.
3. In the chat: “Check the Databricks connection”, “Which Genie spaces do we have?”, “Ask Genie: ARR by customer”.

Tools: `databricks_check_connection`, `databricks_list_genie_spaces`, `databricks_ask_genie` (text, SQL and result table), `databricks_run_sql` (one read-only statement, writes are refused), `databricks_describe_table`. At most 200 rows per call, the token is only sent to the configured workspace and never appears in results. Use a token of a user or service principal with read rights only.

## Jira connector (search, read, create, comment, change status)

`connectors/jira` is an MCP bundle for Jira Cloud over the REST API v3. No admin is needed: the Jira address, your account e-mail and a personal API token are entered once in the import dialog (the token is stored as a secret and acts with your own rights).

1. `npm run build:jira-mcpb` writes `dist/jira.mcpb`.
2. In Werkbank: Connectors & Skills, import `jira.mcpb`. Token: id.atlassian.com, Security, Create and manage API tokens.
3. In the chat: “Check the Jira connection”, “Which tickets are open in project ABC?”, “Summarise ABC-123”.

Tools: `jira_check_connection`, `jira_list_projects`, `jira_search_issues` (JQL), `jira_get_issue`, and the three that change Jira: `jira_create_issue`, `jira_add_comment`, `jira_set_status`. Those three are described as changing Jira, so the approval card of the chat asks first. Not tested against a live Jira here; “Check the Jira connection” shows whether the login works.

## Slack connector (read channels, search, post)

`connectors/slack` is an MCP bundle for Slack through an own Slack app, so no workspace-wide integration is needed.

1. api.slack.com/apps, Create New App, From scratch. OAuth & Permissions, Bot Token Scopes: `channels:read`, `groups:read`, `channels:history`, `groups:history`, `chat:write`. Install to Workspace and copy the Bot User OAuth Token (`xoxb-…`). Optional for search: a User Token Scope `search:read` and its token (`xoxp-…`).
2. `npm run build:slack-mcpb` writes `dist/slack.mcpb`; import it in Connectors & Skills and enter the token(s).
3. Invite the app into each channel it should see (`/invite @app`). In the chat: “Check the Slack connection”, “What happened in #it-ops?”, “Post this summary to #it-ops”.

Tools: `slack_check_connection`, `slack_list_channels`, `slack_read_channel`, `slack_read_thread`, `slack_search_messages` (needs the user token) and `slack_post_message` (visible to the channel, so the approval card asks first). Not tested against a live workspace here.

## Rename and delete Spaces

Every Space and subspace card has three mini icons at the top right (visible on hover, focus or selection): the pencil renames it (kept in the settings, so it survives updates of the example Spaces and travels with the Supabase sync; the round arrow, shown after a rename, takes the original name back), the bin deletes it. Delete always asks first in a dialog (“Delete for good”, Cancel is the default) and removes the Space folder from this computer; its subspaces move to the top level, and pins, domain, own name and start view of that Space are cleaned up. Tip: Share → Save as file keeps a copy. `npm run install:examples` installs the example Spaces again, so a deleted example Space comes back with the next update.
### Kundenspezifisches AI-Briefing

Example Space `customer-ai-briefing` for the SAP account team: a briefing about **one end customer** (Muster Industrie AG or Hanse Handelsgruppe AG) who bought the Autonomous Enterprise Suite for **Finance (5 agents)** and **Supply Chain (8 agents)**. Every agent has a consumption model: what is counted (invoice matched, supplier check, route proposal …), AI units per event and events a month, so the AI units a month are visible per agent, per package and at full roll-out against the contracted volume. Next to the agents the page shows the SAP Business AI components: **BTP** (SAP AI Core and Document AI from the Sub4Me products), **SAP Business Data Cloud** (capacity units, written by hand) and **Joule Work**, which is only in contract negotiation (Sub4Me offer; expected use at SAP's list tier of 8 AI units per user and month). The page also has a roadmap, AI-unit use per product, the valid AI-credit contract type (pay as you go, agreed or fixed consumption, rollover, prepaid pool, top-up packs) and the decisions for the account team. Customer, contracts, AI units, offers, tickets and invoices are pulled from the Sub4Me data and the renewal dates from the Renewals data when you run `npm run sync:customer-briefing`; the suite packages, agents, consumption models and credit terms are written by hand (`examples/customer-ai-briefing/agents.json`). The last card lists where each block comes from. This replaces the former Board Briefing Space: delete the old one in the app with the bin icon.

