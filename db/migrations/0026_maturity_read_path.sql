-- 0026 maturity read path: the maturity wall and the portfolio listing read the product
-- maturity from obs.maturity_provenance (0025) through one registry contract,
-- registry.maturity_read (G-01, G-04, G-11, G-12). MATURITY_DATE, the inspection rows, and
-- the provenance rule are unchanged. Superseded inspections are never read.
--
-- A line is dated only when provenance supplies maturity_date (maturity_source
-- REPORTED_STRUCTURED or FILING_DISPLAYED). UNKNOWN and UNRESOLVED lines carry no date and
-- no year. maturity_source keeps the provenance vocabulary; it is not re-derived here.
-- registry.market_date_registrant still counts structured MATURITY_DATE cells: that is
-- data-set cell coverage, not the product maturity.

DROP FUNCTION registry.maturity_line_page(text, date, text, integer, integer, integer);
DROP FUNCTION registry.maturity_line_count(text, date, text, integer);
DROP FUNCTION registry.maturity_years(text);
DROP FUNCTION registry.maturity_coverage(text);
DROP FUNCTION registry.maturity_position_for_cik(text);
DROP VIEW registry.maturity_line;
DROP VIEW registry.maturity_year;
DROP VIEW registry.maturity_reported_date;
DROP VIEW registry.maturity_position;
DROP VIEW registry.portfolio_line;

CREATE VIEW registry.maturity_read AS
SELECT mp.position_observation_id,
       mp.maturity_date,
       mp.maturity_raw,
       mp.provenance_state::text AS maturity_source,
       mp.inspection_state::text AS inspection_state,
       mp.no_bind_reason::text AS no_bind_reason,
       mp.filing_verified,
       doc.document_url AS maturity_document_url
FROM obs.maturity_provenance mp
JOIN obs.position_observation p ON p.id = mp.position_observation_id
LEFT JOIN LATERAL (
  SELECT CASE WHEN count(DISTINCT fd.document_url) = 1 THEN min(fd.document_url) END AS document_url
  FROM evidence.evidence e
  JOIN registry.filing_document_artifact fda ON fda.artifact_id = e.artifact_id
  JOIN registry.filing_document fd ON fd.id = fda.filing_document_id AND fd.filing_id = p.filing_id
  WHERE e.id = mp.evidence_id
    AND (mp.provenance_state = 'FILING_DISPLAYED' OR mp.filing_verified)
) doc ON true;
COMMENT ON VIEW registry.maturity_read IS
  'The product maturity of one disclosed line, read from obs.maturity_provenance. maturity_date is NULL unless maturity_source is REPORTED_STRUCTURED or FILING_DISPLAYED.';
COMMENT ON COLUMN registry.maturity_read.maturity_source IS
  'obs.maturity_provenance.provenance_state: REPORTED_STRUCTURED, FILING_DISPLAYED, UNKNOWN, or UNRESOLVED.';
COMMENT ON COLUMN registry.maturity_read.maturity_raw IS
  'The maturity exactly as disclosed by the source named in maturity_source.';
COMMENT ON COLUMN registry.maturity_read.maturity_document_url IS
  'The EDGAR document of the current filing inspection, when that inspection supplies or confirms the maturity.';

CREATE VIEW registry.maturity_position AS
SELECT p.id AS position_observation_id,
       fr.registrant_cik,
       p.reported_date,
       mr.maturity_date,
       mr.maturity_raw,
       mr.maturity_source,
       mr.inspection_state,
       mr.no_bind_reason,
       mr.filing_verified,
       mr.maturity_document_url
FROM obs.position_observation p
JOIN registry.portfolio_filing_registrant fr
  ON fr.filing_id = p.filing_id AND fr.registrant_link_status = 'LINKED'
JOIN registry.maturity_read mr ON mr.position_observation_id = p.id;
COMMENT ON VIEW registry.maturity_position IS
  'One disclosed line of a linked registrant and its product maturity from registry.maturity_read. A line with no maturity_date is not a year and not zero.';

