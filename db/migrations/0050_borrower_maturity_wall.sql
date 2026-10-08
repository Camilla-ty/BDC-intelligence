-- 0050 borrower-scoped maturity wall.
-- Maturity values are copied from registry.position_read, which reads registry.maturity_read.
-- A calendar day stays a date. A month stays month precision. Unknown stays unknown.
-- definition: maturity.position_history.v1

CREATE FUNCTION registry.borrower_maturity_observations(p_legal_entity_id uuid)
RETURNS TABLE (
  legal_entity_id text,
  position_observation_id text,
  position_id text,
  instrument_id text,
  borrower_name_raw text,
  reported_date text,
  accession_number text,
  registrant_cik text,
  registrant_link_status text,
  entity_resolution_state text,
  instrument_resolution_state text,
  continuity_state text,
  instrument_type_state text,
  instrument_type_raw text,
  maturity_source text,
  maturity_raw text,
  maturity_date text,
  maturity_precision text,
  maturity_year text,
  maturity_month text,
  maturity_precision_class text,
  maturity_bucket_year text,
  maturity_observation_state text,
  maturity_evidence_id text,
  maturity_filing_verified boolean,
  maturity_document_url text,
  observation_evidence_level text,
  principal_state text,
  principal_raw text,
  principal_numeric text,
  principal_currency_state text,
  principal_currency_code text,
  fair_value_state text,
  fair_value_raw text,
  fair_value_numeric text,
  fair_value_currency_state text,
  fair_value_currency_code text,
  refinancing_outcome_state text,
  maturity_definition text
)
LANGUAGE sql
STABLE
AS $$
  SELECT r.legal_entity_id::text,
         r.position_observation_id::text,
         r.position_id::text,
         r.instrument_id::text,
         r.borrower_name_raw,
         r.reported_date::text,
         r.accession_number,
         r.registrant_cik,
         r.registrant_link_status,
         r.entity_resolution_state,
         r.instrument_resolution_state,
         r.continuity_state,
         CASE
           WHEN instrument_type.n IS NULL OR instrument_type.n = 0 THEN 'UNKNOWN'
           WHEN instrument_type.n = 1 AND instrument_type.reported_n = 1 THEN 'REPORTED'
           ELSE 'MULTIPLE_VALUES'
         END,
         CASE WHEN instrument_type.n = 1 AND instrument_type.reported_n = 1 THEN instrument_type.raw_value END,
         r.maturity_source,
         r.maturity_raw,
         r.maturity_date::text,
         r.maturity_precision,
         r.maturity_year::text,
         r.maturity_month::text,
         CASE
           WHEN r.instrument_resolution_state = 'MATCHED'
            AND r.continuity_state = 'MATCHED'
            AND r.maturity_source IN ('REPORTED_STRUCTURED', 'FILING_DISPLAYED')
            AND r.maturity_date IS NOT NULL
            AND r.maturity_precision IS NULL
           THEN 'DAY'
           WHEN r.instrument_resolution_state = 'MATCHED'
            AND r.continuity_state = 'MATCHED'
            AND r.maturity_precision = 'MONTH'
            AND r.maturity_year IS NOT NULL
            AND r.maturity_month IS NOT NULL
            AND r.maturity_source IN ('REPORTED_MONTH', 'FILING_MONTH')
           THEN 'MONTH'
           ELSE 'NONE'
         END,
         CASE
           WHEN r.instrument_resolution_state = 'MATCHED'
            AND r.continuity_state = 'MATCHED'
            AND r.maturity_source IN ('REPORTED_STRUCTURED', 'FILING_DISPLAYED')
            AND r.maturity_date IS NOT NULL
            AND r.maturity_precision IS NULL
           THEN extract(year FROM r.maturity_date)::integer::text
           WHEN r.instrument_resolution_state = 'MATCHED'
            AND r.continuity_state = 'MATCHED'
            AND r.maturity_precision = 'MONTH'
            AND r.maturity_year IS NOT NULL
            AND r.maturity_month IS NOT NULL
            AND r.maturity_source IN ('REPORTED_MONTH', 'FILING_MONTH')
           THEN r.maturity_year::text
         END,
         CASE
           WHEN r.instrument_resolution_state IS DISTINCT FROM 'MATCHED'
           THEN 'UNRESOLVED_INSTRUMENT'
           WHEN r.continuity_state IS DISTINCT FROM 'MATCHED'
           THEN 'UNRESOLVED_POSITION'
           WHEN r.maturity_source IN ('REPORTED_STRUCTURED', 'FILING_DISPLAYED')
            AND r.maturity_date IS NOT NULL
            AND r.maturity_precision IS NULL
           THEN 'OBSERVED'
           WHEN r.maturity_precision = 'MONTH'
            AND r.maturity_year IS NOT NULL
            AND r.maturity_month IS NOT NULL
            AND r.maturity_source IN ('REPORTED_MONTH', 'FILING_MONTH')
           THEN 'OBSERVED'
           ELSE 'UNKNOWN'
         END,
         r.maturity_evidence_id::text,
         r.maturity_filing_verified,
         r.maturity_document_url,
         r.observation_evidence_level,
         r.principal_state,
         r.principal_raw,
         r.principal_numeric::text,
         r.principal_currency_state,
         principal_code.currency_code,
         r.fair_value_state,
         r.fair_value_raw,
         r.fair_value_numeric::text,
         r.fair_value_currency_state,
         fair_value_code.currency_code,
         'UNKNOWN',
         'maturity.position_history.v1'
  FROM (
    SELECT DISTINCT m.position_observation_id
    FROM registry.matched_entity_position m
    WHERE m.legal_entity_id = p_legal_entity_id
  ) matched
  JOIN LATERAL (
    SELECT observed.*
    FROM registry.position_read observed
    WHERE observed.position_observation_id = matched.position_observation_id
      AND observed.legal_entity_id = p_legal_entity_id
      AND observed.entity_resolution_state = 'MATCHED'
    OFFSET 0
  ) r ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS n,
           count(*) FILTER (WHERE rf.value_state = 'REPORTED')::integer AS reported_n,
           min(rf.raw_value) AS raw_value
    FROM obs.current_position_research_field rf
    WHERE rf.position_observation_id = r.position_observation_id
      AND rf.field_code = 'INSTRUMENT_TYPE'
  ) instrument_type ON true
  LEFT JOIN LATERAL (
    SELECT CASE WHEN count(*) = 1 THEN min(fv.currency_code) END AS currency_code
    FROM obs.current_position_field_value fv
    WHERE fv.position_observation_id = r.position_observation_id
      AND fv.field_code = 'PRINCIPAL_AMOUNT'
  ) principal_code ON true
  LEFT JOIN LATERAL (
    SELECT CASE WHEN count(*) = 1 THEN min(fv.currency_code) END AS currency_code
    FROM obs.current_position_field_value fv
    WHERE fv.position_observation_id = r.position_observation_id
      AND fv.field_code = 'FAIR_VALUE'
  ) fair_value_code ON true
  ORDER BY CASE
             WHEN r.instrument_resolution_state = 'MATCHED'
              AND r.continuity_state = 'MATCHED'
              AND r.maturity_source IN ('REPORTED_STRUCTURED', 'FILING_DISPLAYED')
              AND r.maturity_date IS NOT NULL
              AND r.maturity_precision IS NULL
             THEN 0
             WHEN r.instrument_resolution_state = 'MATCHED'
              AND r.continuity_state = 'MATCHED'
              AND r.maturity_precision = 'MONTH'
              AND r.maturity_year IS NOT NULL
              AND r.maturity_month IS NOT NULL
              AND r.maturity_source IN ('REPORTED_MONTH', 'FILING_MONTH')
             THEN 1
             ELSE 2
           END,
           r.maturity_date ASC NULLS LAST,
           r.maturity_year ASC NULLS LAST,
           r.maturity_month ASC NULLS LAST,
           r.reported_date DESC,
           r.position_observation_id ASC
