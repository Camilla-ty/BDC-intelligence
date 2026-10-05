-- Group 34: durable research workspace. Synthetic observations only.
-- A review candidate cites source rows. It does not copy them and it does not resolve them.

SELECT pg_temp.check('migrations do not seed a review candidate',
  (SELECT count(*) = 0 FROM review.candidate));

SELECT pg_temp.check('review has no decision, resolution, or score column', NOT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'review'
    AND (column_name ~* '(decision|rationale|matched|probable|rejected|same|different|deferred|score|rank|grade)'
         OR data_type IN ('real', 'double precision', 'money'))));

SELECT pg_temp.check('review status is only OPEN and CLOSED',
  (SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_enum e
    WHERE e.enumtypid = 'review.case_status'::regtype)
  = ARRAY['OPEN', 'CLOSED']::name[]);

SELECT pg_temp.expect_error('reader cannot open a review candidate', '42501', ARRAY[
  'SET ROLE bdc_reader',
  $$SELECT review.open_candidate('reader-case', 'BORROWER', 'RESEARCHER', 'TEST CASE', 'TEST RESEARCHER')$$]);

SELECT pg_temp.expect_error('reader cannot read a review base table', '42501', ARRAY[
  'SET ROLE bdc_reader',
  'SELECT count(*) FROM review.evidence_item']);

SELECT pg_temp.expect_error('pipeline writer cannot insert a review candidate', '42501', ARRAY[
  'SET ROLE bdc_pipeline_writer',
  $$INSERT INTO review.candidate (case_key, candidate_type, source, title, created_by)
    VALUES ('pipeline-case', 'BORROWER', 'RESEARCHER', 'TEST CASE', 'TEST RESEARCHER')$$]);

SELECT pg_temp.expect_error('review writer cannot insert an observation', '42501', ARRAY[
  'SET ROLE review_writer',
  $$INSERT INTO obs.position_observation (origin_soi_row_observation_id, filing_id, date_precision, duration_kind,
      holding_descriptor_raw, rule_version_id, evidence_id, run_id)
    VALUES (1, 1, 'MONTH_END_ROUNDED', 'POINT_IN_TIME', 'TEST', 1, 1, 1)$$]);

SELECT pg_temp.expect_error('review writer cannot insert an artifact', '42501', ARRAY[
  'SET ROLE review_writer',
  $$INSERT INTO raw.artifact (source_url, final_url, source_type_code, http_status, byte_size, sha256, retrieved_at, storage_key, run_id)
    VALUES ('https://www.sec.gov/files/TEST-ONLY/x', 'https://www.sec.gov/files/TEST-ONLY/x', 'SEC_BDC_DATASET_ZIP',
            200, 1, repeat('c', 64), now(), 'test-only/x', 1)$$]);

SELECT pg_temp.expect_error('review writer cannot insert evidence', '42501', ARRAY[
  'SET ROLE review_writer',
  $$INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, run_id)
    VALUES ('L1_STRUCTURED_DATASET', 1, 'TSV_ROW', 1)$$]);

SELECT pg_temp.expect_error('review writer cannot insert a legal entity', '42501', ARRAY[
  'SET ROLE review_writer',
  $$INSERT INTO identity.legal_entity (creation_reason, run_id) VALUES ('TEST', 1)$$]);

SELECT pg_temp.expect_error('review writer cannot insert a resolution decision', '42501', ARRAY[
  'SET ROLE review_writer',
  $$INSERT INTO resolution.entity_resolution_decision (
      borrower_name_observation_id, state, method, rationale, actor_kind, decided_by, decided_at,
      rule_version_id, evidence_id, run_id)
    VALUES (1, 'UNRESOLVED', 'TEST', 'TEST', 'HUMAN_REVIEW', 'TEST', now(), 1, 1, 1)$$]);

SELECT pg_temp.expect_error('review writer cannot insert a run', '42501', ARRAY[
  'SET ROLE review_writer',
  $$INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
    VALUES ('TEST', 'test', '{}', now())$$]);

SELECT pg_temp.expect_ok('review writer can open a candidate', ARRAY[
  'SET ROLE review_writer',
  $$SELECT review.open_candidate('writer-case', 'BORROWER', 'RESEARCHER', 'TEST CASE', 'TEST RESEARCHER')$$,
  'RESET ROLE']);

