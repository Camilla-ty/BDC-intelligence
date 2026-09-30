-- Group 26: P19 market coverage. Missing coverage stays null or UNKNOWN.
-- An empty release is UNAVAILABLE. Cell counts are lines, not amounts.

SELECT pg_temp.check('the fixture registrant has stored lines and an unlinked release stays unknown', (
  SELECT (SELECT coverage_state = 'STORED_LINES' AND name_state = 'UNKNOWN' AND name_raw IS NULL
          FROM registry.market_registrant_coverage WHERE registrant_cik = '9999999901')
     AND (SELECT registrants_observed = 1 FROM registry.market_reported_date WHERE reported_date = '2099-12-31')
     AND (SELECT coverage_state = 'UNKNOWN'
             AND registrants_observed IS NULL
             AND reported_dates_observed IS NULL
          FROM registry.market_release_coverage WHERE release_label = '2099_12')));

SELECT pg_temp.check('the fixture date counts cells without returning amounts', (
  SELECT disclosed_line_count = 2
     AND maturity_cell_line_count = 0 AND maturity_unknown_line_count = 2
     AND principal_cell_line_count = 1 AND principal_unknown_line_count = 1
     AND basis_cell_line_count = 1 AND basis_unknown_line_count = 1
     AND initial_cell_line_count = 0 AND initial_unknown_line_count = 2
     AND name_state = 'UNKNOWN' AND name_raw IS NULL
  FROM registry.market_date_registrant('2099-12-31')
  WHERE registrant_cik = '9999999901'));

INSERT INTO registry.registrant (cik, run_id, evidence_id)
VALUES (9999999902, pg_temp.fx('run'), pg_temp.fx('e_sub')),
       (9999999903, pg_temp.fx('run'), pg_temp.fx('e_sub'));

INSERT INTO ops.coverage_assertion (
  registrant_id, dataset_release_id, source_type_code, coverage_aspect, coverage_state,
  evidence_id, rationale, rule_version_id, run_id)
SELECT r.id, pg_temp.fx('release'), 'SEC_BDC_DATASET_ZIP', 'SOI_HOLDINGS', 'COVERED',
       pg_temp.fx('e_sub'), 'covered filing with no identified line', pg_temp.fx('r_project'), pg_temp.fx('run')
FROM registry.registrant r WHERE r.cik = 9999999902;

WITH i AS (
  INSERT INTO registry.dataset_release (dataset_code, release_label, cadence, window_start, window_end, run_id, evidence_id)
  VALUES ('SEC_BDC_DATA_SETS', '2099_06', 'MONTHLY', '2099-06-01', '2099-06-30', pg_temp.fx('run'), pg_temp.fx('e_sub'))
  RETURNING id
)
INSERT INTO ops.coverage_assertion (
  registrant_id, dataset_release_id, source_type_code, coverage_aspect, coverage_state,
  evidence_id, rationale, rule_version_id, run_id)
SELECT NULL, i.id, 'SEC_BDC_DATASET_ZIP', 'SOI_HOLDINGS', 'EMPTY_PERIOD',
       pg_temp.fx('e_sub'), 'empty period stays unavailable', pg_temp.fx('r_project'), pg_temp.fx('run')
FROM i;

SELECT pg_temp.check('covered without a line, unknown, and an empty release stay distinct from zero', (
  SELECT (SELECT coverage_state = 'COVERED_NO_IDENTIFIED_LINE'
          FROM registry.market_registrant_coverage WHERE registrant_cik = '9999999902')
     AND (SELECT coverage_state = 'UNKNOWN'
          FROM registry.market_registrant_coverage WHERE registrant_cik = '9999999903')
     AND (SELECT coverage_state = 'UNAVAILABLE'
             AND registrants_observed IS NULL
             AND reported_dates_observed IS NULL
          FROM registry.market_release_coverage WHERE release_label = '2099_06')
     AND (SELECT count(*) = 0 FROM registry.market_release_date('2099_06'))
     AND (SELECT count(*) = 0 FROM registry.market_release_date('not-a-release'))));

INSERT INTO registry.dataset_release_artifact (dataset_release_id, artifact_id, run_id)
VALUES (pg_temp.fx('release'), pg_temp.fx('artifact'), pg_temp.fx('run'));

SELECT pg_temp.check('a covered release lists the registrant date and its disclosed lines', (
  SELECT count(*) = 1
     AND bool_and(registrant_cik = '9999999901')
     AND bool_and(reported_date = '2099-12-31')
     AND bool_and(disclosed_line_count = 2)
     AND (SELECT coverage_state = 'OBSERVED' AND registrants_observed = 1 AND reported_dates_observed = 1
          FROM registry.market_release_coverage WHERE release_label = '2099_12')
  FROM registry.market_release_date('2099_12')));

SELECT pg_temp.check('market coverage has no amount, identity, or total column', NOT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'registry'
    AND table_name IN ('market_registrant_coverage', 'market_release_coverage', 'market_reported_date')
    AND (column_name ILIKE '%fair%' OR column_name ILIKE '%spread%' OR column_name ILIKE '%pik%'
         OR column_name ILIKE '%interest%' OR column_name ILIKE '%total%' OR column_name ILIKE '%amount%'
         OR column_name = 'instrument_id' OR column_name = 'legal_entity_id')));

SELECT pg_temp.check('market views and functions do not sum amounts or read identity or field amounts',
  NOT EXISTS (
    SELECT 1 FROM pg_views
    WHERE schemaname = 'registry' AND viewname LIKE 'market_%'
      AND (lower(definition) LIKE '%sum(%'
           OR lower(definition) LIKE '%identity.legal_entity%'
           OR lower(definition) LIKE '%identity.instrument%'
           OR lower(definition) LIKE '%normalized_numeric%'))
  AND NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'registry' AND p.proname LIKE 'market_%'
      AND (lower(p.prosrc) LIKE '%sum(%'
           OR lower(p.prosrc) LIKE '%identity.legal_entity%'
           OR lower(p.prosrc) LIKE '%identity.instrument%'
           OR lower(p.prosrc) LIKE '%normalized_numeric%'
           OR position('fv.raw_value' in p.prosrc) > 0)));

SELECT pg_temp.expect_ok('reader can read market coverage', ARRAY[
  'SET ROLE bdc_reader',
  'SELECT count(*) FROM registry.market_registrant_coverage',
  'SELECT count(*) FROM registry.market_release_coverage',
  'SELECT count(*) FROM registry.market_reported_date',
  'SELECT count(*) FROM registry.market_date_registrant(''2099-12-31'')',
  'SELECT count(*) FROM registry.market_release_date(''2099_12'')',
  'RESET ROLE']);
