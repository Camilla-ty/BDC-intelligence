-- Group 25: filtered maturity reads match the maturity views on the fixture.
-- The fixture registrant has two lines and no maturity date.

SELECT pg_temp.check('coverage for the fixture registrant matches the view', (
  SELECT count(*) = 1
     AND bool_and(disclosed_line_count = 2)
     AND bool_and(maturity_reported_count = 0)
     AND bool_and(maturity_unknown_count = 2)
     AND bool_and(maturity_unresolved_count = 0)
  FROM registry.maturity_coverage('9999999901')
  WHERE NOT EXISTS (
    SELECT reported_date, disclosed_line_count, maturity_reported_count, maturity_unknown_count, maturity_unresolved_count
    FROM registry.maturity_reported_date
    WHERE registrant_cik = '9999999901'
    EXCEPT
    SELECT reported_date, disclosed_line_count, maturity_reported_count, maturity_unknown_count, maturity_unresolved_count
    FROM registry.maturity_coverage('9999999901'))));

SELECT pg_temp.check('a cik that is not ten digits returns no coverage', (
  SELECT count(*) = 0 FROM registry.maturity_coverage('1')));

SELECT pg_temp.check('the fixture has no maturity year from the filtered read', (
  SELECT count(*) = 0 FROM registry.maturity_years('9999999901')));

SELECT pg_temp.check('unknown lines are counted and a missing year counts as zero lines', (
  SELECT registry.maturity_line_count('9999999901', '2099-12-31', 'all', NULL) = 2
     AND registry.maturity_line_count('9999999901', '2099-12-31', 'unknown', NULL) = 2
     AND registry.maturity_line_count('9999999901', '2099-12-31', 'year', 1899) = 0
     AND registry.maturity_line_count('9999999901', '2099-12-31', 'unresolved', NULL) = 0
     AND registry.maturity_line_count('not-a-cik', '2099-12-31', 'all', NULL) = 0));

SELECT pg_temp.check('a maturity page keeps unknown maturity and drops other field amounts', (
  SELECT count(*) = 2
     AND count(*) FILTER (WHERE maturity_source = 'UNKNOWN' AND maturity_raw IS NULL AND maturity_year IS NULL) = 2
     AND count(*) FILTER (WHERE principal_state = 'REPORTED' AND principal_raw = '100' AND principal_currency_state = 'UNKNOWN') = 1
     AND count(*) FILTER (WHERE principal_raw IN ('90', '0.05', '0.01')) = 0
  FROM registry.maturity_line_page('9999999901', '2099-12-31', 'all', NULL, 50, 0)));

SELECT pg_temp.check('maturity functions do not sum amounts or read identity or valuation fields',
  NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'registry' AND p.proname LIKE 'maturity_%'
      AND (lower(p.prosrc) LIKE '%sum(%'
           OR lower(p.prosrc) LIKE '%identity.legal_entity%'
           OR lower(p.prosrc) LIKE '%identity.instrument%'
           OR lower(p.prosrc) LIKE '%fair_value%'
           OR p.prosrc LIKE '%''COST''%'
           OR p.prosrc LIKE '%''INTEREST_RATE''%'
           OR p.prosrc LIKE '%''SPREAD''%')));

SELECT pg_temp.expect_ok('reader can call the maturity reads and cannot call the position helper', ARRAY[
  'SET ROLE bdc_reader',
  'SELECT count(*) FROM registry.maturity_coverage(''9999999901'')',
  'SELECT count(*) FROM registry.maturity_years(''9999999901'')',
  'SELECT registry.maturity_line_count(''9999999901'', ''2099-12-31'', ''unknown'', NULL)',
  'SELECT count(*) FROM registry.maturity_line_page(''9999999901'', ''2099-12-31'', ''all'', NULL, 50, 0)',
  'RESET ROLE']);

SELECT pg_temp.expect_error('reader cannot call the unfiltered position helper', '42501', ARRAY[
  'SET ROLE bdc_reader',
  'SELECT count(*) FROM registry.maturity_position_for_cik(''9999999901'')']);
