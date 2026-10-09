-- Group 52: entity-scoped valuation comparison path.
-- Fake names and 2099 dates only. Valuation output must match the pre-0057
-- path that copied registry.position_period_comparison for the same entity.

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

-- Pre-0057 valuation comparison path: copy deltas from the global view.
CREATE FUNCTION pg_temp.valuation_via_global_ppc(p_legal_entity_id uuid)
RETURNS TABLE (
  legal_entity_id text,
  position_observation_id text,
  position_id text,
  instrument_id text,
  borrower_name_raw text,
  reported_date text,
  accession_number text,
  registrant_cik text,
  registrant_link_status text,
  entity_resolution_state text,
  instrument_resolution_state text,
  continuity_state text,
  instrument_type_state text,
  instrument_type_raw text,
  instrument_type_evidence_level text,
  fair_value_state text,
  fair_value_raw text,
  fair_value_numeric text,
  fair_value_currency_state text,
  fair_value_currency_code text,
  principal_state text,
  principal_raw text,
  principal_numeric text,
  principal_currency_state text,
  principal_currency_code text,
  cost_state text,
  cost_raw text,
  cost_numeric text,
  cost_currency_state text,
  cost_currency_code text,
  observation_evidence_id text,
  observation_evidence_level text,
  earlier_reported_date text,
  fair_value_change_state text,
  fair_value_delta text,
  fair_value_percentage_state text,
  fair_value_percentage text,
  fair_value_to_principal_state text,
  fair_value_to_principal text,
  fair_value_to_cost_state text,
  fair_value_to_cost text,
  cross_bdc_comparison_state text,
  valuation_definition text
)
LANGUAGE sql
STABLE
AS $$
  SELECT r.legal_entity_id::text,
         r.position_observation_id::text,
         r.position_id::text,
         r.instrument_id::text,
         r.borrower_name_raw,
         r.reported_date::text,
         r.accession_number,
         r.registrant_cik,
         r.registrant_link_status,
         r.entity_resolution_state,
         r.instrument_resolution_state,
         r.continuity_state,
         CASE
           WHEN instrument_type.n IS NULL OR instrument_type.n = 0 THEN 'UNKNOWN'
           WHEN instrument_type.n = 1 AND instrument_type.reported_n = 1 THEN 'REPORTED'
           ELSE 'MULTIPLE_VALUES'
         END,
         CASE WHEN instrument_type.n = 1 AND instrument_type.reported_n = 1 THEN instrument_type.raw_value END,
         CASE WHEN instrument_type.n = 1 THEN instrument_type.evidence_level END,
         r.fair_value_state,
         r.fair_value_raw,
         r.fair_value_numeric::text,
         r.fair_value_currency_state,
         fair_value_code.currency_code,
         r.principal_state,
         r.principal_raw,
         r.principal_numeric::text,
         r.principal_currency_state,
         principal_code.currency_code,
         r.cost_state,
         r.cost_raw,
         r.cost_numeric::text,
         r.cost_currency_state,
         cost_code.currency_code,
         r.observation_evidence_id::text,
         r.observation_evidence_level,
         cmp.earlier_reported_date::text,
         CASE
           WHEN r.instrument_resolution_state = 'MATCHED'
            AND r.continuity_state = 'MATCHED'
            AND cmp.fair_value_comparison_state IS NOT NULL
           THEN cmp.fair_value_comparison_state
           ELSE 'INSUFFICIENT_DATA'
         END,
         CASE
           WHEN r.instrument_resolution_state = 'MATCHED'
            AND r.continuity_state = 'MATCHED'
           THEN cmp.fair_value_delta::text
         END,
         CASE
           WHEN r.instrument_resolution_state = 'MATCHED'
            AND r.continuity_state = 'MATCHED'
            AND cmp.fair_value_comparison_state = 'COMPARABLE'
            AND cmp.fair_value_delta IS NOT NULL
            AND cmp.earlier_fair_value_numeric IS NOT NULL
            AND cmp.earlier_fair_value_numeric <> 0
            AND r.fair_value_currency_state IS DISTINCT FROM 'AMBIGUOUS'
            AND cmp.earlier_fair_value_currency_state IS DISTINCT FROM 'AMBIGUOUS'
            AND NOT (
              fair_value_code.currency_code IS NOT NULL
              AND cmp.earlier_fair_value_currency_code IS NOT NULL
              AND fair_value_code.currency_code IS DISTINCT FROM cmp.earlier_fair_value_currency_code
            )
           THEN 'COMPARABLE'
           ELSE 'INSUFFICIENT_DATA'
         END,
         CASE
           WHEN r.instrument_resolution_state = 'MATCHED'
            AND r.continuity_state = 'MATCHED'
            AND cmp.fair_value_comparison_state = 'COMPARABLE'
            AND cmp.fair_value_delta IS NOT NULL
            AND cmp.earlier_fair_value_numeric IS NOT NULL
            AND cmp.earlier_fair_value_numeric <> 0
            AND r.fair_value_currency_state IS DISTINCT FROM 'AMBIGUOUS'
            AND cmp.earlier_fair_value_currency_state IS DISTINCT FROM 'AMBIGUOUS'
            AND NOT (
              fair_value_code.currency_code IS NOT NULL
              AND cmp.earlier_fair_value_currency_code IS NOT NULL
              AND fair_value_code.currency_code IS DISTINCT FROM cmp.earlier_fair_value_currency_code
            )
           THEN round(cmp.fair_value_delta / cmp.earlier_fair_value_numeric * 100, 6)::text
         END,
         CASE
           WHEN r.instrument_resolution_state = 'MATCHED'
            AND r.fair_value_state = 'REPORTED'
            AND r.fair_value_numeric IS NOT NULL
            AND r.principal_state = 'REPORTED'
            AND r.principal_numeric IS NOT NULL
            AND r.principal_numeric <> 0
            AND r.fair_value_currency_state IS DISTINCT FROM 'AMBIGUOUS'
            AND r.principal_currency_state IS DISTINCT FROM 'AMBIGUOUS'
            AND NOT (
              fair_value_code.currency_code IS NOT NULL
              AND principal_code.currency_code IS NOT NULL
              AND fair_value_code.currency_code IS DISTINCT FROM principal_code.currency_code
            )
           THEN 'COMPARABLE'
           ELSE 'INSUFFICIENT_DATA'
         END,
         CASE
           WHEN r.instrument_resolution_state = 'MATCHED'
            AND r.fair_value_state = 'REPORTED'
            AND r.fair_value_numeric IS NOT NULL
            AND r.principal_state = 'REPORTED'
            AND r.principal_numeric IS NOT NULL
            AND r.principal_numeric <> 0
            AND r.fair_value_currency_state IS DISTINCT FROM 'AMBIGUOUS'
            AND r.principal_currency_state IS DISTINCT FROM 'AMBIGUOUS'
            AND NOT (
              fair_value_code.currency_code IS NOT NULL
              AND principal_code.currency_code IS NOT NULL
              AND fair_value_code.currency_code IS DISTINCT FROM principal_code.currency_code
            )
           THEN round(r.fair_value_numeric / r.principal_numeric, 6)::text
         END,
         CASE
           WHEN r.instrument_resolution_state = 'MATCHED'
            AND r.fair_value_state = 'REPORTED'
            AND r.fair_value_numeric IS NOT NULL
            AND r.cost_state = 'REPORTED'
            AND r.cost_numeric IS NOT NULL
            AND r.cost_numeric <> 0
            AND r.fair_value_currency_state IS DISTINCT FROM 'AMBIGUOUS'
            AND r.cost_currency_state IS DISTINCT FROM 'AMBIGUOUS'
            AND NOT (
              fair_value_code.currency_code IS NOT NULL
              AND cost_code.currency_code IS NOT NULL
              AND fair_value_code.currency_code IS DISTINCT FROM cost_code.currency_code
            )
           THEN 'COMPARABLE'
           ELSE 'INSUFFICIENT_DATA'
         END,
         CASE
           WHEN r.instrument_resolution_state = 'MATCHED'
            AND r.fair_value_state = 'REPORTED'
            AND r.fair_value_numeric IS NOT NULL
            AND r.cost_state = 'REPORTED'
            AND r.cost_numeric IS NOT NULL
            AND r.cost_numeric <> 0
            AND r.fair_value_currency_state IS DISTINCT FROM 'AMBIGUOUS'
            AND r.cost_currency_state IS DISTINCT FROM 'AMBIGUOUS'
            AND NOT (
              fair_value_code.currency_code IS NOT NULL
              AND cost_code.currency_code IS NOT NULL
              AND fair_value_code.currency_code IS DISTINCT FROM cost_code.currency_code
            )
           THEN round(r.fair_value_numeric / r.cost_numeric, 6)::text
         END,
         'UNAVAILABLE',
         'valuation.position_history.v1'
  FROM (
    SELECT DISTINCT m.position_observation_id
    FROM registry.matched_entity_position m
    WHERE m.legal_entity_id = p_legal_entity_id
  ) matched
  JOIN LATERAL (
    SELECT observed.*
    FROM registry.position_read observed
    WHERE observed.position_observation_id = matched.position_observation_id
      AND observed.legal_entity_id = p_legal_entity_id
      AND observed.entity_resolution_state = 'MATCHED'
    OFFSET 0
  ) r ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS n,
           count(*) FILTER (WHERE rf.value_state = 'REPORTED')::integer AS reported_n,
           min(rf.raw_value) AS raw_value,
           min(rf.evidence_level::text) AS evidence_level
    FROM obs.current_position_research_field rf
    WHERE rf.position_observation_id = r.position_observation_id
      AND rf.field_code = 'INSTRUMENT_TYPE'
  ) instrument_type ON true
  LEFT JOIN LATERAL (
    SELECT CASE WHEN count(*) = 1 THEN min(fv.currency_code) END AS currency_code
    FROM obs.current_position_field_value fv
    WHERE fv.position_observation_id = r.position_observation_id
      AND fv.field_code = 'FAIR_VALUE'
  ) fair_value_code ON true
  LEFT JOIN LATERAL (
    SELECT CASE WHEN count(*) = 1 THEN min(fv.currency_code) END AS currency_code
    FROM obs.current_position_field_value fv
    WHERE fv.position_observation_id = r.position_observation_id
      AND fv.field_code = 'PRINCIPAL_AMOUNT'
  ) principal_code ON true
  LEFT JOIN LATERAL (
    SELECT CASE WHEN count(*) = 1 THEN min(fv.currency_code) END AS currency_code
    FROM obs.current_position_field_value fv
    WHERE fv.position_observation_id = r.position_observation_id
      AND fv.field_code = 'COST'
  ) cost_code ON true
  LEFT JOIN LATERAL (
    SELECT c.earlier_reported_date,
           c.fair_value_comparison_state,
           c.fair_value_delta,
           c.earlier_fair_value_numeric,
           earlier.fair_value_currency_state AS earlier_fair_value_currency_state,
           earlier_code.currency_code AS earlier_fair_value_currency_code
    FROM registry.position_period_comparison c
    JOIN LATERAL (
      SELECT observed.legal_entity_id,
             observed.entity_resolution_state,
             observed.fair_value_currency_state
      FROM registry.position_read observed
      WHERE observed.position_observation_id = c.earlier_position_observation_id
      OFFSET 0
    ) earlier ON true
    LEFT JOIN LATERAL (
      SELECT CASE WHEN count(*) = 1 THEN min(fv.currency_code) END AS currency_code
      FROM obs.current_position_field_value fv
      WHERE fv.position_observation_id = c.earlier_position_observation_id
        AND fv.field_code = 'FAIR_VALUE'
    ) earlier_code ON true
    WHERE r.instrument_resolution_state = 'MATCHED'
      AND r.continuity_state = 'MATCHED'
      AND r.position_id IS NOT NULL
      AND c.position_id = r.position_id
      AND c.later_position_observation_id = r.position_observation_id
      AND earlier.legal_entity_id = p_legal_entity_id
      AND earlier.entity_resolution_state = 'MATCHED'
  ) cmp ON true
  ORDER BY r.reported_date DESC,
           r.registrant_cik ASC NULLS LAST,
           r.accession_number ASC,
           r.position_observation_id ASC
