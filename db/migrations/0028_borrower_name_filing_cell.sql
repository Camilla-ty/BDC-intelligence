-- 0028 borrower-name filing cell.
-- A primary-filing company cell can be stored on obs.borrower_name_observation
-- without using an SOI column position. This file changes the table shape only.
-- It does not insert observations, artifacts, filings, or identity rows.
--
-- The only existing unique key on obs.borrower_name_observation is the primary key.
-- SOI_CELL rows may share one evidence_id (an identifier name and another SOI column
-- on the same position). A partial unique index on FILING_CELL does not change that.

ALTER TABLE obs.borrower_name_observation
  ADD COLUMN name_source text NOT NULL DEFAULT 'SOI_CELL'
    CHECK (name_source IN ('SOI_CELL', 'FILING_CELL'));

ALTER TABLE obs.borrower_name_observation
  ALTER COLUMN source_column_label DROP NOT NULL,
  ALTER COLUMN source_column_position DROP NOT NULL;

COMMENT ON COLUMN obs.borrower_name_observation.name_source IS
  'SOI_CELL cites an origin SOI cell. FILING_CELL cites a primary-filing cell and leaves the SOI source columns null. Neither source is derived from holding_descriptor_raw.';

-- SOI_CELL evidence is the TSV_CELL on the origin SOI row, not the position row's
-- TSV_ROW evidence id. p4 stores a separate cell evidence row for the same tabular row.
CREATE FUNCTION obs.check_borrower_name_observation() RETURNS trigger
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
        AND e.locator_type IN ('HTML_ANCHOR', 'IXBRL_FACT')
        AND a.source_type_code = 'SEC_FILING_DOCUMENT'
        AND fd.filing_id = filing
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'FILING_CELL evidence must be L2 HTML_ANCHOR or IXBRL_FACT on a SEC_FILING_DOCUMENT linked to the position filing';
    END IF;
  ELSE
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'name_source must be SOI_CELL or FILING_CELL';
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION obs.check_borrower_name_observation() IS
  'SOI_CELL must match the origin SOI cell through L1 TSV_CELL evidence. FILING_CELL must cite L2 HTML_ANCHOR or IXBRL_FACT on the position filing document. The function does not parse HTML and does not read holding_descriptor_raw.';

CREATE TRIGGER check_borrower_name_observation
  BEFORE INSERT ON obs.borrower_name_observation
  FOR EACH ROW EXECUTE FUNCTION obs.check_borrower_name_observation();

CREATE UNIQUE INDEX borrower_name_observation_filing_cell_evidence_uidx
  ON obs.borrower_name_observation (position_observation_id, evidence_id)
  WHERE name_source = 'FILING_CELL';
