-- 09_grants.sql: least privilege for the identity the agent uses. NOT part of all-in-one.sql.
-- Run it once your groups exist. Two groups, because the demo shows the difference:
--
--   wbdemo_readers    read everything and call the functions. They cannot write anywhere.
--   wbdemo_approvers  the same, plus INSERT on ops.rerun_requests, the single write the on-call scenario may do.
--
-- Put the service principal behind the Werkbank connector into one of them. Reading never needs more than this.
-- The SQL warehouse needs CAN USE for the same principal (workspace permission, not a grant here).

GRANT USE CATALOG ON CATALOG werkbank_demo TO `wbdemo_readers`;
GRANT USE SCHEMA, SELECT, EXECUTE ON SCHEMA werkbank_demo.fin TO `wbdemo_readers`;
GRANT USE SCHEMA, SELECT, EXECUTE ON SCHEMA werkbank_demo.scm TO `wbdemo_readers`;
GRANT USE SCHEMA, SELECT, EXECUTE ON SCHEMA werkbank_demo.ops TO `wbdemo_readers`;

GRANT USE CATALOG ON CATALOG werkbank_demo TO `wbdemo_approvers`;
GRANT USE SCHEMA, SELECT, EXECUTE ON SCHEMA werkbank_demo.fin TO `wbdemo_approvers`;
GRANT USE SCHEMA, SELECT, EXECUTE ON SCHEMA werkbank_demo.scm TO `wbdemo_approvers`;
GRANT USE SCHEMA, SELECT, EXECUTE ON SCHEMA werkbank_demo.ops TO `wbdemo_approvers`;
GRANT MODIFY ON TABLE werkbank_demo.ops.rerun_requests TO `wbdemo_approvers`;
