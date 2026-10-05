-- 0034 column-heading evidence.
-- An HTML_COLUMN_HEADING records the heading cell: its row, slot, raw text, and
-- the match text. It does not record a field code. A value cell may cite it.
-- Existing disclosure blocks and table cells are not updated.

ALTER TABLE evidence.evidence
  ADD COLUMN heading_evidence_id bigint;

ALTER TABLE evidence.evidence
  ADD CONSTRAINT evidence_heading_evidence_fkey
    FOREIGN KEY (heading_evidence_id) REFERENCES evidence.evidence (id),
  ADD CONSTRAINT evidence_heading_link_locator CHECK (
    heading_evidence_id IS NULL OR locator_type = 'HTML_TABLE_CELL');

COMMENT ON COLUMN evidence.evidence.heading_evidence_id IS
  'HTML_COLUMN_HEADING aligned with this value cell. Null when the cell has no stored heading. The column does not store a field code.';

ALTER TABLE evidence.evidence DROP CONSTRAINT evidence_level_locator;
ALTER TABLE evidence.evidence ADD CONSTRAINT evidence_level_locator CHECK (
  CASE evidence_level
    WHEN 'L1_STRUCTURED_DATASET' THEN locator_type IN ('TSV_ROW', 'TSV_CELL')
      OR (locator_type = 'DOCUMENT' AND artifact_member_id IS NOT NULL)
    WHEN 'L2_ORIGINAL_FILING' THEN locator_type IN (
      'IXBRL_FACT', 'HTML_ANCHOR', 'DOCUMENT', 'DISCLOSURE_BLOCK', 'HTML_TABLE_CELL', 'HTML_COLUMN_HEADING')
    WHEN 'REGISTRY' THEN locator_type IN ('TSV_ROW', 'TSV_CELL', 'JSON_PATH', 'HTML_ANCHOR', 'DOCUMENT')
    WHEN 'DISCOVERY' THEN locator_type IN ('JSON_PATH', 'HTML_ANCHOR', 'DOCUMENT')
  END);

ALTER TABLE evidence.evidence DROP CONSTRAINT evidence_locator_fields;
ALTER TABLE evidence.evidence ADD CONSTRAINT evidence_locator_fields CHECK (
  CASE locator_type
    WHEN 'TSV_ROW' THEN tabular_row_id IS NOT NULL
      AND num_nonnulls(column_position, column_label, json_path, ixbrl_fact_id, html_anchor, artifact_member_id,
                       html_row_ordinal, html_row_end_ordinal, html_slot_ordinal, block_evidence_id) = 0
    WHEN 'TSV_CELL' THEN tabular_row_id IS NOT NULL AND column_position IS NOT NULL AND column_label IS NOT NULL
      AND num_nonnulls(json_path, ixbrl_fact_id, html_anchor, artifact_member_id,
                       html_row_ordinal, html_row_end_ordinal, html_slot_ordinal, block_evidence_id) = 0
    WHEN 'JSON_PATH' THEN json_path IS NOT NULL
      AND num_nonnulls(tabular_row_id, column_position, column_label, ixbrl_fact_id, html_anchor, artifact_member_id,
                       html_row_ordinal, html_row_end_ordinal, html_slot_ordinal, block_evidence_id) = 0
    WHEN 'IXBRL_FACT' THEN ixbrl_fact_id IS NOT NULL
      AND html_row_end_ordinal IS NULL
      AND html_slot_ordinal IS NULL
      AND num_nonnulls(tabular_row_id, column_position, column_label, json_path, html_anchor, artifact_member_id) = 0
      AND (block_evidence_id IS NULL) = (html_row_ordinal IS NULL)
    WHEN 'HTML_ANCHOR' THEN html_anchor IS NOT NULL
      AND num_nonnulls(tabular_row_id, column_position, column_label, json_path, ixbrl_fact_id, artifact_member_id,
                       html_row_ordinal, html_row_end_ordinal, html_slot_ordinal, block_evidence_id) = 0
    WHEN 'DOCUMENT' THEN
      num_nonnulls(tabular_row_id, column_position, column_label, json_path, ixbrl_fact_id, html_anchor,
                   html_row_ordinal, html_row_end_ordinal, html_slot_ordinal, block_evidence_id) = 0
    WHEN 'DISCLOSURE_BLOCK' THEN html_row_ordinal IS NOT NULL
      AND html_row_end_ordinal IS NOT NULL
      AND html_row_end_ordinal >= html_row_ordinal
      AND html_slot_ordinal IS NULL
      AND block_evidence_id IS NULL
      AND num_nonnulls(tabular_row_id, column_position, column_label, json_path, ixbrl_fact_id, html_anchor, artifact_member_id) = 0
    WHEN 'HTML_TABLE_CELL' THEN html_row_ordinal IS NOT NULL
      AND html_slot_ordinal IS NOT NULL
      AND (block_evidence_id IS NOT NULL OR heading_evidence_id IS NOT NULL)
      AND html_row_end_ordinal IS NULL
      AND num_nonnulls(tabular_row_id, column_position, column_label, json_path, ixbrl_fact_id, html_anchor, artifact_member_id) = 0
    WHEN 'HTML_COLUMN_HEADING' THEN html_row_ordinal IS NOT NULL
      AND html_slot_ordinal IS NOT NULL
      AND html_row_end_ordinal IS NULL
      AND block_evidence_id IS NULL
      AND heading_evidence_id IS NULL
      AND num_nonnulls(tabular_row_id, column_position, column_label, json_path, ixbrl_fact_id, html_anchor, artifact_member_id) = 0
  END);

