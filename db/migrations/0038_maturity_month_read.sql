-- 0038 month-precision maturity read.
-- FILING_MONTH is a selected filing month. REPORTED_MONTH is one current
-- MATURITY_DATE stored with date_precision MONTH. maturity_date stays null
-- for both. A calendar day is unchanged. An unresolved inspection still
-- selects nothing, including when a month field is also stored.
-- The new enum labels are used here, after 0037 has committed.

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
       CASE b.provenance_state::text
         WHEN 'REPORTED_STRUCTURED' THEN b.structured_date
         WHEN 'FILING_DISPLAYED' THEN b.displayed_date
       END AS maturity_date,
       CASE b.provenance_state::text
         WHEN 'REPORTED_STRUCTURED' THEN b.structured_raw
         WHEN 'FILING_DISPLAYED' THEN b.displayed_raw
         WHEN 'REPORTED_MONTH' THEN b.structured_raw
         WHEN 'FILING_MONTH' THEN b.displayed_raw
       END AS maturity_raw,
       (b.provenance_state = 'REPORTED_STRUCTURED'
        AND b.inspection_state IS NOT DISTINCT FROM 'FILING_DISPLAYED') AS filing_verified,
       b.structured_field_value_id,
       CASE b.provenance_state::text
         WHEN 'FILING_MONTH' THEN 'MONTH'
         WHEN 'REPORTED_MONTH' THEN 'MONTH'
       END AS maturity_precision,
       CASE b.provenance_state::text
         WHEN 'FILING_MONTH' THEN b.displayed_year
         WHEN 'REPORTED_MONTH' THEN b.structured_year
       END AS maturity_year,
       CASE b.provenance_state::text
         WHEN 'FILING_MONTH' THEN b.displayed_month
         WHEN 'REPORTED_MONTH' THEN b.structured_month
       END AS maturity_month
FROM (
  SELECT p.id AS position_observation_id,
         CASE
           WHEN structured.n = 1 AND structured.distinct_dates = 1
                AND (i.id IS NULL
                     OR i.inspection_state::text IN ('NOT_BOUND', 'UNAVAILABLE')
                     OR (i.inspection_state::text = 'FILING_DISPLAYED'
                         AND i.normalized_date = structured.maturity_date))
             THEN 'REPORTED_STRUCTURED'::ref.maturity_provenance_state
           WHEN structured.n = 1 AND structured.distinct_dates = 0 AND structured.month_rows = 1
                AND (i.id IS NULL
                     OR i.inspection_state::text IN ('NOT_BOUND', 'UNAVAILABLE')
                     OR (i.inspection_state::text = 'FILING_MONTH'
                         AND i.displayed_year = structured.maturity_year
                         AND i.displayed_month = structured.maturity_month))
             THEN 'REPORTED_MONTH'::ref.maturity_provenance_state
           WHEN structured.n = 0
                AND (i.id IS NULL OR i.inspection_state::text IN ('NOT_BOUND', 'UNAVAILABLE'))
             THEN 'UNKNOWN'::ref.maturity_provenance_state
           WHEN structured.n = 0 AND i.inspection_state::text = 'FILING_DISPLAYED'
             THEN 'FILING_DISPLAYED'::ref.maturity_provenance_state
           WHEN structured.n = 0 AND i.inspection_state::text = 'FILING_MONTH'
             THEN 'FILING_MONTH'::ref.maturity_provenance_state
           ELSE 'UNRESOLVED'::ref.maturity_provenance_state
         END AS provenance_state,
         i.id AS inspection_id,
         i.inspection_state,
         i.filing_context_id,
         structured.raw_value AS structured_raw,
         structured.maturity_date AS structured_date,
         structured.maturity_year AS structured_year,
         structured.maturity_month AS structured_month,
         i.raw_value AS displayed_raw,
         i.normalized_date AS displayed_date,
         i.displayed_year,
         i.displayed_month,
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
           count(*) FILTER (
             WHERE fv.date_precision = 'MONTH'
               AND fv.normalized_date IS NULL
               AND fv.normalized_year BETWEEN 1000 AND 9999
               AND fv.normalized_month BETWEEN 1 AND 12
               AND fv.raw_value IS NOT NULL
           )::integer AS month_rows,
           min(fv.normalized_date) AS maturity_date,
           min(fv.raw_value) AS raw_value,
           min(fv.normalized_year) FILTER (WHERE fv.date_precision = 'MONTH') AS maturity_year,
           min(fv.normalized_month) FILTER (WHERE fv.date_precision = 'MONTH') AS maturity_month,
           CASE WHEN count(fv.id) = 1 THEN min(fv.id) END AS field_value_id
    FROM obs.position_field_value fv
    WHERE fv.position_observation_id = p.id
      AND fv.field_code = 'MATURITY_DATE'
      AND fv.value_state = 'REPORTED'
      AND NOT EXISTS (
        SELECT 1 FROM obs.position_field_value s WHERE s.supersedes_id = fv.id
      )
  ) structured ON true
) b;

