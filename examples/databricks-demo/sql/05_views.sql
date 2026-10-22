-- 05_views.sql: views the demo reads. Seed tables hold day offsets; these views turn them into dates relative to today,
-- so "last night" and "due next week" are true on whatever day you present.

CREATE OR REPLACE VIEW werkbank_demo.fin.v_margin_vs_plan (
  month COMMENT 'First day of the month.',
  quarter COMMENT 'Calendar quarter label such as Q3 2026.',
  region_code COMMENT 'Sales region: DACH, UKI, FR or NORDICS.',
  product_line COMMENT 'Product line.',
  revenue_eur COMMENT 'Actual gross revenue in EUR.',
  revenue_plan_eur COMMENT 'Planned gross revenue in EUR.',
  discount_eur COMMENT 'Actual discounts in EUR.',
  discount_plan_eur COMMENT 'Planned discounts in EUR.',
  cogs_eur COMMENT 'Actual cost of goods sold in EUR.',
  cogs_plan_eur COMMENT 'Planned cost of goods sold in EUR.',
  fx_cost_eur COMMENT 'Actual FX cost in EUR.',
  fx_cost_plan_eur COMMENT 'Planned FX cost in EUR.',
  net_revenue_eur COMMENT 'Actual revenue minus discounts in EUR. Denominator of gross margin %.',
  plan_net_revenue_eur COMMENT 'Planned revenue minus discounts in EUR.',
  gross_margin_eur COMMENT 'Actual gross margin in EUR: revenue - discount - cogs - fx cost.',
  plan_gross_margin_eur COMMENT 'Planned gross margin in EUR.',
  gross_margin_pct COMMENT 'Actual gross margin as % of net revenue. For several rows compute SUM(gross_margin_eur) / SUM(net_revenue_eur); never average this column.',
  plan_gross_margin_pct COMMENT 'Planned gross margin as % of net revenue. For several rows compute SUM(plan_gross_margin_eur) / SUM(plan_net_revenue_eur).',
  margin_delta_pp COMMENT 'Actual minus planned gross margin % in percentage points; negative is below plan. Only meaningful for one row; for several rows recompute from the sums.',
  margin_delta_eur COMMENT 'Actual minus planned gross margin in EUR; negative is below plan. This one can be summed.'
)
COMMENT 'Gross margin against plan by month, region and product line. Use the EUR columns and ratios of sums when aggregating. Row-level security by region applies when governance is enabled.'
AS
SELECT
  month,
  concat('Q', quarter(month), ' ', year(month)) AS quarter,
  region_code,
  product_line,
  revenue_eur,
  revenue_plan_eur,
  discount_eur,
  discount_plan_eur,
  cogs_eur,
  cogs_plan_eur,
  fx_cost_eur,
  fx_cost_plan_eur,
  revenue_eur - discount_eur AS net_revenue_eur,
  revenue_plan_eur - discount_plan_eur AS plan_net_revenue_eur,
  revenue_eur - discount_eur - cogs_eur - fx_cost_eur AS gross_margin_eur,
  revenue_plan_eur - discount_plan_eur - cogs_plan_eur - fx_cost_plan_eur AS plan_gross_margin_eur,
  round(100 * (revenue_eur - discount_eur - cogs_eur - fx_cost_eur) / (revenue_eur - discount_eur), 2) AS gross_margin_pct,
  round(100 * (revenue_plan_eur - discount_plan_eur - cogs_plan_eur - fx_cost_plan_eur) / (revenue_plan_eur - discount_plan_eur), 2) AS plan_gross_margin_pct,
  round(
    100 * (revenue_eur - discount_eur - cogs_eur - fx_cost_eur) / (revenue_eur - discount_eur)
    - 100 * (revenue_plan_eur - discount_plan_eur - cogs_plan_eur - fx_cost_plan_eur) / (revenue_plan_eur - discount_plan_eur),
    2
  ) AS margin_delta_pp,
  (revenue_eur - discount_eur - cogs_eur - fx_cost_eur)
    - (revenue_plan_eur - discount_plan_eur - cogs_plan_eur - fx_cost_plan_eur) AS margin_delta_eur
