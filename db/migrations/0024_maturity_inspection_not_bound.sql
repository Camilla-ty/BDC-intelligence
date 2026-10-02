-- 0024 maturity inspection NOT_BOUND: the filing was inspected under a rule version and no
-- filing row was accepted for the position (G-01, G-04, G-10). NOT_BOUND is not UNAVAILABLE
-- (no row was bound, so nothing was shown blank) and not UNRESOLVED (no candidate dates).

ALTER TYPE ref.maturity_inspection_state ADD VALUE 'NOT_BOUND';

CREATE TYPE ref.maturity_no_bind_reason AS ENUM (
  'NO_MATCH',
  'MULTIPLE_ROWS',
  'SHARED_ROW',
  'CONTEXT_NOT_SINGLE_ROW',
  'NO_COMPARABLE_FIELD',
  'NO_REPORTED_DATE'
);

ALTER TABLE obs.maturity_inspection ADD COLUMN no_bind_reason ref.maturity_no_bind_reason;
ALTER TABLE obs.maturity_inspection ALTER COLUMN filing_context_id DROP NOT NULL;
ALTER TABLE obs.maturity_inspection DROP CONSTRAINT maturity_inspection_check1;

-- inspection_state is compared as text: a value added by ALTER TYPE cannot be used as an enum
-- literal in the transaction that added it.
ALTER TABLE obs.maturity_inspection ADD CONSTRAINT maturity_inspection_state_shape CHECK (
  CASE inspection_state::text
    WHEN 'FILING_DISPLAYED' THEN filing_context_id IS NOT NULL AND no_bind_reason IS NULL
      AND raw_value IS NOT NULL AND normalized_date IS NOT NULL
    WHEN 'UNAVAILABLE' THEN filing_context_id IS NOT NULL AND no_bind_reason IS NULL
      AND raw_value IS NULL AND normalized_date IS NULL
    WHEN 'UNRESOLVED' THEN filing_context_id IS NOT NULL AND no_bind_reason IS NULL
      AND normalized_date IS NULL
    WHEN 'NOT_BOUND' THEN filing_context_id IS NULL AND no_bind_reason IS NOT NULL
      AND raw_value IS NULL AND normalized_date IS NULL
    ELSE false
  END
);

COMMENT ON COLUMN obs.maturity_inspection.no_bind_reason IS
  'Why no filing row was accepted. Set only for NOT_BOUND.';
COMMENT ON COLUMN obs.maturity_inspection.evidence_id IS
  'Bound states: L2 HTML_ANCHOR ix-context-row:<filing_context_id> on the position filing, and a PASS validation on the position cites a same-artifact IXBRL_FACT for that context. NOT_BOUND: L2 DOCUMENT on the position filing artifact, and a FAIL validation of the same rule version and run carries no_bind_reason.';

CREATE OR REPLACE FUNCTION obs.check_maturity_inspection() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  origin bigint;
  displayed date;
BEGIN
  SELECT p.origin_soi_row_observation_id INTO origin
  FROM obs.position_observation p
  WHERE p.id = NEW.position_observation_id;
  IF origin IS NULL OR origin IS DISTINCT FROM NEW.soi_row_observation_id THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'maturity inspection must use the position origin SOI row';
  END IF;

  IF NEW.inspection_state = 'NOT_BOUND' THEN
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

  IF NEW.inspection_state = 'FILING_DISPLAYED' THEN
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

-- A current NOT_BOUND inspection adds no date: the structured value decides, else UNKNOWN.
CREATE OR REPLACE VIEW obs.maturity_provenance AS
SELECT p.id AS position_observation_id,
       CASE
         WHEN structured.n = 1 AND structured.distinct_dates = 1
              AND (i.id IS NULL
                   OR i.inspection_state::text = 'NOT_BOUND'
                   OR (i.inspection_state = 'FILING_DISPLAYED'
                       AND i.normalized_date = structured.maturity_date))
           THEN 'REPORTED_STRUCTURED'::ref.maturity_provenance_state
         WHEN (i.id IS NULL OR i.inspection_state::text = 'NOT_BOUND') AND structured.n = 0
           THEN 'UNKNOWN'::ref.maturity_provenance_state
         WHEN i.inspection_state = 'FILING_DISPLAYED' AND structured.n = 0
           THEN 'FILING_DISPLAYED'::ref.maturity_provenance_state
         WHEN i.inspection_state = 'UNAVAILABLE' AND structured.n = 0
           THEN 'UNAVAILABLE'::ref.maturity_provenance_state
         ELSE 'UNRESOLVED'::ref.maturity_provenance_state
       END AS provenance_state,
       i.id AS inspection_id,
       i.inspection_state,
       i.filing_context_id,
       structured.raw_value AS structured_raw,
       structured.maturity_date AS structured_date,
       i.raw_value AS displayed_raw,
       i.normalized_date AS displayed_date,
       i.evidence_id,
       i.no_bind_reason
FROM obs.position_observation p
LEFT JOIN obs.maturity_inspection i
  ON i.position_observation_id = p.id
 AND NOT EXISTS (
   SELECT 1 FROM obs.maturity_inspection s WHERE s.supersedes_id = i.id
 )
LEFT JOIN LATERAL (
  SELECT count(fv.id)::integer AS n,
         count(DISTINCT fv.normalized_date)::integer AS distinct_dates,
         min(fv.normalized_date) AS maturity_date,
         min(fv.raw_value) AS raw_value
  FROM obs.current_position_field_value fv
  WHERE fv.position_observation_id = p.id
    AND fv.field_code = 'MATURITY_DATE'
    AND fv.value_state = 'REPORTED'
) structured ON true;

COMMENT ON VIEW obs.maturity_provenance IS
  'REPORTED_STRUCTURED is the current structured MATURITY_DATE. No inspection row, or a current NOT_BOUND inspection, on a position with no structured date is UNKNOWN. inspection_state says whether the filing was inspected; filing_context_id does not. FILING_DISPLAYED is not copied into MATURITY_DATE.';

SELECT ops.grant_layer_privileges();
SELECT ops.apply_append_only_to_all();