$$;

CREATE FUNCTION pg_temp.same_valuation(p_legal_entity_id uuid) RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT NOT EXISTS (
           SELECT * FROM registry.borrower_position_valuation(p_legal_entity_id)
           EXCEPT
           SELECT * FROM pg_temp.valuation_via_global_ppc(p_legal_entity_id)
         )
     AND NOT EXISTS (
           SELECT * FROM pg_temp.valuation_via_global_ppc(p_legal_entity_id)
           EXCEPT
           SELECT * FROM registry.borrower_position_valuation(p_legal_entity_id)
         )
$$;

SELECT pg_temp.expect_ok('scoped valuation entities', ARRAY[
  format($$INSERT INTO identity.legal_entity (creation_reason, run_id) VALUES ('TEST ONLY scoped valuation A', %s)$$, pg_temp.fx('run')),
  format($$INSERT INTO identity.legal_entity (creation_reason, run_id) VALUES ('TEST ONLY scoped valuation B', %s)$$, pg_temp.fx('run')),
  format($$INSERT INTO identity.legal_entity (creation_reason, run_id) VALUES ('TEST ONLY scoped valuation C', %s)$$, pg_temp.fx('run'))]);

-- Entity A: confirmed comparison rows (fair-value delta) plus insufficient maturity pair.
SELECT pg_temp.series_position('a_mar', 'TEST SCOPED VAL A | MAR', 210, '2099-03-31');
SELECT pg_temp.series_position('a_jun', 'TEST SCOPED VAL A | JUN', 211, '2099-06-30');
SELECT pg_temp.series_position('a_sep', 'TEST SCOPED VAL A | SEP', 212, '2099-09-30');
SELECT pg_temp.l2_coded_money('a_mar', 'FAIR_VALUE', '70', 70, 'AAA');
SELECT pg_temp.l2_coded_money('a_mar', 'PRINCIPAL_AMOUNT', '100', 100, 'AAA');
SELECT pg_temp.l2_coded_money('a_mar', 'COST', '50', 50, 'AAA');
SELECT pg_temp.l2_type('a_mar', 'TEST FIRST LIEN');
SELECT pg_temp.l2_month('a_mar', 'MATURITY_DATE', '12/2099', 2099, 12);
SELECT pg_temp.l2_coded_money('a_jun', 'FAIR_VALUE', '60', 60, 'AAA');
SELECT pg_temp.l2_type('a_jun', 'TEST FIRST LIEN');
SELECT pg_temp.l2_month('a_jun', 'MATURITY_DATE', '06/2100', 2100, 6);
SELECT pg_temp.l2_coded_money('a_sep', 'FAIR_VALUE', '55', 55, 'AAA');
SELECT pg_temp.l2_type('a_sep', 'TEST FIRST LIEN');
SELECT pg_temp.l2_calendar('a_sep', 'MATURITY_DATE', '2099-12-15', '2099-12-15');
SELECT pg_temp.history_name('a_mar', 'TEST SCOPED VAL A | MAR');
SELECT pg_temp.history_name('a_jun', 'TEST SCOPED VAL A | JUN');
SELECT pg_temp.history_name('a_sep', 'TEST SCOPED VAL A | SEP');
SELECT pg_temp.match_entity('a_mar', 'TEST ONLY scoped valuation A');
SELECT pg_temp.match_entity('a_jun', 'TEST ONLY scoped valuation A');
SELECT pg_temp.match_entity('a_sep', 'TEST ONLY scoped valuation A');
SELECT pg_temp.add_instrument('TEST ONLY scoped valuation instrument A');
SELECT pg_temp.match_instrument('a_mar', 'TEST ONLY scoped valuation instrument A');
SELECT pg_temp.match_instrument('a_jun', 'TEST ONLY scoped valuation instrument A');
SELECT pg_temp.match_instrument('a_sep', 'TEST ONLY scoped valuation instrument A');
SELECT pg_temp.add_position('TEST ONLY scoped valuation series A');
SELECT pg_temp.link_continuity('a_mar', 'TEST ONLY scoped valuation series A');
SELECT pg_temp.link_continuity('a_jun', 'TEST ONLY scoped valuation series A');
SELECT pg_temp.link_continuity('a_sep', 'TEST ONLY scoped valuation series A');

