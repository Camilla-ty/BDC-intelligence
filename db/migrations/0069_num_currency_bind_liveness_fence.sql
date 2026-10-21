-- 0069: fence NUM currency binder writes on the run's liveness lock (ADR 0022).
-- A batch, its checkpoint, and the binder's SUCCEEDED outcome require the run's session
-- advisory lock (81202610, run_id) to be held by a live session. Abandon requires it to be
-- free. Both take the batch lock 8120261018 first, so they are serialized: a run can never
-- be abandoned while one of its writes is committing, or written after its session ended.
-- SQLSTATE BDCR1: run state transition refused.

CREATE FUNCTION ops.assert_num_currency_bind_live(p_run_id bigint) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT r.parameters->>'liveness_lock_class' FROM ops.run r
      WHERE r.id = p_run_id AND r.run_kind = 'NUM_CURRENCY_BIND') IS DISTINCT FROM '81202610' THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCR1',
      MESSAGE = format('bind write refused: run %s has no liveness lock protocol', p_run_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_locks l
    WHERE l.locktype = 'advisory' AND l.granted AND l.classid = 81202610
      AND l.objid::bigint = p_run_id AND l.objsubid = 2
      AND l.database = (SELECT d.oid FROM pg_database d WHERE d.datname = current_database())
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCR1',
      MESSAGE = format('bind write refused: run %s lost its liveness lock (its database session ended); the binder must stop', p_run_id);
  END IF;
END
$$;

CREATE FUNCTION ops.check_num_currency_bind_batch_live() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ops.assert_num_currency_bind_live(NEW.run_id);
  RETURN NEW;
END
$$;

-- Fires after check_num_currency_bind_batch (triggers fire in name order), so the 0067
-- run-kind, finished-run, rule, and range checks keep their SQLSTATE.
CREATE TRIGGER check_num_currency_bind_batch_live BEFORE INSERT ON ops.num_currency_bind_batch
  FOR EACH ROW EXECUTE FUNCTION ops.check_num_currency_bind_batch_live();

-- Same checks as 0068. The summary states only what the free lock proves: the run's
-- database session ended. A binder process that lost its session may still be running,
-- but none of its writes can commit after this outcome.
CREATE OR REPLACE FUNCTION ops.abandon_num_currency_bind_run(p_run_id bigint, p_actor text, p_reason text) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  r ops.run;
  prior_status ops.run_status;
  counts jsonb;
BEGIN
  IF p_actor IS NULL OR btrim(p_actor) = '' OR p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCR1', MESSAGE = 'abandon refused: an actor and a reason are required';
  END IF;
  PERFORM pg_advisory_xact_lock(8120261018);
  SELECT * INTO r FROM ops.run WHERE id = p_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCR1', MESSAGE = format('abandon refused: run %s does not exist', p_run_id);
  END IF;
  IF r.run_kind <> 'NUM_CURRENCY_BIND' THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCR1',
      MESSAGE = format('abandon refused: run %s is %s, not NUM_CURRENCY_BIND', p_run_id, r.run_kind);
  END IF;
  SELECT s.status INTO prior_status FROM ops.current_run_status s WHERE s.run_id = p_run_id;
  IF prior_status <> 'STARTED' THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCR1',
      MESSAGE = format('abandon refused: run %s is already %s', p_run_id, prior_status);
  END IF;
  IF (r.parameters->>'liveness_lock_class') IS DISTINCT FROM '81202610' THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCR1',
      MESSAGE = format('abandon refused: run %s holds no liveness lock, so it cannot be shown to have stopped', p_run_id);
  END IF;
  IF NOT pg_try_advisory_xact_lock(81202610, p_run_id::integer) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCR1',
      MESSAGE = format('abandon refused: run %s is still active (its liveness lock is held)', p_run_id);
  END IF;
  SELECT jsonb_build_object(
      'abandoned', true,
      'batches_committed', count(*),
      'last_committed_batch_index', coalesce(max(b.batch_index), 0),
      'last_committed_field_value_id', max(b.last_field_value_id),
      'heads_committed', coalesce(sum(b.heads_in_batch), 0),
      'successors_committed', coalesce(sum(b.successors_written), 0),
      'not_equal_committed', coalesce(sum(b.not_equal_written), 0),
      'multiple_committed', coalesce(sum(b.multiple_written), 0),
      'exclusions_committed', coalesce(sum(b.exclusions_written), 0))
    INTO counts
  FROM ops.num_currency_bind_batch b WHERE b.run_id = p_run_id;
  INSERT INTO ops.run_outcome (run_id, status, finished_at, counts, error_summary)
  VALUES (p_run_id, 'ABORTED', now(), counts,
          format('abandoned by %s: %s (liveness lock was free: the run''s database session had ended, so no later write of this run can commit)',
                 p_actor, p_reason));
  INSERT INTO ops.audit_event (event_kind, subject_table, subject_id, actor, reason, details)
  VALUES ('NUM_CURRENCY_BIND_ABANDONED', 'ops.run', p_run_id::text, p_actor, p_reason, counts);
  RETURN counts;
END
$$;

REVOKE ALL ON FUNCTION ops.assert_num_currency_bind_live(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.assert_num_currency_bind_live(bigint) TO bdc_pipeline_writer;
