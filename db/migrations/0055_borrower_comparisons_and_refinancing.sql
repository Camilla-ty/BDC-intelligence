-- 0055 combined borrower comparisons + refinancing outcomes read.
-- One MATERIALIZED expansion of registry.borrower_position_comparisons feeds both
-- JSON arrays so position_period_comparison is evaluated once per call.
-- comparisons matches borrower_position_comparisons row shape and ordering.
-- refinancing matches borrower_refinancing_outcomes projection and predicates.
-- definition: refinancing.outcome_history.v1 (unchanged from 0051)

CREATE FUNCTION registry.borrower_comparisons_and_refinancing(p_legal_entity_id uuid)
RETURNS TABLE (
  comparisons json,
  refinancing json
)
LANGUAGE sql
STABLE
AS $$
  WITH comparisons AS MATERIALIZED (
    SELECT *
    FROM registry.borrower_position_comparisons(p_legal_entity_id)
  )
  SELECT coalesce(
           (SELECT json_agg(row_to_json(c) ORDER BY
                      c.later_reported_date DESC,
                      c.earlier_reported_date DESC,
                      c.later_registrant_cik ASC NULLS LAST,
                      c.position_id ASC,
                      c.earlier_position_observation_id ASC,
                      c.later_position_observation_id ASC)
            FROM comparisons c),
           '[]'::json),
         coalesce(
           (SELECT json_agg(row_to_json(o) ORDER BY
                      o.later_reported_date DESC,
                      o.earlier_reported_date DESC,
                      o.position_id,
                      o.later_position_observation_id)
            FROM (
              SELECT p_legal_entity_id::text AS legal_entity_id,
                     c.position_id,
                     later.instrument_id::text AS instrument_id,
                     later.instrument_resolution_state,
                     later.continuity_state,
                     CASE
                       WHEN instrument_type.n IS NULL OR instrument_type.n = 0 THEN 'UNKNOWN'
                       WHEN instrument_type.n = 1 AND instrument_type.reported_n = 1 THEN 'REPORTED'
                       ELSE 'MULTIPLE_VALUES'
                     END AS instrument_type_state,
                     CASE WHEN instrument_type.n = 1 AND instrument_type.reported_n = 1
                          THEN instrument_type.raw_value END AS instrument_type_raw,
                     c.earlier_position_observation_id,
                     c.later_position_observation_id,
                     c.earlier_reported_date,
                     c.later_reported_date,
                     NULL::text AS event_date,
                     'MATURITY_CHANGED'::text AS event_type,
                     'UNKNOWN'::text AS refinancing_outcome_state,
                     c.earlier_maturity_raw,
                     c.later_maturity_raw,
                     c.earlier_maturity_precision,
                     c.later_maturity_precision,
                     earlier.principal_state AS earlier_principal_state,
                     earlier.principal_raw AS earlier_principal_raw,
                     earlier.principal_currency_state AS earlier_principal_currency_state,
                     earlier_principal.currency_code AS earlier_principal_currency_code,
                     later.principal_state AS later_principal_state,
                     later.principal_raw AS later_principal_raw,
                     later.principal_currency_state AS later_principal_currency_state,
                     later_principal.currency_code AS later_principal_currency_code,
                     c.earlier_accession_number,
                     c.later_accession_number,
                     c.earlier_observation_evidence_id,
                     c.later_observation_evidence_id,
                     earlier.observation_evidence_level AS earlier_observation_evidence_level,
                     later.observation_evidence_level AS later_observation_evidence_level,
                     later.registrant_cik,
                     later.registrant_link_status,
                     'refinancing.outcome_history.v1'::text AS outcome_definition
              FROM comparisons c
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
            ) o),
           '[]'::json)
$$;

COMMENT ON FUNCTION registry.borrower_comparisons_and_refinancing(uuid) IS
  'One legal-entity read: comparisons json matches borrower_position_comparisons; refinancing json matches the MATURITY_CHANGED UNKNOWN outcome shape. Comparisons CTE is MATERIALIZED so the comparison graph is evaluated once. event_date is null. A missing later observation is not a row.';

REVOKE ALL ON FUNCTION registry.borrower_comparisons_and_refinancing(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION registry.borrower_comparisons_and_refinancing(uuid) TO bdc_reader;

SELECT ops.grant_layer_privileges();
