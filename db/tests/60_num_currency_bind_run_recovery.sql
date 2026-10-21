-- Group 60: NUM currency binder run start, resume claims, and abandon (migration 0068, ADR 0022).
-- One session holds every lock here, and advisory locks are re-entrant within a session, so
-- the "still active" refusal is covered by the two-process integration test instead.

CREATE FUNCTION pg_temp.expect_refusal(label text, pattern text, stmt text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  got text;
  msg text;
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS got = RETURNED_SQLSTATE, msg = MESSAGE_TEXT;
    IF got = 'BDCR1' AND msg ~ pattern THEN
      RAISE NOTICE 'PASS: % [%]', label, got;
      RETURN;
    END IF;
    RAISE EXCEPTION 'FAIL: % (expected BDCR1 matching %, got %: %)', label, pattern, got, msg;
  END;
  RAISE EXCEPTION 'FAIL: % (expected BDCR1, statement succeeded)', label;
END
$$;

SELECT pg_temp.put('r_bind', pg_temp.add_rule('obs.currency.from_num_unique_match', 'NORMALIZATION'));
SELECT pg_temp.put('r_bind_other', pg_temp.add_rule('obs.currency.from_num_unique_match_other', 'NORMALIZATION'));

-- Start

SELECT pg_temp.put('bind_a', ops.start_num_currency_bind_run(
  'test', '{"uniqueness": "unique-fact", "batch_size": 1}'::jsonb, NULL, 'test-1', repeat('c', 64)));
INSERT INTO ops.run_rule_version (run_id, rule_version_id) VALUES (pg_temp.fx('bind_a'), pg_temp.fx('r_bind'));

SELECT pg_temp.check('a started binder run records its parameters and the liveness protocol', (
  SELECT r.run_kind = 'NUM_CURRENCY_BIND'
     AND r.parameters = '{"uniqueness": "unique-fact", "batch_size": 1, "liveness_lock_class": 81202610}'::jsonb
     AND s.status = 'STARTED'
  FROM ops.run r JOIN ops.current_run_status s ON s.run_id = r.id WHERE r.id = pg_temp.fx('bind_a')));

SELECT pg_temp.check('the starting session holds the run''s session-level liveness lock', EXISTS (
  SELECT 1 FROM pg_locks l
  WHERE l.locktype = 'advisory' AND l.classid = 81202610 AND l.objid = pg_temp.fx('bind_a')
    AND l.objsubid = 2 AND l.pid = pg_backend_pid() AND l.granted));

SELECT pg_temp.expect_refusal('a STARTED run cannot be resumed', 'is STARTED; it may still be running',
  format($$SELECT ops.start_num_currency_bind_run('test', '{}'::jsonb, %s, 'test-1', repeat('c', 64))$$, pg_temp.fx('bind_a')));

SELECT pg_temp.expect_refusal('a missing run cannot be resumed', 'does not exist',
  $$SELECT ops.start_num_currency_bind_run('test', '{}'::jsonb, 2147483000, 'test-1', repeat('c', 64))$$);

SELECT pg_temp.expect_refusal('a run of another kind cannot be resumed', 'not NUM_CURRENCY_BIND',
  format($$SELECT ops.start_num_currency_bind_run('test', '{}'::jsonb, %s, 'test-1', repeat('c', 64))$$, pg_temp.fx('run')));

SELECT pg_temp.check('refused starts insert no run', (
  SELECT count(*) = 1 FROM ops.run WHERE run_kind = 'NUM_CURRENCY_BIND'));

-- Abandon

SELECT pg_temp.expect_refusal('abandon needs a reason', 'actor and a reason are required',
  format($$SELECT ops.abandon_num_currency_bind_run(%s, 'db tests', '  ')$$, pg_temp.fx('bind_a')));

SELECT pg_temp.expect_refusal('abandon needs an actor', 'actor and a reason are required',
  format($$SELECT ops.abandon_num_currency_bind_run(%s, NULL, 'TEST ONLY reason')$$, pg_temp.fx('bind_a')));

SELECT pg_temp.expect_refusal('a run of another kind cannot be abandoned', 'not NUM_CURRENCY_BIND',
  format($$SELECT ops.abandon_num_currency_bind_run(%s, 'db tests', 'TEST ONLY reason')$$, pg_temp.fx('run')));

WITH i AS (INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
  VALUES ('NUM_CURRENCY_BIND', 'test', '{"uniqueness": "unique-fact"}'::jsonb, now()) RETURNING id)
INSERT INTO fx SELECT 'bind_legacy', id FROM i;

SELECT pg_temp.expect_refusal('a run without the liveness protocol cannot be abandoned', 'holds no liveness lock',
  format($$SELECT ops.abandon_num_currency_bind_run(%s, 'db tests', 'TEST ONLY reason')$$, pg_temp.fx('bind_legacy')));

INSERT INTO ops.num_currency_bind_batch (run_id, rule_version_id, batch_index, first_field_value_id, last_field_value_id,
    heads_in_batch, successors_written, equal_written, not_equal_written, multiple_written, exclusions_written)
VALUES (pg_temp.fx('bind_a'), pg_temp.fx('r_bind'), 1, pg_temp.fx('fv_principal'), pg_temp.fx('fv_principal'), 1, 0, 0, 1, 0, 2);

SELECT pg_temp.expect_ok('a stopped binder run can be abandoned', ARRAY[format(
  $$SELECT ops.abandon_num_currency_bind_run(%s, 'db tests', 'TEST ONLY process killed')$$, pg_temp.fx('bind_a'))]);

SELECT pg_temp.check('abandon writes ABORTED with checkpoint counts and the actor and reason', (
  SELECT o.status = 'ABORTED'
     AND o.counts @> '{"abandoned": true, "batches_committed": 1, "last_committed_batch_index": 1,
                       "heads_committed": 1, "not_equal_committed": 1, "exclusions_committed": 2}'::jsonb
     AND (o.counts->>'last_committed_field_value_id')::bigint = pg_temp.fx('fv_principal')
     AND o.error_summary LIKE 'abandoned by db tests: TEST ONLY process killed%'
  FROM ops.run_outcome o WHERE o.run_id = pg_temp.fx('bind_a')));

