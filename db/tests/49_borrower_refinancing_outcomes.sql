-- Group 49: borrower refinancing outcomes. Fake names and 2099 dates only.
-- A maturity change stays MATURITY_CHANGED. Narrative text, a new instrument,
-- a missing later observation, and an acquisition date do not become an outcome row.

CREATE FUNCTION pg_temp.l2_evidence() RETURNS bigint
LANGUAGE sql AS $$
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, run_id)
  VALUES ('L2_ORIGINAL_FILING', pg_temp.fx('artifact'), 'DOCUMENT', pg_temp.fx('run'))
  RETURNING id
$$;

CREATE FUNCTION pg_temp.l2_text(pos_key text, field_code text, raw text) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO obs.position_field_value (
      position_observation_id, field_code, raw_value, normalized_text,
      currency_state, scale_state, value_state,
      normalization_rule_version_id, evidence_id, run_id)
  VALUES (pg_temp.fx(pos_key), field_code, raw, raw,
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

CREATE FUNCTION pg_temp.l2_calendar(pos_key text, field_code text, raw text, d date) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO obs.position_field_value (
      position_observation_id, field_code, raw_value, normalized_date,
      currency_state, scale_state, value_state,
      normalization_rule_version_id, evidence_id, run_id)
  VALUES (pg_temp.fx(pos_key), field_code, raw, d,
          'UNKNOWN', 'NOT_APPLICABLE', 'REPORTED',
          pg_temp.fx('r_field'), pg_temp.l2_evidence(), pg_temp.fx('run'))
$$;

CREATE FUNCTION pg_temp.l2_month(pos_key text, field_code text, raw text, y integer, m integer) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO obs.position_field_value (
      position_observation_id, field_code, raw_value, date_precision,
      normalized_year, normalized_month, currency_state, scale_state, value_state,
      normalization_rule_version_id, evidence_id, run_id)
  VALUES (pg_temp.fx(pos_key), field_code, raw, 'MONTH', y, m,
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

CREATE FUNCTION pg_temp.match_entity(pos_key text, reason text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO resolution.entity_resolution_decision (
      borrower_name_observation_id, legal_entity_id, state, method, rationale,
      actor_kind, decided_by, decided_at, rule_version_id, evidence_id, run_id)
  SELECT b.id, le.id, 'MATCHED', 'EXACT_NORMALIZED_NAME',
         'TEST ONLY: stored decision', 'SYSTEM_RULE', 'db tests', now(),
         pg_temp.fx('r_resolve'), pg_temp.fx('e_soi_a'), pg_temp.fx('run')
  FROM obs.current_borrower_name_observation b
  JOIN identity.legal_entity le ON le.creation_reason = reason
  WHERE b.position_observation_id = pg_temp.fx(pos_key);
END
$$;

CREATE FUNCTION pg_temp.add_instrument(reason text) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO identity.instrument (creation_reason, run_id) VALUES (reason, pg_temp.fx('run'))
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

SELECT pg_temp.series_position('month_early', 'TEST OUTCOME ENTITY | MONTH EARLY', 140, '2099-03-31');
SELECT pg_temp.series_position('month_late', 'TEST OUTCOME ENTITY | MONTH LATE', 141, '2099-09-30');
SELECT pg_temp.series_position('same_early', 'TEST OUTCOME ENTITY | SAME EARLY', 142, '2099-01-31');
SELECT pg_temp.series_position('same_late', 'TEST OUTCOME ENTITY | SAME LATE', 143, '2099-02-28');
SELECT pg_temp.series_position('solo', 'TEST OUTCOME ENTITY | NEW NAME', 144, '2099-04-30');
SELECT pg_temp.series_position('open_row', 'TEST OUTCOME ENTITY | UNRESOLVED', 145, '2099-05-31');
SELECT pg_temp.series_position('other_entity', 'TEST OTHER ENTITY | ONLY', 146, '2099-06-30');

SELECT pg_temp.l2_month('month_early', 'MATURITY_DATE', '12/2099', 2099, 12);
SELECT pg_temp.l2_calendar('month_early', 'ACQUISITION_DATE', '01/01/2099', DATE '2099-01-01');
SELECT pg_temp.l2_month('month_late', 'MATURITY_DATE', '06/2100', 2100, 6);
SELECT pg_temp.l2_calendar('month_late', 'ACQUISITION_DATE', '02/02/2099', DATE '2099-02-02');
SELECT pg_temp.l2_coded_money('month_late', 'PRINCIPAL_AMOUNT', '40', 40, 'AAA');
SELECT pg_temp.l2_calendar('same_early', 'MATURITY_DATE', '01/10/2099', DATE '2099-01-10');
SELECT pg_temp.l2_coded_money('same_early', 'PRINCIPAL_AMOUNT', '10', 10, 'AAA');
SELECT pg_temp.l2_calendar('same_late', 'MATURITY_DATE', '01/10/2099', DATE '2099-01-10');
SELECT pg_temp.l2_coded_money('same_late', 'PRINCIPAL_AMOUNT', '25', 25, 'BBB');
SELECT pg_temp.l2_text('solo', 'INSTRUMENT_TYPE', 'Refinanced First Lien');
SELECT pg_temp.l2_calendar('open_row', 'MATURITY_DATE', '08/01/2099', DATE '2099-08-01');
SELECT pg_temp.l2_text('other_entity', 'INSTRUMENT_TYPE', 'Refinanced First Lien');
SELECT pg_temp.l2_calendar('other_entity', 'MATURITY_DATE', '03/03/2099', DATE '2099-03-03');

SELECT pg_temp.history_name('month_early', 'TEST OUTCOME ENTITY | MONTH EARLY');
SELECT pg_temp.history_name('month_late', 'TEST OUTCOME ENTITY | MONTH LATE');
SELECT pg_temp.history_name('same_early', 'TEST OUTCOME ENTITY | SAME EARLY');
SELECT pg_temp.history_name('same_late', 'TEST OUTCOME ENTITY | SAME LATE');
SELECT pg_temp.history_name('solo', 'TEST OUTCOME ENTITY | NEW NAME');
SELECT pg_temp.history_name('open_row', 'TEST OUTCOME ENTITY | UNRESOLVED');
SELECT pg_temp.history_name('other_entity', 'TEST OTHER ENTITY | ONLY');

SELECT pg_temp.expect_ok('outcome entities', ARRAY[
  format($$INSERT INTO identity.legal_entity (creation_reason, run_id) VALUES ('TEST ONLY outcome entity', %s)$$, pg_temp.fx('run')),
  format($$INSERT INTO identity.legal_entity (creation_reason, run_id) VALUES ('TEST ONLY other outcome entity', %s)$$, pg_temp.fx('run'))]);

SELECT pg_temp.match_entity('month_early', 'TEST ONLY outcome entity');
SELECT pg_temp.match_entity('month_late', 'TEST ONLY outcome entity');
SELECT pg_temp.match_entity('same_early', 'TEST ONLY outcome entity');
SELECT pg_temp.match_entity('same_late', 'TEST ONLY outcome entity');
SELECT pg_temp.match_entity('solo', 'TEST ONLY outcome entity');
SELECT pg_temp.match_entity('open_row', 'TEST ONLY outcome entity');
SELECT pg_temp.match_entity('other_entity', 'TEST ONLY other outcome entity');

SELECT pg_temp.add_instrument('TEST ONLY outcome instrument months');
SELECT pg_temp.add_instrument('TEST ONLY outcome instrument same');
SELECT pg_temp.add_instrument('TEST ONLY outcome instrument solo');
SELECT pg_temp.add_instrument('TEST ONLY outcome instrument other');
SELECT pg_temp.match_instrument('month_early', 'TEST ONLY outcome instrument months');
SELECT pg_temp.match_instrument('month_late', 'TEST ONLY outcome instrument months');
SELECT pg_temp.match_instrument('same_early', 'TEST ONLY outcome instrument same');
SELECT pg_temp.match_instrument('same_late', 'TEST ONLY outcome instrument same');
SELECT pg_temp.match_instrument('solo', 'TEST ONLY outcome instrument solo');
SELECT pg_temp.match_instrument('other_entity', 'TEST ONLY outcome instrument other');

SELECT pg_temp.add_position('TEST ONLY outcome series months');
SELECT pg_temp.add_position('TEST ONLY outcome series same');
SELECT pg_temp.add_position('TEST ONLY outcome series solo');
SELECT pg_temp.add_position('TEST ONLY outcome series other');
SELECT pg_temp.link_continuity('month_early', 'TEST ONLY outcome series months');
SELECT pg_temp.link_continuity('month_late', 'TEST ONLY outcome series months');
SELECT pg_temp.link_continuity('same_early', 'TEST ONLY outcome series same');
SELECT pg_temp.link_continuity('same_late', 'TEST ONLY outcome series same');
SELECT pg_temp.link_continuity('solo', 'TEST ONLY outcome series solo');
SELECT pg_temp.link_continuity('other_entity', 'TEST ONLY outcome series other');

SET CONSTRAINTS ALL IMMEDIATE;

SELECT pg_temp.check('a comparable maturity change is not a refinancing', (
  SELECT count(*) = 1
     AND bool_and(event_type = 'MATURITY_CHANGED')
     AND bool_and(refinancing_outcome_state = 'UNKNOWN')
     AND bool_and(event_date IS NULL)
     AND bool_and(earlier_reported_date = '2099-03-31')
     AND bool_and(later_reported_date = '2099-09-30')
     AND bool_and(earlier_maturity_raw = '12/2099')
     AND bool_and(later_maturity_raw = '06/2100')
     AND bool_and(earlier_maturity_precision = 'MONTH')
     AND bool_and(later_maturity_precision = 'MONTH')
     AND bool_and(later_position_observation_id = pg_temp.fx('month_late')::text)
     AND bool_and(instrument_resolution_state = 'MATCHED')
     AND bool_and(continuity_state = 'MATCHED')
     AND bool_and(outcome_definition = 'refinancing.outcome_history.v1')
  FROM registry.borrower_refinancing_outcomes(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY outcome entity'))));

SELECT pg_temp.check('evidence and accession stay on the maturity change', (
  SELECT earlier_accession_number = '0000000000-00-000001'
     AND later_accession_number = '0000000000-00-000001'
     AND earlier_observation_evidence_level = 'L1_STRUCTURED_DATASET'
     AND later_observation_evidence_level = 'L1_STRUCTURED_DATASET'
     AND earlier_observation_evidence_id IS NOT NULL
     AND later_observation_evidence_id IS NOT NULL
  FROM registry.borrower_refinancing_outcomes(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY outcome entity'))
  WHERE later_position_observation_id = pg_temp.fx('month_late')::text));

SELECT pg_temp.check('a missing principal stays unknown and currency is not converted', (
  SELECT earlier_principal_state = 'UNKNOWN'
     AND earlier_principal_raw IS NULL
     AND earlier_principal_currency_code IS NULL
     AND later_principal_state = 'REPORTED'
     AND later_principal_raw = '40'
     AND later_principal_currency_code = 'AAA'
     AND later_principal_currency_state = 'FROM_FILING'
  FROM registry.borrower_refinancing_outcomes(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY outcome entity'))
  WHERE later_position_observation_id = pg_temp.fx('month_late')::text));

SELECT pg_temp.check('the same maturity with a principal change is not an outcome', (
  SELECT count(*) = 0
  FROM registry.borrower_refinancing_outcomes(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY outcome entity'))
  WHERE position_id = (
    SELECT p.id::text FROM identity.position p
    WHERE p.creation_reason = 'TEST ONLY outcome series same')));

SELECT pg_temp.check('a single observation is not an exited or refinanced position', (
  SELECT count(*) = 0
  FROM registry.borrower_refinancing_outcomes(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY outcome entity'))
  WHERE position_id = (
    SELECT p.id::text FROM identity.position p
    WHERE p.creation_reason = 'TEST ONLY outcome series solo')));

SELECT pg_temp.check('an instrument type that says refinanced is not an outcome', (
  SELECT count(*) = 0
  FROM registry.borrower_refinancing_outcomes(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY outcome entity')) o
  WHERE o.instrument_type_raw = 'Refinanced First Lien'
     OR o.position_id = (
       SELECT p.id::text FROM identity.position p
       WHERE p.creation_reason = 'TEST ONLY outcome series solo')));

SELECT pg_temp.check('an unresolved instrument is not an outcome', (
  SELECT count(*) = 0
  FROM registry.borrower_refinancing_outcomes(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY outcome entity'))
  WHERE earlier_position_observation_id = pg_temp.fx('open_row')::text
     OR later_position_observation_id = pg_temp.fx('open_row')::text));

SELECT pg_temp.check('another legal entity does not receive this outcome', (
  SELECT count(*) = 0
  FROM registry.borrower_refinancing_outcomes(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY other outcome entity'))));

SELECT pg_temp.check('the outcome read does not invent an explicit event or a transaction date', (
  SELECT position('borrower_position_comparisons' IN pg_get_functiondef('registry.borrower_refinancing_outcomes(uuid)'::regprocedure)) > 0
     AND position('maturity_changed' IN pg_get_functiondef('registry.borrower_refinancing_outcomes(uuid)'::regprocedure)) > 0
     AND position('OFFSET 0' IN pg_get_functiondef('registry.borrower_refinancing_outcomes(uuid)'::regprocedure)) > 0
     AND pg_get_functiondef('registry.borrower_refinancing_outcomes(uuid)'::regprocedure) !~ 'REFINANCING_EXPLICIT|REPAYMENT_EXPLICIT|POSITION_EXITED|probability|score|acquisition'
     AND pg_get_function_result('registry.borrower_refinancing_outcomes(uuid)'::regprocedure) !~* 'probability|score|acquisition|origination'));

SELECT pg_temp.expect_ok('reader can select refinancing outcomes', ARRAY[
  'SET ROLE bdc_reader',
  format('SELECT count(*) FROM registry.borrower_refinancing_outcomes(%L)',
         (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY outcome entity')),
  'RESET ROLE']);
