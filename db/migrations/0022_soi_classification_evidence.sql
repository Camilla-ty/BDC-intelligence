-- 0022 Filing evidence for SOI row-kind classification.
-- Existing classification rows stay stored with a null evidence_id. SUBTOTAL_ROW and
-- DIMENSION_FACT_ROW require an L2 fact or anchor on the same filing. Q6 and Q14 are unchanged.
-- This migration does not classify loaded rows and does not insert positions.

ALTER TABLE obs.soi_row_classification
  ADD COLUMN evidence_id bigint REFERENCES evidence.evidence (id);

ALTER TABLE obs.soi_row_classification
  ADD CONSTRAINT soi_row_classification_filing_evidence_check
  CHECK (row_kind::text NOT IN ('SUBTOTAL_ROW', 'DIMENSION_FACT_ROW') OR evidence_id IS NOT NULL);

COMMENT ON COLUMN obs.soi_row_classification.evidence_id IS
  'Filing evidence for SUBTOTAL_ROW and DIMENSION_FACT_ROW. Null on IDENTIFIER_ROW, historical NO_IDENTIFIER_ROW, and UNCLASSIFIED. The SOI row observation keeps its own TSV evidence.';

COMMENT ON TABLE obs.soi_row_classification IS
  'Rule-versioned classification of a SOI row. Historical NO_IDENTIFIER_ROW rows stay stored with null evidence_id. SUBTOTAL_ROW and DIMENSION_FACT_ROW are new rows that supersede them and cite L2 filing evidence. Selecting current holdings is OPEN QUESTION Q6; UNRESOLVED is valid.';

CREATE OR REPLACE FUNCTION obs.check_soi_row_classification() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ident text;
BEGIN
  SELECT o.identifier_raw INTO ident
  FROM obs.soi_row_observation o
  WHERE o.id = NEW.soi_row_observation_id;

  IF NEW.row_kind::text = 'IDENTIFIER_ROW' AND ident IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'IDENTIFIER_ROW requires a non-empty origin identifier cell';
  END IF;
  IF NEW.row_kind::text IN ('NO_IDENTIFIER_ROW', 'SUBTOTAL_ROW', 'DIMENSION_FACT_ROW') AND ident IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'this row kind requires an empty origin identifier cell';
  END IF;
  IF NEW.row_kind::text IS DISTINCT FROM 'IDENTIFIER_ROW'
     AND EXISTS (
       SELECT 1 FROM obs.position_observation p
       WHERE p.origin_soi_row_observation_id = NEW.soi_row_observation_id
     ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'a position origin must stay IDENTIFIER_ROW';
  END IF;
  IF NEW.row_kind::text IN ('SUBTOTAL_ROW', 'DIMENSION_FACT_ROW') AND NEW.evidence_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'SUBTOTAL_ROW and DIMENSION_FACT_ROW require filing evidence';
  END IF;
  IF NEW.row_kind::text IN ('SUBTOTAL_ROW', 'DIMENSION_FACT_ROW') AND NOT EXISTS (
    SELECT 1
    FROM evidence.evidence e
    JOIN registry.filing_document_artifact fda ON fda.artifact_id = e.artifact_id
    JOIN registry.filing_document fd ON fd.id = fda.filing_document_id
    JOIN obs.soi_row_observation o ON o.id = NEW.soi_row_observation_id
    WHERE e.id = NEW.evidence_id
      AND e.evidence_level = 'L2_ORIGINAL_FILING'
      AND e.locator_type IN ('IXBRL_FACT', 'HTML_ANCHOR')
      AND fd.filing_id = o.filing_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'filing evidence must be L2 IXBRL_FACT or HTML_ANCHOR on the same filing';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE VIEW obs.current_soi_row_classification AS
SELECT c.id,
       c.soi_row_observation_id,
       c.row_kind,
       c.period_role,
       c.rule_version_id,
       c.run_id,
       c.supersedes_id,
       c.supersede_reason,
       c.recorded_at,
       c.evidence_id
FROM obs.soi_row_classification c
WHERE NOT EXISTS (
  SELECT 1 FROM obs.soi_row_classification s WHERE s.supersedes_id = c.id
);
