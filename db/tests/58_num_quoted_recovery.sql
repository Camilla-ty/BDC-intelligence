-- Group 58: NUM quoted-TSV recovery sidecar and projection gates (ADR 0019).
-- All values are obviously fake (TEST BORROWER A, accession 0000000000-00-000001, dates in 2099).

SELECT pg_temp.check('QUOTED_RECOVERY is a parse_status value', EXISTS (
  SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
  WHERE t.typname = 'parse_status' AND e.enumlabel = 'QUOTED_RECOVERY'));

SELECT pg_temp.expect_error('QUOTED_RECOVERY is rejected on a SOI row', 'BDCI1', ARRAY[format(
  $$INSERT INTO raw.tabular_row (table_load_id, line_number, raw_line, raw_line_sha256, cells, field_count, parse_status, run_id)
    SELECT %s, 99, 'TEST ONLY' || E'\ttoo\tmany', encode(sha256(convert_to('TEST ONLY' || E'\ttoo\tmany', 'UTF8')), 'hex'),
           string_to_array('TEST ONLY' || E'\ttoo\tmany', E'\t'), 3, 'QUOTED_RECOVERY', %s$$,
  pg_temp.fx('l_soi'), pg_temp.fx('run'))]);

SELECT pg_temp.check('SOI extra-field rows remain FIELD_COUNT_MISMATCH', (
  SELECT parse_status = 'FIELD_COUNT_MISMATCH' FROM raw.tabular_row WHERE id = pg_temp.fx('row_soi_short')));

SELECT pg_temp.check('obs.cell_by_label still reads naive SOI cells',
  obs.cell_by_label(pg_temp.fx('row_soi_a'), 'Investment, Identifier Axis') = 'TEST BORROWER A | TEST LOAN 1');

SELECT pg_temp.put('r_parser_num11', pg_temp.add_rule('test.num_quoted_parser', 'PARSER'));

WITH i AS (
  INSERT INTO raw.table_load (artifact_id, artifact_member_id, table_code, delimiter, header, header_sha256,
      parser_rule_version_id, row_count, field_count_mismatch_count, parse_status, run_id)
  VALUES (pg_temp.fx('artifact'), pg_temp.fx('m_num'), 'NUM', E'\t',
          ARRAY['adsh', 'tag', 'version', 'ddate', 'qtrs', 'uom', 'segments', 'dimn', 'value', 'footnote', 'footlen'],
          repeat('9', 64), pg_temp.fx('r_parser_num11'), 3, 3, 'OK', pg_temp.fx('run'))
  RETURNING id)
INSERT INTO fx SELECT 'l_num11', id FROM i;

-- Quoted extra tab inside segments; naive width 12; recovered width 11; D6 pass (empty footnote, footlen 0).
SELECT pg_temp.expect_ok('a valid quoted NUM row stores naive cells and a sidecar', ARRAY[format(
  $$WITH raw_ins AS (
      INSERT INTO raw.tabular_row (table_load_id, line_number, raw_line, raw_line_sha256, cells, field_count, parse_status, run_id)
      SELECT %s, 2, %L, encode(sha256(convert_to(%L, 'UTF8')), 'hex'),
             string_to_array(%L, E'\t'), cardinality(string_to_array(%L, E'\t')),
             'QUOTED_RECOVERY', %s
      RETURNING id
    )
    INSERT INTO raw.num_quoted_recovery (tabular_row_id, recovered_cells, recovered_field_count, parser_rule_version_id, run_id)
    SELECT id, ARRAY[
      '0000000000-00-000001', 'InvestmentOwnedAtCost', 'us-gaap/2099', '20991231', '0', 'USD',
      E'InvestmentIdentifierAxis(us-gaap/2099)=TEST BORROWER A | TEST LOAN 1\t();',
      '1', '100', '', '0'
    ]::text[], 11, %s, %s
    FROM raw_ins$$,
  pg_temp.fx('l_num11'),
  E'0000000000-00-000001\tInvestmentOwnedAtCost\tus-gaap/2099\t20991231\t0\tUSD\t"InvestmentIdentifierAxis(us-gaap/2099)=TEST BORROWER A | TEST LOAN 1\t();"\t1\t100\t\t0',
  E'0000000000-00-000001\tInvestmentOwnedAtCost\tus-gaap/2099\t20991231\t0\tUSD\t"InvestmentIdentifierAxis(us-gaap/2099)=TEST BORROWER A | TEST LOAN 1\t();"\t1\t100\t\t0',
  E'0000000000-00-000001\tInvestmentOwnedAtCost\tus-gaap/2099\t20991231\t0\tUSD\t"InvestmentIdentifierAxis(us-gaap/2099)=TEST BORROWER A | TEST LOAN 1\t();"\t1\t100\t\t0',
  E'0000000000-00-000001\tInvestmentOwnedAtCost\tus-gaap/2099\t20991231\t0\tUSD\t"InvestmentIdentifierAxis(us-gaap/2099)=TEST BORROWER A | TEST LOAN 1\t();"\t1\t100\t\t0',
  pg_temp.fx('run'), pg_temp.fx('r_parser_num11'), pg_temp.fx('run')),
  'SET CONSTRAINTS ALL IMMEDIATE']);
