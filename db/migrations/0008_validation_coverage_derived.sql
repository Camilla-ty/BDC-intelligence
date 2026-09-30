-- 0008 validation, coverage, and derived values.
-- G-05: coverage is asserted explicitly; absence of an assertion is UNKNOWN coverage, never zero.
-- G-07: derived values record the metric rule version and their exact inputs.
-- The derivation gate rejects inputs whose current column mapping is not documented
-- (OPEN_QUESTION, OBSERVED_UNCONFIRMED, REJECTED), so the undocumented SOI cost and fair-value
-- columns (Q14) cannot feed any derived value until an approved mapping version exists.

CREATE TABLE validation.validation_result (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject_table    text NOT NULL CHECK (subject_table ~ '^(registry|obs|resolution|derived)\.[a-z_]+$'),
  subject_id       bigint NOT NULL,
  rule_version_id  bigint NOT NULL REFERENCES ops.rule_version (id),
  outcome          ref.validation_outcome NOT NULL,
  detail           text,
  evidence_id      bigint REFERENCES evidence.evidence (id),
  run_id           bigint NOT NULL REFERENCES ops.run (id),
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (outcome NOT IN ('PASS', 'FAIL') OR evidence_id IS NOT NULL)
);

CREATE FUNCTION validation.check_validation_subject() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ops.assert_subject_exists(NEW.subject_table, NEW.subject_id);
  RETURN NEW;
END
$$;

CREATE TRIGGER check_validation_subject BEFORE INSERT ON validation.validation_result
  FOR EACH ROW EXECUTE FUNCTION validation.check_validation_subject();

CREATE TABLE validation.evidence_status_assertion (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  field_value_id        bigint NOT NULL REFERENCES obs.position_field_value (id),
  evidence_status       ref.evidence_status NOT NULL,
  validation_result_id  bigint REFERENCES validation.validation_result (id),
  rule_version_id       bigint NOT NULL REFERENCES ops.rule_version (id),
  run_id                bigint NOT NULL REFERENCES ops.run (id),
  supersedes_id         bigint REFERENCES validation.evidence_status_assertion (id),
  supersede_reason      text,
  recorded_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (evidence_status NOT IN ('FILING_VERIFIED', 'FILING_MISMATCH', 'UNVERIFIABLE')
         OR validation_result_id IS NOT NULL)
);
COMMENT ON TABLE validation.evidence_status_assertion IS 'Evidence status of a field value over time. A field value with no assertion is NOT_CHECKED.';
SELECT ops.add_supersession('validation.evidence_status_assertion', 'field_value_id', 'single_chain');

CREATE FUNCTION validation.check_evidence_status_assertion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.validation_result_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM validation.validation_result v
    WHERE v.id = NEW.validation_result_id
      AND v.subject_table = 'obs.position_field_value' AND v.subject_id = NEW.field_value_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'validation_result_id must be a result for the same field value';
  END IF;
  IF NEW.evidence_status = 'FILING_VERIFIED' AND NOT EXISTS (
    SELECT 1 FROM validation.validation_result v JOIN evidence.evidence e ON e.id = v.evidence_id
    WHERE v.id = NEW.validation_result_id AND v.outcome = 'PASS' AND e.evidence_level = 'L2_ORIGINAL_FILING'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'FILING_VERIFIED requires a PASS validation result with Level 2 (original filing) evidence';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER check_evidence_status_assertion BEFORE INSERT ON validation.evidence_status_assertion
  FOR EACH ROW EXECUTE FUNCTION validation.check_evidence_status_assertion();

-- ---------------------------------------------------------------------------
-- Coverage (G-05)
-- ---------------------------------------------------------------------------

CREATE TABLE ops.coverage_assertion (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  registrant_id         bigint REFERENCES registry.registrant (id),
  dataset_release_id    bigint REFERENCES registry.dataset_release (id),
  reporting_period_end  date,
  source_type_code      text NOT NULL REFERENCES ref.source_type (code),
  coverage_state        ref.coverage_state NOT NULL,
  evidence_id           bigint REFERENCES evidence.evidence (id),
  rationale             text NOT NULL CHECK (btrim(rationale) <> ''),
  rule_version_id       bigint NOT NULL REFERENCES ops.rule_version (id),
  run_id                bigint NOT NULL REFERENCES ops.run (id),
  supersedes_id         bigint REFERENCES ops.coverage_assertion (id),
  supersede_reason      text,
  recorded_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(dataset_release_id, reporting_period_end) >= 1),
  CHECK (coverage_state NOT IN ('COVERED', 'EMPTY_PERIOD') OR evidence_id IS NOT NULL)
);
COMMENT ON TABLE ops.coverage_assertion IS 'Explicit coverage per registrant (or release-wide when registrant_id is NULL), release or period, and source. Only COVERED means the source was ingested for that scope.';
SELECT ops.add_supersession('ops.coverage_assertion',
  'registrant_id,dataset_release_id,reporting_period_end,source_type_code', 'single_chain');

