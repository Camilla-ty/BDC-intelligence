-- Shared setup, prepended to every test file by scripts/db/test.mjs. The runner wraps each file
-- as BEGIN; <this setup>; <test file>; ROLLBACK; so nothing here is ever persisted.
--
-- Test data policy (P1-D12): every value below is obviously fake structural test data
-- (TEST BDC 1, TEST BORROWER A, accession 0000000000-00-000001, CIK 9999999901, dates in
-- 2099, URLs under /files/TEST-ONLY/). None of it is SEC data, and none of it may become a
-- committed seed or production data.

SET client_min_messages = notice;

-- ---------------------------------------------------------------------------
-- Assertion helpers. Each PASS is reported as a NOTICE; any FAIL aborts the file.
-- ---------------------------------------------------------------------------

CREATE FUNCTION pg_temp.expect_error(label text, expected_sqlstate text, statements text[]) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  stmt text;
  got text;
  msg text;
BEGIN
  BEGIN
    FOREACH stmt IN ARRAY statements LOOP
      EXECUTE stmt;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS got = RETURNED_SQLSTATE, msg = MESSAGE_TEXT;
    EXECUTE 'SET CONSTRAINTS ALL DEFERRED';
    IF got = expected_sqlstate THEN
      RAISE NOTICE 'PASS: % [%]', label, got;
      RETURN;
    END IF;
    RAISE EXCEPTION 'FAIL: % - expected SQLSTATE % but got %: %', label, expected_sqlstate, got, msg;
  END;
  RAISE EXCEPTION 'FAIL: % - expected SQLSTATE % but the statements succeeded', label, expected_sqlstate;
END
$$;

CREATE FUNCTION pg_temp.expect_ok(label text, statements text[]) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  stmt text;
BEGIN
  FOREACH stmt IN ARRAY statements LOOP
    EXECUTE stmt;
  END LOOP;
  RAISE NOTICE 'PASS: %', label;
END
$$;

CREATE FUNCTION pg_temp.check(label text, condition boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF condition IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: %', label;
  END IF;
  RAISE NOTICE 'PASS: %', label;
END
$$;

CREATE TEMP TABLE fx (key text PRIMARY KEY, id bigint NOT NULL) ON COMMIT DROP;

CREATE FUNCTION pg_temp.fx(k text) RETURNS bigint
LANGUAGE sql STABLE AS $$ SELECT id FROM fx WHERE key = k $$;

CREATE FUNCTION pg_temp.put(k text, v bigint) RETURNS bigint
LANGUAGE sql AS $$ INSERT INTO fx (key, id) VALUES (k, v) RETURNING id $$;

-- Inserts one raw row, computing hash, cells, field count, and parse status from the line.
CREATE FUNCTION pg_temp.add_row(load_id bigint, line_no bigint, line text) RETURNS bigint
LANGUAGE sql AS $$
  INSERT INTO raw.tabular_row (table_load_id, line_number, raw_line, raw_line_sha256, cells, field_count, parse_status, run_id)
  SELECT load_id, line_no, line,
         encode(sha256(convert_to(line, 'UTF8')), 'hex'),
         string_to_array(line, E'\t'),
         cardinality(string_to_array(line, E'\t')),
         CASE WHEN cardinality(string_to_array(line, E'\t')) = cardinality(tl.header)
              THEN 'OK'::ref.parse_status ELSE 'FIELD_COUNT_MISMATCH'::ref.parse_status END,
         pg_temp.fx('run')
  FROM raw.table_load tl WHERE tl.id = load_id
  RETURNING id
$$;

CREATE FUNCTION pg_temp.add_rule(code text, kind ops.rule_kind, policy ops.unknown_input_policy DEFAULT NULL) RETURNS bigint
LANGUAGE sql AS $$
  INSERT INTO ops.rule_version (rule_code, rule_kind, version, definition_sha256, spec_reference, description, unknown_input_policy, created_by)
  VALUES (code, kind, 'test-1', repeat('c', 64), 'db/tests (test only)', 'TEST ONLY rule', policy, 'db tests')
  RETURNING id
$$;

CREATE FUNCTION pg_temp.add_evidence(level ref.evidence_level, artifact bigint, row_id bigint,
                                     col_pos integer DEFAULT NULL, col_label text DEFAULT NULL) RETURNS bigint
LANGUAGE sql AS $$
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, tabular_row_id, column_position, column_label, run_id)
  VALUES (level, artifact,
          CASE WHEN col_pos IS NULL THEN 'TSV_ROW'::ref.locator_type ELSE 'TSV_CELL'::ref.locator_type END,
          row_id, col_pos, col_label, pg_temp.fx('run'))
  RETURNING id
