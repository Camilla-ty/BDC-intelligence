-- 0042 borrower confirmed position comparisons.
-- Rows from registry.position_period_comparison whose earlier and later
-- observations are both MATCHED to the same legal entity on registry.position_read.
-- Deltas, comparison states, and maturity precision are copied. They are not recomputed.

CREATE FUNCTION registry.borrower_position_comparisons(p_legal_entity_id uuid)
RETURNS TABLE (
  legal_entity_id text,
  position_id text,
  earlier_position_observation_id text,
  later_position_observation_id text,
  earlier_reported_date text,
  later_reported_date text,
  earlier_accession_number text,
  later_accession_number text,
  earlier_observation_evidence_id text,
  later_observation_evidence_id text,
  earlier_observation_evidence_level text,
  later_observation_evidence_level text,
  earlier_registrant_cik text,
  earlier_registrant_link_status text,
  later_registrant_cik text,
  later_registrant_link_status text,
  principal_comparison_state text,
  earlier_principal_raw text,
  later_principal_raw text,
  principal_delta text,
  earlier_principal_currency_state text,
  later_principal_currency_state text,
  cost_comparison_state text,
  earlier_cost_raw text,
  later_cost_raw text,
  cost_delta text,
  earlier_cost_currency_state text,
  later_cost_currency_state text,
  fair_value_comparison_state text,
  earlier_fair_value_raw text,
  later_fair_value_raw text,
  fair_value_delta text,
  earlier_fair_value_currency_state text,
  later_fair_value_currency_state text,
  maturity_comparison_state text,
  maturity_changed boolean,
  earlier_maturity_raw text,
  later_maturity_raw text,
  earlier_maturity_precision text,
  later_maturity_precision text,
  earlier_maturity_date text,
  later_maturity_date text,
  acquisition_comparison_state text,
  earlier_acquisition_raw text,
  later_acquisition_raw text,
  earlier_acquisition_precision text,
  later_acquisition_precision text,
  earlier_acquisition_date text,
  later_acquisition_date text,
  interest_rate_comparison_state text,
  earlier_interest_rate_raw text,
  later_interest_rate_raw text,
  interest_rate_delta text,
  spread_comparison_state text,
  earlier_spread_raw text,
  later_spread_raw text,
  spread_delta text,
  interest_rate_floor_comparison_state text,
  earlier_interest_rate_floor_raw text,
  later_interest_rate_floor_raw text,
  interest_rate_floor_delta text
)
LANGUAGE sql
STABLE
AS $$
  SELECT p_legal_entity_id::text,
         c.position_id::text,
         c.earlier_position_observation_id::text,
         c.later_position_observation_id::text,
         c.earlier_reported_date::text,
         c.later_reported_date::text,
         c.earlier_accession_number,
         c.later_accession_number,
         c.earlier_observation_evidence_id::text,
         c.later_observation_evidence_id::text,
         earlier.observation_evidence_level,
         later.observation_evidence_level,
         earlier.registrant_cik,
         earlier.registrant_link_status,
         later.registrant_cik,
         later.registrant_link_status,
         c.principal_comparison_state,
         c.earlier_principal_raw,
         c.later_principal_raw,
         c.principal_delta::text,
         earlier.principal_currency_state,
         later.principal_currency_state,
         c.cost_comparison_state,
         c.earlier_cost_raw,
         c.later_cost_raw,
         c.cost_delta::text,
         earlier.cost_currency_state,
         later.cost_currency_state,
         c.fair_value_comparison_state,
         c.earlier_fair_value_raw,
         c.later_fair_value_raw,
         c.fair_value_delta::text,
         earlier.fair_value_currency_state,
         later.fair_value_currency_state,
         c.maturity_comparison_state,
         c.maturity_changed,
         c.earlier_maturity_raw,
         c.later_maturity_raw,
         c.earlier_maturity_precision,
         c.later_maturity_precision,
         c.earlier_maturity_date::text,
         c.later_maturity_date::text,
         c.acquisition_comparison_state,
         c.earlier_acquisition_raw,
         c.later_acquisition_raw,
         c.earlier_acquisition_precision,
         c.later_acquisition_precision,
         c.earlier_acquisition_date::text,
         c.later_acquisition_date::text,
         c.interest_rate_comparison_state,
         c.earlier_interest_rate_raw,
         c.later_interest_rate_raw,
         c.interest_rate_delta::text,
         c.spread_comparison_state,
         c.earlier_spread_raw,
         c.later_spread_raw,
         c.spread_delta::text,
         c.interest_rate_floor_comparison_state,
         c.earlier_interest_rate_floor_raw,
         c.later_interest_rate_floor_raw,
         c.interest_rate_floor_delta::text
  FROM registry.position_period_comparison c
  JOIN registry.position_read earlier
    ON earlier.position_observation_id = c.earlier_position_observation_id
  JOIN registry.position_read later
    ON later.position_observation_id = c.later_position_observation_id
  WHERE earlier.legal_entity_id = p_legal_entity_id
    AND later.legal_entity_id = p_legal_entity_id
    AND earlier.entity_resolution_state = 'MATCHED'
    AND later.entity_resolution_state = 'MATCHED'
  ORDER BY c.later_reported_date DESC,
           c.earlier_reported_date DESC,
           later.registrant_cik ASC NULLS LAST,
           c.position_id ASC,
           c.earlier_position_observation_id ASC,
           c.later_position_observation_id ASC
$$;

COMMENT ON FUNCTION registry.borrower_position_comparisons(uuid) IS
  'Confirmed position comparisons for one legal entity. Both observations must be MATCHED to that entity on registry.position_read. Values and deltas are copied from registry.position_period_comparison. A field change is not a credit event.';

REVOKE ALL ON FUNCTION registry.borrower_position_comparisons(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION registry.borrower_position_comparisons(uuid) TO bdc_reader;

SELECT ops.grant_layer_privileges();