-- Entity B: valuation rows but no comparison (single continuity observation).
SELECT pg_temp.series_position('b_only', 'TEST SCOPED VAL B | ONLY', 213, '2099-04-30');
SELECT pg_temp.l2_money('b_only', 'FAIR_VALUE', '40', 40);
SELECT pg_temp.l2_money('b_only', 'PRINCIPAL_AMOUNT', '80', 80);
SELECT pg_temp.l2_type('b_only', 'TEST SECOND LIEN');
SELECT pg_temp.history_name('b_only', 'TEST SCOPED VAL B | ONLY');
SELECT pg_temp.match_entity('b_only', 'TEST ONLY scoped valuation B');
SELECT pg_temp.add_instrument('TEST ONLY scoped valuation instrument B');
SELECT pg_temp.match_instrument('b_only', 'TEST ONLY scoped valuation instrument B');
SELECT pg_temp.add_position('TEST ONLY scoped valuation series B');
SELECT pg_temp.link_continuity('b_only', 'TEST ONLY scoped valuation series B');

-- Entity C: matched valuation row with no continuity / instrument (no comparison path).
SELECT pg_temp.series_position('c_row', 'TEST SCOPED VAL C | OPEN', 214, '2099-05-31');
SELECT pg_temp.l2_money('c_row', 'FAIR_VALUE', '25', 25);
SELECT pg_temp.history_name('c_row', 'TEST SCOPED VAL C | OPEN');
SELECT pg_temp.match_entity('c_row', 'TEST ONLY scoped valuation C');

