-- Group 8: Unknown is a valid value (G-04); missing coverage is not zero (G-05).

CREATE FUNCTION pg_temp.field_value_sql(po text, field text, label text, pos integer, raw text, normalized text,
                                        vstate text, reason text, ev text) RETURNS text
LANGUAGE sql AS $$
  SELECT format(
    $q$INSERT INTO obs.position_field_value (position_observation_id, field_code, column_mapping_id, source_column_label,
         source_column_position, raw_value, normalized_numeric, currency_state, scale_state, value_state, unknown_reason,
         normalization_rule_version_id, evidence_id, run_id)
       VALUES (%s, %L, %s, %L, %s, %L, %s, 'UNKNOWN', 'NOT_APPLICABLE', %L, %L, %s, %s, %s)$q$,
    pg_temp.fx(po), field, pg_temp.mapping(label), label, pos, raw, coalesce(normalized, 'NULL'), vstate, reason,
    pg_temp.fx('r_field'), pg_temp.fx(ev), pg_temp.fx('run'))
$$;

SELECT pg_temp.expect_error('UNKNOWN cannot carry a normalized zero', '23514',
  ARRAY[pg_temp.field_value_sql('po_b', 'COST', 'Investment Owned, Cost', 9, '', '0', 'UNKNOWN', 'empty cell', 'e_soi_b')]);

SELECT pg_temp.expect_error('UNKNOWN requires a reason', '23514',
  ARRAY[pg_temp.field_value_sql('po_b', 'COST', 'Investment Owned, Cost', 9, '', NULL, 'UNKNOWN', NULL, 'e_soi_b')]);

SELECT pg_temp.expect_error('a normalized zero is rejected when the disclosed text is not zero', '23514',
  ARRAY[pg_temp.field_value_sql('po_b', 'PRINCIPAL_AMOUNT', 'Investment Owned, Balance, Principal Amount', 7, '200', '0', 'REPORTED', NULL, 'e_soi_b')]);

SELECT pg_temp.expect_ok('a normalized zero is allowed when the disclosed text is zero ("0.00")',
  ARRAY[pg_temp.field_value_sql('po_b', 'COST', 'Adjusted cost basis', 8, '0.00', '0', 'REPORTED', NULL, 'e_b_adj_cost')]);

SELECT pg_temp.expect_error('an empty cell cannot be REPORTED', '23514',
  ARRAY[pg_temp.field_value_sql('po_b', 'COST', 'Investment Owned, Cost', 9, '', NULL, 'REPORTED', NULL, 'e_soi_b')]);

SELECT pg_temp.expect_error('DERIVED is not a valid state for an observed field value', '23514',
  ARRAY[pg_temp.field_value_sql('po_b', 'PRINCIPAL_AMOUNT', 'Investment Owned, Balance, Principal Amount', 7, '200', '200', 'DERIVED', NULL, 'e_soi_b')]);

SELECT pg_temp.expect_error('a currency code requires a known currency state', '23514',
  ARRAY[format(
  $$INSERT INTO obs.position_field_value (position_observation_id, field_code, column_mapping_id, source_column_label,
      source_column_position, raw_value, normalized_numeric, currency_code, currency_state, scale_state, value_state,
      normalization_rule_version_id, evidence_id, run_id)
    VALUES (%s, 'PRINCIPAL_AMOUNT', %s, 'Investment Owned, Balance, Principal Amount', 7, '200', 200, 'USD', 'UNKNOWN',
            'NOT_APPLICABLE', 'REPORTED', %s, %s, %s)$$,
  pg_temp.fx('po_b'), pg_temp.mapping('Investment Owned, Balance, Principal Amount'), pg_temp.fx('r_field'),
  pg_temp.fx('e_soi_b'), pg_temp.fx('run'))]);

SELECT pg_temp.check('an absent field reads as UNKNOWN through the view, never zero', (
  SELECT value_state = 'UNKNOWN' AND authority = 'UNKNOWN' AND field_value_id IS NULL
  FROM obs.position_field_status WHERE position_observation_id = pg_temp.fx('po_a') AND field_code = 'MATURITY_DATE'));

SELECT pg_temp.check('every field of every position observation is present in the status view', (
  SELECT count(DISTINCT (position_observation_id, field_code)) = 2 * (SELECT count(*) FROM ref.field_definition)
  FROM obs.position_field_status));

SELECT pg_temp.check('an empty preset cost cell is UNKNOWN, not zero', (
  SELECT value_state = 'UNKNOWN' AND normalized_numeric IS NULL
  FROM obs.position_field_value WHERE id = pg_temp.fx('fv_preset_cost')));

SELECT pg_temp.check('a field value with no evidence-status assertion is NOT_CHECKED', (
  SELECT evidence_status = 'NOT_CHECKED' FROM validation.current_evidence_status WHERE field_value_id = pg_temp.fx('fv_principal')));