CREATE VIEW registry.maturity_reported_date AS
SELECT registrant_cik,
       reported_date,
       count(*)::integer AS disclosed_line_count,
       count(*) FILTER (WHERE maturity_date IS NOT NULL)::integer AS maturity_reported_count,
       count(*) FILTER (WHERE maturity_source = 'REPORTED_STRUCTURED')::integer AS maturity_structured_count,
       count(*) FILTER (WHERE maturity_source = 'FILING_DISPLAYED')::integer AS maturity_filing_count,
       count(*) FILTER (WHERE maturity_source = 'UNKNOWN')::integer AS maturity_unknown_count,
       count(*) FILTER (WHERE maturity_source = 'UNRESOLVED')::integer AS maturity_unresolved_count
FROM registry.maturity_position
GROUP BY registrant_cik, reported_date;
COMMENT ON VIEW registry.maturity_reported_date IS
  'Disclosed-line counts by registrant and reported date. maturity_reported_count is structured plus filing-displayed lines. Unknown and unresolved maturity are row counts, not zero maturity.';

CREATE VIEW registry.maturity_year AS
SELECT registrant_cik,
       reported_date,
       extract(YEAR FROM maturity_date)::integer AS maturity_year,
       count(*)::integer AS disclosed_line_count
FROM registry.maturity_position
WHERE maturity_date IS NOT NULL
GROUP BY registrant_cik, reported_date, extract(YEAR FROM maturity_date);
COMMENT ON VIEW registry.maturity_year IS
  'Disclosed lines with one product maturity date, counted by the year of that date. Unknown and unresolved maturity are omitted here and kept on maturity_reported_date.';

CREATE VIEW registry.portfolio_line AS
SELECT p.id AS position_observation_id,
       fr.registrant_cik,
       p.reported_date,
       p.duration_kind::text AS duration_kind,
       o.qtrs,
       coalesce(cl.period_role::text, 'UNKNOWN') AS period_role,
       p.holding_descriptor_raw AS disclosed_line_text,
       f.accession_number,
       e.evidence_level::text AS evidence_level,
       attrs.principal_state,
       attrs.principal_raw,
       'UNKNOWN'::text AS principal_currency_state,
       mr.maturity_source,
       mr.maturity_raw,
       mr.maturity_date,
       mr.inspection_state AS maturity_inspection_state,
       mr.no_bind_reason AS maturity_no_bind_reason,
       mr.filing_verified AS maturity_filing_verified,
       mr.maturity_document_url,
       attrs.instrument_type_state,
       attrs.instrument_type_raw,
       attrs.industry_state,
       attrs.industry_raw,
       attrs.affiliation_state,
       attrs.affiliation_raw,
       attrs.geography_state,
       attrs.geography_raw,
       attrs.acquisition_date_state,
       attrs.acquisition_date_raw,
       attrs.restricted_state,
       attrs.restricted_raw,
       attrs.reference_uri_state,
       attrs.reference_uri_raw,
       form.form_state,
       form.form_raw,
       filed.filed_date_state,
       filed.filed_date_raw,
       inline_url.inline_url_state,
       inline_url.inline_url,
       doc.document_name,
       doc.document_url,
       rel.release_state,
       rel.release_label
FROM obs.position_observation p
JOIN obs.soi_row_observation o ON o.id = p.origin_soi_row_observation_id
JOIN registry.filing f ON f.id = p.filing_id
JOIN evidence.evidence e ON e.id = p.evidence_id
JOIN registry.portfolio_filing_registrant fr
  ON fr.filing_id = p.filing_id AND fr.registrant_link_status = 'LINKED'