$$;

COMMENT ON FUNCTION registry.borrower_maturity_observations(uuid) IS
  'Historical maturity for one legal entity under maturity.position_history.v1. Values come from registry.position_read. A calendar day is not created from a month. Unknown stays unknown. refinancing_outcome_state is UNKNOWN: a maturity change, a missing later observation, and an acquisition date are not a refinancing or an origination. Unresolved instruments stay out of observed maturity buckets.';

CREATE FUNCTION registry.borrower_maturity_summary(p_legal_entity_id uuid)
RETURNS TABLE (
  resolved_observation_count text,
  known_maturity_count text,
  unknown_maturity_count text,
  unresolved_count text,
  earliest_calendar_maturity text,
  earliest_month_maturity text,
  refinancing_outcome_state text,
  maturity_definition text
)
LANGUAGE sql
STABLE
AS $$
  SELECT count(*) FILTER (
           WHERE instrument_resolution_state = 'MATCHED' AND continuity_state = 'MATCHED'
         )::text,
         count(*) FILTER (WHERE maturity_observation_state = 'OBSERVED')::text,
         count(*) FILTER (
           WHERE instrument_resolution_state = 'MATCHED'
             AND continuity_state = 'MATCHED'
             AND maturity_observation_state = 'UNKNOWN'
         )::text,
         count(*) FILTER (
           WHERE maturity_observation_state IN ('UNRESOLVED_INSTRUMENT', 'UNRESOLVED_POSITION')
         )::text,
         (array_agg(maturity_raw ORDER BY maturity_date)
            FILTER (WHERE maturity_precision_class = 'DAY'))[1],
         (array_agg(maturity_raw ORDER BY maturity_year::integer, maturity_month::integer)
            FILTER (WHERE maturity_precision_class = 'MONTH'))[1],
         'UNKNOWN',
         'maturity.position_history.v1'
  FROM registry.borrower_maturity_observations(p_legal_entity_id)
