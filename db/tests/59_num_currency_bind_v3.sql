-- Group 59: NUM currency binding v3 exclusions and per-batch checkpoints (ADR 0022).
-- All values are obviously fake (TEST BORROWER A, accession 0000000000-00-000001, dates in 2099).

-- A second SOI load whose header carries the two dimension columns, with one row and one
-- PRINCIPAL_AMOUNT value, so SOI exclusions can be checked against a real cell.
DO $$
DECLARE
  hdr constant text[] := ARRAY['adsh', 'cik', 'name', 'ddate', 'qtrs', 'Investment, Identifier Axis',
    'Investment Owned, Balance, Principal Amount', 'Investment Company, Nonconsolidated Subsidiary Axis', 'Range Axis'];
  line constant text := '0000000000-00-000001' || E'\t9999999901\tTEST BDC 1\t2099-12-31\t0\tTEST BORROWER A | TEST JV\t100\tTEST ONLY Subsidiary [Member]\t';
  row_id bigint;
  ev_row bigint;
  ev_cell bigint;
  soi_id bigint;
  po_id bigint;
BEGIN
  PERFORM pg_temp.put('r_parser_soi_dim', pg_temp.add_rule('test.soi_dimension_parser', 'PARSER'));
  WITH i AS (
    INSERT INTO raw.table_load (artifact_id, artifact_member_id, table_code, delimiter, header, header_sha256,
        parser_rule_version_id, row_count, field_count_mismatch_count, parse_status, run_id)
    VALUES (pg_temp.fx('artifact'), pg_temp.fx('m_soi'), 'SOI', E'\t', hdr, repeat('8', 64),
            pg_temp.fx('r_parser_soi_dim'), 1, 0, 'OK', pg_temp.fx('run'))
    RETURNING id)
  INSERT INTO fx SELECT 'l_soi_dim', id FROM i;
  row_id := pg_temp.add_row(pg_temp.fx('l_soi_dim'), 2, line);
  ev_row := pg_temp.add_evidence('L1_STRUCTURED_DATASET', pg_temp.fx('artifact'), row_id);
  ev_cell := pg_temp.add_evidence('L1_STRUCTURED_DATASET', pg_temp.fx('artifact'), row_id, 7, hdr[7]);
  INSERT INTO obs.soi_row_observation (tabular_row_id, filing_id, reported_date_raw, reported_date,
      date_precision, qtrs_raw, qtrs, duration_kind, identifier_raw, rule_version_id, evidence_id, run_id)
  VALUES (row_id, pg_temp.fx('filing'), '2099-12-31', '2099-12-31', 'MONTH_END_ROUNDED', '0', 0,
          'POINT_IN_TIME', 'TEST BORROWER A | TEST JV', pg_temp.fx('r_project'), ev_row, pg_temp.fx('run'))
  RETURNING id INTO soi_id;
  INSERT INTO obs.soi_row_classification (soi_row_observation_id, row_kind, period_role, rule_version_id, run_id)
  VALUES (soi_id, 'IDENTIFIER_ROW', 'UNRESOLVED', pg_temp.fx('r_classify'), pg_temp.fx('run'));
  INSERT INTO obs.position_observation (origin_soi_row_observation_id, filing_id, reported_date,
      date_precision, duration_kind, holding_descriptor_raw, rule_version_id, evidence_id, run_id)
  VALUES (soi_id, pg_temp.fx('filing'), '2099-12-31', 'MONTH_END_ROUNDED', 'POINT_IN_TIME',
          'TEST BORROWER A | TEST JV', pg_temp.fx('r_position'), ev_row, pg_temp.fx('run'))
  RETURNING id INTO po_id;
  INSERT INTO obs.position_observation_source (position_observation_id, soi_row_observation_id, source_role, run_id)
  VALUES (po_id, soi_id, 'PRIMARY', pg_temp.fx('run'));
  WITH i AS (INSERT INTO obs.position_field_value (position_observation_id, field_code, column_mapping_id,
      source_column_label, source_column_position, raw_value, normalized_numeric, currency_state, scale_state, value_state,
      normalization_rule_version_id, evidence_id, run_id)
    VALUES (po_id, 'PRINCIPAL_AMOUNT', pg_temp.mapping(hdr[7]), hdr[7], 7, '100', 100,
            'UNKNOWN', 'NOT_APPLICABLE', 'REPORTED', pg_temp.fx('r_field'), ev_cell, pg_temp.fx('run')) RETURNING id)
  INSERT INTO fx SELECT 'fv_jv_principal', id FROM i;
