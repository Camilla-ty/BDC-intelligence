-- 0068: NUM currency binder run liveness, explicit abandon, and atomic resume claims (ADR 0022).
-- A binder run holds the session advisory lock (81202610, run_id) for its whole life; the lock
-- is released when the session ends, including process death. Abandon requires that lock to be
-- free. Resume claims a prior run once, through a UNIQUE row, under a per-run advisory lock.
-- SQLSTATE BDCR1: run state transition refused.

CREATE TABLE ops.num_currency_bind_resume (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  prior_run_id  bigint NOT NULL UNIQUE REFERENCES ops.run (id),
  run_id        bigint NOT NULL UNIQUE REFERENCES ops.run (id),
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (prior_run_id <> run_id)
);
COMMENT ON TABLE ops.num_currency_bind_resume IS
  'Append-only resume claims: a FAILED or ABORTED NUM_CURRENCY_BIND run is resumed by at most one later run.';

CREATE FUNCTION ops.check_num_currency_bind_resume() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT count(*) FROM ops.run r WHERE r.id IN (NEW.prior_run_id, NEW.run_id) AND r.run_kind = 'NUM_CURRENCY_BIND') <> 2 THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1', MESSAGE = 'resume claims link two NUM_CURRENCY_BIND runs';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM ops.run_outcome o WHERE o.run_id = NEW.prior_run_id AND o.status IN ('FAILED', 'ABORTED')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1', MESSAGE = 'only a FAILED or ABORTED run can be resumed';
  END IF;
  IF EXISTS (SELECT 1 FROM ops.run_outcome o WHERE o.run_id = NEW.run_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1', MESSAGE = 'the resuming run must not have finished';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER check_num_currency_bind_resume BEFORE INSERT ON ops.num_currency_bind_resume
  FOR EACH ROW EXECUTE FUNCTION ops.check_num_currency_bind_resume();

-- Inserts a NUM_CURRENCY_BIND run, claims the resumed run if any, and takes the run's
-- session liveness lock, all in the caller's statement. The caller keeps that session open
-- for the life of the run. Rule identity is the catalog version and definition SHA-256 the
-- caller will register; a resume must match the prior run's.
CREATE FUNCTION ops.start_num_currency_bind_run(
  p_code_version text, p_parameters jsonb, p_resumes_run_id bigint, p_rule_version text, p_rule_sha256 text
) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  prior_kind text;
  prior_status ops.run_status;
  claimed_by bigint;
  prior_rule text;
  new_id bigint;
BEGIN
  IF p_resumes_run_id IS NOT NULL THEN
    IF p_resumes_run_id < 1 OR p_resumes_run_id > 2147483647 THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCR1', MESSAGE = format('resume refused: run %s does not exist', p_resumes_run_id);
    END IF;
    PERFORM pg_advisory_xact_lock(81202611, p_resumes_run_id::integer);
    SELECT r.run_kind, s.status INTO prior_kind, prior_status
    FROM ops.run r JOIN ops.current_run_status s ON s.run_id = r.id WHERE r.id = p_resumes_run_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCR1', MESSAGE = format('resume refused: run %s does not exist', p_resumes_run_id);
    END IF;
    IF prior_kind <> 'NUM_CURRENCY_BIND' THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCR1',
        MESSAGE = format('resume refused: run %s is %s, not NUM_CURRENCY_BIND', p_resumes_run_id, prior_kind);
    END IF;
    IF prior_status = 'STARTED' THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCR1',
        MESSAGE = format('resume refused: run %s is STARTED; it may still be running. Confirm it has stopped with --abandon first', p_resumes_run_id);
    END IF;
    IF prior_status NOT IN ('FAILED', 'ABORTED') THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCR1',
        MESSAGE = format('resume refused: run %s is %s; only FAILED or ABORTED runs can be resumed', p_resumes_run_id, prior_status);
    END IF;
    SELECT c.run_id INTO claimed_by FROM ops.num_currency_bind_resume c WHERE c.prior_run_id = p_resumes_run_id;
    IF FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCR1',
        MESSAGE = format('resume refused: run %s was already resumed by run %s', p_resumes_run_id, claimed_by);
    END IF;
    SELECT rv.version || '|' || rv.definition_sha256 INTO prior_rule
    FROM ops.run_rule_version rr JOIN ops.rule_version rv ON rv.id = rr.rule_version_id
    WHERE rr.run_id = p_resumes_run_id AND rv.rule_code = 'obs.currency.from_num_unique_match';
    IF prior_rule IS DISTINCT FROM p_rule_version || '|' || p_rule_sha256 THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCR1',
        MESSAGE = format('resume refused: run %s did not use obs.currency.from_num_unique_match v%s with the current definition',
                         p_resumes_run_id, p_rule_version);
    END IF;
  END IF;

  INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
  VALUES ('NUM_CURRENCY_BIND', p_code_version,
          p_parameters || jsonb_build_object('liveness_lock_class', 81202610)
            || CASE WHEN p_resumes_run_id IS NULL THEN '{}'::jsonb
                    ELSE jsonb_build_object('resumes_run_id', p_resumes_run_id) END,
          now())
  RETURNING id INTO new_id;
  IF new_id > 2147483647 THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCR1', MESSAGE = 'run id exceeds the liveness lock key range';
  END IF;
  IF p_resumes_run_id IS NOT NULL THEN
    INSERT INTO ops.num_currency_bind_resume (prior_run_id, run_id) VALUES (p_resumes_run_id, new_id);
  END IF;
  PERFORM pg_advisory_lock(81202610, new_id::integer);
  RETURN new_id;
END
$$;

-- Marks a STARTED binder run ABORTED once its liveness lock is free. Waits for any batch in
-- flight (the batch lock), so no batch of the run can commit after the outcome is written.
-- Counts come from committed checkpoints only. Records an audit event.
CREATE FUNCTION ops.abandon_num_currency_bind_run(p_run_id bigint, p_actor text, p_reason text) RETURNS jsonb
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
          format('abandoned by %s: %s (liveness lock was free; process not running)', p_actor, p_reason));
  INSERT INTO ops.audit_event (event_kind, subject_table, subject_id, actor, reason, details)
  VALUES ('NUM_CURRENCY_BIND_ABANDONED', 'ops.run', p_run_id::text, p_actor, p_reason, counts);
  RETURN counts;
END
$$;

REVOKE ALL ON FUNCTION ops.start_num_currency_bind_run(text, jsonb, bigint, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.abandon_num_currency_bind_run(bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.start_num_currency_bind_run(text, jsonb, bigint, text, text) TO bdc_pipeline_writer;
GRANT EXECUTE ON FUNCTION ops.abandon_num_currency_bind_run(bigint, text, text) TO bdc_pipeline_writer;

-- Do not call ops.grant_layer_privileges(): that helper re-grants INSERT on every
-- history table and would undo helper-only revokes from 0060 and 0063.
GRANT SELECT, INSERT ON ops.num_currency_bind_resume TO bdc_pipeline_writer;
GRANT USAGE ON SEQUENCE ops.num_currency_bind_resume_id_seq TO bdc_pipeline_writer;

SELECT ops.apply_append_only_to_all();
