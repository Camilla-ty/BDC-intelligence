-- Group 53: entity-scoped combined comparisons/refinancing (0058).
-- Fake names and 2099 dates only. Combined jsonb must equal standalone
-- borrower_position_comparisons and borrower_refinancing_outcomes aggregations.

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

CREATE FUNCTION pg_temp.standalone_comparisons_json(p_legal_entity_id uuid) RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(json_agg(row_to_json(t) ORDER BY
             t.later_reported_date DESC,
             t.earlier_reported_date DESC,
             t.later_registrant_cik ASC NULLS LAST,
             t.position_id ASC,
             t.earlier_position_observation_id ASC,
             t.later_position_observation_id ASC),
           '[]'::json)::jsonb
  FROM registry.borrower_position_comparisons(p_legal_entity_id) t
$$;

CREATE FUNCTION pg_temp.standalone_refinancing_json(p_legal_entity_id uuid) RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(json_agg(row_to_json(t) ORDER BY
             t.later_reported_date DESC,
             t.earlier_reported_date DESC,
             t.position_id,
             t.later_position_observation_id),
           '[]'::json)::jsonb
  FROM registry.borrower_refinancing_outcomes(p_legal_entity_id) t
$$;

CREATE FUNCTION pg_temp.combined_matches_standalone(p_legal_entity_id uuid) RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT c.comparisons::jsonb = pg_temp.standalone_comparisons_json(p_legal_entity_id)
     AND c.refinancing::jsonb = pg_temp.standalone_refinancing_json(p_legal_entity_id)
  FROM registry.borrower_comparisons_and_refinancing(p_legal_entity_id) c
$$;

SELECT pg_temp.expect_ok('scoped combined entities', ARRAY[
  format($$INSERT INTO identity.legal_entity (creation_reason, run_id) VALUES ('TEST ONLY scoped combined A', %s)$$, pg_temp.fx('run')),
  format($$INSERT INTO identity.legal_entity (creation_reason, run_id) VALUES ('TEST ONLY scoped combined B', %s)$$, pg_temp.fx('run')),
  format($$INSERT INTO identity.legal_entity (creation_reason, run_id) VALUES ('TEST ONLY scoped combined C', %s)$$, pg_temp.fx('run')),
  format($$INSERT INTO identity.legal_entity (creation_reason, run_id) VALUES ('TEST ONLY scoped combined other', %s)$$, pg_temp.fx('run'))]);

-- Entity A: maturity-changed refinancing + insufficient maturity pair + same-maturity comparison.
SELECT pg_temp.series_position('a_mar', 'TEST SCOPED COMBINED A | MAR', 250, '2099-03-31');
SELECT pg_temp.series_position('a_jun', 'TEST SCOPED COMBINED A | JUN', 251, '2099-06-30');
SELECT pg_temp.series_position('a_sep', 'TEST SCOPED COMBINED A | SEP', 252, '2099-09-30');
SELECT pg_temp.series_position('a_solo', 'TEST SCOPED COMBINED A | SOLO', 253, '2099-04-30');
SELECT pg_temp.series_position('a_open', 'TEST SCOPED COMBINED A | OPEN', 254, '2099-05-31');
SELECT pg_temp.l2_month('a_mar', 'MATURITY_DATE', '12/2099', 2099, 12);
SELECT pg_temp.l2_coded_money('a_mar', 'PRINCIPAL_AMOUNT', '10', 10, 'AAA');
SELECT pg_temp.l2_month('a_jun', 'MATURITY_DATE', '06/2100', 2100, 6);
SELECT pg_temp.l2_coded_money('a_jun', 'PRINCIPAL_AMOUNT', '40', 40, 'AAA');
SELECT pg_temp.l2_calendar('a_sep', 'MATURITY_DATE', '2099-12-15', DATE '2099-12-15');
SELECT pg_temp.l2_text('a_solo', 'INSTRUMENT_TYPE', 'Refinanced First Lien');
SELECT pg_temp.l2_calendar('a_open', 'MATURITY_DATE', '08/01/2099', DATE '2099-08-01');
SELECT pg_temp.history_name('a_mar', 'TEST SCOPED COMBINED A | MAR');
SELECT pg_temp.history_name('a_jun', 'TEST SCOPED COMBINED A | JUN');
SELECT pg_temp.history_name('a_sep', 'TEST SCOPED COMBINED A | SEP');
SELECT pg_temp.history_name('a_solo', 'TEST SCOPED COMBINED A | SOLO');
SELECT pg_temp.history_name('a_open', 'TEST SCOPED COMBINED A | OPEN');
SELECT pg_temp.match_entity('a_mar', 'TEST ONLY scoped combined A');
SELECT pg_temp.match_entity('a_jun', 'TEST ONLY scoped combined A');
SELECT pg_temp.match_entity('a_sep', 'TEST ONLY scoped combined A');
SELECT pg_temp.match_entity('a_solo', 'TEST ONLY scoped combined A');
SELECT pg_temp.match_entity('a_open', 'TEST ONLY scoped combined A');
SELECT pg_temp.add_instrument('TEST ONLY scoped combined instrument A');
SELECT pg_temp.match_instrument('a_mar', 'TEST ONLY scoped combined instrument A');
SELECT pg_temp.match_instrument('a_jun', 'TEST ONLY scoped combined instrument A');
SELECT pg_temp.match_instrument('a_sep', 'TEST ONLY scoped combined instrument A');
SELECT pg_temp.match_instrument('a_solo', 'TEST ONLY scoped combined instrument A');
SELECT pg_temp.add_position('TEST ONLY scoped combined series A');
SELECT pg_temp.add_position('TEST ONLY scoped combined series A solo');
SELECT pg_temp.link_continuity('a_mar', 'TEST ONLY scoped combined series A');
SELECT pg_temp.link_continuity('a_jun', 'TEST ONLY scoped combined series A');
SELECT pg_temp.link_continuity('a_sep', 'TEST ONLY scoped combined series A');
SELECT pg_temp.link_continuity('a_solo', 'TEST ONLY scoped combined series A solo');

