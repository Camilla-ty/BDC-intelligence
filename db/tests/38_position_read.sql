-- Group 38: registry.position_read. Fake names and 2099 dates only.
-- The view repeats stored observations and stored decisions. It does not
-- derive cost, fair value, origination, continuity, or an exit.

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

CREATE FUNCTION pg_temp.l2_rate(pos_key text, field_code text, raw text, amount numeric) RETURNS void
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

CREATE FUNCTION pg_temp.read_name(pos_key text, ident text) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO obs.borrower_name_observation (
      position_observation_id, source_column_label, source_column_position,
      raw_text, normalized_text, extraction_state, rule_version_id, evidence_id, run_id)
  VALUES (pg_temp.fx(pos_key), 'Investment, Identifier Axis', 6, ident, ident, 'EXTRACTED',
          pg_temp.fx('r_field'), pg_temp.fx(pos_key || '_cell'), pg_temp.fx('run'))
$$;

SELECT pg_temp.add_identifier_position('po_full', 'TEST BORROWER READ | TEST LOAN 1', 40);
SELECT pg_temp.add_identifier_position('po_sibling', 'TEST BORROWER READ | TEST LOAN 2', 41);
SELECT pg_temp.add_identifier_position('po_nocost', 'TEST BORROWER READ | NO COST', 42);
SELECT pg_temp.add_identifier_position('po_nofv', 'TEST BORROWER READ | NO FAIR VALUE', 43);
SELECT pg_temp.add_identifier_position('po_uninst', 'TEST BORROWER READ | NO INSTRUMENT', 44);
SELECT pg_temp.add_identifier_position('po_month', 'TEST BORROWER READ | MONTH MATURITY', 45);
SELECT pg_temp.add_identifier_position('po_day', 'TEST BORROWER READ | CALENDAR MATURITY', 46);
SELECT pg_temp.add_identifier_position('po_acq', 'TEST BORROWER READ | ACQUISITION', 47);

SELECT pg_temp.l2_money('po_full', 'PRINCIPAL_AMOUNT', '100', 100);
SELECT pg_temp.l2_money('po_full', 'COST', '80', 80);
SELECT pg_temp.l2_money('po_full', 'FAIR_VALUE', '70', 70);
SELECT pg_temp.l2_rate('po_full', 'INTEREST_RATE', '0.05', 0.05);
SELECT pg_temp.l2_rate('po_full', 'SPREAD', '0.01', 0.01);
SELECT pg_temp.l2_rate('po_full', 'INTEREST_RATE_FLOOR', '0.04', 0.04);

SELECT pg_temp.l2_money('po_nocost', 'PRINCIPAL_AMOUNT', '100', 100);
SELECT pg_temp.l2_money('po_nocost', 'FAIR_VALUE', '70', 70);

SELECT pg_temp.l2_money('po_nofv', 'PRINCIPAL_AMOUNT', '100', 100);
SELECT pg_temp.l2_money('po_nofv', 'COST', '80', 80);

SELECT pg_temp.l2_month('po_month', 'MATURITY_DATE', '12/2099', 2099, 12);
SELECT pg_temp.l2_month('po_month', 'ACQUISITION_DATE', '04/2099', 2099, 4);
SELECT pg_temp.l2_calendar('po_day', 'MATURITY_DATE', '2099-06-15', DATE '2099-06-15');
SELECT pg_temp.l2_calendar('po_acq', 'ACQUISITION_DATE', '2099-04-15', DATE '2099-04-15');

SELECT pg_temp.read_name('po_full', 'TEST BORROWER READ | TEST LOAN 1');
SELECT pg_temp.read_name('po_sibling', 'TEST BORROWER READ | TEST LOAN 2');
SELECT pg_temp.read_name('po_uninst', 'TEST BORROWER READ | NO INSTRUMENT');

SELECT pg_temp.expect_ok('one legal entity for the read-model fixture', ARRAY[format(
  $$INSERT INTO identity.legal_entity (creation_reason, run_id)
    VALUES ('TEST ONLY position read entity', %s)$$, pg_temp.fx('run'))]);

