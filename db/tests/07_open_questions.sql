-- Group 7: Phase 0.2 open questions stay open; provisional mappings cannot feed derived values.

CREATE FUNCTION pg_temp.derive_from(field_value bigint, metric text DEFAULT 'r_metric') RETURNS text[]
LANGUAGE sql AS $$
  SELECT ARRAY[
    format($q$INSERT INTO derived.derived_value (metric_rule_version_id, subject_table, subject_id, result_numeric, result_state, run_id)
              VALUES (%s, 'obs.position_observation', %s, 1, 'DERIVED', %s)$q$,
           pg_temp.fx(metric), pg_temp.fx('po_a'), pg_temp.fx('run')),
    format($q$INSERT INTO derived.derived_value_input (derived_value_id, field_value_id, input_role, run_id)
              VALUES (currval(pg_get_serial_sequence('derived.derived_value', 'id')), %s, 'input', %s)$q$,
           field_value, pg_temp.fx('run')),
    'SET CONSTRAINTS ALL IMMEDIATE']
$$;

-- Q14
SELECT pg_temp.expect_error('Q14: a value from "Adjusted cost basis" (OPEN_QUESTION) cannot feed a derived value', 'BDCD1',
  pg_temp.derive_from(pg_temp.fx('fv_adj_cost')));

SELECT pg_temp.expect_error('an OBSERVED_UNCONFIRMED mapping (PIK rate) cannot feed a derived value', 'BDCD1',
  pg_temp.derive_from(pg_temp.fx('fv_pik')));

SELECT pg_temp.expect_ok('a value from a documented preset column can feed a derived value', pg_temp.derive_from(pg_temp.fx('fv_principal')));
SET CONSTRAINTS ALL DEFERRED;

SELECT pg_temp.check('Q14: the undocumented cost value is PROVISIONAL in the authority view', (
  SELECT authority = 'PROVISIONAL' FROM obs.field_value_authority WHERE field_value_id = pg_temp.fx('fv_adj_cost')));

SELECT pg_temp.expect_ok('an approved mapping version for the same label supersedes the OPEN_QUESTION one', ARRAY[format(
  $$INSERT INTO ref.source_column_mapping (source_table_code, column_label, mapping_target, field_code, mapping_basis,
      mapping_status, source_schema_reference, rule_version_id, recorded_by, supersedes_id, supersede_reason)
    VALUES ('SOI', 'Adjusted cost basis', 'POSITION_FIELD', 'COST', 'DOCUMENTED_SOURCE', 'DOCUMENTED_AND_OBSERVED',
            'TEST ONLY reference', %s, 'db tests', %s, 'TEST ONLY: simulated approval')$$,
  pg_temp.fx('r_mapping'), pg_temp.mapping('Adjusted cost basis'))]);

SELECT pg_temp.expect_ok('after approval, the same field value can feed a derived value', pg_temp.derive_from(pg_temp.fx('fv_adj_cost')));
SET CONSTRAINTS ALL DEFERRED;

SELECT pg_temp.check('after approval, the value is REPORTED_STRUCTURED (not yet filing-verified)', (
  SELECT authority = 'REPORTED_STRUCTURED' FROM obs.field_value_authority WHERE field_value_id = pg_temp.fx('fv_adj_cost')));

SELECT pg_temp.expect_error('a mapping cannot claim DOCUMENTED status on an observed basis', '23514',
  ARRAY[format(
  $$INSERT INTO ref.source_column_mapping (source_table_code, column_label, mapping_target, field_code, mapping_basis,
      mapping_status, source_schema_reference, rule_version_id, recorded_by)
    VALUES ('SOI', 'TEST ONLY LABEL', 'POSITION_FIELD', 'COST', 'OBSERVED_VALUE_AGREEMENT', 'DOCUMENTED', 'test', %s, 'db tests')$$,
  pg_temp.fx('r_mapping'))]);

SELECT pg_temp.expect_error('an OPEN_QUESTION mapping must cite its question', '23514',
  ARRAY[format(
  $$INSERT INTO ref.source_column_mapping (source_table_code, column_label, mapping_target, field_code, mapping_basis,
      mapping_status, source_schema_reference, rule_version_id, recorded_by)
    VALUES ('SOI', 'TEST ONLY LABEL', 'POSITION_FIELD', 'COST', 'OBSERVED_LABEL', 'OPEN_QUESTION', 'test', %s, 'db tests')$$,
  pg_temp.fx('r_mapping'))]);

