-- Group 37: month-precision maturity (migrations 0037 and 0038).
-- Obviously fake contexts, facts, and 2099-range dates. No production filing.
-- An existing unresolved inspection stays in place when a later inspection supersedes it.

WITH i AS (
  INSERT INTO raw.artifact (source_url, final_url, source_type_code, http_status, byte_size, sha256, retrieved_at, storage_key, run_id)
  VALUES ('https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000001/test-month.htm',
          'https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000001/test-month.htm',
          'SEC_FILING_DOCUMENT', 200, 1, repeat('f', 64), '2099-01-05T00:00:00Z', 'test-only/maturity-month', pg_temp.fx('run'))
  RETURNING id
) INSERT INTO fx SELECT 'artifact_month', id FROM i;

WITH i AS (
  INSERT INTO registry.filing_document (filing_id, document_name, document_url, named_by, rule_version_id, run_id, evidence_id)
  VALUES (pg_temp.fx('filing'), 'test-month.htm',
          'https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000001/test-month.htm',
          'FILING_INDEX_JSON', pg_temp.fx('r_project'), pg_temp.fx('run'), pg_temp.fx('e_sub'))
  RETURNING id
) INSERT INTO fx SELECT 'filing_doc_month', id FROM i;

INSERT INTO registry.filing_document_artifact (filing_document_id, artifact_id, run_id)
VALUES (pg_temp.fx('filing_doc_month'), pg_temp.fx('artifact_month'), pg_temp.fx('run'));

WITH i AS (
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_anchor, run_id)
  VALUES ('L2_ORIGINAL_FILING', pg_temp.fx('artifact_month'), 'HTML_ANCHOR', 'ix-context-row:c-1', pg_temp.fx('run'))
  RETURNING id
) INSERT INTO fx SELECT 'e_month_anchor', id FROM i;

WITH i AS (
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, ixbrl_fact_id, run_id)
  VALUES ('L2_ORIGINAL_FILING', pg_temp.fx('artifact_month'), 'IXBRL_FACT', 'f-month', pg_temp.fx('run'))
  RETURNING id
) INSERT INTO fx SELECT 'e_month_fact', id FROM i;

CREATE FUNCTION pg_temp.add_month_position(key text, rule_key text) RETURNS void
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
  INSERT INTO validation.validation_result (subject_table, subject_id, rule_version_id, outcome, detail, evidence_id, run_id)
  VALUES ('obs.position_observation', po, pg_temp.fx('r_validate'), 'PASS', 'c-1', pg_temp.fx('e_month_fact'), pg_temp.fx('run'));
  PERFORM pg_temp.put(key, po);
  PERFORM pg_temp.put(key || '_origin', soi);
END
$$;

CREATE FUNCTION pg_temp.inspect_month(key text, state text, raw text, displayed date, year integer, month integer, prior bigint) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  inserted bigint;
BEGIN
  INSERT INTO obs.maturity_inspection (
      position_observation_id, soi_row_observation_id, inspection_state, filing_context_id,
      raw_value, normalized_date, displayed_year, displayed_month, evidence_id, rule_version_id, run_id,
      supersedes_id, supersede_reason)
  VALUES (
      pg_temp.fx(key), pg_temp.fx(key || '_origin'), state::ref.maturity_inspection_state, 'c-1',
      raw, displayed, year, month, pg_temp.fx('e_month_anchor'), pg_temp.fx('r_validate'), pg_temp.fx('run'),
      prior, CASE WHEN prior IS NOT NULL THEN 'TEST ONLY: newer inspection' END)
  RETURNING id INTO inserted;
  RETURN inserted;
END
$$;

CREATE FUNCTION pg_temp.month_field(key text, raw text, year integer, month integer) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO obs.position_field_value (
      position_observation_id, field_code, raw_value, date_precision, normalized_year, normalized_month,
      currency_state, scale_state, value_state, normalization_rule_version_id, evidence_id, run_id)
  VALUES (pg_temp.fx(key), 'MATURITY_DATE', raw, 'MONTH', year, month,
          'UNKNOWN', 'NOT_APPLICABLE', 'REPORTED', pg_temp.fx('r_field'), pg_temp.fx('e_month_anchor'), pg_temp.fx('run'))
$$;

CREATE FUNCTION pg_temp.day_field(key text, raw text, value date) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO obs.position_field_value (
      position_observation_id, field_code, raw_value, normalized_date,
      currency_state, scale_state, value_state, normalization_rule_version_id, evidence_id, run_id)
  VALUES (pg_temp.fx(key), 'MATURITY_DATE', raw, value,
          'UNKNOWN', 'NOT_APPLICABLE', 'REPORTED', pg_temp.fx('r_field'), pg_temp.fx('e_month_anchor'), pg_temp.fx('run'))