SET CONSTRAINTS ALL IMMEDIATE;

SELECT pg_temp.check('entity A has confirmed comparison rows', (
  SELECT count(*) = 2
     AND bool_or(later_position_observation_id = pg_temp.fx('a_jun')
             AND earlier_position_observation_id = pg_temp.fx('a_mar'))
     AND bool_or(later_position_observation_id = pg_temp.fx('a_sep')
             AND earlier_position_observation_id = pg_temp.fx('a_jun'))
  FROM registry.borrower_valuation_period_comparison(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY scoped valuation A')
  )));

SELECT pg_temp.check('entity A valuation matches the global comparison path', (
  SELECT pg_temp.same_valuation(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY scoped valuation A')
  )));

SELECT pg_temp.check('entity A copies the fair-value delta onto the later row', (
  SELECT v.fair_value_change_state = 'COMPARABLE'
     AND v.fair_value_delta = '-10'
     AND v.earlier_reported_date = '2099-03-31'
     AND v.fair_value_percentage_state = 'COMPARABLE'
  FROM registry.borrower_position_valuation(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY scoped valuation A')
  ) v
  WHERE v.position_observation_id = pg_temp.fx('a_jun')::text));

SELECT pg_temp.check('entity A insufficient maturity stays insufficient on the scoped comparison', (
  SELECT c.maturity_comparison_state = 'INSUFFICIENT_DATA'
     AND c.maturity_changed IS NULL
     AND c.fair_value_comparison_state = 'COMPARABLE'
  FROM registry.borrower_valuation_period_comparison(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY scoped valuation A')
  ) c
  WHERE c.earlier_position_observation_id = pg_temp.fx('a_jun')
    AND c.later_position_observation_id = pg_temp.fx('a_sep')));