-- ---------------------------------------------------------------------------
-- Derived values (G-07)
-- ---------------------------------------------------------------------------

CREATE TABLE derived.derived_value (
  id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  metric_rule_version_id bigint NOT NULL REFERENCES ops.rule_version (id),
  subject_table          text NOT NULL CHECK (subject_table ~ '^(registry|obs|derived)\.[a-z_]+$'),
  subject_id             bigint NOT NULL,
  result_numeric         numeric,
  result_state           ref.value_state NOT NULL CHECK (result_state IN ('DERIVED', 'UNKNOWN', 'NOT_APPLICABLE')),
  unknown_reason         text,
  run_id                 bigint NOT NULL REFERENCES ops.run (id),
  recorded_at            timestamptz NOT NULL DEFAULT now(),
  CHECK ((result_state = 'DERIVED') = (result_numeric IS NOT NULL)),
  CHECK (result_state <> 'UNKNOWN' OR coalesce(btrim(unknown_reason), '') <> '')
);
COMMENT ON TABLE derived.derived_value IS 'A value computed by a versioned deterministic rule. Unknown inputs yield UNKNOWN, never zero.';

CREATE FUNCTION derived.check_derived_value() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ops.rule_version r WHERE r.id = NEW.metric_rule_version_id AND r.rule_kind = 'DERIVATION') THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCD1', MESSAGE = 'metric_rule_version_id must be a DERIVATION rule version';
  END IF;
  PERFORM ops.assert_subject_exists(NEW.subject_table, NEW.subject_id);
  RETURN NEW;
END
$$;

CREATE TRIGGER check_derived_value BEFORE INSERT ON derived.derived_value
  FOR EACH ROW EXECUTE FUNCTION derived.check_derived_value();

CREATE TABLE derived.derived_value_input (
  id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  derived_value_id        bigint NOT NULL REFERENCES derived.derived_value (id),
  field_value_id          bigint REFERENCES obs.position_field_value (id),
  input_derived_value_id  bigint REFERENCES derived.derived_value (id),
  input_role              text NOT NULL CHECK (input_role ~ '^[a-z][a-z0-9_]*$'),
  run_id                  bigint NOT NULL REFERENCES ops.run (id),
  recorded_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(field_value_id, input_derived_value_id) = 1),
  CHECK (input_derived_value_id IS DISTINCT FROM derived_value_id)
);

CREATE FUNCTION derived.enforce_input_gate() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  dv derived.derived_value;
  policy ops.unknown_input_policy;
  fv obs.position_field_value;
  input_state ref.value_state;
  mapping_state ref.mapping_status;
BEGIN
  SELECT * INTO dv FROM derived.derived_value WHERE id = NEW.derived_value_id;
  SELECT unknown_input_policy INTO policy FROM ops.rule_version WHERE id = dv.metric_rule_version_id;

  IF NEW.field_value_id IS NOT NULL THEN
    SELECT * INTO fv FROM obs.position_field_value WHERE id = NEW.field_value_id;
    IF EXISTS (SELECT 1 FROM obs.position_field_value s WHERE s.supersedes_id = fv.id) THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCD1',
        MESSAGE = format('field value %s is superseded; use the current version', fv.id);
    END IF;
    IF fv.column_mapping_id IS NOT NULL THEN
      mapping_state := ref.current_mapping_status(fv.column_mapping_id);
      IF mapping_state NOT IN ('DOCUMENTED', 'DOCUMENTED_AND_OBSERVED') THEN
        RAISE EXCEPTION USING ERRCODE = 'BDCD1',
          MESSAGE = format('field value %s comes from a column whose current mapping status is %s; it cannot feed derived values',
                           fv.id, mapping_state);
      END IF;
    END IF;
    input_state := fv.value_state;
  ELSE
    SELECT result_state INTO input_state FROM derived.derived_value WHERE id = NEW.input_derived_value_id;
  END IF;

  IF input_state IN ('UNKNOWN', 'NOT_APPLICABLE') THEN
    IF policy = 'REJECT_UNKNOWN_INPUTS' THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCD1',
        MESSAGE = 'this metric rejects UNKNOWN or NOT_APPLICABLE inputs';
    ELSIF dv.result_state = 'DERIVED' THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCD1',
        MESSAGE = 'an UNKNOWN or NOT_APPLICABLE input cannot produce a DERIVED result';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER enforce_input_gate BEFORE INSERT ON derived.derived_value_input
  FOR EACH ROW EXECUTE FUNCTION derived.enforce_input_gate();

CREATE FUNCTION derived.require_input() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM derived.derived_value_input i WHERE i.derived_value_id = NEW.id) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCL1', MESSAGE = format('derived value %s has no inputs', NEW.id);
  END IF;
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER require_input
  AFTER INSERT ON derived.derived_value DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION derived.require_input();

SELECT ops.apply_append_only_to_all();