$$;

CREATE FUNCTION pg_temp.mapping(label text) RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT mapping_id FROM ref.current_column_mapping WHERE source_table_code = 'SOI' AND column_label = label
$$;

-- Extra identifier-bearing position for tests that need a second disclosed name.
-- Not called by the shared fixture, so the default position count stays two.
CREATE FUNCTION pg_temp.add_identifier_position(pos_key text, ident text, line_no bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  acc constant text := '0000000000-00-000001';
  row_id bigint;
  ev_row bigint;
  ev_cell bigint;
  soi_id bigint;
  po_id bigint;
  line text;
BEGIN
  line := acc || E'\t9999999901\tTEST BDC 1\t2099-12-31\t0\t' || ident || E'\t100\t90\t\t0.05\t0.01';
  row_id := pg_temp.add_row(pg_temp.fx('l_soi'), line_no, line);
  ev_row := pg_temp.add_evidence('L1_STRUCTURED_DATASET', pg_temp.fx('artifact'), row_id);
  ev_cell := pg_temp.add_evidence('L1_STRUCTURED_DATASET', pg_temp.fx('artifact'), row_id, 6, 'Investment, Identifier Axis');
  INSERT INTO obs.soi_row_observation (tabular_row_id, filing_id, reported_date_raw, reported_date,
      date_precision, qtrs_raw, qtrs, duration_kind, identifier_raw, rule_version_id, evidence_id, run_id)
  VALUES (row_id, pg_temp.fx('filing'), '2099-12-31', '2099-12-31', 'MONTH_END_ROUNDED', '0', 0,
          'POINT_IN_TIME', ident, pg_temp.fx('r_project'), ev_row, pg_temp.fx('run'))
  RETURNING id INTO soi_id;
  INSERT INTO obs.soi_row_classification (soi_row_observation_id, row_kind, period_role, rule_version_id, run_id)
  VALUES (soi_id, 'IDENTIFIER_ROW', 'UNRESOLVED', pg_temp.fx('r_classify'), pg_temp.fx('run'));
  INSERT INTO obs.position_observation (origin_soi_row_observation_id, filing_id, reported_date,
      date_precision, duration_kind, holding_descriptor_raw, rule_version_id, evidence_id, run_id)
  VALUES (soi_id, pg_temp.fx('filing'), '2099-12-31', 'MONTH_END_ROUNDED', 'POINT_IN_TIME',
          ident, pg_temp.fx('r_position'), ev_row, pg_temp.fx('run'))
  RETURNING id INTO po_id;
  INSERT INTO obs.position_observation_source (position_observation_id, soi_row_observation_id, source_role, run_id)
  VALUES (po_id, soi_id, 'PRIMARY', pg_temp.fx('run'));
  PERFORM pg_temp.put(pos_key, po_id);
  PERFORM pg_temp.put(pos_key || '_cell', ev_cell);
END
$$;

-- ---------------------------------------------------------------------------
-- Fixture: one fake data-set artifact with SUB, SOI, and NUM loads, one fake registrant and
-- filing, SOI observations including a deliberate duplicate, and position field values.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  acc constant text := '0000000000-00-000001';
  soi_header constant text[] := ARRAY[
    'adsh', 'cik', 'name', 'ddate', 'qtrs', 'Investment, Identifier Axis',
    'Investment Owned, Balance, Principal Amount', 'Adjusted cost basis', 'Investment Owned, Cost',
    'Investment Interest Rate', 'Investment, Interest Rate, Paid in Kind'];
  v bigint;
BEGIN
  WITH i AS (INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
    VALUES ('TEST', 'test', '{}'::jsonb, now()) RETURNING id) INSERT INTO fx SELECT 'run', id FROM i;

  PERFORM pg_temp.put('r_parser', pg_temp.add_rule('test.parser', 'PARSER'));
  PERFORM pg_temp.put('r_project', pg_temp.add_rule('test.project', 'NORMALIZATION'));
  PERFORM pg_temp.put('r_project2', pg_temp.add_rule('test.project_v2', 'NORMALIZATION'));
  PERFORM pg_temp.put('r_position', pg_temp.add_rule('test.position', 'NORMALIZATION'));
  PERFORM pg_temp.put('r_field', pg_temp.add_rule('test.field', 'NORMALIZATION'));
  PERFORM pg_temp.put('r_classify', pg_temp.add_rule('test.classify', 'CLASSIFICATION'));
  PERFORM pg_temp.put('r_group', pg_temp.add_rule('test.group', 'GROUPING'));
  PERFORM pg_temp.put('r_validate', pg_temp.add_rule('test.validate', 'VALIDATION'));
  PERFORM pg_temp.put('r_resolve', pg_temp.add_rule('test.resolve', 'RESOLUTION'));
  PERFORM pg_temp.put('r_coverage', pg_temp.add_rule('test.coverage', 'COVERAGE'));
  PERFORM pg_temp.put('r_mapping', pg_temp.add_rule('test.mapping', 'MAPPING'));
  PERFORM pg_temp.put('r_metric', pg_temp.add_rule('test.metric_propagate', 'DERIVATION', 'PROPAGATE_UNKNOWN'));
  PERFORM pg_temp.put('r_metric_strict', pg_temp.add_rule('test.metric_strict', 'DERIVATION', 'REJECT_UNKNOWN_INPUTS'));

  WITH i AS (INSERT INTO raw.artifact (source_url, final_url, source_type_code, http_status, byte_size, sha256, retrieved_at, storage_key, run_id)
    VALUES ('https://www.sec.gov/files/TEST-ONLY/test-dataset.zip', 'https://www.sec.gov/files/TEST-ONLY/test-dataset.zip',
            'SEC_BDC_DATASET_ZIP', 200, 1, repeat('a', 64), '2099-01-01T00:00:00Z', 'test-only/none', pg_temp.fx('run'))
    RETURNING id) INSERT INTO fx SELECT 'artifact', id FROM i;

  WITH i AS (INSERT INTO raw.artifact_member (artifact_id, member_path, byte_size, sha256, run_id)
    VALUES (pg_temp.fx('artifact'), 'sub.tsv', 1, repeat('b', 64), pg_temp.fx('run')) RETURNING id) INSERT INTO fx SELECT 'm_sub', id FROM i;
  WITH i AS (INSERT INTO raw.artifact_member (artifact_id, member_path, byte_size, sha256, run_id)
    VALUES (pg_temp.fx('artifact'), 'soi.tsv', 1, repeat('d', 64), pg_temp.fx('run')) RETURNING id) INSERT INTO fx SELECT 'm_soi', id FROM i;
  WITH i AS (INSERT INTO raw.artifact_member (artifact_id, member_path, byte_size, sha256, run_id)
    VALUES (pg_temp.fx('artifact'), 'num.tsv', 1, repeat('e', 64), pg_temp.fx('run')) RETURNING id) INSERT INTO fx SELECT 'm_num', id FROM i;

  WITH i AS (INSERT INTO raw.table_load (artifact_id, artifact_member_id, table_code, delimiter, header, header_sha256,
      parser_rule_version_id, row_count, field_count_mismatch_count, parse_status, run_id)
    VALUES (pg_temp.fx('artifact'), pg_temp.fx('m_sub'), 'SUB', E'\t', ARRAY['adsh', 'cik', 'name'], repeat('f', 64),
            pg_temp.fx('r_parser'), 1, 0, 'OK', pg_temp.fx('run')) RETURNING id) INSERT INTO fx SELECT 'l_sub', id FROM i;
  WITH i AS (INSERT INTO raw.table_load (artifact_id, artifact_member_id, table_code, delimiter, header, header_sha256,
      parser_rule_version_id, row_count, field_count_mismatch_count, parse_status, run_id)
    VALUES (pg_temp.fx('artifact'), pg_temp.fx('m_soi'), 'SOI', E'\t', soi_header, repeat('f', 64),
            pg_temp.fx('r_parser'), 4, 1, 'OK', pg_temp.fx('run')) RETURNING id) INSERT INTO fx SELECT 'l_soi', id FROM i;
  WITH i AS (INSERT INTO raw.table_load (artifact_id, artifact_member_id, table_code, delimiter, header, header_sha256,
      parser_rule_version_id, row_count, field_count_mismatch_count, parse_status, run_id)
    VALUES (pg_temp.fx('artifact'), pg_temp.fx('m_num'), 'NUM', E'\t',
            ARRAY['adsh', 'tag', 'version', 'ddate', 'qtrs', 'uom', 'segments', 'value'], repeat('f', 64),
            pg_temp.fx('r_parser'), 1, 0, 'OK', pg_temp.fx('run')) RETURNING id) INSERT INTO fx SELECT 'l_num', id FROM i;

  PERFORM pg_temp.put('row_sub', pg_temp.add_row(pg_temp.fx('l_sub'), 2, acc || E'\t9999999901\tTEST BDC 1'));
  -- Rows 2 and 3 share accession, identifier, ddate, and qtrs: the duplicate case from Phase 0.2.
  PERFORM pg_temp.put('row_soi_a', pg_temp.add_row(pg_temp.fx('l_soi'), 2,
    acc || E'\t9999999901\tTEST BDC 1\t2099-12-31\t0\tTEST BORROWER A | TEST LOAN 1\t100\t90\t\t0.05\t0.01'));
  PERFORM pg_temp.put('row_soi_b', pg_temp.add_row(pg_temp.fx('l_soi'), 3,
    acc || E'\t9999999901\tTEST BDC 1\t2099-12-31\t0\tTEST BORROWER A | TEST LOAN 1\t200\t0.00\t\t0.06\t'));
  PERFORM pg_temp.put('row_soi_total', pg_temp.add_row(pg_temp.fx('l_soi'), 4,
    acc || E'\t9999999901\tTEST BDC 1\t2099-12-31\t0\t\t300\t\t\t\t'));
  PERFORM pg_temp.put('row_soi_short', pg_temp.add_row(pg_temp.fx('l_soi'), 5, acc || E'\t9999999901\tTEST BDC 1'));
  PERFORM pg_temp.put('row_num', pg_temp.add_row(pg_temp.fx('l_num'), 2,
    acc || E'\tInvestmentOwnedAtCost\tTEST\t2099-12-31\t0\tUSD\tInvestmentIdentifierAxis=TEST BORROWER A | TEST LOAN 1;\t90'));

  PERFORM pg_temp.put('e_sub', pg_temp.add_evidence('L1_STRUCTURED_DATASET', pg_temp.fx('artifact'), pg_temp.fx('row_sub')));
  PERFORM pg_temp.put('e_soi_a', pg_temp.add_evidence('L1_STRUCTURED_DATASET', pg_temp.fx('artifact'), pg_temp.fx('row_soi_a')));
  PERFORM pg_temp.put('e_soi_b', pg_temp.add_evidence('L1_STRUCTURED_DATASET', pg_temp.fx('artifact'), pg_temp.fx('row_soi_b')));
  PERFORM pg_temp.put('e_soi_total', pg_temp.add_evidence('L1_STRUCTURED_DATASET', pg_temp.fx('artifact'), pg_temp.fx('row_soi_total')));
  PERFORM pg_temp.put('e_num', pg_temp.add_evidence('L1_STRUCTURED_DATASET', pg_temp.fx('artifact'), pg_temp.fx('row_num')));
  PERFORM pg_temp.put('e_ident_a', pg_temp.add_evidence('L1_STRUCTURED_DATASET', pg_temp.fx('artifact'), pg_temp.fx('row_soi_a'), 6, 'Investment, Identifier Axis'));
  PERFORM pg_temp.put('e_ident_b', pg_temp.add_evidence('L1_STRUCTURED_DATASET', pg_temp.fx('artifact'), pg_temp.fx('row_soi_b'), 6, 'Investment, Identifier Axis'));
  PERFORM pg_temp.put('e_name_a', pg_temp.add_evidence('L1_STRUCTURED_DATASET', pg_temp.fx('artifact'), pg_temp.fx('row_soi_a'), 3, 'name'));
  PERFORM pg_temp.put('e_name_b', pg_temp.add_evidence('L1_STRUCTURED_DATASET', pg_temp.fx('artifact'), pg_temp.fx('row_soi_b'), 3, 'name'));

  WITH i AS (INSERT INTO registry.registrant (cik, run_id, evidence_id)
    VALUES (9999999901, pg_temp.fx('run'), pg_temp.fx('e_sub')) RETURNING id) INSERT INTO fx SELECT 'registrant', id FROM i;
  WITH i AS (INSERT INTO registry.filing (accession_number, run_id, evidence_id)
    VALUES (acc, pg_temp.fx('run'), pg_temp.fx('e_sub')) RETURNING id) INSERT INTO fx SELECT 'filing', id FROM i;
  WITH i AS (INSERT INTO registry.filing_registrant_link (filing_id, registrant_id, link_source, run_id, evidence_id)
    VALUES (pg_temp.fx('filing'), pg_temp.fx('registrant'), 'SUB_TABLE', pg_temp.fx('run'), pg_temp.fx('e_sub')) RETURNING id) INSERT INTO fx SELECT 'link', id FROM i;
  WITH i AS (INSERT INTO registry.dataset_release (dataset_code, release_label, cadence, window_start, window_end, run_id, evidence_id)
    VALUES ('SEC_BDC_DATA_SETS', '2099_12', 'MONTHLY', '2099-12-01', '2099-12-31', pg_temp.fx('run'), pg_temp.fx('e_sub')) RETURNING id) INSERT INTO fx SELECT 'release', id FROM i;

  WITH i AS (INSERT INTO obs.soi_row_observation (tabular_row_id, filing_id, reported_date_raw, reported_date,
      date_precision, qtrs_raw, qtrs, duration_kind, identifier_raw, rule_version_id, evidence_id, run_id)
    VALUES (pg_temp.fx('row_soi_a'), pg_temp.fx('filing'), '2099-12-31', '2099-12-31', 'MONTH_END_ROUNDED', '0', 0,
            'POINT_IN_TIME', 'TEST BORROWER A | TEST LOAN 1', pg_temp.fx('r_project'), pg_temp.fx('e_soi_a'), pg_temp.fx('run'))
    RETURNING id) INSERT INTO fx SELECT 'soi_a', id FROM i;
  WITH i AS (INSERT INTO obs.soi_row_observation (tabular_row_id, filing_id, reported_date_raw, reported_date,
      date_precision, qtrs_raw, qtrs, duration_kind, identifier_raw, rule_version_id, evidence_id, run_id)
    VALUES (pg_temp.fx('row_soi_b'), pg_temp.fx('filing'), '2099-12-31', '2099-12-31', 'MONTH_END_ROUNDED', '0', 0,
            'POINT_IN_TIME', 'TEST BORROWER A | TEST LOAN 1', pg_temp.fx('r_project'), pg_temp.fx('e_soi_b'), pg_temp.fx('run'))
    RETURNING id) INSERT INTO fx SELECT 'soi_b', id FROM i;
  WITH i AS (INSERT INTO obs.soi_row_observation (tabular_row_id, filing_id, reported_date_raw, reported_date,
      date_precision, qtrs_raw, qtrs, duration_kind, identifier_raw, rule_version_id, evidence_id, run_id)
    VALUES (pg_temp.fx('row_soi_total'), pg_temp.fx('filing'), '2099-12-31', '2099-12-31', 'MONTH_END_ROUNDED', '0', 0,
            'POINT_IN_TIME', NULL, pg_temp.fx('r_project'), pg_temp.fx('e_soi_total'), pg_temp.fx('run'))
    RETURNING id) INSERT INTO fx SELECT 'soi_total', id FROM i;

  INSERT INTO obs.soi_row_classification (soi_row_observation_id, row_kind, period_role, rule_version_id, run_id)
  VALUES (pg_temp.fx('soi_a'), 'IDENTIFIER_ROW', 'UNRESOLVED', pg_temp.fx('r_classify'), pg_temp.fx('run')),
         (pg_temp.fx('soi_b'), 'IDENTIFIER_ROW', 'UNRESOLVED', pg_temp.fx('r_classify'), pg_temp.fx('run')),
         (pg_temp.fx('soi_total'), 'NO_IDENTIFIER_ROW', 'UNRESOLVED', pg_temp.fx('r_classify'), pg_temp.fx('run'));

  WITH i AS (INSERT INTO obs.position_observation (origin_soi_row_observation_id, filing_id, reported_date,
      date_precision, duration_kind, holding_descriptor_raw, rule_version_id, evidence_id, run_id)
    VALUES (pg_temp.fx('soi_a'), pg_temp.fx('filing'), '2099-12-31', 'MONTH_END_ROUNDED', 'POINT_IN_TIME',
            'TEST BORROWER A | TEST LOAN 1', pg_temp.fx('r_position'), pg_temp.fx('e_soi_a'), pg_temp.fx('run')) RETURNING id) INSERT INTO fx SELECT 'po_a', id FROM i;
  WITH i AS (INSERT INTO obs.position_observation (origin_soi_row_observation_id, filing_id, reported_date,
      date_precision, duration_kind, holding_descriptor_raw, rule_version_id, evidence_id, run_id)
    VALUES (pg_temp.fx('soi_b'), pg_temp.fx('filing'), '2099-12-31', 'MONTH_END_ROUNDED', 'POINT_IN_TIME',
            'TEST BORROWER A | TEST LOAN 1', pg_temp.fx('r_position'), pg_temp.fx('e_soi_b'), pg_temp.fx('run')) RETURNING id) INSERT INTO fx SELECT 'po_b', id FROM i;
  INSERT INTO obs.position_observation_source (position_observation_id, soi_row_observation_id, source_role, run_id)
  VALUES (pg_temp.fx('po_a'), pg_temp.fx('soi_a'), 'PRIMARY', pg_temp.fx('run')),
         (pg_temp.fx('po_b'), pg_temp.fx('soi_b'), 'PRIMARY', pg_temp.fx('run'));

  -- Field values for position observation A (column positions follow soi_header).
  PERFORM pg_temp.put('e_a_principal', pg_temp.add_evidence('L1_STRUCTURED_DATASET', pg_temp.fx('artifact'), pg_temp.fx('row_soi_a'), 7, soi_header[7]));
  PERFORM pg_temp.put('e_a_adj_cost', pg_temp.add_evidence('L1_STRUCTURED_DATASET', pg_temp.fx('artifact'), pg_temp.fx('row_soi_a'), 8, soi_header[8]));
  PERFORM pg_temp.put('e_a_preset_cost', pg_temp.add_evidence('L1_STRUCTURED_DATASET', pg_temp.fx('artifact'), pg_temp.fx('row_soi_a'), 9, soi_header[9]));
  PERFORM pg_temp.put('e_a_rate', pg_temp.add_evidence('L1_STRUCTURED_DATASET', pg_temp.fx('artifact'), pg_temp.fx('row_soi_a'), 10, soi_header[10]));
  PERFORM pg_temp.put('e_a_pik', pg_temp.add_evidence('L1_STRUCTURED_DATASET', pg_temp.fx('artifact'), pg_temp.fx('row_soi_a'), 11, soi_header[11]));
  PERFORM pg_temp.put('e_b_adj_cost', pg_temp.add_evidence('L1_STRUCTURED_DATASET', pg_temp.fx('artifact'), pg_temp.fx('row_soi_b'), 8, soi_header[8]));

  WITH i AS (INSERT INTO obs.position_field_value (position_observation_id, field_code, column_mapping_id,
      source_column_label, source_column_position, raw_value, normalized_numeric, currency_state, scale_state, value_state,
      normalization_rule_version_id, evidence_id, run_id)
    VALUES (pg_temp.fx('po_a'), 'PRINCIPAL_AMOUNT', pg_temp.mapping(soi_header[7]), soi_header[7], 7, '100', 100,
            'UNKNOWN', 'NOT_APPLICABLE', 'REPORTED', pg_temp.fx('r_field'), pg_temp.fx('e_a_principal'), pg_temp.fx('run')) RETURNING id) INSERT INTO fx SELECT 'fv_principal', id FROM i;
  WITH i AS (INSERT INTO obs.position_field_value (position_observation_id, field_code, column_mapping_id,
      source_column_label, source_column_position, raw_value, normalized_numeric, currency_state, scale_state, value_state,
      normalization_rule_version_id, evidence_id, run_id)
    VALUES (pg_temp.fx('po_a'), 'COST', pg_temp.mapping(soi_header[8]), soi_header[8], 8, '90', 90,
            'UNKNOWN', 'NOT_APPLICABLE', 'REPORTED', pg_temp.fx('r_field'), pg_temp.fx('e_a_adj_cost'), pg_temp.fx('run')) RETURNING id) INSERT INTO fx SELECT 'fv_adj_cost', id FROM i;
  WITH i AS (INSERT INTO obs.position_field_value (position_observation_id, field_code, column_mapping_id,
      source_column_label, source_column_position, raw_value, currency_state, scale_state, value_state, unknown_reason,
      normalization_rule_version_id, evidence_id, run_id)
    VALUES (pg_temp.fx('po_a'), 'COST', pg_temp.mapping(soi_header[9]), soi_header[9], 9, '',
            'UNKNOWN', 'NOT_APPLICABLE', 'UNKNOWN', 'empty cell', pg_temp.fx('r_field'), pg_temp.fx('e_a_preset_cost'), pg_temp.fx('run')) RETURNING id) INSERT INTO fx SELECT 'fv_preset_cost', id FROM i;
  WITH i AS (INSERT INTO obs.position_field_value (position_observation_id, field_code, column_mapping_id,
      source_column_label, source_column_position, raw_value, currency_state, scale_state, value_state,
      normalization_rule_version_id, evidence_id, run_id)
    VALUES (pg_temp.fx('po_a'), 'INTEREST_RATE', pg_temp.mapping(soi_header[10]), soi_header[10], 10, '0.05',
            'UNKNOWN', 'UNRESOLVED', 'REPORTED', pg_temp.fx('r_field'), pg_temp.fx('e_a_rate'), pg_temp.fx('run')) RETURNING id) INSERT INTO fx SELECT 'fv_rate', id FROM i;
  WITH i AS (INSERT INTO obs.position_field_value (position_observation_id, field_code, column_mapping_id,
      source_column_label, source_column_position, raw_value, normalized_numeric, currency_state, scale_state, value_state,
      normalization_rule_version_id, evidence_id, run_id)
    VALUES (pg_temp.fx('po_a'), 'PIK_RATE', pg_temp.mapping(soi_header[11]), soi_header[11], 11, '0.01', 0.01,
            'UNKNOWN', 'KNOWN', 'REPORTED', pg_temp.fx('r_field'), pg_temp.fx('e_a_pik'), pg_temp.fx('run')) RETURNING id) INSERT INTO fx SELECT 'fv_pik', id FROM i;

  WITH i AS (INSERT INTO obs.num_fact_observation (tabular_row_id, filing_id, tag, tag_version, reported_date_raw,
      reported_date, qtrs_raw, qtrs, duration_kind, uom_raw, segments_raw, identifier_member_raw, value_raw, value_numeric,
      value_state, rule_version_id, evidence_id, run_id)
    VALUES (pg_temp.fx('row_num'), pg_temp.fx('filing'), 'InvestmentOwnedAtCost', 'TEST', '2099-12-31', '2099-12-31', '0', 0,
            'POINT_IN_TIME', 'USD', 'InvestmentIdentifierAxis=TEST BORROWER A | TEST LOAN 1;', 'TEST BORROWER A | TEST LOAN 1',
            '90', 90, 'REPORTED', pg_temp.fx('r_project'), pg_temp.fx('e_num'), pg_temp.fx('run')) RETURNING id) INSERT INTO fx SELECT 'num_fact', id FROM i;

  INSERT INTO obs.field_value_corroboration (field_value_id, num_fact_observation_id, outcome, join_basis, rule_version_id, run_id)
  VALUES (pg_temp.fx('fv_adj_cost'), pg_temp.fx('num_fact'), 'EQUAL', 'OBSERVED_UNDOCUMENTED', pg_temp.fx('r_validate'), pg_temp.fx('run'));
END
$$;

-- The fixture itself must satisfy every deferred constraint.
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
