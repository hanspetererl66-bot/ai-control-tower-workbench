# Solution register and SAP LeanIX

The Solution register (Admin console → Solution register) keeps a **register card** for every agent, workflow, feature and code item, modelled on what an enterprise architecture inventory keeps. This page says what the card contains, where each field comes from, and, because it matters, **what was confirmed in LeanIX material and what was not**.

Status: 7 November 2026. The research was done from public pages; the LeanIX product itself was not available.

## What was confirmed about LeanIX

From public SAP and LeanIX pages (the SAP TechEd 2025 recap, the LeanIX product page for the SAP AI Agent Hub, the LeanIX release announcements and a partner article on the AI Agent Hub):

- AI agents are modelled as a **subtype of the Application fact sheet**, with an agent type and conditional fields that appear by type.
- **Business value** is calculated by a built-in method that an organisation can adapt.
- **Discovery** from SAP (Joule agents), Microsoft (Azure AI Foundry, Copilot), Google (Agent Engine), AWS, Databricks and ServiceNow, through an AI Agent API that takes agent metadata and agent cards; Excel import also exists.
- **Relations** to business capabilities, applications, technologies, organisations, the model (LLM) an agent uses, MCP servers (discovery of MCP servers is listed as planned or early), business processes (through SAP Signavio) and similar agents.
- **Ownership**: the hub flags agents for which no owner can be identified.
- **Governance**: architecture decisions and governance criteria documented before go-live; a *verification status* / verification records; quality seals, tags, to-dos, comments.
- **Lifecycle** of agents in four stages (plan and build, discover and provision, observe and analyse, optimise and decommission), with flags for underused, underperforming or redundant agents.
- **Telemetry**, usage and performance data (sourced from SAP Cloud ALM).

## What could not be confirmed

- **Exact field names and allowed values** for AI agents. The pages that hold them (SAP Help Portal: AI Agent Modeling Guidelines, AI Agent Extension to the meta model) could not be read here, because the site disallows automated access. We did not work around that.
- Whether LeanIX records a **risk class or compliance field** (EU AI Act and similar) for an agent. The pages speak of governance and controls, not of such a field.
- Whether it records **cost per agent** or **data access** as attributes. Not named.

So the card below is "in the spirit of LeanIX", not a copy of its schema. Before the register is compared with a real LeanIX workspace, check the field names against the SAP Help Portal pages above.

## The fields

| Group | Field | Origin |
|---|---|---|
| Ownership | Responsible (the item's owner) | LeanIX concept (owner; subscriptions with roles) |
| | Accountable (steward) | LeanIX concept (accountable role) |
| | Organization | LeanIX relation (organisation) |
| | Runs on | LeanIX relation (provider / platform) |
| | Origin: built, imported, discovered | LeanIX concept (discovery) |
| Lifecycle | Phase: plan, phase in, active, phase out, end of life, with dates | LeanIX lifecycle phases of a fact sheet (from general LeanIX knowledge, not re-verified here) |
| Governance | Business criticality (four levels) | LeanIX attribute (from general LeanIX knowledge, not re-verified here) |
| | Verification: verified, not verified, review overdue, changed since verified; by, date, next review | LeanIX concept (verification status, quality seal) |
| | **Risk class (EU AI Act)** and reason | **Our addition** |
| | What it may do (mode, writes, unattended) | From the policy manifest (`policy.json`), no new input |
| Connections | Capabilities, processes, systems (read/write), data, models, connectors and MCP servers, related items | LeanIX relations; "data" and "connectors" are ours |
| Last 30 days | Runs, success rate, people, cost, value (estimate), last run | LeanIX telemetry idea; cost is **our addition** |

## The hints ("Look at")

Computed, never enforced. They only ask for a look.

| Hint | When |
|---|---|
| No owner | Agent or workflow without a responsible person |
| Review overdue | The next-review date has passed |
| Not verified | In use (active or phase out) and not verified |
| Risk not assessed | In use and no risk class |
| High risk, acts on its own | High risk and the policy says autonomous or can run without a person |
| Little use | Active, fewer than 5 runs and fewer than 3 people in 30 days |
| Overlaps with another | Same type, both in use, and they share at least two capabilities, processes, systems or data objects and at least half of all of them (LeanIX flags redundant agents) |

Features and code items are not judged. Archived items are not judged.

## Where the data lives

The card is the file `register.json` of the work item (like `policy.json`), and `intent.register` repeats it so the list can show it without reading files. **It is written from the registry**: open an item, "Fill in the card" or "Edit the card", "Save as a new revision". The change is a revision of its own (note, for example, "Register card: lifecycle, risk"), so it shows in the history, in the diff and can be restored. Nothing else of the item changes.

How the card survives the other writers:

- **Project sync.** It rewrites `project.json`, the documents and `policy.json` from the project, but it cannot know the card. On every push it reads `register.json` from the newest revision and sends it along; if that file exists but cannot be read, the push is refused with an error instead of overwriting it. A revision that only changed the card is not a conflict: the local project is kept and its own changes are sent on top.
- **Feature panel** (stage, links) and **Restore**: both carry the card of the revision they are based on. Restoring an old revision brings back the card as it was then; a revision without a card restores to no card.

An item without a card shows what can be derived (owner, build step, rights from the policy summary) and "not declared" for the rest; it never invents a value. In particular an agent is never shown as *Active* unless somebody declares it.

What the editor does not do: the **run numbers of the last 30 days** are not typed in (they should come from the scheduler log, see "Next"); **who** verifies is only a text the person types, because the app has no sign-in yet (the same limit as the e-mail identity of the work items), so "Verified by" is not proof; there is **no role check** (anybody who can save the item can change the card); and there is no reminder yet when a review date passes.

Checks before saving (`cardProblems`): verified needs who and when, the next review must be after the verification day, a high risk class needs a reason, phase dates must not run backwards, a connection must not be listed twice.

Without the database (a plain browser) the register shows 19 invented example items (`src/registry-examples.ts`), marked "Example"; they cannot be edited. With the database but nothing saved, a button offers the examples.

## Next (not built)

1. A role check for who may change a card, and real identity for "Verified by" (needs the sign-in decision).
2. Check the field names against the SAP Help Portal pages and, if useful, an export in LeanIX shape (Excel import exists there).
3. Real telemetry: run counts and cost per item from the scheduler log and the model usage, instead of values typed in.
4. Review reminders (the next-review date already exists; sending reminders would use the n8n notices pattern of the hiring approvals).

## Sources

- SAP Community, "Recap SAP TechEd 2025: Discover, manage and control all your AI agents"
- leanix.net, "SAP AI Agent Hub with SAP LeanIX Application Portfolio Management"
- SAP LeanIX release announcements (August 2026 update)
- Inclusion Cloud, "SAP LeanIX Takes on the Growing AI Sprawl Problem"
- Not readable here (site disallows automated access): SAP Help Portal, "AI Agent Modeling Guidelines", "AI Agent Extension (Legacy)", "SAP AI Agent Hub"
