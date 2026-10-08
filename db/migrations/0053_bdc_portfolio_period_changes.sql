-- 0053 Historical changes between two reporting periods of one BDC.
-- Identity is the existing MATCHED position. Deltas are copied from
-- registry.position_period_comparison. A missing later observation is
-- POSITION_NO_LONGER_OBSERVED. It is not a repayment or a refinancing.
-- A later position with no earlier observation is NEW_POSITION_OBSERVED.
-- It is not an origination. An unresolved instrument is not a change row.
-- definition: portfolio.period_changes.v1

CREATE FUNCTION registry.bdc_portfolio_period_identity(p_cik text, p_reported_date date)
RETURNS TABLE (
  position_observation_id bigint,
  position_id uuid,
  instrument_resolution_state text,
  continuity_state text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, registry, obs
AS $$
  SELECT r.position_observation_id,
         r.position_id,
         r.instrument_resolution_state,
         r.continuity_state
  FROM registry.bdc_portfolio_scope(p_cik, p_reported_date) scoped
  JOIN LATERAL (
    SELECT observed.position_observation_id,
           observed.position_id,
           observed.instrument_resolution_state,
           observed.continuity_state
    FROM registry.position_read observed
    WHERE observed.position_observation_id = scoped.position_observation_id
      AND observed.reported_date = p_reported_date
    OFFSET 0
  ) r ON true
$$;

COMMENT ON FUNCTION registry.bdc_portfolio_period_identity(text, date) IS
  'Position identity for one CIK and one reported date. The population is registry.bdc_portfolio_scope. Resolution columns are registry.position_read.';

CREATE FUNCTION registry.bdc_portfolio_period_changes(
  p_cik text, p_earlier date, p_later date
)
RETURNS TABLE (
  change_type text,
  registrant_cik text,
  earlier_reported_date text,
  later_reported_date text,
  position_id text,
  instrument_id text,
  legal_entity_id text,
  borrower_name_raw text,
  holding_descriptor_raw text,
  instrument_resolution_state text,
  continuity_state text,
  instrument_type_state text,
  instrument_type_raw text,
  principal_comparison_state text,
  principal_delta text,
  earlier_principal_raw text,
  later_principal_raw text,
  earlier_principal_currency_state text,
  later_principal_currency_state text,
  fair_value_comparison_state text,
  fair_value_delta text,
  earlier_fair_value_raw text,
  later_fair_value_raw text,
  earlier_fair_value_currency_state text,
  later_fair_value_currency_state text,
  cost_comparison_state text,
  cost_delta text,
  earlier_cost_raw text,
  later_cost_raw text,
  maturity_comparison_state text,
  maturity_changed boolean,
  earlier_maturity_raw text,
  later_maturity_raw text,
  earlier_accession_number text,
  later_accession_number text,
  earlier_document_url text,
  later_document_url text,
  earlier_position_observation_id text,
  later_position_observation_id text,
  changes_definition text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, registry, obs
AS $$
  WITH earlier_resolved AS (
    SELECT position_id,
           count(*)::integer AS n,
           min(position_observation_id) AS position_observation_id
    FROM registry.bdc_portfolio_period_identity(p_cik, p_earlier)
    WHERE p_earlier < p_later
      AND instrument_resolution_state = 'MATCHED'
      AND continuity_state = 'MATCHED'
      AND position_id IS NOT NULL
    GROUP BY position_id
  ),
  later_resolved AS (
    SELECT position_id,
           count(*)::integer AS n,
           min(position_observation_id) AS position_observation_id
    FROM registry.bdc_portfolio_period_identity(p_cik, p_later)
    WHERE p_earlier < p_later
      AND instrument_resolution_state = 'MATCHED'
      AND continuity_state = 'MATCHED'
      AND position_id IS NOT NULL
    GROUP BY position_id
  ),
  classified AS (
    SELECT 'EXISTING_POSITION_CHANGED'::text AS change_type,
           earlier_resolved.position_observation_id AS earlier_id,
           later_resolved.position_observation_id AS later_id
    FROM earlier_resolved
    JOIN later_resolved ON later_resolved.position_id = earlier_resolved.position_id
    JOIN registry.position_period_comparison compared
      ON compared.earlier_position_observation_id = earlier_resolved.position_observation_id
     AND compared.later_position_observation_id = later_resolved.position_observation_id
     AND compared.earlier_reported_date = p_earlier
     AND compared.later_reported_date = p_later
    WHERE earlier_resolved.n = 1
      AND later_resolved.n = 1
      AND (compared.fair_value_changed IS TRUE
           OR compared.principal_changed IS TRUE
           OR compared.cost_changed IS TRUE
           OR compared.maturity_changed IS TRUE)
    UNION ALL
    SELECT 'NEW_POSITION_OBSERVED',
           NULL::bigint,
           later_resolved.position_observation_id
    FROM later_resolved
    WHERE later_resolved.n = 1
      AND NOT EXISTS (
        SELECT 1
        FROM earlier_resolved earlier_position
        WHERE earlier_position.position_id = later_resolved.position_id)
    UNION ALL
    SELECT 'POSITION_NO_LONGER_OBSERVED',
           earlier_resolved.position_observation_id,
           NULL::bigint
    FROM earlier_resolved
    WHERE earlier_resolved.n = 1
      AND NOT EXISTS (
        SELECT 1
        FROM later_resolved later_position
        WHERE later_position.position_id = earlier_resolved.position_id)
  )
  SELECT classified.change_type,
         p_cik,
         p_earlier::text,
         p_later::text,
         coalesce(later_read.position_id, earlier_read.position_id)::text,
         coalesce(later_read.instrument_id, earlier_read.instrument_id)::text,
         coalesce(later_read.legal_entity_id, earlier_read.legal_entity_id)::text,
         coalesce(later_read.borrower_name_raw, earlier_read.borrower_name_raw),
         coalesce(later_read.holding_descriptor_raw, earlier_read.holding_descriptor_raw),
         coalesce(later_read.instrument_resolution_state, earlier_read.instrument_resolution_state),
         coalesce(later_read.continuity_state, earlier_read.continuity_state),
         CASE
           WHEN instrument_type.n IS NULL OR instrument_type.n = 0 THEN 'UNKNOWN'
           WHEN instrument_type.n = 1 AND instrument_type.reported_n = 1 THEN 'REPORTED'
           ELSE 'MULTIPLE_VALUES'
         END,
         CASE WHEN instrument_type.n = 1 AND instrument_type.reported_n = 1 THEN instrument_type.raw_value END,
         compared.principal_comparison_state,
         compared.principal_delta::text,
         coalesce(compared.earlier_principal_raw, earlier_read.principal_raw),
         coalesce(compared.later_principal_raw, later_read.principal_raw),
         earlier_read.principal_currency_state,
         later_read.principal_currency_state,
         compared.fair_value_comparison_state,
         compared.fair_value_delta::text,
         coalesce(compared.earlier_fair_value_raw, earlier_read.fair_value_raw),
         coalesce(compared.later_fair_value_raw, later_read.fair_value_raw),
         earlier_read.fair_value_currency_state,
         later_read.fair_value_currency_state,
         compared.cost_comparison_state,
         compared.cost_delta::text,
         coalesce(compared.earlier_cost_raw, earlier_read.cost_raw),
         coalesce(compared.later_cost_raw, later_read.cost_raw),
         compared.maturity_comparison_state,
         compared.maturity_changed,
         coalesce(compared.earlier_maturity_raw, earlier_read.maturity_raw),
         coalesce(compared.later_maturity_raw, later_read.maturity_raw),
         coalesce(compared.earlier_accession_number, earlier_read.accession_number),
         coalesce(compared.later_accession_number, later_read.accession_number),
         earlier_doc.document_url,
         later_doc.document_url,
         classified.earlier_id::text,
         classified.later_id::text,
         'portfolio.period_changes.v1'
  FROM classified
  LEFT JOIN registry.position_period_comparison compared
    ON compared.earlier_position_observation_id = classified.earlier_id
   AND compared.later_position_observation_id = classified.later_id
   AND classified.change_type = 'EXISTING_POSITION_CHANGED'
  LEFT JOIN LATERAL (
    SELECT observed.*
    FROM registry.position_read observed
    WHERE observed.position_observation_id = classified.earlier_id
    OFFSET 0
  ) earlier_read ON classified.earlier_id IS NOT NULL
  LEFT JOIN LATERAL (
    SELECT observed.*
    FROM registry.position_read observed
    WHERE observed.position_observation_id = classified.later_id
    OFFSET 0
  ) later_read ON classified.later_id IS NOT NULL
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS n,
           count(*) FILTER (WHERE rf.value_state = 'REPORTED')::integer AS reported_n,
           min(rf.raw_value) AS raw_value
    FROM obs.current_position_research_field rf
    WHERE rf.position_observation_id = coalesce(classified.later_id, classified.earlier_id)
      AND rf.field_code = 'INSTRUMENT_TYPE'
  ) instrument_type ON true
  LEFT JOIN LATERAL (
    SELECT filing_document.document_url
    FROM registry.filing_document filing_document
    WHERE filing_document.filing_id = earlier_read.filing_id
      AND filing_document.document_url ~ '^https://www\.sec\.gov/Archives/edgar/data/'
    ORDER BY CASE WHEN filing_document.named_by = 'SUBMISSIONS_PRIMARY_DOCUMENT' THEN 0 ELSE 1 END,
             filing_document.id
    LIMIT 1
  ) earlier_doc ON true
  LEFT JOIN LATERAL (
    SELECT filing_document.document_url
    FROM registry.filing_document filing_document
    WHERE filing_document.filing_id = later_read.filing_id
      AND filing_document.document_url ~ '^https://www\.sec\.gov/Archives/edgar/data/'
    ORDER BY CASE WHEN filing_document.named_by = 'SUBMISSIONS_PRIMARY_DOCUMENT' THEN 0 ELSE 1 END,
             filing_document.id
    LIMIT 1
  ) later_doc ON true
  ORDER BY classified.change_type, coalesce(later_read.borrower_name_raw, earlier_read.borrower_name_raw), classified.later_id, classified.earlier_id
$$;

COMMENT ON FUNCTION registry.bdc_portfolio_period_changes(text, date, date) IS
  'Observable changes between two reporting periods of one CIK under portfolio.period_changes.v1. EXISTING_POSITION_CHANGED copies registry.position_period_comparison for that pair. NEW_POSITION_OBSERVED is a resolved position present only in the later period. POSITION_NO_LONGER_OBSERVED is a resolved position present only in the earlier period. Neither is an origination, a repayment, or a refinancing. An unresolved instrument is absent. A borrower name is not an instrument.';

CREATE FUNCTION registry.bdc_portfolio_period_summary(
  p_cik text, p_earlier date, p_later date
)
RETURNS TABLE (
  earlier_observation_count text,
  later_observation_count text,
  unresolved_count text,
  observed_in_both_count text,
  changed_count text,
  new_count text,
  no_longer_count text,
  ambiguous_position_count text,
  changes_definition text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, registry, obs
AS $$
  WITH earlier_rows AS (
    SELECT *
    FROM registry.bdc_portfolio_period_identity(p_cik, p_earlier)
    WHERE p_earlier < p_later
  ),
  later_rows AS (
    SELECT *
    FROM registry.bdc_portfolio_period_identity(p_cik, p_later)
    WHERE p_earlier < p_later
  ),
  earlier_resolved AS (
    SELECT position_id,
           count(*)::integer AS n,
           min(position_observation_id) AS position_observation_id
    FROM earlier_rows
    WHERE instrument_resolution_state = 'MATCHED'
      AND continuity_state = 'MATCHED'
      AND position_id IS NOT NULL
    GROUP BY position_id
  ),
  later_resolved AS (
    SELECT position_id,
           count(*)::integer AS n,
           min(position_observation_id) AS position_observation_id
    FROM later_rows
    WHERE instrument_resolution_state = 'MATCHED'
      AND continuity_state = 'MATCHED'
      AND position_id IS NOT NULL
    GROUP BY position_id
  )
  SELECT (SELECT count(*) FROM earlier_rows)::text,
         (SELECT count(*) FROM later_rows)::text,
         (
           (SELECT count(*) FROM earlier_rows
            WHERE instrument_resolution_state IS DISTINCT FROM 'MATCHED'
               OR continuity_state IS DISTINCT FROM 'MATCHED'
               OR position_id IS NULL)
           +
           (SELECT count(*) FROM later_rows
            WHERE instrument_resolution_state IS DISTINCT FROM 'MATCHED'
               OR continuity_state IS DISTINCT FROM 'MATCHED'
               OR position_id IS NULL)
         )::text,
         (SELECT count(*)
          FROM earlier_resolved
          JOIN later_resolved USING (position_id)
          WHERE earlier_resolved.n = 1 AND later_resolved.n = 1)::text,
         (SELECT count(*)
          FROM earlier_resolved
          JOIN later_resolved USING (position_id)
          JOIN registry.position_period_comparison compared
            ON compared.earlier_position_observation_id = earlier_resolved.position_observation_id
           AND compared.later_position_observation_id = later_resolved.position_observation_id
           AND compared.earlier_reported_date = p_earlier
           AND compared.later_reported_date = p_later
          WHERE earlier_resolved.n = 1
            AND later_resolved.n = 1
            AND (compared.fair_value_changed IS TRUE
                 OR compared.principal_changed IS TRUE
                 OR compared.cost_changed IS TRUE
                 OR compared.maturity_changed IS TRUE))::text,
         (SELECT count(*)
          FROM later_resolved
          WHERE n = 1
            AND NOT EXISTS (
              SELECT 1 FROM earlier_resolved earlier_position
              WHERE earlier_position.position_id = later_resolved.position_id))::text,
         (SELECT count(*)
          FROM earlier_resolved
          WHERE n = 1
            AND NOT EXISTS (
              SELECT 1 FROM later_resolved later_position
              WHERE later_position.position_id = earlier_resolved.position_id))::text,
         (
           (SELECT count(*) FROM earlier_resolved WHERE n > 1)
           +
           (SELECT count(*) FROM later_resolved WHERE n > 1)
         )::text,
         'portfolio.period_changes.v1'
$$;

COMMENT ON FUNCTION registry.bdc_portfolio_period_summary(text, date, date) IS
  'Counts for two reporting periods of one CIK. Counts are stored rows or stored positions, not a score. Unresolved instruments stay out of the change counts. A position with more than one matched observation on a selected date is ambiguous and is not a new or absent position.';

REVOKE ALL ON FUNCTION registry.bdc_portfolio_period_identity(text, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION registry.bdc_portfolio_period_changes(text, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION registry.bdc_portfolio_period_summary(text, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION registry.bdc_portfolio_period_identity(text, date) TO bdc_reader;
GRANT EXECUTE ON FUNCTION registry.bdc_portfolio_period_changes(text, date, date) TO bdc_reader;
GRANT EXECUTE ON FUNCTION registry.bdc_portfolio_period_summary(text, date, date) TO bdc_reader;

SELECT ops.grant_layer_privileges();