SELECT pg_temp.expect_ok('each disclosed name is MATCHED to that entity by an explicit decision', ARRAY[
  format(
  $$INSERT INTO resolution.entity_resolution_decision (
        borrower_name_observation_id, legal_entity_id, state, method, rationale,
        actor_kind, decided_by, decided_at, rule_version_id, evidence_id, run_id)
     SELECT b.id, le.id, 'MATCHED', 'EXACT_NORMALIZED_NAME',
            'TEST ONLY: stored decision', 'SYSTEM_RULE', 'db tests', now(), %s, %s, %s
     FROM obs.current_borrower_name_observation b
     JOIN identity.legal_entity le ON le.creation_reason = 'TEST ONLY position read entity'
     WHERE b.position_observation_id = %s$$,
  pg_temp.fx('r_resolve'), pg_temp.fx('e_soi_a'), pg_temp.fx('run'), pg_temp.fx('po_full')),
  format(
  $$INSERT INTO resolution.entity_resolution_decision (
        borrower_name_observation_id, legal_entity_id, state, method, rationale,
        actor_kind, decided_by, decided_at, rule_version_id, evidence_id, run_id)
     SELECT b.id, le.id, 'MATCHED', 'EXACT_NORMALIZED_NAME',
            'TEST ONLY: stored decision', 'SYSTEM_RULE', 'db tests', now(), %s, %s, %s
     FROM obs.current_borrower_name_observation b
     JOIN identity.legal_entity le ON le.creation_reason = 'TEST ONLY position read entity'
     WHERE b.position_observation_id = %s$$,
  pg_temp.fx('r_resolve'), pg_temp.fx('e_soi_a'), pg_temp.fx('run'), pg_temp.fx('po_sibling')),
  format(
  $$INSERT INTO resolution.entity_resolution_decision (
        borrower_name_observation_id, legal_entity_id, state, method, rationale,
        actor_kind, decided_by, decided_at, rule_version_id, evidence_id, run_id)
     SELECT b.id, le.id, 'MATCHED', 'EXACT_NORMALIZED_NAME',
            'TEST ONLY: stored decision', 'SYSTEM_RULE', 'db tests', now(), %s, %s, %s
     FROM obs.current_borrower_name_observation b
     JOIN identity.legal_entity le ON le.creation_reason = 'TEST ONLY position read entity'
     WHERE b.position_observation_id = %s$$,
  pg_temp.fx('r_resolve'), pg_temp.fx('e_soi_a'), pg_temp.fx('run'), pg_temp.fx('po_uninst'))]);