SELECT pg_temp.expect_error('NUM: an UNKNOWN value cannot carry a number', '23514',
  ARRAY[format(
  $$INSERT INTO obs.num_fact_observation (tabular_row_id, filing_id, tag, tag_version, reported_date_raw, qtrs_raw, duration_kind,
      uom_raw, value_raw, value_numeric, value_state, rule_version_id, evidence_id, run_id)
    VALUES (%s, %s, 'InvestmentOwnedAtCost', 'TEST', '2099-12-31', '0', 'UNKNOWN', 'USD', '90', 90, 'UNKNOWN', %s, %s, %s)$$,
  pg_temp.fx('row_num'), pg_temp.fx('filing'), pg_temp.fx('r_project2'), pg_temp.fx('e_num'), pg_temp.fx('run'))]);

-- Derived values: Unknown propagates; never becomes zero.
CREATE FUNCTION pg_temp.derived_sql(metric text, state text, result text, reason text, field text) RETURNS text[]
LANGUAGE sql AS $$
  SELECT ARRAY[
    format($q$INSERT INTO derived.derived_value (metric_rule_version_id, subject_table, subject_id, result_numeric, result_state, unknown_reason, run_id)
              VALUES (%s, 'obs.position_observation', %s, %s, %L, %L, %s)$q$,
           pg_temp.fx(metric), pg_temp.fx('po_a'), coalesce(result, 'NULL'), state, reason, pg_temp.fx('run')),
    format($q$INSERT INTO derived.derived_value_input (derived_value_id, field_value_id, input_role, run_id)
              VALUES (currval(pg_get_serial_sequence('derived.derived_value', 'id')), %s, 'input', %s)$q$,
           pg_temp.fx(field), pg_temp.fx('run')),
    'SET CONSTRAINTS ALL IMMEDIATE']
$$;

SELECT pg_temp.expect_error('an UNKNOWN input cannot produce a DERIVED result', 'BDCD1',
  pg_temp.derived_sql('r_metric', 'DERIVED', '0', NULL, 'fv_preset_cost'));
SELECT pg_temp.expect_ok('an UNKNOWN input propagates to an UNKNOWN result',
  pg_temp.derived_sql('r_metric', 'UNKNOWN', NULL, 'input cost is unknown', 'fv_preset_cost'));
SET CONSTRAINTS ALL DEFERRED;
SELECT pg_temp.expect_error('a strict metric rejects UNKNOWN inputs', 'BDCD1',
  pg_temp.derived_sql('r_metric_strict', 'UNKNOWN', NULL, 'input cost is unknown', 'fv_preset_cost'));
SELECT pg_temp.expect_error('a DERIVED result must have a number', '23514',
  pg_temp.derived_sql('r_metric', 'DERIVED', NULL, NULL, 'fv_principal'));
SELECT pg_temp.expect_error('an UNKNOWN result must not carry a number (no zero fill)', '23514',
  pg_temp.derived_sql('r_metric', 'UNKNOWN', '0', 'test', 'fv_preset_cost'));

-- Coverage
SELECT pg_temp.check('a registrant with no coverage assertion has no coverage row (UNKNOWN, not zero)', NOT EXISTS (
  SELECT 1 FROM ops.current_coverage WHERE registrant_id = pg_temp.fx('registrant')));

SELECT pg_temp.expect_ok('an empty data-set period is recorded explicitly', ARRAY[format(
  $$INSERT INTO ops.coverage_assertion (dataset_release_id, source_type_code, coverage_aspect, coverage_state, evidence_id, rationale, rule_version_id, run_id)
    VALUES (%s, 'SEC_BDC_DATASET_ZIP', 'FILING_METADATA', 'EMPTY_PERIOD', %s, 'TEST ONLY: release contained no rows', %s, %s)$$,
  pg_temp.fx('release'), pg_temp.fx('e_sub'), pg_temp.fx('r_coverage'), pg_temp.fx('run'))]);

SELECT pg_temp.check('an EMPTY_PERIOD is not treated as covered', (
  SELECT NOT is_covered FROM ops.current_coverage WHERE dataset_release_id = pg_temp.fx('release') AND registrant_id IS NULL));

SELECT pg_temp.expect_error('COVERED requires evidence', '23514', ARRAY[format(
  $$INSERT INTO ops.coverage_assertion (registrant_id, dataset_release_id, source_type_code, coverage_aspect, coverage_state, rationale, rule_version_id, run_id)
    VALUES (%s, %s, 'SEC_BDC_DATASET_ZIP', 'FILING_METADATA', 'COVERED', 'test', %s, %s)$$,
  pg_temp.fx('registrant'), pg_temp.fx('release'), pg_temp.fx('r_coverage'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_ok('NOT_INGESTED coverage can be recorded without evidence', ARRAY[format(
  $$INSERT INTO ops.coverage_assertion (registrant_id, dataset_release_id, source_type_code, coverage_aspect, coverage_state, rationale, rule_version_id, run_id)
    VALUES (%s, %s, 'SEC_BDC_DATASET_ZIP', 'FILING_METADATA', 'NOT_INGESTED', 'TEST ONLY', %s, %s)$$,
  pg_temp.fx('registrant'), pg_temp.fx('release'), pg_temp.fx('r_coverage'), pg_temp.fx('run'))]);

SELECT pg_temp.check('NOT_INGESTED is not covered', (
  SELECT NOT is_covered AND coverage_state = 'NOT_INGESTED' FROM ops.current_coverage WHERE registrant_id = pg_temp.fx('registrant')));