-- Entity B: comparisons present, no refinancing (same maturity, principal change only).
SELECT pg_temp.series_position('b_early', 'TEST SCOPED COMBINED B | EARLY', 255, '2099-01-31');
SELECT pg_temp.series_position('b_late', 'TEST SCOPED COMBINED B | LATE', 256, '2099-02-28');
SELECT pg_temp.l2_calendar('b_early', 'MATURITY_DATE', '01/10/2099', DATE '2099-01-10');
SELECT pg_temp.l2_coded_money('b_early', 'PRINCIPAL_AMOUNT', '10', 10, 'AAA');
SELECT pg_temp.l2_calendar('b_late', 'MATURITY_DATE', '01/10/2099', DATE '2099-01-10');
SELECT pg_temp.l2_coded_money('b_late', 'PRINCIPAL_AMOUNT', '25', 25, 'BBB');
SELECT pg_temp.history_name('b_early', 'TEST SCOPED COMBINED B | EARLY');
SELECT pg_temp.history_name('b_late', 'TEST SCOPED COMBINED B | LATE');
SELECT pg_temp.match_entity('b_early', 'TEST ONLY scoped combined B');
SELECT pg_temp.match_entity('b_late', 'TEST ONLY scoped combined B');
SELECT pg_temp.add_instrument('TEST ONLY scoped combined instrument B');
SELECT pg_temp.match_instrument('b_early', 'TEST ONLY scoped combined instrument B');
SELECT pg_temp.match_instrument('b_late', 'TEST ONLY scoped combined instrument B');
SELECT pg_temp.add_position('TEST ONLY scoped combined series B');
SELECT pg_temp.link_continuity('b_early', 'TEST ONLY scoped combined series B');
SELECT pg_temp.link_continuity('b_late', 'TEST ONLY scoped combined series B');

-- Entity C: single observation — valuation/continuity present, no pair.
SELECT pg_temp.series_position('c_only', 'TEST SCOPED COMBINED C | ONLY', 257, '2099-07-31');
SELECT pg_temp.l2_month('c_only', 'MATURITY_DATE', '03/2099', 2099, 3);
SELECT pg_temp.history_name('c_only', 'TEST SCOPED COMBINED C | ONLY');
SELECT pg_temp.match_entity('c_only', 'TEST ONLY scoped combined C');
SELECT pg_temp.add_instrument('TEST ONLY scoped combined instrument C');
SELECT pg_temp.match_instrument('c_only', 'TEST ONLY scoped combined instrument C');
SELECT pg_temp.add_position('TEST ONLY scoped combined series C');
SELECT pg_temp.link_continuity('c_only', 'TEST ONLY scoped combined series C');

-- Wrong entity: matched elsewhere, must not appear under A.
SELECT pg_temp.series_position('o_only', 'TEST SCOPED COMBINED OTHER | ONLY', 258, '2099-08-31');
SELECT pg_temp.l2_month('o_only', 'MATURITY_DATE', '04/2099', 2099, 4);
SELECT pg_temp.history_name('o_only', 'TEST SCOPED COMBINED OTHER | ONLY');
SELECT pg_temp.match_entity('o_only', 'TEST ONLY scoped combined other');
SELECT pg_temp.add_instrument('TEST ONLY scoped combined instrument other');
SELECT pg_temp.match_instrument('o_only', 'TEST ONLY scoped combined instrument other');
SELECT pg_temp.add_position('TEST ONLY scoped combined series other');
SELECT pg_temp.link_continuity('o_only', 'TEST ONLY scoped combined series other');

SET CONSTRAINTS ALL IMMEDIATE;

SELECT pg_temp.check('entity A combined matches standalone comparisons and refinancing', (
  SELECT pg_temp.combined_matches_standalone(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY scoped combined A')
  )));