SELECT pg_temp.check('abandon records one audit event', (
  SELECT count(*) = 1 AND bool_and(actor = 'db tests' AND reason = 'TEST ONLY process killed'
                                   AND details->>'batches_committed' = '1')
  FROM ops.audit_event
  WHERE event_kind = 'NUM_CURRENCY_BIND_ABANDONED' AND subject_table = 'ops.run'
    AND subject_id = pg_temp.fx('bind_a')::text));

SELECT pg_temp.check('abandon preserves committed checkpoints', (
  SELECT count(*) = 1 FROM ops.num_currency_bind_batch WHERE run_id = pg_temp.fx('bind_a')));

SELECT pg_temp.expect_refusal('an abandoned run cannot be abandoned again', 'is already ABORTED',
  format($$SELECT ops.abandon_num_currency_bind_run(%s, 'db tests', 'TEST ONLY reason')$$, pg_temp.fx('bind_a')));

SELECT pg_temp.expect_error('an abandoned run takes no more checkpoints', 'BDCI1', ARRAY[format(
  $$INSERT INTO ops.num_currency_bind_batch (run_id, rule_version_id, batch_index, first_field_value_id, last_field_value_id,
      heads_in_batch, successors_written, equal_written, not_equal_written, multiple_written, exclusions_written)
    VALUES (%s, %s, 2, %s, %s, 1, 0, 0, 0, 0, 0)$$,
  pg_temp.fx('bind_a'), pg_temp.fx('r_bind'), pg_temp.fx('fv_adj_cost'), pg_temp.fx('fv_adj_cost'))]);

-- Resume claims

SELECT pg_temp.expect_refusal('a resume under another rule version is refused', 'did not use',
  format($$SELECT ops.start_num_currency_bind_run('test', '{}'::jsonb, %s, 'test-2', repeat('c', 64))$$, pg_temp.fx('bind_a')));