SET CONSTRAINTS ALL DEFERRED;

INSERT INTO fx
SELECT 'row_num_qr', r.id
FROM raw.tabular_row r
WHERE r.table_load_id = pg_temp.fx('l_num11') AND r.line_number = 2;

SELECT pg_temp.check('naive cells keep the tab split, including the opening quote', (
  SELECT field_count = 12 AND cells[7] LIKE '"InvestmentIdentifierAxis%'
    AND parse_status = 'QUOTED_RECOVERY'
  FROM raw.tabular_row WHERE id = pg_temp.fx('row_num_qr')));

SELECT pg_temp.check('obs.cell_by_label on a recovered NUM row stays naive',
  obs.cell_by_label(pg_temp.fx('row_num_qr'), 'value') IS DISTINCT FROM '100');

SELECT pg_temp.check('obs.num_cell_by_label reads recovered cells and keeps the identifier tab',
  obs.num_cell_by_label(pg_temp.fx('row_num_qr'), 'value') = '100'
  AND obs.num_cell_by_label(pg_temp.fx('row_num_qr'), 'uom') = 'USD'
  AND obs.num_cell_by_label(pg_temp.fx('row_num_qr'), 'adsh') = '0000000000-00-000001'
  AND obs.num_cell_by_label(pg_temp.fx('row_num_qr'), 'segments') LIKE E'%TEST LOAN 1\t();%'
  AND raw.num_quoted_footlen_ok(
        (SELECT recovered_cells FROM raw.num_quoted_recovery WHERE tabular_row_id = pg_temp.fx('row_num_qr')),
        (SELECT header FROM raw.table_load WHERE id = pg_temp.fx('l_num11'))));

