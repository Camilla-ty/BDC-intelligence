-- 0066: NUM quoted-TSV recovery sidecar, integrity, and projection gates (ADR 0019).
-- Recovered cells are not stored in raw.tabular_row.cells. SOI cell_by_label is unchanged.
-- D6 (footlen) is evaluated at projection time; there is no projection_eligible flag.

ALTER TABLE raw.tabular_row DROP CONSTRAINT tabular_row_parse_status_check;
ALTER TABLE raw.tabular_row ADD CONSTRAINT tabular_row_parse_status_check
  CHECK (parse_status IN ('OK', 'FIELD_COUNT_MISMATCH', 'QUOTED_RECOVERY'));

CREATE OR REPLACE FUNCTION raw.check_tabular_row() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  tl raw.table_load;
BEGIN
  SELECT * INTO tl FROM raw.table_load WHERE id = NEW.table_load_id;
  IF encode(sha256(convert_to(NEW.raw_line, 'UTF8')), 'hex') <> NEW.raw_line_sha256 THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1', MESSAGE = 'raw_line_sha256 does not match raw_line';
  END IF;
  IF tl.delimiter = E'\t' AND NEW.cells IS DISTINCT FROM string_to_array(NEW.raw_line, E'\t') THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1', MESSAGE = 'cells must be the exact tab split of raw_line';
  END IF;
  IF (NEW.parse_status = 'OK') <> (NEW.field_count = cardinality(tl.header)) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'parse_status must be OK exactly when field_count equals the header width';
  END IF;
  IF NEW.parse_status = 'QUOTED_RECOVERY' AND tl.table_code IS DISTINCT FROM 'NUM' THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'QUOTED_RECOVERY is allowed only on NUM table loads';
  END IF;
  RETURN NEW;
END
$$;

CREATE TABLE raw.num_quoted_recovery (
  id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tabular_row_id           bigint NOT NULL UNIQUE REFERENCES raw.tabular_row (id),
  recovered_cells          text[] NOT NULL,
  recovered_field_count    integer NOT NULL CHECK (recovered_field_count >= 0),
  parser_rule_version_id   bigint NOT NULL REFERENCES ops.rule_version (id),
  run_id                   bigint NOT NULL REFERENCES ops.run (id),
  recorded_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (cardinality(recovered_cells) = recovered_field_count)
);
COMMENT ON TABLE raw.num_quoted_recovery IS
  'Append-only recovered 11-cell parse of a NUM QUOTED_RECOVERY row. Naive cells stay on raw.tabular_row. One sidecar per source row.';
COMMENT ON COLUMN raw.num_quoted_recovery.recovered_cells IS
  'Quoted-TSV fields in documented NUM header order. Identifier whitespace is not trimmed.';

