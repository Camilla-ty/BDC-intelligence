-- Group 28: maturity inspection provenance (migration 0023).
-- Obviously fake context c-1, fact f-1, and date 1/2/2099. No production filing.

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
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_anchor, run_id)
  VALUES ('L2_ORIGINAL_FILING', pg_temp.fx('artifact_maturity'), 'HTML_ANCHOR', 'ix-context-row:c-1', pg_temp.fx('run'))
  RETURNING id
) INSERT INTO fx SELECT 'e_anchor', id FROM i;

WITH i AS (
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, ixbrl_fact_id, run_id)
  VALUES ('L2_ORIGINAL_FILING', pg_temp.fx('artifact_maturity'), 'IXBRL_FACT', 'f-1', pg_temp.fx('run'))
  RETURNING id
) INSERT INTO fx SELECT 'e_fact', id FROM i;

WITH i AS (
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_anchor, run_id)
  VALUES ('L2_ORIGINAL_FILING', pg_temp.fx('artifact_maturity'), 'HTML_ANCHOR', 'ix-context-row:c-other', pg_temp.fx('run'))
  RETURNING id
) INSERT INTO fx SELECT 'e_anchor_other', id FROM i;

WITH i AS (
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, ixbrl_fact_id, run_id)
  VALUES ('L2_ORIGINAL_FILING', pg_temp.fx('artifact_maturity'), 'IXBRL_FACT', 'f-other', pg_temp.fx('run'))
  RETURNING id
) INSERT INTO fx SELECT 'e_fact_other', id FROM i;

INSERT INTO validation.validation_result (subject_table, subject_id, rule_version_id, outcome, detail, evidence_id, run_id)
VALUES ('obs.position_observation', pg_temp.fx('po_a'), pg_temp.fx('r_validate'), 'PASS', 'c-1', pg_temp.fx('e_fact'), pg_temp.fx('run')),
       ('obs.position_observation', pg_temp.fx('po_b'), pg_temp.fx('r_validate'), 'PASS', 'c-1', pg_temp.fx('e_fact'), pg_temp.fx('run'));

SELECT pg_temp.check('a position with no inspection and no structured maturity is UNKNOWN', (
  SELECT provenance_state = 'UNKNOWN' AND inspection_id IS NULL AND structured_date IS NULL
  FROM obs.maturity_provenance WHERE position_observation_id = pg_temp.fx('po_a')));

SELECT pg_temp.check('the maturity wall reads inspections only through the provenance contract',
  pg_get_viewdef('registry.maturity_position'::regclass) !~ 'maturity_inspection\y'
  AND position('maturity_read' IN pg_get_viewdef('registry.maturity_position'::regclass)) > 0);

SELECT pg_temp.expect_ok('FILING_DISPLAYED records the displayed date without a field value', ARRAY[format(
  $$INSERT INTO obs.maturity_inspection (position_observation_id, soi_row_observation_id, inspection_state,
      filing_context_id, raw_value, normalized_date, evidence_id, rule_version_id, run_id)
    VALUES (%s, %s, 'FILING_DISPLAYED', 'c-1', '1/2/2099', DATE '2099-01-02', %s, %s, %s)$$,
  pg_temp.fx('po_a'), pg_temp.fx('soi_a'), pg_temp.fx('e_anchor'), pg_temp.fx('r_validate'), pg_temp.fx('run'))]);

SELECT pg_temp.check('provenance is FILING_DISPLAYED and structured maturity stays absent', (
  SELECT provenance_state = 'FILING_DISPLAYED'
     AND filing_context_id = 'c-1'
     AND displayed_raw = '1/2/2099'
     AND displayed_date = DATE '2099-01-02'
     AND structured_date IS NULL
  FROM obs.maturity_provenance WHERE position_observation_id = pg_temp.fx('po_a')));

SELECT pg_temp.check('the displayed date did not become a MATURITY_DATE field value', (
  SELECT count(*) = 0 FROM obs.position_field_value
  WHERE position_observation_id = pg_temp.fx('po_a') AND field_code = 'MATURITY_DATE'));

SELECT pg_temp.check('position field status still reads the missing structured date as UNKNOWN', (
  SELECT value_state = 'UNKNOWN' AND field_value_id IS NULL
  FROM obs.position_field_status
  WHERE position_observation_id = pg_temp.fx('po_a') AND field_code = 'MATURITY_DATE'));

