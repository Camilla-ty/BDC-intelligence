-- Group 31: the maturity wall and the portfolio listing read the product maturity (migration 0026).
-- Obviously fake contexts, facts, and 2099 dates. No production filing.
-- The fixture registrant 9999999901 starts with two lines and no maturity.

WITH i AS (
  INSERT INTO raw.artifact (source_url, final_url, source_type_code, http_status, byte_size, sha256, retrieved_at, storage_key, run_id)
  VALUES ('https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000001/test-maturity.htm',
          'https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000001/test-maturity.htm',
          'SEC_FILING_DOCUMENT', 200, 1, repeat('d', 64), '2099-01-03T00:00:00Z', 'test-only/maturity-doc', pg_temp.fx('run'))
  RETURNING id
) INSERT INTO fx SELECT 'artifact_maturity', id FROM i;

WITH i AS (
  INSERT INTO registry.filing_document (filing_id, document_name, document_url, named_by, rule_version_id, run_id, evidence_id)
  VALUES (pg_temp.fx('filing'), 'test-maturity.htm',
          'https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000001/test-maturity.htm',
          'FILING_INDEX_JSON', pg_temp.fx('r_project'), pg_temp.fx('run'), pg_temp.fx('e_sub'))
  RETURNING id
) INSERT INTO fx SELECT 'filing_doc_maturity', id FROM i;

INSERT INTO registry.filing_document_artifact (filing_document_id, artifact_id, run_id)
VALUES (pg_temp.fx('filing_doc_maturity'), pg_temp.fx('artifact_maturity'), pg_temp.fx('run'));

WITH i AS (
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, run_id)
  VALUES ('L2_ORIGINAL_FILING', pg_temp.fx('artifact_maturity'), 'DOCUMENT', pg_temp.fx('run'))
  RETURNING id
) INSERT INTO fx SELECT 'e_doc', id FROM i;

WITH i AS (
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_anchor, run_id)
  VALUES ('L2_ORIGINAL_FILING', pg_temp.fx('artifact_maturity'), 'HTML_ANCHOR', 'ix-context-row:c-1', pg_temp.fx('run'))
  RETURNING id
) INSERT INTO fx SELECT 'e_anchor', id FROM i;

WITH i AS (
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, ixbrl_fact_id, run_id)
  VALUES ('L2_ORIGINAL_FILING', pg_temp.fx('artifact_maturity'), 'IXBRL_FACT', 'f-1', pg_temp.fx('run'))
  RETURNING id
) INSERT INTO fx SELECT 'e_fact', id FROM i;

