-- 0020 P19 market coverage.
-- Read-only coverage inventory. A missing registrant, release, or cell stays unknown or
-- unavailable. Counts are disclosed lines or registrants observed. There is no market total.

CREATE VIEW registry.market_registrant_coverage AS
WITH positioned AS (
  SELECT DISTINCT fr.registrant_id
  FROM obs.position_observation p
  JOIN registry.portfolio_filing_registrant fr
    ON fr.filing_id = p.filing_id AND fr.registrant_link_status = 'LINKED'
),
covered AS (
  SELECT DISTINCT c.registrant_id
  FROM obs.current_soi_coverage c
  WHERE c.registrant_id IS NOT NULL
    AND c.coverage_state = 'COVERED'
)
SELECT r.id AS registrant_id,
       lpad(r.cik::text, 10, '0') AS registrant_cik,
       ns.attribute_state AS name_state,
       CASE WHEN ns.attribute_state = 'REPORTED' THEN nm.raw_value END AS name_raw,
       CASE
         WHEN p.registrant_id IS NOT NULL THEN 'STORED_LINES'
         WHEN c.registrant_id IS NOT NULL THEN 'COVERED_NO_IDENTIFIED_LINE'
         ELSE 'UNKNOWN'
       END AS coverage_state
FROM registry.registrant r
JOIN registry.registrant_attribute_status ns
  ON ns.registrant_id = r.id AND ns.attribute_code = 'NAME'
LEFT JOIN positioned p ON p.registrant_id = r.id
LEFT JOIN covered c ON c.registrant_id = r.id
LEFT JOIN LATERAL (
  SELECT min(a.raw_value) AS raw_value
  FROM registry.current_registrant_attribute a
  WHERE a.registrant_id = r.id AND a.attribute_code = 'NAME'
) nm ON ns.attribute_state = 'REPORTED';
COMMENT ON VIEW registry.market_registrant_coverage IS
  'One registry registrant and its SOI coverage state. UNKNOWN has no assertion and no position. COVERED_NO_IDENTIFIED_LINE has a covered filing and no identified line. Neither state is zero exposure.';

CREATE VIEW registry.market_release_coverage AS
WITH observed AS (
  SELECT dr.id AS dataset_release_id,
         count(DISTINCT fr.registrant_cik)::integer AS registrants_observed,
         count(DISTINCT p.reported_date)::integer AS reported_dates_observed
  FROM obs.position_observation p
  JOIN registry.portfolio_filing_registrant fr
    ON fr.filing_id = p.filing_id AND fr.registrant_link_status = 'LINKED'
  JOIN obs.soi_row_observation o ON o.id = p.origin_soi_row_observation_id
  JOIN raw.tabular_row tr ON tr.id = o.tabular_row_id
  JOIN raw.table_load tl ON tl.id = tr.table_load_id
  JOIN registry.dataset_release_artifact dra ON dra.artifact_id = tl.artifact_id
  JOIN registry.dataset_release dr ON dr.id = dra.dataset_release_id
  GROUP BY dr.id
),
release_assertion AS (
  SELECT c.dataset_release_id,
         CASE
           WHEN bool_or(c.coverage_state = 'EMPTY_PERIOD') THEN 'EMPTY_PERIOD'
           WHEN bool_or(c.coverage_state = 'COVERED') THEN 'COVERED'
           ELSE 'UNKNOWN'
         END AS assertion_state
  FROM obs.current_soi_coverage c
  WHERE c.registrant_id IS NULL
    AND c.dataset_release_id IS NOT NULL
  GROUP BY c.dataset_release_id
)
SELECT dr.release_label,
       CASE
         WHEN ra.assertion_state = 'EMPTY_PERIOD' THEN 'UNAVAILABLE'
         WHEN o.dataset_release_id IS NOT NULL THEN 'OBSERVED'
         WHEN ra.assertion_state = 'COVERED' THEN 'COVERED_NO_IDENTIFIED_LINE'
         ELSE 'UNKNOWN'
       END AS coverage_state,
       CASE
         WHEN ra.assertion_state = 'EMPTY_PERIOD' OR o.dataset_release_id IS NULL THEN NULL
         ELSE o.registrants_observed
       END AS registrants_observed,
       CASE
         WHEN ra.assertion_state = 'EMPTY_PERIOD' OR o.dataset_release_id IS NULL THEN NULL
         ELSE o.reported_dates_observed
       END AS reported_dates_observed
FROM registry.dataset_release dr
LEFT JOIN observed o ON o.dataset_release_id = dr.id
LEFT JOIN release_assertion ra ON ra.dataset_release_id = dr.id;
COMMENT ON VIEW registry.market_release_coverage IS
  'Registrants and reported dates observed in one release. An empty period is UNAVAILABLE and its counts are null. A release with no assertion and no positions is UNKNOWN. Counts are not a market size.';

CREATE VIEW registry.market_reported_date AS
SELECT p.reported_date,
       count(DISTINCT fr.registrant_cik)::integer AS registrants_observed
FROM obs.position_observation p
JOIN registry.portfolio_filing_registrant fr
  ON fr.filing_id = p.filing_id AND fr.registrant_link_status = 'LINKED'
WHERE p.reported_date IS NOT NULL
GROUP BY p.reported_date;
COMMENT ON VIEW registry.market_reported_date IS
  'Registrants observed on one reported date. A date that is absent was not observed. The count is co-presence, not a sum of lines or exposure.';

