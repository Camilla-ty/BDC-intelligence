-- 0023 Maturity provenance inspections.
-- A missing inspection stays UNKNOWN. A structured MATURITY_DATE row stays the structured
-- maturity. FILING_DISPLAYED cites an L2 context-row anchor and a validated iXBRL fact.
-- This migration does not inspect loaded rows and does not insert field values.

CREATE TYPE ref.maturity_inspection_state AS ENUM (
  'FILING_DISPLAYED',
  'UNAVAILABLE',
  'UNRESOLVED'
);

CREATE TYPE ref.maturity_provenance_state AS ENUM (
  'REPORTED_STRUCTURED',
  'FILING_DISPLAYED',
  'UNAVAILABLE',
  'UNKNOWN',
  'UNRESOLVED'
);

ALTER TABLE evidence.evidence
  ADD CONSTRAINT evidence_l2_html_anchor_context_row CHECK (
    evidence_level <> 'L2_ORIGINAL_FILING'
    OR locator_type <> 'HTML_ANCHOR'
    OR html_anchor ~ '^ix-context-row:[A-Za-z0-9_-]+$'
  );

CREATE TABLE obs.maturity_inspection (
  id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  position_observation_id bigint NOT NULL REFERENCES obs.position_observation (id),
  soi_row_observation_id  bigint NOT NULL REFERENCES obs.soi_row_observation (id),
  inspection_state        ref.maturity_inspection_state NOT NULL,
  filing_context_id       text NOT NULL CHECK (filing_context_id ~ '^[A-Za-z0-9_-]+$'),
  raw_value               text,
  normalized_date         date,
  evidence_id             bigint NOT NULL REFERENCES evidence.evidence (id),
  rule_version_id         bigint NOT NULL REFERENCES ops.rule_version (id),
  run_id                  bigint NOT NULL REFERENCES ops.run (id),
  supersedes_id           bigint REFERENCES obs.maturity_inspection (id),
  supersede_reason        text,
  recorded_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (supersedes_id IS DISTINCT FROM id),
  CHECK (
    (inspection_state = 'FILING_DISPLAYED' AND raw_value IS NOT NULL AND normalized_date IS NOT NULL)
    OR (inspection_state = 'UNAVAILABLE' AND raw_value IS NULL AND normalized_date IS NULL)
    OR (inspection_state = 'UNRESOLVED' AND normalized_date IS NULL)
  )
);

COMMENT ON TABLE obs.maturity_inspection IS
  'Append-only inspection of one position origin. No row means the filing row has not been inspected. FILING_DISPLAYED is not a MATURITY_DATE field value.';

COMMENT ON COLUMN obs.maturity_inspection.evidence_id IS
  'L2 HTML_ANCHOR ix-context-row:<filing_context_id> on the position filing. A PASS validation on the position cites a same-artifact IXBRL_FACT for that context.';

SELECT ops.add_supersession('obs.maturity_inspection', 'position_observation_id', 'single_chain');

CREATE TABLE obs.maturity_inspection_candidate (
  id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  maturity_inspection_id  bigint NOT NULL REFERENCES obs.maturity_inspection (id),
  raw_value               text NOT NULL CHECK (btrim(raw_value) <> ''),
  normalized_date         date,
  evidence_id             bigint NOT NULL REFERENCES evidence.evidence (id),
  run_id                  bigint NOT NULL REFERENCES ops.run (id),
  recorded_at             timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE obs.maturity_inspection_candidate IS
  'One candidate displayed date for an UNRESOLVED inspection. None of the candidates is selected.';

CREATE FUNCTION obs.check_maturity_inspection() RETURNS trigger
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

CREATE TRIGGER check_maturity_inspection
  BEFORE INSERT ON obs.maturity_inspection
  FOR EACH ROW EXECUTE FUNCTION obs.check_maturity_inspection();

CREATE FUNCTION obs.check_maturity_inspection_candidate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM obs.maturity_inspection i
    WHERE i.id = NEW.maturity_inspection_id AND i.inspection_state = 'UNRESOLVED'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'maturity candidates belong only to an UNRESOLVED inspection';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER check_maturity_inspection_candidate
  BEFORE INSERT ON obs.maturity_inspection_candidate
  FOR EACH ROW EXECUTE FUNCTION obs.check_maturity_inspection_candidate();

CREATE VIEW obs.maturity_provenance AS
SELECT p.id AS position_observation_id,
       CASE
         WHEN structured.n = 1 AND structured.distinct_dates = 1
              AND (i.id IS NULL
                   OR (i.inspection_state = 'FILING_DISPLAYED'
                       AND i.normalized_date = structured.maturity_date))
           THEN 'REPORTED_STRUCTURED'::ref.maturity_provenance_state
         WHEN i.id IS NULL AND structured.n = 0
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
       i.evidence_id
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
  'REPORTED_STRUCTURED is the current structured MATURITY_DATE. No inspection row on a position with no structured date is UNKNOWN. FILING_DISPLAYED is not copied into MATURITY_DATE.';

SELECT ops.grant_layer_privileges();
SELECT ops.apply_append_only_to_all();