FROM werkbank_demo.fin.margin_monthly;

CREATE OR REPLACE VIEW werkbank_demo.scm.purchase_orders (
  po_number COMMENT 'Ten-digit purchase order number.',
  item COMMENT 'Item number.',
  material COMMENT 'Material id.',
  material_description COMMENT 'Material description.',
  vendor_id COMMENT 'Vendor id.',
  vendor_name COMMENT 'Vendor name.',
  plant COMMENT 'Plant id.',
  plant_name COMMENT 'Plant name.',
  buyer_id COMMENT 'Buyer id.',
  buyer_name COMMENT 'Buyer name.',
  quantity COMMENT 'Ordered quantity.',
  unit_price_eur COMMENT 'Unit price in EUR.',
  net_value_eur COMMENT 'Quantity times unit price in EUR.',
  order_date COMMENT 'Order date.',
  requested_delivery_date COMMENT 'Delivery date the business asked for.',
  confirmed_delivery_date COMMENT 'Delivery date the vendor confirmed.',
  days_confirmed_after_requested COMMENT 'Days the vendor confirmed later than requested; 0 when on time.',
  inbound_lane COMMENT 'Origin and destination country.',
  lane_congested COMMENT '1 when the lane has a customs or port backlog.',
  status COMMENT 'OPEN or PARTIALLY_DELIVERED.'
)
COMMENT 'Open purchase orders with dates relative to today. This is the gold table the nightly load publishes.'
AS
SELECT
  s.po_number,
  s.item,
  s.material,
  s.material_description,
  s.vendor_id,
  v.vendor_name,
  s.plant,
  s.plant_name,
  s.buyer_id,
  s.buyer_name,
  s.quantity,
  s.unit_price_eur,
  round(s.quantity * s.unit_price_eur, 2) AS net_value_eur,
  date_add(current_date(), s.order_offset_days) AS order_date,
  date_add(current_date(), s.requested_offset_days) AS requested_delivery_date,
  date_add(current_date(), s.confirmed_offset_days) AS confirmed_delivery_date,
  greatest(s.confirmed_offset_days - s.requested_offset_days, 0) AS days_confirmed_after_requested,
  s.inbound_lane,
  s.lane_congested,
  s.status
FROM werkbank_demo.scm.purchase_orders_seed s
JOIN werkbank_demo.scm.vendors v ON v.vendor_id = s.vendor_id;

CREATE OR REPLACE VIEW werkbank_demo.ops.job_runs (
  run_id COMMENT 'Run id.',
  job_id COMMENT 'Job id.',
  job_name COMMENT 'Job name.',
  owner_team COMMENT 'Team that owns the job.',
  start_time COMMENT 'When the run started.',
  end_time COMMENT 'When the run ended.',
  duration_minutes COMMENT 'Run duration in minutes.',
  result_state COMMENT 'SUCCESS or FAILED.'
)
COMMENT 'Job runs of the last 14 nights with timestamps relative to now. Shaped like system.lakeflow.job_run_timeline.'
AS
SELECT run_id, job_id, job_name, owner_team, start_time, timestampadd(MINUTE, duration_minutes, start_time) AS end_time, duration_minutes, result_state
FROM (
  SELECT
    r.run_id,
    r.job_id,
    j.job_name,
    j.owner_team,
    to_timestamp(concat(cast(date_add(current_date(), r.start_day_offset) AS STRING), ' ', lpad(cast(r.start_hour AS STRING), 2, '0'), ':', lpad(cast(r.start_minute AS STRING), 2, '0'), ':00')) AS start_time,
    r.duration_minutes,
    r.result_state
  FROM werkbank_demo.ops.job_runs_seed r
  JOIN werkbank_demo.ops.jobs j ON j.job_id = r.job_id
) runs
WHERE start_time <= current_timestamp();
