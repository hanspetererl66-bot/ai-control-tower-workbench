# Joule Work X - Next Gen
# Werkbank - Extended by some more capabilities to showcase possible business scenarios

Joule Work X - Next Gen (a private prototype, based on the open-source [Werkbank](https://github.com/marianfoo/werkbank) by marianfoo) is a local desktop workbench for AI-assisted conversations, file context,
persistent Spaces, MCP connectors, and reusable agent skills. The renderer talks to
a project-local [Goose](https://block.github.io/goose/) process through the Agent
Client Protocol; connector configuration and generated work stay in the local project
workspace.

> **Not affiliated with SAP.** "Joule" is the name of an SAP product. This is an independent prototype in a similar style; it is not
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
  "Joule Work X - Next Gen · Prototype · Built by Accenture · Demo only". Click anywhere outside the
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
  domain: Finanzen            # Governance & Risiko | Service & Support | Finanzen | HR | Entwicklung | Betrieb | Sonstiges
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

### Sub4Me: contract and offer details

`examples/sub4me/portfolio.json` is the single source for the contracts and offers of the Sub4Me test customer, each with about 25 fictional attributes (contract type, billing and payment terms, SLA, data centre, contacts, licensed vs. used units, invoicing, auto-renewal, termination; for offers list price, discount, stage, win probability, approval, competitor, next step, conditions) and line items.
`npm run sync:sub4me` embeds it into the Space (click a row in **Contracts** for the detail view) and writes `supabase/migrations/20261019_011_sub4me_contracts_offers.sql`. Run that file once in the Supabase SQL editor; it is re-runnable. The chat connector then reads contracts and offers live from Supabase (`public.sub4me_portfolio()`, secret key only) and falls back to the embedded copy.

## Knowledge Graph example Space

One interactive graph over the other examples: the Sub4Me customer with contracts, offers, products and tickets, the Skill Marketplace (skills and the tools they use), the Control Tower (risks, agent families) and n8n (workflows, apps). Nothing is stored separately: `npm run sync:knowledge-graph` derives the graph from those sources plus `examples/knowledge-graph/links.json` (curated links and the guided tour) and embeds it into the Space (`-- --check` fails when it is stale). Everything is fictional sample data.

Install it with `npm run install:knowledge-graph` (or `npm run install:examples knowledge-graph`).

In the Space: search with fly-to, **Explore** (neighbours of a node), **Impact** (what hangs on a node, depth 1–4, animated by distance), **Path** (shortest connection between two nodes), two guided tours (Ariba renewal, AI governance), type filters, pinning (double-click), minimap and keyboard controls (`+`/`-`, arrows, `0`, `Esc`). Hub nodes (systems, connector) are not followed in Impact and Path, so results stay about business relations.

The same graph is available in chat through five connector tools (connector 0.12.0): `get_graph_overview`, `search_graph`, `get_graph_neighbors`, `find_graph_path` and `analyze_graph_impact`, for example “Was ist betroffen, wenn der Ariba-Vertrag nicht verlängert wird?” or “Wie hängt Risiko R2 mit dem Kunden zusammen?”. After updating, re-import the connector in the app so the new tools appear.

## Mockup Spaces: call transcripts and customer e-mails

Two design mockups for additional sources, with fictional data only and no real connection (no mailbox, no call platform, nothing recorded, read, stored or sent):

- **Call Transcripts** (`examples/call-transcripts`): calls with summary, decisions, risks, action items (owner, due date, overdue), a mood timeline and a searchable transcript. Every decision, risk and action jumps to the passage it came from; a second tab collects all action items across calls.
- **Customer E-Mails** (`examples/customer-emails`): conversations with summary, open points, response times against a 48-hour target, a draft reply (mock, never sent), weekly volume, and a page on rules and privacy. One message contains instructions aimed at AI assistants; it is flagged and shown as plain text. Open points are matched with the calls (for example a mail that confirms an action still open after a call).

Install with `npm run install:call-transcripts` and `npm run install:customer-emails`. The sample data lives in `calls.json` and `threads.json` next to each page; `npm run sync:mockups` embeds it (`-- --check` fails when stale).
## Tables in chat answers

Chat answers are rendered as GitHub-flavoured Markdown (`remark-gfm`), so Markdown tables become real tables, styled in `src/theme.css` (`.md-table`): header row, soft row separators, hover, light and dark. Numeric columns (numbers, amounts, percentages) are right-aligned automatically, ids and single words stay on one line, and wide tables scroll inside the message. The helpers live in `src/markdown-table.ts`, the component in `src/ui/ChatMarkdown.tsx`.
### Skill ratings (stars)

Skills can be rated with 1 to 5 stars and an optional comment (max 280 characters), anonymously and once per person and skill; rating again replaces the earlier rating. The Skill Marketplace shows the stars in the catalog and the impact table, can sort by best rated or most ratings, and has a *Ratings* card in the skill detail (average, distribution, latest comments). Skills with fewer than 5 ratings show as "new"; the ranking uses a damped average so two five-star votes do not beat forty votes at 4.6.

- **Sample data:** `examples/skill-marketplace/ratings.json` (fictional), embedded by `npm run sync:skill-marketplace`.
- **Supabase:** `npm run sync:skill-ratings` writes `supabase/migrations/20261019_013_skill_ratings.sql`. Run it once in the Supabase SQL editor after 012 (safe to run again; it only refreshes the sample rows). It creates `skills.skill_rating` (RLS on, no access for anon/authenticated) and two functions that only the server-side secret key may call: `skills_ratings()` and `skills_rate()`. Only skills in the registry (`skills.skill`, not retired) can be rated.
- **Chat (connector 0.14.0):** `get_skill_ratings` (ranking, or one skill with distribution and comments) and `rate_skill`; the skill `rate-skill` asks for the stars and confirms before saving. `recommend_skills` and `recommend_skill_workflow` show the rating too. The rater is a hash of the local user and host (override with the env var `SKILL_RATER_ID`); no names are stored. Without a Supabase connection nothing is saved.
