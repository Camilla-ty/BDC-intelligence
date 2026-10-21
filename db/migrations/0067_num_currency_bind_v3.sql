-- 0067: NUM currency binding v3 exclusions and per-batch run checkpoints (ADR 0022).
-- Exclusions record why a monetary head was kept out of currency binding. They never set a
-- currency; the head stays UNKNOWN. Checkpoints are written in the same transaction as the
-- batch they describe, so committed progress is visible after a failed run.

CREATE TABLE obs.field_value_currency_exclusion (
  id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  field_value_id           bigint NOT NULL REFERENCES obs.position_field_value (id),
  reason                   text NOT NULL CHECK (reason IN (
                             'SOI_NONCONSOLIDATED_SUBSIDIARY_AXIS', 'SOI_RANGE_AXIS', 'NUM_PROHIBITED_DIMENSION')),
  soi_column_label         text,
  soi_cell_raw             text,
  num_fact_observation_id  bigint REFERENCES obs.num_fact_observation (id),
  num_axis                 text CHECK (num_axis IN ('InvestmentCompanyNonconsolidatedSubsidiaryAxis', 'RangeAxis')),
  rule_version_id          bigint NOT NULL REFERENCES ops.rule_version (id),
  run_id                   bigint NOT NULL REFERENCES ops.run (id),
  recorded_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (CASE reason
    WHEN 'SOI_NONCONSOLIDATED_SUBSIDIARY_AXIS' THEN
      soi_column_label = 'Investment Company, Nonconsolidated Subsidiary Axis'
      AND soi_cell_raw IS NOT NULL AND soi_cell_raw <> ''
      AND num_fact_observation_id IS NULL AND num_axis IS NULL
    WHEN 'SOI_RANGE_AXIS' THEN
      soi_column_label = 'Range Axis'
      AND soi_cell_raw IS NOT NULL AND soi_cell_raw <> ''
      AND num_fact_observation_id IS NULL AND num_axis IS NULL
    ELSE
      soi_column_label IS NULL AND soi_cell_raw IS NULL
      AND num_fact_observation_id IS NOT NULL AND num_axis IS NOT NULL
  END)
);
CREATE UNIQUE INDEX field_value_currency_exclusion_once ON obs.field_value_currency_exclusion
  (field_value_id, rule_version_id, reason, coalesce(num_fact_observation_id, 0), coalesce(num_axis, ''));
COMMENT ON TABLE obs.field_value_currency_exclusion IS
  'Append-only reasons a monetary field value was excluded from NUM currency binding: a non-empty SOI subsidiary or range cell, or a candidate NUM fact carrying a prohibited axis. The value keeps currency_state UNKNOWN.';
COMMENT ON COLUMN obs.field_value_currency_exclusion.soi_cell_raw IS
  'SOI cell exactly as disclosed on the position''s origin row.';

CREATE FUNCTION obs.check_field_value_currency_exclusion() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  fv obs.position_field_value;
  p obs.position_observation;
  soi_row bigint;
