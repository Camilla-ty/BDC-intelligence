-- Group 29: maturity inspection NOT_BOUND (migration 0024).
-- Obviously fake context c-1, fact f-1, and date 1/2/2099. No production filing.

WITH i AS (
  INSERT INTO raw.artifact (source_url, final_url, source_type_code, http_status, byte_size, sha256, retrieved_at, storage_key, run_id)
  VALUES ('https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000001/test-maturity.htm',
          'https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000001/test-maturity.htm',
          'SEC_FILING_DOCUMENT', 200, 1, repeat('d', 64), '2099-01-03T00:00:00Z', 'test-only/maturity-doc', pg_temp.fx('run'))
  RETURNING id
) INSERT INTO fx SELECT 'artifact_maturity', id FROM i;

WITH i AS (
  INSERT INTO raw.artifact (source_url, final_url, source_type_code, http_status, byte_size, sha256, retrieved_at, storage_key, run_id)
  VALUES ('https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000001/test-unlinked.htm',
          'https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000001/test-unlinked.htm',
          'SEC_FILING_DOCUMENT', 200, 1, repeat('e', 64), '2099-01-03T00:00:00Z', 'test-only/unlinked-doc', pg_temp.fx('run'))
  RETURNING id
) INSERT INTO fx SELECT 'artifact_unlinked', id FROM i;

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
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, run_id)
  VALUES ('L2_ORIGINAL_FILING', pg_temp.fx('artifact_unlinked'), 'DOCUMENT', pg_temp.fx('run'))
  RETURNING id
) INSERT INTO fx SELECT 'e_doc_unlinked', id FROM i;

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

INSERT INTO validation.validation_result (subject_table, subject_id, rule_version_id, outcome, detail, evidence_id, run_id)
VALUES ('obs.position_observation', pg_temp.fx('po_a'), pg_temp.fx('r_validate'), 'FAIL', 'SHARED_ROW', pg_temp.fx('e_doc'), pg_temp.fx('run')),
       ('obs.position_observation', pg_temp.fx('po_b'), pg_temp.fx('r_validate'), 'PASS', 'c-1', pg_temp.fx('e_fact'), pg_temp.fx('run'));