$$;

COMMENT ON FUNCTION registry.borrower_maturity_summary(uuid) IS
  'Counts for one legal entity. Known maturity is an observed day or month on a resolved position. Earliest calendar maturity and earliest month maturity stay separate. A count is a stored-row count, not exposure. refinancing_outcome_state stays UNKNOWN.';

CREATE FUNCTION registry.borrower_maturity_years(p_legal_entity_id uuid)
RETURNS TABLE (
  maturity_year text,
  maturity_precision_class text,
  observation_count text,
  principal_aggregation_state text,
  principal_total text,
  principal_currency_code text,
  fair_value_aggregation_state text,
  fair_value_total text,
  fair_value_currency_code text,
  maturity_definition text
)
LANGUAGE sql
STABLE
AS $$
  SELECT observed.maturity_bucket_year,
         observed.maturity_precision_class,
         count(*)::text,
         CASE
           WHEN bool_and(
                  observed.principal_state = 'REPORTED'
                  AND observed.principal_numeric IS NOT NULL
                  AND observed.principal_currency_state IS NOT NULL
                  AND observed.principal_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
                  AND observed.principal_currency_code IS NOT NULL
                )
            AND count(DISTINCT observed.principal_currency_code) = 1
           THEN 'COMPARABLE'
           ELSE 'INSUFFICIENT_DATA'
         END,
         CASE
           WHEN bool_and(
                  observed.principal_state = 'REPORTED'
                  AND observed.principal_numeric IS NOT NULL
                  AND observed.principal_currency_state IS NOT NULL
                  AND observed.principal_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
                  AND observed.principal_currency_code IS NOT NULL
                )
            AND count(DISTINCT observed.principal_currency_code) = 1
           THEN sum(observed.principal_numeric::numeric)::text
         END,
         CASE
           WHEN bool_and(
                  observed.principal_state = 'REPORTED'
                  AND observed.principal_numeric IS NOT NULL
                  AND observed.principal_currency_state IS NOT NULL
                  AND observed.principal_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
                  AND observed.principal_currency_code IS NOT NULL
                )
            AND count(DISTINCT observed.principal_currency_code) = 1
           THEN min(observed.principal_currency_code)
         END,
         CASE
           WHEN bool_and(
                  observed.fair_value_state = 'REPORTED'
                  AND observed.fair_value_numeric IS NOT NULL
                  AND observed.fair_value_currency_state IS NOT NULL
                  AND observed.fair_value_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
                  AND observed.fair_value_currency_code IS NOT NULL
                )
            AND count(DISTINCT observed.fair_value_currency_code) = 1
           THEN 'COMPARABLE'
           ELSE 'INSUFFICIENT_DATA'
         END,
         CASE
           WHEN bool_and(
                  observed.fair_value_state = 'REPORTED'
                  AND observed.fair_value_numeric IS NOT NULL
                  AND observed.fair_value_currency_state IS NOT NULL
                  AND observed.fair_value_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
                  AND observed.fair_value_currency_code IS NOT NULL
                )
            AND count(DISTINCT observed.fair_value_currency_code) = 1
           THEN sum(observed.fair_value_numeric::numeric)::text
         END,
         CASE
           WHEN bool_and(
                  observed.fair_value_state = 'REPORTED'
                  AND observed.fair_value_numeric IS NOT NULL
                  AND observed.fair_value_currency_state IS NOT NULL
                  AND observed.fair_value_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
                  AND observed.fair_value_currency_code IS NOT NULL
                )
            AND count(DISTINCT observed.fair_value_currency_code) = 1
           THEN min(observed.fair_value_currency_code)
         END,
         'maturity.position_history.v1'
  FROM registry.borrower_maturity_observations(p_legal_entity_id) observed
  WHERE observed.maturity_observation_state = 'OBSERVED'
  GROUP BY observed.maturity_bucket_year, observed.maturity_precision_class
  ORDER BY observed.maturity_bucket_year, observed.maturity_precision_class
$$;

COMMENT ON FUNCTION registry.borrower_maturity_years(uuid) IS
  'Observed maturity counts by stored year and precision. Principal and fair value are summed only when every observation in the bucket has a reported number and the same non-unknown currency code. A missing amount is not zero. Unknown currency is not a total. Fair value is not a substitute for principal. Unresolved instruments are excluded.';

REVOKE ALL ON FUNCTION registry.borrower_maturity_observations(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION registry.borrower_maturity_summary(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION registry.borrower_maturity_years(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION registry.borrower_maturity_observations(uuid) TO bdc_reader;
GRANT EXECUTE ON FUNCTION registry.borrower_maturity_summary(uuid) TO bdc_reader;
GRANT EXECUTE ON FUNCTION registry.borrower_maturity_years(uuid) TO bdc_reader;

SELECT ops.grant_layer_privileges();
