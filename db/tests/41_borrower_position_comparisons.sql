-- Group 41: registry.borrower_position_comparisons. Fake names and 2099 dates only.
-- The function copies registry.position_period_comparison for one MATCHED legal entity.

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

CREATE FUNCTION pg_temp.match_entity(pos_key text, reason text, state text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO resolution.entity_resolution_decision (
      borrower_name_observation_id, legal_entity_id, state, method, rationale,
      actor_kind, decided_by, decided_at, rule_version_id, evidence_id, run_id)
  SELECT b.id, le.id, state::ref.resolution_state, 'EXACT_NORMALIZED_NAME',
         'TEST ONLY: stored decision', 'SYSTEM_RULE', 'db tests', now(),
         pg_temp.fx('r_resolve'), pg_temp.fx('e_soi_a'), pg_temp.fx('run')
  FROM obs.current_borrower_name_observation b
  JOIN identity.legal_entity le ON le.creation_reason = reason
  WHERE b.position_observation_id = pg_temp.fx(pos_key);
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
  IF NOT FOUND THEN
    RAISE EXCEPTION 'missing test position %', reason;
  END IF;
END
$$;

SELECT pg_temp.series_position('a_mar', 'TEST COMPARISON ENTITY A | MAR', 100, '2099-03-31');
SELECT pg_temp.series_position('a_jun', 'TEST COMPARISON ENTITY A | JUN', 101, '2099-06-30');
SELECT pg_temp.series_position('a_sep', 'TEST COMPARISON ENTITY A | SEP', 102, '2099-09-30');
SELECT pg_temp.series_position('b_mar', 'TEST COMPARISON ENTITY B | MAR', 103, '2099-03-31');
SELECT pg_temp.series_position('b_jun', 'TEST COMPARISON ENTITY B | JUN', 104, '2099-06-30');
SELECT pg_temp.series_position('s_mar', 'TEST COMPARISON SPLIT | MAR', 105, '2099-03-31');
SELECT pg_temp.series_position('s_jun', 'TEST COMPARISON SPLIT | JUN', 106, '2099-06-30');

SELECT pg_temp.l2_money('a_mar', 'PRINCIPAL_AMOUNT', '100', 100);
SELECT pg_temp.l2_money('a_mar', 'FAIR_VALUE', '70', 70);
SELECT pg_temp.l2_month('a_mar', 'MATURITY_DATE', '12/2099', 2099, 12);
SELECT pg_temp.l2_calendar('a_mar', 'ACQUISITION_DATE', '2099-01-15', DATE '2099-01-15');
SELECT pg_temp.l2_money('a_jun', 'PRINCIPAL_AMOUNT', '120', 120);
SELECT pg_temp.l2_money('a_jun', 'FAIR_VALUE', '60', 60);
SELECT pg_temp.l2_month('a_jun', 'MATURITY_DATE', '06/2100', 2100, 6);
SELECT pg_temp.l2_calendar('a_jun', 'ACQUISITION_DATE', '2099-01-15', DATE '2099-01-15');
SELECT pg_temp.l2_calendar('a_sep', 'MATURITY_DATE', '2099-12-15', DATE '2099-12-15');

SELECT pg_temp.history_name('a_mar', 'TEST COMPARISON ENTITY A | MAR');
SELECT pg_temp.history_name('a_jun', 'TEST COMPARISON ENTITY A | JUN');
SELECT pg_temp.history_name('a_sep', 'TEST COMPARISON ENTITY A | SEP');
SELECT pg_temp.history_name('b_mar', 'TEST COMPARISON ENTITY B | MAR');
SELECT pg_temp.history_name('b_jun', 'TEST COMPARISON ENTITY B | JUN');
SELECT pg_temp.history_name('s_mar', 'TEST COMPARISON SPLIT | MAR');
SELECT pg_temp.history_name('s_jun', 'TEST COMPARISON SPLIT | JUN');

SELECT pg_temp.expect_ok('two legal entities', ARRAY[
  format($$INSERT INTO identity.legal_entity (creation_reason, run_id) VALUES ('TEST ONLY comparison entity A', %s)$$, pg_temp.fx('run')),
  format($$INSERT INTO identity.legal_entity (creation_reason, run_id) VALUES ('TEST ONLY comparison entity B', %s)$$, pg_temp.fx('run'))]);

SELECT pg_temp.match_entity('a_mar', 'TEST ONLY comparison entity A', 'MATCHED');
SELECT pg_temp.match_entity('a_jun', 'TEST ONLY comparison entity A', 'MATCHED');
SELECT pg_temp.match_entity('a_sep', 'TEST ONLY comparison entity A', 'MATCHED');
SELECT pg_temp.match_entity('b_mar', 'TEST ONLY comparison entity B', 'MATCHED');
SELECT pg_temp.match_entity('b_jun', 'TEST ONLY comparison entity B', 'MATCHED');
SELECT pg_temp.match_entity('s_mar', 'TEST ONLY comparison entity A', 'MATCHED');
SELECT pg_temp.match_entity('s_jun', 'TEST ONLY comparison entity B', 'MATCHED');

SELECT pg_temp.add_position('TEST ONLY borrower comparison series A');
SELECT pg_temp.add_position('TEST ONLY borrower comparison series B');
SELECT pg_temp.add_position('TEST ONLY borrower comparison series split');
SELECT pg_temp.link_continuity('a_mar', 'TEST ONLY borrower comparison series A');
SELECT pg_temp.link_continuity('a_jun', 'TEST ONLY borrower comparison series A');
SELECT pg_temp.link_continuity('a_sep', 'TEST ONLY borrower comparison series A');
SELECT pg_temp.link_continuity('b_mar', 'TEST ONLY borrower comparison series B');
SELECT pg_temp.link_continuity('b_jun', 'TEST ONLY borrower comparison series B');
SELECT pg_temp.link_continuity('s_mar', 'TEST ONLY borrower comparison series split');
SELECT pg_temp.link_continuity('s_jun', 'TEST ONLY borrower comparison series split');

SET CONSTRAINTS ALL IMMEDIATE;

SELECT pg_temp.check('the entity receives its consecutive comparisons in later-date order', (
  SELECT count(*) = 2
     AND (array_agg(later_reported_date ORDER BY ordinality))[1] = '2099-09-30'
     AND (array_agg(earlier_reported_date ORDER BY ordinality))[1] = '2099-06-30'
     AND (array_agg(later_reported_date ORDER BY ordinality))[2] = '2099-06-30'
     AND (array_agg(earlier_reported_date ORDER BY ordinality))[2] = '2099-03-31'
     AND (array_agg(earlier_position_observation_id ORDER BY ordinality))[2] = pg_temp.fx('a_mar')::text
     AND (array_agg(later_position_observation_id ORDER BY ordinality))[2] = pg_temp.fx('a_jun')::text
  FROM registry.borrower_position_comparisons(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY comparison entity A')
  ) WITH ORDINALITY));

SELECT pg_temp.check('stored principal and fair-value deltas are copied', (
  SELECT f.principal_delta = c.principal_delta::text
     AND f.principal_delta = '20'
     AND f.fair_value_delta = c.fair_value_delta::text
     AND f.fair_value_delta = '-10'
     AND f.principal_comparison_state = 'COMPARABLE'
     AND f.fair_value_comparison_state = 'COMPARABLE'
  FROM registry.borrower_position_comparisons(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY comparison entity A')
  ) f
  JOIN registry.position_period_comparison c
    ON c.earlier_position_observation_id = f.earlier_position_observation_id::bigint
   AND c.later_position_observation_id = f.later_position_observation_id::bigint
  WHERE f.earlier_position_observation_id = pg_temp.fx('a_mar')::text
    AND f.later_position_observation_id = pg_temp.fx('a_jun')::text));

SELECT pg_temp.check('a missing principal stays null', (
  SELECT principal_comparison_state = 'INSUFFICIENT_DATA'
     AND principal_delta IS NULL
  FROM registry.borrower_position_comparisons(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY comparison entity A')
  )
  WHERE earlier_position_observation_id = pg_temp.fx('a_jun')::text
    AND later_position_observation_id = pg_temp.fx('a_sep')::text));

SELECT pg_temp.check('month maturity stays month text', (
  SELECT maturity_comparison_state = 'COMPARABLE'
     AND maturity_changed
     AND earlier_maturity_precision = 'MONTH'
     AND later_maturity_precision = 'MONTH'
     AND earlier_maturity_raw = '12/2099'
     AND later_maturity_raw = '06/2100'
     AND earlier_maturity_date IS NULL
     AND later_maturity_date IS NULL
  FROM registry.borrower_position_comparisons(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY comparison entity A')
  )
  WHERE earlier_position_observation_id = pg_temp.fx('a_mar')::text
    AND later_position_observation_id = pg_temp.fx('a_jun')::text));

SELECT pg_temp.check('mixed maturity precision is not decided here', (
  SELECT maturity_comparison_state = 'INSUFFICIENT_DATA'
     AND maturity_changed IS NULL
     AND later_maturity_date = '2099-12-15'
     AND later_maturity_precision IS NULL
  FROM registry.borrower_position_comparisons(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY comparison entity A')
  )
  WHERE earlier_position_observation_id = pg_temp.fx('a_jun')::text
    AND later_position_observation_id = pg_temp.fx('a_sep')::text));

SELECT pg_temp.check('another legal entity is a separate result', (
  SELECT count(*) = 1
     AND min(earlier_position_observation_id) = pg_temp.fx('b_mar')::text
     AND min(later_position_observation_id) = pg_temp.fx('b_jun')::text
  FROM registry.borrower_position_comparisons(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY comparison entity B')
  )));

SELECT pg_temp.check('a split entity pair stays in the comparison view and out of both borrowers', (
  SELECT (SELECT count(*) = 1 FROM registry.position_period_comparison
          WHERE earlier_position_observation_id = pg_temp.fx('s_mar')
            AND later_position_observation_id = pg_temp.fx('s_jun'))
     AND (SELECT count(*) = 0 FROM registry.borrower_position_comparisons(
            (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY comparison entity A'))
          WHERE earlier_position_observation_id = pg_temp.fx('s_mar')::text
             OR later_position_observation_id = pg_temp.fx('s_jun')::text)
     AND (SELECT count(*) = 0 FROM registry.borrower_position_comparisons(
            (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY comparison entity B'))
          WHERE earlier_position_observation_id = pg_temp.fx('s_mar')::text
             OR later_position_observation_id = pg_temp.fx('s_jun')::text)));

SELECT pg_temp.check('both accession and evidence references are copied', (
  SELECT f.earlier_accession_number = c.earlier_accession_number
     AND f.later_accession_number = c.later_accession_number
     AND f.earlier_observation_evidence_id = c.earlier_observation_evidence_id::text
     AND f.later_observation_evidence_id = c.later_observation_evidence_id::text
     AND f.earlier_observation_evidence_level = 'L1_STRUCTURED_DATASET'
     AND f.later_observation_evidence_level = 'L1_STRUCTURED_DATASET'
  FROM registry.borrower_position_comparisons(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY comparison entity A')
  ) f
  JOIN registry.position_period_comparison c
    ON c.earlier_position_observation_id = f.earlier_position_observation_id::bigint
   AND c.later_position_observation_id = f.later_position_observation_id::bigint
  WHERE f.earlier_position_observation_id = pg_temp.fx('a_mar')::text));

SELECT pg_temp.check('the function reads the comparison view and does not subtract', (
  SELECT position('position_period_comparison' IN pg_get_functiondef('registry.borrower_position_comparisons(uuid)'::regprocedure)) > 0
     AND position('position_read' IN pg_get_functiondef('registry.borrower_position_comparisons(uuid)'::regprocedure)) > 0
     AND position('LATERAL' IN pg_get_functiondef('registry.borrower_position_comparisons(uuid)'::regprocedure)) > 0
     AND position('principal_delta::text' IN pg_get_functiondef('registry.borrower_position_comparisons(uuid)'::regprocedure)) > 0
     AND position('principal_numeric' IN pg_get_functiondef('registry.borrower_position_comparisons(uuid)'::regprocedure)) = 0
     AND pg_get_functiondef('registry.borrower_position_comparisons(uuid)'::regprocedure) !~ 'similarity'
     AND pg_get_functiondef('registry.borrower_position_comparisons(uuid)'::regprocedure) !~ 'sum\('));

SELECT pg_temp.check('the borrower comparison has no credit-event or ratio column', (
  SELECT pg_get_functiondef('registry.borrower_position_comparisons(uuid)'::regprocedure) !~* 'origination|fvr|refinanc|repay|[^a-z]exit'
     AND pg_get_functiondef('registry.borrower_position_comparisons(uuid)'::regprocedure) !~* 'score|rank|similarity'));

SELECT pg_temp.expect_ok('reader can select borrower position comparisons', ARRAY[
  'SET ROLE bdc_reader',
  format('SELECT count(*) FROM registry.borrower_position_comparisons(%L)',
         (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY comparison entity A')),
  'RESET ROLE']);