COMMENT ON VIEW obs.maturity_provenance IS
  'One product maturity per position. maturity_date is a calendar day from REPORTED_STRUCTURED or FILING_DISPLAYED only. FILING_MONTH and REPORTED_MONTH keep maturity_date null and expose maturity_precision MONTH. UNRESOLVED selects nothing. FILING_DISPLAYED is not copied into MATURITY_DATE.';
COMMENT ON COLUMN obs.maturity_provenance.maturity_date IS
  'Product maturity calendar day. NULL for UNKNOWN, UNRESOLVED, FILING_MONTH, and REPORTED_MONTH.';
COMMENT ON COLUMN obs.maturity_provenance.maturity_precision IS
  'MONTH when the product maturity is a disclosed month and year. NULL when it is a calendar day or absent.';
COMMENT ON COLUMN obs.maturity_provenance.maturity_year IS
  'Four-digit year for maturity_precision MONTH. NULL for a calendar day; that year stays on maturity_date.';
COMMENT ON COLUMN obs.maturity_provenance.maturity_month IS
  'Month 1 through 12 for maturity_precision MONTH. NULL otherwise.';

CREATE OR REPLACE VIEW registry.maturity_read AS
SELECT mp.position_observation_id,
       mp.maturity_date,
       mp.maturity_raw,
       mp.provenance_state::text AS maturity_source,
       mp.inspection_state::text AS inspection_state,
       mp.no_bind_reason::text AS no_bind_reason,
       mp.filing_verified,
       doc.document_url AS maturity_document_url,
       mp.maturity_precision,
       mp.maturity_year,
       mp.maturity_month
FROM obs.maturity_provenance mp
JOIN obs.position_observation p ON p.id = mp.position_observation_id
LEFT JOIN LATERAL (
  SELECT CASE WHEN count(DISTINCT fd.document_url) = 1 THEN min(fd.document_url) END AS document_url
  FROM evidence.evidence e
  JOIN registry.filing_document_artifact fda ON fda.artifact_id = e.artifact_id
  JOIN registry.filing_document fd ON fd.id = fda.filing_document_id AND fd.filing_id = p.filing_id
  WHERE e.id = mp.evidence_id
    AND (mp.provenance_state::text IN ('FILING_DISPLAYED', 'FILING_MONTH') OR mp.filing_verified)
) doc ON true;

COMMENT ON VIEW registry.maturity_read IS
  'The product maturity of one disclosed line. maturity_date is a calendar day and is NULL for a month. maturity_precision MONTH carries maturity_year and maturity_month without a day.';
COMMENT ON COLUMN registry.maturity_read.maturity_precision IS
  'MONTH for a month-precision product maturity. NULL when maturity_date is a calendar day or no maturity was selected.';
COMMENT ON COLUMN registry.maturity_read.maturity_year IS
  'Disclosed year for maturity_precision MONTH. Not the year extracted from maturity_date.';
COMMENT ON COLUMN registry.maturity_read.maturity_month IS
  'Disclosed month 1 through 12 for maturity_precision MONTH. NULL otherwise.';

COMMENT ON VIEW registry.maturity_year IS
  'Disclosed lines with one product maturity calendar date, counted by the year of that date. A month-precision maturity has a null maturity_date and is omitted here. Unknown and unresolved maturity are omitted here and kept on maturity_reported_date.';

