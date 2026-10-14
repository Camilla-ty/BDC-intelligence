-- Group 55: consolidation integrity — pending proposals preserve approved mappings;
-- pipeline cannot INSERT consolidations directly; reject restores approved heads.

SELECT pg_temp.expect_ok('integrity fixture entities', ARRAY[
  format($$INSERT INTO identity.legal_entity (id, creation_reason, run_id)
            VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'TEST ONLY integrity A', %s)$$, pg_temp.fx('run')),
  format($$INSERT INTO identity.legal_entity (id, creation_reason, run_id)
            VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'TEST ONLY integrity B', %s)$$, pg_temp.fx('run')),
  format($$INSERT INTO identity.legal_entity (id, creation_reason, run_id)
            VALUES ('cccccccc-cccc-4ccc-8ccc-ccccccccccc2', 'TEST ONLY integrity C', %s)$$, pg_temp.fx('run')),
  format($$INSERT INTO identity.legal_entity (id, creation_reason, run_id)
            VALUES ('dddddddd-dddd-4ddd-8ddd-ddddddddddd2', 'TEST ONLY integrity D', %s)$$, pg_temp.fx('run'))
]);

SELECT pg_temp.expect_error('pipeline writer cannot insert consolidation decisions directly', '42501', ARRAY[
  'SET ROLE bdc_pipeline_writer',
  format($$INSERT INTO resolution.legal_entity_consolidation_decision (
      from_legal_entity_id, to_legal_entity_id, state, method, rationale, actor_kind,
      decided_by, decided_at, rule_version_id, run_id,
      researcher_citation_url, researcher_citation_title, researcher_citation_excerpt)
    VALUES (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
      'PROBABLE', 'CONSOLIDATION_PROPOSED', 'TEST BYPASS', 'HUMAN_REVIEW',
      'pipeline', now(), %s, %s,
      'https://example.test/x', 'T', 'E')$$,
    (SELECT id FROM ops.rule_version WHERE rule_code = 'resolution.legal_entity_consolidation' ORDER BY id DESC LIMIT 1),
    pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('pipeline writer cannot call propose helper', '42501', ARRAY[
  'SET ROLE bdc_pipeline_writer',
  $$SELECT resolution.propose_legal_entity_consolidation(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
      'TEST', 'pipeline', NULL,
      'https://example.test/x', 'T', 'E', NULL)$$]);

SELECT pg_temp.expect_error('reader cannot approve', '42501', ARRAY[
  'SET ROLE bdc_reader',
  $$SELECT resolution.approve_legal_entity_consolidation(1, 'reader', 'TEST')$$]);

SELECT pg_temp.expect_error('reader cannot reverse', '42501', ARRAY[
  'SET ROLE bdc_reader',
  $$SELECT resolution.reverse_legal_entity_consolidation(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 1, 'reader', 'TEST',
      NULL, 'https://example.test/x', 'T', 'E')$$]);

SELECT pg_temp.expect_ok('propose and approve A→B', ARRAY[
  'SET ROLE resolution_writer',
  $$SELECT resolution.propose_legal_entity_consolidation(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
      'TEST ONLY approve A→B', 'TEST RESEARCHER', NULL,
      'https://example.test/a', 'TA', 'EA', NULL)$$,
  'RESET ROLE']);

INSERT INTO fx SELECT 'prop_ab2', id FROM resolution.current_legal_entity_consolidation
WHERE from_legal_entity_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';

SELECT pg_temp.expect_ok('approve A→B', ARRAY[
  'SET ROLE resolution_writer',
  format($$SELECT resolution.approve_legal_entity_consolidation(%s, 'TEST APPROVER', 'TEST ONLY approve')$$,
         pg_temp.fx('prop_ab2')),
  'RESET ROLE']);

INSERT INTO fx SELECT 'match_ab2', id FROM resolution.current_legal_entity_consolidation
WHERE from_legal_entity_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';

SELECT pg_temp.check('approved A→B is effective',
  resolution.canonical_legal_entity('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2')
    = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2');

SELECT pg_temp.expect_error('propose with empty expected head while MATCHED exists is stale', 'BDCS2', ARRAY[
  'SET ROLE resolution_writer',
  $$SELECT resolution.propose_legal_entity_consolidation(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
      'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
      'TEST ONLY missing expected head', 'TEST RESEARCHER', NULL,
      'https://example.test/stale', 'TS', 'ES', NULL)$$]);

SELECT pg_temp.expect_error('bdc_reader cannot execute consolidation preview', '42501', ARRAY[
  'SET ROLE bdc_reader',
  $$SELECT registry.legal_entity_consolidation_preview(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2')$$]);

SELECT pg_temp.expect_error('bdc_reader cannot execute pending consolidation list', '42501', ARRAY[
  'SET ROLE bdc_reader',
  $$SELECT registry.list_pending_legal_entity_consolidations()$$]);

SELECT pg_temp.expect_ok('admin_reader can preview and list pending consolidations', ARRAY[
  'SET ROLE admin_reader',
  $$SELECT registry.legal_entity_consolidation_preview(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2')$$,
  $$SELECT registry.list_pending_legal_entity_consolidations()$$,
  'RESET ROLE']);

SELECT pg_temp.expect_ok('pending replacement proposal A→C while A→B approved', ARRAY[
  'SET ROLE resolution_writer',
  format($$SELECT resolution.propose_legal_entity_consolidation(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
      'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
      'TEST ONLY propose A→C over A→B', 'TEST RESEARCHER', NULL,
      'https://example.test/ac', 'TAC', 'EAC', %s)$$, pg_temp.fx('match_ab2')),
  'RESET ROLE']);

SELECT pg_temp.check('approved A→B remains effective while A→C proposal is pending',
  resolution.canonical_legal_entity('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2')
    = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
  AND resolution.approved_consolidation_target('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2')
    = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
  AND (SELECT state = 'PROBABLE' FROM resolution.current_legal_entity_consolidation
       WHERE from_legal_entity_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'));

INSERT INTO fx SELECT 'prop_ac2', id FROM resolution.current_legal_entity_consolidation
WHERE from_legal_entity_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';

SELECT pg_temp.expect_ok('reject pending A→C restores approved A→B', ARRAY[
  'SET ROLE resolution_writer',
  format($$SELECT resolution.reject_legal_entity_consolidation_proposal(%s, 'TEST APPROVER',
            'TEST ONLY reject A→C')$$, pg_temp.fx('prop_ac2')),
  'RESET ROLE']);

SELECT pg_temp.check('after reject, A still canonicalizes to B and head is MATCHED',
  resolution.canonical_legal_entity('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2')
    = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
  AND (SELECT state = 'MATCHED' AND to_legal_entity_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
       FROM resolution.current_legal_entity_consolidation
       WHERE from_legal_entity_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'));

INSERT INTO fx SELECT 'match_ab2b', id FROM resolution.current_legal_entity_consolidation
WHERE from_legal_entity_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';

SELECT pg_temp.expect_ok('propose A→C again then approve', ARRAY[
  'SET ROLE resolution_writer',
  format($$SELECT resolution.propose_legal_entity_consolidation(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
      'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
      'TEST ONLY propose A→C again', 'TEST RESEARCHER', NULL,
      'https://example.test/ac2', 'TAC2', 'EAC2', %s)$$, pg_temp.fx('match_ab2b')),
  'RESET ROLE']);

INSERT INTO fx SELECT 'prop_ac2b', id FROM resolution.current_legal_entity_consolidation
WHERE from_legal_entity_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';

SELECT pg_temp.check('pending again keeps A→B effective',
  resolution.canonical_legal_entity('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2')
    = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2');

SELECT pg_temp.expect_ok('approve A→C replaces effective mapping', ARRAY[
  'SET ROLE resolution_writer',
  format($$SELECT resolution.approve_legal_entity_consolidation(%s, 'TEST APPROVER',
            'TEST ONLY approve A→C')$$, pg_temp.fx('prop_ac2b')),
  'RESET ROLE']);

SELECT pg_temp.check('after approval, A canonicalizes to C',
  resolution.canonical_legal_entity('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2')
    = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2');

SELECT pg_temp.expect_ok('approve C←D chain and C←B independent mapping', ARRAY[
  'SET ROLE resolution_writer',
  $$SELECT resolution.propose_legal_entity_consolidation(
      'dddddddd-dddd-4ddd-8ddd-ddddddddddd2',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
      'TEST ONLY D→A', 'TEST RESEARCHER', NULL,
      'https://example.test/d', 'TD', 'ED', NULL)$$,
  'RESET ROLE']);

INSERT INTO fx SELECT 'prop_da2', id FROM resolution.current_legal_entity_consolidation
WHERE from_legal_entity_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2';

SELECT pg_temp.expect_ok('approve D→A', ARRAY[
  'SET ROLE resolution_writer',
  format($$SELECT resolution.approve_legal_entity_consolidation(%s, 'TEST APPROVER', 'TEST ONLY D→A')$$,
         pg_temp.fx('prop_da2')),
  'RESET ROLE']);

SELECT pg_temp.expect_ok('propose and approve B→C for independent incoming', ARRAY[
  'SET ROLE resolution_writer',
  $$SELECT resolution.propose_legal_entity_consolidation(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
      'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
      'TEST ONLY B→C', 'TEST RESEARCHER', NULL,
      'https://example.test/bc', 'TBC', 'EBC', NULL)$$,
  'RESET ROLE']);

INSERT INTO fx SELECT 'prop_bc2', id FROM resolution.current_legal_entity_consolidation
WHERE from_legal_entity_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';

SELECT pg_temp.expect_ok('approve B→C', ARRAY[
  'SET ROLE resolution_writer',
  format($$SELECT resolution.approve_legal_entity_consolidation(%s, 'TEST APPROVER', 'TEST ONLY B→C')$$,
         pg_temp.fx('prop_bc2')),
  'RESET ROLE']);

SELECT pg_temp.check('D→A→C chain resolves to C; B→C intact',
  resolution.canonical_legal_entity('dddddddd-dddd-4ddd-8ddd-ddddddddddd2')
    = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2'
  AND resolution.canonical_legal_entity('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2')
    = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2');

INSERT INTO fx SELECT 'match_ac2', id FROM resolution.current_legal_entity_consolidation
WHERE from_legal_entity_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';

SELECT pg_temp.expect_ok('reverse A→C leaves B→C and D→A history interpretable', ARRAY[
  'SET ROLE resolution_writer',
  format($$SELECT resolution.reverse_legal_entity_consolidation(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', %s, 'TEST APPROVER',
      'TEST ONLY reverse A→C', NULL,
      'https://example.test/rev', 'TR', 'ER')$$, pg_temp.fx('match_ac2')),
  'RESET ROLE']);

SELECT pg_temp.check('after reverse A, A stands alone; B still → C; D→A then A',
  resolution.canonical_legal_entity('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2')
    = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
  AND resolution.canonical_legal_entity('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2')
    = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2'
  AND resolution.canonical_legal_entity('dddddddd-dddd-4ddd-8ddd-ddddddddddd2')
    = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
  AND (SELECT count(*) >= 2 FROM resolution.legal_entity_consolidation_decision
       WHERE from_legal_entity_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'));

SELECT pg_temp.check('pipeline writer still has no INSERT on consolidation table',
  NOT has_table_privilege('bdc_pipeline_writer', 'resolution.legal_entity_consolidation_decision', 'INSERT')
  AND has_table_privilege('resolution_writer', 'resolution.legal_entity_consolidation_decision', 'INSERT'));

SELECT pg_temp.check('pipeline writer has no consolidation sequence USAGE',
  NOT has_sequence_privilege('bdc_pipeline_writer',
    'resolution.legal_entity_consolidation_decision_id_seq', 'USAGE')
  AND has_sequence_privilege('resolution_writer',
    'resolution.legal_entity_consolidation_decision_id_seq', 'USAGE'));