CREATE FUNCTION pg_temp.add_position(key text, rule_key text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  soi bigint;
  po bigint;
BEGIN
  INSERT INTO obs.soi_row_observation (tabular_row_id, filing_id, reported_date_raw, reported_date,
      date_precision, qtrs_raw, qtrs, duration_kind, identifier_raw, rule_version_id, evidence_id, run_id)
  VALUES (pg_temp.fx('row_soi_a'), pg_temp.fx('filing'), '2099-12-31', '2099-12-31', 'MONTH_END_ROUNDED', '0', 0,
          'POINT_IN_TIME', 'TEST BORROWER A | TEST LOAN 1', pg_temp.fx(rule_key), pg_temp.fx('e_soi_a'), pg_temp.fx('run'))
  RETURNING id INTO soi;
  INSERT INTO obs.soi_row_classification (soi_row_observation_id, row_kind, period_role, rule_version_id, run_id)
  VALUES (soi, 'IDENTIFIER_ROW', 'UNRESOLVED', pg_temp.fx('r_classify'), pg_temp.fx('run'));
  INSERT INTO obs.position_observation (origin_soi_row_observation_id, filing_id, reported_date,
      date_precision, duration_kind, holding_descriptor_raw, rule_version_id, evidence_id, run_id)
  VALUES (soi, pg_temp.fx('filing'), '2099-12-31', 'MONTH_END_ROUNDED', 'POINT_IN_TIME',
          'TEST BORROWER A | TEST LOAN 1', pg_temp.fx('r_position'), pg_temp.fx('e_soi_a'), pg_temp.fx('run'))
  RETURNING id INTO po;
  PERFORM pg_temp.put('po_' || key, po);
END
$$;

CREATE FUNCTION pg_temp.origin(po_key text) RETURNS bigint
LANGUAGE sql AS $$
  SELECT origin_soi_row_observation_id FROM obs.position_observation WHERE id = pg_temp.fx(po_key)
$$;

CREATE FUNCTION pg_temp.current_inspection(po_key text) RETURNS bigint
LANGUAGE sql AS $$
  SELECT i.id FROM obs.maturity_inspection i
  WHERE i.position_observation_id = pg_temp.fx(po_key)
    AND NOT EXISTS (SELECT 1 FROM obs.maturity_inspection s WHERE s.supersedes_id = i.id)
$$;

CREATE FUNCTION pg_temp.inspect_bound(po_key text, state text, raw text, displayed date) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  prior bigint := pg_temp.current_inspection(po_key);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM validation.validation_result
                 WHERE subject_id = pg_temp.fx(po_key) AND outcome = 'PASS' AND detail = 'c-1') THEN
    INSERT INTO validation.validation_result (subject_table, subject_id, rule_version_id, outcome, detail, evidence_id, run_id)
    VALUES ('obs.position_observation', pg_temp.fx(po_key), pg_temp.fx('r_validate'), 'PASS', 'c-1', pg_temp.fx('e_fact'), pg_temp.fx('run'));
  END IF;
  INSERT INTO obs.maturity_inspection (position_observation_id, soi_row_observation_id, inspection_state,
      filing_context_id, raw_value, normalized_date, evidence_id, rule_version_id, run_id, supersedes_id, supersede_reason)
  VALUES (pg_temp.fx(po_key), pg_temp.origin(po_key), state::ref.maturity_inspection_state,
          'c-1', raw, displayed, pg_temp.fx('e_anchor'), pg_temp.fx('r_validate'), pg_temp.fx('run'),
          prior, CASE WHEN prior IS NOT NULL THEN 'TEST ONLY: newer inspection' END);
END
$$;

