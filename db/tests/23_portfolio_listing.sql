-- Group 23: P14 portfolio listing is a view. The shared fixture's two position lines stay separate.
-- Cost, fair value, and rates on those lines are not columns of the view.

SELECT pg_temp.check('the fixture lists its registrant once, with an unknown name', (
  SELECT count(*) = 1
     AND bool_and(registrant_cik = '9999999901')
     AND bool_and(name_state = 'UNKNOWN')
     AND bool_and(name_raw IS NULL)
     AND bool_and(reported_date_count = 1)
  FROM registry.portfolio_registrant));

SELECT pg_temp.check('the fixture date counts two disclosed lines and does not total an amount', (
  SELECT count(*) = 1
     AND bool_and(disclosed_line_count = 2)
     AND bool_and(point_in_time_line_count = 2)
     AND bool_and(duration_line_count = 0)
  FROM registry.portfolio_reported_date));

SELECT pg_temp.check('duplicate disclosed lines stay separate and a missing principal stays unknown', (
  SELECT count(*) = 2
     AND count(DISTINCT disclosed_line_text) = 1
     AND count(*) FILTER (WHERE principal_state = 'REPORTED' AND principal_raw = '100' AND principal_currency_state = 'UNKNOWN') = 1
     AND count(*) FILTER (WHERE principal_state = 'UNKNOWN' AND principal_raw IS NULL) = 1
     AND count(*) FILTER (WHERE principal_raw IN ('90', '0.05', '0.01')) = 0
     AND count(*) FILTER (WHERE maturity_source = 'UNKNOWN' AND maturity_raw IS NULL) = 2
     AND count(*) FILTER (WHERE period_role = 'UNRESOLVED') = 2
     AND count(*) FILTER (WHERE release_state = 'UNKNOWN') = 2
  FROM registry.portfolio_line));

SELECT pg_temp.check('the portfolio line has no cost, fair value, rate, spread, or total column', NOT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'registry' AND table_name = 'portfolio_line'
    AND (column_name ILIKE '%cost%' OR column_name ILIKE '%fair%'
         OR column_name ILIKE '%spread%' OR column_name ILIKE '%pik%'
         OR column_name ILIKE '%interest%' OR column_name ILIKE '%total%'
         OR column_name = 'instrument_id' OR column_name = 'legal_entity_id')));

SELECT pg_temp.check('principal currency on a portfolio line is an explicit state column', EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'registry' AND table_name = 'portfolio_line'
    AND column_name = 'principal_currency_state'));

SELECT pg_temp.check('portfolio views do not sum amounts or read identity tables',
  NOT EXISTS (
    SELECT 1 FROM pg_views
    WHERE schemaname = 'registry' AND viewname LIKE 'portfolio_%'
      AND (lower(definition) LIKE '%sum(%' OR lower(definition) LIKE '%identity.legal_entity%'
           OR lower(definition) LIKE '%identity.instrument%')));

SELECT pg_temp.expect_ok('reader can select portfolio views', ARRAY[
  'SET ROLE bdc_reader',
  'SELECT count(*) FROM registry.portfolio_registrant',
  'SELECT count(*) FROM registry.portfolio_reported_date',
  'SELECT count(*) FROM registry.portfolio_line',
  'SELECT count(*) FROM registry.portfolio_empty_period',
  'RESET ROLE']);
