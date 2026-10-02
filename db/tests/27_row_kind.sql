-- Group 27: SOI row kinds (migrations 0021 and 0022).
-- All values are obviously fake (TEST BORROWER A, accession 0000000000-00-000001).

INSERT INTO fx
SELECT 'cls_total', c.id FROM obs.soi_row_classification c
WHERE c.soi_row_observation_id = pg_temp.fx('soi_total')
  AND c.row_kind = 'NO_IDENTIFIER_ROW';

SELECT pg_temp.check('row_kind keeps NO_IDENTIFIER_ROW and adds the filing-evidence labels', (
  SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder) = ARRAY[
    'IDENTIFIER_ROW', 'NO_IDENTIFIER_ROW', 'UNCLASSIFIED', 'SUBTOTAL_ROW', 'DIMENSION_FACT_ROW'
  ]
  FROM pg_enum e
  JOIN pg_type t ON t.oid = e.enumtypid
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'ref' AND t.typname = 'row_kind'));

WITH i AS (
  INSERT INTO raw.artifact (source_url, final_url, source_type_code, http_status, byte_size, sha256, retrieved_at, storage_key, run_id)
  VALUES ('https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000001/test-only.htm',
          'https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000001/test-only.htm',
          'SEC_FILING_DOCUMENT', 200, 1, repeat('c', 64), '2099-01-02T00:00:00Z', 'test-only/filing-doc', pg_temp.fx('run'))
  RETURNING id
) INSERT INTO fx SELECT 'artifact_filing', id FROM i;

WITH i AS (
  INSERT INTO registry.filing_document (filing_id, document_name, document_url, named_by, rule_version_id, run_id, evidence_id)
  VALUES (pg_temp.fx('filing'), 'test-only.htm',
          'https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000001/test-only.htm',
          'FILING_INDEX_JSON', pg_temp.fx('r_project'), pg_temp.fx('run'), pg_temp.fx('e_sub'))
  RETURNING id
) INSERT INTO fx SELECT 'filing_doc', id FROM i;

INSERT INTO registry.filing_document_artifact (filing_document_id, artifact_id, run_id)
VALUES (pg_temp.fx('filing_doc'), pg_temp.fx('artifact_filing'), pg_temp.fx('run'));

WITH i AS (
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, ixbrl_fact_id, run_id)
  VALUES ('L2_ORIGINAL_FILING', pg_temp.fx('artifact_filing'), 'IXBRL_FACT', 'test-context-1', pg_temp.fx('run'))
  RETURNING id
) INSERT INTO fx SELECT 'e_ix', id FROM i;

WITH i AS (
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, run_id)
  VALUES ('L2_ORIGINAL_FILING', pg_temp.fx('artifact_filing'), 'DOCUMENT', pg_temp.fx('run'))
  RETURNING id
) INSERT INTO fx SELECT 'e_doc', id FROM i;

SELECT pg_temp.expect_ok('a historical NO_IDENTIFIER_ROW is superseded by SUBTOTAL_ROW', ARRAY[format(
  $$INSERT INTO obs.soi_row_classification (soi_row_observation_id, row_kind, period_role, rule_version_id, run_id,
      supersedes_id, supersede_reason, evidence_id)
    VALUES (%s, 'SUBTOTAL_ROW', 'UNRESOLVED', %s, %s, %s, 'TEST ONLY: filing labels this context as a subtotal', %s)$$,
  pg_temp.fx('soi_total'), pg_temp.fx('r_classify'), pg_temp.fx('run'), pg_temp.fx('cls_total'), pg_temp.fx('e_ix'))]);

SELECT pg_temp.check('the historical NO_IDENTIFIER_ROW classification is still stored', (
  SELECT row_kind = 'NO_IDENTIFIER_ROW' AND supersedes_id IS NULL AND period_role = 'UNRESOLVED'
    AND evidence_id IS NULL
  FROM obs.soi_row_classification WHERE id = pg_temp.fx('cls_total')));

INSERT INTO fx
SELECT 'cls_subtotal', c.id FROM obs.soi_row_classification c
WHERE c.soi_row_observation_id = pg_temp.fx('soi_total') AND c.row_kind = 'SUBTOTAL_ROW';

