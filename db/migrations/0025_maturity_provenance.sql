-- 0025 maturity provenance: one product maturity per position with an explicit source
-- (G-01, G-04, G-11, G-12). MATURITY_DATE stays the structured SOI value only. A filing date
-- is used only from the current (unsuperseded) FILING_DISPLAYED inspection and is never
-- copied into MATURITY_DATE. No table, field value, or inspection row is changed.
--
-- provenance_state is the source of maturity_date:
--   REPORTED_STRUCTURED  one structured date; any current inspection agrees, is NOT_BOUND, or is UNAVAILABLE
--   FILING_DISPLAYED     no structured date; the current inspection displays one date
--   UNKNOWN              no structured date; no current inspection, or it is NOT_BOUND or UNAVAILABLE
--   UNRESOLVED           anything else, including a structured date that differs from the displayed date

CREATE OR REPLACE VIEW obs.maturity_provenance AS
SELECT b.position_observation_id,
       b.provenance_state,
       b.inspection_id,
       b.inspection_state,
       b.filing_context_id,
       b.structured_raw,
       b.structured_date,
       b.displayed_raw,
       b.displayed_date,
       b.evidence_id,
       b.no_bind_reason,
       CASE b.provenance_state
         WHEN 'REPORTED_STRUCTURED' THEN b.structured_date
         WHEN 'FILING_DISPLAYED' THEN b.displayed_date
       END AS maturity_date,
       CASE b.provenance_state
         WHEN 'REPORTED_STRUCTURED' THEN b.structured_raw
         WHEN 'FILING_DISPLAYED' THEN b.displayed_raw
       END AS maturity_raw,
       (b.provenance_state = 'REPORTED_STRUCTURED'
        AND b.inspection_state IS NOT DISTINCT FROM 'FILING_DISPLAYED') AS filing_verified,
       b.structured_field_value_id
FROM (
  SELECT p.id AS position_observation_id,
         CASE
           WHEN structured.n = 1 AND structured.distinct_dates = 1
                AND (i.id IS NULL
                     OR i.inspection_state IN ('NOT_BOUND', 'UNAVAILABLE')
                     OR (i.inspection_state = 'FILING_DISPLAYED'
                         AND i.normalized_date = structured.maturity_date))
             THEN 'REPORTED_STRUCTURED'::ref.maturity_provenance_state
           WHEN structured.n = 0
                AND (i.id IS NULL OR i.inspection_state IN ('NOT_BOUND', 'UNAVAILABLE'))
             THEN 'UNKNOWN'::ref.maturity_provenance_state
           WHEN structured.n = 0 AND i.inspection_state = 'FILING_DISPLAYED'
             THEN 'FILING_DISPLAYED'::ref.maturity_provenance_state
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
         i.no_bind_reason,
         structured.field_value_id AS structured_field_value_id
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
           min(fv.raw_value) AS raw_value,
           CASE WHEN count(fv.id) = 1 THEN min(fv.id) END AS field_value_id
    FROM obs.current_position_field_value fv
    WHERE fv.position_observation_id = p.id
      AND fv.field_code = 'MATURITY_DATE'
      AND fv.value_state = 'REPORTED'
  ) structured ON true
) b;

COMMENT ON VIEW obs.maturity_provenance IS
  'One product maturity per position. maturity_date comes from the structured MATURITY_DATE (REPORTED_STRUCTURED) or from the current FILING_DISPLAYED inspection (FILING_DISPLAYED); it is NULL for UNKNOWN and UNRESOLVED. Superseded inspections are never read. inspection_state and no_bind_reason say why a filing supplied no date; filing_context_id does not. FILING_DISPLAYED is not copied into MATURITY_DATE.';
COMMENT ON COLUMN obs.maturity_provenance.maturity_date IS
  'Product maturity. Source is provenance_state. NULL when UNKNOWN or UNRESOLVED.';
COMMENT ON COLUMN obs.maturity_provenance.maturity_raw IS
  'The value exactly as disclosed by the source named in provenance_state.';
COMMENT ON COLUMN obs.maturity_provenance.filing_verified IS
  'The structured date is the product maturity and the current filing inspection displays the same date.';
COMMENT ON COLUMN obs.maturity_provenance.structured_field_value_id IS
  'The single current REPORTED MATURITY_DATE field value, when there is exactly one.';
COMMENT ON TYPE ref.maturity_provenance_state IS
  'Source of the product maturity. Since 0025, UNAVAILABLE is not produced: an UNAVAILABLE inspection with no structured date is UNKNOWN, and inspection_state carries UNAVAILABLE.';

SELECT ops.grant_layer_privileges();
