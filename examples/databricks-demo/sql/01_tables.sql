-- 01_tables.sql: tables. Column comments are written for people and for agents: Genie and MCP tools read them.
-- The column order here is the order of the generated INSERT statements; a test keeps both in step.

-- ---------------------------------------------------------------- fin

CREATE OR REPLACE TABLE werkbank_demo.fin.margin_monthly (
  month DATE COMMENT 'First day of the month.',
  region_code STRING COMMENT 'Sales region: DACH, UKI, FR or NORDICS.',
  product_line STRING COMMENT 'Product line: Edge Gateways, Industrial Sensors, Control Software, Service Contracts or Spare Parts.',
  revenue_eur DECIMAL(14,2) COMMENT 'Actual gross revenue in EUR, before discounts.',
  revenue_plan_eur DECIMAL(14,2) COMMENT 'Planned gross revenue in EUR.',
  discount_eur DECIMAL(14,2) COMMENT 'Actual discounts granted in EUR.',
  discount_plan_eur DECIMAL(14,2) COMMENT 'Planned discounts in EUR.',
  cogs_eur DECIMAL(14,2) COMMENT 'Actual cost of goods sold in EUR.',
  cogs_plan_eur DECIMAL(14,2) COMMENT 'Planned cost of goods sold in EUR.',
  fx_cost_eur DECIMAL(14,2) COMMENT 'Actual foreign-exchange cost in EUR.',
  fx_cost_plan_eur DECIMAL(14,2) COMMENT 'Planned foreign-exchange cost in EUR.'
)
COMMENT 'Monthly revenue, discounts, cost of goods and FX cost by region and product line, actual and plan. Synthetic. Gross margin = revenue - discount - cogs - fx cost.';

CREATE OR REPLACE TABLE werkbank_demo.fin.large_discount_deals (
  deal_id STRING COMMENT 'Deal number.',
  month DATE COMMENT 'First day of the month the deal closed.',
  region_code STRING COMMENT 'Sales region: DACH, UKI, FR or NORDICS.',
  product_line STRING COMMENT 'Product line of the deal.',
  segment STRING COMMENT 'Customer segment: Mid-Market or Enterprise.',
  customer_id STRING COMMENT 'Pseudonymous customer id.',
  list_value_eur DECIMAL(14,2) COMMENT 'Deal value at list price in EUR.',
  discount_pct DECIMAL(5,2) COMMENT 'Discount given, as a percentage of list value.',
  policy_limit_pct DECIMAL(5,2) COMMENT 'Discount the standard approval policy allows without an exception.',
  approval STRING COMMENT 'Standard, or Regional exception when the discount is above the policy limit.',
  approved_by_role STRING COMMENT 'Role that approved the discount.'
)
COMMENT 'Sample of larger deals with their discount and approval route. Shows where discounts above policy come from. A sample, not a reconciliation of the margin table.';

-- ---------------------------------------------------------------- scm

CREATE OR REPLACE TABLE werkbank_demo.scm.vendors (
  vendor_id STRING COMMENT 'Vendor id such as V-1001.',
  vendor_name STRING COMMENT 'Vendor name (fictional).',
  country STRING COMMENT 'Vendor country code.',
  otif_90d DECIMAL(4,2) COMMENT 'On-time-in-full rate over the last 90 days, 0 to 1.',
  monthly_capacity_units INT COMMENT 'Units the vendor can deliver per month.',
  standard_lead_time_days INT COMMENT 'Standard lead time in days.'
)
COMMENT 'Vendors with their recent delivery performance. Synthetic.';

CREATE OR REPLACE TABLE werkbank_demo.scm.purchase_orders_seed (
  po_number STRING COMMENT 'Ten-digit purchase order number.',
  item STRING COMMENT 'Item number within the purchase order.',
  material STRING COMMENT 'Material id.',
  material_description STRING COMMENT 'Material description.',
  vendor_id STRING COMMENT 'Vendor id.',
  plant STRING COMMENT 'Plant id.',
  plant_name STRING COMMENT 'Plant name.',
  buyer_id STRING COMMENT 'Buyer id such as B-100.',
  buyer_name STRING COMMENT 'Buyer name.',
  quantity INT COMMENT 'Ordered quantity.',
  unit_price_eur DECIMAL(12,2) COMMENT 'Unit price in EUR.',
  order_offset_days INT COMMENT 'Order date as days from today (negative = in the past).',
  requested_offset_days INT COMMENT 'Requested delivery date as days from today.',
  confirmed_offset_days INT COMMENT 'Vendor-confirmed delivery date as days from today.',
  inbound_lane STRING COMMENT 'Origin and destination country of the inbound lane.',
  lane_congested INT COMMENT '1 when the lane has a customs or port backlog.',
  status STRING COMMENT 'OPEN or PARTIALLY_DELIVERED.'
)
COMMENT 'Seed rows for scm.purchase_orders. Dates are offsets so the demo never goes stale; use the view scm.purchase_orders.';

-- ---------------------------------------------------------------- ops

CREATE OR REPLACE TABLE werkbank_demo.ops.jobs (
  job_id BIGINT COMMENT 'Job id.',
  job_name STRING COMMENT 'Job name.',
  owner_team STRING COMMENT 'Team that owns the job.',
  schedule_cron STRING COMMENT 'Quartz cron schedule.'
)
COMMENT 'The three jobs of the demo platform. Synthetic.';

