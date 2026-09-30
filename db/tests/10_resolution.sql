-- Group 10: resolution decisions (G-13, G-14, G-15) and supersession (G-10).
-- No resolution logic exists; these tests exercise only the schema that will hold decisions.

DO $$
BEGIN
  INSERT INTO identity.legal_entity (creation_reason, run_id) VALUES ('TEST ONLY', pg_temp.fx('run'));
  WITH i AS (
    INSERT INTO obs.borrower_name_observation (position_observation_id, source_column_label, source_column_position, raw_text,
        extraction_state, rule_version_id, evidence_id, run_id)
    VALUES (pg_temp.fx('po_a'), 'Investment, Identifier Axis', 6, 'TEST BORROWER A | TEST LOAN 1', 'RAW_ONLY',
            pg_temp.fx('r_field'), pg_temp.fx('e_soi_a'), pg_temp.fx('run'))
    RETURNING id)
  INSERT INTO fx SELECT 'bno', id FROM i;
END
$$;

CREATE FUNCTION pg_temp.entity_decision(state text, with_entity boolean, supersedes bigint, reason text,
                                        actor text DEFAULT 'SYSTEM_RULE') RETURNS text[]
LANGUAGE sql AS $$
  SELECT ARRAY[format(
    $q$INSERT INTO resolution.entity_resolution_decision (borrower_name_observation_id, legal_entity_id, state, method, rationale,
         actor_kind, decided_by, decided_at, rule_version_id, evidence_id, run_id, supersedes_id, supersede_reason)
       VALUES (%s, %s, %L, 'test', 'TEST ONLY', %L, 'db tests', now(), %s, %s, %s, %s, %L)$q$,
    pg_temp.fx('bno'),
    CASE WHEN with_entity THEN '(SELECT id FROM identity.legal_entity LIMIT 1)' ELSE 'NULL' END,
    state, actor, pg_temp.fx('r_resolve'), pg_temp.fx('e_soi_a'), pg_temp.fx('run'),
    coalesce(supersedes::text, 'NULL'), reason)]
$$;

SELECT pg_temp.expect_ok('an UNRESOLVED decision may have no target', pg_temp.entity_decision('UNRESOLVED', false, NULL, NULL));
INSERT INTO fx SELECT 'd1', max(id) FROM resolution.entity_resolution_decision;

SELECT pg_temp.expect_error('a second independent decision for the same subject is rejected', 'BDCS1',
  pg_temp.entity_decision('PROBABLE', true, NULL, NULL));
SELECT pg_temp.expect_error('MATCHED requires a target legal entity', '23514',
  pg_temp.entity_decision('MATCHED', false, pg_temp.fx('d1'), 'test'));
SELECT pg_temp.expect_error('a superseding decision requires a reason', 'BDCS1',
  pg_temp.entity_decision('PROBABLE', true, pg_temp.fx('d1'), NULL));
SELECT pg_temp.expect_error('a reason without supersedes_id is rejected', 'BDCS1',
  pg_temp.entity_decision('PROBABLE', true, NULL, 'stray reason'));
SELECT pg_temp.expect_error('LLM is not a valid actor kind (G-08)', '22P02',
  pg_temp.entity_decision('PROBABLE', true, pg_temp.fx('d1'), 'test', 'LLM'));

SELECT pg_temp.expect_ok('a decision is changed by a new row that supersedes it, with a reason',
  pg_temp.entity_decision('PROBABLE', true, pg_temp.fx('d1'), 'TEST ONLY: new evidence'));
INSERT INTO fx SELECT 'd2', max(id) FROM resolution.entity_resolution_decision;

SELECT pg_temp.check('the current view returns only the latest decision', (
  SELECT count(*) = 1 AND bool_and(id = pg_temp.fx('d2') AND state = 'PROBABLE')
  FROM resolution.current_entity_resolution WHERE borrower_name_observation_id = pg_temp.fx('bno')));
SELECT pg_temp.check('the superseded decision is still stored', (
  SELECT state = 'UNRESOLVED' FROM resolution.entity_resolution_decision WHERE id = pg_temp.fx('d1')));
SELECT pg_temp.expect_error('an already superseded decision cannot be superseded again (no forks)', '23505',
  pg_temp.entity_decision('REJECTED', true, pg_temp.fx('d1'), 'fork'));

