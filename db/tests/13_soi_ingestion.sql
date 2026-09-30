-- Group 13: Phase 3 SOI ingestion support (migration 0011).
-- All values are obviously fake (TEST BDC 1, TEST BORROWER A, CIK 9999999901, dates in 2099).

SELECT pg_temp.check('SOI_HOLDINGS is a coverage aspect', EXISTS (
  SELECT 1 FROM ref.coverage_aspect WHERE code = 'SOI_HOLDINGS'));

SELECT pg_temp.expect_error('SOI_HOLDINGS coverage requires a data-set release', '23514', ARRAY[format(
  $$INSERT INTO ops.coverage_assertion (registrant_id, reporting_period_end, source_type_code, coverage_aspect,
      coverage_state, rationale, rule_version_id, run_id)
    VALUES (%s, '2099-12-31', 'SEC_SUBMISSIONS_JSON', 'SOI_HOLDINGS', 'NOT_INGESTED', 'TEST ONLY', %s, %s)$$,
  pg_temp.fx('registrant'), pg_temp.fx('r_coverage'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_ok('SOI_HOLDINGS EMPTY_PERIOD is independent of FILING_METADATA', ARRAY[format(
  $$INSERT INTO ops.coverage_assertion (dataset_release_id, source_type_code, coverage_aspect, coverage_state, evidence_id,
      rationale, rule_version_id, run_id)
    VALUES (%s, 'SEC_BDC_DATASET_ZIP', 'SOI_HOLDINGS', 'EMPTY_PERIOD', %s, 'TEST ONLY: 0-byte soi.tsv', %s, %s)$$,
  pg_temp.fx('release'), pg_temp.fx('e_sub'), pg_temp.fx('r_coverage'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_ok('FILING_METADATA COVERED can coexist with SOI_HOLDINGS EMPTY_PERIOD on the same release', ARRAY[format(
  $$INSERT INTO ops.coverage_assertion (dataset_release_id, source_type_code, coverage_aspect, coverage_state, evidence_id,
      rationale, rule_version_id, run_id)
    VALUES (%s, 'SEC_BDC_DATASET_ZIP', 'FILING_METADATA', 'COVERED', %s, 'TEST ONLY: SUB rows present', %s, %s)$$,
  pg_temp.fx('release'), pg_temp.fx('e_sub'), pg_temp.fx('r_coverage'), pg_temp.fx('run'))]);

SELECT pg_temp.check('current SOI coverage is EMPTY_PERIOD while FILING_METADATA is COVERED', (
  SELECT bool_or(coverage_aspect = 'SOI_HOLDINGS' AND coverage_state = 'EMPTY_PERIOD' AND NOT is_covered)
     AND bool_or(coverage_aspect = 'FILING_METADATA' AND coverage_state = 'COVERED' AND is_covered)
  FROM ops.current_coverage WHERE dataset_release_id = pg_temp.fx('release') AND registrant_id IS NULL));

SELECT pg_temp.check('obs.current_soi_coverage hides FILING_METADATA', (
  SELECT count(*) = 1 AND min(coverage_state) = 'EMPTY_PERIOD'
  FROM obs.current_soi_coverage WHERE dataset_release_id = pg_temp.fx('release') AND registrant_id IS NULL));

WITH i AS (
  INSERT INTO raw.artifact_member (artifact_id, member_path, byte_size, sha256, run_id)
  VALUES (pg_temp.fx('artifact'), 'empty-soi.tsv', 0, repeat('0', 64), pg_temp.fx('run'))
  RETURNING id)
INSERT INTO fx SELECT 'm_soi_empty', id FROM i;

SELECT pg_temp.expect_ok('a 0-byte SOI member may have an empty header and row_count 0', ARRAY[format(
  $$INSERT INTO raw.table_load (artifact_id, artifact_member_id, table_code, delimiter, header, header_sha256,
      parser_rule_version_id, row_count, field_count_mismatch_count, parse_status, run_id)
    VALUES (%s, %s, 'SOI', E'\t', ARRAY[]::text[], repeat('1', 64), %s, 0, 0, 'OK', %s)$$,
  pg_temp.fx('artifact'), pg_temp.fx('m_soi_empty'), pg_temp.fx('r_parser'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('an empty header is rejected when the SOI member is not 0 bytes', 'BDCI1', ARRAY[format(
  $$INSERT INTO raw.table_load (artifact_id, artifact_member_id, table_code, delimiter, header, header_sha256,
      parser_rule_version_id, row_count, field_count_mismatch_count, parse_status, run_id)
    VALUES (%s, %s, 'SOI', E'\t', ARRAY[]::text[], repeat('1', 64), %s, 0, 0, 'OK', %s)$$,
  pg_temp.fx('artifact'), pg_temp.fx('m_soi'), pg_temp.fx('r_parser'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('an empty header is rejected for SUB even with a 0-byte member', 'BDCI1', ARRAY[format(
  $$INSERT INTO raw.table_load (artifact_id, artifact_member_id, table_code, delimiter, header, header_sha256,
      parser_rule_version_id, row_count, field_count_mismatch_count, parse_status, run_id)
    VALUES (%s, %s, 'SUB', E'\t', ARRAY[]::text[], repeat('1', 64), %s, 0, 0, 'OK', %s)$$,
  pg_temp.fx('artifact'), pg_temp.fx('m_soi_empty'), pg_temp.fx('r_parser'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('an empty SOI header is rejected when row_count is not 0', 'BDCI1', ARRAY[format(
  $$INSERT INTO raw.table_load (artifact_id, artifact_member_id, table_code, delimiter, header, header_sha256,
      parser_rule_version_id, row_count, field_count_mismatch_count, parse_status, run_id)
    VALUES (%s, %s, 'SOI', E'\t', ARRAY[]::text[], repeat('1', 64), %s, 1, 0, 'OK', %s)$$,
  pg_temp.fx('artifact'), pg_temp.fx('m_soi_empty'), pg_temp.fx('r_parser'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_ok('a field-count mismatch row can be quarantined without being projected', ARRAY[format(
  $$INSERT INTO ops.projection_exception (table_load_id, tabular_row_id, kind, detail, evidence_id, rule_version_id, run_id)
    VALUES (%s, %s, 'FIELD_COUNT_MISMATCH', 'TEST ONLY: extra fields', %s, %s, %s)$$,
  pg_temp.fx('l_soi'), pg_temp.fx('row_soi_short'),
  pg_temp.add_evidence('L1_STRUCTURED_DATASET', pg_temp.fx('artifact'), pg_temp.fx('row_soi_short')),
  pg_temp.fx('r_project'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('a FIELD_COUNT_MISMATCH exception cannot point at an OK row', 'BDCI1', ARRAY[format(
  $$INSERT INTO ops.projection_exception (table_load_id, tabular_row_id, kind, detail, evidence_id, rule_version_id, run_id)
    VALUES (%s, %s, 'FIELD_COUNT_MISMATCH', 'TEST ONLY', %s, %s, %s)$$,
  pg_temp.fx('l_soi'), pg_temp.fx('row_soi_a'), pg_temp.fx('e_soi_a'), pg_temp.fx('r_project'), pg_temp.fx('run'))]);

SELECT pg_temp.check('duplicate SOI business keys remain two observations in the metric view', (
  SELECT observation_count = 2 FROM obs.soi_duplicate_key_groups
  WHERE accession_number = '0000000000-00-000001' AND identifier_raw = 'TEST BORROWER A | TEST LOAN 1'
    AND reported_date = '2099-12-31' AND qtrs = 0));

SELECT pg_temp.check('soi_load_reconciliation counts the fixture SOI load without collapsing duplicates', (
  SELECT row_count = 4 AND ok_row_count = 3 AND soi_row_observation_count = 3
     AND position_observation_count = 2 AND identifier_row_count = 2 AND no_identifier_row_count = 1
     AND quarantined_mismatch_count = 1 AND orphan_adsh_count = 0
  FROM obs.soi_load_reconciliation WHERE table_load_id = pg_temp.fx('l_soi')));
