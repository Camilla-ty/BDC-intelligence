-- Group 9: provenance completeness (G-11, G-12). Every material observation has evidence,
-- and the lineage chain from derived values to raw artifacts is enforced.

SELECT pg_temp.expect_error('a position observation without a PRIMARY source link fails at commit', 'BDCL1', ARRAY[format(
  $$INSERT INTO obs.position_observation (origin_soi_row_observation_id, filing_id, reported_date, date_precision, duration_kind,
      holding_descriptor_raw, rule_version_id, evidence_id, run_id)
    VALUES (%s, %s, '2099-12-31', 'MONTH_END_ROUNDED', 'POINT_IN_TIME', 'TEST BORROWER A | TEST LOAN 1', %s, %s, %s)$$,
  pg_temp.fx('soi_a'), pg_temp.fx('filing'), pg_temp.fx('r_project2'), pg_temp.fx('e_soi_a'), pg_temp.fx('run')),
  'SET CONSTRAINTS ALL IMMEDIATE']);

SELECT pg_temp.expect_error('a position observation must match its origin SOI row', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.position_observation (origin_soi_row_observation_id, filing_id, reported_date, date_precision, duration_kind,
      holding_descriptor_raw, rule_version_id, evidence_id, run_id)
    VALUES (%s, %s, '2099-12-31', 'MONTH_END_ROUNDED', 'POINT_IN_TIME', 'TEST BORROWER B', %s, %s, %s)$$,
  pg_temp.fx('soi_a'), pg_temp.fx('filing'), pg_temp.fx('r_project2'), pg_temp.fx('e_soi_a'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('a derived value without inputs fails at commit', 'BDCL1', ARRAY[format(
  $$INSERT INTO derived.derived_value (metric_rule_version_id, subject_table, subject_id, result_numeric, result_state, run_id)
    VALUES (%s, 'obs.position_observation', %s, 1, 'DERIVED', %s)$$,
  pg_temp.fx('r_metric'), pg_temp.fx('po_a'), pg_temp.fx('run')),
  'SET CONSTRAINTS ALL IMMEDIATE']);

SELECT pg_temp.expect_error('a derived value must use a DERIVATION rule version', 'BDCD1', ARRAY[format(
  $$INSERT INTO derived.derived_value (metric_rule_version_id, subject_table, subject_id, result_numeric, result_state, run_id)
    VALUES (%s, 'obs.position_observation', %s, 1, 'DERIVED', %s)$$,
  pg_temp.fx('r_field'), pg_temp.fx('po_a'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('a group without members fails at commit', 'BDCL1', ARRAY[format(
  $$INSERT INTO obs.position_observation_group (filing_id, state, rationale, rule_version_id, run_id)
    VALUES (%s, 'UNRESOLVED', 'TEST ONLY', %s, %s)$$, pg_temp.fx('filing'), pg_temp.fx('r_group'), pg_temp.fx('run')),
  'SET CONSTRAINTS ALL IMMEDIATE']);

SELECT pg_temp.expect_ok('duplicate SOI rows can be grouped (UNRESOLVED) without merging them', ARRAY[
  format($$INSERT INTO obs.position_observation_group (filing_id, state, rationale, rule_version_id, run_id)
           VALUES (%s, 'UNRESOLVED', 'TEST ONLY: same identifier, date, qtrs', %s, %s)$$,
         pg_temp.fx('filing'), pg_temp.fx('r_group'), pg_temp.fx('run')),
  format($$INSERT INTO obs.position_observation_group_member (group_id, position_observation_id, run_id)
           SELECT currval(pg_get_serial_sequence('obs.position_observation_group', 'id')), id, %s
           FROM obs.position_observation WHERE filing_id = %s$$, pg_temp.fx('run'), pg_temp.fx('filing')),
  'SET CONSTRAINTS ALL IMMEDIATE']);
SET CONSTRAINTS ALL DEFERRED;

SELECT pg_temp.expect_error('a field value without evidence is rejected', '23502', ARRAY[format(
  $$INSERT INTO obs.position_field_value (position_observation_id, field_code, currency_state, scale_state, value_state,
      unknown_reason, normalization_rule_version_id, run_id)
    VALUES (%s, 'MATURITY_DATE', 'UNKNOWN', 'NOT_APPLICABLE', 'UNKNOWN', 'test', %s, %s)$$,
  pg_temp.fx('po_a'), pg_temp.fx('r_field'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('a registrant without evidence is rejected', '23502', ARRAY[format(
  $$INSERT INTO registry.registrant (cik, run_id) VALUES (9999999903, %s)$$, pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('a REPORTED value with no column mapping needs Level 2 evidence', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.position_field_value (position_observation_id, field_code, raw_value, normalized_text, currency_state,
      scale_state, value_state, normalization_rule_version_id, evidence_id, run_id)
    VALUES (%s, 'SENIORITY', 'TEST', 'TEST', 'UNKNOWN', 'NOT_APPLICABLE', 'REPORTED', %s, %s, %s)$$,
  pg_temp.fx('po_a'), pg_temp.fx('r_field'), pg_temp.fx('e_soi_a'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('field raw value must equal the source cell', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.position_field_value (position_observation_id, field_code, column_mapping_id, source_column_label,
      source_column_position, raw_value, normalized_numeric, currency_state, scale_state, value_state,
      normalization_rule_version_id, evidence_id, run_id)
    VALUES (%s, 'PRINCIPAL_AMOUNT', %s, 'Investment Owned, Balance, Principal Amount', 7, '999', 999, 'UNKNOWN',
            'NOT_APPLICABLE', 'REPORTED', %s, %s, %s)$$,
  pg_temp.fx('po_b'), pg_temp.mapping('Investment Owned, Balance, Principal Amount'), pg_temp.fx('r_field'),
  pg_temp.fx('e_soi_b'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('a field value must use the type of its field (no text in a numeric field)', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.position_field_value (position_observation_id, field_code, column_mapping_id, source_column_label,
      source_column_position, raw_value, normalized_text, currency_state, scale_state, value_state,
      normalization_rule_version_id, evidence_id, run_id)
    VALUES (%s, 'PRINCIPAL_AMOUNT', %s, 'Investment Owned, Balance, Principal Amount', 7, '200', '200', 'UNKNOWN',
            'NOT_APPLICABLE', 'REPORTED', %s, %s, %s)$$,
  pg_temp.fx('po_b'), pg_temp.mapping('Investment Owned, Balance, Principal Amount'), pg_temp.fx('r_field'),
  pg_temp.fx('e_soi_b'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('a mapping must match the field and column it is used for', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.position_field_value (position_observation_id, field_code, column_mapping_id, source_column_label,
      source_column_position, raw_value, normalized_numeric, currency_state, scale_state, value_state,
      normalization_rule_version_id, evidence_id, run_id)
    VALUES (%s, 'FAIR_VALUE', %s, 'Investment Owned, Balance, Principal Amount', 7, '200', 200, 'UNKNOWN',
            'NOT_APPLICABLE', 'REPORTED', %s, %s, %s)$$,
  pg_temp.fx('po_b'), pg_temp.mapping('Investment Owned, Balance, Principal Amount'), pg_temp.fx('r_field'),
  pg_temp.fx('e_soi_b'), pg_temp.fx('run'))]);

-- Evidence locators
SELECT pg_temp.expect_error('a TSV_ROW locator needs a raw row', '23514', ARRAY[format(
  $$INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, run_id) VALUES ('L1_STRUCTURED_DATASET', %s, 'TSV_ROW', %s)$$,
  pg_temp.fx('artifact'), pg_temp.fx('run'))]);
SELECT pg_temp.expect_error('Level 1 evidence cannot use a JSON path locator', '23514', ARRAY[format(
  $$INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, json_path, run_id) VALUES ('L1_STRUCTURED_DATASET', %s, 'JSON_PATH', '$.test', %s)$$,
  pg_temp.fx('artifact'), pg_temp.fx('run'))]);
SELECT pg_temp.expect_error('a TSV_CELL label must equal the header label at its position', 'BDCI1', ARRAY[format(
  $$SELECT pg_temp.add_evidence('L1_STRUCTURED_DATASET', %s, %s, 7, 'Adjusted cost basis')$$,
  pg_temp.fx('artifact'), pg_temp.fx('row_soi_a'))]);
SELECT pg_temp.expect_ok('Level 2 evidence can point at an inline XBRL fact', ARRAY[format(
  $$INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, ixbrl_fact_id, run_id) VALUES ('L2_ORIGINAL_FILING', %s, 'IXBRL_FACT', 'test-fact-1', %s)$$,
  pg_temp.fx('artifact'), pg_temp.fx('run'))]);

-- Raw losslessness
SELECT pg_temp.expect_error('raw_line_sha256 must match the stored line', 'BDCI1', ARRAY[format(
  $$INSERT INTO raw.tabular_row (table_load_id, line_number, raw_line, raw_line_sha256, cells, field_count, parse_status, run_id)
    VALUES (%s, 90, E'a\tb\tc', repeat('0', 64), ARRAY['a', 'b', 'c'], 3, 'OK', %s)$$, pg_temp.fx('l_sub'), pg_temp.fx('run'))]);
SELECT pg_temp.expect_error('tab-delimited cells must be the exact split of the raw line (no trimming)', 'BDCI1', ARRAY[format(
  $$INSERT INTO raw.tabular_row (table_load_id, line_number, raw_line, raw_line_sha256, cells, field_count, parse_status, run_id)
    VALUES (%s, 91, E'a \tb\tc', encode(sha256(convert_to(E'a \tb\tc', 'UTF8')), 'hex'), ARRAY['a', 'b', 'c'], 3, 'OK', %s)$$,
  pg_temp.fx('l_sub'), pg_temp.fx('run'))]);
SELECT pg_temp.expect_error('parse status must reflect the header width', 'BDCI1', ARRAY[format(
  $$INSERT INTO raw.tabular_row (table_load_id, line_number, raw_line, raw_line_sha256, cells, field_count, parse_status, run_id)
    VALUES (%s, 92, E'a\tb', encode(sha256(convert_to(E'a\tb', 'UTF8')), 'hex'), ARRAY['a', 'b'], 2, 'OK', %s)$$,
  pg_temp.fx('l_sub'), pg_temp.fx('run'))]);
SELECT pg_temp.expect_error('artifacts must come from official SEC hosts over https', '23514', ARRAY[format(
  $$INSERT INTO raw.artifact (source_url, final_url, source_type_code, http_status, byte_size, sha256, retrieved_at, storage_key, run_id)
    VALUES ('https://example.com/test.zip', 'https://example.com/test.zip', 'SEC_BDC_DATASET_ZIP', 200, 1, repeat('1', 64), now(), 'test', %s)$$,
  pg_temp.fx('run'))]);

SELECT pg_temp.check('lineage: a position field value traces to its artifact checksum, retrieval time, rule, and run', (
  SELECT count(*) = 1
  FROM obs.position_field_value f
  JOIN obs.position_observation p ON p.id = f.position_observation_id
  JOIN obs.position_observation_source ps ON ps.position_observation_id = p.id AND ps.source_role = 'PRIMARY'
  JOIN obs.soi_row_observation s ON s.id = ps.soi_row_observation_id
  JOIN raw.tabular_row r ON r.id = s.tabular_row_id
  JOIN raw.table_load tl ON tl.id = r.table_load_id
  JOIN raw.artifact a ON a.id = tl.artifact_id
  JOIN evidence.evidence e ON e.id = f.evidence_id AND e.tabular_row_id = r.id
  JOIN ops.rule_version rv ON rv.id = f.normalization_rule_version_id
  JOIN ops.run run ON run.id = f.run_id
  JOIN registry.filing fi ON fi.id = p.filing_id
  WHERE f.id = pg_temp.fx('fv_principal') AND a.sha256 = repeat('a', 64) AND a.retrieved_at IS NOT NULL
    AND fi.accession_number = '0000000000-00-000001'));

SELECT pg_temp.expect_ok('supplementary evidence can corroborate an existing observation', ARRAY[format(
  $$INSERT INTO evidence.supplementary_evidence (subject_table, subject_id, evidence_id, role, run_id)
    VALUES ('obs.position_field_value', %s, %s, 'CORROBORATES', %s)$$,
  pg_temp.fx('fv_adj_cost'), pg_temp.fx('e_num'), pg_temp.fx('run'))]);
SELECT pg_temp.expect_error('supplementary evidence must reference an existing subject', 'BDCI1', ARRAY[format(
  $$INSERT INTO evidence.supplementary_evidence (subject_table, subject_id, evidence_id, role, run_id)
    VALUES ('obs.position_field_value', -1, %s, 'CORROBORATES', %s)$$, pg_temp.fx('e_num'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('FILING_VERIFIED requires a passing Level 2 validation', 'BDCI1', ARRAY[
  format($$INSERT INTO validation.validation_result (subject_table, subject_id, rule_version_id, outcome, evidence_id, run_id)
           VALUES ('obs.position_field_value', %s, %s, 'PASS', %s, %s)$$,
         pg_temp.fx('fv_principal'), pg_temp.fx('r_validate'), pg_temp.fx('e_a_principal'), pg_temp.fx('run')),
  format($$INSERT INTO validation.evidence_status_assertion (field_value_id, evidence_status, validation_result_id, rule_version_id, run_id)
           VALUES (%s, 'FILING_VERIFIED', currval(pg_get_serial_sequence('validation.validation_result', 'id')), %s, %s)$$,
         pg_temp.fx('fv_principal'), pg_temp.fx('r_validate'), pg_temp.fx('run'))]);