CREATE UNIQUE INDEX evidence_html_column_heading_location
  ON evidence.evidence (artifact_id, html_row_ordinal, html_slot_ordinal)
  WHERE locator_type = 'HTML_COLUMN_HEADING';

CREATE TABLE evidence.html_column_heading (
  evidence_id              bigint PRIMARY KEY REFERENCES evidence.evidence (id),
  raw_text                 text NOT NULL CHECK (btrim(raw_text) <> ''),
  matched_text             text NOT NULL CHECK (btrim(matched_text) <> ''),
  stack_above_evidence_id  bigint REFERENCES evidence.evidence (id),
  CHECK (stack_above_evidence_id IS DISTINCT FROM evidence_id)
);

COMMENT ON TABLE evidence.html_column_heading IS
  'Raw heading text and the whitespace-normalized match text for one HTML_COLUMN_HEADING. No field code is stored.';
COMMENT ON COLUMN evidence.html_column_heading.raw_text IS
  'Heading text nodes exactly as read. A line break that was markup is not turned into a space here.';
COMMENT ON COLUMN evidence.html_column_heading.matched_text IS
  'Heading text after a line break becomes a space and whitespace collapses. This is the string a rule may match.';
COMMENT ON COLUMN evidence.html_column_heading.stack_above_evidence_id IS
  'Earlier heading cell in the same artifact and slot. The pair is a stacked header, not a field mapping.';

CREATE OR REPLACE FUNCTION evidence.check_evidence() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent evidence.evidence;
  heading evidence.evidence;
