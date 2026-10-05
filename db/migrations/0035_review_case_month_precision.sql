-- 0035 review-case month precision.
-- A MATURITY_DATE stored as MONTH has a null normalized_date. Counting distinct
-- calendar days treated that row as unresolved. A single valid month stays
-- REPORTED and keeps its raw month text. A calendar day stays on the existing
-- REPORTED_STRUCTURED path. This does not invent a day and does not change
-- obs.maturity_provenance or registry.maturity_read.

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
           b.provenance_state,
           CASE b.provenance_state
             WHEN 'REPORTED_STRUCTURED' THEN b.structured_raw
             WHEN 'REPORTED' THEN b.structured_raw
             WHEN 'FILING_DISPLAYED' THEN b.displayed_raw
             ELSE NULL
           END AS maturity_raw
    FROM linked m
    LEFT JOIN obs.maturity_inspection i
      ON i.position_observation_id = m.position_observation_id
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
             min(fv.raw_value) AS raw_value
      FROM obs.position_field_value fv
      WHERE fv.position_observation_id = m.position_observation_id
        AND fv.field_code = 'MATURITY_DATE'
        AND fv.value_state = 'REPORTED'
        AND NOT EXISTS (
          SELECT 1 FROM obs.position_field_value s WHERE s.supersedes_id = fv.id
        )
    ) structured ON true
    CROSS JOIN LATERAL (
      SELECT CASE
               WHEN structured.n = 1 AND structured.distinct_dates = 1 AND (
                 i.id IS NULL
                 OR i.inspection_state IN ('NOT_BOUND', 'UNAVAILABLE')
                 OR (i.inspection_state = 'FILING_DISPLAYED' AND i.normalized_date = structured.maturity_date)
               ) THEN 'REPORTED_STRUCTURED'
               WHEN structured.n = 1
                AND structured.distinct_dates = 0
                AND structured.month_rows = 1
                AND (
                  i.id IS NULL
                  OR i.inspection_state IN ('NOT_BOUND', 'UNAVAILABLE')
                ) THEN 'REPORTED'
               WHEN structured.n = 0 AND (
                 i.id IS NULL OR i.inspection_state IN ('NOT_BOUND', 'UNAVAILABLE')
               ) THEN 'UNKNOWN'
               WHEN structured.n = 0 AND i.inspection_state = 'FILING_DISPLAYED'
                 THEN 'FILING_DISPLAYED'
               ELSE 'UNRESOLVED'
             END AS provenance_state,
             structured.raw_value AS structured_raw,
             i.raw_value AS displayed_raw
    ) b
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
  'One research case, read from its current members whose filing has one current registrant and one CIK. Filing form, filed date, inline URL, document, field values, and maturity are looked up for those positions only. A missing field stays absent. A calendar-day maturity stays REPORTED_STRUCTURED. A single MONTH maturity stays REPORTED, with its raw month text and a null normalized_date. This does not resolve a borrower or an instrument.';

REVOKE ALL ON FUNCTION registry.review_case_read(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION registry.review_case_read(text) TO bdc_reader;

SELECT ops.grant_layer_privileges();