END
$$;

SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

-- Exclusions

SELECT pg_temp.expect_ok('a SOI subsidiary exclusion stores the origin-row cell exactly as disclosed', ARRAY[format(
  $$INSERT INTO obs.field_value_currency_exclusion (field_value_id, reason, soi_column_label, soi_cell_raw, rule_version_id, run_id)
    VALUES (%s, 'SOI_NONCONSOLIDATED_SUBSIDIARY_AXIS', 'Investment Company, Nonconsolidated Subsidiary Axis',
            'TEST ONLY Subsidiary [Member]', %s, %s)$$,
  pg_temp.fx('fv_jv_principal'), pg_temp.fx('r_validate'), pg_temp.fx('run'))]);

SELECT pg_temp.check('the field value keeps currency UNKNOWN after an exclusion', (
  SELECT currency_state = 'UNKNOWN' AND currency_code IS NULL FROM obs.current_position_field_value
  WHERE id = pg_temp.fx('fv_jv_principal')));

SELECT pg_temp.expect_error('the same exclusion cannot be recorded twice for one rule', '23505', ARRAY[format(
  $$INSERT INTO obs.field_value_currency_exclusion (field_value_id, reason, soi_column_label, soi_cell_raw, rule_version_id, run_id)
    VALUES (%s, 'SOI_NONCONSOLIDATED_SUBSIDIARY_AXIS', 'Investment Company, Nonconsolidated Subsidiary Axis',
            'TEST ONLY Subsidiary [Member]', %s, %s)$$,
  pg_temp.fx('fv_jv_principal'), pg_temp.fx('r_validate'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('a SOI cell that differs from the origin row is rejected', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.field_value_currency_exclusion (field_value_id, reason, soi_column_label, soi_cell_raw, rule_version_id, run_id)
    VALUES (%s, 'SOI_NONCONSOLIDATED_SUBSIDIARY_AXIS', 'Investment Company, Nonconsolidated Subsidiary Axis',
            'TEST ONLY Other [Member]', %s, %s)$$,
  pg_temp.fx('fv_jv_principal'), pg_temp.fx('r_coverage'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('a blank SOI range cell cannot be recorded as an exclusion', '23514', ARRAY[format(
  $$INSERT INTO obs.field_value_currency_exclusion (field_value_id, reason, soi_column_label, soi_cell_raw, rule_version_id, run_id)
    VALUES (%s, 'SOI_RANGE_AXIS', 'Range Axis', '', %s, %s)$$,
  pg_temp.fx('fv_jv_principal'), pg_temp.fx('r_validate'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('a SOI range exclusion on a header without the column is rejected', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.field_value_currency_exclusion (field_value_id, reason, soi_column_label, soi_cell_raw, rule_version_id, run_id)
    VALUES (%s, 'SOI_RANGE_AXIS', 'Range Axis', 'Maximum [Member]', %s, %s)$$,
  pg_temp.fx('fv_principal'), pg_temp.fx('r_validate'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('a SOI reason paired with the wrong column label is rejected', '23514', ARRAY[format(
  $$INSERT INTO obs.field_value_currency_exclusion (field_value_id, reason, soi_column_label, soi_cell_raw, rule_version_id, run_id)
    VALUES (%s, 'SOI_RANGE_AXIS', 'Investment Company, Nonconsolidated Subsidiary Axis', 'TEST ONLY Subsidiary [Member]', %s, %s)$$,
  pg_temp.fx('fv_jv_principal'), pg_temp.fx('r_validate'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('a SOI reason cannot carry a NUM fact', '23514', ARRAY[format(
  $$INSERT INTO obs.field_value_currency_exclusion (field_value_id, reason, soi_column_label, soi_cell_raw,
      num_fact_observation_id, num_axis, rule_version_id, run_id)
    VALUES (%s, 'SOI_NONCONSOLIDATED_SUBSIDIARY_AXIS', 'Investment Company, Nonconsolidated Subsidiary Axis',
            'TEST ONLY Subsidiary [Member]', %s, 'RangeAxis', %s, %s)$$,
  pg_temp.fx('fv_jv_principal'), pg_temp.fx('num_fact'), pg_temp.fx('r_coverage'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('an unknown exclusion reason is rejected', '23514', ARRAY[format(
  $$INSERT INTO obs.field_value_currency_exclusion (field_value_id, reason, num_fact_observation_id, num_axis, rule_version_id, run_id)
    VALUES (%s, 'TEST_ONLY_REASON', %s, 'RangeAxis', %s, %s)$$,
  pg_temp.fx('fv_principal'), pg_temp.fx('num_fact'), pg_temp.fx('r_validate'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('an unlisted NUM axis is rejected', '23514', ARRAY[format(
  $$INSERT INTO obs.field_value_currency_exclusion (field_value_id, reason, num_fact_observation_id, num_axis, rule_version_id, run_id)
    VALUES (%s, 'NUM_PROHIBITED_DIMENSION', %s, 'InvestmentIdentifierAxis', %s, %s)$$,
  pg_temp.fx('fv_principal'), pg_temp.fx('num_fact'), pg_temp.fx('r_validate'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('a NUM exclusion whose fact does not carry the axis is rejected', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.field_value_currency_exclusion (field_value_id, reason, num_fact_observation_id, num_axis, rule_version_id, run_id)
    VALUES (%s, 'NUM_PROHIBITED_DIMENSION', %s, 'RangeAxis', %s, %s)$$,
  pg_temp.fx('fv_principal'), pg_temp.fx('num_fact'), pg_temp.fx('r_validate'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('a non-monetary field value cannot be excluded', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.field_value_currency_exclusion (field_value_id, reason, num_fact_observation_id, num_axis, rule_version_id, run_id)
    VALUES (%s, 'NUM_PROHIBITED_DIMENSION', %s, 'RangeAxis', %s, %s)$$,
  pg_temp.fx('fv_rate'), pg_temp.fx('num_fact'), pg_temp.fx('r_validate'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('an exclusion is append-only', 'BDCA1', ARRAY[
  $$UPDATE obs.field_value_currency_exclusion SET soi_cell_raw = 'TEST ONLY Other [Member]'$$]);

SELECT pg_temp.check('the writer can insert exclusions and checkpoints but not update them', (
  has_table_privilege('bdc_pipeline_writer', 'obs.field_value_currency_exclusion', 'INSERT')
  AND has_table_privilege('bdc_pipeline_writer', 'ops.num_currency_bind_batch', 'INSERT')
  AND NOT has_table_privilege('bdc_pipeline_writer', 'obs.field_value_currency_exclusion', 'UPDATE')
  AND NOT has_table_privilege('bdc_pipeline_writer', 'ops.num_currency_bind_batch', 'UPDATE')));

-- Checkpoints

-- Started through the 0068 protocol: this session holds the run's liveness lock (0069).
SELECT pg_temp.put('bind_run', ops.start_num_currency_bind_run(
  'test', '{"uniqueness": "unique-fact"}'::jsonb, NULL, 'test-1', repeat('c', 64)));
INSERT INTO ops.run_rule_version (run_id, rule_version_id) VALUES (pg_temp.fx('bind_run'), pg_temp.fx('r_validate'));

CREATE TEMP VIEW bind_ids AS
SELECT least(pg_temp.fx('fv_principal'), pg_temp.fx('fv_adj_cost')) AS lo,
       greatest(pg_temp.fx('fv_principal'), pg_temp.fx('fv_adj_cost')) AS hi;

SELECT pg_temp.expect_ok('the first checkpoint of a binder run is accepted', ARRAY[format(
  $$INSERT INTO ops.num_currency_bind_batch (run_id, rule_version_id, batch_index, first_field_value_id, last_field_value_id,
      heads_in_batch, successors_written, equal_written, not_equal_written, multiple_written, exclusions_written)
    VALUES (%s, %s, 1, %s, %s, 1, 0, 0, 0, 0, 0)$$,
  pg_temp.fx('bind_run'), pg_temp.fx('r_validate'), (SELECT lo FROM bind_ids), (SELECT lo FROM bind_ids))]);

SELECT pg_temp.expect_error('a checkpoint that skips a batch index is rejected', 'BDCI1', ARRAY[format(
  $$INSERT INTO ops.num_currency_bind_batch (run_id, rule_version_id, batch_index, first_field_value_id, last_field_value_id,
      heads_in_batch, successors_written, equal_written, not_equal_written, multiple_written, exclusions_written)
    VALUES (%s, %s, 3, %s, %s, 1, 0, 0, 0, 0, 0)$$,
  pg_temp.fx('bind_run'), pg_temp.fx('r_validate'), (SELECT hi FROM bind_ids), (SELECT hi FROM bind_ids))]);

SELECT pg_temp.expect_error('a checkpoint whose head range overlaps the previous batch is rejected', 'BDCI1', ARRAY[format(
  $$INSERT INTO ops.num_currency_bind_batch (run_id, rule_version_id, batch_index, first_field_value_id, last_field_value_id,
      heads_in_batch, successors_written, equal_written, not_equal_written, multiple_written, exclusions_written)
    VALUES (%s, %s, 2, %s, %s, 1, 0, 0, 0, 0, 0)$$,
  pg_temp.fx('bind_run'), pg_temp.fx('r_validate'), (SELECT lo FROM bind_ids), (SELECT hi FROM bind_ids))]);

SELECT pg_temp.expect_error('a checkpoint with EQUAL rows unequal to successors is rejected', '23514', ARRAY[format(
  $$INSERT INTO ops.num_currency_bind_batch (run_id, rule_version_id, batch_index, first_field_value_id, last_field_value_id,
      heads_in_batch, successors_written, equal_written, not_equal_written, multiple_written, exclusions_written)
    VALUES (%s, %s, 2, %s, %s, 1, 1, 0, 0, 0, 0)$$,
  pg_temp.fx('bind_run'), pg_temp.fx('r_validate'), (SELECT hi FROM bind_ids), (SELECT hi FROM bind_ids))]);

SELECT pg_temp.expect_error('a checkpoint under a rule not linked to its run is rejected', 'BDCI1', ARRAY[format(
  $$INSERT INTO ops.num_currency_bind_batch (run_id, rule_version_id, batch_index, first_field_value_id, last_field_value_id,
      heads_in_batch, successors_written, equal_written, not_equal_written, multiple_written, exclusions_written)
    VALUES (%s, %s, 2, %s, %s, 1, 0, 0, 0, 0, 0)$$,
  pg_temp.fx('bind_run'), pg_temp.fx('r_coverage'), (SELECT hi FROM bind_ids), (SELECT hi FROM bind_ids))]);

SELECT pg_temp.expect_error('a checkpoint on a run of another kind is rejected', 'BDCI1', ARRAY[format(
  $$INSERT INTO ops.num_currency_bind_batch (run_id, rule_version_id, batch_index, first_field_value_id, last_field_value_id,
      heads_in_batch, successors_written, equal_written, not_equal_written, multiple_written, exclusions_written)
    VALUES (%s, %s, 1, %s, %s, 1, 0, 0, 0, 0, 0)$$,
  pg_temp.fx('run'), pg_temp.fx('r_validate'), (SELECT lo FROM bind_ids), (SELECT lo FROM bind_ids))]);

SELECT pg_temp.expect_error('a checkpoint is append-only', 'BDCA1', ARRAY[
  $$UPDATE ops.num_currency_bind_batch SET heads_in_batch = 2$$]);

INSERT INTO ops.run_outcome (run_id, status, finished_at, counts, error_summary)
VALUES (pg_temp.fx('bind_run'), 'FAILED', now(), '{"batches_committed": 1}'::jsonb, 'TEST ONLY failure');

SELECT pg_temp.expect_error('a finished run takes no more checkpoints', 'BDCI1', ARRAY[format(
  $$INSERT INTO ops.num_currency_bind_batch (run_id, rule_version_id, batch_index, first_field_value_id, last_field_value_id,
      heads_in_batch, successors_written, equal_written, not_equal_written, multiple_written, exclusions_written)
    VALUES (%s, %s, 2, %s, %s, 1, 0, 0, 0, 0, 0)$$,
  pg_temp.fx('bind_run'), pg_temp.fx('r_validate'), (SELECT hi FROM bind_ids), (SELECT hi FROM bind_ids))]);

SELECT pg_temp.check('the failed run keeps its committed checkpoint', (
  SELECT count(*) = 1 FROM ops.num_currency_bind_batch WHERE run_id = pg_temp.fx('bind_run')));

SELECT pg_advisory_unlock_all();
