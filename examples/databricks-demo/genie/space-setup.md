# Genie space for scenario 1

A Genie space cannot be created from SQL, so this one step is done in the Databricks UI. It takes about five minutes.
Everything below is meant to be pasted.

## 1. Create the space

1. In the workspace, open **Genie** and choose **New**.
2. Name: `Margin analyst (demo)`. Pick a serverless SQL warehouse.
3. Add exactly two tables:
   - `werkbank_demo.fin.v_margin_vs_plan`
   - `werkbank_demo.fin.large_discount_deals`

Keep the space this small. Genie answers better, and faster, over two well-described objects than over a whole schema.

## 2. Instructions (paste into the space's general instructions)

```text
You answer questions about gross margin against plan for a manufacturing company. All data is synthetic.

Money is in EUR. Quarters are labelled like "Q3 2026" in the column quarter.

Gross margin percentage is always a ratio of sums, never an average of row percentages:
  SUM(gross_margin_eur) / SUM(net_revenue_eur) * 100
The same for plan: SUM(plan_gross_margin_eur) / SUM(plan_net_revenue_eur) * 100.
The difference between the two is the margin delta in percentage points. Negative means below plan.

To explain a margin miss, compare rates, each as a ratio of sums against revenue:
  discount rate  = SUM(discount_eur) / SUM(revenue_eur)  versus  SUM(discount_plan_eur) / SUM(revenue_plan_eur)
  cost rate      = SUM(cogs_eur) / SUM(revenue_eur)      versus  SUM(cogs_plan_eur) / SUM(revenue_plan_eur)
  FX cost rate   = SUM(fx_cost_eur) / SUM(revenue_eur)   versus  SUM(fx_cost_plan_eur) / SUM(revenue_plan_eur)
Break the result down by product_line to show where it sits.

large_discount_deals lists deals above or near the discount policy limit. Use it to show where discounts above policy come from
(approval = 'Regional exception'). It is a sample, not a reconciliation of the margin table. Customers are pseudonymous ids.

If a question has no data behind it, say so. Do not invent numbers.
```

## 3. Sample questions (add as example questions)

- Why did DACH gross margin miss plan in Q3 2026?
- Which product lines drive the DACH margin gap in Q3 2026?
- Show gross margin against plan by region and quarter.
- Which deals above the discount policy sit behind the DACH Industrial Sensors discounts?

## 4. A verified query (add as an example SQL for "margin against plan by region and quarter")

```sql
SELECT
  region_code,
  quarter,
  ROUND(SUM(gross_margin_eur) / SUM(net_revenue_eur) * 100, 2)            AS gross_margin_pct,
  ROUND(SUM(plan_gross_margin_eur) / SUM(plan_net_revenue_eur) * 100, 2)  AS plan_gross_margin_pct,
  ROUND(SUM(gross_margin_eur) / SUM(net_revenue_eur) * 100
      - SUM(plan_gross_margin_eur) / SUM(plan_net_revenue_eur) * 100, 2)  AS margin_delta_pp
FROM werkbank_demo.fin.v_margin_vs_plan
GROUP BY region_code, quarter
ORDER BY region_code, quarter;
```

With the seed data this returns, for DACH, about 53.3 % against a 56.3 % plan in Q3 2026 (minus 3.07 points), and every other
region and quarter within about a third of a point of plan.

## 5. Give the connection's identity access

The service principal (or user) behind the Werkbank connector needs:

- **CAN RUN** on the Genie space
- **CAN USE** on the SQL warehouse
- `USE CATALOG`, `USE SCHEMA` and `SELECT` on the two objects (09_grants.sql does this for the groups wbdemo_readers and wbdemo_approvers)

## 6. Point the connector at it

The managed MCP endpoint for a Genie space is added to `DATABRICKS_MCP_PATHS` as `genie=<path>`. Take the path from your workspace
(the space's connect or MCP option, or the Databricks MCP documentation). The path shape and the tool names of the Genie
endpoint are not fixed in this repository because they have changed between releases and could not be confirmed from here.
The bridge lists whatever tools the endpoint exposes, and the recipe finds the Genie tool by a name that contains "genie" or "query_space".

If you have no Genie endpoint at hand, the recipe falls back to the Databricks SQL tool over the same two objects and says so.
The demo still works; you lose only the natural-language layer.

## 7. The two-identity moment (row-level security)

1. Create the groups and run `08_governance.sql` (it explains the order; do not skip adding yourself to `wbdemo_all_regions` first).
2. Configure the connector with a service principal in `wbdemo_dach`, ask the question, and get the full answer.
3. Reconfigure it with a principal in `wbdemo_uki` (Connectors & Skills, Configure, restart the agent) and ask again.
   The answer is "no rows came back for DACH". Nothing in the agent or the recipe changed; Unity Catalog decided.

This is two service principals, not per-user passthrough. The Werkbank connector authenticates as the identity you configure.
