-- 0070: NUM currency binder terminal-run fence for rule links, and corrected liveness wording
-- (ADR 0022).
-- A free liveness lock (81202610, run_id) shows only that no database session holds it. It does
-- not show that the binder process, its client connection, or a PostgreSQL backend has ended:
-- through a session pooler the client can disconnect and the lock be released while the server
-- backend stays open. 0069 said the run's database session had ended; the write refusal and the
-- stored abandon summary now say only what the lock shows. Both function bodies are otherwise
-- 0069's.
-- Rule links (ops.run_rule_version) of a NUM_CURRENCY_BIND run are refused once the run has an
-- outcome. The check runs after the batch lock 8120261018, which abandon takes first, so a link
-- either commits before an abandon or sees its outcome. After an abandon, no later bind batch
-- (0067 finished-run check on its checkpoint), rule link (this trigger), or outcome (UNIQUE
-- run_id) of the run can commit.
-- SQLSTATE BDCR1: run state transition refused. BDCI1: integrity rule violated.

CREATE OR REPLACE FUNCTION ops.assert_num_currency_bind_live(p_run_id bigint) RETURNS void
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
      MESSAGE = format('bind write refused: run %s lost its liveness lock (no database session holds it); the binder must stop', p_run_id);
  END IF;
END
$$;

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
          format('abandoned by %s: %s (liveness lock was free: no database session held it, so no later bind batch, rule link, or outcome of this run can commit)',
                 p_actor, p_reason));
  INSERT INTO ops.audit_event (event_kind, subject_table, subject_id, actor, reason, details)
  VALUES ('NUM_CURRENCY_BIND_ABANDONED', 'ops.run', p_run_id::text, p_actor, p_reason, counts);
  RETURN counts;
END
$$;

-- Fires for every rule link but acts only on NUM_CURRENCY_BIND runs; other run kinds are
-- unchanged. Volatile, so under READ COMMITTED the outcome check after the lock sees an abandon
-- that committed while this insert waited.
CREATE FUNCTION ops.check_num_currency_bind_rule_link() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM ops.run r WHERE r.id = NEW.run_id AND r.run_kind = 'NUM_CURRENCY_BIND') THEN
    PERFORM pg_advisory_xact_lock(8120261018);
    IF EXISTS (SELECT 1 FROM ops.run_outcome o WHERE o.run_id = NEW.run_id) THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = format('rule link refused: NUM_CURRENCY_BIND run %s already has an outcome', NEW.run_id);
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER check_num_currency_bind_rule_link BEFORE INSERT ON ops.run_rule_version
  FOR EACH ROW EXECUTE FUNCTION ops.check_num_currency_bind_rule_link();
