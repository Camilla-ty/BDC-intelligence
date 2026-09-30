-- 0017 P17 maturity wall.
-- Read-only views for bdc_reader. A year count is a count of disclosed lines with one
-- reported maturity date in that year. A line with no maturity row stays UNKNOWN.
-- No principal sum, cost, fair value, rate, spread, borrower identity, or instrument identity.

CREATE VIEW registry.maturity_position AS
SELECT p.id AS position_observation_id,
       fr.registrant_cik,
       p.reported_date,
       CASE
         WHEN count(fv.id) = 0 THEN 'UNKNOWN'
         WHEN count(DISTINCT fv.raw_value) > 1 OR count(DISTINCT fv.normalized_date) > 1 THEN 'MULTIPLE_VALUES'
         WHEN bool_and(fv.value_state = 'REPORTED') AND min(fv.normalized_date) IS NOT NULL THEN 'REPORTED'
         ELSE 'MULTIPLE_VALUES'
       END AS maturity_state,
       CASE
         WHEN count(fv.id) = 1
          AND bool_and(fv.value_state = 'REPORTED')
          AND min(fv.normalized_date) IS NOT NULL
         THEN min(fv.raw_value)
       END AS maturity_raw,
       CASE
         WHEN count(DISTINCT fv.normalized_date) = 1
          AND count(DISTINCT fv.raw_value) = 1
          AND bool_and(fv.value_state = 'REPORTED')
         THEN min(fv.normalized_date)
       END AS maturity_date
FROM obs.position_observation p
JOIN registry.portfolio_filing_registrant fr
  ON fr.filing_id = p.filing_id AND fr.registrant_link_status = 'LINKED'
LEFT JOIN obs.current_position_field_value fv
  ON fv.position_observation_id = p.id AND fv.field_code = 'MATURITY_DATE'
GROUP BY p.id, fr.registrant_cik, p.reported_date;
COMMENT ON VIEW registry.maturity_position IS
  'One disclosed line and its maturity state. REPORTED requires one normalized date. No maturity row is UNKNOWN, not a year and not zero.';

CREATE VIEW registry.maturity_reported_date AS
SELECT registrant_cik,
       reported_date,
       count(*)::integer AS disclosed_line_count,
       count(*) FILTER (WHERE maturity_state = 'REPORTED')::integer AS maturity_reported_count,
       count(*) FILTER (WHERE maturity_state = 'UNKNOWN')::integer AS maturity_unknown_count,
       count(*) FILTER (WHERE maturity_state = 'MULTIPLE_VALUES')::integer AS maturity_multiple_count
FROM registry.maturity_position
GROUP BY registrant_cik, reported_date;
COMMENT ON VIEW registry.maturity_reported_date IS
  'Disclosed-line counts by registrant and reported date. Counts are rows. Unknown maturity is a row count, not zero maturity.';

CREATE VIEW registry.maturity_year AS
SELECT registrant_cik,
       reported_date,
       extract(YEAR FROM maturity_date)::integer AS maturity_year,
       count(*)::integer AS disclosed_line_count
FROM registry.maturity_position
WHERE maturity_state = 'REPORTED' AND maturity_date IS NOT NULL
GROUP BY registrant_cik, reported_date, extract(YEAR FROM maturity_date);
COMMENT ON VIEW registry.maturity_year IS
  'Disclosed lines with one reported maturity date, counted by the year of that date. Unknown maturity is omitted here and kept on maturity_reported_date.';

CREATE VIEW registry.maturity_line AS
SELECT mp.position_observation_id,
       mp.registrant_cik,
       mp.reported_date,
       pl.disclosed_line_text,
       pl.principal_state,
       pl.principal_raw,
       pl.principal_currency_state,
       mp.maturity_state,
       mp.maturity_raw,
       mp.maturity_date,
       CASE WHEN mp.maturity_state = 'REPORTED'
            THEN extract(YEAR FROM mp.maturity_date)::integer END AS maturity_year,
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
  'One disclosed line for the maturity wall: maturity date, principal, and SEC filing attributes. Principal currency stays UNKNOWN.';

SELECT ops.grant_layer_privileges();