SELECT pg_temp.check('the writer candidate is OPEN and is not a resolution',
  (SELECT status = 'OPEN' AND candidate_type = 'BORROWER' AND source = 'RESEARCHER'
   FROM review.current_candidate WHERE case_key = 'writer-case')
  AND (SELECT count(*) = 0 FROM identity.legal_entity)
  AND (SELECT count(*) = 0 FROM resolution.entity_resolution_decision));

DO $$
BEGIN
  FOR i IN 1..32 LOOP
    PERFORM pg_temp.add_identifier_position('case_pos_' || i, 'TEST SOURCE ' || i, 100 + i);
  END LOOP;
END
$$;

SELECT pg_temp.put('case', review.open_candidate(
  'test-source-case', 'BORROWER', 'MANUAL_SEED', 'TEST SOURCE CASE', 'TEST RESEARCHER'));

DO $$
DECLARE
  i integer;
BEGIN
  FOR i IN 1..32 LOOP
    PERFORM review.add_member(pg_temp.fx('case'), pg_temp.fx('case_pos_' || i), NULL, 'TEST RESEARCHER');
  END LOOP;
END
$$;

SELECT pg_temp.check('a case can reference 32 source observations without changing them',
  (SELECT count(*) = 32 FROM review.candidate_member WHERE candidate_id = pg_temp.fx('case'))
  AND (SELECT holding_descriptor_raw = 'TEST BORROWER A | TEST LOAN 1' AND evidence_id = pg_temp.fx('e_soi_a')
       FROM obs.position_observation WHERE id = pg_temp.fx('po_a'))
  AND (SELECT sha256 = repeat('a', 64) FROM raw.artifact WHERE id = pg_temp.fx('artifact')));

SELECT pg_temp.put('evidence_count', (SELECT count(*) FROM evidence.evidence));

SELECT pg_temp.put('internal', review.add_internal_evidence(
  pg_temp.fx('case'), 'TEST FILING', pg_temp.fx('case_pos_1'), NULL, (
    SELECT evidence_id FROM obs.position_observation WHERE id = pg_temp.fx('case_pos_1')
  ), 'TEST RESEARCHER'));

SELECT pg_temp.check('internal evidence references stored provenance and copies no excerpt',
  (SELECT origin = 'INTERNAL' AND source_trust = 'STORED_SEC_SOURCE'
          AND relevant_excerpt IS NULL AND stored_line_text = 'TEST SOURCE 1'
          AND evidence_id IS NOT NULL AND locator_type = 'TSV_ROW'
   FROM review.evidence_item_read WHERE evidence_item_id = pg_temp.fx('internal'))
  AND (SELECT count(*) = pg_temp.fx('evidence_count') FROM evidence.evidence));

SELECT pg_temp.put('external', review.add_external_evidence(
  pg_temp.fx('case'), 'COMPANY_WEBSITE', 'TEST SOURCE TITLE', 'https://example.test/source',
  '2099-04-01', 'TEST EXCERPT', pg_temp.fx('case_pos_1'), 'TEST RESEARCHER'));

SELECT pg_temp.check('external evidence keeps its excerpt, url, and researcher',
  (SELECT origin = 'EXTERNAL' AND source_trust = 'RESEARCHER_ADDED_SOURCE'
          AND source_url = 'https://example.test/source' AND document_date = '2099-04-01'
          AND relevant_excerpt = 'TEST EXCERPT' AND created_by = 'TEST RESEARCHER'
          AND retrieved_at IS NOT NULL AND evidence_id IS NULL AND locator_type IS NULL
   FROM review.evidence_item_read WHERE evidence_item_id = pg_temp.fx('external')));

SELECT pg_temp.expect_error('an external source must be https', '23514', ARRAY[
  $$SELECT review.add_external_evidence(pg_temp.fx('case'), 'OTHER', 'TEST', 'http://example.test/source',
      NULL, 'TEST EXCERPT', NULL, 'TEST RESEARCHER')$$]);

SELECT pg_temp.put('note', review.add_note(
  pg_temp.fx('case'), pg_temp.fx('external'), 'TEST INTERPRETATION', 'TEST RESEARCHER'));

