-- 0018 P17 maturity reads for one registrant.
-- The maturity views classify every disclosed line. These functions apply the same
-- classification after the registrant filter, so one CIK does not aggregate the universe.
-- Counts are disclosed lines. There is no principal sum.

CREATE FUNCTION registry.maturity_position_for_cik(p_cik text)
RETURNS TABLE (
  position_observation_id bigint,
  reported_date date,
  maturity_state text,
  maturity_raw text,
  maturity_date date
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, registry, obs
AS $$
  SELECT p.id,
         p.reported_date,
         CASE
           WHEN count(fv.id) = 0 THEN 'UNKNOWN'
           WHEN count(DISTINCT fv.raw_value) > 1 OR count(DISTINCT fv.normalized_date) > 1 THEN 'MULTIPLE_VALUES'
           WHEN bool_and(fv.value_state = 'REPORTED') AND min(fv.normalized_date) IS NOT NULL THEN 'REPORTED'
           ELSE 'MULTIPLE_VALUES'
         END,
         CASE
           WHEN count(fv.id) = 1
            AND bool_and(fv.value_state = 'REPORTED')
            AND min(fv.normalized_date) IS NOT NULL
           THEN min(fv.raw_value)
         END,
         CASE
           WHEN count(DISTINCT fv.normalized_date) = 1
            AND count(DISTINCT fv.raw_value) = 1
            AND bool_and(fv.value_state = 'REPORTED')
           THEN min(fv.normalized_date)
         END
  FROM obs.position_observation p
  JOIN registry.portfolio_filing_registrant fr
    ON fr.filing_id = p.filing_id
   AND fr.registrant_link_status = 'LINKED'
   AND fr.registrant_cik = p_cik
  LEFT JOIN obs.current_position_field_value fv
    ON fv.position_observation_id = p.id AND fv.field_code = 'MATURITY_DATE'
  WHERE p_cik ~ '^[0-9]{10}$'
  GROUP BY p.id, p.reported_date
$$;

CREATE FUNCTION registry.maturity_coverage(p_cik text)
RETURNS TABLE (
  reported_date date,
  disclosed_line_count integer,
  maturity_reported_count integer,
  maturity_unknown_count integer,
  maturity_multiple_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, registry, obs
AS $$
  SELECT s.reported_date,
         count(*)::integer,
         count(*) FILTER (WHERE s.maturity_state = 'REPORTED')::integer,
         count(*) FILTER (WHERE s.maturity_state = 'UNKNOWN')::integer,
         count(*) FILTER (WHERE s.maturity_state = 'MULTIPLE_VALUES')::integer
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
  WHERE s.maturity_state = 'REPORTED' AND s.maturity_date IS NOT NULL
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
    AND p_kind IN ('all', 'unknown', 'multiple', 'year')
    AND (
      p_kind = 'all'
      OR (p_kind = 'unknown' AND s.maturity_state = 'UNKNOWN')
      OR (p_kind = 'multiple' AND s.maturity_state = 'MULTIPLE_VALUES')
      OR (p_kind = 'year' AND p_year BETWEEN 0 AND 9999
          AND s.maturity_state = 'REPORTED'
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
         pl.disclosed_line_text,
         pl.principal_state,
         pl.principal_raw,
         pl.principal_currency_state,
         page.maturity_state,
         page.maturity_raw,
         CASE WHEN page.maturity_state = 'REPORTED'
              THEN extract(YEAR FROM page.maturity_date)::integer END,
         pl.accession_number,
         pl.evidence_level,
         pl.form_state,
         pl.form_raw,
         pl.filed_date_state,
         pl.filed_date_raw,
         pl.inline_url_state,
         pl.inline_url,
         pl.document_url,
         pl.release_state,
         pl.release_label
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
  JOIN registry.portfolio_line pl ON pl.position_observation_id = page.position_observation_id
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
