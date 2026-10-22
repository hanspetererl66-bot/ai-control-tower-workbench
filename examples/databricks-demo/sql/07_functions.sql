-- 07_functions.sql: Unity Catalog SQL functions. Through the Databricks managed MCP endpoint for functions each
-- one becomes a typed tool; the function COMMENT is the tool description and the parameter COMMENTs are the
-- argument descriptions. That text is what the agent reads, so it says when to use the tool, what it returns,
-- what it does not do and which argument means what.
-- SQL functions are read-only by construction: none of them can change data.
--
-- Parameter names are chosen so they never equal a column name (buyer, top_n, po, days_back, job_run_id, table_name).

-- ---------------------------------------------------------------- scm

CREATE OR REPLACE FUNCTION werkbank_demo.scm.get_delay_risk_pos(
  buyer STRING COMMENT 'Buyer id such as B-100. An id, not a name.',
  top_n INT DEFAULT 5 COMMENT 'How many purchase orders to return, from 1 to 20. Default 5.'
)
RETURNS TABLE (
  po_number STRING COMMENT 'Ten-digit purchase order number; the key to use in SAP.',
  item STRING COMMENT 'Item number.',
  vendor_id STRING COMMENT 'Vendor id.',
  vendor_name STRING COMMENT 'Vendor name.',
  material_description STRING COMMENT 'What is ordered.',
  quantity INT COMMENT 'Ordered quantity.',
  net_value_eur DOUBLE COMMENT 'Order value in EUR.',
  requested_delivery_date DATE COMMENT 'Date the business asked for.',
  confirmed_delivery_date DATE COMMENT 'Date the vendor confirmed.',
  delay_probability DOUBLE COMMENT 'Probability of a late delivery, 0 to 1. Above 0.6 is high risk.',
  expected_delay_days DOUBLE COMMENT 'Expected delay in days if it is late.',
  top_drivers STRING COMMENT 'The one or two main reasons for the score, separated by semicolons.'
)
COMMENT 'Returns the open purchase orders of ONE buyer that are most likely to be delivered late, highest risk first, each with its two main reasons. Use it when a buyer asks which orders are at risk, which will slip or what to expedite. It scores open orders with the delay-risk model and changes nothing. It does not draft or send any request; use the SAP tools for that, with the po_number it returns.'
RETURN
  SELECT
    po_number,
    item,
    vendor_id,
    vendor_name,
    material_description,
    quantity,
    CAST(net_value_eur AS DOUBLE) AS net_value_eur,
    requested_delivery_date,
    confirmed_delivery_date,
    delay_probability,
    expected_delay_days,
    top_drivers
  FROM (
    SELECT s.*, row_number() OVER (ORDER BY s.delay_probability DESC, s.po_number) AS risk_rank
    FROM werkbank_demo.scm.v_po_delay_scores s
    WHERE s.buyer_id = buyer
  ) ranked
  WHERE risk_rank <= least(greatest(coalesce(top_n, 5), 1), 20)
  ORDER BY risk_rank;

CREATE OR REPLACE FUNCTION werkbank_demo.scm.get_po_detail(
  po STRING COMMENT 'Ten-digit purchase order number such as 4500001007.'
)
RETURNS TABLE (
  po_number STRING COMMENT 'Purchase order number.',
  item STRING COMMENT 'Item number.',
  vendor_name STRING COMMENT 'Vendor name.',
  vendor_otif_90d DOUBLE COMMENT 'Vendor on-time-in-full rate over 90 days, 0 to 1.',
  material_description STRING COMMENT 'What is ordered.',
  quantity INT COMMENT 'Ordered quantity.',
  requested_delivery_date DATE COMMENT 'Date the business asked for.',
  confirmed_delivery_date DATE COMMENT 'Date the vendor confirmed.',
  days_confirmed_after_requested INT COMMENT 'Days the vendor confirmed later than requested.',
  inbound_lane STRING COMMENT 'Origin and destination country.',
  lane_congested INT COMMENT '1 when the lane has a customs or port backlog.',
  delay_probability DOUBLE COMMENT 'Probability of a late delivery, 0 to 1. Empty when the order is not scored.',
  top_drivers STRING COMMENT 'Main reasons for the score.'
)
COMMENT 'Returns one purchase order with the facts behind its delay-risk score: vendor performance, confirmed versus requested date, lane backlog and the main drivers. Use it to explain why one specific order is at risk after get_delay_risk_pos has found it. Reads only; for the live SAP record use the SAP tools.'
RETURN
  SELECT
    p.po_number,
    p.item,
    p.vendor_name,
    CAST(v.otif_90d AS DOUBLE) AS vendor_otif_90d,
    p.material_description,
    p.quantity,
    p.requested_delivery_date,
    p.confirmed_delivery_date,
    CAST(p.days_confirmed_after_requested AS INT) AS days_confirmed_after_requested,
    p.inbound_lane,
    p.lane_congested,
    s.delay_probability,
    s.top_drivers
  FROM werkbank_demo.scm.purchase_orders p
  JOIN werkbank_demo.scm.vendors v ON v.vendor_id = p.vendor_id
  LEFT JOIN werkbank_demo.scm.v_po_delay_scores s ON s.po_number = p.po_number AND s.item = p.item
  WHERE p.po_number = po;

