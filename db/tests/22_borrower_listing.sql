-- Group 22: Phase 10-min borrower listing is a view, not a new fact table.

SELECT pg_temp.check('the synthetic fixture does not invent borrower listing rows', (
  SELECT count(*) = 0 FROM registry.borrower_observation_listing));

SELECT pg_temp.check('the borrower listing has no valuation, amount, or instrument-identity column', NOT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'registry' AND table_name = 'borrower_observation_listing'
    AND (column_name ILIKE '%cost%' OR column_name ILIKE '%fair%'
         OR column_name ILIKE '%amount%' OR column_name ILIKE '%principal%'
         OR column_name = 'instrument_id')));

SELECT pg_temp.expect_ok('reader can select the borrower listing and cannot read the underlying table', ARRAY[
  'SET ROLE bdc_reader',
  'SELECT count(*) FROM registry.borrower_observation_listing',
  'RESET ROLE']);

SELECT pg_temp.expect_error('reader cannot read position observations directly', '42501', ARRAY[
  'SET ROLE bdc_reader',
  'SELECT count(*) FROM obs.position_observation']);
