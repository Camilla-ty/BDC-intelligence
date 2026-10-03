-- Group 19: P6-min legal-entity resolution (G-09, G-10, G-13, G-14). Fake names only.

SELECT pg_temp.add_identifier_position('po_near', 'TEST BORROWER A HOLDCO LLC | TEST LOAN 1', 21);

SELECT pg_temp.expect_ok('exact Golden name observation', ARRAY[format(
  $$INSERT INTO obs.borrower_name_observation (position_observation_id, source_column_label, source_column_position,
      raw_text, normalized_text, extraction_state, rule_version_id, evidence_id, run_id)
    VALUES (%s, 'Investment, Identifier Axis', 6, 'TEST BORROWER A | TEST LOAN 1',
            'TEST BORROWER A | TEST LOAN 1', 'EXTRACTED', %s, %s, %s)$$,
  pg_temp.fx('po_a'), pg_temp.fx('r_field'), pg_temp.fx('e_ident_a'), pg_temp.fx('run'))]);
INSERT INTO fx SELECT 'bno_exact', max(id) FROM obs.borrower_name_observation
WHERE position_observation_id = pg_temp.fx('po_a');

SELECT pg_temp.expect_ok('near-name negative-control observation (Holdco / LLC)', ARRAY[format(
  $$INSERT INTO obs.borrower_name_observation (position_observation_id, source_column_label, source_column_position,
      raw_text, normalized_text, extraction_state, rule_version_id, evidence_id, run_id)
    VALUES (%s, 'Investment, Identifier Axis', 6, 'TEST BORROWER A HOLDCO LLC | TEST LOAN 1',
            'TEST BORROWER A HOLDCO LLC | TEST LOAN 1', 'EXTRACTED', %s, %s, %s)$$,
  pg_temp.fx('po_near'), pg_temp.fx('r_field'), pg_temp.fx('po_near_cell'), pg_temp.fx('run'))]);
INSERT INTO fx SELECT 'bno_near', max(id) FROM obs.borrower_name_observation
WHERE position_observation_id = pg_temp.fx('po_near');

SELECT pg_temp.expect_ok('Golden legal entity has no CIK column to populate', ARRAY[format(
  $$INSERT INTO identity.legal_entity (creation_reason, run_id) VALUES ('TEST ONLY P6-min golden entity', %s)$$,
  pg_temp.fx('run'))]);

SELECT pg_temp.check('identity schema has no CIK columns (G-09)', (
  SELECT count(*) = 0 FROM information_schema.columns
  WHERE table_schema = 'identity' AND column_name ILIKE '%cik%'));

SELECT pg_temp.expect_ok('verified alias stores the disclosed exact name', ARRAY[format(
  $$INSERT INTO identity.legal_entity_alias (legal_entity_id, alias_text, verification_state, rule_version_id, evidence_id, run_id)
     SELECT id, 'TEST BORROWER A | TEST LOAN 1', 'VERIFIED', %s, %s, %s FROM identity.legal_entity LIMIT 1$$,
  pg_temp.fx('r_resolve'), pg_temp.fx('e_soi_a'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_ok('exact normalized name is MATCHED by SYSTEM_RULE', ARRAY[format(
  $$INSERT INTO resolution.entity_resolution_decision (borrower_name_observation_id, legal_entity_id, state, method, rationale,
       actor_kind, decided_by, decided_at, rule_version_id, evidence_id, run_id)
     SELECT %s, le.id, 'MATCHED', 'EXACT_NORMALIZED_NAME',
            'TEST ONLY: normalized_text equals the Golden identifier', 'SYSTEM_RULE', 'db tests', now(), %s, %s, %s
     FROM identity.legal_entity le LIMIT 1$$,
  pg_temp.fx('bno_exact'), pg_temp.fx('r_resolve'), pg_temp.fx('e_soi_a'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_ok('near-name is a LEGAL_ENTITY candidate, not a MATCH', ARRAY[format(
  $$INSERT INTO resolution.match_candidate (candidate_kind, borrower_name_observation_id, legal_entity_id, rule_version_id, run_id)
     SELECT 'LEGAL_ENTITY', %s, id, %s, %s FROM identity.legal_entity LIMIT 1$$,
  pg_temp.fx('bno_near'), pg_temp.fx('r_resolve'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_ok('near-name comparison records DISAGREE on NORMALIZED_NAME', ARRAY[format(
  $$INSERT INTO resolution.match_candidate_comparison (match_candidate_id, attribute_code, outcome, left_evidence_id,
       right_evidence_id, rule_version_id, run_id)
     SELECT c.id, 'NORMALIZED_NAME', 'DISAGREE', %s, %s, %s, %s
     FROM resolution.match_candidate c WHERE c.borrower_name_observation_id = %s$$,
  pg_temp.fx('e_soi_b'), pg_temp.fx('e_soi_a'), pg_temp.fx('r_resolve'), pg_temp.fx('run'), pg_temp.fx('bno_near'))]);

SELECT pg_temp.expect_ok('near-name decision stays UNRESOLVED with no legal_entity_id', ARRAY[format(
  $$INSERT INTO resolution.entity_resolution_decision (borrower_name_observation_id, match_candidate_id, state, method, rationale,
       actor_kind, decided_by, decided_at, rule_version_id, evidence_id, run_id)
     SELECT %s, c.id, 'UNRESOLVED', 'NEAR_NAME_CANDIDATE',
            'TEST ONLY: Holdco / LLC difference is a candidate only', 'SYSTEM_RULE', 'db tests', now(), %s, %s, %s
     FROM resolution.match_candidate c WHERE c.borrower_name_observation_id = %s$$,
  pg_temp.fx('bno_near'), pg_temp.fx('r_resolve'), pg_temp.fx('e_soi_b'), pg_temp.fx('run'), pg_temp.fx('bno_near'))]);

SELECT pg_temp.check('MATCHED targets the Golden entity; near-name is UNRESOLVED and unmerged', (
  SELECT count(*) FILTER (WHERE d.state = 'MATCHED' AND d.legal_entity_id IS NOT NULL AND d.method = 'EXACT_NORMALIZED_NAME') = 1
     AND count(*) FILTER (WHERE d.state = 'UNRESOLVED' AND d.legal_entity_id IS NULL AND d.method = 'NEAR_NAME_CANDIDATE') = 1
     AND bool_and(d.actor_kind = 'SYSTEM_RULE')
     AND bool_and(d.method NOT ILIKE '%fuzzy%' AND d.method NOT ILIKE '%llm%')
  FROM resolution.current_entity_resolution d
  WHERE d.borrower_name_observation_id IN (pg_temp.fx('bno_exact'), pg_temp.fx('bno_near'))));

SELECT pg_temp.check('no economic-group membership is inferred from the near-name', (
  SELECT count(*) = 0 FROM resolution.group_membership_decision));

SELECT pg_temp.expect_error('entity_resolution_decision is append-only', 'BDCA1', ARRAY[
  format('UPDATE resolution.entity_resolution_decision SET rationale = rationale WHERE borrower_name_observation_id = %s',
         pg_temp.fx('bno_exact'))]);
SELECT pg_temp.expect_error('legal_entity deletes are rejected', 'BDCA1', ARRAY[
  'DELETE FROM identity.legal_entity']);