SELECT pg_temp.expect_error('NOT_BOUND requires a no-bind reason', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.maturity_inspection (position_observation_id, soi_row_observation_id, inspection_state,
      evidence_id, rule_version_id, run_id)
    VALUES (%s, %s, 'NOT_BOUND', %s, %s, %s)$$,
  pg_temp.fx('po_a'), pg_temp.fx('soi_a'), pg_temp.fx('e_doc'), pg_temp.fx('r_validate'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('NOT_BOUND rejects a filing context', '23514', ARRAY[format(
  $$INSERT INTO obs.maturity_inspection (position_observation_id, soi_row_observation_id, inspection_state,
      no_bind_reason, filing_context_id, evidence_id, rule_version_id, run_id)
    VALUES (%s, %s, 'NOT_BOUND', 'SHARED_ROW', 'c-1', %s, %s, %s)$$,
  pg_temp.fx('po_a'), pg_temp.fx('soi_a'), pg_temp.fx('e_doc'), pg_temp.fx('r_validate'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('NOT_BOUND rejects a raw value', '23514', ARRAY[format(
  $$INSERT INTO obs.maturity_inspection (position_observation_id, soi_row_observation_id, inspection_state,
      no_bind_reason, raw_value, evidence_id, rule_version_id, run_id)
    VALUES (%s, %s, 'NOT_BOUND', 'SHARED_ROW', '1/2/2099', %s, %s, %s)$$,
  pg_temp.fx('po_a'), pg_temp.fx('soi_a'), pg_temp.fx('e_doc'), pg_temp.fx('r_validate'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('NOT_BOUND rejects a normalized date', '23514', ARRAY[format(
  $$INSERT INTO obs.maturity_inspection (position_observation_id, soi_row_observation_id, inspection_state,
      no_bind_reason, normalized_date, evidence_id, rule_version_id, run_id)
    VALUES (%s, %s, 'NOT_BOUND', 'SHARED_ROW', DATE '2099-01-02', %s, %s, %s)$$,
  pg_temp.fx('po_a'), pg_temp.fx('soi_a'), pg_temp.fx('e_doc'), pg_temp.fx('r_validate'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('NOT_BOUND cannot use a filing-context anchor as evidence', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.maturity_inspection (position_observation_id, soi_row_observation_id, inspection_state,
      no_bind_reason, evidence_id, rule_version_id, run_id)
    VALUES (%s, %s, 'NOT_BOUND', 'SHARED_ROW', %s, %s, %s)$$,
  pg_temp.fx('po_a'), pg_temp.fx('soi_a'), pg_temp.fx('e_anchor'), pg_temp.fx('r_validate'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('NOT_BOUND evidence must be a document of the position filing', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.maturity_inspection (position_observation_id, soi_row_observation_id, inspection_state,
      no_bind_reason, evidence_id, rule_version_id, run_id)
    VALUES (%s, %s, 'NOT_BOUND', 'SHARED_ROW', %s, %s, %s)$$,
  pg_temp.fx('po_a'), pg_temp.fx('soi_a'), pg_temp.fx('e_doc_unlinked'), pg_temp.fx('r_validate'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('L1 evidence cannot support NOT_BOUND', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.maturity_inspection (position_observation_id, soi_row_observation_id, inspection_state,
      no_bind_reason, evidence_id, rule_version_id, run_id)
    VALUES (%s, %s, 'NOT_BOUND', 'SHARED_ROW', %s, %s, %s)$$,
  pg_temp.fx('po_a'), pg_temp.fx('soi_a'), pg_temp.fx('e_soi_a'), pg_temp.fx('r_validate'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('NOT_BOUND needs a FAIL validation whose detail is the same reason', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.maturity_inspection (position_observation_id, soi_row_observation_id, inspection_state,
      no_bind_reason, evidence_id, rule_version_id, run_id)
    VALUES (%s, %s, 'NOT_BOUND', 'NO_MATCH', %s, %s, %s)$$,
  pg_temp.fx('po_a'), pg_temp.fx('soi_a'), pg_temp.fx('e_doc'), pg_temp.fx('r_validate'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('NOT_BOUND needs the FAIL validation of the same rule version', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.maturity_inspection (position_observation_id, soi_row_observation_id, inspection_state,
      no_bind_reason, evidence_id, rule_version_id, run_id)
    VALUES (%s, %s, 'NOT_BOUND', 'SHARED_ROW', %s, %s, %s)$$,
  pg_temp.fx('po_a'), pg_temp.fx('soi_a'), pg_temp.fx('e_doc'), pg_temp.fx('r_field'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('a PASS validation cannot support NOT_BOUND', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.maturity_inspection (position_observation_id, soi_row_observation_id, inspection_state,
      no_bind_reason, evidence_id, rule_version_id, run_id)
    VALUES (%s, %s, 'NOT_BOUND', 'SHARED_ROW', %s, %s, %s)$$,
  pg_temp.fx('po_b'), pg_temp.fx('soi_b'), pg_temp.fx('e_doc'), pg_temp.fx('r_validate'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_ok('a first-ever NOT_BOUND is recorded without supersedes_id', ARRAY[format(
  $$INSERT INTO obs.maturity_inspection (position_observation_id, soi_row_observation_id, inspection_state,
      no_bind_reason, evidence_id, rule_version_id, run_id)
    VALUES (%s, %s, 'NOT_BOUND', 'SHARED_ROW', %s, %s, %s)$$,
  pg_temp.fx('po_a'), pg_temp.fx('soi_a'), pg_temp.fx('e_doc'), pg_temp.fx('r_validate'), pg_temp.fx('run'))]);

INSERT INTO fx
SELECT 'insp_not_bound_a', i.id FROM obs.maturity_inspection i
WHERE i.position_observation_id = pg_temp.fx('po_a') AND i.inspection_state = 'NOT_BOUND';

SELECT pg_temp.expect_error('a candidate cannot be attached to NOT_BOUND', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.maturity_inspection_candidate (maturity_inspection_id, raw_value, normalized_date, evidence_id, run_id)
    VALUES (%s, '1/2/2099', DATE '2099-01-02', %s, %s)$$,
  pg_temp.fx('insp_not_bound_a'), pg_temp.fx('e_fact'), pg_temp.fx('run'))]);

SELECT pg_temp.check('NOT_BOUND with no structured maturity is UNKNOWN and exposes the inspection', (
  SELECT provenance_state = 'UNKNOWN'
     AND inspection_state = 'NOT_BOUND'
     AND no_bind_reason = 'SHARED_ROW'
     AND inspection_id = pg_temp.fx('insp_not_bound_a')
     AND filing_context_id IS NULL
     AND displayed_date IS NULL
     AND structured_date IS NULL
  FROM obs.maturity_provenance WHERE position_observation_id = pg_temp.fx('po_a')));

SELECT pg_temp.expect_error('FILING_DISPLAYED rejects a no-bind reason', '23514', ARRAY[format(
  $$INSERT INTO obs.maturity_inspection (position_observation_id, soi_row_observation_id, inspection_state,
      filing_context_id, raw_value, normalized_date, no_bind_reason, evidence_id, rule_version_id, run_id)
    VALUES (%s, %s, 'FILING_DISPLAYED', 'c-1', '1/2/2099', DATE '2099-01-02', 'SHARED_ROW', %s, %s, %s)$$,
  pg_temp.fx('po_b'), pg_temp.fx('soi_b'), pg_temp.fx('e_anchor'), pg_temp.fx('r_validate'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('UNAVAILABLE rejects a no-bind reason', '23514', ARRAY[format(
  $$INSERT INTO obs.maturity_inspection (position_observation_id, soi_row_observation_id, inspection_state,
      filing_context_id, no_bind_reason, evidence_id, rule_version_id, run_id)
    VALUES (%s, %s, 'UNAVAILABLE', 'c-1', 'NO_MATCH', %s, %s, %s)$$,
  pg_temp.fx('po_b'), pg_temp.fx('soi_b'), pg_temp.fx('e_anchor'), pg_temp.fx('r_validate'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('UNRESOLVED rejects a no-bind reason', '23514', ARRAY[format(
  $$INSERT INTO obs.maturity_inspection (position_observation_id, soi_row_observation_id, inspection_state,
      filing_context_id, no_bind_reason, evidence_id, rule_version_id, run_id)
    VALUES (%s, %s, 'UNRESOLVED', 'c-1', 'MULTIPLE_ROWS', %s, %s, %s)$$,
  pg_temp.fx('po_b'), pg_temp.fx('soi_b'), pg_temp.fx('e_anchor'), pg_temp.fx('r_validate'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('bound states still require a filing context and its anchor', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.maturity_inspection (position_observation_id, soi_row_observation_id, inspection_state,
      evidence_id, rule_version_id, run_id)
    VALUES (%s, %s, 'UNAVAILABLE', %s, %s, %s)$$,
  pg_temp.fx('po_b'), pg_temp.fx('soi_b'), pg_temp.fx('e_anchor'), pg_temp.fx('r_validate'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_ok('FILING_DISPLAYED is recorded for position B', ARRAY[format(
  $$INSERT INTO obs.maturity_inspection (position_observation_id, soi_row_observation_id, inspection_state,
      filing_context_id, raw_value, normalized_date, evidence_id, rule_version_id, run_id)
    VALUES (%s, %s, 'FILING_DISPLAYED', 'c-1', '1/2/2099', DATE '2099-01-02', %s, %s, %s)$$,
  pg_temp.fx('po_b'), pg_temp.fx('soi_b'), pg_temp.fx('e_anchor'), pg_temp.fx('r_validate'), pg_temp.fx('run'))]);

INSERT INTO fx
SELECT 'insp_fd_b', i.id FROM obs.maturity_inspection i
WHERE i.position_observation_id = pg_temp.fx('po_b') AND i.inspection_state = 'FILING_DISPLAYED';

INSERT INTO validation.validation_result (subject_table, subject_id, rule_version_id, outcome, detail, evidence_id, run_id)
VALUES ('obs.position_observation', pg_temp.fx('po_b'), pg_temp.fx('r_validate'), 'FAIL', 'SHARED_ROW', pg_temp.fx('e_doc'), pg_temp.fx('run'));

SELECT pg_temp.expect_error('NOT_BOUND cannot start a second chain over a current inspection', 'BDCS1', ARRAY[format(
  $$INSERT INTO obs.maturity_inspection (position_observation_id, soi_row_observation_id, inspection_state,
      no_bind_reason, evidence_id, rule_version_id, run_id)
    VALUES (%s, %s, 'NOT_BOUND', 'SHARED_ROW', %s, %s, %s)$$,
  pg_temp.fx('po_b'), pg_temp.fx('soi_b'), pg_temp.fx('e_doc'), pg_temp.fx('r_validate'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_ok('NOT_BOUND supersedes FILING_DISPLAYED', ARRAY[format(
  $$INSERT INTO obs.maturity_inspection (position_observation_id, soi_row_observation_id, inspection_state,
      no_bind_reason, evidence_id, rule_version_id, run_id, supersedes_id, supersede_reason)
    VALUES (%s, %s, 'NOT_BOUND', 'SHARED_ROW', %s, %s, %s, %s, 'TEST ONLY: superseded by binder rule v2: SHARED_ROW')$$,
  pg_temp.fx('po_b'), pg_temp.fx('soi_b'), pg_temp.fx('e_doc'), pg_temp.fx('r_validate'), pg_temp.fx('run'),
  pg_temp.fx('insp_fd_b'))]);

SELECT pg_temp.check('the superseded FILING_DISPLAYED row stays in history unchanged', (
  SELECT count(*) = 1 FROM obs.maturity_inspection
  WHERE id = pg_temp.fx('insp_fd_b') AND inspection_state = 'FILING_DISPLAYED'
    AND filing_context_id = 'c-1' AND raw_value = '1/2/2099' AND normalized_date = DATE '2099-01-02'));

SELECT pg_temp.check('provenance hides the superseded displayed date', (
  SELECT provenance_state = 'UNKNOWN' AND inspection_state = 'NOT_BOUND'
     AND displayed_raw IS NULL AND displayed_date IS NULL AND filing_context_id IS NULL
  FROM obs.maturity_provenance WHERE position_observation_id = pg_temp.fx('po_b')));

SELECT pg_temp.expect_ok('a structured maturity date is recorded for position B', ARRAY[format(
  $$INSERT INTO obs.position_field_value (position_observation_id, field_code, raw_value, normalized_date,
      currency_state, scale_state, value_state, normalization_rule_version_id, evidence_id, run_id)
    VALUES (%s, 'MATURITY_DATE', '3/4/2099', DATE '2099-03-04', 'UNKNOWN', 'NOT_APPLICABLE', 'REPORTED', %s, %s, %s)$$,
  pg_temp.fx('po_b'), pg_temp.fx('r_field'), pg_temp.fx('e_anchor'), pg_temp.fx('run'))]);

SELECT pg_temp.check('NOT_BOUND with a structured maturity is REPORTED_STRUCTURED', (
  SELECT provenance_state = 'REPORTED_STRUCTURED' AND inspection_state = 'NOT_BOUND'
     AND structured_date = DATE '2099-03-04' AND displayed_date IS NULL
  FROM obs.maturity_provenance WHERE position_observation_id = pg_temp.fx('po_b')));

INSERT INTO validation.validation_result (subject_table, subject_id, rule_version_id, outcome, detail, evidence_id, run_id)
VALUES ('obs.position_observation', pg_temp.fx('po_a'), pg_temp.fx('r_validate'), 'PASS', 'c-1', pg_temp.fx('e_fact'), pg_temp.fx('run'));

SELECT pg_temp.expect_ok('FILING_DISPLAYED can later supersede NOT_BOUND', ARRAY[format(
  $$INSERT INTO obs.maturity_inspection (position_observation_id, soi_row_observation_id, inspection_state,
      filing_context_id, raw_value, normalized_date, evidence_id, rule_version_id, run_id, supersedes_id, supersede_reason)
    VALUES (%s, %s, 'FILING_DISPLAYED', 'c-1', '1/2/2099', DATE '2099-01-02', %s, %s, %s, %s, 'TEST ONLY: later rule bound the row')$$,
  pg_temp.fx('po_a'), pg_temp.fx('soi_a'), pg_temp.fx('e_anchor'), pg_temp.fx('r_validate'), pg_temp.fx('run'),
  pg_temp.fx('insp_not_bound_a'))]);

SELECT pg_temp.check('provenance follows the newer FILING_DISPLAYED and the NOT_BOUND row stays in history', (
  SELECT p.provenance_state = 'FILING_DISPLAYED' AND p.no_bind_reason IS NULL
     AND EXISTS (SELECT 1 FROM obs.maturity_inspection i
                 WHERE i.id = pg_temp.fx('insp_not_bound_a') AND i.inspection_state = 'NOT_BOUND')
  FROM obs.maturity_provenance p WHERE p.position_observation_id = pg_temp.fx('po_a')));

SELECT pg_temp.check('each position has exactly one current inspection', (
  SELECT count(*) = 2 AND count(DISTINCT position_observation_id) = 2
  FROM obs.maturity_inspection i
  WHERE i.position_observation_id IN (pg_temp.fx('po_a'), pg_temp.fx('po_b'))
    AND NOT EXISTS (SELECT 1 FROM obs.maturity_inspection s WHERE s.supersedes_id = i.id)));

SELECT pg_temp.expect_error('UPDATE of a NOT_BOUND inspection is rejected', 'BDCA1', ARRAY[format(
  'UPDATE obs.maturity_inspection SET no_bind_reason = %L WHERE id = %s', 'NO_MATCH', pg_temp.fx('insp_not_bound_a'))]);

SELECT pg_temp.expect_error('DELETE of a NOT_BOUND inspection is rejected', 'BDCA1', ARRAY[format(
  'DELETE FROM obs.maturity_inspection WHERE id = %s', pg_temp.fx('insp_not_bound_a'))]);

SELECT pg_temp.expect_error('DELETE of a superseded FILING_DISPLAYED inspection is rejected', 'BDCA1', ARRAY[format(
  'DELETE FROM obs.maturity_inspection WHERE id = %s', pg_temp.fx('insp_fd_b'))]);