CREATE FUNCTION pg_temp.inspect_not_bound(po_key text, reason text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  prior bigint := pg_temp.current_inspection(po_key);
BEGIN
  INSERT INTO validation.validation_result (subject_table, subject_id, rule_version_id, outcome, detail, evidence_id, run_id)
  VALUES ('obs.position_observation', pg_temp.fx(po_key), pg_temp.fx('r_validate'), 'FAIL', reason, pg_temp.fx('e_doc'), pg_temp.fx('run'));
  INSERT INTO obs.maturity_inspection (position_observation_id, soi_row_observation_id, inspection_state,
      no_bind_reason, evidence_id, rule_version_id, run_id, supersedes_id, supersede_reason)
  VALUES (pg_temp.fx(po_key), pg_temp.origin(po_key), 'NOT_BOUND', reason::ref.maturity_no_bind_reason,
          pg_temp.fx('e_doc'), pg_temp.fx('r_validate'), pg_temp.fx('run'),
          prior, CASE WHEN prior IS NOT NULL THEN 'TEST ONLY: superseded by binder rule v2: ' || reason END);
END
$$;

CREATE FUNCTION pg_temp.field(po_key text, code text, raw text, value date) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO obs.position_field_value (position_observation_id, field_code, raw_value, normalized_date,
      currency_state, scale_state, value_state, normalization_rule_version_id, evidence_id, run_id)
  VALUES (pg_temp.fx(po_key), code, raw, value, 'UNKNOWN', 'NOT_APPLICABLE', 'REPORTED',
          pg_temp.fx('r_field'), pg_temp.fx('e_anchor'), pg_temp.fx('run'))
$$;

CREATE FUNCTION pg_temp.wall(po_key text) RETURNS registry.maturity_position
LANGUAGE sql AS $$
  SELECT * FROM registry.maturity_position WHERE position_observation_id = pg_temp.fx(po_key)
$$;

CREATE FUNCTION pg_temp.listing(po_key text) RETURNS registry.portfolio_line
LANGUAGE sql AS $$
  SELECT * FROM registry.portfolio_line WHERE position_observation_id = pg_temp.fx(po_key)
$$;

SELECT pg_temp.add_position('structured', 'r_project2');
SELECT pg_temp.add_position('filing', 'r_parser');
SELECT pg_temp.add_position('not_bound', 'r_field');
SELECT pg_temp.add_position('unavailable', 'r_classify');
SELECT pg_temp.add_position('conflict', 'r_group');
SELECT pg_temp.add_position('candidates', 'r_validate');
SELECT pg_temp.add_position('shared', 'r_resolve');
SELECT pg_temp.add_position('verified', 'r_coverage');
SELECT pg_temp.add_position('acquired', 'r_mapping');

SELECT pg_temp.field('po_structured', 'MATURITY_DATE', '5/6/2099', DATE '2099-05-06');
SELECT pg_temp.inspect_bound('po_filing', 'FILING_DISPLAYED', '4/13/2099', DATE '2099-04-13');
SELECT pg_temp.inspect_not_bound('po_not_bound', 'MULTIPLE_ROWS');
SELECT pg_temp.inspect_bound('po_unavailable', 'UNAVAILABLE', NULL, NULL);
SELECT pg_temp.field('po_conflict', 'MATURITY_DATE', '1/2/2099', DATE '2099-01-02');
SELECT pg_temp.inspect_bound('po_conflict', 'FILING_DISPLAYED', '3/4/2099', DATE '2099-03-04');
SELECT pg_temp.inspect_bound('po_candidates', 'UNRESOLVED', NULL, NULL);
INSERT INTO obs.maturity_inspection_candidate (maturity_inspection_id, raw_value, normalized_date, evidence_id, run_id)
VALUES (pg_temp.current_inspection('po_candidates'), '7/8/2099', DATE '2099-07-08', pg_temp.fx('e_fact'), pg_temp.fx('run')),
       (pg_temp.current_inspection('po_candidates'), '8/9/2099', DATE '2099-08-09', pg_temp.fx('e_fact'), pg_temp.fx('run'));
-- Shared-row shape: a displayed date superseded by NOT_BOUND SHARED_ROW.
SELECT pg_temp.inspect_bound('po_shared', 'FILING_DISPLAYED', '9/10/2099', DATE '2099-09-10');
SELECT pg_temp.inspect_not_bound('po_shared', 'SHARED_ROW');
SELECT pg_temp.field('po_verified', 'MATURITY_DATE', '11/12/2099', DATE '2099-11-12');
SELECT pg_temp.inspect_bound('po_verified', 'FILING_DISPLAYED', '11/12/2099', DATE '2099-11-12');
SELECT pg_temp.field('po_acquired', 'ACQUISITION_DATE', '10/11/2099', DATE '2099-10-11');

SELECT pg_temp.check('1: a structured maturity still displays on the wall and the listing', (
  SELECT w.maturity_source = 'REPORTED_STRUCTURED' AND w.maturity_raw = '5/6/2099' AND w.maturity_date = DATE '2099-05-06'
     AND NOT w.filing_verified AND w.maturity_document_url IS NULL
     AND l.maturity_source = 'REPORTED_STRUCTURED' AND l.maturity_raw = '5/6/2099'
  FROM pg_temp.wall('po_structured') w, pg_temp.listing('po_structured') l));

SELECT pg_temp.check('2: a filing-displayed maturity displays when the structured maturity is absent', (
  SELECT w.maturity_source = 'FILING_DISPLAYED' AND w.maturity_raw = '4/13/2099' AND w.maturity_date = DATE '2099-04-13'
     AND l.maturity_source = 'FILING_DISPLAYED' AND l.maturity_raw = '4/13/2099' AND l.maturity_date = DATE '2099-04-13'
     AND NOT EXISTS (SELECT 1 FROM obs.position_field_value
                     WHERE position_observation_id = pg_temp.fx('po_filing') AND field_code = 'MATURITY_DATE')
  FROM pg_temp.wall('po_filing') w, pg_temp.listing('po_filing') l));

SELECT pg_temp.check('3: UNKNOWN maturity shows no date and keeps why the filing supplied none', (
  SELECT count(*) = 2
     AND bool_and(maturity_source = 'UNKNOWN' AND maturity_date IS NULL AND maturity_raw IS NULL)
     AND bool_or(maturity_inspection_state = 'NOT_BOUND' AND maturity_no_bind_reason = 'MULTIPLE_ROWS')
     AND bool_or(maturity_inspection_state = 'UNAVAILABLE' AND maturity_no_bind_reason IS NULL)
  FROM registry.portfolio_line
  WHERE position_observation_id IN (pg_temp.fx('po_not_bound'), pg_temp.fx('po_unavailable'))));

SELECT pg_temp.check('4: UNRESOLVED maturity shows no selected date', (
  SELECT count(*) = 2 AND bool_and(maturity_source = 'UNRESOLVED' AND maturity_date IS NULL AND maturity_raw IS NULL)
  FROM registry.maturity_position
  WHERE position_observation_id IN (pg_temp.fx('po_conflict'), pg_temp.fx('po_candidates'))));

SELECT pg_temp.check('5: the shared-row shape shows no maturity on the wall or the listing', (
  SELECT w.maturity_source = 'UNKNOWN' AND w.maturity_date IS NULL AND w.maturity_raw IS NULL
     AND w.no_bind_reason = 'SHARED_ROW'
     AND l.maturity_source = 'UNKNOWN' AND l.maturity_date IS NULL AND l.maturity_raw IS NULL
  FROM pg_temp.wall('po_shared') w, pg_temp.listing('po_shared') l));

SELECT pg_temp.check('6 and 7: NOT_BOUND MULTIPLE_ROWS and UNAVAILABLE shapes show no maturity on the page', (
  SELECT count(*) = 2 AND bool_and(maturity_source = 'UNKNOWN' AND maturity_raw IS NULL AND maturity_year IS NULL)
  FROM registry.maturity_line_page('9999999901', '2099-12-31', 'unknown', NULL, 50, 0)
  WHERE position_observation_id IN (pg_temp.fx('po_not_bound'), pg_temp.fx('po_unavailable'))));

SELECT pg_temp.check('8: an acquisition date stays its own field and never becomes the maturity', (
  SELECT l.maturity_source = 'UNKNOWN' AND l.maturity_date IS NULL AND l.maturity_raw IS NULL
     AND l.acquisition_date_state = 'REPORTED' AND l.acquisition_date_raw = '10/11/2099'
     AND NOT EXISTS (SELECT 1 FROM registry.maturity_position
                     WHERE maturity_date = DATE '2099-10-11' OR maturity_raw = '10/11/2099')
  FROM pg_temp.listing('po_acquired') l));

SELECT pg_temp.check('8: no product maturity carries prose', (
  SELECT bool_and(maturity_raw IS NULL OR maturity_raw !~ '[A-Za-z]') FROM registry.portfolio_line));

SELECT pg_temp.check('9: a filing-displayed maturity carries its EDGAR document; a verified one does too', (
  SELECT f.maturity_document_url = 'https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000001/test-maturity.htm'
     AND l.maturity_document_url = f.maturity_document_url
     AND v.maturity_source = 'REPORTED_STRUCTURED' AND v.maturity_raw = '11/12/2099'
     AND v.filing_verified AND v.maturity_document_url = f.maturity_document_url
  FROM pg_temp.wall('po_filing') f, pg_temp.listing('po_filing') l, pg_temp.wall('po_verified') v));

SELECT pg_temp.check('9: the maturity page carries the source and document of a filing-displayed maturity', (
  SELECT count(*) = 1
     AND bool_and(maturity_source = 'FILING_DISPLAYED' AND maturity_raw = '4/13/2099' AND maturity_year = 2099
                  AND NOT maturity_filing_verified AND maturity_document_url LIKE '%/test-maturity.htm')
  FROM registry.maturity_line_page('9999999901', '2099-12-31', 'year', 2099, 50, 0)
  WHERE position_observation_id = pg_temp.fx('po_filing')));

SELECT pg_temp.check('10: the wall, the line page, and the listing select the same maturity for every line', NOT EXISTS (
  (SELECT position_observation_id, maturity_source, maturity_date, maturity_raw FROM registry.maturity_position
   EXCEPT
   SELECT position_observation_id, maturity_source, maturity_date, maturity_raw FROM registry.portfolio_line)
  UNION ALL
  (SELECT position_observation_id, maturity_source, maturity_date, maturity_raw FROM registry.portfolio_line
   EXCEPT
   SELECT position_observation_id, maturity_source, maturity_date, maturity_raw FROM registry.maturity_position)));

SELECT pg_temp.check('10: the line page selects the same maturity as the wall', NOT EXISTS (
  SELECT position_observation_id, maturity_source, maturity_raw, extract(YEAR FROM maturity_date)::integer
  FROM registry.maturity_position WHERE registrant_cik = '9999999901'
  EXCEPT
  SELECT position_observation_id, maturity_source, maturity_raw, maturity_year
  FROM registry.maturity_line_page('9999999901', '2099-12-31', 'all', NULL, 50, 0)));

SELECT pg_temp.check('10: the wall and the listing read maturity only through registry.maturity_read', (
  position('maturity_read' IN pg_get_viewdef('registry.maturity_position'::regclass)) > 0
  AND position('maturity_read' IN pg_get_viewdef('registry.portfolio_line'::regclass)) > 0
  AND position('maturity_provenance' IN pg_get_viewdef('registry.maturity_read'::regclass)) > 0
  AND position('MATURITY_DATE' IN pg_get_viewdef('registry.maturity_position'::regclass)) = 0
  AND position('MATURITY_DATE' IN pg_get_viewdef('registry.portfolio_line'::regclass)) = 0
  AND position('MATURITY_DATE' IN pg_get_viewdef('registry.maturity_read'::regclass)) = 0
  AND pg_get_viewdef('registry.maturity_read'::regclass) !~ 'maturity_inspection\y'
  AND pg_get_viewdef('registry.portfolio_line'::regclass) !~ 'maturity_inspection\y'));

SELECT pg_temp.check('11: a superseded displayed date appears nowhere in the product', (
  SELECT EXISTS (SELECT 1 FROM obs.maturity_inspection
                 WHERE position_observation_id = pg_temp.fx('po_shared') AND normalized_date = DATE '2099-09-10')
     AND NOT EXISTS (SELECT 1 FROM registry.maturity_position WHERE maturity_date = DATE '2099-09-10')
     AND NOT EXISTS (SELECT 1 FROM registry.portfolio_line WHERE maturity_date = DATE '2099-09-10')));

SELECT pg_temp.check('11: an UNRESOLVED inspection never supplies a candidate date', NOT EXISTS (
  SELECT 1 FROM registry.maturity_position WHERE maturity_date IN (DATE '2099-07-08', DATE '2099-08-09', DATE '2099-03-04')));

SELECT pg_temp.check('wall coverage counts structured and filing lines and keeps unknown and unresolved apart', (
  SELECT count(*) = 1
     AND bool_and(disclosed_line_count = 11)
     AND bool_and(maturity_reported_count = 3)
     AND bool_and(maturity_structured_count = 2)
     AND bool_and(maturity_filing_count = 1)
     AND bool_and(maturity_unknown_count = 6)
     AND bool_and(maturity_unresolved_count = 2)
  FROM registry.maturity_coverage('9999999901')
  WHERE NOT EXISTS (
    SELECT reported_date, disclosed_line_count, maturity_reported_count, maturity_structured_count,
           maturity_filing_count, maturity_unknown_count, maturity_unresolved_count
    FROM registry.maturity_reported_date WHERE registrant_cik = '9999999901'
    EXCEPT
    SELECT reported_date, disclosed_line_count, maturity_reported_count, maturity_structured_count,
           maturity_filing_count, maturity_unknown_count, maturity_unresolved_count
    FROM registry.maturity_coverage('9999999901'))));

SELECT pg_temp.check('dated lines are counted by year; unknown and unresolved lines have no year', (
  SELECT (SELECT count(*) = 1 AND bool_and(maturity_year = 2099 AND disclosed_line_count = 3)
          FROM registry.maturity_years('9999999901'))
     AND (SELECT count(*) = 1 AND bool_and(maturity_year = 2099 AND disclosed_line_count = 3)
          FROM registry.maturity_year WHERE registrant_cik = '9999999901')
     AND registry.maturity_line_count('9999999901', '2099-12-31', 'year', 2099) = 3
     AND registry.maturity_line_count('9999999901', '2099-12-31', 'unknown', NULL) = 6
     AND registry.maturity_line_count('9999999901', '2099-12-31', 'unresolved', NULL) = 2
     AND registry.maturity_line_count('9999999901', '2099-12-31', 'multiple', NULL) = 0));

SELECT pg_temp.check('MATURITY_DATE holds only the structured rows written here', (
  SELECT count(*) = 3 FROM obs.position_field_value WHERE field_code = 'MATURITY_DATE'));

SELECT pg_temp.expect_ok('reader can select the maturity read contract', ARRAY[
  'SET ROLE bdc_reader',
  'SELECT count(*) FROM registry.maturity_read',
  'RESET ROLE']);