SELECT pg_temp.expect_ok('SUBTOTAL_ROW can be superseded by DIMENSION_FACT_ROW', ARRAY[format(
  $$INSERT INTO obs.soi_row_classification (soi_row_observation_id, row_kind, period_role, rule_version_id, run_id,
      supersedes_id, supersede_reason, evidence_id)
    VALUES (%s, 'DIMENSION_FACT_ROW', 'UNRESOLVED', %s, %s, %s, 'TEST ONLY: filing context is another dimension fact', %s)$$,
  pg_temp.fx('soi_total'), pg_temp.fx('r_classify'), pg_temp.fx('run'), pg_temp.fx('cls_subtotal'), pg_temp.fx('e_ix'))]);

SELECT pg_temp.check('the current classification is the latest filing-evidence kind', (
  SELECT row_kind = 'DIMENSION_FACT_ROW' AND period_role = 'UNRESOLVED' AND evidence_id = pg_temp.fx('e_ix')
  FROM obs.current_soi_row_classification
  WHERE soi_row_observation_id = pg_temp.fx('soi_total')));

INSERT INTO fx
SELECT 'cls_dimension', c.id FROM obs.soi_row_classification c
WHERE c.soi_row_observation_id = pg_temp.fx('soi_total') AND c.row_kind = 'DIMENSION_FACT_ROW';

SELECT pg_temp.expect_error('SUBTOTAL_ROW without filing evidence is rejected', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.soi_row_classification (soi_row_observation_id, row_kind, period_role, rule_version_id, run_id,
      supersedes_id, supersede_reason)
    VALUES (%s, 'SUBTOTAL_ROW', 'UNRESOLVED', %s, %s, %s, 'TEST ONLY')$$,
  pg_temp.fx('soi_total'), pg_temp.fx('r_classify'), pg_temp.fx('run'), pg_temp.fx('cls_dimension'))]);

SELECT pg_temp.expect_error('L1 dataset evidence cannot support SUBTOTAL_ROW', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.soi_row_classification (soi_row_observation_id, row_kind, period_role, rule_version_id, run_id,
      supersedes_id, supersede_reason, evidence_id)
    VALUES (%s, 'SUBTOTAL_ROW', 'UNRESOLVED', %s, %s, %s, 'TEST ONLY', %s)$$,
  pg_temp.fx('soi_total'), pg_temp.fx('r_classify'), pg_temp.fx('run'), pg_temp.fx('cls_dimension'), pg_temp.fx('e_soi_total'))]);

SELECT pg_temp.expect_error('whole-document evidence cannot support DIMENSION_FACT_ROW', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.soi_row_classification (soi_row_observation_id, row_kind, period_role, rule_version_id, run_id,
      supersedes_id, supersede_reason, evidence_id)
    VALUES (%s, 'DIMENSION_FACT_ROW', 'UNRESOLVED', %s, %s, %s, 'TEST ONLY', %s)$$,
  pg_temp.fx('soi_total'), pg_temp.fx('r_classify'), pg_temp.fx('run'), pg_temp.fx('cls_dimension'), pg_temp.fx('e_doc'))]);

SELECT pg_temp.check('the superseded SUBTOTAL_ROW remains stored', (
  SELECT row_kind = 'SUBTOTAL_ROW' AND supersedes_id = pg_temp.fx('cls_total')
  FROM obs.soi_row_classification WHERE id = pg_temp.fx('cls_subtotal')));

SELECT pg_temp.expect_error('IDENTIFIER_ROW is rejected when the origin identifier cell is empty', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.soi_row_classification (soi_row_observation_id, row_kind, period_role, rule_version_id, run_id,
      supersedes_id, supersede_reason)
    SELECT %s, 'IDENTIFIER_ROW', 'UNRESOLVED', %s, %s, c.id, 'TEST ONLY'
    FROM obs.current_soi_row_classification c
    WHERE c.soi_row_observation_id = %s$$,
  pg_temp.fx('soi_total'), pg_temp.fx('r_classify'), pg_temp.fx('run'), pg_temp.fx('soi_total'))]);

SELECT pg_temp.expect_error('SUBTOTAL_ROW requires an empty origin identifier cell', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.soi_row_classification (soi_row_observation_id, row_kind, period_role, rule_version_id, run_id,
      supersedes_id, supersede_reason)
    SELECT %s, 'SUBTOTAL_ROW', 'UNRESOLVED', %s, %s, c.id, 'TEST ONLY'
    FROM obs.current_soi_row_classification c
    WHERE c.soi_row_observation_id = %s$$,
  pg_temp.fx('soi_a'), pg_temp.fx('r_classify'), pg_temp.fx('run'), pg_temp.fx('soi_a'))]);

