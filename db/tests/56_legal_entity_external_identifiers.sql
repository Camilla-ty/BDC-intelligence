-- Group 56: ADR 0018 external identifiers. Obviously fake structural values only.

SELECT pg_temp.expect_ok('two legal entities for identifier tests', ARRAY[
  format($$INSERT INTO identity.legal_entity (id, creation_reason, run_id)
            VALUES ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'TEST ONLY identifier A', %s)$$, pg_temp.fx('run')),
  format($$INSERT INTO identity.legal_entity (id, creation_reason, run_id)
            VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'TEST ONLY identifier B', %s)$$, pg_temp.fx('run'))
]);

SELECT pg_temp.check('pipeline rule kind is EXTRACTION',
  (SELECT rule_kind::text = 'EXTRACTION' FROM ops.rule_version
    WHERE rule_code = 'identity.legal_entity_identifier.pipeline_unverified'));

SELECT pg_temp.check('human rule kind is REVIEW_PROCEDURE',
  (SELECT rule_kind::text = 'REVIEW_PROCEDURE' FROM ops.rule_version
    WHERE rule_code = 'identity.legal_entity_identifier.human_review'));

SELECT pg_temp.check('identifier helpers pin search_path and write helpers are security definer',
  NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'identity'
      AND p.proname IN (
        'assert_identifier_pipeline_writer',
        'assert_identifier_resolution_writer',
        'pipeline_unverified_identifier_rule_version_id',
        'human_review_identifier_rule_version_id',
        'identifier_citation_ok',
        'begin_legal_entity_identifier_run',
        'record_unverified_legal_entity_identifier',
        'verify_legal_entity_identifier',
        'withdraw_legal_entity_identifier'
      )
      AND NOT EXISTS (
        SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) cfg
        WHERE cfg LIKE 'search_path=%'
      )
  )
  AND (SELECT prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'identity' AND p.proname = 'record_unverified_legal_entity_identifier')
  AND (SELECT prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'identity' AND p.proname = 'verify_legal_entity_identifier')
  AND (SELECT prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'identity' AND p.proname = 'withdraw_legal_entity_identifier'));

SELECT pg_temp.expect_error('pipeline cannot insert identifier rows directly', '42501', ARRAY[
  'SET ROLE bdc_pipeline_writer',
  format($$INSERT INTO identity.legal_entity_identifier (
             legal_entity_id, scheme, relationship_role, raw_value, verification_state,
             actor_kind, decided_by, decided_at, rule_version_id, run_id, evidence_id)
           VALUES (
             'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'CIK', 'OWN', 'TEST-CIK-1', 'UNVERIFIED',
             'SYSTEM_RULE', 'forged', now(),
             (SELECT id FROM ops.rule_version
               WHERE rule_code = 'identity.legal_entity_identifier.pipeline_unverified'),
             %s, %s)$$, pg_temp.fx('run'), pg_temp.fx('e_sub'))
]);

SELECT pg_temp.expect_error('FILER is not a v1 relationship role', '23514', ARRAY[
  format($$INSERT INTO identity.legal_entity_identifier (
             legal_entity_id, scheme, relationship_role, raw_value, verification_state,
             actor_kind, decided_by, decided_at, rule_version_id, run_id, evidence_id)
           VALUES (
             'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'CIK', 'FILER', 'TEST-CIK-FILER', 'UNVERIFIED',
             'SYSTEM_RULE', 'pipeline:legal_entity_identifier', now(),
             (SELECT id FROM ops.rule_version
               WHERE rule_code = 'identity.legal_entity_identifier.pipeline_unverified'),
             %s, %s)$$, pg_temp.fx('run'), pg_temp.fx('e_sub'))
]);

SELECT pg_temp.expect_ok('pipeline records an unverified OWN CIK', ARRAY[
  'SET ROLE bdc_pipeline_writer',
  format($$SELECT identity.record_unverified_legal_entity_identifier(
             'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'CIK', 'OWN', 'TEST-CIK-1',
             %s, %s, NULL, NULL)$$, pg_temp.fx('e_sub'), pg_temp.fx('run')),
  'RESET ROLE']);

