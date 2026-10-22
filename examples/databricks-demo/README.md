# Databricks MCP demo for SAP TechEd Berlin

Three scenarios, called from the Werkbank (the Goose client), against a Databricks workspace and a mock SAP system.
All data is synthetic and generated from code, so every number in the demo can be reproduced.

| # | Scenario | Databricks side | Write? |
|---|----------|-----------------|--------|
| 1 | **Governed analyst**: "Why did DACH gross margin miss plan in Q3?" | Genie space, SQL tool | none |
| 2 | **Pipeline on-call**: the nightly S/4 to Delta load failed, why, who is hit, what now | SQL tool, UC functions over job-run and lineage tables | one INSERT into `ops.rerun_requests`, after a yes |
| 3 | **Insight to action**: purchase orders likely to slip, then an expedite request or supplier inquiry in SAP | UC functions (risk score) | `submit_draft` in the mock SAP, after a yes |

The story links 2 and 3: the custom SAP field `ZZ_EXPEDITE_FLAG` breaks the nightly ingest (schema drift) and is the same
flag an expedite request sets.

## What is in here

| Path | What |
|------|------|
| `recipes/*.yaml` | The three Goose recipes (`goose run --recipe ...`) |
| `skills/*/SKILL.md` | The same flows as Werkbank skills (generated from the recipes; the app has no recipe support) |
| `goose/extensions.yaml` | The two extensions to add to Goose |
| `sql/` | Setup, tables, seed data, views, UC functions, governance, grants, teardown. `all-in-one.sql` is 00 to 07 |
| `genie/space-setup.md` | The Genie space (one UI step) |
| `seed/data.mjs` | The data generator. SQL files 02, 03, 04, 06 and the skills are generated: `npm run sync:databricks-demo` |
| `../../connectors/databricks-bridge` | stdio to Streamable HTTP bridge to the Databricks managed MCP endpoints |
| `../../connectors/sap-mock` | The mock SAP MCP server |

## Run order

1. **Load the data.** Either paste `sql/all-in-one.sql` into a Databricks SQL editor and Run all, or:
   ```sh
   export DATABRICKS_HOST=https://<workspace-hostname>
   export DATABRICKS_TOKEN=<token>          # or DATABRICKS_CLIENT_ID and DATABRICKS_CLIENT_SECRET
   export DATABRICKS_WAREHOUSE_ID=<sql warehouse id>
   npm run databricks-demo:load -- --dry-run   # counts statements, sends nothing
   npm run databricks-demo:load
   ```
   Dates are day offsets from today and exposed through views, so the data is always "this week". The load is repeatable
   (`INSERT OVERWRITE`). The 02:00 UTC run of the failing job appears once it is past 02:00 UTC on the day.
2. **Using another catalog.** The scripts create `werkbank_demo`. If you may not create catalogs, pass `--catalog <name>` to the
   loader; it renames the catalog everywhere in the SQL it sends. If you paste the SQL by hand, replace `werkbank_demo` in
   all files, and in `DATABRICKS_MCP_PATHS` and the recipes.
3. **Groups and grants.** Create the account groups `wbdemo_readers` and `wbdemo_approvers`, then run `09_grants.sql`.
   `08_governance.sql` adds the row filter for the regional groups; it is separate on purpose (read its header first).
4. **Genie space.** Follow `genie/space-setup.md`.
5. **Install into the Werkbank.**
   ```sh
   npm run install:databricks-demo -- --host https://<workspace-hostname>
   ```
   This copies the skills and adds both extensions to `goose-home/.config/goose/config.yaml` with absolute paths. It
   never writes secrets. Restart the app, open Connectors & Skills, choose Configure on `databricks`, and enter the client id and
   secret (or token). Werkbank keeps them in the OS-encrypted store. Do not commit the config file after this step.
   Alternatively build bundles with `npm run build:databricks-bridge-mcpb` and `npm run build:sap-mock-mcpb` and import them.
6. **Add the Genie endpoint** to `DATABRICKS_MCP_PATHS` as `genie=<path>` (see the Genie guide).

## Goose mode

Use `smart_approve` or `approve` for the demo. The recipes ask for approval themselves; the mode adds a second, visible gate
on every tool that is not marked read-only. The mock SAP marks its read tools read-only and `submit_draft` as the one write.

## The demo, about 15 minutes

1. **Scenario 1 (4 min).** Ask the question. Open the generated SQL. Point at the ratio-of-sums rule from the space
   instructions, then the driver breakdown: Industrial Sensors discounts, Edge Gateways cost and FX. Switch the connector to the
   second service principal and ask again: no rows. Unity Catalog decided, not the agent.
2. **Scenario 2 (5 min).** "Why did last night's load fail?" Root cause is the new `ZZ_EXPEDITE_FLAG` column on the S/4
   purchase-order items. The assistant lists downstream assets from the lineage table and proposes a fix. Say yes to the rerun
   request and show the row in `ops.rerun_requests`. The assistant never changes the job itself.
3. **Scenario 3 (5 min).** Ask for buyer B-100's risky orders. The assistant drafts an expedite request, shows it, and waits.
   Say yes: the draft is submitted with its confirmation token, the flag is set, and the audit log shows who asked for what.
   Close the loop on the story: that flag is what breaks tomorrow night's ingest.
4. **The tool-description moment (1 min).** Show a UC function with a good `COMMENT` next to one with an empty comment.
   The comment is the tool description the agent sees; it is part of the interface.

## Swapping the risk view for a model

`06_model_view.sql` computes the delay probability with a logistic formula over vendor reliability, confirmation gap, plant
load and lane congestion. It uses the same constants as the mock SAP, so both systems agree. To show Model Serving, replace
the view body with `ai_query('<endpoint>', ...)`; the function and recipes do not change.

## Limits and what is not verified

- Nothing here has been run against a real workspace. The SQL was checked in local Spark and cross-checked against the
  Node generator; Unity Catalog function DDL, row filters and grants were not executed.
- The managed MCP endpoint paths for SQL and functions follow the Databricks documentation as known; the Genie endpoint path
  and tool names, and whether a personal access token is accepted as a bearer token there, need confirming in your workspace.
- There is no Jobs or lineage MCP server, so job runs and lineage are demo tables.
- The connection uses one identity (OAuth machine to machine or a token). There is no per-user passthrough, which is why the
  row-level security moment uses two service principals.
- `99_teardown.sql` drops the catalog.