-- Q4
SELECT pg_temp.check('Q4: a rate with unresolved scale keeps its raw value and no normalized value', (
  SELECT raw_value = '0.05' AND normalized_numeric IS NULL AND scale_state = 'UNRESOLVED'
  FROM obs.position_field_value WHERE id = pg_temp.fx('fv_rate')));
SELECT pg_temp.check('Q4: its authority is UNRESOLVED', (
  SELECT authority = 'UNRESOLVED' FROM obs.field_value_authority WHERE field_value_id = pg_temp.fx('fv_rate')));
SELECT pg_temp.expect_error('Q4: REPORTED without a normalized value requires scale UNRESOLVED', '23514',
  ARRAY[format(
  $$INSERT INTO obs.position_field_value (position_observation_id, field_code, column_mapping_id, source_column_label,
      source_column_position, raw_value, currency_state, scale_state, value_state, normalization_rule_version_id, evidence_id, run_id)
    VALUES (%s, 'INTEREST_RATE', %s, 'Investment Interest Rate', 10, '0.06', 'UNKNOWN', 'KNOWN', 'REPORTED', %s, %s, %s)$$,
  pg_temp.fx('po_b'), pg_temp.mapping('Investment Interest Rate'), pg_temp.fx('r_field'), pg_temp.fx('e_soi_b'), pg_temp.fx('run'))]);

-- Q6 / Q15
SELECT pg_temp.check('Q6: current-holding selection stays UNRESOLVED in classifications', (
  SELECT bool_and(period_role = 'UNRESOLVED') FROM obs.current_soi_row_classification));
SELECT pg_temp.expect_error('Q15: qtrs and duration kind must agree (qtrs > 0 is a duration)', '23514',
  ARRAY[format(
  $$INSERT INTO obs.soi_row_observation (tabular_row_id, filing_id, reported_date_raw, date_precision, qtrs_raw, qtrs,
      duration_kind, rule_version_id, evidence_id, run_id)
    VALUES (%s, %s, '2099-12-31', 'MONTH_END_ROUNDED', '0', 4, 'POINT_IN_TIME', %s, %s, %s)$$,
  pg_temp.fx('row_soi_total'), pg_temp.fx('filing'), pg_temp.fx('r_project2'), pg_temp.fx('e_soi_total'), pg_temp.fx('run'))]);

-- Q17
SELECT pg_temp.expect_ok('Q17: an UNRESOLVED amendment relationship needs no target', ARRAY[format(
  $$INSERT INTO registry.filing_relationship_decision (filing_id, relationship_type, state, method, rationale, actor_kind,
      decided_by, decided_at, rule_version_id, run_id, evidence_id)
    VALUES (%s, 'AMENDS', 'UNRESOLVED', 'test', 'prevrpt carries no signal', 'SYSTEM_RULE', 'db tests', now(), %s, %s, %s)$$,
  pg_temp.fx('filing'), pg_temp.fx('r_resolve'), pg_temp.fx('run'), pg_temp.fx('e_sub'))]);
SELECT pg_temp.expect_error('Q17: MATCHED amendment relationship requires the related filing', '23514',
  ARRAY[format(
  $$INSERT INTO registry.filing_relationship_decision (filing_id, relationship_type, state, method, rationale, actor_kind,
      decided_by, decided_at, rule_version_id, run_id, evidence_id, supersedes_id, supersede_reason)
    SELECT %s, 'AMENDS', 'MATCHED', 'test', 'test', 'SYSTEM_RULE', 'db tests', now(), %s, %s, %s, id, 'test'
    FROM registry.filing_relationship_decision WHERE filing_id = %s$$,
  pg_temp.fx('filing'), pg_temp.fx('r_resolve'), pg_temp.fx('run'), pg_temp.fx('e_sub'), pg_temp.fx('filing'))]);

-- Q19 / Q18
SELECT pg_temp.check('Q19: cstm is raw-only and OPEN_QUESTION', (
  SELECT mapping_target = 'RAW_ONLY' AND mapping_status = 'OPEN_QUESTION' AND open_question_ref = 'Q19'
  FROM ref.current_column_mapping WHERE source_table_code = 'SOI' AND column_label = 'cstm'));
SELECT pg_temp.check('Q18: there is no all-in coupon field', NOT EXISTS (
  SELECT 1 FROM ref.field_definition WHERE field_code ILIKE '%ALL_IN%' OR field_code ILIKE '%COUPON%'));

-- Level 2 attributes
SELECT pg_temp.check('Level 2 fields (seniority, secured, non-accrual) are flagged level2_required', (
  SELECT count(*) = 3 AND bool_and(level2_required) FROM ref.field_definition
  WHERE field_code IN ('SENIORITY', 'SECURED', 'NON_ACCRUAL')));
