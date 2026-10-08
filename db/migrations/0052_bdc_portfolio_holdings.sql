-- 0052 BDC portfolio holdings for one registrant and one reported date.
-- Filings come from registry.portfolio_detail_filing: a filing is included only
-- when every current link names that one registrant and one CIK.
-- Position facts are registry.position_read. No second identity is created.
-- definition: portfolio.holdings.v1

CREATE FUNCTION registry.bdc_portfolio_scope(p_cik text, p_reported_date date)
RETURNS TABLE (position_observation_id bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, registry, obs
AS $$
  SELECT p.id
  FROM registry.portfolio_detail_filing(p_cik) filing
  JOIN obs.position_observation p
    ON p.filing_id = filing.filing_id
   AND p.reported_date = p_reported_date
$$;

COMMENT ON FUNCTION registry.bdc_portfolio_scope(text, date) IS
  'Position observations for one CIK and one reported date. The CIK filter is registry.portfolio_detail_filing. A filing with more than one registrant is absent. Another reported date is absent.';

CREATE FUNCTION registry.bdc_portfolio_holdings(
  p_cik text, p_reported_date date, p_limit integer, p_offset integer
)
RETURNS TABLE (
  registrant_cik text,
  reported_date text,
  position_observation_id text,
  position_id text,
  borrower_name_raw text,
  holding_descriptor_raw text,
  instrument_id text,
  instrument_resolution_state text,
  continuity_state text,
  instrument_type_state text,
  instrument_type_raw text,
  principal_state text,
  principal_raw text,
  principal_currency_state text,
  principal_currency_code text,
  cost_state text,
  cost_raw text,
  cost_currency_state text,
  cost_currency_code text,
  fair_value_state text,
  fair_value_raw text,
  fair_value_currency_state text,
  fair_value_currency_code text,
  maturity_source text,
  maturity_raw text,
  maturity_precision text,
  accession_number text,
  observation_evidence_level text,
  document_url text,
  holdings_definition text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, registry, obs
AS $$
  SELECT r.registrant_cik,
         r.reported_date::text,
         r.position_observation_id::text,
         r.position_id::text,
         r.borrower_name_raw,
         r.holding_descriptor_raw,
         r.instrument_id::text,
         r.instrument_resolution_state,
         r.continuity_state,
         CASE
           WHEN instrument_type.n IS NULL OR instrument_type.n = 0 THEN 'UNKNOWN'
           WHEN instrument_type.n = 1 AND instrument_type.reported_n = 1 THEN 'REPORTED'
           ELSE 'MULTIPLE_VALUES'
         END,
         CASE WHEN instrument_type.n = 1 AND instrument_type.reported_n = 1 THEN instrument_type.raw_value END,
         r.principal_state,
         r.principal_raw,
         r.principal_currency_state,
         principal_code.currency_code,
         r.cost_state,
         r.cost_raw,
         r.cost_currency_state,
         cost_code.currency_code,
         r.fair_value_state,
         r.fair_value_raw,
         r.fair_value_currency_state,
         fair_value_code.currency_code,
         r.maturity_source,
         r.maturity_raw,
         r.maturity_precision,
         r.accession_number,
         r.observation_evidence_level,
         doc.document_url,
         'portfolio.holdings.v1'
  FROM registry.bdc_portfolio_scope(p_cik, p_reported_date) scoped
  JOIN LATERAL (
    SELECT observed.*
    FROM registry.position_read observed
    WHERE observed.position_observation_id = scoped.position_observation_id
      AND observed.reported_date = p_reported_date
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
      AND fv.field_code = 'COST'
  ) cost_code ON true
  LEFT JOIN LATERAL (
    SELECT CASE WHEN count(*) = 1 THEN min(fv.currency_code) END AS currency_code
    FROM obs.current_position_field_value fv
    WHERE fv.position_observation_id = r.position_observation_id
      AND fv.field_code = 'FAIR_VALUE'
  ) fair_value_code ON true
  LEFT JOIN LATERAL (
    SELECT filing_document.document_url
    FROM registry.filing_document filing_document
    WHERE filing_document.filing_id = r.filing_id
      AND filing_document.document_url ~ '^https://www\.sec\.gov/Archives/edgar/data/'
    ORDER BY CASE WHEN filing_document.named_by = 'SUBMISSIONS_PRIMARY_DOCUMENT' THEN 0 ELSE 1 END,
             filing_document.id
    LIMIT 1
  ) doc ON true
  ORDER BY r.borrower_name_raw ASC NULLS LAST, r.position_observation_id ASC
  LIMIT greatest(coalesce(p_limit, 0), 0)
  OFFSET greatest(coalesce(p_offset, 0), 0)
$$;

COMMENT ON FUNCTION registry.bdc_portfolio_holdings(text, date, integer, integer) IS
  'One page of holdings for one CIK and one reported date under portfolio.holdings.v1. Facts are registry.position_read. A missing amount stays unknown. Currency is not converted.';

CREATE FUNCTION registry.bdc_portfolio_summary(p_cik text, p_reported_date date)
RETURNS TABLE (
  observation_count text,
  resolved_position_count text,
  unresolved_count text,
  known_principal_count text,
  known_fair_value_count text,
  known_maturity_count text,
  unknown_currency_count text,
  principal_aggregation_state text,
  principal_total text,
  principal_currency_code text,
  fair_value_aggregation_state text,
  fair_value_total text,
  fair_value_currency_code text,
  holdings_definition text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, registry, obs
AS $$
  SELECT count(*)::text,
         count(*) FILTER (
           WHERE instrument_resolution_state = 'MATCHED' AND continuity_state = 'MATCHED'
         )::text,
         count(*) FILTER (
           WHERE instrument_resolution_state IS DISTINCT FROM 'MATCHED'
              OR continuity_state IS DISTINCT FROM 'MATCHED'
         )::text,
         count(*) FILTER (WHERE principal_state = 'REPORTED')::text,
         count(*) FILTER (WHERE fair_value_state = 'REPORTED')::text,
         count(*) FILTER (
           WHERE maturity_source IN ('REPORTED_STRUCTURED', 'FILING_DISPLAYED', 'REPORTED_MONTH', 'FILING_MONTH')
         )::text,
         count(*) FILTER (
           WHERE (principal_state = 'REPORTED' AND principal_currency_state IN ('UNKNOWN', 'AMBIGUOUS'))
              OR (fair_value_state = 'REPORTED' AND fair_value_currency_state IN ('UNKNOWN', 'AMBIGUOUS'))
         )::text,
         CASE
           WHEN count(*) > 0
            AND bool_and(
                  principal_state = 'REPORTED'
                  AND principal_numeric IS NOT NULL
                  AND principal_currency_state IS NOT NULL
                  AND principal_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
                  AND principal_currency_code IS NOT NULL
                )
            AND count(DISTINCT principal_currency_code) = 1
           THEN 'COMPARABLE'
           ELSE 'INSUFFICIENT_DATA'
         END,
         CASE
           WHEN count(*) > 0
            AND bool_and(
                  principal_state = 'REPORTED'
                  AND principal_numeric IS NOT NULL
                  AND principal_currency_state IS NOT NULL
                  AND principal_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
                  AND principal_currency_code IS NOT NULL
                )
            AND count(DISTINCT principal_currency_code) = 1
           THEN sum(principal_numeric::numeric)::text
         END,
         CASE
           WHEN count(*) > 0
            AND bool_and(
                  principal_state = 'REPORTED'
                  AND principal_numeric IS NOT NULL
                  AND principal_currency_state IS NOT NULL
                  AND principal_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
                  AND principal_currency_code IS NOT NULL
                )
            AND count(DISTINCT principal_currency_code) = 1
           THEN min(principal_currency_code)
         END,
         CASE
           WHEN count(*) > 0
            AND bool_and(
                  fair_value_state = 'REPORTED'
                  AND fair_value_numeric IS NOT NULL
                  AND fair_value_currency_state IS NOT NULL
                  AND fair_value_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
                  AND fair_value_currency_code IS NOT NULL
                )
            AND count(DISTINCT fair_value_currency_code) = 1
           THEN 'COMPARABLE'
           ELSE 'INSUFFICIENT_DATA'
         END,
         CASE
           WHEN count(*) > 0
            AND bool_and(
                  fair_value_state = 'REPORTED'
                  AND fair_value_numeric IS NOT NULL
                  AND fair_value_currency_state IS NOT NULL
                  AND fair_value_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
                  AND fair_value_currency_code IS NOT NULL
                )
            AND count(DISTINCT fair_value_currency_code) = 1
           THEN sum(fair_value_numeric::numeric)::text
         END,
         CASE
           WHEN count(*) > 0
            AND bool_and(
                  fair_value_state = 'REPORTED'
                  AND fair_value_numeric IS NOT NULL
                  AND fair_value_currency_state IS NOT NULL
                  AND fair_value_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
                  AND fair_value_currency_code IS NOT NULL
                )
            AND count(DISTINCT fair_value_currency_code) = 1
           THEN min(fair_value_currency_code)
         END,
         'portfolio.holdings.v1'
  FROM (
    SELECT r.instrument_resolution_state,
           r.continuity_state,
           r.principal_state,
           r.principal_numeric,
           r.principal_currency_state,
           principal_code.currency_code AS principal_currency_code,
           r.fair_value_state,
           r.fair_value_numeric,
           r.fair_value_currency_state,
           fair_value_code.currency_code AS fair_value_currency_code,
           r.maturity_source
    FROM registry.bdc_portfolio_scope(p_cik, p_reported_date) scoped
    JOIN LATERAL (
      SELECT observed.*
      FROM registry.position_read observed
      WHERE observed.position_observation_id = scoped.position_observation_id
        AND observed.reported_date = p_reported_date
      OFFSET 0
    ) r ON true
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
  ) holding
$$;

COMMENT ON FUNCTION registry.bdc_portfolio_summary(text, date) IS
  'Observable counts for one CIK and one reported date. Principal and fair value are totaled only when every holding in that date has a reported number and the same known currency. A missing amount is not zero. Unknown currency is not a total. Counts are stored rows, not a score.';

CREATE FUNCTION registry.bdc_portfolio_changes(p_cik text, p_reported_date date)
RETURNS TABLE (
  position_id text,
  earlier_reported_date text,
  later_reported_date text,
  earlier_accession_number text,
  later_accession_number text,
  principal_comparison_state text,
  earlier_principal_raw text,
  later_principal_raw text,
  principal_delta text,
  fair_value_comparison_state text,
  earlier_fair_value_raw text,
  later_fair_value_raw text,
  fair_value_delta text,
  maturity_comparison_state text,
  maturity_changed boolean,
  earlier_maturity_raw text,
  later_maturity_raw text,
  holdings_definition text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, registry, obs
AS $$
  SELECT c.position_id::text,
         c.earlier_reported_date::text,
         c.later_reported_date::text,
         c.earlier_accession_number,
         c.later_accession_number,
         c.principal_comparison_state,
         c.earlier_principal_raw,
         c.later_principal_raw,
         c.principal_delta::text,
         c.fair_value_comparison_state,
         c.earlier_fair_value_raw,
         c.later_fair_value_raw,
         c.fair_value_delta::text,
         c.maturity_comparison_state,
         c.maturity_changed,
         c.earlier_maturity_raw,
         c.later_maturity_raw,
         'portfolio.holdings.v1'
  FROM registry.position_period_comparison c
  JOIN registry.bdc_portfolio_scope(p_cik, p_reported_date) scoped
    ON scoped.position_observation_id = c.later_position_observation_id
  ORDER BY c.later_reported_date DESC, c.position_id, c.later_position_observation_id
$$;

COMMENT ON FUNCTION registry.bdc_portfolio_changes(text, date) IS
  'Confirmed comparisons whose later observation is in this CIK and reported date. Deltas are copied from registry.position_period_comparison. A missing later observation is not a row and is not a repayment or a refinancing.';

REVOKE ALL ON FUNCTION registry.bdc_portfolio_scope(text, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION registry.bdc_portfolio_holdings(text, date, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION registry.bdc_portfolio_summary(text, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION registry.bdc_portfolio_changes(text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION registry.bdc_portfolio_scope(text, date) TO bdc_reader;
GRANT EXECUTE ON FUNCTION registry.bdc_portfolio_holdings(text, date, integer, integer) TO bdc_reader;
GRANT EXECUTE ON FUNCTION registry.bdc_portfolio_summary(text, date) TO bdc_reader;
GRANT EXECUTE ON FUNCTION registry.bdc_portfolio_changes(text, date) TO bdc_reader;

SELECT ops.grant_layer_privileges();
