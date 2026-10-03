-- 0030 disclosure-block evidence.
-- A Schedule of Investments company disclosure is an L2 DISCLOSURE_BLOCK.
-- Untagged cells inside it are HTML_TABLE_CELL. Tagged numbers stay IXBRL_FACT.
-- This file inserts no evidence rows and does not parse HTML.

ALTER TABLE evidence.evidence
  ADD COLUMN html_row_ordinal integer,
  ADD COLUMN html_row_end_ordinal integer,
  ADD COLUMN html_slot_ordinal integer,
  ADD COLUMN block_evidence_id bigint;

ALTER TABLE evidence.evidence
  ADD CONSTRAINT evidence_html_row_ordinal_check
    CHECK (html_row_ordinal IS NULL OR html_row_ordinal >= 1),
  ADD CONSTRAINT evidence_html_row_end_ordinal_check
    CHECK (html_row_end_ordinal IS NULL OR html_row_end_ordinal >= 1),
  ADD CONSTRAINT evidence_html_slot_ordinal_check
    CHECK (html_slot_ordinal IS NULL OR html_slot_ordinal >= 0),
  ADD CONSTRAINT evidence_html_row_span_check
    CHECK (html_row_ordinal IS NULL OR html_row_end_ordinal IS NULL OR html_row_end_ordinal >= html_row_ordinal),
  ADD CONSTRAINT evidence_block_evidence_fkey
    FOREIGN KEY (block_evidence_id) REFERENCES evidence.evidence (id);

COMMENT ON COLUMN evidence.evidence.html_row_ordinal IS
  '1-based document order of a <tr>, using the schedule disclosure parser row scan. Null for locators that are not an HTML row.';
COMMENT ON COLUMN evidence.evidence.html_row_end_ordinal IS
  'Inclusive end row of a DISCLOSURE_BLOCK. Null for every other locator.';
COMMENT ON COLUMN evidence.evidence.html_slot_ordinal IS
  'Colspan-grid slot of an HTML_TABLE_CELL. Slot 0 is allowed. The database does not decide which slot is the Portfolio Company column.';
COMMENT ON COLUMN evidence.evidence.block_evidence_id IS
  'DISCLOSURE_BLOCK that contains this cell or fact. Null on the block itself and on evidence that is not inside a block.';

ALTER TABLE evidence.evidence DROP CONSTRAINT evidence_level_locator;
ALTER TABLE evidence.evidence ADD CONSTRAINT evidence_level_locator CHECK (
  CASE evidence_level
    WHEN 'L1_STRUCTURED_DATASET' THEN locator_type IN ('TSV_ROW', 'TSV_CELL')
      OR (locator_type = 'DOCUMENT' AND artifact_member_id IS NOT NULL)
    WHEN 'L2_ORIGINAL_FILING' THEN locator_type IN (
      'IXBRL_FACT', 'HTML_ANCHOR', 'DOCUMENT', 'DISCLOSURE_BLOCK', 'HTML_TABLE_CELL')
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
      AND block_evidence_id IS NOT NULL
      AND html_row_end_ordinal IS NULL
      AND num_nonnulls(tabular_row_id, column_position, column_label, json_path, ixbrl_fact_id, html_anchor, artifact_member_id) = 0
  END);

CREATE OR REPLACE FUNCTION evidence.check_evidence() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent evidence.evidence;
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
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION evidence.check_evidence() IS
  'A block parent must be a DISCLOSURE_BLOCK on the same artifact, and the child row must fall inside that block. The function does not parse HTML and does not assign the Portfolio Company slot.';

CREATE OR REPLACE FUNCTION obs.check_borrower_name_observation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  origin_row bigint;
  filing bigint;
BEGIN
  IF NEW.name_source = 'SOI_CELL' THEN
    IF NEW.source_column_label IS NULL OR NEW.source_column_position IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'SOI_CELL requires source_column_label and source_column_position';
    END IF;
    SELECT s.tabular_row_id INTO origin_row
    FROM obs.position_observation p
    JOIN obs.soi_row_observation s ON s.id = p.origin_soi_row_observation_id
    WHERE p.id = NEW.position_observation_id;
    IF origin_row IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'SOI_CELL requires the position observation origin SOI row';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM evidence.evidence e
      WHERE e.id = NEW.evidence_id
        AND e.evidence_level = 'L1_STRUCTURED_DATASET'
        AND e.locator_type = 'TSV_CELL'
        AND e.tabular_row_id = origin_row
        AND e.column_label = NEW.source_column_label
        AND e.column_position = NEW.source_column_position
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'SOI_CELL evidence must be an L1 TSV_CELL on the origin SOI row at the named column';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM raw.tabular_row r
      JOIN raw.table_load tl ON tl.id = r.table_load_id
      WHERE r.id = origin_row
        AND tl.header[NEW.source_column_position] = NEW.source_column_label
        AND r.cells[NEW.source_column_position] IS NOT DISTINCT FROM NEW.raw_text
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'SOI_CELL raw_text must equal the origin SOI cell';
    END IF;
  ELSIF NEW.name_source = 'FILING_CELL' THEN
    IF NEW.source_column_label IS NOT NULL OR NEW.source_column_position IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'FILING_CELL cannot carry SOI source columns';
    END IF;
    IF NEW.raw_text IS NULL OR NEW.raw_text = '' THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'FILING_CELL raw_text must be non-empty';
    END IF;
    SELECT p.filing_id INTO filing
    FROM obs.position_observation p
    WHERE p.id = NEW.position_observation_id;
    IF NOT EXISTS (
      SELECT 1
      FROM evidence.evidence e
      JOIN raw.artifact a ON a.id = e.artifact_id
      JOIN registry.filing_document_artifact fda ON fda.artifact_id = a.id
      JOIN registry.filing_document fd ON fd.id = fda.filing_document_id
      WHERE e.id = NEW.evidence_id
        AND e.evidence_level = 'L2_ORIGINAL_FILING'
        AND a.source_type_code = 'SEC_FILING_DOCUMENT'
        AND fd.filing_id = filing
        AND (
          e.locator_type IN ('HTML_ANCHOR', 'IXBRL_FACT')
          OR (
            e.locator_type = 'HTML_TABLE_CELL'
            AND e.block_evidence_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM evidence.evidence parent
              WHERE parent.id = e.block_evidence_id
                AND parent.locator_type = 'DISCLOSURE_BLOCK'
                AND parent.artifact_id = e.artifact_id
                AND parent.html_row_ordinal = e.html_row_ordinal
            )
          )
        )
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'FILING_CELL evidence must be L2 HTML_ANCHOR, IXBRL_FACT, or a block-start HTML_TABLE_CELL on a SEC_FILING_DOCUMENT linked to the position filing';
    END IF;
  ELSE
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'name_source must be SOI_CELL or FILING_CELL';
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION obs.check_borrower_name_observation() IS
  'SOI_CELL must match the origin SOI cell through L1 TSV_CELL evidence. FILING_CELL cites L2 HTML_ANCHOR, IXBRL_FACT, or an HTML_TABLE_CELL on the disclosure block start row. The function does not parse HTML and does not read holding_descriptor_raw.';