SELECT pg_temp.check('a researcher note does not rewrite the excerpt',
  (SELECT note_text = 'TEST INTERPRETATION' AND evidence_item_id = pg_temp.fx('external')
   FROM review.researcher_note_read WHERE note_id = pg_temp.fx('note'))
  AND (SELECT relevant_excerpt = 'TEST EXCERPT' FROM review.evidence_item WHERE id = pg_temp.fx('external')));

SELECT pg_temp.put('set', review.add_evidence_set(
  pg_temp.fx('case'), 'TEST EVIDENCE SET', NULL, 'TEST RESEARCHER'));
SELECT pg_temp.put('set_member', review.add_set_member(
  pg_temp.fx('set'), pg_temp.fx('external'), 'TEST RESEARCHER'));
SELECT pg_temp.put('set_member_internal', review.add_set_member(
  pg_temp.fx('set'), pg_temp.fx('internal'), 'TEST RESEARCHER'));

SELECT pg_temp.check('an evidence set groups items and stores no conclusion',
  (SELECT title = 'TEST EVIDENCE SET' AND description IS NULL
   FROM review.evidence_set_read WHERE evidence_set_id = pg_temp.fx('set'))
  AND (SELECT count(*) = 2 FROM review.evidence_set_member WHERE evidence_set_id = pg_temp.fx('set')));

SELECT pg_temp.expect_error('review evidence cannot be updated', 'BDCA1', ARRAY[
  $$UPDATE review.evidence_item SET title = title WHERE id = pg_temp.fx('external')$$]);
SELECT pg_temp.expect_error('a researcher note cannot be deleted', 'BDCA1', ARRAY[
  $$DELETE FROM review.researcher_note WHERE id = pg_temp.fx('note')$$]);
SELECT pg_temp.expect_error('review writer cannot update evidence', '42501', ARRAY[
  'SET ROLE review_writer',
  $$UPDATE review.evidence_item SET title = title$$]);

SELECT pg_temp.put('closed', review.set_candidate_status(
  pg_temp.fx('case'), 'CLOSED', 'TEST CLOSE', 'TEST RESEARCHER'));

SELECT pg_temp.check('closing appends a status and keeps the open row',
  (SELECT status = 'CLOSED' FROM review.current_candidate WHERE candidate_id = pg_temp.fx('case'))
  AND (SELECT count(*) = 2 FROM review.candidate_status WHERE candidate_id = pg_temp.fx('case'))
  AND (SELECT count(*) = 1 FROM review.candidate_status
       WHERE candidate_id = pg_temp.fx('case') AND status = 'OPEN'));

SELECT pg_temp.expect_error('a candidate cannot start closed', '23514', ARRAY[
  $$INSERT INTO review.candidate (case_key, candidate_type, source, title, created_by)
    VALUES ('closed-first', 'BORROWER', 'RESEARCHER', 'TEST CASE', 'TEST RESEARCHER')$$,
  $$INSERT INTO review.candidate_status (candidate_id, status, created_by)
    SELECT id, 'CLOSED', 'TEST RESEARCHER' FROM review.candidate WHERE case_key = 'closed-first'$$]);

SELECT pg_temp.expect_error('a member requires a real observation', '23503', ARRAY[
  $$SELECT review.add_member(pg_temp.fx('case'), 0, NULL, 'TEST RESEARCHER')$$]);

SELECT review.add_evidence_set(
  (SELECT candidate_id FROM review.current_candidate WHERE case_key = 'writer-case'),
  'OTHER SET', NULL, 'TEST RESEARCHER');

SELECT pg_temp.expect_error('a set cannot include evidence from another candidate', '23514', ARRAY[
  $$SELECT review.add_set_member(
      (SELECT id FROM review.evidence_set WHERE title = 'OTHER SET'),
      pg_temp.fx('external'), 'TEST RESEARCHER')$$]);

SELECT pg_temp.check('identity, resolution, rules, and runs are unchanged by the case',
  (SELECT count(*) = 0 FROM identity.legal_entity)
  AND (SELECT count(*) = 0 FROM identity.legal_entity_alias)
  AND (SELECT count(*) = 0 FROM resolution.entity_resolution_decision)
  AND (SELECT count(*) = 0 FROM resolution.instrument_resolution_decision)
  AND (SELECT count(*) = 0 FROM resolution.match_candidate)
  AND (SELECT max(id) = pg_temp.fx('r_metric_strict') FROM ops.rule_version)
  AND (SELECT count(*) = 1 FROM ops.run));
