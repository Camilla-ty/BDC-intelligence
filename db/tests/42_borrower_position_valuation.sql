-- Group 42: registry.borrower_position_valuation. Fake names and 2099 dates only.
-- Deltas are copied. Percentages and ratios use stored numerics and a non-zero denominator.

CREATE FUNCTION pg_temp.l2_evidence() RETURNS bigint
LANGUAGE sql AS $$
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, run_id)
  VALUES ('L2_ORIGINAL_FILING', pg_temp.fx('artifact'), 'DOCUMENT', pg_temp.fx('run'))
  RETURNING id
$$;

CREATE FUNCTION pg_temp.l2_money(pos_key text, field_code text, raw text, amount numeric) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO obs.position_field_value (
      position_observation_id, field_code, raw_value, normalized_numeric,
      currency_state, scale_state, value_state,
      normalization_rule_version_id, evidence_id, run_id)
  VALUES (pg_temp.fx(pos_key), field_code, raw, amount,
          'UNKNOWN', 'NOT_APPLICABLE', 'REPORTED',
          pg_temp.fx('r_field'), pg_temp.l2_evidence(), pg_temp.fx('run'))
$$;

CREATE FUNCTION pg_temp.l2_coded_money(
  pos_key text, field_code text, raw text, amount numeric, code text
) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO obs.position_field_value (
      position_observation_id, field_code, raw_value, normalized_numeric,
      currency_code, currency_state, scale_state, value_state,
      normalization_rule_version_id, evidence_id, run_id)
  VALUES (pg_temp.fx(pos_key), field_code, raw, amount,
          code, 'FROM_FILING', 'NOT_APPLICABLE', 'REPORTED',
          pg_temp.fx('r_field'), pg_temp.l2_evidence(), pg_temp.fx('run'))
$$;

CREATE FUNCTION pg_temp.l2_type(pos_key text, raw text) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO obs.position_field_value (
      position_observation_id, field_code, raw_value, normalized_text,
      currency_state, scale_state, value_state,
      normalization_rule_version_id, evidence_id, run_id)
  VALUES (pg_temp.fx(pos_key), 'INSTRUMENT_TYPE', raw, raw,
          'UNKNOWN', 'NOT_APPLICABLE', 'REPORTED',
          pg_temp.fx('r_field'), pg_temp.l2_evidence(), pg_temp.fx('run'))
$$;

CREATE FUNCTION pg_temp.series_position(pos_key text, ident text, line_no bigint, reported text) RETURNS void
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
  line := acc || E'\t9999999901\tTEST BDC 1\t' || reported || E'\t0\t' || ident || E'\t\t\t\t\t';
  row_id := pg_temp.add_row(pg_temp.fx('l_soi'), line_no, line);
  ev_row := pg_temp.add_evidence('L1_STRUCTURED_DATASET', pg_temp.fx('artifact'), row_id);
  ev_cell := pg_temp.add_evidence('L1_STRUCTURED_DATASET', pg_temp.fx('artifact'), row_id, 6, 'Investment, Identifier Axis');
  INSERT INTO obs.soi_row_observation (
      tabular_row_id, filing_id, reported_date_raw, reported_date, date_precision,
      qtrs_raw, qtrs, duration_kind, identifier_raw, rule_version_id, evidence_id, run_id)
  VALUES (row_id, pg_temp.fx('filing'), reported, reported::date, 'MONTH_END_ROUNDED', '0', 0,
          'POINT_IN_TIME', ident, pg_temp.fx('r_project'), ev_row, pg_temp.fx('run'))
  RETURNING id INTO soi_id;
  INSERT INTO obs.soi_row_classification (soi_row_observation_id, row_kind, period_role, rule_version_id, run_id)
  VALUES (soi_id, 'IDENTIFIER_ROW', 'UNRESOLVED', pg_temp.fx('r_classify'), pg_temp.fx('run'));
  INSERT INTO obs.position_observation (
      origin_soi_row_observation_id, filing_id, reported_date, date_precision, duration_kind,
      holding_descriptor_raw, rule_version_id, evidence_id, run_id)
  VALUES (soi_id, pg_temp.fx('filing'), reported::date, 'MONTH_END_ROUNDED', 'POINT_IN_TIME',
          ident, pg_temp.fx('r_position'), ev_row, pg_temp.fx('run'))
  RETURNING id INTO po_id;
  INSERT INTO obs.position_observation_source (position_observation_id, soi_row_observation_id, source_role, run_id)
  VALUES (po_id, soi_id, 'PRIMARY', pg_temp.fx('run'));
  PERFORM pg_temp.put(pos_key, po_id);
  PERFORM pg_temp.put(pos_key || '_cell', ev_cell);