SELECT pg_temp.check('entity A has comparison and refinancing rows', (
  SELECT json_array_length(comparisons) >= 1
     AND json_array_length(refinancing) = 1
  FROM registry.borrower_comparisons_and_refinancing(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY scoped combined A'))));

SELECT pg_temp.check('entity A MATURITY_CHANGED fields are preserved', (
  SELECT count(*) = 1
     AND bool_and(elem->>'event_type' = 'MATURITY_CHANGED')
     AND bool_and(elem->>'refinancing_outcome_state' = 'UNKNOWN')
     AND bool_and(elem->>'event_date' IS NULL)
     AND bool_and(elem->>'outcome_definition' = 'refinancing.outcome_history.v1')
     AND bool_and(elem->>'later_position_observation_id' = pg_temp.fx('a_jun')::text)
  FROM registry.borrower_comparisons_and_refinancing(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY scoped combined A')) c,
       LATERAL json_array_elements(c.refinancing) elem));

SELECT pg_temp.check('entity A insufficient maturity pair is not a refinancing row', (
  SELECT count(*) = 0
  FROM registry.borrower_comparisons_and_refinancing(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY scoped combined A')) c,
       LATERAL json_array_elements(c.refinancing) elem
  WHERE elem->>'later_position_observation_id' = pg_temp.fx('a_sep')::text));

SELECT pg_temp.check('entity A insufficient maturity pair remains in comparisons', (
  SELECT bool_or(
           elem->>'later_position_observation_id' = pg_temp.fx('a_sep')::text
       AND elem->>'maturity_comparison_state' = 'INSUFFICIENT_DATA')
  FROM registry.borrower_comparisons_and_refinancing(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY scoped combined A')) c,
       LATERAL json_array_elements(c.comparisons) elem));

SELECT pg_temp.check('solo observation is not a refinancing row', (
  SELECT count(*) = 0
  FROM registry.borrower_comparisons_and_refinancing(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY scoped combined A')) c,
       LATERAL json_array_elements(c.refinancing) elem
  WHERE elem->>'earlier_position_observation_id' = pg_temp.fx('a_solo')::text
     OR elem->>'later_position_observation_id' = pg_temp.fx('a_solo')::text));

SELECT pg_temp.check('unresolved instrument observation is not an outcome', (
  SELECT count(*) = 0
  FROM registry.borrower_comparisons_and_refinancing(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY scoped combined A')) c,
       LATERAL json_array_elements(c.refinancing) elem
  WHERE elem->>'earlier_position_observation_id' = pg_temp.fx('a_open')::text
     OR elem->>'later_position_observation_id' = pg_temp.fx('a_open')::text));

SELECT pg_temp.check('entity B has comparisons and empty refinancing', (
  SELECT json_array_length(comparisons) = 1
     AND refinancing::jsonb = '[]'::jsonb
     AND pg_temp.combined_matches_standalone(
           (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY scoped combined B'))
  FROM registry.borrower_comparisons_and_refinancing(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY scoped combined B'))));

SELECT pg_temp.check('entity C has no pairs', (
  SELECT comparisons::jsonb = '[]'::jsonb
     AND refinancing::jsonb = '[]'::jsonb
     AND pg_temp.combined_matches_standalone(
           (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY scoped combined C'))
  FROM registry.borrower_comparisons_and_refinancing(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY scoped combined C'))));

SELECT pg_temp.check('wrong entity does not receive entity A outcomes', (
  SELECT comparisons::jsonb = '[]'::jsonb
     AND refinancing::jsonb = '[]'::jsonb
     AND pg_temp.combined_matches_standalone(
           (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY scoped combined other'))
  FROM registry.borrower_comparisons_and_refinancing(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY scoped combined other'))));

SELECT pg_temp.check('nonexistent entity yields empty arrays on both paths', (
  SELECT pg_temp.combined_matches_standalone('00000000-0000-4000-8000-000000000099'::uuid)
     AND (SELECT comparisons::jsonb = '[]'::jsonb AND refinancing::jsonb = '[]'::jsonb
          FROM registry.borrower_comparisons_and_refinancing('00000000-0000-4000-8000-000000000099'::uuid))));

SELECT pg_temp.check('exactly one MATERIALIZED comparison graph and 0057 reuse', (
  SELECT position('AS MATERIALIZED' IN def) > 0
     AND position('borrower_valuation_period_comparison' IN def) > 0
     AND position('borrower_position_comparisons' IN def) = 0
     AND position('position_period_comparison' IN def) = 0
     AND position('borrower_refinancing_outcomes' IN def) = 0
     AND (length(def) - length(replace(def, 'AS MATERIALIZED', ''))) / length('AS MATERIALIZED') = 1
  FROM (SELECT pg_get_functiondef(
          'registry.borrower_comparisons_and_refinancing(uuid)'::regprocedure) AS def) s));

SELECT pg_temp.expect_ok('reader can select entity-scoped combined read', ARRAY[
  'SET ROLE bdc_reader',
  format('SELECT comparisons, refinancing FROM registry.borrower_comparisons_and_refinancing(%L)',
         (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY scoped combined A')),
  'RESET ROLE']);