SELECT pg_temp.expect_error('another context anchor cannot satisfy this inspection', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.maturity_inspection (position_observation_id, soi_row_observation_id, inspection_state,
      filing_context_id, raw_value, normalized_date, evidence_id, rule_version_id, run_id, supersedes_id, supersede_reason)
    SELECT %s, %s, 'FILING_DISPLAYED', 'c-1', '1/2/2099', DATE '2099-01-02', %s, %s, %s, i.id, 'TEST ONLY'
    FROM obs.maturity_inspection i WHERE i.position_observation_id = %s$$,
  pg_temp.fx('po_a'), pg_temp.fx('soi_a'), pg_temp.fx('e_anchor_other'), pg_temp.fx('r_validate'), pg_temp.fx('run'), pg_temp.fx('po_a'))]);

SELECT pg_temp.expect_error('a context without a validated fact cannot satisfy this inspection', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.maturity_inspection (position_observation_id, soi_row_observation_id, inspection_state,
      filing_context_id, raw_value, normalized_date, evidence_id, rule_version_id, run_id, supersedes_id, supersede_reason)
    SELECT %s, %s, 'FILING_DISPLAYED', 'c-other', '1/2/2099', DATE '2099-01-02', %s, %s, %s, i.id, 'TEST ONLY'
    FROM obs.maturity_inspection i WHERE i.position_observation_id = %s$$,
  pg_temp.fx('po_a'), pg_temp.fx('soi_a'), pg_temp.fx('e_anchor_other'), pg_temp.fx('r_validate'), pg_temp.fx('run'), pg_temp.fx('po_a'))]);

SELECT pg_temp.expect_error('a normalized date that differs from the displayed text is rejected', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.maturity_inspection (position_observation_id, soi_row_observation_id, inspection_state,
      filing_context_id, raw_value, normalized_date, evidence_id, rule_version_id, run_id, supersedes_id, supersede_reason)
    SELECT %s, %s, 'FILING_DISPLAYED', 'c-1', '1/2/2099', DATE '2099-03-04', %s, %s, %s, i.id, 'TEST ONLY'
    FROM obs.maturity_inspection i WHERE i.position_observation_id = %s$$,
  pg_temp.fx('po_a'), pg_temp.fx('soi_a'), pg_temp.fx('e_anchor'), pg_temp.fx('r_validate'), pg_temp.fx('run'), pg_temp.fx('po_a'))]);

SELECT pg_temp.expect_error('L1 evidence cannot support FILING_DISPLAYED', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.maturity_inspection (position_observation_id, soi_row_observation_id, inspection_state,
      filing_context_id, raw_value, normalized_date, evidence_id, rule_version_id, run_id, supersedes_id, supersede_reason)
    SELECT %s, %s, 'FILING_DISPLAYED', 'c-1', '1/2/2099', DATE '2099-01-02', %s, %s, %s, i.id, 'TEST ONLY'
    FROM obs.maturity_inspection i WHERE i.position_observation_id = %s$$,
  pg_temp.fx('po_a'), pg_temp.fx('soi_a'), pg_temp.fx('e_soi_a'), pg_temp.fx('r_validate'), pg_temp.fx('run'), pg_temp.fx('po_a'))]);

SELECT pg_temp.check('a position that was not inspected stays UNKNOWN', (
  SELECT provenance_state = 'UNKNOWN' AND inspection_id IS NULL
  FROM obs.maturity_provenance WHERE position_observation_id = pg_temp.fx('po_b')));

SELECT pg_temp.expect_ok('UNAVAILABLE records an inspected row with no displayed date', ARRAY[format(
  $$INSERT INTO obs.maturity_inspection (position_observation_id, soi_row_observation_id, inspection_state,
      filing_context_id, evidence_id, rule_version_id, run_id)
    VALUES (%s, %s, 'UNAVAILABLE', 'c-1', %s, %s, %s)$$,
  pg_temp.fx('po_b'), pg_temp.fx('soi_b'), pg_temp.fx('e_anchor'), pg_temp.fx('r_validate'), pg_temp.fx('run'))]);

SELECT pg_temp.check('an UNAVAILABLE inspection leaves the maturity UNKNOWN with no structured maturity', (
  SELECT provenance_state = 'UNKNOWN' AND inspection_state = 'UNAVAILABLE'
     AND maturity_date IS NULL AND displayed_date IS NULL AND structured_date IS NULL
  FROM obs.maturity_provenance WHERE position_observation_id = pg_temp.fx('po_b')));

