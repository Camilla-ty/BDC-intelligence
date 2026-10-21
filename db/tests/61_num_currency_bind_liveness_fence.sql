-- Group 61: NUM currency binder writes are fenced on the run's liveness lock (migration 0069, ADR 0022).
-- One session plays the binder: it holds the lock, then releases it to stand in for a lost
-- liveness connection. The two-process cases are in the batched integration suite.

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

CREATE FUNCTION pg_temp.checkpoint_sql(run_id bigint, batch_index integer, head bigint) RETURNS text
LANGUAGE sql AS $$
  SELECT format($q$INSERT INTO ops.num_currency_bind_batch (run_id, rule_version_id, batch_index, first_field_value_id,
      last_field_value_id, heads_in_batch, successors_written, equal_written, not_equal_written, multiple_written, exclusions_written)
    VALUES (%s, %s, %s, %s, %s, 1, 0, 0, 0, 0, 0)$q$, run_id, pg_temp.fx('r_validate'), batch_index, head, head)
$$;

SELECT pg_temp.put('bind_live', ops.start_num_currency_bind_run(
  'test', '{"uniqueness": "unique-fact"}'::jsonb, NULL, 'test-1', repeat('c', 64)));
INSERT INTO ops.run_rule_version (run_id, rule_version_id) VALUES (pg_temp.fx('bind_live'), pg_temp.fx('r_validate'));

CREATE TEMP VIEW live_ids AS
SELECT least(pg_temp.fx('fv_principal'), pg_temp.fx('fv_adj_cost')) AS lo,
       greatest(pg_temp.fx('fv_principal'), pg_temp.fx('fv_adj_cost')) AS hi;

SELECT pg_temp.expect_ok('the liveness check passes while the run''s lock is held', ARRAY[
  format('SELECT ops.assert_num_currency_bind_live(%s)', pg_temp.fx('bind_live'))]);

SELECT pg_temp.expect_ok('a checkpoint is accepted while the run''s lock is held', ARRAY[
  pg_temp.checkpoint_sql(pg_temp.fx('bind_live'), 1, (SELECT lo FROM live_ids))]);

SELECT pg_temp.check('the liveness lock is released, standing in for a lost liveness connection',
  pg_advisory_unlock(81202610, pg_temp.fx('bind_live')::integer));

SELECT pg_temp.expect_refusal('the liveness check refuses a run whose lock is gone', 'lost its liveness lock',
  format('SELECT ops.assert_num_currency_bind_live(%s)', pg_temp.fx('bind_live')));

SELECT pg_temp.expect_refusal('a checkpoint is refused once the run''s lock is gone', 'lost its liveness lock',
  pg_temp.checkpoint_sql(pg_temp.fx('bind_live'), 2, (SELECT hi FROM live_ids)));

SELECT pg_temp.check('the refused checkpoint wrote nothing', (
  SELECT count(*) = 1 FROM ops.num_currency_bind_batch WHERE run_id = pg_temp.fx('bind_live')));

WITH i AS (INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
  VALUES ('NUM_CURRENCY_BIND', 'test', '{"uniqueness": "unique-fact"}'::jsonb, now()) RETURNING id)
INSERT INTO fx SELECT 'bind_legacy', id FROM i;
INSERT INTO ops.run_rule_version (run_id, rule_version_id) VALUES (pg_temp.fx('bind_legacy'), pg_temp.fx('r_validate'));

SELECT pg_temp.expect_refusal('a run without the liveness protocol takes no checkpoint', 'no liveness lock protocol',
  pg_temp.checkpoint_sql(pg_temp.fx('bind_legacy'), 1, (SELECT lo FROM live_ids)));

SELECT pg_temp.expect_refusal('the liveness check refuses a run of another kind', 'no liveness lock protocol',
  format('SELECT ops.assert_num_currency_bind_live(%s)', pg_temp.fx('run')));

SELECT pg_temp.expect_ok('a run whose lock is gone can be abandoned', ARRAY[format(
  $$SELECT ops.abandon_num_currency_bind_run(%s, 'db tests', 'TEST ONLY liveness connection lost')$$, pg_temp.fx('bind_live'))]);

SELECT pg_temp.check('the abandon summary claims only that the run''s session ended', (
  SELECT o.status = 'ABORTED'
     AND o.error_summary = 'abandoned by db tests: TEST ONLY liveness connection lost (liveness lock was free: '
       || 'the run''s database session had ended, so no later write of this run can commit)'
     AND o.counts @> '{"batches_committed": 1}'::jsonb
  FROM ops.run_outcome o WHERE o.run_id = pg_temp.fx('bind_live')));

SELECT pg_temp.expect_error('an abandoned run takes no checkpoint, with the 0067 finished-run error first', 'BDCI1',
  ARRAY[pg_temp.checkpoint_sql(pg_temp.fx('bind_live'), 2, (SELECT hi FROM live_ids))]);

SELECT pg_temp.check('the writer can run the liveness check and PUBLIC cannot', (
  has_function_privilege('bdc_pipeline_writer', 'ops.assert_num_currency_bind_live(bigint)', 'EXECUTE')
  AND NOT EXISTS (
    SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    WHERE p.oid IN ('ops.assert_num_currency_bind_live(bigint)'::regprocedure,
                    'ops.abandon_num_currency_bind_run(bigint, text, text)'::regprocedure)
      AND a.grantee = 0 AND a.privilege_type = 'EXECUTE')));

SELECT pg_temp.check('the checkpoint liveness trigger fires after the 0067 checks', (
  SELECT array_agg(t.tgname::text ORDER BY t.tgname) = ARRAY['check_num_currency_bind_batch', 'check_num_currency_bind_batch_live']
  FROM pg_trigger t WHERE t.tgrelid = 'ops.num_currency_bind_batch'::regclass AND t.tgname LIKE 'check_%'));

SELECT pg_advisory_unlock_all();
