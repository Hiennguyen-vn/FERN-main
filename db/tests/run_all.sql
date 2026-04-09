\set ON_ERROR_STOP on
\echo 'Loading test helper functions'
\ir helpers/00_assertions.sql

\echo 'Running schema smoke tests'
\ir 10_schema_smoke.sql

\echo 'Running reference and integrity tests'
\ir 20_reference_constraints.sql

\echo 'Running IAM and HR tests'
\ir 30_iam_and_hr.sql

\echo 'Running product and procurement tests'
\ir 40_product_procurement.sql

\echo 'Running sales and inventory tests'
\ir 50_sales_inventory.sql

\echo 'Running payroll, expense, and audit tests'
\ir 60_payroll_expense_audit.sql

\echo 'Running inventory linkage tests'
\ir 70_inventory_linkage.sql

\echo 'Running promotion, tax, and soft-delete tests'
\ir 80_promotion_tax_softdelete.sql

\echo 'All SQL tests completed successfully'