CREATE FUNCTION registry.market_date_registrant(p_date date)
RETURNS TABLE (
  registrant_cik text,
  name_state text,
  name_raw text,
  disclosed_line_count integer,
  maturity_cell_line_count integer,
  maturity_unknown_line_count integer,
  principal_cell_line_count integer,
  principal_unknown_line_count integer,
  basis_cell_line_count integer,
  basis_unknown_line_count integer,
  initial_cell_line_count integer,
  initial_unknown_line_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, registry, obs
AS $$
  WITH lines AS (
    SELECT p.id, fr.registrant_id, fr.registrant_cik
    FROM obs.position_observation p
    JOIN registry.portfolio_filing_registrant fr
      ON fr.filing_id = p.filing_id AND fr.registrant_link_status = 'LINKED'
    WHERE p.reported_date = p_date
  ),
  cells AS (
    SELECT fv.position_observation_id,
           bool_or(fv.field_code = 'MATURITY_DATE') AS maturity_cell,
           bool_or(fv.field_code = 'PRINCIPAL_AMOUNT') AS principal_cell,
           bool_or(fv.field_code = 'COST') AS basis_cell,
           bool_or(fv.field_code = 'FAIR_VALUE') AS initial_cell
    FROM obs.current_position_field_value fv
    JOIN lines l ON l.id = fv.position_observation_id
    WHERE fv.value_state = 'REPORTED'
      AND fv.field_code IN ('MATURITY_DATE', 'PRINCIPAL_AMOUNT', 'COST', 'FAIR_VALUE')
    GROUP BY fv.position_observation_id
  )
  SELECT l.registrant_cik,
         ns.attribute_state,
         CASE WHEN ns.attribute_state = 'REPORTED' THEN nm.raw_value END,
         count(*)::integer,
         count(*) FILTER (WHERE c.maturity_cell)::integer,
         count(*) FILTER (WHERE c.maturity_cell IS NOT TRUE)::integer,
         count(*) FILTER (WHERE c.principal_cell)::integer,
         count(*) FILTER (WHERE c.principal_cell IS NOT TRUE)::integer,
         count(*) FILTER (WHERE c.basis_cell)::integer,
         count(*) FILTER (WHERE c.basis_cell IS NOT TRUE)::integer,
         count(*) FILTER (WHERE c.initial_cell)::integer,
         count(*) FILTER (WHERE c.initial_cell IS NOT TRUE)::integer
  FROM lines l
  JOIN registry.registrant_attribute_status ns
    ON ns.registrant_id = l.registrant_id AND ns.attribute_code = 'NAME'
  LEFT JOIN cells c ON c.position_observation_id = l.id
  LEFT JOIN LATERAL (
    SELECT min(a.raw_value) AS raw_value
    FROM registry.current_registrant_attribute a
    WHERE a.registrant_id = l.registrant_id AND a.attribute_code = 'NAME'
  ) nm ON ns.attribute_state = 'REPORTED'
  GROUP BY l.registrant_cik, ns.attribute_state, nm.raw_value
$$;

CREATE FUNCTION registry.market_release_date(p_label text)
RETURNS TABLE (
  registrant_cik text,
  name_state text,
  name_raw text,
  reported_date date,
  disclosed_line_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, registry, obs, raw
AS $$
  SELECT fr.registrant_cik,
         ns.attribute_state,
         CASE WHEN ns.attribute_state = 'REPORTED' THEN nm.raw_value END,
         p.reported_date,
         count(*)::integer
  FROM registry.dataset_release dr
  JOIN registry.dataset_release_artifact dra ON dra.dataset_release_id = dr.id
  JOIN raw.table_load tl ON tl.artifact_id = dra.artifact_id
  JOIN raw.tabular_row tr ON tr.table_load_id = tl.id
  JOIN obs.soi_row_observation o ON o.tabular_row_id = tr.id
  JOIN obs.position_observation p ON p.origin_soi_row_observation_id = o.id
  JOIN registry.portfolio_filing_registrant fr
    ON fr.filing_id = p.filing_id AND fr.registrant_link_status = 'LINKED'
  JOIN registry.registrant_attribute_status ns
    ON ns.registrant_id = fr.registrant_id AND ns.attribute_code = 'NAME'
  LEFT JOIN LATERAL (
    SELECT min(a.raw_value) AS raw_value
    FROM registry.current_registrant_attribute a
    WHERE a.registrant_id = fr.registrant_id AND a.attribute_code = 'NAME'
  ) nm ON ns.attribute_state = 'REPORTED'
  WHERE p_label ~ '^[0-9]{4}(_[0-9]{2}|q[1-4])$'
    AND dr.release_label = p_label
    AND p.reported_date IS NOT NULL
  GROUP BY fr.registrant_cik, ns.attribute_state, nm.raw_value, p.reported_date
$$;

COMMENT ON FUNCTION registry.market_date_registrant(date) IS
  'Disclosed-line counts and cell coverage for one reported date. Cell counts are lines with a reported cell. A line without the cell stays in the unknown count. No amount is returned.';
COMMENT ON FUNCTION registry.market_release_date(text) IS
  'Disclosed-line counts by registrant and reported date inside one release. A label outside the release pattern returns no rows. An empty release returns no rows.';

REVOKE ALL ON FUNCTION registry.market_date_registrant(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION registry.market_release_date(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION registry.market_date_registrant(date) TO bdc_reader;
GRANT EXECUTE ON FUNCTION registry.market_release_date(text) TO bdc_reader;

SELECT ops.grant_layer_privileges();