BEGIN
  SELECT * INTO fv FROM obs.position_field_value WHERE id = NEW.field_value_id;
  IF fv.field_code NOT IN ('PRINCIPAL_AMOUNT', 'COST', 'FAIR_VALUE') THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1', MESSAGE = 'currency exclusion requires a monetary field value';
  END IF;
  SELECT * INTO p FROM obs.position_observation WHERE id = fv.position_observation_id;
  IF NEW.reason IN ('SOI_NONCONSOLIDATED_SUBSIDIARY_AXIS', 'SOI_RANGE_AXIS') THEN
    SELECT s.tabular_row_id INTO soi_row FROM obs.soi_row_observation s WHERE s.id = p.origin_soi_row_observation_id;
    IF NEW.soi_cell_raw IS DISTINCT FROM obs.cell_by_label(soi_row, NEW.soi_column_label) THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'soi_cell_raw must equal the origin SOI row cell for soi_column_label';
    END IF;
  ELSIF NEW.reason = 'NUM_PROHIBITED_DIMENSION' AND NOT EXISTS (
    SELECT 1 FROM obs.num_fact_observation n
    WHERE n.id = NEW.num_fact_observation_id AND n.filing_id = p.filing_id
      AND n.segments_raw ~ ('(^|;)' || NEW.num_axis || '[(=]')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'excluded NUM fact must be from the same filing and carry num_axis in segments_raw';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER check_field_value_currency_exclusion BEFORE INSERT ON obs.field_value_currency_exclusion
  FOR EACH ROW EXECUTE FUNCTION obs.check_field_value_currency_exclusion();

CREATE TABLE ops.num_currency_bind_batch (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id                bigint NOT NULL REFERENCES ops.run (id),
  rule_version_id       bigint NOT NULL REFERENCES ops.rule_version (id),
  batch_index           integer NOT NULL CHECK (batch_index >= 1),
  first_field_value_id  bigint NOT NULL REFERENCES obs.position_field_value (id),
  last_field_value_id   bigint NOT NULL REFERENCES obs.position_field_value (id),
  heads_in_batch        integer NOT NULL CHECK (heads_in_batch >= 1),
  successors_written    integer NOT NULL CHECK (successors_written >= 0),
  equal_written         integer NOT NULL CHECK (equal_written >= 0),
  not_equal_written     integer NOT NULL CHECK (not_equal_written >= 0),
  multiple_written      integer NOT NULL CHECK (multiple_written >= 0),
  exclusions_written    integer NOT NULL CHECK (exclusions_written >= 0),
  recorded_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, batch_index),
  CHECK (first_field_value_id <= last_field_value_id),
  CHECK (equal_written = successors_written)
);
COMMENT ON TABLE ops.num_currency_bind_batch IS
  'Append-only checkpoint of one committed NUM_CURRENCY_BIND batch: the head-id range it covered and the rows it wrote. Written in the batch transaction.';

CREATE FUNCTION ops.check_num_currency_bind_batch() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  prev ops.num_currency_bind_batch;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ops.run r WHERE r.id = NEW.run_id AND r.run_kind = 'NUM_CURRENCY_BIND') THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1', MESSAGE = 'bind checkpoint requires a NUM_CURRENCY_BIND run';
  END IF;
  IF EXISTS (SELECT 1 FROM ops.run_outcome o WHERE o.run_id = NEW.run_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1', MESSAGE = 'bind checkpoint cannot be added to a finished run';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM ops.run_rule_version rr WHERE rr.run_id = NEW.run_id AND rr.rule_version_id = NEW.rule_version_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1', MESSAGE = 'bind checkpoint rule version must be linked to its run';
  END IF;
  SELECT * INTO prev FROM ops.num_currency_bind_batch b
  WHERE b.run_id = NEW.run_id ORDER BY b.batch_index DESC LIMIT 1;
  IF NEW.batch_index <> coalesce(prev.batch_index, 0) + 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1', MESSAGE = 'bind checkpoint batch_index must follow the previous batch';
  END IF;
  IF prev.id IS NOT NULL AND NEW.first_field_value_id <= prev.last_field_value_id THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1', MESSAGE = 'bind checkpoint head ranges must not overlap';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER check_num_currency_bind_batch BEFORE INSERT ON ops.num_currency_bind_batch
  FOR EACH ROW EXECUTE FUNCTION ops.check_num_currency_bind_batch();

-- Do not call ops.grant_layer_privileges(): that helper re-grants INSERT on every
-- history table and would undo helper-only revokes from 0060 and 0063.
GRANT SELECT, INSERT ON obs.field_value_currency_exclusion TO bdc_pipeline_writer;
GRANT USAGE ON SEQUENCE obs.field_value_currency_exclusion_id_seq TO bdc_pipeline_writer;
GRANT SELECT, INSERT ON ops.num_currency_bind_batch TO bdc_pipeline_writer;
GRANT USAGE ON SEQUENCE ops.num_currency_bind_batch_id_seq TO bdc_pipeline_writer;

SELECT ops.apply_append_only_to_all();