$$;

SELECT pg_temp.add_month_position('day', 'r_project2');
SELECT pg_temp.add_month_position('filing_month', 'r_parser');
SELECT pg_temp.add_month_position('reported_month', 'r_field');
SELECT pg_temp.add_month_position('structured', 'r_classify');
SELECT pg_temp.add_month_position('unavailable', 'r_group');
SELECT pg_temp.add_month_position('run45', 'r_resolve');
SELECT pg_temp.add_month_position('agree', 'r_coverage');
SELECT pg_temp.add_month_position('disagree', 'r_mapping');
SELECT pg_temp.add_month_position('day_month', 'r_metric');

SELECT pg_temp.inspect_month('day', 'FILING_DISPLAYED', '4/13/2097', DATE '2097-04-13', NULL, NULL, NULL);
SELECT pg_temp.inspect_month('filing_month', 'FILING_MONTH', '12/2098', NULL, 2098, 12, NULL);
SELECT pg_temp.month_field('reported_month', '3/2096', 2096, 3);
SELECT pg_temp.day_field('structured', '5/6/2095', DATE '2095-05-06');
SELECT pg_temp.inspect_month('unavailable', 'UNAVAILABLE', NULL, NULL, NULL, NULL, NULL);
SELECT pg_temp.put('run45_old', pg_temp.inspect_month('run45', 'UNRESOLVED', NULL, NULL, NULL, NULL, NULL));
SELECT pg_temp.inspect_month('run45', 'FILING_MONTH', '11/2094', NULL, 2094, 11, pg_temp.fx('run45_old'));
SELECT pg_temp.month_field('agree', '6/2093', 2093, 6);
SELECT pg_temp.inspect_month('agree', 'FILING_MONTH', '6/2093', NULL, 2093, 6, NULL);
SELECT pg_temp.month_field('disagree', '1/2092', 2092, 1);
SELECT pg_temp.inspect_month('disagree', 'FILING_MONTH', '2/2092', NULL, 2092, 2, NULL);
SELECT pg_temp.day_field('day_month', '1/2/2091', DATE '2091-01-02');
SELECT pg_temp.inspect_month('day_month', 'FILING_MONTH', '1/2091', NULL, 2091, 1, NULL);

SELECT pg_temp.check('a calendar-day filing maturity stays FILING_DISPLAYED', (
  SELECT provenance_state = 'FILING_DISPLAYED'
     AND maturity_date = DATE '2097-04-13'
     AND maturity_raw = '4/13/2097'
     AND maturity_precision IS NULL
     AND maturity_year IS NULL
     AND maturity_month IS NULL
     AND NOT filing_verified
  FROM obs.maturity_provenance WHERE position_observation_id = pg_temp.fx('day')));

SELECT pg_temp.check('a filing month keeps the year and month and no calendar day', (
  SELECT provenance_state = 'FILING_MONTH'
     AND maturity_date IS NULL
     AND maturity_raw = '12/2098'
     AND maturity_precision = 'MONTH'
     AND maturity_year = 2098
     AND maturity_month = 12
     AND NOT filing_verified
     AND displayed_date IS NULL
  FROM obs.maturity_provenance WHERE position_observation_id = pg_temp.fx('filing_month')));

SELECT pg_temp.check('the reader matches provenance for a filing month and does not invent a day', (
  SELECT maturity_source = 'FILING_MONTH'
     AND maturity_date IS NULL
     AND maturity_raw = '12/2098'
     AND maturity_precision = 'MONTH'
     AND maturity_year = 2098
     AND maturity_month = 12
     AND NOT filing_verified
     AND maturity_document_url LIKE '%/test-month.htm'
     AND maturity_raw IS DISTINCT FROM '2098-12-01'
     AND maturity_raw IS DISTINCT FROM '2098-12-31'
  FROM registry.maturity_read WHERE position_observation_id = pg_temp.fx('filing_month')));

SELECT pg_temp.check('a structured month with no inspection is REPORTED_MONTH', (
  SELECT p.provenance_state = 'REPORTED_MONTH'
     AND p.maturity_date IS NULL
     AND p.maturity_raw = '3/2096'
     AND p.maturity_precision = 'MONTH'
     AND p.maturity_year = 2096
     AND p.maturity_month = 3
     AND p.inspection_id IS NULL
     AND NOT p.filing_verified
     AND r.maturity_source = 'REPORTED_MONTH'
     AND r.maturity_date IS NULL
     AND r.maturity_document_url IS NULL
  FROM obs.maturity_provenance p
  JOIN registry.maturity_read r ON r.position_observation_id = p.position_observation_id
  WHERE p.position_observation_id = pg_temp.fx('reported_month')));

