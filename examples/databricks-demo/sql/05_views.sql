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

-- ---------------------------------------------------------------- fin: pre-close

CREATE OR REPLACE VIEW werkbank_demo.fin.v_grir_open (
  po_number COMMENT 'Ten-digit purchase order number; the key to use in SAP.',
  item COMMENT 'Item number.',
  company_code COMMENT 'Company code that owns the liability.',
  vendor_id COMMENT 'Vendor id.',
  vendor_name COMMENT 'Vendor name.',
  description COMMENT 'What was received.',
  goods_receipt_date COMMENT 'Date the goods were received.',
  age_days COMMENT 'Days since goods receipt.',
  gr_value_eur COMMENT 'Value received in EUR.',
  invoiced_value_eur COMMENT 'Value invoiced so far in EUR.',
  open_value_eur COMMENT 'Received minus invoiced in EUR. Negative means invoiced before the goods arrived.',
  classification COMMENT 'ACCRUE (recent, open value above zero), STALE_REVIEW (older than 90 days, needs clearing review not an accrual), INVOICE_BEFORE_GOODS (negative, clarify with the vendor).'
)
COMMENT 'Open goods receipt / invoice receipt items with age and a recommended treatment for the period-end close.'
AS
SELECT
  g.po_number,
  g.item,
  g.company_code,
  g.vendor_id,
  g.vendor_name,
  g.description,
  date_add(current_date(), g.gr_offset_days) AS goods_receipt_date,
  -g.gr_offset_days AS age_days,
  CAST(g.gr_value_eur AS DOUBLE) AS gr_value_eur,
  CAST(g.invoiced_value_eur AS DOUBLE) AS invoiced_value_eur,
  CAST(g.gr_value_eur - g.invoiced_value_eur AS DOUBLE) AS open_value_eur,
  CASE
    WHEN g.gr_value_eur - g.invoiced_value_eur < 0 THEN 'INVOICE_BEFORE_GOODS'
    WHEN -g.gr_offset_days > 90 THEN 'STALE_REVIEW'
    WHEN g.gr_value_eur - g.invoiced_value_eur > 0 THEN 'ACCRUE'
    ELSE 'CLEARED'
  END AS classification
FROM werkbank_demo.fin.grir_items g;

CREATE OR REPLACE VIEW werkbank_demo.fin.v_ic_differences (
  item_id COMMENT 'Intercompany document id.',
  seller_company COMMENT 'Company code that billed.',
  buyer_company COMMENT 'Company code that was billed.',
  description COMMENT 'What was charged.',
  posting_date COMMENT 'Posting date on the seller side.',
  seller_amount_eur COMMENT 'Seller receivable in EUR.',
  buyer_amount_eur COMMENT 'Buyer payable in EUR; NULL when not posted.',
  difference_eur COMMENT 'Seller minus buyer in EUR (buyer counts as zero when not posted).',
  category COMMENT 'MISSING_ON_BUYER_SIDE, AMOUNT_MISMATCH, or ROUNDING (difference of 50 EUR or less).'
)
COMMENT 'Only the intercompany items where seller and buyer disagree, with a category. Items that match are not listed.'
AS
SELECT
  item_id,
  seller_company,
  buyer_company,
  description,
  date_add(current_date(), posting_offset_days) AS posting_date,
  CAST(seller_amount_eur AS DOUBLE) AS seller_amount_eur,
  CAST(buyer_amount_eur AS DOUBLE) AS buyer_amount_eur,
  ROUND(CAST(seller_amount_eur - coalesce(buyer_amount_eur, 0) AS DOUBLE), 2) AS difference_eur,
  CASE
    WHEN buyer_amount_eur IS NULL THEN 'MISSING_ON_BUYER_SIDE'
    WHEN abs(seller_amount_eur - buyer_amount_eur) <= 50 THEN 'ROUNDING'
    ELSE 'AMOUNT_MISMATCH'
  END AS category
FROM werkbank_demo.fin.intercompany_items
WHERE seller_amount_eur <> coalesce(buyer_amount_eur, 0);