-- A weak description for the "why the tool description is the prompt" moment of the demo. NOT installed by default:
-- run it in a scratch schema, point the agent at it, and compare how often the right tool is chosen.
--
-- CREATE OR REPLACE FUNCTION werkbank_demo.scm.get_data(x STRING)
-- RETURNS TABLE (a STRING, b DOUBLE)
-- COMMENT 'Gets data'
-- RETURN SELECT po_number, delay_probability FROM werkbank_demo.scm.v_po_delay_scores WHERE buyer_id = x;

-- ---------------------------------------------------------------- ops

CREATE OR REPLACE FUNCTION werkbank_demo.ops.get_failed_runs(
  days_back INT DEFAULT 3 COMMENT 'How many days back to look, default 3.'
)
RETURNS TABLE (
  job_run_id BIGINT COMMENT 'Run id; pass it to get_run_diagnosis.',
  job_name STRING COMMENT 'Job name.',
  start_time TIMESTAMP COMMENT 'When the run started.',
  result_state STRING COMMENT 'FAILED.',
  failed_task STRING COMMENT 'The task that failed itself, if the job has tasks recorded.',
  error_class STRING COMMENT 'Short class of the error.',
  error_summary STRING COMMENT 'First 300 characters of the error message.'
)
COMMENT 'Lists job runs that did not succeed in the last few days, newest first, with the task that failed and a short error. Use it first when someone asks what broke overnight or whether a pipeline is healthy. Reads only. For the full picture of one run call get_run_diagnosis with its job_run_id.'
RETURN
  SELECT
    r.run_id AS job_run_id,
    r.job_name,
    r.start_time,
    r.result_state,
    t.task_key AS failed_task,
    t.error_class,
    left(t.error_message, 300) AS error_summary
  FROM werkbank_demo.ops.job_runs r
  LEFT JOIN werkbank_demo.ops.job_task_runs t ON t.run_id = r.run_id AND t.state = 'FAILED'
  WHERE r.result_state <> 'SUCCESS'
    AND r.start_time >= date_sub(current_date(), coalesce(days_back, 3))
  ORDER BY r.start_time DESC;

CREATE OR REPLACE FUNCTION werkbank_demo.ops.get_run_diagnosis(
  job_run_id BIGINT COMMENT 'Run id from get_failed_runs.'
)
RETURNS TABLE (
  task_key STRING COMMENT 'Task name.',
  task_order INT COMMENT 'Position of the task in the job.',
  state STRING COMMENT 'SUCCESS, FAILED or UPSTREAM_FAILED (skipped because something before it failed).',
  error_class STRING COMMENT 'Short class of the error; empty unless the task failed itself.',
  error_message STRING COMMENT 'Full error message.',
  duration_minutes INT COMMENT 'How long the task ran.',
  times_seen_in_history INT COMMENT 'How often this error class occurred on this task in the recorded history, counting this run. 1 means it has never happened before.'
)
COMMENT 'Explains one job run task by task: which task failed, the full error, which tasks were skipped because of it and whether the same error has happened before. Use it after get_failed_runs to find the root cause and to tell a one-off glitch (seen before, retried fine) from a real change (first time). Reads only.'
RETURN
  SELECT
    t.task_key,
    t.task_order,
    t.state,
    t.error_class,
    t.error_message,
    t.duration_minutes,
    CAST(coalesce(h.occurrences, 0) AS INT) AS times_seen_in_history
  FROM werkbank_demo.ops.job_task_runs t
  LEFT JOIN (
    SELECT task_key, error_class, count(*) AS occurrences
    FROM werkbank_demo.ops.job_task_runs
    WHERE error_class IS NOT NULL
    GROUP BY task_key, error_class
  ) h ON h.task_key = t.task_key AND h.error_class = t.error_class
  WHERE t.run_id = job_run_id
  ORDER BY t.task_order;

CREATE OR REPLACE FUNCTION werkbank_demo.ops.get_downstream_impact(
  table_name STRING COMMENT 'Fully qualified table that is broken or stale, for example werkbank_demo.bronze.s4_ekpo.'
)
RETURNS TABLE (
  impacted_object STRING COMMENT 'Table, view, dashboard, job or function that is affected.',
  object_type STRING COMMENT 'table, dashboard, job or uc_function.',
  hops INT COMMENT 'Lineage steps from the broken table; 0 is the table itself.',
  owner_team STRING COMMENT 'Team to inform. Empty for plain tables.',
  criticality STRING COMMENT 'high, medium or low. Empty for plain tables.',
  refresh_sla_hours INT COMMENT 'How fresh the object must be, in hours. Empty for plain tables.'
)
COMMENT 'Lists everything downstream of one table through lineage: derived tables, then the dashboards, jobs and functions that depend on them, with owner team and criticality. Use it to answer what is affected when a table is broken or stale and who must be told. Reads only. Pass the table that failed, not the job name.'
RETURN
  SELECT c.impacted_table AS impacted_object, 'table' AS object_type, c.hops, CAST(NULL AS STRING) AS owner_team, CAST(NULL AS STRING) AS criticality, CAST(NULL AS INT) AS refresh_sla_hours
  FROM werkbank_demo.ops.lineage_closure c
  WHERE c.source_table = table_name
  UNION ALL
  SELECT a.asset_name, a.asset_type, c.hops + 1, a.owner_team, a.criticality, a.refresh_sla_hours
  FROM werkbank_demo.ops.downstream_assets a
  JOIN werkbank_demo.ops.lineage_closure c ON c.impacted_table = a.depends_on_table
  WHERE c.source_table = table_name
  ORDER BY hops, impacted_object;
