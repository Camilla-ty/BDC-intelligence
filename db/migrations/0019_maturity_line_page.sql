-- 0019 P17 maturity line page reads fifty lines directly.
-- Joining registry.portfolio_line expanded that view for the whole registrant.
-- Principal and filing attributes are read for the page of line ids only.

CREATE OR REPLACE FUNCTION registry.maturity_line_page(
  p_cik text, p_date date, p_kind text, p_year integer, p_limit integer, p_offset integer)
RETURNS TABLE (
  position_observation_id bigint,
  disclosed_line_text text,
  principal_state text,
  principal_raw text,
  principal_currency_state text,
  maturity_state text,
  maturity_raw text,
  maturity_year integer,
  accession_number text,
  evidence_level text,
  form_state text,
  form_raw text,
  filed_date_state text,
  filed_date_raw text,
  inline_url_state text,
  inline_url text,
  document_url text,
  release_state text,
  release_label text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, registry, obs
AS $$
  SELECT page.position_observation_id,
         p.holding_descriptor_raw,
         principal.principal_state,
         principal.principal_raw,
         'UNKNOWN'::text,
         page.maturity_state,
         page.maturity_raw,
         CASE WHEN page.maturity_state = 'REPORTED'
              THEN extract(YEAR FROM page.maturity_date)::integer END,
         f.accession_number,
         e.evidence_level::text,
         form.form_state,
         form.form_raw,
         filed.filed_date_state,
         filed.filed_date_raw,
         inline_url.inline_url_state,
         inline_url.inline_url,
         doc.document_url,
         rel.release_state,
         rel.release_label
  FROM (
    SELECT s.position_observation_id, s.maturity_state, s.maturity_raw, s.maturity_date
    FROM registry.maturity_position_for_cik(p_cik) s
    WHERE s.reported_date = p_date
      AND p_kind IN ('all', 'unknown', 'multiple', 'year')
      AND (
        p_kind = 'all'
        OR (p_kind = 'unknown' AND s.maturity_state = 'UNKNOWN')
        OR (p_kind = 'multiple' AND s.maturity_state = 'MULTIPLE_VALUES')
        OR (p_kind = 'year' AND p_year BETWEEN 0 AND 9999
            AND s.maturity_state = 'REPORTED'
            AND extract(YEAR FROM s.maturity_date)::integer = p_year)
      )
    ORDER BY s.position_observation_id
    LIMIT CASE WHEN p_limit BETWEEN 1 AND 50 THEN p_limit ELSE 0 END
    OFFSET CASE WHEN p_offset BETWEEN 0 AND 1000000 THEN p_offset ELSE 0 END
  ) page
  JOIN obs.position_observation p ON p.id = page.position_observation_id
  JOIN registry.filing f ON f.id = p.filing_id
  JOIN evidence.evidence e ON e.id = p.evidence_id
  LEFT JOIN LATERAL (
    SELECT
      CASE WHEN count(DISTINCT fv.raw_value) = 1 THEN 'REPORTED'
           WHEN count(*) = 0 THEN 'UNKNOWN'
           ELSE 'MULTIPLE_VALUES' END AS principal_state,
      CASE WHEN count(DISTINCT fv.raw_value) = 1 THEN min(fv.raw_value) END AS principal_raw
    FROM obs.current_position_field_value fv
    WHERE fv.position_observation_id = p.id AND fv.field_code = 'PRINCIPAL_AMOUNT'
  ) principal ON true
  LEFT JOIN LATERAL (
    SELECT
      CASE WHEN count(DISTINCT fa.normalized_text) = 1 THEN 'REPORTED'
           WHEN count(*) = 0 THEN 'UNKNOWN'
           ELSE 'MULTIPLE_VALUES' END AS form_state,
      CASE WHEN count(DISTINCT fa.normalized_text) = 1 THEN min(fa.normalized_text) END AS form_raw
    FROM registry.current_filing_attribute fa
    WHERE fa.filing_id = p.filing_id AND fa.attribute_code = 'FORM' AND fa.value_state = 'REPORTED'
  ) form ON true
  LEFT JOIN LATERAL (
    SELECT
      CASE WHEN count(DISTINCT fa.normalized_date) = 1 THEN 'REPORTED'
           WHEN count(*) = 0 THEN 'UNKNOWN'
           ELSE 'MULTIPLE_VALUES' END AS filed_date_state,
      CASE WHEN count(DISTINCT fa.normalized_date) = 1 THEN min(fa.normalized_date)::text END AS filed_date_raw
    FROM registry.current_filing_attribute fa
    WHERE fa.filing_id = p.filing_id AND fa.attribute_code = 'FILED_DATE' AND fa.value_state = 'REPORTED'
  ) filed ON true
  LEFT JOIN LATERAL (
    SELECT
      CASE WHEN count(DISTINCT fa.raw_value) = 1
            AND min(fa.raw_value) ~ '^https://www\.sec\.gov/(Archives/edgar/data/|ix\?doc=/Archives/edgar/data/)'
           THEN 'REPORTED'
           WHEN count(*) = 0 THEN 'UNKNOWN'
           ELSE 'MULTIPLE_VALUES' END AS inline_url_state,
      CASE WHEN count(DISTINCT fa.raw_value) = 1
            AND min(fa.raw_value) ~ '^https://www\.sec\.gov/(Archives/edgar/data/|ix\?doc=/Archives/edgar/data/)'
           THEN min(fa.raw_value) END AS inline_url
    FROM registry.current_filing_attribute fa
    WHERE fa.filing_id = p.filing_id AND fa.attribute_code = 'INLINE_URL' AND fa.value_state = 'REPORTED'
  ) inline_url ON true
  LEFT JOIN LATERAL (
    SELECT filing_document.document_url
    FROM registry.filing_document
    WHERE filing_document.filing_id = p.filing_id
      AND filing_document.document_url ~ '^https://www\.sec\.gov/Archives/edgar/data/'
    ORDER BY CASE WHEN filing_document.named_by = 'SUBMISSIONS_PRIMARY_DOCUMENT' THEN 0 ELSE 1 END, filing_document.id
    LIMIT 1
  ) doc ON true
  LEFT JOIN LATERAL (
    SELECT
      CASE WHEN count(DISTINCT dr.release_label) = 1 THEN 'REPORTED'
           WHEN count(*) = 0 THEN 'UNKNOWN'
           ELSE 'MULTIPLE_VALUES' END AS release_state,
      CASE WHEN count(DISTINCT dr.release_label) = 1 THEN min(dr.release_label) END AS release_label
    FROM obs.soi_row_observation o
    JOIN raw.tabular_row tr ON tr.id = o.tabular_row_id
    JOIN raw.table_load tl ON tl.id = tr.table_load_id
    JOIN registry.dataset_release_artifact dra ON dra.artifact_id = tl.artifact_id
    JOIN registry.dataset_release dr ON dr.id = dra.dataset_release_id
    WHERE o.id = p.origin_soi_row_observation_id
  ) rel ON true
  ORDER BY page.position_observation_id
$$;

REVOKE ALL ON FUNCTION registry.maturity_line_page(text, date, text, integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION registry.maturity_line_page(text, date, text, integer, integer, integer) TO bdc_reader;

SELECT ops.grant_layer_privileges();