SELECT pg_temp.expect_error('DIMENSION_FACT_ROW requires an empty origin identifier cell', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.soi_row_classification (soi_row_observation_id, row_kind, period_role, rule_version_id, run_id,
      supersedes_id, supersede_reason)
    SELECT %s, 'DIMENSION_FACT_ROW', 'UNRESOLVED', %s, %s, c.id, 'TEST ONLY'
    FROM obs.current_soi_row_classification c
    WHERE c.soi_row_observation_id = %s$$,
  pg_temp.fx('soi_a'), pg_temp.fx('r_classify'), pg_temp.fx('run'), pg_temp.fx('soi_a'))]);

SELECT pg_temp.expect_error('UNCLASSIFIED cannot become the current kind of a position origin', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.soi_row_classification (soi_row_observation_id, row_kind, period_role, rule_version_id, run_id,
      supersedes_id, supersede_reason)
    SELECT %s, 'UNCLASSIFIED', 'UNRESOLVED', %s, %s, c.id, 'TEST ONLY'
    FROM obs.current_soi_row_classification c
    WHERE c.soi_row_observation_id = %s$$,
  pg_temp.fx('soi_a'), pg_temp.fx('r_classify'), pg_temp.fx('run'), pg_temp.fx('soi_a'))]);

SELECT pg_temp.expect_error('a blank identifier cannot be stored as the previous row identifier', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.position_observation (origin_soi_row_observation_id, filing_id, reported_date, date_precision,
      duration_kind, holding_descriptor_raw, rule_version_id, evidence_id, run_id)
    VALUES (%s, %s, '2099-12-31', 'MONTH_END_ROUNDED', 'POINT_IN_TIME', 'TEST BORROWER A | TEST LOAN 1', %s, %s, %s)$$,
  pg_temp.fx('soi_total'), pg_temp.fx('filing'), pg_temp.fx('r_position'), pg_temp.fx('e_soi_total'), pg_temp.fx('run'))]);

WITH i AS (
  INSERT INTO obs.soi_row_observation (tabular_row_id, filing_id, reported_date_raw, reported_date,
      date_precision, qtrs_raw, qtrs, duration_kind, identifier_raw, rule_version_id, evidence_id, run_id)
  VALUES (pg_temp.fx('row_soi_a'), pg_temp.fx('filing'), '2099-12-31', '2099-12-31', 'MONTH_END_ROUNDED', '0', 0,
          'POINT_IN_TIME', 'TEST BORROWER A | TEST LOAN 1', pg_temp.fx('r_project2'), pg_temp.fx('e_soi_a'), pg_temp.fx('run'))
  RETURNING id
) INSERT INTO fx SELECT 'soi_open', id FROM i;

SELECT pg_temp.expect_ok('UNCLASSIFIED can be recorded for an identifier row that has no position', ARRAY[format(
  $$INSERT INTO obs.soi_row_classification (soi_row_observation_id, row_kind, period_role, rule_version_id, run_id)
    VALUES (%s, 'UNCLASSIFIED', 'UNRESOLVED', %s, %s)$$,
  pg_temp.fx('soi_open'), pg_temp.fx('r_classify'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('a position origin must be IDENTIFIER_ROW', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.position_observation (origin_soi_row_observation_id, filing_id, reported_date, date_precision,
      duration_kind, holding_descriptor_raw, rule_version_id, evidence_id, run_id)
    VALUES (%s, %s, '2099-12-31', 'MONTH_END_ROUNDED', 'POINT_IN_TIME', 'TEST BORROWER A | TEST LOAN 1', %s, %s, %s)$$,
  pg_temp.fx('soi_open'), pg_temp.fx('filing'), pg_temp.fx('r_position'), pg_temp.fx('e_soi_a'), pg_temp.fx('run'))]);

SELECT pg_temp.check('filing-evidence classification does not add a position', (
  SELECT count(*) = 2 FROM obs.position_observation WHERE filing_id = pg_temp.fx('filing')
    AND NOT EXISTS (
      SELECT 1 FROM obs.position_observation p
      WHERE p.origin_soi_row_observation_id IN (pg_temp.fx('soi_total'), pg_temp.fx('soi_open')))
));