BEGIN
  IF NEW.tabular_row_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM raw.tabular_row r JOIN raw.table_load tl ON tl.id = r.table_load_id
    WHERE r.id = NEW.tabular_row_id AND tl.artifact_id = NEW.artifact_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1', MESSAGE = 'evidence tabular_row_id must belong to evidence artifact_id';
  END IF;
  IF NEW.column_position IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM raw.tabular_row r JOIN raw.table_load tl ON tl.id = r.table_load_id
    WHERE r.id = NEW.tabular_row_id AND tl.header[NEW.column_position] = NEW.column_label
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1', MESSAGE = 'evidence column_label must equal the header label at column_position';
  END IF;
  IF NEW.locator_type = 'JSON_PATH' AND NEW.evidence_level IN ('REGISTRY', 'DISCOVERY') AND NOT EXISTS (
    SELECT 1 FROM raw.json_value v WHERE v.artifact_id = NEW.artifact_id AND v.json_path = NEW.json_path
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1', MESSAGE = 'evidence json_path must resolve to a stored raw.json_value of the artifact';
  END IF;
  IF NEW.block_evidence_id IS NOT NULL THEN
    SELECT * INTO parent FROM evidence.evidence WHERE id = NEW.block_evidence_id;
    IF parent.id IS NULL
       OR parent.locator_type IS DISTINCT FROM 'DISCLOSURE_BLOCK'
       OR parent.artifact_id IS DISTINCT FROM NEW.artifact_id THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'disclosure block parent must be a DISCLOSURE_BLOCK on the same artifact';
    END IF;
    IF NEW.locator_type = 'IXBRL_FACT' AND NEW.html_row_ordinal IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'an IXBRL_FACT inside a disclosure block requires html_row_ordinal';
    END IF;
    IF NEW.html_row_ordinal IS NULL
       OR parent.html_row_ordinal IS NULL
       OR parent.html_row_end_ordinal IS NULL
       OR NEW.html_row_ordinal < parent.html_row_ordinal
       OR NEW.html_row_ordinal > parent.html_row_end_ordinal THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'child row ordinal must fall inside the disclosure block';
    END IF;
  END IF;
  IF NEW.heading_evidence_id IS NOT NULL THEN
    SELECT * INTO heading FROM evidence.evidence WHERE id = NEW.heading_evidence_id;
    IF heading.id IS NULL
       OR heading.locator_type IS DISTINCT FROM 'HTML_COLUMN_HEADING'
       OR heading.artifact_id IS DISTINCT FROM NEW.artifact_id
       OR heading.html_slot_ordinal IS DISTINCT FROM NEW.html_slot_ordinal
       OR heading.html_row_ordinal IS NULL
       OR NEW.html_row_ordinal IS NULL
       OR heading.html_row_ordinal >= NEW.html_row_ordinal THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'value cell heading must be an HTML_COLUMN_HEADING on the same artifact and slot, on an earlier row';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION evidence.check_evidence() IS
  'A block parent must be a DISCLOSURE_BLOCK on the same artifact, and the child row must fall inside that block. A heading link must be an earlier HTML_COLUMN_HEADING on the same artifact and slot. The function does not parse HTML and does not assign a field code.';

CREATE FUNCTION evidence.check_html_column_heading() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ev evidence.evidence;
  above evidence.evidence;
BEGIN
  SELECT * INTO ev FROM evidence.evidence WHERE id = NEW.evidence_id;
  IF ev.locator_type IS DISTINCT FROM 'HTML_COLUMN_HEADING' THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'heading text belongs only to an HTML_COLUMN_HEADING';
  END IF;
  IF NEW.stack_above_evidence_id IS NOT NULL THEN
    SELECT * INTO above FROM evidence.evidence WHERE id = NEW.stack_above_evidence_id;
    IF above.locator_type IS DISTINCT FROM 'HTML_COLUMN_HEADING'
       OR above.artifact_id IS DISTINCT FROM ev.artifact_id
       OR above.html_slot_ordinal IS DISTINCT FROM ev.html_slot_ordinal
       OR above.html_row_ordinal IS NULL
       OR ev.html_row_ordinal IS NULL
       OR above.html_row_ordinal >= ev.html_row_ordinal THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'stacked heading must be an earlier HTML_COLUMN_HEADING on the same artifact and slot';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER check_html_column_heading
  BEFORE INSERT ON evidence.html_column_heading
  FOR EACH ROW EXECUTE FUNCTION evidence.check_html_column_heading();

CREATE FUNCTION evidence.require_html_column_heading() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.locator_type = 'HTML_COLUMN_HEADING' AND NOT EXISTS (
    SELECT 1 FROM evidence.html_column_heading h WHERE h.evidence_id = NEW.id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'HTML_COLUMN_HEADING requires raw heading text and matched heading text';
  END IF;
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER require_html_column_heading
  AFTER INSERT ON evidence.evidence
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION evidence.require_html_column_heading();

GRANT SELECT, INSERT ON evidence.html_column_heading TO bdc_pipeline_writer;

ALTER TABLE obs.position_field_value
  ADD COLUMN date_precision text,
  ADD COLUMN normalized_year integer,
  ADD COLUMN normalized_month integer,
  ADD CONSTRAINT field_value_date_precision_check CHECK (
    date_precision IS NULL OR date_precision = 'MONTH'),
  ADD CONSTRAINT field_value_month_shape CHECK (
    (date_precision IS NULL AND normalized_year IS NULL AND normalized_month IS NULL)
    OR (
      date_precision = 'MONTH'
      AND normalized_year BETWEEN 1000 AND 9999
      AND normalized_month BETWEEN 1 AND 12
      AND normalized_date IS NULL
      AND normalized_numeric IS NULL
      AND normalized_text IS NULL
      AND raw_value IS NOT NULL));

ALTER TABLE obs.position_field_value DROP CONSTRAINT field_value_reported;
ALTER TABLE obs.position_field_value ADD CONSTRAINT field_value_reported CHECK (
  value_state <> 'REPORTED' OR (
    raw_value IS NOT NULL AND (
      num_nonnulls(normalized_numeric, normalized_date, normalized_text) = 1
      OR date_precision IS NOT DISTINCT FROM 'MONTH'
      OR scale_state = 'UNRESOLVED')));

COMMENT ON COLUMN obs.position_field_value.date_precision IS
  'MONTH means normalized_year and normalized_month, with normalized_date null. Null is not a precision token: an existing or disclosed calendar day stays in normalized_date, and a non-date value is also null. There is no DAY token.';
COMMENT ON COLUMN obs.position_field_value.normalized_year IS
  'Four-digit year for date_precision MONTH. Null for every other value.';
COMMENT ON COLUMN obs.position_field_value.normalized_month IS
  'Month 1 through 12 for date_precision MONTH. Null for every other value.';

CREATE OR REPLACE FUNCTION obs.check_position_field_value() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  fd ref.field_definition;
  m ref.source_column_mapping;
  origin_row bigint;
BEGIN
  SELECT * INTO fd FROM ref.field_definition WHERE field_code = NEW.field_code;
  IF (NEW.normalized_numeric IS NOT NULL AND fd.value_type <> 'NUMERIC')
     OR (NEW.normalized_date IS NOT NULL AND fd.value_type <> 'DATE')
     OR (NEW.normalized_text IS NOT NULL AND fd.value_type <> 'TEXT') THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = format('field %s takes %s values only', fd.field_code, fd.value_type);
  END IF;
  IF NEW.date_precision = 'MONTH' AND fd.value_type IS DISTINCT FROM 'DATE' THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'month precision is only valid for a DATE field';
  END IF;
  IF NEW.date_precision = 'MONTH' AND NEW.normalized_date IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'month precision cannot store a day';
  END IF;
  IF NEW.value_state = 'REPORTED' AND NEW.column_mapping_id IS NULL AND NOT EXISTS (
    SELECT 1 FROM evidence.evidence e WHERE e.id = NEW.evidence_id AND e.evidence_level = 'L2_ORIGINAL_FILING'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'a REPORTED value needs a source column mapping or Level 2 (original filing) evidence';
  END IF;
  IF NEW.column_mapping_id IS NOT NULL THEN
    SELECT * INTO m FROM ref.source_column_mapping WHERE id = NEW.column_mapping_id;
    IF m.field_code IS DISTINCT FROM NEW.field_code OR m.column_label <> NEW.source_column_label THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'column_mapping_id must map source_column_label to field_code';
    END IF;
  END IF;
  IF NEW.source_column_label IS NOT NULL THEN
    SELECT s.tabular_row_id INTO origin_row
    FROM obs.position_observation p JOIN obs.soi_row_observation s ON s.id = p.origin_soi_row_observation_id
    WHERE p.id = NEW.position_observation_id;
    IF NOT EXISTS (
      SELECT 1 FROM raw.tabular_row r JOIN raw.table_load tl ON tl.id = r.table_load_id
      WHERE r.id = origin_row
        AND tl.header[NEW.source_column_position] = NEW.source_column_label
        AND r.cells[NEW.source_column_position] IS NOT DISTINCT FROM NEW.raw_value
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'source column label, position, and raw value must match the origin SOI row';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION obs.check_position_field_value() IS
  'A field value must match its value type. MONTH precision is a year and month on a DATE field, with no normalized_date. The function does not invent a day.';

SELECT ops.apply_append_only_to_all();