SELECT pg_temp.expect_error('a sidecar cannot be attached to an OK NUM row', 'BDCI1', ARRAY[format(
  $$INSERT INTO raw.num_quoted_recovery (tabular_row_id, recovered_cells, recovered_field_count, parser_rule_version_id, run_id)
    VALUES (%s, ARRAY['0000000000-00-000001','InvestmentOwnedAtCost','TEST','20991231','0','USD','x','1','90','','0']::text[], 11, %s, %s)$$,
  pg_temp.fx('row_num'), pg_temp.fx('r_parser_num11'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('a second sidecar for the same recovered row is rejected', '23505', ARRAY[format(
  $$INSERT INTO raw.num_quoted_recovery (tabular_row_id, recovered_cells, recovered_field_count, parser_rule_version_id, run_id)
    VALUES (%s, ARRAY[
      '0000000000-00-000001', 'InvestmentOwnedAtCost', 'us-gaap/2099', '20991231', '0', 'USD',
      E'InvestmentIdentifierAxis(us-gaap/2099)=TEST BORROWER A | TEST LOAN 1\t();',
      '1', '100', '', '0'
    ]::text[], 11, %s, %s)$$,
  pg_temp.fx('row_num_qr'), pg_temp.fx('r_parser_num11'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('the recovery sidecar is append-only', 'BDCA1', ARRAY[format(
  $$UPDATE raw.num_quoted_recovery SET recovered_field_count = recovered_field_count WHERE tabular_row_id = %s$$,
  pg_temp.fx('row_num_qr'))]);

SELECT pg_temp.expect_error('QUOTED_RECOVERY without a sidecar fails at commit', 'BDCL1', ARRAY[format(
  $$INSERT INTO raw.tabular_row (table_load_id, line_number, raw_line, raw_line_sha256, cells, field_count, parse_status, run_id)
    SELECT %s, 3, %L, encode(sha256(convert_to(%L, 'UTF8')), 'hex'),
           string_to_array(%L, E'\t'), cardinality(string_to_array(%L, E'\t')),
           'QUOTED_RECOVERY', %s$$,
  pg_temp.fx('l_num11'),
  E'0000000000-00-000001\tInvestmentOwnedAtCost\tus-gaap/2099\t20991231\t0\tUSD\t"InvestmentIdentifierAxis(us-gaap/2099)=TEST BORROWER B | TEST LOAN 2\t();"\t1\t80\t\t0',
  E'0000000000-00-000001\tInvestmentOwnedAtCost\tus-gaap/2099\t20991231\t0\tUSD\t"InvestmentIdentifierAxis(us-gaap/2099)=TEST BORROWER B | TEST LOAN 2\t();"\t1\t80\t\t0',
  E'0000000000-00-000001\tInvestmentOwnedAtCost\tus-gaap/2099\t20991231\t0\tUSD\t"InvestmentIdentifierAxis(us-gaap/2099)=TEST BORROWER B | TEST LOAN 2\t();"\t1\t80\t\t0',
  E'0000000000-00-000001\tInvestmentOwnedAtCost\tus-gaap/2099\t20991231\t0\tUSD\t"InvestmentIdentifierAxis(us-gaap/2099)=TEST BORROWER B | TEST LOAN 2\t();"\t1\t80\t\t0',
  pg_temp.fx('run')),
  'SET CONSTRAINTS ALL IMMEDIATE']);
SET CONSTRAINTS ALL DEFERRED;

-- D6-fail recovered row: empty footnote with footlen 4.
SELECT pg_temp.expect_ok('a D6-fail recovered row may be stored with a sidecar', ARRAY[format(
  $$WITH raw_ins AS (
      INSERT INTO raw.tabular_row (table_load_id, line_number, raw_line, raw_line_sha256, cells, field_count, parse_status, run_id)
      SELECT %s, 4, %L, encode(sha256(convert_to(%L, 'UTF8')), 'hex'),
             string_to_array(%L, E'\t'), cardinality(string_to_array(%L, E'\t')),
             'QUOTED_RECOVERY', %s
      RETURNING id
    )
    INSERT INTO raw.num_quoted_recovery (tabular_row_id, recovered_cells, recovered_field_count, parser_rule_version_id, run_id)
    SELECT id, ARRAY[
      '0000000000-00-000001', 'InvestmentOwnedAtCost', 'us-gaap/2099', '20991231', '0', 'USD',
      E'InvestmentIdentifierAxis(us-gaap/2099)=TEST BORROWER A | TEST LOAN 1\t();',
      '1', '70', '', '4'
    ]::text[], 11, %s, %s
    FROM raw_ins$$,
  pg_temp.fx('l_num11'),
  E'0000000000-00-000001\tInvestmentOwnedAtCost\tus-gaap/2099\t20991231\t0\tUSD\t"InvestmentIdentifierAxis(us-gaap/2099)=TEST BORROWER A | TEST LOAN 1\t();"\t1\t70\t\t4',
  E'0000000000-00-000001\tInvestmentOwnedAtCost\tus-gaap/2099\t20991231\t0\tUSD\t"InvestmentIdentifierAxis(us-gaap/2099)=TEST BORROWER A | TEST LOAN 1\t();"\t1\t70\t\t4',
  E'0000000000-00-000001\tInvestmentOwnedAtCost\tus-gaap/2099\t20991231\t0\tUSD\t"InvestmentIdentifierAxis(us-gaap/2099)=TEST BORROWER A | TEST LOAN 1\t();"\t1\t70\t\t4',
  E'0000000000-00-000001\tInvestmentOwnedAtCost\tus-gaap/2099\t20991231\t0\tUSD\t"InvestmentIdentifierAxis(us-gaap/2099)=TEST BORROWER A | TEST LOAN 1\t();"\t1\t70\t\t4',
  pg_temp.fx('run'), pg_temp.fx('r_parser_num11'), pg_temp.fx('run')),
  'SET CONSTRAINTS ALL IMMEDIATE']);
SET CONSTRAINTS ALL DEFERRED;

INSERT INTO fx
SELECT 'row_num_d6', r.id
FROM raw.tabular_row r
WHERE r.table_load_id = pg_temp.fx('l_num11') AND r.line_number = 4;

SELECT pg_temp.check('D6 fails for empty footnote with footlen 4',
  NOT raw.num_quoted_footlen_ok(
    (SELECT recovered_cells FROM raw.num_quoted_recovery WHERE tabular_row_id = pg_temp.fx('row_num_d6')),
    (SELECT header FROM raw.table_load WHERE id = pg_temp.fx('l_num11'))));

SELECT pg_temp.expect_error('FOOTLEN_MISMATCH cannot point at an OK row', 'BDCI1', ARRAY[format(
  $$INSERT INTO ops.projection_exception (table_load_id, tabular_row_id, kind, detail, evidence_id, rule_version_id, run_id)
    VALUES (%s, %s, 'FOOTLEN_MISMATCH', 'TEST ONLY', %s, %s, %s)$$,
  pg_temp.fx('l_num'), pg_temp.fx('row_num'), pg_temp.fx('e_num'), pg_temp.fx('r_project'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_ok('FOOTLEN_MISMATCH can quarantine a QUOTED_RECOVERY row', ARRAY[format(
  $$INSERT INTO ops.projection_exception (table_load_id, tabular_row_id, kind, detail, evidence_id, rule_version_id, run_id)
    VALUES (%s, %s, 'FOOTLEN_MISMATCH', 'TEST ONLY: footlen mismatch', %s, %s, %s)$$,
  pg_temp.fx('l_num11'), pg_temp.fx('row_num_d6'),
  pg_temp.add_evidence('L1_STRUCTURED_DATASET', pg_temp.fx('artifact'), pg_temp.fx('row_num_d6')),
  pg_temp.fx('r_project'), pg_temp.fx('run'))]);

WITH e AS (
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, tabular_row_id, run_id)
  VALUES ('L1_STRUCTURED_DATASET', pg_temp.fx('artifact'), 'TSV_ROW', pg_temp.fx('row_num_d6'), pg_temp.fx('run'))
  RETURNING id)
SELECT pg_temp.expect_error('a D6-fail recovered row cannot be projected', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.num_fact_observation (tabular_row_id, filing_id, tag, tag_version, reported_date_raw, reported_date,
      qtrs_raw, qtrs, duration_kind, uom_raw, segments_raw, identifier_member_raw, value_raw, value_numeric,
      value_state, rule_version_id, evidence_id, run_id)
    VALUES (%s, %s, 'InvestmentOwnedAtCost', 'us-gaap/2099', '20991231', '2099-12-31', '0', 0, 'POINT_IN_TIME',
            'USD', E'InvestmentIdentifierAxis(us-gaap/2099)=TEST BORROWER A | TEST LOAN 1\t();',
            E'TEST BORROWER A | TEST LOAN 1\t', '70', 70, 'REPORTED', %s, %s, %s)$$,
  pg_temp.fx('row_num_d6'), pg_temp.fx('filing'), pg_temp.fx('r_project'),
  (SELECT id FROM e), pg_temp.fx('run'))]);

WITH e AS (
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, tabular_row_id, run_id)
  VALUES ('L1_STRUCTURED_DATASET', pg_temp.fx('artifact'), 'TSV_ROW', pg_temp.fx('row_num_qr'), pg_temp.fx('run'))
  RETURNING id)
INSERT INTO fx SELECT 'e_num_qr', id FROM e;

SELECT pg_temp.expect_ok('a D6-pass recovered row may project from recovered cells', ARRAY[format(
  $$INSERT INTO obs.num_fact_observation (tabular_row_id, filing_id, tag, tag_version, reported_date_raw, reported_date,
      qtrs_raw, qtrs, duration_kind, uom_raw, segments_raw, identifier_member_raw, value_raw, value_numeric,
      value_state, rule_version_id, evidence_id, run_id)
    VALUES (%s, %s, 'InvestmentOwnedAtCost', 'us-gaap/2099', '20991231', '2099-12-31', '0', 0, 'POINT_IN_TIME',
            'USD', E'InvestmentIdentifierAxis(us-gaap/2099)=TEST BORROWER A | TEST LOAN 1\t();',
            E'TEST BORROWER A | TEST LOAN 1\t', '100', 100, 'REPORTED', %s, %s, %s)$$,
  pg_temp.fx('row_num_qr'), pg_temp.fx('filing'), pg_temp.fx('r_project'),
  pg_temp.fx('e_num_qr'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('recovered projection cannot use naive shifted value text', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.num_fact_observation (tabular_row_id, filing_id, tag, tag_version, reported_date_raw, reported_date,
      qtrs_raw, qtrs, duration_kind, uom_raw, segments_raw, value_raw, value_numeric,
      value_state, rule_version_id, evidence_id, run_id)
    VALUES (%s, %s, 'InvestmentOwnedAtCost', 'us-gaap/2099', '20991231', '2099-12-31', '0', 0, 'POINT_IN_TIME',
            'USD', E'InvestmentIdentifierAxis(us-gaap/2099)=TEST BORROWER A | TEST LOAN 1\t();',
            '1', 1, 'REPORTED', %s, %s, %s)$$,
  pg_temp.fx('row_num_qr'), pg_temp.fx('filing'), pg_temp.fx('r_project2'),
  pg_temp.fx('e_num_qr'), pg_temp.fx('run'))]);
