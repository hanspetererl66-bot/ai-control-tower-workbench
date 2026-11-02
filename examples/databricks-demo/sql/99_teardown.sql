-- 99_teardown.sql: remove everything the demo created. Deletes the whole demo catalog. Nothing else is touched.
-- Not part of all-in-one.sql. If you loaded into a catalog you already owned, drop the three schemas instead:
--   DROP SCHEMA IF EXISTS <catalog>.fin CASCADE;  DROP SCHEMA IF EXISTS <catalog>.ops CASCADE;  DROP SCHEMA IF EXISTS <catalog>.scm CASCADE;

DROP CATALOG IF EXISTS werkbank_demo CASCADE;
