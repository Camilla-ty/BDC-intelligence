-- Group 54: legal-entity consolidation (canonical Borrower ID). Fake entities only.

SELECT pg_temp.expect_ok('two legal entities for consolidation tests', ARRAY[
  format($$INSERT INTO identity.legal_entity (id, creation_reason, run_id)
            VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'TEST ONLY consolidation A', %s)$$, pg_temp.fx('run')),
  format($$INSERT INTO identity.legal_entity (id, creation_reason, run_id)
            VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'TEST ONLY consolidation B', %s)$$, pg_temp.fx('run')),
  format($$INSERT INTO identity.legal_entity (id, creation_reason, run_id)
            VALUES ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 'TEST ONLY consolidation C', %s)$$, pg_temp.fx('run'))
]);

SELECT pg_temp.check('unconsolidated UUID resolves to itself',
  resolution.canonical_legal_entity('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')
    = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');

SELECT pg_temp.check('missing UUID fails closed to NULL',
  resolution.canonical_legal_entity('ffffffff-ffff-4fff-8fff-ffffffffffff') IS NULL);

SELECT pg_temp.expect_error('reader cannot propose a consolidation', '42501', ARRAY[
  'SET ROLE bdc_reader',
  $$SELECT resolution.propose_legal_entity_consolidation(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
      'TEST ONLY rationale',
      'TEST RESEARCHER',
      NULL,
      'https://example.test/citation',
      'TEST CITATION',
      'TEST EXCERPT',
      NULL)$$]);

SELECT pg_temp.expect_error('pipeline writer cannot propose a consolidation', '42501', ARRAY[
  'SET ROLE bdc_pipeline_writer',
  $$SELECT resolution.propose_legal_entity_consolidation(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
      'TEST ONLY rationale',
      'TEST RESEARCHER',
      NULL,
      'https://example.test/citation',
      'TEST CITATION',
      'TEST EXCERPT',
      NULL)$$]);

SELECT pg_temp.expect_ok('resolution writer proposes A→B', ARRAY[
  'SET ROLE resolution_writer',
  $$SELECT resolution.propose_legal_entity_consolidation(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
      'TEST ONLY: propose A into B',
      'TEST RESEARCHER',
      NULL,
      'https://example.test/citation-a',
      'TEST CITATION A',
      'TEST EXCERPT A',
      NULL)$$,
  'RESET ROLE']);

INSERT INTO fx SELECT 'prop_ab', id FROM resolution.current_legal_entity_consolidation
WHERE from_legal_entity_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

SELECT pg_temp.check('pending proposal does not change canonical resolution',
  resolution.canonical_legal_entity('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')
    = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  AND (SELECT state = 'PROBABLE' FROM resolution.current_legal_entity_consolidation
       WHERE id = pg_temp.fx('prop_ab')));

SELECT pg_temp.expect_error('self-consolidation is rejected', '23514', ARRAY[
  'SET ROLE resolution_writer',
  $$SELECT resolution.propose_legal_entity_consolidation(
      'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
      'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
      'TEST ONLY',
      'TEST RESEARCHER',
      NULL,
      'https://example.test/citation',
      'TEST CITATION',
      'TEST EXCERPT',
      NULL)$$]);

SELECT pg_temp.expect_error('stale proposal expected head is rejected', 'BDCS2', ARRAY[
  'SET ROLE resolution_writer',
  format($$SELECT resolution.propose_legal_entity_consolidation(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
      'TEST ONLY stale',
      'TEST RESEARCHER',
      NULL,
      'https://example.test/citation',
      'TEST CITATION',
      'TEST EXCERPT',
      %s)$$, pg_temp.fx('prop_ab') + 999)]);

SELECT pg_temp.expect_ok('approve A→B', ARRAY[
  'SET ROLE resolution_writer',
  format($$SELECT resolution.approve_legal_entity_consolidation(%s, 'TEST APPROVER',
            'TEST ONLY: approve A into B')$$, pg_temp.fx('prop_ab')),
  'RESET ROLE']);

SELECT pg_temp.check('approved A→B resolves A to B; proposal history retained',
  resolution.canonical_legal_entity('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')
    = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
  AND resolution.canonical_legal_entity('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1')
    = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
  AND (SELECT count(*) = 2 FROM resolution.legal_entity_consolidation_decision
       WHERE from_legal_entity_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')
  AND (SELECT state = 'MATCHED' FROM resolution.current_legal_entity_consolidation
       WHERE from_legal_entity_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'));

SELECT pg_temp.expect_ok('propose and approve C→B', ARRAY[
  'SET ROLE resolution_writer',
  $$SELECT resolution.propose_legal_entity_consolidation(
      'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
      'TEST ONLY: propose C into B',
      'TEST RESEARCHER',
      NULL,
      'https://example.test/citation-c',
      'TEST CITATION C',
      'TEST EXCERPT C',
      NULL)$$,
  'RESET ROLE']);

INSERT INTO fx SELECT 'prop_cb', id FROM resolution.current_legal_entity_consolidation
WHERE from_legal_entity_id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';

SELECT pg_temp.expect_ok('approve C→B', ARRAY[
  'SET ROLE resolution_writer',
  format($$SELECT resolution.approve_legal_entity_consolidation(%s, 'TEST APPROVER',
            'TEST ONLY: approve C into B')$$, pg_temp.fx('prop_cb')),
  'RESET ROLE']);

SELECT pg_temp.check('C resolves to B while A still resolves to B',
  resolution.canonical_legal_entity('cccccccc-cccc-4ccc-8ccc-ccccccccccc1')
    = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
  AND resolution.canonical_legal_entity('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')
    = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1');

-- Chain: introduce D→A would resolve to B after A→B.
SELECT pg_temp.expect_ok('fourth entity D for chain', ARRAY[
  format($$INSERT INTO identity.legal_entity (id, creation_reason, run_id)
            VALUES ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'TEST ONLY consolidation D', %s)$$, pg_temp.fx('run'))
]);

SELECT pg_temp.expect_ok('propose and approve D→A (chain to B)', ARRAY[
  'SET ROLE resolution_writer',
  $$SELECT resolution.propose_legal_entity_consolidation(
      'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      'TEST ONLY: propose D into A',
      'TEST RESEARCHER',
      NULL,
      'https://example.test/citation-d',
      'TEST CITATION D',
      'TEST EXCERPT D',
      NULL)$$,
  'RESET ROLE']);

INSERT INTO fx SELECT 'prop_da', id FROM resolution.current_legal_entity_consolidation
WHERE from_legal_entity_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';

SELECT pg_temp.expect_ok('approve D→A', ARRAY[
  'SET ROLE resolution_writer',
  format($$SELECT resolution.approve_legal_entity_consolidation(%s, 'TEST APPROVER',
            'TEST ONLY: approve D into A')$$, pg_temp.fx('prop_da')),
  'RESET ROLE']);

SELECT pg_temp.check('D→A→B chain resolves D to B',
  resolution.canonical_legal_entity('dddddddd-dddd-4ddd-8ddd-ddddddddddd1')
    = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1');

SELECT pg_temp.expect_error('cycle B→A is rejected while A→B is approved', 'BDCI2', ARRAY[
  'SET ROLE resolution_writer',
  $$SELECT resolution.propose_legal_entity_consolidation(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      'TEST ONLY cycle',
      'TEST RESEARCHER',
      NULL,
      'https://example.test/citation-cycle',
      'TEST CITATION CYCLE',
      'TEST EXCERPT CYCLE',
      NULL)$$]);

INSERT INTO fx SELECT 'match_ab', id FROM resolution.current_legal_entity_consolidation
WHERE from_legal_entity_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

SELECT pg_temp.expect_ok('reverse A→B without touching C→B', ARRAY[
  'SET ROLE resolution_writer',
  format($$SELECT resolution.reverse_legal_entity_consolidation(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      %s,
      'TEST APPROVER',
      'TEST ONLY: reverse incorrect A→B',
      NULL,
      'https://example.test/citation-rev',
      'TEST CITATION REV',
      'TEST EXCERPT REV')$$, pg_temp.fx('match_ab')),
  'RESET ROLE']);

SELECT pg_temp.check('after reverse, A stands alone; C and D still canonicalize correctly',
  resolution.canonical_legal_entity('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')
    = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  AND resolution.canonical_legal_entity('cccccccc-cccc-4ccc-8ccc-ccccccccccc1')
    = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
  AND resolution.canonical_legal_entity('dddddddd-dddd-4ddd-8ddd-ddddddddddd1')
    = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  AND (SELECT count(*) >= 3 FROM resolution.legal_entity_consolidation_decision
       WHERE from_legal_entity_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')
  AND EXISTS (SELECT 1 FROM identity.legal_entity WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')
  AND EXISTS (SELECT 1 FROM identity.legal_entity WHERE id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'));

SELECT pg_temp.expect_error('approving a non-current proposal is rejected', 'BDCS2', ARRAY[
  'SET ROLE resolution_writer',
  format($$SELECT resolution.approve_legal_entity_consolidation(%s, 'TEST APPROVER',
            'TEST ONLY stale approve')$$, pg_temp.fx('prop_ab'))]);

SELECT pg_temp.expect_error('consolidation rows are append-only', 'BDCA1', ARRAY[
  $$UPDATE resolution.legal_entity_consolidation_decision SET rationale = rationale
       WHERE from_legal_entity_id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'$$]);

SELECT pg_temp.check('entities with canonical B include B and C only after A reverse',
  (SELECT count(*) FROM resolution.legal_entities_with_canonical('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1')) = 2
  AND (SELECT bool_and(legal_entity_id IN (
         'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
         'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'))
       FROM resolution.legal_entities_with_canonical('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1')));

SELECT pg_temp.check('preview distinguishes researcher citation from structured evidence',
  (SELECT (registry.legal_entity_consolidation_preview('cccccccc-cccc-4ccc-8ccc-ccccccccccc1')
            -> 'current_consolidation' ->> 'state') = 'MATCHED')
  AND (SELECT evidence_id IS NULL
         AND researcher_citation_url IS NOT NULL
       FROM resolution.current_legal_entity_consolidation
       WHERE from_legal_entity_id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'));