SELECT pg_temp.expect_ok('two instruments stay separate for one legal entity', ARRAY[
  format($$INSERT INTO identity.instrument (creation_reason, run_id) VALUES ('TEST ONLY position read loan 1', %s)$$, pg_temp.fx('run')),
  format($$INSERT INTO identity.instrument (creation_reason, run_id) VALUES ('TEST ONLY position read loan 2', %s)$$, pg_temp.fx('run')),
  format(
  $$INSERT INTO resolution.instrument_resolution_decision (
        position_observation_id, instrument_id, state, method, rationale,
        actor_kind, decided_by, decided_at, rule_version_id, evidence_id, run_id)
     SELECT %s, id, 'MATCHED', 'EXACT_IDENTIFIER_AND_TYPE',
            'TEST ONLY: loan 1', 'SYSTEM_RULE', 'db tests', now(), %s, %s, %s
     FROM identity.instrument WHERE creation_reason = 'TEST ONLY position read loan 1'$$,
  pg_temp.fx('po_full'), pg_temp.fx('r_resolve'), pg_temp.fx('e_soi_a'), pg_temp.fx('run')),
  format(
  $$INSERT INTO resolution.instrument_resolution_decision (
        position_observation_id, instrument_id, state, method, rationale,
        actor_kind, decided_by, decided_at, rule_version_id, evidence_id, run_id)
     SELECT %s, id, 'MATCHED', 'EXACT_IDENTIFIER_AND_TYPE',
            'TEST ONLY: loan 2', 'SYSTEM_RULE', 'db tests', now(), %s, %s, %s
     FROM identity.instrument WHERE creation_reason = 'TEST ONLY position read loan 2'$$,
  pg_temp.fx('po_sibling'), pg_temp.fx('r_resolve'), pg_temp.fx('e_soi_a'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_ok('two continuity series for the two instruments', ARRAY[
  format($$INSERT INTO identity.position (registrant_id, creation_reason, run_id)
           VALUES (%s, 'TEST ONLY position read series 1', %s)$$, pg_temp.fx('registrant'), pg_temp.fx('run')),
  format($$INSERT INTO identity.position (registrant_id, creation_reason, run_id)
           VALUES (%s, 'TEST ONLY position read series 2', %s)$$, pg_temp.fx('registrant'), pg_temp.fx('run')),
  format(
  $$INSERT INTO resolution.position_continuity_decision (
        position_observation_id, position_id, state, method, rationale,
        actor_kind, decided_by, decided_at, rule_version_id, evidence_id, run_id)
     SELECT %s, id, 'MATCHED', 'SAME_REGISTRANT_AND_INSTRUMENT',
            'TEST ONLY: series 1', 'SYSTEM_RULE', 'db tests', now(), %s, %s, %s
     FROM identity.position WHERE creation_reason = 'TEST ONLY position read series 1'$$,
  pg_temp.fx('po_full'), pg_temp.fx('r_resolve'), pg_temp.fx('e_soi_a'), pg_temp.fx('run')),
  format(
  $$INSERT INTO resolution.position_continuity_decision (
        position_observation_id, position_id, state, method, rationale,
        actor_kind, decided_by, decided_at, rule_version_id, evidence_id, run_id)
     SELECT %s, id, 'MATCHED', 'SAME_REGISTRANT_AND_INSTRUMENT',
            'TEST ONLY: series 2', 'SYSTEM_RULE', 'db tests', now(), %s, %s, %s
     FROM identity.position WHERE creation_reason = 'TEST ONLY position read series 2'$$,
  pg_temp.fx('po_sibling'), pg_temp.fx('r_resolve'), pg_temp.fx('e_soi_a'), pg_temp.fx('run'))]);

SET CONSTRAINTS ALL IMMEDIATE;

SELECT pg_temp.check('grain is one row per position observation', (
  SELECT count(*) = count(DISTINCT position_observation_id)
     AND count(*) = (SELECT count(*) FROM obs.position_observation)
  FROM registry.position_read));

SELECT pg_temp.check('1: a resolved observation exposes stored principal, cost, and fair value', (
  SELECT principal_state = 'REPORTED' AND principal_raw = '100' AND principal_numeric = 100
     AND cost_state = 'REPORTED' AND cost_raw = '80' AND cost_numeric = 80
     AND fair_value_state = 'REPORTED' AND fair_value_raw = '70' AND fair_value_numeric = 70
     AND interest_rate_state = 'REPORTED' AND interest_rate_raw = '0.05' AND interest_rate_numeric = 0.05
     AND spread_state = 'REPORTED' AND spread_raw = '0.01' AND spread_numeric = 0.01
     AND interest_rate_floor_state = 'REPORTED' AND interest_rate_floor_raw = '0.04'
     AND interest_rate_floor_numeric = 0.04
     AND entity_resolution_state = 'MATCHED'
     AND instrument_resolution_state = 'MATCHED'
     AND continuity_state = 'MATCHED'
     AND legal_entity_id IS NOT NULL
     AND instrument_id IS NOT NULL
     AND position_id IS NOT NULL
  FROM registry.position_read
  WHERE position_observation_id = pg_temp.fx('po_full')));

SELECT pg_temp.check('2: missing cost stays UNKNOWN and null', (
  SELECT cost_state = 'UNKNOWN' AND cost_raw IS NULL AND cost_numeric IS NULL
     AND cost_evidence_id IS NULL
     AND principal_state = 'REPORTED' AND principal_numeric = 100
     AND fair_value_state = 'REPORTED' AND fair_value_numeric = 70
  FROM registry.position_read
  WHERE position_observation_id = pg_temp.fx('po_nocost')));

SELECT pg_temp.check('3: missing fair value stays UNKNOWN and null', (
  SELECT fair_value_state = 'UNKNOWN' AND fair_value_raw IS NULL AND fair_value_numeric IS NULL
     AND fair_value_evidence_id IS NULL
     AND principal_numeric = 100 AND cost_numeric = 80
  FROM registry.position_read
  WHERE position_observation_id = pg_temp.fx('po_nofv')));

SELECT pg_temp.check('4: no instrument decision stays UNRESOLVED', (
  SELECT instrument_resolution_state = 'UNRESOLVED'
     AND instrument_id IS NULL
     AND instrument_resolution_evidence_id IS NULL
     AND entity_resolution_state = 'MATCHED'
     AND legal_entity_id IS NOT NULL
  FROM registry.position_read
  WHERE position_observation_id = pg_temp.fx('po_uninst')));

SELECT pg_temp.check('5: no economic-group membership stays UNRESOLVED', (
  SELECT economic_group_state = 'UNRESOLVED'
     AND economic_group_id IS NULL
     AND economic_group_evidence_id IS NULL
     AND entity_resolution_state = 'MATCHED'
     AND NOT EXISTS (
       SELECT 1 FROM resolution.current_group_membership g
       WHERE g.legal_entity_id = r.legal_entity_id)
  FROM registry.position_read r
  WHERE r.position_observation_id = pg_temp.fx('po_full')));

SELECT pg_temp.check('6: month maturity stays a month and does not become a calendar day', (
  SELECT maturity_source = 'REPORTED_MONTH'
     AND maturity_raw = '12/2099'
     AND maturity_date IS NULL
     AND maturity_precision = 'MONTH'
     AND maturity_year = 2099
     AND maturity_month = 12
     AND acquisition_state = 'REPORTED'
     AND acquisition_raw = '04/2099'
     AND acquisition_date IS NULL
     AND acquisition_precision = 'MONTH'
     AND acquisition_year = 2099
     AND acquisition_month = 4
  FROM registry.position_read
  WHERE position_observation_id = pg_temp.fx('po_month')));

SELECT pg_temp.check('7: calendar maturity keeps the stored day', (
  SELECT maturity_source = 'REPORTED_STRUCTURED'
     AND maturity_raw = '2099-06-15'
     AND maturity_date = DATE '2099-06-15'
     AND maturity_precision IS NULL
     AND maturity_year IS NULL
     AND maturity_month IS NULL
  FROM registry.position_read
  WHERE position_observation_id = pg_temp.fx('po_day')));

SELECT pg_temp.check('8: acquisition date is stored and there is no origination column', (
  SELECT acquisition_state = 'REPORTED'
     AND acquisition_raw = '2099-04-15'
     AND acquisition_date = DATE '2099-04-15'
     AND acquisition_precision IS NULL
     AND (SELECT count(*) = 0 FROM information_schema.columns
          WHERE table_schema = 'registry' AND table_name = 'position_read'
            AND column_name ILIKE '%origination%')
  FROM registry.position_read
  WHERE position_observation_id = pg_temp.fx('po_acq')));

SELECT pg_temp.check('9: accession, observation evidence, and field evidence are preserved', (
  SELECT r.accession_number = f.accession_number
     AND r.filing_id = p.filing_id
     AND r.reported_date = p.reported_date
     AND r.observation_evidence_id = p.evidence_id
     AND r.observation_evidence_level = oe.evidence_level::text
     AND r.principal_evidence_id = fv.evidence_id
     AND r.maturity_evidence_id IS NOT DISTINCT FROM mp.evidence_id
     AND r.registrant_link_status = 'LINKED'
     AND r.registrant_cik = lpad(reg.cik::text, 10, '0')
     AND r.origin_soi_row_observation_id = p.origin_soi_row_observation_id
  FROM registry.position_read r
  JOIN obs.position_observation p ON p.id = r.position_observation_id
  JOIN registry.filing f ON f.id = p.filing_id
  JOIN evidence.evidence oe ON oe.id = p.evidence_id
  JOIN registry.registrant reg ON reg.id = r.registrant_id
  JOIN obs.position_field_value fv
    ON fv.position_observation_id = p.id AND fv.field_code = 'PRINCIPAL_AMOUNT'
  JOIN obs.maturity_provenance mp ON mp.position_observation_id = p.id
  WHERE r.position_observation_id = pg_temp.fx('po_full')));

SELECT pg_temp.check('10: a missing observation is not zero', (
  SELECT r.principal_state = 'UNKNOWN' AND r.principal_numeric IS NULL AND r.principal_raw IS NULL
     AND r.cost_state = 'UNKNOWN' AND r.cost_numeric IS NULL
     AND r.fair_value_state = 'UNKNOWN' AND r.fair_value_numeric IS NULL
     AND r.interest_rate_state = 'UNKNOWN' AND r.interest_rate_numeric IS NULL
     AND r.spread_state = 'UNKNOWN' AND r.spread_numeric IS NULL
     AND r.interest_rate_floor_state = 'UNKNOWN' AND r.interest_rate_floor_numeric IS NULL
     AND r.principal_numeric IS DISTINCT FROM 0
     AND r.cost_numeric IS DISTINCT FROM 0
     AND r.fair_value_numeric IS DISTINCT FROM 0
  FROM registry.position_read r
  WHERE r.position_observation_id = pg_temp.fx('po_b')));

SELECT pg_temp.check('10b: two current cost heads are not collapsed to one number', (
  SELECT cost_state = 'MULTIPLE_VALUES' AND cost_numeric IS NULL AND cost_raw IS NULL
     AND principal_state = 'REPORTED' AND principal_numeric = 100
  FROM registry.position_read
  WHERE position_observation_id = pg_temp.fx('po_a')));

SELECT pg_temp.check('11: a period with no observation is not an exit row', (
  SELECT count(*) = 0 FROM registry.position_read WHERE reported_date = DATE '2099-06-30'));

SELECT pg_temp.check('11b: one confirmed observation does not invent a later exit', (
  SELECT count(*) = 1
     AND bool_and(continuity_state = 'MATCHED')
     AND bool_and(first_observed_event_code IS NULL)
  FROM registry.position_read
  WHERE position_id = (
    SELECT id FROM identity.position WHERE creation_reason = 'TEST ONLY position read series 1')));

SELECT pg_temp.check('11c: the read model has no exit, repayment, ratio, score, or rank column', (
  SELECT count(*) = 0 FROM information_schema.columns
  WHERE table_schema = 'registry' AND table_name = 'position_read'
    AND (column_name ILIKE '%exit%'
      OR column_name ILIKE '%repay%'
      OR column_name ILIKE '%fvr%'
      OR column_name ILIKE '%ratio%'
      OR column_name ILIKE '%score%'
      OR column_name ILIKE '%rank%'
      OR column_name ILIKE '%origination%')));

SELECT pg_temp.check('12: maturity columns equal registry.maturity_read', (
  SELECT count(*) = 0
  FROM registry.position_read r
  JOIN registry.maturity_read m USING (position_observation_id)
  WHERE r.maturity_source IS DISTINCT FROM m.maturity_source
     OR r.maturity_raw IS DISTINCT FROM m.maturity_raw
     OR r.maturity_date IS DISTINCT FROM m.maturity_date
     OR r.maturity_precision IS DISTINCT FROM m.maturity_precision
     OR r.maturity_year IS DISTINCT FROM m.maturity_year
     OR r.maturity_month IS DISTINCT FROM m.maturity_month
     OR r.maturity_inspection_state IS DISTINCT FROM m.inspection_state
     OR r.maturity_no_bind_reason IS DISTINCT FROM m.no_bind_reason
     OR r.maturity_filing_verified IS DISTINCT FROM m.filing_verified
     OR r.maturity_document_url IS DISTINCT FROM m.maturity_document_url));

SELECT pg_temp.check('12b: month provenance text is still the maturity view, not this read model', (
  SELECT position('REPORTED_MONTH' IN pg_get_viewdef('obs.maturity_provenance'::regclass)) > 0
     AND position('FILING_MONTH' IN pg_get_viewdef('obs.maturity_provenance'::regclass)) > 0
     AND position('maturity_read' IN pg_get_viewdef('registry.position_read'::regclass)) > 0
     AND position('MATURITY_DATE' IN pg_get_viewdef('registry.position_read'::regclass)) = 0
     AND pg_get_viewdef('registry.position_read'::regclass) !~ 'sum\('
     AND pg_get_viewdef('registry.position_read'::regclass) !~ 'similarity'
     AND pg_get_viewdef('registry.position_read'::regclass) !~ 'derived_value'));

SELECT pg_temp.check('same borrower name decisions do not merge the two instruments', (
  SELECT count(DISTINCT instrument_id) = 2
     AND count(DISTINCT position_id) = 2
     AND count(DISTINCT legal_entity_id) = 1
  FROM registry.position_read
  WHERE position_observation_id IN (pg_temp.fx('po_full'), pg_temp.fx('po_sibling'))));

SELECT pg_temp.check('a stored rate without a normalized number is not parsed by the view', (
  SELECT interest_rate_state = 'REPORTED'
     AND interest_rate_raw = '0.05'
     AND interest_rate_numeric IS NULL
     AND spread_state = 'UNKNOWN'
     AND spread_numeric IS NULL
  FROM registry.position_read
  WHERE position_observation_id = pg_temp.fx('po_a')));

SELECT pg_temp.expect_ok('reader can select the position read model', ARRAY[
  'SET ROLE bdc_reader',
  'SELECT count(*) FROM registry.position_read',
  'RESET ROLE']);