SELECT pg_temp.check('unverified tip keeps raw value, null normalized value, and system attribution',
  (SELECT raw_value = 'TEST-CIK-1'
      AND normalized_value IS NULL
      AND verification_state = 'UNVERIFIED'
      AND actor_kind = 'SYSTEM_RULE'
      AND decided_by = 'pipeline:legal_entity_identifier'
      AND evidence_id = pg_temp.fx('e_sub')
    FROM identity.current_legal_entity_identifier
    WHERE legal_entity_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'
      AND scheme = 'CIK'
      AND relationship_role = 'OWN'
      AND raw_value = 'TEST-CIK-1'));

INSERT INTO fx
SELECT 'tip_cik_1', id
FROM identity.current_legal_entity_identifier
WHERE legal_entity_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'
  AND scheme = 'CIK' AND relationship_role = 'OWN' AND raw_value = 'TEST-CIK-1';

SELECT pg_temp.expect_error('second root for the same subject is rejected', 'BDCS2', ARRAY[
  'SET ROLE bdc_pipeline_writer',
  format($$SELECT identity.record_unverified_legal_entity_identifier(
             'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'CIK', 'OWN', 'TEST-CIK-1',
             %s, %s, NULL, NULL)$$, pg_temp.fx('e_sub'), pg_temp.fx('run'))
]);

SELECT pg_temp.expect_error('stale expected head is rejected', 'BDCS2', ARRAY[
  'SET ROLE bdc_pipeline_writer',
  format($$SELECT identity.record_unverified_legal_entity_identifier(
             'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'CIK', 'OWN', 'TEST-CIK-1',
             %s, %s, %s, 'TEST ONLY stale')$$,
          pg_temp.fx('e_sub'), pg_temp.fx('run'), pg_temp.fx('tip_cik_1') + 999)
]);

SELECT pg_temp.expect_error('pipeline cannot verify an identifier', '42501', ARRAY[
  'SET ROLE bdc_pipeline_writer',
  format($$SELECT identity.verify_legal_entity_identifier(
             'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'CIK', 'OWN', 'TEST-CIK-1',
             'TEST RESEARCHER', %s, NULL, NULL, NULL, %s)$$,
          pg_temp.fx('e_sub'), pg_temp.fx('tip_cik_1'))
]);

SELECT pg_temp.expect_ok('resolution writer verifies the OWN CIK by superseding it', ARRAY[
  'SET ROLE resolution_writer',
  format($$SELECT identity.verify_legal_entity_identifier(
             'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'CIK', 'OWN', 'TEST-CIK-1',
             'TEST RESEARCHER', %s, NULL, NULL, NULL, %s)$$,
          pg_temp.fx('e_sub'), pg_temp.fx('tip_cik_1')),
  'RESET ROLE']);

SELECT pg_temp.check('verified tip is human review and the prior row remains',
  (SELECT verification_state = 'VERIFIED' AND actor_kind = 'HUMAN_REVIEW'
      AND supersedes_id = pg_temp.fx('tip_cik_1')
      AND raw_value = 'TEST-CIK-1'
    FROM identity.current_legal_entity_identifier
    WHERE legal_entity_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'
      AND scheme = 'CIK' AND relationship_role = 'OWN' AND raw_value = 'TEST-CIK-1')
  AND (SELECT count(*) = 2 FROM identity.legal_entity_identifier
       WHERE legal_entity_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'
         AND raw_value = 'TEST-CIK-1'));

INSERT INTO fx
SELECT 'tip_cik_1_verified', id
FROM identity.current_legal_entity_identifier
WHERE legal_entity_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'
  AND scheme = 'CIK' AND relationship_role = 'OWN' AND raw_value = 'TEST-CIK-1';

SELECT pg_temp.expect_error('withdrawal without evidence or citation fails', '23514', ARRAY[
  'SET ROLE resolution_writer',
  format($$SELECT identity.withdraw_legal_entity_identifier(
             'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'CIK', 'OWN', 'TEST-CIK-1',
             'TEST RESEARCHER', 'TEST ONLY withdraw',
             NULL, NULL, NULL, NULL, %s, false)$$, pg_temp.fx('tip_cik_1_verified'))
]);

