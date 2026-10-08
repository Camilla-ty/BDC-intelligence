-- 0051 borrower-scoped historical outcome read.
-- A comparable maturity change on registry.position_period_comparison is labeled
-- MATURITY_CHANGED. refinancing_outcome_state stays UNKNOWN.
-- No documented source field stores an explicit refinancing or repayment.
-- A missing later observation is not a row.
-- definition: refinancing.outcome_history.v1

CREATE FUNCTION registry.borrower_refinancing_outcomes(p_legal_entity_id uuid)
RETURNS TABLE (
  legal_entity_id text,
  position_id text,
  instrument_id text,
  instrument_resolution_state text,
  continuity_state text,
  instrument_type_state text,
  instrument_type_raw text,
  earlier_position_observation_id text,
  later_position_observation_id text,
  earlier_reported_date text,
  later_reported_date text,
  event_date text,
  event_type text,
  refinancing_outcome_state text,
  earlier_maturity_raw text,
  later_maturity_raw text,
  earlier_maturity_precision text,
  later_maturity_precision text,
  earlier_principal_state text,
  earlier_principal_raw text,
  earlier_principal_currency_state text,
  earlier_principal_currency_code text,
  later_principal_state text,
  later_principal_raw text,
  later_principal_currency_state text,
  later_principal_currency_code text,
  earlier_accession_number text,
  later_accession_number text,
  earlier_observation_evidence_id text,
  later_observation_evidence_id text,
  earlier_observation_evidence_level text,
  later_observation_evidence_level text,
  registrant_cik text,
  registrant_link_status text,
  outcome_definition text
)
LANGUAGE sql
STABLE
AS $$
  SELECT p_legal_entity_id::text,
         c.position_id,
         later.instrument_id::text,
         later.instrument_resolution_state,
         later.continuity_state,
         CASE
           WHEN instrument_type.n IS NULL OR instrument_type.n = 0 THEN 'UNKNOWN'
           WHEN instrument_type.n = 1 AND instrument_type.reported_n = 1 THEN 'REPORTED'
           ELSE 'MULTIPLE_VALUES'
         END,
         CASE WHEN instrument_type.n = 1 AND instrument_type.reported_n = 1 THEN instrument_type.raw_value END,
         c.earlier_position_observation_id,
         c.later_position_observation_id,
         c.earlier_reported_date,
         c.later_reported_date,
         NULL::text,
         'MATURITY_CHANGED',
         'UNKNOWN',
         c.earlier_maturity_raw,
         c.later_maturity_raw,
         c.earlier_maturity_precision,
         c.later_maturity_precision,
         earlier.principal_state,
         earlier.principal_raw,
         earlier.principal_currency_state,
         earlier_principal.currency_code,
         later.principal_state,
         later.principal_raw,
         later.principal_currency_state,
         later_principal.currency_code,
         c.earlier_accession_number,
         c.later_accession_number,
         c.earlier_observation_evidence_id,
         c.later_observation_evidence_id,
         earlier.observation_evidence_level,
         later.observation_evidence_level,
         later.registrant_cik,
         later.registrant_link_status,
         'refinancing.outcome_history.v1'
  FROM registry.borrower_position_comparisons(p_legal_entity_id) c
  JOIN LATERAL (
    SELECT observed.instrument_id,
           observed.instrument_resolution_state,
           observed.continuity_state,
           observed.principal_state,
           observed.principal_raw,
           observed.principal_currency_state,
           observed.observation_evidence_level,
           observed.registrant_cik,
           observed.registrant_link_status
    FROM registry.position_read observed
    WHERE observed.position_observation_id = c.later_position_observation_id::bigint
      AND observed.legal_entity_id = p_legal_entity_id
      AND observed.entity_resolution_state = 'MATCHED'
    OFFSET 0
  ) later ON true
  JOIN LATERAL (
    SELECT observed.instrument_id,
           observed.instrument_resolution_state,
           observed.continuity_state,
           observed.principal_state,
           observed.principal_raw,
           observed.principal_currency_state,
           observed.observation_evidence_level
    FROM registry.position_read observed
    WHERE observed.position_observation_id = c.earlier_position_observation_id::bigint
      AND observed.legal_entity_id = p_legal_entity_id
      AND observed.entity_resolution_state = 'MATCHED'
    OFFSET 0
  ) earlier ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS n,
           count(*) FILTER (WHERE rf.value_state = 'REPORTED')::integer AS reported_n,
           min(rf.raw_value) AS raw_value
    FROM obs.current_position_research_field rf
    WHERE rf.position_observation_id = c.later_position_observation_id::bigint
      AND rf.field_code = 'INSTRUMENT_TYPE'
  ) instrument_type ON true
  LEFT JOIN LATERAL (
    SELECT CASE WHEN count(*) = 1 THEN min(fv.currency_code) END AS currency_code
    FROM obs.current_position_field_value fv
    WHERE fv.position_observation_id = c.earlier_position_observation_id::bigint
      AND fv.field_code = 'PRINCIPAL_AMOUNT'
  ) earlier_principal ON true
  LEFT JOIN LATERAL (
    SELECT CASE WHEN count(*) = 1 THEN min(fv.currency_code) END AS currency_code
    FROM obs.current_position_field_value fv
    WHERE fv.position_observation_id = c.later_position_observation_id::bigint
      AND fv.field_code = 'PRINCIPAL_AMOUNT'
  ) later_principal ON true
  WHERE c.maturity_changed IS TRUE
    AND c.maturity_comparison_state = 'COMPARABLE'
    AND earlier.instrument_resolution_state = 'MATCHED'
    AND later.instrument_resolution_state = 'MATCHED'
    AND earlier.continuity_state = 'MATCHED'
    AND later.continuity_state = 'MATCHED'
    AND earlier.instrument_id IS NOT DISTINCT FROM later.instrument_id
  ORDER BY c.later_reported_date DESC,
           c.earlier_reported_date DESC,
           c.position_id,
           c.later_position_observation_id
$$;

COMMENT ON FUNCTION registry.borrower_refinancing_outcomes(uuid) IS
  'Historical outcomes for one legal entity under refinancing.outcome_history.v1. The only emitted event_type is MATURITY_CHANGED, copied from a comparable registry.position_period_comparison row. refinancing_outcome_state is UNKNOWN. event_date is null because a report date is not a transaction date. A missing later observation is not a row. Acquisition date is not an input. No probability, score, or amount is calculated.';

REVOKE ALL ON FUNCTION registry.borrower_refinancing_outcomes(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION registry.borrower_refinancing_outcomes(uuid) TO bdc_reader;

SELECT ops.grant_layer_privileges();