SELECT pg_temp.check('a structured calendar day stays REPORTED_STRUCTURED', (
  SELECT provenance_state = 'REPORTED_STRUCTURED'
     AND maturity_date = DATE '2095-05-06'
     AND maturity_raw = '5/6/2095'
     AND maturity_precision IS NULL
     AND maturity_year IS NULL
     AND NOT filing_verified
  FROM obs.maturity_provenance WHERE position_observation_id = pg_temp.fx('structured')));

SELECT pg_temp.check('an inspected row with no maturity stays UNKNOWN', (
  SELECT provenance_state = 'UNKNOWN'
     AND inspection_state = 'UNAVAILABLE'
     AND maturity_date IS NULL
     AND maturity_raw IS NULL
     AND maturity_precision IS NULL
  FROM obs.maturity_provenance WHERE position_observation_id = pg_temp.fx('unavailable')));

SELECT pg_temp.check('a later filing month supersedes an unresolved row and leaves that row unchanged', (
  SELECT old.inspection_state = 'UNRESOLVED'
     AND old.raw_value IS NULL
     AND old.normalized_date IS NULL
     AND old.displayed_year IS NULL
     AND old.displayed_month IS NULL
     AND new.inspection_state = 'FILING_MONTH'
     AND new.supersedes_id = old.id
     AND new.raw_value = '11/2094'
     AND new.normalized_date IS NULL
     AND new.displayed_year = 2094
     AND new.displayed_month = 11
     AND p.provenance_state = 'FILING_MONTH'
     AND p.inspection_id = new.id
     AND p.maturity_date IS NULL
  FROM obs.maturity_inspection old
  JOIN obs.maturity_inspection new ON new.supersedes_id = old.id
  JOIN obs.maturity_provenance p ON p.position_observation_id = old.position_observation_id
  WHERE old.id = pg_temp.fx('run45_old')));

SELECT pg_temp.expect_error('the superseded unresolved row cannot be updated', 'BDCA1', ARRAY[format(
  $$UPDATE obs.maturity_inspection SET raw_value = '11/2094' WHERE id = %s$$, pg_temp.fx('run45_old'))]);

SELECT pg_temp.check('an agreeing filing month stays REPORTED_MONTH and filing_verified stays false', (
  SELECT provenance_state = 'REPORTED_MONTH'
     AND maturity_date IS NULL
     AND maturity_raw = '6/2093'
     AND maturity_year = 2093
     AND maturity_month = 6
     AND inspection_state = 'FILING_MONTH'
     AND NOT filing_verified
  FROM obs.maturity_provenance WHERE position_observation_id = pg_temp.fx('agree')));

SELECT pg_temp.check('unequal months stay unresolved', (
  SELECT provenance_state = 'UNRESOLVED' AND maturity_date IS NULL AND maturity_raw IS NULL AND maturity_precision IS NULL
  FROM obs.maturity_provenance WHERE position_observation_id = pg_temp.fx('disagree')));

SELECT pg_temp.check('a calendar day and a filing month stay unresolved', (
  SELECT provenance_state = 'UNRESOLVED' AND maturity_date IS NULL AND maturity_raw IS NULL
  FROM obs.maturity_provenance WHERE position_observation_id = pg_temp.fx('day_month')));

SELECT pg_temp.check('month rows stay out of the calendar-date year counts', (
  SELECT NOT EXISTS (
    SELECT 1 FROM registry.maturity_year
    WHERE registrant_cik = '9999999901' AND maturity_year IN (2098, 2096, 2094, 2093)
  )
  AND EXISTS (
    SELECT 1 FROM registry.maturity_year
    WHERE registrant_cik = '9999999901' AND maturity_year = 2097 AND disclosed_line_count = 1
  )
  AND EXISTS (
    SELECT 1 FROM registry.maturity_year
    WHERE registrant_cik = '9999999901' AND maturity_year = 2095 AND disclosed_line_count = 1
  )));

SELECT pg_temp.check('the year view still counts only rows with a calendar maturity_date',
  position('maturity_date IS NOT NULL' IN pg_get_viewdef('registry.maturity_year'::regclass)) > 0);