SELECT pg_temp.expect_error('supersedes_id must reference the same subject', 'BDCS1', ARRAY[
  format($$INSERT INTO obs.borrower_name_observation (position_observation_id, source_column_label, source_column_position, raw_text,
             extraction_state, rule_version_id, evidence_id, run_id)
           VALUES (%s, 'Investment, Identifier Axis', 6, 'TEST BORROWER A | TEST LOAN 1', 'RAW_ONLY', %s, %s, %s)$$,
         pg_temp.fx('po_b'), pg_temp.fx('r_field'), pg_temp.fx('e_soi_b'), pg_temp.fx('run')),
  format($$INSERT INTO resolution.entity_resolution_decision (borrower_name_observation_id, state, method, rationale, actor_kind,
             decided_by, decided_at, rule_version_id, evidence_id, run_id, supersedes_id, supersede_reason)
           VALUES (currval(pg_get_serial_sequence('obs.borrower_name_observation', 'id')), 'UNRESOLVED', 'test', 'test',
             'SYSTEM_RULE', 'db tests', now(), %s, %s, %s, %s, 'wrong subject')$$,
         pg_temp.fx('r_resolve'), pg_temp.fx('e_soi_b'), pg_temp.fx('run'), pg_temp.fx('d2'))]);

-- Instruments (G-15) and positions
SELECT pg_temp.expect_error('an instrument decision needs exactly one subject', '23514', ARRAY[format(
  $$INSERT INTO resolution.instrument_resolution_decision (state, method, rationale, actor_kind, decided_by, decided_at,
      rule_version_id, evidence_id, run_id)
    VALUES ('UNRESOLVED', 'test', 'test', 'SYSTEM_RULE', 'db tests', now(), %s, %s, %s)$$,
  pg_temp.fx('r_resolve'), pg_temp.fx('e_soi_a'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_ok('the two duplicate SOI rows stay separately UNRESOLVED for instrument identity', ARRAY[format(
  $$INSERT INTO resolution.instrument_resolution_decision (position_observation_id, state, method, rationale, actor_kind,
      decided_by, decided_at, rule_version_id, evidence_id, run_id)
    SELECT p.id, 'UNRESOLVED', 'test', 'TEST ONLY: continuity not unambiguous', 'SYSTEM_RULE', 'db tests', now(), %s, p.evidence_id, %s
    FROM obs.position_observation p WHERE p.filing_id = %s$$,
  pg_temp.fx('r_resolve'), pg_temp.fx('run'), pg_temp.fx('filing'))]);

SELECT pg_temp.check('the duplicate rows have two separate current instrument decisions', (
  SELECT count(*) = 2 FROM resolution.current_instrument_resolution WHERE instrument_id IS NULL));

SELECT pg_temp.expect_error('position continuity cannot link a filing to another registrant''s position', 'BDCI1', ARRAY[
  format($$INSERT INTO registry.registrant (cik, run_id, evidence_id) VALUES (9999999904, %s, %s)$$, pg_temp.fx('run'), pg_temp.fx('e_sub')),
  format($$INSERT INTO identity.position (registrant_id, creation_reason, run_id)
           SELECT id, 'TEST ONLY', %s FROM registry.registrant WHERE cik = 9999999904$$, pg_temp.fx('run')),
  format($$INSERT INTO resolution.position_continuity_decision (position_observation_id, position_id, state, method, rationale,
             actor_kind, decided_by, decided_at, rule_version_id, evidence_id, run_id)
           SELECT %s, pos.id, 'PROBABLE', 'test', 'test', 'SYSTEM_RULE', 'db tests', now(), %s, %s, %s
           FROM identity.position pos JOIN registry.registrant r ON r.id = pos.registrant_id WHERE r.cik = 9999999904$$,
         pg_temp.fx('po_a'), pg_temp.fx('r_resolve'), pg_temp.fx('e_soi_a'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('match candidates must match their kind', '23514', ARRAY[format(
  $$INSERT INTO resolution.match_candidate (candidate_kind, position_observation_id, legal_entity_id, rule_version_id, run_id)
    SELECT 'INSTRUMENT', %s, id, %s, %s FROM identity.legal_entity LIMIT 1$$,
  pg_temp.fx('po_a'), pg_temp.fx('r_resolve'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_ok('group membership decisions are separate from entity decisions (G-14)', ARRAY[
  format($$INSERT INTO identity.economic_group (display_label, creation_reason, run_id) VALUES ('TEST GROUP 1', 'TEST ONLY', %s)$$, pg_temp.fx('run')),
  format($$INSERT INTO resolution.group_membership_decision (legal_entity_id, economic_group_id, state, method, rationale, actor_kind,
             decided_by, decided_at, rule_version_id, evidence_id, run_id)
           SELECT (SELECT id FROM identity.legal_entity LIMIT 1), g.id, 'UNRESOLVED', 'test', 'TEST ONLY', 'HUMAN_REVIEW',
                  'db tests', now(), %s, %s, %s
           FROM identity.economic_group g$$, pg_temp.fx('r_resolve'), pg_temp.fx('e_soi_a'), pg_temp.fx('run'))]);