CREATE OR REPLACE TABLE werkbank_demo.ops.job_runs_seed (
  run_id BIGINT COMMENT 'Run id.',
  job_id BIGINT COMMENT 'Job id.',
  start_day_offset INT COMMENT 'Start day as days from today (0 = today).',
  start_hour INT COMMENT 'Start hour, 0 to 23.',
  start_minute INT COMMENT 'Start minute.',
  duration_minutes INT COMMENT 'Run duration in minutes.',
  result_state STRING COMMENT 'SUCCESS or FAILED.'
)
COMMENT 'Seed rows for ops.job_runs. Use the view ops.job_runs.';

CREATE OR REPLACE TABLE werkbank_demo.ops.job_task_runs (
  run_id BIGINT COMMENT 'Run id.',
  task_key STRING COMMENT 'Task name inside the job.',
  task_order INT COMMENT 'Position of the task in the job.',
  state STRING COMMENT 'SUCCESS, FAILED or UPSTREAM_FAILED.',
  error_class STRING COMMENT 'Short class of the error: SCHEMA_MISMATCH or TRANSIENT_NETWORK. Empty when the task did not fail itself.',
  error_message STRING COMMENT 'Full error message of a failed task.',
  duration_minutes INT COMMENT 'Task duration in minutes.'
)
COMMENT 'Task-level results of the s4_to_delta_nightly job. Synthetic.';

CREATE OR REPLACE TABLE werkbank_demo.ops.lineage_edges (
  source_table STRING COMMENT 'Table that is read.',
  target_table STRING COMMENT 'Table or view that is written or derived from it.',
  job_name STRING COMMENT 'Job that moves the data.',
  task_key STRING COMMENT 'Task that moves the data.'
)
COMMENT 'Direct lineage between tables. Shaped like system.access.table_lineage; a real workspace would read the system table instead. Metadata only: the bronze and silver tables are not created here.';

CREATE OR REPLACE TABLE werkbank_demo.ops.lineage_closure (
  source_table STRING COMMENT 'Starting table.',
  impacted_table STRING COMMENT 'Table that is reachable downstream, including the starting table itself.',
  hops INT COMMENT 'Number of lineage steps from the starting table; 0 is the table itself.'
)
COMMENT 'Everything reachable downstream from each table, precomputed from ops.lineage_edges.';

CREATE OR REPLACE TABLE werkbank_demo.ops.downstream_assets (
  asset_name STRING COMMENT 'Dashboard, job or function that depends on a table.',
  asset_type STRING COMMENT 'dashboard, job or uc_function.',
  depends_on_table STRING COMMENT 'Table the asset reads.',
  owner_team STRING COMMENT 'Team that owns the asset.',
  criticality STRING COMMENT 'high, medium or low.',
  refresh_sla_hours INT COMMENT 'How fresh the asset must be, in hours.',
  note STRING COMMENT 'Why the asset matters.'
)
COMMENT 'Consumers of the gold and scoring tables, with owner and criticality.';

CREATE OR REPLACE TABLE werkbank_demo.ops.rerun_requests (
  request_id STRING COMMENT 'Unique id of the request.',
  job_run_id BIGINT COMMENT 'The failed run the request is about.',
  requested_by STRING COMMENT 'Who approved the request in the conversation.',
  reason STRING COMMENT 'Why a rerun is requested and what was fixed.',
  proposed_fix STRING COMMENT 'The fix that was proposed to the person. Applied by the owning team, not by the agent.',
  status STRING COMMENT 'REQUESTED. A human or a scheduler picks it up from here.',
  created_at TIMESTAMP COMMENT 'When the request was written.'
)
COMMENT 'The only table the on-call agent may write to, and only after explicit approval in the conversation. Starts empty.';

-- ---------------------------------------------------------------- fin: pre-close

CREATE OR REPLACE TABLE werkbank_demo.fin.grir_items (
  po_number STRING COMMENT 'Ten-digit purchase order number.',
  item STRING COMMENT 'Item number within the purchase order.',
  vendor_id STRING COMMENT 'Vendor id.',
  vendor_name STRING COMMENT 'Vendor name (fictional).',
  company_code STRING COMMENT 'Company code that owns the liability: DE01, PL01 or FR01.',
  gr_offset_days INT COMMENT 'Goods receipt date as days from today (negative = in the past).',
  gr_value_eur DECIMAL(14,2) COMMENT 'Value of the goods received in EUR.',
  invoiced_value_eur DECIMAL(14,2) COMMENT 'Value invoiced by the vendor so far in EUR.',
  description STRING COMMENT 'What was received.'
)
COMMENT 'Goods received and not fully invoiced (GR/IR), the same rows SAP holds. Synthetic.';

CREATE OR REPLACE TABLE werkbank_demo.fin.intercompany_items (
  item_id STRING COMMENT 'Intercompany document id.',
  seller_company STRING COMMENT 'Company code that billed: DE01, PL01 or FR01.',
  buyer_company STRING COMMENT 'Company code that was billed.',
  description STRING COMMENT 'What was charged.',
  posting_offset_days INT COMMENT 'Posting date on the seller side as days from today (negative = in the past).',
  seller_amount_eur DECIMAL(14,2) COMMENT 'Receivable booked by the seller in EUR.',
  buyer_amount_eur DECIMAL(14,2) COMMENT 'Payable booked by the buyer in EUR. NULL when the buyer has not posted it.'
)
COMMENT 'Intercompany receivables and payables of the period, both sides. Should net to zero. Synthetic.';
