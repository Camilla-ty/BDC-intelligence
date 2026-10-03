-- 0027 portfolio detail for one CIK.
-- The directory views in 0016 stay as they are. Those views aggregate every position
-- before a CIK predicate can limit the scan, so the detail reader calls these functions
-- instead. Empty periods stay on registry.portfolio_empty_period.
-- No index is added. No stored row is written.

CREATE FUNCTION registry.portfolio_detail_filing(p_cik text)
RETURNS TABLE (filing_id bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, registry, obs
AS $$
  WITH reg AS (
    SELECT r.id
    FROM registry.registrant r
    WHERE r.cik = CASE WHEN p_cik ~ '^[0-9]{10}$' THEN p_cik::bigint END
  ),
  touched AS (
    SELECT DISTINCT l.filing_id
    FROM registry.filing_registrant_link l
    JOIN reg ON reg.id = l.registrant_id
    WHERE NOT EXISTS (
      SELECT 1 FROM registry.filing_registrant_link s WHERE s.supersedes_id = l.id
    )
  ),
  heads AS (
    SELECT l.filing_id, l.registrant_id, rr.cik
    FROM registry.filing_registrant_link l
    JOIN touched t ON t.filing_id = l.filing_id
    JOIN registry.registrant rr ON rr.id = l.registrant_id
    WHERE NOT EXISTS (
      SELECT 1 FROM registry.filing_registrant_link s WHERE s.supersedes_id = l.id
    )
  )
  SELECT h.filing_id
  FROM heads h
  GROUP BY h.filing_id
  HAVING count(DISTINCT h.registrant_id) = 1
     AND count(DISTINCT h.cik) = 1;
$$;

COMMENT ON FUNCTION registry.portfolio_detail_filing(text) IS
  'Current filing heads for one CIK. A filing stays only when every current link names that one registrant and one CIK.';

CREATE FUNCTION registry.portfolio_detail_registrant(p_cik text)
RETURNS TABLE (
  registrant_cik text,
  name_state text,
  name_raw text,
  ticker_state text,
  ticker_raw text,
  file_number_state text,
  file_number_raw text,
  reported_date_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, registry, obs
AS $$
  WITH reg AS (
    SELECT r.id, lpad(r.cik::text, 10, '0') AS registrant_cik
    FROM registry.registrant r
    WHERE r.cik = CASE WHEN p_cik ~ '^[0-9]{10}$' THEN p_cik::bigint END
  ),
  attrs AS (
    SELECT a.attribute_code,
           CASE WHEN count(c.observation_id) = 0 THEN 'UNKNOWN'
                WHEN count(DISTINCT c.raw_value) > 1 THEN 'MULTIPLE_VALUES'
                ELSE 'REPORTED' END AS attribute_state,
           min(c.raw_value) AS raw_value
    FROM reg
    CROSS JOIN (VALUES ('NAME'::text), ('TICKER'::text), ('FILE_NUMBER'::text)) AS a(attribute_code)
    LEFT JOIN registry.current_registrant_attribute c
      ON c.registrant_id = reg.id AND c.attribute_code = a.attribute_code
    GROUP BY a.attribute_code
  )
  SELECT reg.registrant_cik,
         n.attribute_state,
         CASE WHEN n.attribute_state = 'REPORTED' THEN n.raw_value END,
         t.attribute_state,
         CASE WHEN t.attribute_state = 'REPORTED' THEN t.raw_value END,
         f.attribute_state,
         CASE WHEN f.attribute_state = 'REPORTED' THEN f.raw_value END,
         (SELECT count(DISTINCT p.reported_date)::integer
          FROM obs.position_observation p
          WHERE p.filing_id IN (SELECT e.filing_id FROM registry.portfolio_detail_filing(p_cik) e))
  FROM reg
  JOIN attrs n ON n.attribute_code = 'NAME'
  JOIN attrs t ON t.attribute_code = 'TICKER'
  JOIN attrs f ON f.attribute_code = 'FILE_NUMBER'
  WHERE EXISTS (
    SELECT 1
    FROM obs.position_observation p
    WHERE p.filing_id IN (SELECT e.filing_id FROM registry.portfolio_detail_filing(p_cik) e)
  );
$$;

COMMENT ON FUNCTION registry.portfolio_detail_registrant(text) IS
  'One portfolio registrant for a CIK that has position observations. A name, ticker, or file number is present only when current sources agree.';

CREATE FUNCTION registry.portfolio_detail_names(p_cik text)
RETURNS TABLE (
  source_type_code text,
  raw_value text,
  documentation_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, registry, obs
AS $$
  SELECT a.source_type_code,
         a.raw_value,
         a.documentation_status::text
  FROM registry.current_registrant_attribute a
  JOIN registry.registrant r ON r.id = a.registrant_id
  WHERE r.cik = CASE WHEN p_cik ~ '^[0-9]{10}$' THEN p_cik::bigint END
    AND a.attribute_code = 'NAME'
    AND EXISTS (
      SELECT 1 FROM registry.portfolio_detail_registrant(p_cik)
    );
$$;

COMMENT ON FUNCTION registry.portfolio_detail_names(text) IS
  'Each current registrant-name source for a portfolio registrant, unmerged.';

CREATE FUNCTION registry.portfolio_detail_dates(p_cik text)
RETURNS TABLE (
  reported_date date,
  disclosed_line_count integer,
  point_in_time_line_count integer,
  duration_line_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, registry, obs
AS $$
  SELECT p.reported_date,
         count(*)::integer,
         count(*) FILTER (WHERE p.duration_kind = 'POINT_IN_TIME')::integer,
         count(*) FILTER (WHERE p.duration_kind = 'DURATION')::integer
  FROM obs.position_observation p
  WHERE p.reported_date IS NOT NULL
    AND p.filing_id IN (SELECT e.filing_id FROM registry.portfolio_detail_filing(p_cik) e)
  GROUP BY p.reported_date;
$$;

COMMENT ON FUNCTION registry.portfolio_detail_dates(text) IS
  'Disclosed-line counts for one registrant by reported date. A date that is absent was not observed. Counts are rows, not amounts.';

REVOKE ALL ON FUNCTION registry.portfolio_detail_filing(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION registry.portfolio_detail_registrant(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION registry.portfolio_detail_names(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION registry.portfolio_detail_dates(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION registry.portfolio_detail_registrant(text) TO bdc_reader;
GRANT EXECUTE ON FUNCTION registry.portfolio_detail_names(text) TO bdc_reader;
GRANT EXECUTE ON FUNCTION registry.portfolio_detail_dates(text) TO bdc_reader;

SELECT ops.grant_layer_privileges();
