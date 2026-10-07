-- 0040 borrower historical position observations.
-- One matched legal entity's rows from registry.position_read.
-- The function does not resolve names, merge instruments, or derive amounts.

CREATE FUNCTION registry.borrower_position_observations(p_legal_entity_id uuid)
RETURNS TABLE (
  legal_entity_id text,
  position_observation_id text,
  reported_date text,
  accession_number text,
  registrant_cik text,
  registrant_link_status text,
  entity_resolution_state text,
  instrument_resolution_state text,
  continuity_state text,
  economic_group_state text,
  principal_state text,
  principal_raw text,
  principal_currency_state text,
  cost_state text,
  cost_raw text,
  cost_currency_state text,
  fair_value_state text,
  fair_value_raw text,
  fair_value_currency_state text,
  acquisition_state text,
  acquisition_raw text,
  acquisition_precision text,
  interest_rate_state text,
  interest_rate_raw text,
  spread_state text,
  spread_raw text,
  interest_rate_floor_state text,
  interest_rate_floor_raw text,
  maturity_source text,
  maturity_raw text,
  maturity_precision text,
  maturity_filing_verified boolean,
  maturity_document_url text,
  observation_evidence_level text
)
LANGUAGE sql
STABLE
AS $$
  SELECT r.legal_entity_id::text,
         r.position_observation_id::text,
         r.reported_date::text,
         r.accession_number,
         r.registrant_cik,
         r.registrant_link_status,
         r.entity_resolution_state,
         r.instrument_resolution_state,
         r.continuity_state,
         r.economic_group_state,
         r.principal_state,
         r.principal_raw,
         r.principal_currency_state,
         r.cost_state,
         r.cost_raw,
         r.cost_currency_state,
         r.fair_value_state,
         r.fair_value_raw,
         r.fair_value_currency_state,
         r.acquisition_state,
         r.acquisition_raw,
         r.acquisition_precision,
         r.interest_rate_state,
         r.interest_rate_raw,
         r.spread_state,
         r.spread_raw,
         r.interest_rate_floor_state,
         r.interest_rate_floor_raw,
         r.maturity_source,
         r.maturity_raw,
         r.maturity_precision,
         r.maturity_filing_verified,
         r.maturity_document_url,
         r.observation_evidence_level
  FROM registry.position_read r
  WHERE r.legal_entity_id = p_legal_entity_id
    AND r.entity_resolution_state = 'MATCHED'
  ORDER BY r.reported_date DESC,
           r.registrant_cik ASC NULLS LAST,
           r.accession_number ASC,
           r.position_observation_id ASC
$$;

COMMENT ON FUNCTION registry.borrower_position_observations(uuid) IS
  'Matched position observations for one legal entity, read from registry.position_read. Newest reported date first. A missing field stays the stored UNKNOWN state. Absence of a later period is not a row.';

REVOKE ALL ON FUNCTION registry.borrower_position_observations(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION registry.borrower_position_observations(uuid) TO bdc_reader;

SELECT ops.grant_layer_privileges();