JOIN registry.maturity_read mr ON mr.position_observation_id = p.id
LEFT JOIN obs.current_soi_row_classification cl ON cl.soi_row_observation_id = o.id
LEFT JOIN LATERAL (
  SELECT
    CASE WHEN count(DISTINCT fv.raw_value) FILTER (WHERE fv.field_code = 'PRINCIPAL_AMOUNT') = 1 THEN 'REPORTED'
         WHEN count(*) FILTER (WHERE fv.field_code = 'PRINCIPAL_AMOUNT') = 0 THEN 'UNKNOWN'
         ELSE 'MULTIPLE_VALUES' END AS principal_state,
    CASE WHEN count(DISTINCT fv.raw_value) FILTER (WHERE fv.field_code = 'PRINCIPAL_AMOUNT') = 1
         THEN min(fv.raw_value) FILTER (WHERE fv.field_code = 'PRINCIPAL_AMOUNT') END AS principal_raw,
    CASE WHEN count(DISTINCT fv.raw_value) FILTER (WHERE fv.field_code = 'INSTRUMENT_TYPE') = 1 THEN 'REPORTED'
         WHEN count(*) FILTER (WHERE fv.field_code = 'INSTRUMENT_TYPE') = 0 THEN 'UNKNOWN'
         ELSE 'MULTIPLE_VALUES' END AS instrument_type_state,
    CASE WHEN count(DISTINCT fv.raw_value) FILTER (WHERE fv.field_code = 'INSTRUMENT_TYPE') = 1
         THEN min(fv.raw_value) FILTER (WHERE fv.field_code = 'INSTRUMENT_TYPE') END AS instrument_type_raw,
    CASE WHEN count(DISTINCT fv.raw_value) FILTER (WHERE fv.field_code = 'INDUSTRY') = 1 THEN 'REPORTED'
         WHEN count(*) FILTER (WHERE fv.field_code = 'INDUSTRY') = 0 THEN 'UNKNOWN'
         ELSE 'MULTIPLE_VALUES' END AS industry_state,
    CASE WHEN count(DISTINCT fv.raw_value) FILTER (WHERE fv.field_code = 'INDUSTRY') = 1
         THEN min(fv.raw_value) FILTER (WHERE fv.field_code = 'INDUSTRY') END AS industry_raw,
    CASE WHEN count(DISTINCT fv.raw_value) FILTER (WHERE fv.field_code = 'ISSUER_AFFILIATION') = 1 THEN 'REPORTED'
         WHEN count(*) FILTER (WHERE fv.field_code = 'ISSUER_AFFILIATION') = 0 THEN 'UNKNOWN'
         ELSE 'MULTIPLE_VALUES' END AS affiliation_state,
    CASE WHEN count(DISTINCT fv.raw_value) FILTER (WHERE fv.field_code = 'ISSUER_AFFILIATION') = 1
         THEN min(fv.raw_value) FILTER (WHERE fv.field_code = 'ISSUER_AFFILIATION') END AS affiliation_raw,
    CASE WHEN count(DISTINCT fv.raw_value) FILTER (WHERE fv.field_code = 'GEOGRAPHY') = 1 THEN 'REPORTED'
         WHEN count(*) FILTER (WHERE fv.field_code = 'GEOGRAPHY') = 0 THEN 'UNKNOWN'
         ELSE 'MULTIPLE_VALUES' END AS geography_state,
    CASE WHEN count(DISTINCT fv.raw_value) FILTER (WHERE fv.field_code = 'GEOGRAPHY') = 1
         THEN min(fv.raw_value) FILTER (WHERE fv.field_code = 'GEOGRAPHY') END AS geography_raw,
    CASE WHEN count(DISTINCT fv.raw_value) FILTER (WHERE fv.field_code = 'ACQUISITION_DATE') = 1 THEN 'REPORTED'
         WHEN count(*) FILTER (WHERE fv.field_code = 'ACQUISITION_DATE') = 0 THEN 'UNKNOWN'
         ELSE 'MULTIPLE_VALUES' END AS acquisition_date_state,
    CASE WHEN count(DISTINCT fv.raw_value) FILTER (WHERE fv.field_code = 'ACQUISITION_DATE') = 1
         THEN min(fv.raw_value) FILTER (WHERE fv.field_code = 'ACQUISITION_DATE') END AS acquisition_date_raw,
    CASE WHEN count(DISTINCT fv.raw_value) FILTER (WHERE fv.field_code = 'RESTRICTED') = 1 THEN 'REPORTED'
         WHEN count(*) FILTER (WHERE fv.field_code = 'RESTRICTED') = 0 THEN 'UNKNOWN'
         ELSE 'MULTIPLE_VALUES' END AS restricted_state,
    CASE WHEN count(DISTINCT fv.raw_value) FILTER (WHERE fv.field_code = 'RESTRICTED') = 1
         THEN min(fv.raw_value) FILTER (WHERE fv.field_code = 'RESTRICTED') END AS restricted_raw,
    CASE WHEN count(DISTINCT fv.raw_value) FILTER (WHERE fv.field_code = 'REFERENCE_RATE') = 1 THEN 'REPORTED'
         WHEN count(*) FILTER (WHERE fv.field_code = 'REFERENCE_RATE') = 0 THEN 'UNKNOWN'
         ELSE 'MULTIPLE_VALUES' END AS reference_uri_state,
    CASE WHEN count(DISTINCT fv.raw_value) FILTER (WHERE fv.field_code = 'REFERENCE_RATE') = 1
         THEN min(fv.raw_value) FILTER (WHERE fv.field_code = 'REFERENCE_RATE') END AS reference_uri_raw
  FROM obs.current_position_field_value fv
  WHERE fv.position_observation_id = p.id
    AND fv.field_code IN (
      'PRINCIPAL_AMOUNT', 'INSTRUMENT_TYPE', 'INDUSTRY',
      'ISSUER_AFFILIATION', 'GEOGRAPHY', 'ACQUISITION_DATE', 'RESTRICTED', 'REFERENCE_RATE')
) attrs ON true
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
  SELECT doc.document_name, doc.document_url
  FROM registry.filing_document doc
  WHERE doc.filing_id = p.filing_id
    AND doc.document_url ~ '^https://www\.sec\.gov/Archives/edgar/data/'
  ORDER BY CASE WHEN doc.named_by = 'SUBMISSIONS_PRIMARY_DOCUMENT' THEN 0 ELSE 1 END, doc.id
  LIMIT 1
) doc ON true
LEFT JOIN LATERAL (
  SELECT
    CASE WHEN count(DISTINCT dr.release_label) = 1 THEN 'REPORTED'
         WHEN count(*) = 0 THEN 'UNKNOWN'
         ELSE 'MULTIPLE_VALUES' END AS release_state,
    CASE WHEN count(DISTINCT dr.release_label) = 1 THEN min(dr.release_label) END AS release_label
  FROM raw.tabular_row tr
  JOIN raw.table_load tl ON tl.id = tr.table_load_id
  JOIN registry.dataset_release_artifact dra ON dra.artifact_id = tl.artifact_id
  JOIN registry.dataset_release dr ON dr.id = dra.dataset_release_id
  WHERE tr.id = o.tabular_row_id
) rel ON true;
COMMENT ON VIEW registry.portfolio_line IS
  'One disclosed SOI position line. Maturity is the product maturity from registry.maturity_read. Principal currency is UNKNOWN. Cost, fair value, rates, and spreads are omitted. period_role stays the stored classification.';

