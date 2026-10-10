-- Group 47: a fact group records role and source-row evidence.
-- Fake 2099 observations only. The group does not rewrite the source row.

SELECT pg_temp.expect_error('a fact group member needs a role', '23502', ARRAY[
  format($$INSERT INTO obs.position_observation_group (filing_id, state, rationale, rule_version_id, run_id)
          VALUES (%s, 'UNRESOLVED', 'TEST ONLY missing role', %s, %s)$$,
         pg_temp.fx('filing'), pg_temp.fx('r_group'), pg_temp.fx('run')),
  format($$INSERT INTO obs.position_observation_group_member (group_id, position_observation_id, evidence_id, run_id)
          VALUES (currval(pg_get_serial_sequence('obs.position_observation_group', 'id')), %s, %s, %s)$$,
         pg_temp.fx('po_a'), pg_temp.fx('e_soi_a'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('fact group member evidence must be the member source row', 'BDCI1', ARRAY[
  format($$INSERT INTO obs.position_observation_group (filing_id, state, rationale, rule_version_id, run_id)
          VALUES (%s, 'UNRESOLVED', 'TEST ONLY wrong evidence', %s, %s)$$,
         pg_temp.fx('filing'), pg_temp.fx('r_group'), pg_temp.fx('run')),
  format($$INSERT INTO obs.position_observation_group_member
            (group_id, position_observation_id, member_role, evidence_id, run_id)
          VALUES (currval(pg_get_serial_sequence('obs.position_observation_group', 'id')),
                  %s, 'BALANCE', %s, %s)$$,
         pg_temp.fx('po_a'), pg_temp.fx('e_soi_b'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_ok('a fact group keeps both source rows and their roles', ARRAY[
  format($$WITH g AS (
             INSERT INTO obs.position_observation_group
               (filing_id, state, rationale, rule_version_id, run_id, grouping_key)
             VALUES (%s, 'UNRESOLVED', 'TEST ONLY fact group', %s, %s, 'v1:test-balance-spread')
             RETURNING id
           )
           INSERT INTO obs.position_observation_group_member
             (group_id, position_observation_id, member_role, evidence_id, run_id)
           SELECT g.id, m.position_observation_id, m.member_role, m.evidence_id, %s
           FROM g
           JOIN (VALUES (%s, 'BALANCE'::obs.soi_fact_member_role, %s),
                        (%s, 'SPREAD'::obs.soi_fact_member_role, %s))
             AS m (position_observation_id, member_role, evidence_id) ON true$$,
         pg_temp.fx('filing'), pg_temp.fx('r_group'), pg_temp.fx('run'), pg_temp.fx('run'),
         pg_temp.fx('po_a'), pg_temp.fx('e_soi_a'), pg_temp.fx('po_b'), pg_temp.fx('e_soi_b')),
  'SET CONSTRAINTS ALL IMMEDIATE']);

SELECT pg_temp.check('the source observation text is unchanged',
  (SELECT holding_descriptor_raw FROM obs.position_observation WHERE id = pg_temp.fx('po_a'))
  = 'TEST BORROWER A | TEST LOAN 1');

SELECT pg_temp.expect_error('a soi fact group with only a balance member is rejected', 'BDCL1', ARRAY[
  format($$WITH rule AS (
             INSERT INTO ops.rule_version (rule_code, rule_kind, version, definition_sha256, spec_reference, description, created_by)
             VALUES ('obs.soi_fact_group', 'GROUPING', '1', repeat('a', 64), 'docs/DATA_MODEL.md', 'TEST ONLY', 'test')
             RETURNING id
           ),
           grp AS (
             INSERT INTO obs.position_observation_group
               (filing_id, state, rationale, rule_version_id, run_id, grouping_key)
             SELECT %s, 'UNRESOLVED', 'TEST ONLY incomplete fact group', rule.id, %s, 'v1:incomplete'
             FROM rule
             RETURNING id
           )
           INSERT INTO obs.position_observation_group_member
             (group_id, position_observation_id, member_role, evidence_id, run_id)
           SELECT grp.id, %s, 'BALANCE', %s, %s FROM grp$$,
         pg_temp.fx('filing'), pg_temp.fx('run'), pg_temp.fx('po_a'), pg_temp.fx('e_soi_a'), pg_temp.fx('run')),
  'SET CONSTRAINTS ALL IMMEDIATE']);

SELECT pg_temp.expect_error('the same grouping key is not inserted twice', '23505', ARRAY[format(
  $$INSERT INTO obs.position_observation_group
      (filing_id, state, rationale, rule_version_id, run_id, grouping_key)
    VALUES (%s, 'UNRESOLVED', 'TEST ONLY duplicate key', %s, %s, 'v1:test-balance-spread')$$,
  pg_temp.fx('filing'), pg_temp.fx('r_group'), pg_temp.fx('run'))]);
