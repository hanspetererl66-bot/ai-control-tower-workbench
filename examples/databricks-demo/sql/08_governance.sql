-- 08_governance.sql: row-level security by region. NOT part of all-in-one.sql: it needs account groups and it
-- applies to everyone, including the person who runs it.
--
-- BEFORE you run it:
--   1. Create these account groups (account console > User management > Groups):
--        wbdemo_all_regions, wbdemo_dach, wbdemo_uki, wbdemo_fr, wbdemo_nordics
--   2. Put yourself into wbdemo_all_regions, or you will see no rows afterwards.
--   3. Put the service principal or user you demo with into one regional group, a second one into wbdemo_all_regions.
--
-- Demo: the same question ("Why did DACH margin miss plan in Q3?") asked through two identities.
-- The member of wbdemo_dach gets the full answer, the member of wbdemo_uki gets "no data for DACH".
-- Genie, the SQL tool and the margin view all go through the same filter; nothing is configured in the agent.

CREATE OR REPLACE FUNCTION werkbank_demo.fin.region_access(region_code STRING)
RETURN is_account_group_member('wbdemo_all_regions')
    OR is_account_group_member(concat('wbdemo_', lower(region_code)));

ALTER TABLE werkbank_demo.fin.margin_monthly
  SET ROW FILTER werkbank_demo.fin.region_access ON (region_code);

ALTER TABLE werkbank_demo.fin.large_discount_deals
  SET ROW FILTER werkbank_demo.fin.region_access ON (region_code);

-- To switch it off again:
-- ALTER TABLE werkbank_demo.fin.margin_monthly DROP ROW FILTER;
-- ALTER TABLE werkbank_demo.fin.large_discount_deals DROP ROW FILTER;