CREATE FUNCTION raw.num_quoted_footlen_ok(p_cells text[], p_header text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT
    COALESCE(p_cells[array_position(p_header, 'footlen')], '') ~ '^[0-9]+$'
    AND octet_length(COALESCE(p_cells[array_position(p_header, 'footnote')], ''))
        = (COALESCE(p_cells[array_position(p_header, 'footlen')], ''))::bigint
$$;
COMMENT ON FUNCTION raw.num_quoted_footlen_ok(text[], text[]) IS
  'D6: footlen equals the UTF-8 byte length of the unquoted footnote, including empty footnote with footlen 0.';

CREATE FUNCTION raw.check_num_quoted_recovery() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r raw.tabular_row;
  tl raw.table_load;
BEGIN
  SELECT * INTO r FROM raw.tabular_row WHERE id = NEW.tabular_row_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'num_quoted_recovery tabular_row_id must exist';
  END IF;
  SELECT * INTO tl FROM raw.table_load WHERE id = r.table_load_id;
  IF tl.table_code IS DISTINCT FROM 'NUM' OR r.parse_status IS DISTINCT FROM 'QUOTED_RECOVERY' THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'num_quoted_recovery requires a NUM QUOTED_RECOVERY raw row';
  END IF;
  IF r.field_count = cardinality(tl.header) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'num_quoted_recovery requires naive field_count different from the header width';
  END IF;
  IF NEW.recovered_field_count IS DISTINCT FROM cardinality(tl.header) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'recovered_field_count must equal the NUM header width';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER check_num_quoted_recovery BEFORE INSERT ON raw.num_quoted_recovery
  FOR EACH ROW EXECUTE FUNCTION raw.check_num_quoted_recovery();

CREATE FUNCTION raw.require_num_quoted_recovery() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parse_status IS DISTINCT FROM 'QUOTED_RECOVERY' THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM raw.num_quoted_recovery q WHERE q.tabular_row_id = NEW.id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCL1',
      MESSAGE = format('QUOTED_RECOVERY row %s has no raw.num_quoted_recovery sidecar', NEW.id);
  END IF;
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER require_num_quoted_recovery
  AFTER INSERT ON raw.tabular_row
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION raw.require_num_quoted_recovery();

ALTER TABLE ops.projection_exception DROP CONSTRAINT projection_exception_kind_check;
ALTER TABLE ops.projection_exception ADD CONSTRAINT projection_exception_kind_check
  CHECK (kind IN ('FIELD_COUNT_MISMATCH', 'ORPHAN_ADSH', 'FOOTLEN_MISMATCH'));
COMMENT ON TABLE ops.projection_exception IS
  'Raw lines kept losslessly but not projected: field-count mismatches, orphan adsh, and NUM quoted-recovery footlen mismatches.';

CREATE OR REPLACE FUNCTION ops.check_projection_exception() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM raw.tabular_row r
    WHERE r.id = NEW.tabular_row_id AND r.table_load_id = NEW.table_load_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'projection_exception tabular_row_id must belong to table_load_id';
  END IF;
  IF NEW.kind = 'FIELD_COUNT_MISMATCH' AND NOT EXISTS (
    SELECT 1 FROM raw.tabular_row r
    WHERE r.id = NEW.tabular_row_id AND r.parse_status = 'FIELD_COUNT_MISMATCH'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'FIELD_COUNT_MISMATCH exceptions require a FIELD_COUNT_MISMATCH raw row';
  END IF;
  IF NEW.kind = 'FOOTLEN_MISMATCH' AND NOT EXISTS (
    SELECT 1 FROM raw.tabular_row r
    WHERE r.id = NEW.tabular_row_id AND r.parse_status = 'QUOTED_RECOVERY'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'FOOTLEN_MISMATCH exceptions require a QUOTED_RECOVERY raw row';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM evidence.evidence e
    WHERE e.id = NEW.evidence_id AND e.tabular_row_id = NEW.tabular_row_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'projection_exception evidence must point at the same raw row';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION obs.num_cell_by_label(p_row_id bigint, p_label text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT CASE r.parse_status
    WHEN 'OK' THEN r.cells[array_position(tl.header, p_label)]
    WHEN 'QUOTED_RECOVERY' THEN q.recovered_cells[array_position(tl.header, p_label)]
    ELSE NULL
  END
  FROM raw.tabular_row r
  JOIN raw.table_load tl ON tl.id = r.table_load_id
  LEFT JOIN raw.num_quoted_recovery q ON q.tabular_row_id = r.id
  WHERE r.id = p_row_id AND tl.table_code = 'NUM'
$$;
COMMENT ON FUNCTION obs.num_cell_by_label(bigint, text) IS
  'NUM projection cells: naive cells for OK rows, sidecar recovered_cells for QUOTED_RECOVERY. Does not change obs.cell_by_label.';

CREATE OR REPLACE FUNCTION obs.check_row_projection(p_table text, p_row_id bigint, p_filing_id bigint, p_evidence_id bigint)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  adsh text;
BEGIN
  IF p_table = 'NUM' THEN
    IF NOT EXISTS (
      SELECT 1 FROM raw.tabular_row r JOIN raw.table_load tl ON tl.id = r.table_load_id
      WHERE r.id = p_row_id AND tl.table_code = 'NUM'
        AND r.parse_status IN ('OK', 'QUOTED_RECOVERY')
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'source row must be an OK or QUOTED_RECOVERY row of a NUM table load';
    END IF;
    adsh := obs.num_cell_by_label(p_row_id, 'adsh');
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM raw.tabular_row r JOIN raw.table_load tl ON tl.id = r.table_load_id
      WHERE r.id = p_row_id AND tl.table_code = p_table AND r.parse_status = 'OK'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = format('source row must be an OK row of a %s table load', p_table);
    END IF;
    adsh := obs.cell_by_label(p_row_id, 'adsh');
  END IF;
  IF adsh IS DISTINCT FROM
     (SELECT f.accession_number FROM registry.filing f WHERE f.id = p_filing_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'filing_id must be the filing whose accession equals the row adsh cell';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM evidence.evidence e WHERE e.id = p_evidence_id AND e.tabular_row_id = p_row_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1', MESSAGE = 'evidence must point at the same source row';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION obs.check_num_fact_observation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  header text[];
  recovered text[];
  status ref.parse_status;
BEGIN
  PERFORM obs.check_row_projection('NUM', NEW.tabular_row_id, NEW.filing_id, NEW.evidence_id);
  SELECT r.parse_status, tl.header, q.recovered_cells
    INTO status, header, recovered
  FROM raw.tabular_row r
  JOIN raw.table_load tl ON tl.id = r.table_load_id
  LEFT JOIN raw.num_quoted_recovery q ON q.tabular_row_id = r.id
  WHERE r.id = NEW.tabular_row_id;
  IF status = 'QUOTED_RECOVERY' AND NOT raw.num_quoted_footlen_ok(recovered, header) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'QUOTED_RECOVERY rows must pass footlen validation before projection';
  END IF;
  IF NEW.value_raw IS DISTINCT FROM obs.num_cell_by_label(NEW.tabular_row_id, 'value')
     OR NEW.uom_raw IS DISTINCT FROM obs.num_cell_by_label(NEW.tabular_row_id, 'uom') THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1', MESSAGE = 'raw value and uom must equal the source row cells';
  END IF;
  RETURN NEW;
END
$$;

-- Do not call ops.grant_layer_privileges(): that helper re-grants INSERT on every
-- history table and would undo helper-only revokes from 0060 and 0063.
GRANT SELECT, INSERT ON raw.num_quoted_recovery TO bdc_pipeline_writer;
GRANT USAGE ON SEQUENCE raw.num_quoted_recovery_id_seq TO bdc_pipeline_writer;

SELECT ops.apply_append_only_to_all();