INSERT INTO fx
SELECT 'insp_unavail', i.id FROM obs.maturity_inspection i
WHERE i.position_observation_id = pg_temp.fx('po_b') AND i.inspection_state = 'UNAVAILABLE';

SELECT pg_temp.expect_ok('UNRESOLVED supersedes UNAVAILABLE without choosing a date', ARRAY[format(
  $$INSERT INTO obs.maturity_inspection (position_observation_id, soi_row_observation_id, inspection_state,
      filing_context_id, evidence_id, rule_version_id, run_id, supersedes_id, supersede_reason)
    VALUES (%s, %s, 'UNRESOLVED', 'c-1', %s, %s, %s, %s, 'TEST ONLY: two displayed dates')$$,
  pg_temp.fx('po_b'), pg_temp.fx('soi_b'), pg_temp.fx('e_anchor'), pg_temp.fx('r_validate'), pg_temp.fx('run'),
  pg_temp.fx('insp_unavail'))]);

INSERT INTO fx
SELECT 'insp_unresolved', i.id FROM obs.maturity_inspection i
WHERE i.position_observation_id = pg_temp.fx('po_b') AND i.inspection_state = 'UNRESOLVED';

INSERT INTO obs.maturity_inspection_candidate (maturity_inspection_id, raw_value, normalized_date, evidence_id, run_id)
VALUES (pg_temp.fx('insp_unresolved'), '1/2/2099', DATE '2099-01-02', pg_temp.fx('e_fact'), pg_temp.fx('run')),
       (pg_temp.fx('insp_unresolved'), '3/4/2099', DATE '2099-03-04', pg_temp.fx('e_fact_other'), pg_temp.fx('run'));

SELECT pg_temp.check('UNRESOLVED keeps both candidates and does not select a date', (
  SELECT p.provenance_state = 'UNRESOLVED' AND p.displayed_date IS NULL
     AND (SELECT count(*) FROM obs.maturity_inspection_candidate c WHERE c.maturity_inspection_id = p.inspection_id) = 2
  FROM obs.maturity_provenance p WHERE p.position_observation_id = pg_temp.fx('po_b')));

SELECT pg_temp.expect_error('a candidate cannot be attached to FILING_DISPLAYED', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.maturity_inspection_candidate (maturity_inspection_id, raw_value, evidence_id, run_id)
    SELECT i.id, '1/2/2099', %s, %s FROM obs.maturity_inspection i
    WHERE i.position_observation_id = %s AND i.inspection_state = 'FILING_DISPLAYED'$$,
  pg_temp.fx('e_fact'), pg_temp.fx('run'), pg_temp.fx('po_a'))]);

SELECT pg_temp.expect_ok('a structured maturity date is REPORTED_STRUCTURED when no inspection disagrees', ARRAY[format(
  $$INSERT INTO obs.position_field_value (position_observation_id, field_code, raw_value, normalized_date,
      currency_state, scale_state, value_state, normalization_rule_version_id, evidence_id, run_id)
    VALUES (%s, 'MATURITY_DATE', '1/2/2099', DATE '2099-01-02', 'UNKNOWN', 'NOT_APPLICABLE', 'REPORTED', %s, %s, %s)$$,
  pg_temp.fx('po_a'), pg_temp.fx('r_field'), pg_temp.fx('e_anchor'), pg_temp.fx('run'))]);

SELECT pg_temp.check('agreement between the structured date and the displayed date is REPORTED_STRUCTURED', (
  SELECT provenance_state = 'REPORTED_STRUCTURED'
     AND structured_date = DATE '2099-01-02'
     AND displayed_date = DATE '2099-01-02'
  FROM obs.maturity_provenance WHERE position_observation_id = pg_temp.fx('po_a')));

SELECT pg_temp.check('the portfolio listing and the year counts read inspections only through the provenance contract',
  pg_get_viewdef('registry.portfolio_line'::regclass) !~ 'maturity_inspection\y'
  AND pg_get_viewdef('registry.maturity_year'::regclass) !~ 'maturity_inspection\y'
  AND position('maturity_read' IN pg_get_viewdef('registry.portfolio_line'::regclass)) > 0);