SELECT pg_temp.check('entity B has valuation rows and no comparison rows', (
  SELECT (SELECT count(*) = 1 FROM registry.borrower_position_valuation(
            (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY scoped valuation B')))
     AND (SELECT count(*) = 0 FROM registry.borrower_valuation_period_comparison(
            (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY scoped valuation B')))
     AND (SELECT fair_value_change_state = 'INSUFFICIENT_DATA'
            AND fair_value_delta IS NULL
          FROM registry.borrower_position_valuation(
            (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY scoped valuation B'))
          WHERE position_observation_id = pg_temp.fx('b_only')::text)));

SELECT pg_temp.check('entity B valuation matches the global comparison path', (
  SELECT pg_temp.same_valuation(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY scoped valuation B')
  )));

SELECT pg_temp.check('entity C has valuation without continuity comparison', (
  SELECT count(*) = 1
     AND min(continuity_state) = 'UNRESOLVED'
     AND min(fair_value_change_state) = 'INSUFFICIENT_DATA'
     AND min(fair_value_delta) IS NULL
  FROM registry.borrower_position_valuation(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY scoped valuation C')
  )));

SELECT pg_temp.check('entity C valuation matches the global comparison path', (
  SELECT pg_temp.same_valuation(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY scoped valuation C')
  )));

SELECT pg_temp.check('a nonexistent entity yields empty valuation on both paths', (
  SELECT pg_temp.same_valuation('00000000-0000-4000-8000-000000000099'::uuid)
     AND (SELECT count(*) = 0 FROM registry.borrower_position_valuation('00000000-0000-4000-8000-000000000099'::uuid))
     AND (SELECT count(*) = 0 FROM registry.borrower_valuation_period_comparison('00000000-0000-4000-8000-000000000099'::uuid))));

SELECT pg_temp.check('scoped pairs for entity A match the global view pairs for that series', (
  SELECT NOT EXISTS (
           SELECT position_id, earlier_position_observation_id, later_position_observation_id,
                  earlier_reported_date, later_reported_date,
                  fair_value_comparison_state, fair_value_delta,
                  maturity_comparison_state, maturity_changed,
                  principal_comparison_state, principal_delta,
                  cost_comparison_state, cost_delta,
                  interest_rate_comparison_state, interest_rate_delta,
                  spread_comparison_state, spread_delta,
                  interest_rate_floor_comparison_state, interest_rate_floor_delta,
                  acquisition_comparison_state
           FROM registry.borrower_valuation_period_comparison(
             (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY scoped valuation A'))
           EXCEPT
           SELECT position_id, earlier_position_observation_id, later_position_observation_id,
                  earlier_reported_date, later_reported_date,
                  fair_value_comparison_state, fair_value_delta,
                  maturity_comparison_state, maturity_changed,
                  principal_comparison_state, principal_delta,
                  cost_comparison_state, cost_delta,
                  interest_rate_comparison_state, interest_rate_delta,
                  spread_comparison_state, spread_delta,
                  interest_rate_floor_comparison_state, interest_rate_floor_delta,
                  acquisition_comparison_state
           FROM registry.position_period_comparison
           WHERE position_id = (
             SELECT position_id FROM resolution.current_position_continuity
             WHERE position_observation_id = pg_temp.fx('a_mar'))
         )
     AND NOT EXISTS (
           SELECT position_id, earlier_position_observation_id, later_position_observation_id,
                  earlier_reported_date, later_reported_date,
                  fair_value_comparison_state, fair_value_delta,
                  maturity_comparison_state, maturity_changed,
                  principal_comparison_state, principal_delta,
                  cost_comparison_state, cost_delta,
                  interest_rate_comparison_state, interest_rate_delta,
                  spread_comparison_state, spread_delta,
                  interest_rate_floor_comparison_state, interest_rate_floor_delta,
                  acquisition_comparison_state
           FROM registry.position_period_comparison
           WHERE position_id = (
             SELECT position_id FROM resolution.current_position_continuity
             WHERE position_observation_id = pg_temp.fx('a_mar'))
           EXCEPT
           SELECT position_id, earlier_position_observation_id, later_position_observation_id,
                  earlier_reported_date, later_reported_date,
                  fair_value_comparison_state, fair_value_delta,
                  maturity_comparison_state, maturity_changed,
                  principal_comparison_state, principal_delta,
                  cost_comparison_state, cost_delta,
                  interest_rate_comparison_state, interest_rate_delta,
                  spread_comparison_state, spread_delta,
                  interest_rate_floor_comparison_state, interest_rate_floor_delta,
                  acquisition_comparison_state
           FROM registry.borrower_valuation_period_comparison(
             (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY scoped valuation A'))
         )));

SELECT pg_temp.check('valuation no longer references the global comparison view', (
  SELECT position('borrower_valuation_period_comparison' IN pg_get_functiondef('registry.borrower_position_valuation(uuid)'::regprocedure)) > 0
     AND position('position_period_comparison' IN pg_get_functiondef('registry.borrower_position_valuation(uuid)'::regprocedure)) = 0
     AND position('matched_entity_position' IN pg_get_functiondef('registry.borrower_valuation_period_comparison(uuid)'::regprocedure)) > 0
     AND position('current_position_continuity' IN pg_get_functiondef('registry.borrower_valuation_period_comparison(uuid)'::regprocedure)) > 0
     AND pg_get_functiondef('registry.borrower_valuation_period_comparison(uuid)'::regprocedure) !~* 'score|rank|similarity'));

SELECT pg_temp.expect_ok('reader can select scoped valuation comparison', ARRAY[
  'SET ROLE bdc_reader',
  format('SELECT count(*) FROM registry.borrower_valuation_period_comparison(%L)',
         (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY scoped valuation A')),
  format('SELECT count(*) FROM registry.borrower_position_valuation(%L)',
         (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY scoped valuation A')),
  'RESET ROLE']);
