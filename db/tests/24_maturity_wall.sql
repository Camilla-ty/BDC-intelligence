-- Group 24: P17 maturity wall. The fixture has no maturity date, so both lines stay UNKNOWN
-- and no year bucket is created. A missing maturity is not a zero year.

SELECT pg_temp.check('a reported date with no maturity keeps both lines and creates no year', (
  SELECT count(*) = 1
     AND bool_and(disclosed_line_count = 2)
     AND bool_and(maturity_reported_count = 0)
     AND bool_and(maturity_unknown_count = 2)
     AND bool_and(maturity_unresolved_count = 0)
  FROM registry.maturity_reported_date));

SELECT pg_temp.check('unknown maturity is omitted from the year counts', (
  SELECT count(*) = 0 FROM registry.maturity_year));

SELECT pg_temp.check('maturity lines keep unknown maturity and do not carry other field amounts', (
  SELECT count(*) = 2
     AND count(*) FILTER (WHERE maturity_source = 'UNKNOWN' AND maturity_raw IS NULL AND maturity_year IS NULL) = 2
     AND count(*) FILTER (WHERE principal_state = 'REPORTED' AND principal_raw = '100' AND principal_currency_state = 'UNKNOWN') = 1
     AND count(*) FILTER (WHERE principal_state = 'UNKNOWN' AND principal_raw IS NULL) = 1
     AND count(*) FILTER (WHERE principal_raw IN ('90', '0.05', '0.01')) = 0
  FROM registry.maturity_line));

SELECT pg_temp.check('the maturity line has no valuation, rate, spread, or identity column', NOT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'registry' AND table_name = 'maturity_line'
    AND (column_name ILIKE '%cost%' OR column_name ILIKE '%fair%'
         OR column_name ILIKE '%spread%' OR column_name ILIKE '%pik%'
         OR column_name ILIKE '%interest%' OR column_name ILIKE '%total%'
         OR column_name = 'instrument_id' OR column_name = 'legal_entity_id')));

SELECT pg_temp.check('maturity views do not sum amounts or read identity or valuation fields',
  NOT EXISTS (
    SELECT 1 FROM pg_views
    WHERE schemaname = 'registry' AND viewname LIKE 'maturity_%'
      AND (lower(definition) LIKE '%sum(%'
           OR lower(definition) LIKE '%identity.legal_entity%'
           OR lower(definition) LIKE '%identity.instrument%'
           OR lower(definition) LIKE '%fair_value%'
           OR definition LIKE '%''COST''%'
           OR definition LIKE '%''INTEREST_RATE''%'
           OR definition LIKE '%''SPREAD''%')));

SELECT pg_temp.expect_ok('reader can select maturity views', ARRAY[
  'SET ROLE bdc_reader',
  'SELECT count(*) FROM registry.maturity_reported_date',
  'SELECT count(*) FROM registry.maturity_year',
  'SELECT count(*) FROM registry.maturity_line',
  'RESET ROLE']);