CREATE VIEW registry.maturity_line AS
SELECT mp.position_observation_id,
       mp.registrant_cik,
       mp.reported_date,
       pl.disclosed_line_text,
       pl.principal_state,
       pl.principal_raw,
       pl.principal_currency_state,
       mp.maturity_source,
       mp.maturity_raw,
       mp.maturity_date,
       extract(YEAR FROM mp.maturity_date)::integer AS maturity_year,
       mp.filing_verified,
       mp.maturity_document_url,
       pl.accession_number,
       pl.evidence_level,
       pl.form_state,
       pl.form_raw,
       pl.filed_date_state,
       pl.filed_date_raw,
       pl.inline_url_state,
       pl.inline_url,
       pl.document_name,
       pl.document_url,
       pl.release_state,
       pl.release_label
FROM registry.maturity_position mp
JOIN registry.portfolio_line pl ON pl.position_observation_id = mp.position_observation_id;
COMMENT ON VIEW registry.maturity_line IS
  'One disclosed line for the maturity wall: product maturity and its source, principal, and SEC filing attributes. Principal currency stays UNKNOWN.';

CREATE FUNCTION registry.maturity_position_for_cik(p_cik text)
RETURNS TABLE (
  position_observation_id bigint,
  reported_date date,
  maturity_date date,
  maturity_raw text,
  maturity_source text,
  inspection_state text,
  no_bind_reason text,
  filing_verified boolean,
  maturity_document_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, registry, obs
AS $$
  SELECT mp.position_observation_id,
         mp.reported_date,
         mp.maturity_date,
         mp.maturity_raw,
         mp.maturity_source,
         mp.inspection_state,
         mp.no_bind_reason,
         mp.filing_verified,
         mp.maturity_document_url
  FROM registry.maturity_position mp
  WHERE mp.registrant_cik = p_cik
    AND p_cik ~ '^[0-9]{10}$'
$$;

CREATE FUNCTION registry.maturity_coverage(p_cik text)
RETURNS TABLE (
  reported_date date,
  disclosed_line_count integer,
  maturity_reported_count integer,
  maturity_structured_count integer,
  maturity_filing_count integer,
  maturity_unknown_count integer,
  maturity_unresolved_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, registry, obs
AS $$
  SELECT s.reported_date,
         count(*)::integer,
         count(*) FILTER (WHERE s.maturity_date IS NOT NULL)::integer,
         count(*) FILTER (WHERE s.maturity_source = 'REPORTED_STRUCTURED')::integer,
         count(*) FILTER (WHERE s.maturity_source = 'FILING_DISPLAYED')::integer,
         count(*) FILTER (WHERE s.maturity_source = 'UNKNOWN')::integer,
         count(*) FILTER (WHERE s.maturity_source = 'UNRESOLVED')::integer
  FROM registry.maturity_position_for_cik(p_cik) s
  GROUP BY s.reported_date
$$;

CREATE FUNCTION registry.maturity_years(p_cik text)
RETURNS TABLE (
  reported_date date,
  maturity_year integer,
  disclosed_line_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, registry, obs
AS $$
  SELECT s.reported_date,
         extract(YEAR FROM s.maturity_date)::integer,
         count(*)::integer
  FROM registry.maturity_position_for_cik(p_cik) s
  WHERE s.maturity_date IS NOT NULL
  GROUP BY s.reported_date, extract(YEAR FROM s.maturity_date)
$$;

CREATE FUNCTION registry.maturity_line_count(p_cik text, p_date date, p_kind text, p_year integer)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, registry, obs
AS $$
  SELECT count(*)::integer
  FROM registry.maturity_position_for_cik(p_cik) s
  WHERE s.reported_date = p_date
    AND p_kind IN ('all', 'unknown', 'unresolved', 'year')
    AND (
      p_kind = 'all'
      OR (p_kind = 'unknown' AND s.maturity_source = 'UNKNOWN')
      OR (p_kind = 'unresolved' AND s.maturity_source = 'UNRESOLVED')
      OR (p_kind = 'year' AND p_year BETWEEN 0 AND 9999
          AND s.maturity_date IS NOT NULL
          AND extract(YEAR FROM s.maturity_date)::integer = p_year)
    )
$$;

CREATE FUNCTION registry.maturity_line_page(
  p_cik text, p_date date, p_kind text, p_year integer, p_limit integer, p_offset integer)
RETURNS TABLE (
  position_observation_id bigint,
  disclosed_line_text text,
  principal_state text,
  principal_raw text,
  principal_currency_state text,
  maturity_source text,
  maturity_raw text,
  maturity_year integer,
  maturity_inspection_state text,
  maturity_no_bind_reason text,
  maturity_filing_verified boolean,
  maturity_document_url text,
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
         page.maturity_source,
         page.maturity_raw,
         extract(YEAR FROM page.maturity_date)::integer,
         page.inspection_state,
         page.no_bind_reason,
         page.filing_verified,
         page.maturity_document_url,
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
    SELECT s.position_observation_id, s.maturity_source, s.maturity_raw, s.maturity_date,
           s.inspection_state, s.no_bind_reason, s.filing_verified, s.maturity_document_url
    FROM registry.maturity_position_for_cik(p_cik) s
    WHERE s.reported_date = p_date
      AND p_kind IN ('all', 'unknown', 'unresolved', 'year')
      AND (
        p_kind = 'all'
        OR (p_kind = 'unknown' AND s.maturity_source = 'UNKNOWN')
        OR (p_kind = 'unresolved' AND s.maturity_source = 'UNRESOLVED')
        OR (p_kind = 'year' AND p_year BETWEEN 0 AND 9999
            AND s.maturity_date IS NOT NULL
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

REVOKE ALL ON FUNCTION registry.maturity_position_for_cik(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION registry.maturity_coverage(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION registry.maturity_years(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION registry.maturity_line_count(text, date, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION registry.maturity_line_page(text, date, text, integer, integer, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION registry.maturity_coverage(text) TO bdc_reader;
GRANT EXECUTE ON FUNCTION registry.maturity_years(text) TO bdc_reader;
GRANT EXECUTE ON FUNCTION registry.maturity_line_count(text, date, text, integer) TO bdc_reader;
GRANT EXECUTE ON FUNCTION registry.maturity_line_page(text, date, text, integer, integer, integer) TO bdc_reader;

SELECT ops.grant_layer_privileges();