SELECT pg_temp.expect_refusal('a resume under another rule definition is refused', 'did not use',
  format($$SELECT ops.start_num_currency_bind_run('test', '{}'::jsonb, %s, 'test-1', repeat('d', 64))$$, pg_temp.fx('bind_a')));

SELECT pg_temp.put('bind_b', ops.start_num_currency_bind_run(
  'test', '{"uniqueness": "unique-fact"}'::jsonb, pg_temp.fx('bind_a'), 'test-1', repeat('c', 64)));

SELECT pg_temp.check('a resume records its claim and the resumed run id', (
  SELECT r.parameters->>'resumes_run_id' = pg_temp.fx('bind_a')::text
     AND (SELECT count(*) = 1 FROM ops.num_currency_bind_resume c
          WHERE c.prior_run_id = pg_temp.fx('bind_a') AND c.run_id = pg_temp.fx('bind_b'))
  FROM ops.run r WHERE r.id = pg_temp.fx('bind_b')));

SELECT pg_temp.expect_refusal('a run can be resumed only once', 'already resumed by run',
  format($$SELECT ops.start_num_currency_bind_run('test', '{}'::jsonb, %s, 'test-1', repeat('c', 64))$$, pg_temp.fx('bind_a')));

INSERT INTO ops.run_outcome (run_id, status, finished_at, counts)
VALUES (pg_temp.fx('bind_b'), 'SUCCEEDED', now(), '{}'::jsonb);

SELECT pg_temp.expect_refusal('a SUCCEEDED run cannot be resumed', 'only FAILED or ABORTED',
  format($$SELECT ops.start_num_currency_bind_run('test', '{}'::jsonb, %s, 'test-1', repeat('c', 64))$$, pg_temp.fx('bind_b')));

SELECT pg_temp.expect_error('a second claim on one prior run is rejected', '23505', ARRAY[format(
  $$INSERT INTO ops.num_currency_bind_resume (prior_run_id, run_id) VALUES (%s, %s)$$,
  pg_temp.fx('bind_a'), pg_temp.fx('bind_legacy'))]);

SELECT pg_temp.expect_error('a claim on a STARTED prior run is rejected', 'BDCI1', ARRAY[format(
  $$INSERT INTO ops.num_currency_bind_resume (prior_run_id, run_id) VALUES (%s, %s)$$,
  pg_temp.fx('bind_legacy'), pg_temp.fx('bind_b'))]);

SELECT pg_temp.expect_error('a claim linking a run of another kind is rejected', 'BDCI1', ARRAY[format(
  $$INSERT INTO ops.num_currency_bind_resume (prior_run_id, run_id) VALUES (%s, %s)$$,
  pg_temp.fx('bind_a'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('a resume claim is append-only', 'BDCA1', ARRAY[
  $$UPDATE ops.num_currency_bind_resume SET run_id = run_id$$]);

SELECT pg_temp.check('the writer can start and abandon runs but cannot change claims', (
  has_function_privilege('bdc_pipeline_writer', 'ops.start_num_currency_bind_run(text, jsonb, bigint, text, text)', 'EXECUTE')
  AND has_function_privilege('bdc_pipeline_writer', 'ops.abandon_num_currency_bind_run(bigint, text, text)', 'EXECUTE')
  AND has_table_privilege('bdc_pipeline_writer', 'ops.num_currency_bind_resume', 'INSERT')
  AND NOT has_table_privilege('bdc_pipeline_writer', 'ops.num_currency_bind_resume', 'UPDATE')));

SELECT pg_temp.check('PUBLIC cannot start or abandon binder runs', NOT EXISTS (
  SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  WHERE p.oid IN ('ops.start_num_currency_bind_run(text, jsonb, bigint, text, text)'::regprocedure,
                  'ops.abandon_num_currency_bind_run(bigint, text, text)'::regprocedure)
    AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'));

SELECT pg_advisory_unlock_all();
