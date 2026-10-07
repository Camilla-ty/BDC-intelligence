-- Group 39: registry.borrower_position_observations. Fake names and 2099 dates only.
-- The function reads registry.position_read for one MATCHED legal entity.

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

-- A second filing and registrant, so two BDCs and two reported dates stay separate.
CREATE FUNCTION pg_temp.early_bdc_position(pos_key text, ident text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  acc constant text := '0000000000-00-000002';
  sub_id bigint;
  sub_ev bigint;
  registrant_id bigint;
  filing_id bigint;
  row_id bigint;
  ev_row bigint;
  ev_cell bigint;
  soi_id bigint;
  po_id bigint;
  line text;
BEGIN
  line := acc || E'\t9999999902\tTEST BDC 2';
  sub_id := pg_temp.add_row(pg_temp.fx('l_sub'), 70, line);
  sub_ev := pg_temp.add_evidence('L1_STRUCTURED_DATASET', pg_temp.fx('artifact'), sub_id);
  INSERT INTO registry.registrant (cik, run_id, evidence_id)
  VALUES (9999999902, pg_temp.fx('run'), sub_ev)
  RETURNING id INTO registrant_id;
  INSERT INTO registry.filing (accession_number, run_id, evidence_id)
  VALUES (acc, pg_temp.fx('run'), sub_ev)
  RETURNING id INTO filing_id;
  INSERT INTO registry.filing_registrant_link (filing_id, registrant_id, link_source, run_id, evidence_id)
  VALUES (filing_id, registrant_id, 'SUB_TABLE', pg_temp.fx('run'), sub_ev);

  line := acc || E'\t9999999902\tTEST BDC 2\t2099-03-31\t0\t' || ident || E'\t\t\t\t\t';
  row_id := pg_temp.add_row(pg_temp.fx('l_soi'), 71, line);
  ev_row := pg_temp.add_evidence('L1_STRUCTURED_DATASET', pg_temp.fx('artifact'), row_id);
  ev_cell := pg_temp.add_evidence('L1_STRUCTURED_DATASET', pg_temp.fx('artifact'), row_id, 6, 'Investment, Identifier Axis');
  INSERT INTO obs.soi_row_observation (
      tabular_row_id, filing_id, reported_date_raw, reported_date, date_precision,
      qtrs_raw, qtrs, duration_kind, identifier_raw, rule_version_id, evidence_id, run_id)
  VALUES (row_id, filing_id, '2099-03-31', '2099-03-31', 'MONTH_END_ROUNDED', '0', 0,
          'POINT_IN_TIME', ident, pg_temp.fx('r_project'), ev_row, pg_temp.fx('run'))
  RETURNING id INTO soi_id;
  INSERT INTO obs.soi_row_classification (soi_row_observation_id, row_kind, period_role, rule_version_id, run_id)
  VALUES (soi_id, 'IDENTIFIER_ROW', 'UNRESOLVED', pg_temp.fx('r_classify'), pg_temp.fx('run'));
  INSERT INTO obs.position_observation (
      origin_soi_row_observation_id, filing_id, reported_date, date_precision, duration_kind,
      holding_descriptor_raw, rule_version_id, evidence_id, run_id)
  VALUES (soi_id, filing_id, '2099-03-31', 'MONTH_END_ROUNDED', 'POINT_IN_TIME',
          ident, pg_temp.fx('r_position'), ev_row, pg_temp.fx('run'))
  RETURNING id INTO po_id;
  INSERT INTO obs.position_observation_source (position_observation_id, soi_row_observation_id, source_role, run_id)
  VALUES (po_id, soi_id, 'PRIMARY', pg_temp.fx('run'));
  PERFORM pg_temp.put(pos_key, po_id);
  PERFORM pg_temp.put(pos_key || '_cell', ev_cell);
END
$$;

SELECT pg_temp.add_identifier_position('po_late', 'TEST BORROWER HISTORY | LATE LOAN', 50);
SELECT pg_temp.add_identifier_position('po_other', 'TEST BORROWER OTHER | LOAN', 51);
SELECT pg_temp.early_bdc_position('po_early', 'TEST BORROWER HISTORY | EARLY LOAN');

SELECT pg_temp.l2_money('po_late', 'PRINCIPAL_AMOUNT', '100', 100);
SELECT pg_temp.l2_money('po_late', 'COST', '80', 80);
SELECT pg_temp.l2_money('po_late', 'FAIR_VALUE', '70', 70);
SELECT pg_temp.l2_month('po_early', 'MATURITY_DATE', '12/2099', 2099, 12);
SELECT pg_temp.l2_month('po_early', 'ACQUISITION_DATE', '04/2099', 2099, 4);

SELECT pg_temp.history_name('po_late', 'TEST BORROWER HISTORY | LATE LOAN');
SELECT pg_temp.history_name('po_early', 'TEST BORROWER HISTORY | EARLY LOAN');
SELECT pg_temp.history_name('po_other', 'TEST BORROWER OTHER | LOAN');

SELECT pg_temp.expect_ok('two legal entities', ARRAY[
  format($$INSERT INTO identity.legal_entity (creation_reason, run_id) VALUES ('TEST ONLY borrower history entity A', %s)$$, pg_temp.fx('run')),
  format($$INSERT INTO identity.legal_entity (creation_reason, run_id) VALUES ('TEST ONLY borrower history entity B', %s)$$, pg_temp.fx('run'))]);

SELECT pg_temp.match_entity('po_late', 'TEST ONLY borrower history entity A', 'MATCHED');
SELECT pg_temp.match_entity('po_early', 'TEST ONLY borrower history entity A', 'MATCHED');
SELECT pg_temp.match_entity('po_other', 'TEST ONLY borrower history entity B', 'MATCHED');

SELECT pg_temp.expect_ok('the later loan has its own instrument', ARRAY[format(
  $$INSERT INTO identity.instrument (creation_reason, run_id) VALUES ('TEST ONLY borrower history loan', %s)$$,
  pg_temp.fx('run')),
  format(
  $$INSERT INTO resolution.instrument_resolution_decision (
        position_observation_id, instrument_id, state, method, rationale,
        actor_kind, decided_by, decided_at, rule_version_id, evidence_id, run_id)
     SELECT %s, id, 'MATCHED', 'EXACT_IDENTIFIER_AND_TYPE',
            'TEST ONLY: late loan', 'SYSTEM_RULE', 'db tests', now(), %s, %s, %s
     FROM identity.instrument WHERE creation_reason = 'TEST ONLY borrower history loan'$$,
  pg_temp.fx('po_late'), pg_temp.fx('r_resolve'), pg_temp.fx('e_soi_a'), pg_temp.fx('run'))]);

SET CONSTRAINTS ALL IMMEDIATE;

SELECT pg_temp.check('1: the resolved borrower retrieves both of its observations', (
  SELECT count(*) = 2
  FROM registry.borrower_position_observations(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY borrower history entity A')
  )));

SELECT pg_temp.check('2 and 3: newest period first, and the two BDC observations stay separate', (
  SELECT count(*) = 2
     AND (array_agg(reported_date ORDER BY ordinality))[1] = '2099-12-31'
     AND (array_agg(registrant_cik ORDER BY ordinality))[1] = '9999999901'
     AND (array_agg(accession_number ORDER BY ordinality))[1] = '0000000000-00-000001'
     AND (array_agg(reported_date ORDER BY ordinality))[2] = '2099-03-31'
     AND (array_agg(registrant_cik ORDER BY ordinality))[2] = '9999999902'
     AND (array_agg(accession_number ORDER BY ordinality))[2] = '0000000000-00-000002'
     AND (array_agg(position_observation_id ORDER BY ordinality))[1]
         IS DISTINCT FROM (array_agg(position_observation_id ORDER BY ordinality))[2]
  FROM registry.borrower_position_observations(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY borrower history entity A')
  ) WITH ORDINALITY));

SELECT pg_temp.check('4: the early observation keeps an unresolved instrument', (
  SELECT instrument_resolution_state = 'UNRESOLVED'
     AND entity_resolution_state = 'MATCHED'
     AND continuity_state = 'UNRESOLVED'
     AND economic_group_state = 'UNRESOLVED'
  FROM registry.borrower_position_observations(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY borrower history entity A')
  )
  WHERE position_observation_id = pg_temp.fx('po_early')::text));

SELECT pg_temp.check('5: missing principal, cost, and fair value stay UNKNOWN', (
  SELECT principal_state = 'UNKNOWN' AND principal_raw IS NULL
     AND cost_state = 'UNKNOWN' AND cost_raw IS NULL
     AND fair_value_state = 'UNKNOWN' AND fair_value_raw IS NULL
     AND interest_rate_state = 'UNKNOWN' AND interest_rate_raw IS NULL
     AND spread_state = 'UNKNOWN' AND spread_raw IS NULL
     AND interest_rate_floor_state = 'UNKNOWN' AND interest_rate_floor_raw IS NULL
  FROM registry.borrower_position_observations(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY borrower history entity A')
  )
  WHERE position_observation_id = pg_temp.fx('po_early')::text));

SELECT pg_temp.check('5b: observed principal, cost, and fair value are the stored raw values', (
  SELECT principal_state = 'REPORTED' AND principal_raw = '100'
     AND cost_state = 'REPORTED' AND cost_raw = '80'
     AND fair_value_state = 'REPORTED' AND fair_value_raw = '70'
     AND instrument_resolution_state = 'MATCHED'
  FROM registry.borrower_position_observations(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY borrower history entity A')
  )
  WHERE position_observation_id = pg_temp.fx('po_late')::text));

SELECT pg_temp.check('6 and 7: acquisition and maturity stay month text', (
  SELECT acquisition_state = 'REPORTED'
     AND acquisition_raw = '04/2099'
     AND acquisition_precision = 'MONTH'
     AND maturity_source = 'REPORTED_MONTH'
     AND maturity_raw = '12/2099'
     AND maturity_precision = 'MONTH'
  FROM registry.borrower_position_observations(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY borrower history entity A')
  )
  WHERE position_observation_id = pg_temp.fx('po_early')::text));

SELECT pg_temp.check('8: accession and evidence level are returned', (
  SELECT accession_number = '0000000000-00-000001'
     AND observation_evidence_level = 'L1_STRUCTURED_DATASET'
     AND reported_date = '2099-12-31'
  FROM registry.borrower_position_observations(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY borrower history entity A')
  )
  WHERE position_observation_id = pg_temp.fx('po_late')::text));

SELECT pg_temp.check('9: the other legal entity is excluded', (
  SELECT count(*) = 0
  FROM registry.borrower_position_observations(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY borrower history entity A')
  )
  WHERE position_observation_id = pg_temp.fx('po_other')::text));

SELECT pg_temp.check('9b: the other legal entity still has its own observation', (
  SELECT count(*) = 1
     AND bool_and(position_observation_id = pg_temp.fx('po_other')::text)
  FROM registry.borrower_position_observations(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY borrower history entity B')
  )));

SELECT pg_temp.check('10: a missing later period is not a row', (
  SELECT count(*) = 0
  FROM registry.borrower_position_observations(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY borrower history entity A')
  )
  WHERE reported_date = '2099-06-30'));

SELECT pg_temp.check('the matched-entity lookup is the borrower observation set', (
  SELECT (
    SELECT array_agg(position_observation_id ORDER BY position_observation_id)
    FROM registry.borrower_position_observations(
      (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY borrower history entity A')
    )
  ) = (
    SELECT array_agg(m.position_observation_id::text ORDER BY m.position_observation_id)
    FROM registry.matched_entity_position m
    WHERE m.legal_entity_id = (
      SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY borrower history entity A')
  )));

SELECT pg_temp.check('11 and 12: the function does not derive a ratio or write an event', (
  SELECT position('registry.position_read' IN lower(pg_get_functiondef('registry.borrower_position_observations(uuid)'::regprocedure))) > 0
     AND position('matched_entity_position' IN lower(pg_get_functiondef('registry.borrower_position_observations(uuid)'::regprocedure))) > 0
     AND position('borrower_name_observation' IN lower(pg_get_functiondef('registry.borrower_position_observations(uuid)'::regprocedure))) = 0
     AND lower(pg_get_functiondef('registry.borrower_position_observations(uuid)'::regprocedure)) !~ 'insert'
     AND lower(pg_get_functiondef('registry.borrower_position_observations(uuid)'::regprocedure)) !~ 'observation_event'
     AND lower(pg_get_functiondef('registry.borrower_position_observations(uuid)'::regprocedure)) !~ 'derived_value'
     AND lower(pg_get_functiondef('registry.borrower_position_observations(uuid)'::regprocedure)) !~ 'similarity'
     AND lower(pg_get_functiondef('registry.borrower_position_observations(uuid)'::regprocedure)) !~ 'origination'
     AND lower(pg_get_function_result('registry.borrower_position_observations(uuid)'::regprocedure)) !~ 'origination'
     AND lower(pg_get_function_result('registry.borrower_position_observations(uuid)'::regprocedure)) !~ 'ratio'
     AND lower(pg_get_function_result('registry.borrower_position_observations(uuid)'::regprocedure)) !~ 'exit'));

SELECT pg_temp.expect_ok('reader can execute the borrower position function', ARRAY[
  'SET ROLE bdc_reader',
  $$SELECT count(*) FROM registry.borrower_position_observations('00000000-0000-4000-8000-000000000099'::uuid)$$,
  'RESET ROLE']);

SELECT pg_temp.check('research fields are only the stored industry and instrument type heads', (
  SELECT position('INDUSTRY' IN pg_get_viewdef('obs.current_position_research_field'::regclass)) > 0
     AND position('INSTRUMENT_TYPE' IN pg_get_viewdef('obs.current_position_research_field'::regclass)) > 0
     AND position('PRINCIPAL_AMOUNT' IN pg_get_viewdef('obs.current_position_research_field'::regclass)) = 0
     AND position('MATURITY_DATE' IN pg_get_viewdef('obs.current_position_research_field'::regclass)) = 0));

SELECT pg_temp.expect_ok('reader can read stored industry and instrument type', ARRAY[
  'SET ROLE bdc_reader',
  $$SELECT count(*) FROM obs.current_position_research_field WHERE position_observation_id = 0$$,
  'RESET ROLE']);