SELECT pg_temp.expect_error('FILING_MONTH cannot store a calendar date', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.maturity_inspection (position_observation_id, soi_row_observation_id, inspection_state,
      filing_context_id, raw_value, normalized_date, displayed_year, displayed_month, evidence_id, rule_version_id, run_id,
      supersedes_id, supersede_reason)
    SELECT %s, %s, 'FILING_MONTH', 'c-1', '12/2098', DATE '2098-12-01', 2098, 12, %s, %s, %s, i.id, 'TEST ONLY'
    FROM obs.maturity_inspection i WHERE i.position_observation_id = %s$$,
  pg_temp.fx('filing_month'), pg_temp.fx('filing_month_origin'), pg_temp.fx('e_month_anchor'),
  pg_temp.fx('r_validate'), pg_temp.fx('run'), pg_temp.fx('filing_month'))]);

SELECT pg_temp.expect_error('FILING_MONTH displayed month must equal the raw month', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.maturity_inspection (position_observation_id, soi_row_observation_id, inspection_state,
      filing_context_id, raw_value, displayed_year, displayed_month, evidence_id, rule_version_id, run_id,
      supersedes_id, supersede_reason)
    SELECT %s, %s, 'FILING_MONTH', 'c-1', '12/2098', 2098, 11, %s, %s, %s, i.id, 'TEST ONLY'
    FROM obs.maturity_inspection i WHERE i.position_observation_id = %s$$,
  pg_temp.fx('filing_month'), pg_temp.fx('filing_month_origin'), pg_temp.fx('e_month_anchor'),
  pg_temp.fx('r_validate'), pg_temp.fx('run'), pg_temp.fx('filing_month'))]);

SELECT pg_temp.expect_error('a calendar-day inspection cannot store a displayed month', '23514', ARRAY[format(
  $$INSERT INTO obs.maturity_inspection (position_observation_id, soi_row_observation_id, inspection_state,
      filing_context_id, raw_value, normalized_date, displayed_year, displayed_month, evidence_id, rule_version_id, run_id,
      supersedes_id, supersede_reason)
    SELECT %s, %s, 'FILING_DISPLAYED', 'c-1', '4/13/2097', DATE '2097-04-13', 2097, 4, %s, %s, %s, i.id, 'TEST ONLY'
    FROM obs.maturity_inspection i WHERE i.position_observation_id = %s$$,
  pg_temp.fx('day'), pg_temp.fx('day_origin'), pg_temp.fx('e_month_anchor'),
  pg_temp.fx('r_validate'), pg_temp.fx('run'), pg_temp.fx('day'))]);

SELECT pg_temp.expect_error('a filing month cannot carry candidates', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.maturity_inspection_candidate (maturity_inspection_id, raw_value, evidence_id, run_id)
    SELECT i.id, '12/2098', %s, %s FROM obs.maturity_inspection i
    WHERE i.position_observation_id = %s AND i.inspection_state = 'FILING_MONTH'$$,
  pg_temp.fx('e_month_fact'), pg_temp.fx('run'), pg_temp.fx('filing_month'))]);

SELECT pg_temp.put('month_case', review.open_candidate(
  'test-filing-month', 'BORROWER', 'MANUAL_SEED', 'TEST SOURCE CASE', 'TEST RESEARCHER'));
SELECT review.add_member(pg_temp.fx('month_case'), pg_temp.fx('filing_month'), NULL, 'TEST RESEARCHER');
SELECT review.add_member(pg_temp.fx('month_case'), pg_temp.fx('reported_month'), NULL, 'TEST RESEARCHER');

SELECT pg_temp.check('the review case stays open', (
  SELECT status = 'OPEN' FROM review.current_candidate WHERE candidate_id = pg_temp.fx('month_case')));

CREATE TEMP TABLE month_review (payload json);

INSERT INTO month_review SELECT registry.review_case_read('test-filing-month');

SELECT pg_temp.check('review reads a filing month and a structured month without a calendar day', (
  SELECT count(*) = 2
     AND bool_or(item->>'maturity_source' = 'FILING_MONTH' AND item->>'maturity_raw' = '12/2098')
     AND bool_or(item->>'maturity_source' = 'REPORTED_MONTH' AND item->>'maturity_raw' = '3/2096')
     AND bool_and(item->>'maturity_raw' IS DISTINCT FROM '2098-12-01')
     AND bool_and(item->>'maturity_raw' IS DISTINCT FROM '2096-03-01')
  FROM month_review, jsonb_array_elements(payload::jsonb->'maturity') item
));
