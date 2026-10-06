-- 0037 filing month precision.
-- A selected filing maturity that discloses a month and year, and no day, is
-- FILING_MONTH. displayed_year and displayed_month store that month.
-- normalized_date stays null. Existing inspection rows keep both columns null.
-- This does not change obs.position_field_value and does not rewrite any row.

ALTER TYPE ref.maturity_inspection_state ADD VALUE 'FILING_MONTH';
ALTER TYPE ref.maturity_provenance_state ADD VALUE 'FILING_MONTH';
ALTER TYPE ref.maturity_provenance_state ADD VALUE 'REPORTED_MONTH';

ALTER TABLE obs.maturity_inspection
  ADD COLUMN displayed_year integer,
  ADD COLUMN displayed_month integer;

ALTER TABLE obs.maturity_inspection DROP CONSTRAINT maturity_inspection_state_shape;

-- inspection_state is compared as text: a value added by ALTER TYPE cannot be used
-- as an enum literal in the transaction that added it.
ALTER TABLE obs.maturity_inspection ADD CONSTRAINT maturity_inspection_state_shape CHECK (
  CASE inspection_state::text
    WHEN 'FILING_DISPLAYED' THEN filing_context_id IS NOT NULL AND no_bind_reason IS NULL
      AND raw_value IS NOT NULL AND normalized_date IS NOT NULL
      AND displayed_year IS NULL AND displayed_month IS NULL
    WHEN 'UNAVAILABLE' THEN filing_context_id IS NOT NULL AND no_bind_reason IS NULL
      AND raw_value IS NULL AND normalized_date IS NULL
      AND displayed_year IS NULL AND displayed_month IS NULL
    WHEN 'UNRESOLVED' THEN filing_context_id IS NOT NULL AND no_bind_reason IS NULL
      AND normalized_date IS NULL
      AND displayed_year IS NULL AND displayed_month IS NULL
    WHEN 'NOT_BOUND' THEN filing_context_id IS NULL AND no_bind_reason IS NOT NULL
      AND raw_value IS NULL AND normalized_date IS NULL
      AND displayed_year IS NULL AND displayed_month IS NULL
    WHEN 'FILING_MONTH' THEN filing_context_id IS NOT NULL AND no_bind_reason IS NULL
      AND raw_value IS NOT NULL AND normalized_date IS NULL
      AND displayed_year BETWEEN 1000 AND 9999
      AND displayed_month BETWEEN 1 AND 12
    ELSE false
  END
);

COMMENT ON COLUMN obs.maturity_inspection.displayed_year IS
  'Four-digit year for FILING_MONTH. Null for every other inspection state. This is not a calendar day.';
COMMENT ON COLUMN obs.maturity_inspection.displayed_month IS
  'Month 1 through 12 for FILING_MONTH. Null for every other inspection state. This is not a calendar day.';

CREATE OR REPLACE FUNCTION obs.check_maturity_inspection() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  origin bigint;
  displayed date;
  raw_month integer;
  raw_year integer;
BEGIN
  SELECT p.origin_soi_row_observation_id INTO origin
  FROM obs.position_observation p
  WHERE p.id = NEW.position_observation_id;
  IF origin IS NULL OR origin IS DISTINCT FROM NEW.soi_row_observation_id THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'maturity inspection must use the position origin SOI row';
  END IF;

  IF NEW.inspection_state::text = 'NOT_BOUND' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM evidence.evidence e
      JOIN registry.filing_document_artifact fda ON fda.artifact_id = e.artifact_id
      JOIN registry.filing_document fd ON fd.id = fda.filing_document_id
      JOIN obs.position_observation p ON p.id = NEW.position_observation_id
      WHERE e.id = NEW.evidence_id
        AND e.evidence_level = 'L2_ORIGINAL_FILING'
        AND e.locator_type = 'DOCUMENT'
        AND fd.filing_id = p.filing_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'NOT_BOUND requires L2 DOCUMENT evidence on the position filing artifact';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM validation.validation_result v
      JOIN evidence.evidence ve ON ve.id = v.evidence_id
      JOIN evidence.evidence doc ON doc.id = NEW.evidence_id
      WHERE v.subject_table = 'obs.position_observation'
        AND v.subject_id = NEW.position_observation_id
        AND v.outcome = 'FAIL'
        AND v.rule_version_id = NEW.rule_version_id
        AND v.run_id = NEW.run_id
        AND v.detail = NEW.no_bind_reason::text
        AND ve.evidence_level = 'L2_ORIGINAL_FILING'
        AND ve.artifact_id = doc.artifact_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'NOT_BOUND requires a FAIL validation of the same rule version and run whose detail is no_bind_reason';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.inspection_state::text = 'FILING_DISPLAYED' THEN
    IF NEW.raw_value !~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$' THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'FILING_DISPLAYED raw_value must be a month/day/year date';
    END IF;
    displayed := to_date(NEW.raw_value, 'FMMM/FMDD/YYYY');
    IF NEW.normalized_date IS DISTINCT FROM displayed THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'normalized_date must equal the displayed month/day/year';
    END IF;
  END IF;

  IF NEW.inspection_state::text = 'FILING_MONTH' THEN
    IF NEW.raw_value !~ '^[0-9]{1,2}/[0-9]{4}$' THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'FILING_MONTH raw_value must be a month/year';
    END IF;
    IF NEW.normalized_date IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'FILING_MONTH normalized_date must be null';
    END IF;
    raw_month := split_part(NEW.raw_value, '/', 1)::integer;
    raw_year := split_part(NEW.raw_value, '/', 2)::integer;
    IF NEW.displayed_month IS DISTINCT FROM raw_month OR NEW.displayed_year IS DISTINCT FROM raw_year THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'FILING_MONTH displayed month and year must equal the raw month/year';
    END IF;
    IF raw_month < 1 OR raw_month > 12 THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'FILING_MONTH month must be 1 through 12';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM evidence.evidence e
    JOIN registry.filing_document_artifact fda ON fda.artifact_id = e.artifact_id
    JOIN registry.filing_document fd ON fd.id = fda.filing_document_id
    JOIN obs.position_observation p ON p.id = NEW.position_observation_id
    WHERE e.id = NEW.evidence_id
      AND e.evidence_level = 'L2_ORIGINAL_FILING'
      AND e.locator_type = 'HTML_ANCHOR'
      AND e.html_anchor = 'ix-context-row:' || NEW.filing_context_id
      AND fd.filing_id = p.filing_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'maturity inspection requires an L2 ix-context-row anchor on the position filing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM validation.validation_result v
    JOIN evidence.evidence fact ON fact.id = v.evidence_id
    JOIN evidence.evidence anchor ON anchor.id = NEW.evidence_id
    WHERE v.subject_table = 'obs.position_observation'
      AND v.subject_id = NEW.position_observation_id
      AND v.outcome = 'PASS'
      AND v.detail = NEW.filing_context_id
      AND fact.evidence_level = 'L2_ORIGINAL_FILING'
      AND fact.locator_type = 'IXBRL_FACT'
      AND fact.artifact_id = anchor.artifact_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'maturity inspection requires a PASS validation of an IXBRL_FACT on the same filing artifact for this context';
  END IF;
  RETURN NEW;
END
$$;