END
$$;

CREATE FUNCTION pg_temp.history_name(pos_key text, ident text) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO obs.borrower_name_observation (
      position_observation_id, source_column_label, source_column_position,
      raw_text, normalized_text, extraction_state, rule_version_id, evidence_id, run_id)
  VALUES (pg_temp.fx(pos_key), 'Investment, Identifier Axis', 6, ident, ident, 'EXTRACTED',
          pg_temp.fx('r_field'), pg_temp.fx(pos_key || '_cell'), pg_temp.fx('run'))
$$;

CREATE FUNCTION pg_temp.match_entity(pos_key text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO resolution.entity_resolution_decision (
      borrower_name_observation_id, legal_entity_id, state, method, rationale,
      actor_kind, decided_by, decided_at, rule_version_id, evidence_id, run_id)
  SELECT b.id, le.id, 'MATCHED', 'EXACT_NORMALIZED_NAME',
         'TEST ONLY: stored decision', 'SYSTEM_RULE', 'db tests', now(),
         pg_temp.fx('r_resolve'), pg_temp.fx('e_soi_a'), pg_temp.fx('run')
  FROM obs.current_borrower_name_observation b
  JOIN identity.legal_entity le ON le.creation_reason = 'TEST ONLY valuation entity'
  WHERE b.position_observation_id = pg_temp.fx(pos_key);
END
$$;

CREATE FUNCTION pg_temp.add_instrument(reason text) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO identity.instrument (creation_reason, run_id)
  VALUES (reason, pg_temp.fx('run'))
$$;

CREATE FUNCTION pg_temp.match_instrument(pos_key text, reason text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO resolution.instrument_resolution_decision (
      position_observation_id, instrument_id, state, method, rationale,
      actor_kind, decided_by, decided_at, rule_version_id, evidence_id, run_id)
  SELECT pg_temp.fx(pos_key), i.id, 'MATCHED', 'EXACT_IDENTIFIER_AND_TYPE',
         'TEST ONLY: stored instrument', 'SYSTEM_RULE', 'db tests', now(),
         pg_temp.fx('r_resolve'), pg_temp.fx('e_soi_a'), pg_temp.fx('run')
  FROM identity.instrument i
  WHERE i.creation_reason = reason;
END
$$;

CREATE FUNCTION pg_temp.add_position(reason text) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO identity.position (registrant_id, creation_reason, run_id)
  VALUES (pg_temp.fx('registrant'), reason, pg_temp.fx('run'))
$$;

CREATE FUNCTION pg_temp.link_continuity(pos_key text, reason text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO resolution.position_continuity_decision (
      position_observation_id, position_id, state, method, rationale,
      actor_kind, decided_by, decided_at, rule_version_id, evidence_id, run_id)
  SELECT pg_temp.fx(pos_key), p.id, 'MATCHED',
         'SAME_REGISTRANT_AND_INSTRUMENT', 'TEST ONLY: stored continuity',
         'SYSTEM_RULE', 'db tests', now(),
         pg_temp.fx('r_resolve'), pg_temp.fx('e_soi_a'), pg_temp.fx('run')
  FROM identity.position p
  WHERE p.creation_reason = reason;
END
$$;

SELECT pg_temp.series_position('a_mar', 'TEST VALUATION ENTITY | MAR', 110, '2099-03-31');
SELECT pg_temp.series_position('a_jun', 'TEST VALUATION ENTITY | JUN', 111, '2099-06-30');
SELECT pg_temp.series_position('z_only', 'TEST VALUATION ENTITY | ZERO', 112, '2099-09-30');
SELECT pg_temp.series_position('p_early', 'TEST VALUATION ENTITY | ZERO FV', 113, '2099-01-31');
SELECT pg_temp.series_position('p_late', 'TEST VALUATION ENTITY | AFTER ZERO FV', 114, '2099-02-28');
SELECT pg_temp.series_position('u_row', 'TEST VALUATION ENTITY | UNRESOLVED', 115, '2099-08-31');
SELECT pg_temp.series_position('c_row', 'TEST VALUATION ENTITY | CURRENCY', 116, '2099-07-31');
SELECT pg_temp.series_position('m_early', 'TEST VALUATION ENTITY | MISMATCH EARLY', 117, '2098-03-31');
SELECT pg_temp.series_position('m_late', 'TEST VALUATION ENTITY | MISMATCH LATE', 118, '2098-06-30');

SELECT pg_temp.l2_coded_money('a_mar', 'FAIR_VALUE', '70', 70, 'AAA');
SELECT pg_temp.l2_coded_money('a_mar', 'PRINCIPAL_AMOUNT', '100', 100, 'AAA');
SELECT pg_temp.l2_coded_money('a_mar', 'COST', '50', 50, 'AAA');
SELECT pg_temp.l2_type('a_mar', 'TEST FIRST LIEN');
SELECT pg_temp.l2_coded_money('a_jun', 'FAIR_VALUE', '60', 60, 'AAA');
SELECT pg_temp.l2_type('a_jun', 'TEST FIRST LIEN');
SELECT pg_temp.l2_coded_money('z_only', 'FAIR_VALUE', '40', 40, 'AAA');
SELECT pg_temp.l2_coded_money('z_only', 'PRINCIPAL_AMOUNT', '0', 0, 'AAA');
SELECT pg_temp.l2_coded_money('z_only', 'COST', '0', 0, 'AAA');
SELECT pg_temp.l2_coded_money('p_early', 'FAIR_VALUE', '0', 0, 'AAA');
SELECT pg_temp.l2_coded_money('p_late', 'FAIR_VALUE', '10', 10, 'AAA');
SELECT pg_temp.l2_money('u_row', 'FAIR_VALUE', '90', 90);
SELECT pg_temp.l2_money('u_row', 'PRINCIPAL_AMOUNT', '30', 30);
SELECT pg_temp.l2_coded_money('c_row', 'FAIR_VALUE', '80', 80, 'AAA');
SELECT pg_temp.l2_coded_money('c_row', 'PRINCIPAL_AMOUNT', '40', 40, 'BBB');
SELECT pg_temp.l2_coded_money('m_early', 'FAIR_VALUE', '70', 70, 'AAA');
SELECT pg_temp.l2_type('m_early', 'TEST FIRST LIEN');
SELECT pg_temp.l2_coded_money('m_late', 'FAIR_VALUE', '60', 60, 'BBB');
SELECT pg_temp.l2_type('m_late', 'TEST FIRST LIEN');

SELECT pg_temp.history_name('a_mar', 'TEST VALUATION ENTITY | MAR');
SELECT pg_temp.history_name('a_jun', 'TEST VALUATION ENTITY | JUN');
SELECT pg_temp.history_name('z_only', 'TEST VALUATION ENTITY | ZERO');
SELECT pg_temp.history_name('p_early', 'TEST VALUATION ENTITY | ZERO FV');
SELECT pg_temp.history_name('p_late', 'TEST VALUATION ENTITY | AFTER ZERO FV');
SELECT pg_temp.history_name('u_row', 'TEST VALUATION ENTITY | UNRESOLVED');
SELECT pg_temp.history_name('c_row', 'TEST VALUATION ENTITY | CURRENCY');
SELECT pg_temp.history_name('m_early', 'TEST VALUATION ENTITY | MISMATCH EARLY');
SELECT pg_temp.history_name('m_late', 'TEST VALUATION ENTITY | MISMATCH LATE');

SELECT pg_temp.expect_ok('valuation entity', ARRAY[
  format($$INSERT INTO identity.legal_entity (creation_reason, run_id) VALUES ('TEST ONLY valuation entity', %s)$$, pg_temp.fx('run'))]);

SELECT pg_temp.match_entity('a_mar');
SELECT pg_temp.match_entity('a_jun');
SELECT pg_temp.match_entity('z_only');
SELECT pg_temp.match_entity('p_early');
SELECT pg_temp.match_entity('p_late');
SELECT pg_temp.match_entity('u_row');
SELECT pg_temp.match_entity('c_row');
SELECT pg_temp.match_entity('m_early');
SELECT pg_temp.match_entity('m_late');

SELECT pg_temp.add_instrument('TEST ONLY valuation instrument A');
SELECT pg_temp.add_instrument('TEST ONLY valuation instrument zero');
SELECT pg_temp.add_instrument('TEST ONLY valuation instrument percent');
SELECT pg_temp.add_instrument('TEST ONLY valuation instrument currency');
SELECT pg_temp.add_instrument('TEST ONLY valuation instrument mismatch');
SELECT pg_temp.match_instrument('a_mar', 'TEST ONLY valuation instrument A');
SELECT pg_temp.match_instrument('a_jun', 'TEST ONLY valuation instrument A');
SELECT pg_temp.match_instrument('z_only', 'TEST ONLY valuation instrument zero');
SELECT pg_temp.match_instrument('p_early', 'TEST ONLY valuation instrument percent');
SELECT pg_temp.match_instrument('p_late', 'TEST ONLY valuation instrument percent');
SELECT pg_temp.match_instrument('c_row', 'TEST ONLY valuation instrument currency');
SELECT pg_temp.match_instrument('m_early', 'TEST ONLY valuation instrument mismatch');
SELECT pg_temp.match_instrument('m_late', 'TEST ONLY valuation instrument mismatch');

SELECT pg_temp.add_position('TEST ONLY valuation series A');
SELECT pg_temp.add_position('TEST ONLY valuation series zero');
SELECT pg_temp.add_position('TEST ONLY valuation series percent');
SELECT pg_temp.add_position('TEST ONLY valuation series currency');
SELECT pg_temp.add_position('TEST ONLY valuation series mismatch');
SELECT pg_temp.link_continuity('a_mar', 'TEST ONLY valuation series A');
SELECT pg_temp.link_continuity('a_jun', 'TEST ONLY valuation series A');
SELECT pg_temp.link_continuity('z_only', 'TEST ONLY valuation series zero');
SELECT pg_temp.link_continuity('p_early', 'TEST ONLY valuation series percent');
SELECT pg_temp.link_continuity('p_late', 'TEST ONLY valuation series percent');
SELECT pg_temp.link_continuity('c_row', 'TEST ONLY valuation series currency');
SELECT pg_temp.link_continuity('m_early', 'TEST ONLY valuation series mismatch');
SELECT pg_temp.link_continuity('m_late', 'TEST ONLY valuation series mismatch');

SET CONSTRAINTS ALL IMMEDIATE;

SELECT pg_temp.check('history is newest reported date first', (
  SELECT (array_agg(reported_date ORDER BY ordinality))[1] = '2099-09-30'
     AND (array_agg(reported_date ORDER BY ordinality))[2] = '2099-08-31'
     AND (array_agg(position_observation_id ORDER BY ordinality))[4] = pg_temp.fx('a_jun')::text
     AND (array_agg(position_observation_id ORDER BY ordinality))[5] = pg_temp.fx('a_mar')::text
  FROM registry.borrower_position_valuation(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY valuation entity')
  ) WITH ORDINALITY));

SELECT pg_temp.check('the fair-value delta is copied from the comparison', (
  SELECT v.fair_value_change_state = 'COMPARABLE'
     AND v.fair_value_delta = c.fair_value_delta::text
     AND v.fair_value_delta = '-10'
     AND v.earlier_reported_date = '2099-03-31'
     AND v.fair_value_raw = '60'
     AND v.accession_number = '0000000000-00-000001'
     AND v.observation_evidence_level = 'L1_STRUCTURED_DATASET'
     AND v.instrument_type_raw = 'TEST FIRST LIEN'
     AND v.valuation_definition = 'valuation.position_history.v1'
  FROM registry.borrower_position_valuation(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY valuation entity')
  ) v
  JOIN registry.position_period_comparison c
    ON c.later_position_observation_id = v.position_observation_id::bigint
  WHERE v.position_observation_id = pg_temp.fx('a_jun')::text));

SELECT pg_temp.check('percentage uses the stored delta and a non-zero earlier fair value', (
  SELECT fair_value_percentage_state = 'COMPARABLE'
     AND fair_value_percentage = round(-10::numeric / 70 * 100, 6)::text
  FROM registry.borrower_position_valuation(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY valuation entity')
  )
  WHERE position_observation_id = pg_temp.fx('a_jun')::text));

SELECT pg_temp.check('a zero earlier fair value does not become a percentage', (
  SELECT fair_value_change_state = 'COMPARABLE'
     AND fair_value_delta = '10'
     AND fair_value_percentage_state = 'INSUFFICIENT_DATA'
     AND fair_value_percentage IS NULL
  FROM registry.borrower_position_valuation(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY valuation entity')
  )
  WHERE position_observation_id = pg_temp.fx('p_late')::text));

SELECT pg_temp.check('fair value over principal and cost use stored non-zero denominators', (
  SELECT fair_value_to_principal_state = 'COMPARABLE'
     AND fair_value_to_principal = round(70::numeric / 100, 6)::text
     AND fair_value_to_cost_state = 'COMPARABLE'
     AND fair_value_to_cost = round(70::numeric / 50, 6)::text
  FROM registry.borrower_position_valuation(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY valuation entity')
  )
  WHERE position_observation_id = pg_temp.fx('a_mar')::text));

SELECT pg_temp.check('a missing principal and cost stay insufficient', (
  SELECT principal_state = 'UNKNOWN'
     AND principal_raw IS NULL
     AND cost_state = 'UNKNOWN'
     AND fair_value_to_principal_state = 'INSUFFICIENT_DATA'
     AND fair_value_to_principal IS NULL
     AND fair_value_to_cost_state = 'INSUFFICIENT_DATA'
     AND fair_value_to_cost IS NULL
  FROM registry.borrower_position_valuation(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY valuation entity')
  )
  WHERE position_observation_id = pg_temp.fx('a_jun')::text));

SELECT pg_temp.check('a zero principal or cost is not a denominator', (
  SELECT fair_value_to_principal_state = 'INSUFFICIENT_DATA'
     AND fair_value_to_principal IS NULL
     AND fair_value_to_cost_state = 'INSUFFICIENT_DATA'
     AND fair_value_to_cost IS NULL
  FROM registry.borrower_position_valuation(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY valuation entity')
  )
  WHERE position_observation_id = pg_temp.fx('z_only')::text));

SELECT pg_temp.check('an unresolved instrument is not a valuation comparison', (
  SELECT instrument_resolution_state = 'UNRESOLVED'
     AND continuity_state = 'UNRESOLVED'
     AND fair_value_state = 'REPORTED'
     AND fair_value_raw = '90'
     AND fair_value_change_state = 'INSUFFICIENT_DATA'
     AND fair_value_delta IS NULL
     AND fair_value_percentage_state = 'INSUFFICIENT_DATA'
     AND fair_value_to_principal_state = 'INSUFFICIENT_DATA'
     AND fair_value_to_principal IS NULL
     AND cross_bdc_comparison_state = 'UNAVAILABLE'
  FROM registry.borrower_position_valuation(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY valuation entity')
  )
  WHERE position_observation_id = pg_temp.fx('u_row')::text));

SELECT pg_temp.check('different currency codes are not combined', (
  SELECT fair_value_currency_code = 'AAA'
     AND principal_currency_code = 'BBB'
     AND fair_value_to_principal_state = 'INSUFFICIENT_DATA'
     AND fair_value_to_principal IS NULL
     AND cross_bdc_comparison_state = 'UNAVAILABLE'
  FROM registry.borrower_position_valuation(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY valuation entity')
  )
  WHERE position_observation_id = pg_temp.fx('c_row')::text));

SELECT pg_temp.check('a cross-period fair-value currency mismatch is not a valuation delta', (
  SELECT v.instrument_resolution_state = 'MATCHED'
     AND v.continuity_state = 'MATCHED'
     AND v.fair_value_state = 'REPORTED'
     AND v.fair_value_raw = '60'
     AND v.fair_value_currency_code = 'BBB'
     AND v.earlier_reported_date = '2098-03-31'
     AND v.fair_value_change_state = 'INSUFFICIENT_DATA'
     AND v.fair_value_delta IS NULL
     AND v.fair_value_percentage_state = 'INSUFFICIENT_DATA'
     AND v.fair_value_percentage IS NULL
     AND c.fair_value_comparison_state = 'INSUFFICIENT_DATA'
     AND c.fair_value_delta IS NULL
     AND c.earlier_fair_value_numeric = 70
     AND c.later_fair_value_numeric = 60
  FROM registry.borrower_position_valuation(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY valuation entity')
  ) v
  JOIN registry.position_period_comparison c
    ON c.later_position_observation_id = v.position_observation_id::bigint
  WHERE v.position_observation_id = pg_temp.fx('m_late')::text));

SELECT pg_temp.check('currency codes come from the current field view', (
  SELECT position('obs.current_position_field_value' IN pg_get_functiondef('registry.borrower_position_valuation(uuid)'::regprocedure)) > 0
     AND position('obs.position_field_value' IN pg_get_functiondef('registry.borrower_position_valuation(uuid)'::regprocedure)) = 0));

SELECT pg_temp.check('the valuation read reuses the entity-scoped comparison and does not subtract fair value', (
  SELECT position('borrower_valuation_period_comparison' IN pg_get_functiondef('registry.borrower_position_valuation(uuid)'::regprocedure)) > 0
     AND position('position_period_comparison' IN pg_get_functiondef('registry.borrower_position_valuation(uuid)'::regprocedure)) = 0
     AND position('matched_entity_position' IN pg_get_functiondef('registry.borrower_position_valuation(uuid)'::regprocedure)) > 0
     AND position('OFFSET 0' IN pg_get_functiondef('registry.borrower_position_valuation(uuid)'::regprocedure)) > 0
     AND position('fair_value_delta /' IN pg_get_functiondef('registry.borrower_position_valuation(uuid)'::regprocedure)) > 0
     AND position('fair_value_numeric -' IN pg_get_functiondef('registry.borrower_position_valuation(uuid)'::regprocedure)) = 0
     AND pg_get_functiondef('registry.borrower_position_valuation(uuid)'::regprocedure) !~* 'score|rank|similarity'));

SELECT pg_temp.expect_ok('reader can select borrower position valuation', ARRAY[
  'SET ROLE bdc_reader',
  format('SELECT count(*) FROM registry.borrower_position_valuation(%L)',
         (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY valuation entity')),
  'RESET ROLE']);