CREATE OR REPLACE FUNCTION registry.review_case_read(p_case_key text)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, review, registry, obs, evidence, resolution, ref
AS $$
  WITH members AS MATERIALIZED (
    SELECT m.position_observation_id,
           p.filing_id,
           p.reported_date,
           p.holding_descriptor_raw,
           p.evidence_id
    FROM review.current_candidate c
    JOIN review.candidate_member m ON m.candidate_id = c.candidate_id
    JOIN obs.position_observation p ON p.id = m.position_observation_id
    WHERE c.case_key = p_case_key
      AND p_case_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  linked AS MATERIALIZED (
    SELECT m.position_observation_id,
           m.filing_id,
           m.reported_date,
           m.holding_descriptor_raw,
           m.evidence_id,
           reg.registrant_cik
    FROM members m
    JOIN LATERAL (
      SELECT CASE
               WHEN count(DISTINCT l.registrant_id) = 1 AND count(DISTINCT r.cik) = 1
               THEN lpad(min(r.cik)::text, 10, '0')
             END AS registrant_cik
      FROM registry.filing_registrant_link l
      JOIN registry.registrant r ON r.id = l.registrant_id
      WHERE l.filing_id = m.filing_id
        AND NOT EXISTS (
          SELECT 1 FROM registry.filing_registrant_link s WHERE s.supersedes_id = l.id
        )
    ) reg ON reg.registrant_cik IS NOT NULL
  ),
  case_filings AS MATERIALIZED (
    SELECT DISTINCT filing_id FROM linked
  ),
  chosen_document AS MATERIALIZED (
    SELECT DISTINCT ON (doc.filing_id)
           doc.filing_id,
           doc.document_name,
           doc.document_url
    FROM case_filings cf
    JOIN registry.filing_document doc ON doc.filing_id = cf.filing_id
    WHERE doc.document_url ~ '^https://www\.sec\.gov/Archives/edgar/data/'
    ORDER BY doc.filing_id,
             CASE WHEN doc.named_by = 'SUBMISSIONS_PRIMARY_DOCUMENT' THEN 0 ELSE 1 END,
             doc.id
  ),
  lines AS (
    SELECT m.position_observation_id,
           m.registrant_cik,
           m.reported_date,
           m.holding_descriptor_raw AS disclosed_line_text,
           f.accession_number,
           e.evidence_level,
           form.form_state,
           form.form_raw,
           filed.filed_date_state,
           filed.filed_date_raw,
           inline_url.inline_url_state,
           inline_url.inline_url,
           doc.document_name,
           doc.document_url
    FROM linked m
    JOIN registry.filing f ON f.id = m.filing_id
    JOIN evidence.evidence e ON e.id = m.evidence_id
    LEFT JOIN LATERAL (
      SELECT CASE
               WHEN count(DISTINCT o.normalized_text) = 1 THEN 'REPORTED'
               WHEN count(*) = 0 THEN 'UNKNOWN'
               ELSE 'MULTIPLE_VALUES'
             END AS form_state,
             CASE
               WHEN count(DISTINCT o.normalized_text) = 1 THEN min(o.normalized_text)
             END AS form_raw
      FROM registry.filing_attribute_observation o
      WHERE o.filing_id = m.filing_id
        AND o.attribute_code = 'FORM'
        AND o.value_state = 'REPORTED'
        AND NOT EXISTS (
          SELECT 1 FROM registry.filing_attribute_observation s WHERE s.supersedes_id = o.id
        )
    ) form ON true
    LEFT JOIN LATERAL (
      SELECT CASE
               WHEN count(DISTINCT o.normalized_date) = 1 THEN 'REPORTED'
               WHEN count(*) = 0 THEN 'UNKNOWN'
               ELSE 'MULTIPLE_VALUES'
             END AS filed_date_state,
             CASE
               WHEN count(DISTINCT o.normalized_date) = 1 THEN min(o.normalized_date)::text
             END AS filed_date_raw
      FROM registry.filing_attribute_observation o
      WHERE o.filing_id = m.filing_id
        AND o.attribute_code = 'FILED_DATE'
        AND o.value_state = 'REPORTED'
        AND NOT EXISTS (
          SELECT 1 FROM registry.filing_attribute_observation s WHERE s.supersedes_id = o.id
        )
    ) filed ON true
    LEFT JOIN LATERAL (
      SELECT CASE
               WHEN count(DISTINCT o.raw_value) = 1
                AND min(o.raw_value) ~ '^https://www\.sec\.gov/(Archives/edgar/data/|ix\?doc=/Archives/edgar/data/)'
                 THEN 'REPORTED'
               WHEN count(*) = 0 THEN 'UNKNOWN'
               ELSE 'MULTIPLE_VALUES'
             END AS inline_url_state,
             CASE
               WHEN count(DISTINCT o.raw_value) = 1
                AND min(o.raw_value) ~ '^https://www\.sec\.gov/(Archives/edgar/data/|ix\?doc=/Archives/edgar/data/)'
                 THEN min(o.raw_value)
             END AS inline_url
      FROM registry.filing_attribute_observation o
      WHERE o.filing_id = m.filing_id
        AND o.attribute_code = 'INLINE_URL'
        AND o.value_state = 'REPORTED'
        AND NOT EXISTS (
          SELECT 1 FROM registry.filing_attribute_observation s WHERE s.supersedes_id = o.id
        )
    ) inline_url ON true
    LEFT JOIN chosen_document doc ON doc.filing_id = m.filing_id
  ),
  maturity_rows AS (
    SELECT m.position_observation_id,
           mp.provenance_state::text AS provenance_state,
           mp.maturity_raw
    FROM linked m
    JOIN obs.maturity_provenance mp ON mp.position_observation_id = m.position_observation_id
  )
  SELECT json_build_object(
    'lines', COALESCE((
      SELECT json_agg(row_to_json(line) ORDER BY line.disclosed_line_text, line.reported_date, line.accession_number, line.position_observation_id)
      FROM (
        SELECT position_observation_id::text,
               registrant_cik,
               reported_date::text,
               disclosed_line_text,
               accession_number,
               evidence_level::text,
               form_state,
               form_raw,
               filed_date_state,
               filed_date_raw,
               inline_url_state,
               inline_url,
               document_name,
               document_url
        FROM lines
      ) line
    ), '[]'::json),
    'fields', COALESCE((
      SELECT json_agg(row_to_json(field))
      FROM (
        SELECT m.position_observation_id::text,
               fv.field_code,
               fv.raw_value,
               fv.value_state::text,
               fv.scale_state::text,
               fv.source_column_label,
               fv.date_precision,
               fv.normalized_year,
               fv.normalized_month,
               fv.normalized_date
        FROM linked m
        JOIN LATERAL (
          SELECT field_code, raw_value, value_state, scale_state, source_column_label,
                 date_precision, normalized_year, normalized_month, normalized_date
          FROM obs.position_field_value fv
          WHERE fv.position_observation_id = m.position_observation_id
            AND fv.field_code IN (
              'PRINCIPAL_AMOUNT', 'COST', 'FAIR_VALUE', 'INTEREST_RATE', 'SPREAD', 'PERCENT_OF_NET_ASSETS',
              'INSTRUMENT_TYPE', 'INDUSTRY', 'GEOGRAPHY', 'ACQUISITION_DATE', 'ISSUER_AFFILIATION', 'MATURITY_DATE'
            )
            AND NOT EXISTS (
              SELECT 1 FROM obs.position_field_value s WHERE s.supersedes_id = fv.id
            )
        ) fv ON true
      ) field
    ), '[]'::json),
    'names', COALESCE((
      SELECT json_agg(row_to_json(name))
      FROM (
        SELECT DISTINCT ri.registrant_cik, n.name_raw
        FROM (
          SELECT DISTINCT r.id AS registrant_id, lpad(r.cik::text, 10, '0') AS registrant_cik
          FROM linked m
          JOIN registry.filing_registrant_link l ON l.filing_id = m.filing_id
          JOIN registry.registrant r ON r.id = l.registrant_id
          WHERE NOT EXISTS (
            SELECT 1 FROM registry.filing_registrant_link s WHERE s.supersedes_id = l.id
          )
        ) ri
        JOIN LATERAL (
          SELECT h.name_raw
          FROM registry.registrant_name_history_observation h
          JOIN evidence.evidence e ON e.id = h.evidence_id
          WHERE h.registrant_id = ri.registrant_id
            AND NOT EXISTS (
              SELECT 1 FROM registry.registrant_name_history_observation s WHERE s.supersedes_id = h.id
            )
        ) n ON true
      ) name
    ), '[]'::json),
    'instruments', COALESCE((
      SELECT json_agg(row_to_json(instrument))
      FROM (
        SELECT m.position_observation_id::text, d.state::text
        FROM linked m
        JOIN LATERAL (
          SELECT state
          FROM resolution.instrument_resolution_decision d
          WHERE d.position_observation_id = m.position_observation_id
            AND NOT EXISTS (
              SELECT 1 FROM resolution.instrument_resolution_decision s WHERE s.supersedes_id = d.id
            )
        ) d ON true
      ) instrument
    ), '[]'::json),
    'maturity', COALESCE((
      SELECT json_agg(row_to_json(maturity))
      FROM (
        SELECT position_observation_id::text,
               provenance_state AS maturity_source,
               maturity_raw
        FROM maturity_rows
      ) maturity
    ), '[]'::json),
    'entity_resolution_count', (SELECT count(*)::int FROM resolution.current_entity_resolution),
    'group_membership_count', (SELECT count(*)::int FROM resolution.current_group_membership)
  );
$$;

COMMENT ON FUNCTION registry.review_case_read(text) IS
  'One research case, read from its current members whose filing has one current registrant and one CIK. Filing form, filed date, inline URL, document, field values, and maturity are looked up for those positions only. A missing field stays absent. A calendar-day maturity stays REPORTED_STRUCTURED. A single MONTH field stays REPORTED_MONTH. A filing month stays FILING_MONTH. Both keep the raw month text and a null maturity date. This does not resolve a borrower or an instrument.';

REVOKE ALL ON FUNCTION registry.review_case_read(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION registry.review_case_read(text) TO bdc_reader;

SELECT ops.grant_layer_privileges();