SELECT pg_temp.expect_ok('resolution writer withdraws by copying tip evidence', ARRAY[
  'SET ROLE resolution_writer',
  format($$SELECT identity.withdraw_legal_entity_identifier(
             'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'CIK', 'OWN', 'TEST-CIK-1',
             'TEST RESEARCHER', 'TEST ONLY withdraw',
             NULL, NULL, NULL, NULL, %s, true)$$, pg_temp.fx('tip_cik_1_verified')),
  'RESET ROLE']);

SELECT pg_temp.check('withdrawal is an unverified superseding row and history remains',
  (SELECT verification_state = 'UNVERIFIED'
      AND actor_kind = 'HUMAN_REVIEW'
      AND evidence_id = pg_temp.fx('e_sub')
      AND supersedes_id = pg_temp.fx('tip_cik_1_verified')
    FROM identity.current_legal_entity_identifier
    WHERE legal_entity_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'
      AND raw_value = 'TEST-CIK-1')
  AND (SELECT count(*) = 3 FROM identity.legal_entity_identifier
       WHERE raw_value = 'TEST-CIK-1'));

INSERT INTO fx
SELECT 'tip_cik_1_withdrawn', id
FROM identity.current_legal_entity_identifier
WHERE legal_entity_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'
  AND scheme = 'CIK' AND relationship_role = 'OWN' AND raw_value = 'TEST-CIK-1';

SELECT pg_temp.expect_error('UPDATE of an identifier row is rejected', 'BDCA1', ARRAY[
  $$UPDATE identity.legal_entity_identifier SET raw_value = raw_value
     WHERE raw_value = 'TEST-CIK-1'$$]);

SELECT pg_temp.expect_ok('two different OWN raw values can both be current verified tips', ARRAY[
  'SET ROLE resolution_writer',
  format($$SELECT identity.verify_legal_entity_identifier(
       'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'CIK', 'OWN', 'TEST-CIK-1',
       'TEST RESEARCHER', NULL,
       'https://example.test/identifier-a', 'TEST CITATION A', 'TEST EXCERPT A',
       %s)$$, pg_temp.fx('tip_cik_1_withdrawn')),
  $$SELECT identity.verify_legal_entity_identifier(
       'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'LEI', 'OWN', 'TEST-LEI-OTHER',
       'TEST RESEARCHER', NULL,
       'https://example.test/identifier-lei', 'TEST CITATION LEI', 'TEST EXCERPT LEI',
       NULL)$$,
  $$SELECT identity.verify_legal_entity_identifier(
       'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'CIK', 'OWN', 'TEST-CIK-2',
       'TEST RESEARCHER', NULL,
       'https://example.test/identifier-b', 'TEST CITATION B', 'TEST EXCERPT B',
       NULL)$$,
  'RESET ROLE']);

SELECT pg_temp.check('distinct raw values stay distinct current tips',
  (SELECT count(*) = 2 FROM identity.current_legal_entity_identifier
    WHERE legal_entity_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'
      AND scheme = 'CIK'
      AND relationship_role = 'OWN'
      AND verification_state = 'VERIFIED'
      AND raw_value IN ('TEST-CIK-1', 'TEST-CIK-2')));

SELECT pg_temp.check('ambiguous verified OWN tips are reported and not collapsed',
  (SELECT verified_own_tip_count = 2
    FROM identity.ambiguous_verified_own_identifier
    WHERE legal_entity_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'
      AND scheme = 'CIK')
  AND NOT EXISTS (
    SELECT 1 FROM identity.ambiguous_verified_own_identifier
    WHERE legal_entity_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'
      AND scheme = 'LEI'));

SELECT pg_temp.check('identifier helpers do not write resolution or consolidation rows',
  (SELECT count(*) = 0 FROM resolution.entity_resolution_decision)
  AND (SELECT count(*) = 0 FROM resolution.legal_entity_consolidation_decision));

SELECT pg_temp.expect_error('reader has no base-table select on identifiers', '42501', ARRAY[
  'SET ROLE bdc_reader',
  $$SELECT count(*) FROM identity.legal_entity_identifier$$]);
