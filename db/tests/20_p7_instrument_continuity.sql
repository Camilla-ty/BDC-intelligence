-- Group 20: P7-min instrument identity and per-registrant continuity (G-10, G-14, G-15).
-- Fake names only. No COST/FV derivation.

SELECT pg_temp.add_identifier_position('po_loan2', 'TEST BORROWER A | TEST LOAN 2', 22);

SELECT pg_temp.expect_ok('identifier names for two distinct instruments of TEST BORROWER A', ARRAY[
  format(
  $$INSERT INTO obs.borrower_name_observation (position_observation_id, source_column_label, source_column_position,
      raw_text, normalized_text, extraction_state, rule_version_id, evidence_id, run_id)
    VALUES (%s, 'Investment, Identifier Axis', 6, 'TEST BORROWER A | TEST LOAN 1',
            'TEST BORROWER A | TEST LOAN 1', 'EXTRACTED', %s, %s, %s)$$,
  pg_temp.fx('po_a'), pg_temp.fx('r_field'), pg_temp.fx('e_ident_a'), pg_temp.fx('run')),
  format(
  $$INSERT INTO obs.borrower_name_observation (position_observation_id, source_column_label, source_column_position,
      raw_text, normalized_text, extraction_state, rule_version_id, evidence_id, run_id)
    VALUES (%s, 'Investment, Identifier Axis', 6, 'TEST BORROWER A | TEST LOAN 2',
            'TEST BORROWER A | TEST LOAN 2', 'EXTRACTED', %s, %s, %s)$$,
  pg_temp.fx('po_loan2'), pg_temp.fx('r_field'), pg_temp.fx('po_loan2_cell'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_ok('two instruments are created; same borrower does not merge them', ARRAY[
  format($$INSERT INTO identity.instrument (creation_reason, run_id) VALUES ('TEST ONLY loan 1', %s)$$, pg_temp.fx('run')),
  format($$INSERT INTO identity.instrument (creation_reason, run_id) VALUES ('TEST ONLY loan 2', %s)$$, pg_temp.fx('run'))]);

SELECT pg_temp.expect_ok('each observation MATCHED to its own instrument', ARRAY[
  format(
  $$INSERT INTO resolution.instrument_resolution_decision (position_observation_id, instrument_id, state, method, rationale,
       actor_kind, decided_by, decided_at, rule_version_id, evidence_id, run_id)
     SELECT %s, id, 'MATCHED', 'EXACT_IDENTIFIER_AND_TYPE',
            'TEST ONLY: loan 1', 'SYSTEM_RULE', 'db tests', now(), %s, %s, %s
     FROM identity.instrument WHERE creation_reason = 'TEST ONLY loan 1'$$,
  pg_temp.fx('po_a'), pg_temp.fx('r_resolve'), pg_temp.fx('e_soi_a'), pg_temp.fx('run')),
  format(
  $$INSERT INTO resolution.instrument_resolution_decision (position_observation_id, instrument_id, state, method, rationale,
       actor_kind, decided_by, decided_at, rule_version_id, evidence_id, run_id)
     SELECT %s, id, 'MATCHED', 'EXACT_IDENTIFIER_AND_TYPE',
            'TEST ONLY: loan 2', 'SYSTEM_RULE', 'db tests', now(), %s, %s, %s
     FROM identity.instrument WHERE creation_reason = 'TEST ONLY loan 2'$$,
  pg_temp.fx('po_loan2'), pg_temp.fx('r_resolve'), pg_temp.fx('e_soi_b'), pg_temp.fx('run'))]);

SELECT pg_temp.check('the two MATCHED instruments remain distinct', (
  SELECT count(DISTINCT d.instrument_id) = 2
     AND bool_and(d.method = 'EXACT_IDENTIFIER_AND_TYPE')
     AND bool_and(d.method NOT ILIKE '%fuzzy%' AND d.method NOT ILIKE '%llm%')
  FROM resolution.current_instrument_resolution d
  WHERE d.position_observation_id IN (pg_temp.fx('po_a'), pg_temp.fx('po_loan2'))));

SELECT pg_temp.expect_ok('two continuity series for the same registrant and different instruments', ARRAY[
  format($$INSERT INTO identity.position (registrant_id, creation_reason, run_id)
           VALUES (%s, 'TEST ONLY series loan 1', %s)$$, pg_temp.fx('registrant'), pg_temp.fx('run')),
  format($$INSERT INTO identity.position (registrant_id, creation_reason, run_id)
           VALUES (%s, 'TEST ONLY series loan 2', %s)$$, pg_temp.fx('registrant'), pg_temp.fx('run')),
  format(
  $$INSERT INTO resolution.position_continuity_decision (position_observation_id, position_id, state, method, rationale,
       actor_kind, decided_by, decided_at, rule_version_id, evidence_id, run_id)
     SELECT %s, id, 'MATCHED', 'SAME_REGISTRANT_AND_INSTRUMENT',
            'TEST ONLY: series 1', 'SYSTEM_RULE', 'db tests', now(), %s, %s, %s
     FROM identity.position WHERE creation_reason = 'TEST ONLY series loan 1'$$,
  pg_temp.fx('po_a'), pg_temp.fx('r_resolve'), pg_temp.fx('e_soi_a'), pg_temp.fx('run')),
  format(
  $$INSERT INTO resolution.position_continuity_decision (position_observation_id, position_id, state, method, rationale,
       actor_kind, decided_by, decided_at, rule_version_id, evidence_id, run_id)
     SELECT %s, id, 'MATCHED', 'SAME_REGISTRANT_AND_INSTRUMENT',
            'TEST ONLY: series 2', 'SYSTEM_RULE', 'db tests', now(), %s, %s, %s
     FROM identity.position WHERE creation_reason = 'TEST ONLY series loan 2'$$,
  pg_temp.fx('po_loan2'), pg_temp.fx('r_resolve'), pg_temp.fx('e_soi_b'), pg_temp.fx('run'))]);

SELECT pg_temp.check('same BDC keeps two series when instruments differ', (
  SELECT count(DISTINCT d.position_id) = 2
  FROM resolution.current_position_continuity d
  WHERE d.position_observation_id IN (pg_temp.fx('po_a'), pg_temp.fx('po_loan2'))));

SELECT pg_temp.check('identity schema has no CIK columns (G-09)', (
  SELECT count(*) = 0 FROM information_schema.columns
  WHERE table_schema = 'identity' AND column_name ILIKE '%cik%'));

SELECT pg_temp.check('P7 does not invent a COST/FV derived input', (
  SELECT count(*) = 0 FROM derived.derived_value_input));

SELECT pg_temp.expect_error('instrument_resolution_decision is append-only', 'BDCA1', ARRAY[
  format('UPDATE resolution.instrument_resolution_decision SET rationale = rationale WHERE position_observation_id = %s',
         pg_temp.fx('po_a'))]);
SELECT pg_temp.expect_error('position_continuity_decision is append-only', 'BDCA1', ARRAY[
  format('UPDATE resolution.position_continuity_decision SET rationale = rationale WHERE position_observation_id = %s',
         pg_temp.fx('po_a'))]);
SELECT pg_temp.expect_error('identity.instrument deletes are rejected', 'BDCA1', ARRAY[
  'DELETE FROM identity.instrument']);
