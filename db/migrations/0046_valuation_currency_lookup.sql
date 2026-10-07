-- 0046 reader-safe valuation currency lookup.
-- bdc_reader selects obs.current_position_field_value. It does not select the field history table.
-- The valuation rules are unchanged from 0045.

CREATE OR REPLACE FUNCTION registry.borrower_position_valuation(p_legal_entity_id uuid)
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
  instrument_type_evidence_level text,
  fair_value_state text,
  fair_value_raw text,
  fair_value_numeric text,
  fair_value_currency_state text,
  fair_value_currency_code text,
  principal_state text,
  principal_raw text,
  principal_numeric text,
  principal_currency_state text,
  principal_currency_code text,
  cost_state text,
  cost_raw text,
  cost_numeric text,
  cost_currency_state text,
  cost_currency_code text,
  observation_evidence_id text,
  observation_evidence_level text,
  earlier_reported_date text,
  fair_value_change_state text,
  fair_value_delta text,
  fair_value_percentage_state text,
  fair_value_percentage text,
  fair_value_to_principal_state text,
  fair_value_to_principal text,
  fair_value_to_cost_state text,
  fair_value_to_cost text,
  cross_bdc_comparison_state text,
  valuation_definition text
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
         CASE WHEN instrument_type.n = 1 THEN instrument_type.evidence_level END,
         r.fair_value_state,
         r.fair_value_raw,
         r.fair_value_numeric::text,
         r.fair_value_currency_state,
         fair_value_code.currency_code,
         r.principal_state,
         r.principal_raw,
         r.principal_numeric::text,
         r.principal_currency_state,
         principal_code.currency_code,
         r.cost_state,
         r.cost_raw,
         r.cost_numeric::text,
         r.cost_currency_state,
         cost_code.currency_code,
         r.observation_evidence_id::text,
         r.observation_evidence_level,
         cmp.earlier_reported_date::text,
         CASE
           WHEN r.instrument_resolution_state = 'MATCHED'
            AND r.continuity_state = 'MATCHED'
            AND cmp.fair_value_comparison_state IS NOT NULL
           THEN cmp.fair_value_comparison_state
           ELSE 'INSUFFICIENT_DATA'
         END,
         CASE
           WHEN r.instrument_resolution_state = 'MATCHED'
            AND r.continuity_state = 'MATCHED'
           THEN cmp.fair_value_delta::text
         END,
         CASE
           WHEN r.instrument_resolution_state = 'MATCHED'
            AND r.continuity_state = 'MATCHED'
            AND cmp.fair_value_comparison_state = 'COMPARABLE'
            AND cmp.fair_value_delta IS NOT NULL
            AND cmp.earlier_fair_value_numeric IS NOT NULL
            AND cmp.earlier_fair_value_numeric <> 0
            AND r.fair_value_currency_state IS DISTINCT FROM 'AMBIGUOUS'
            AND cmp.earlier_fair_value_currency_state IS DISTINCT FROM 'AMBIGUOUS'
            AND NOT (
              fair_value_code.currency_code IS NOT NULL
              AND cmp.earlier_fair_value_currency_code IS NOT NULL
              AND fair_value_code.currency_code IS DISTINCT FROM cmp.earlier_fair_value_currency_code
            )
           THEN 'COMPARABLE'
           ELSE 'INSUFFICIENT_DATA'
         END,
         CASE
           WHEN r.instrument_resolution_state = 'MATCHED'
            AND r.continuity_state = 'MATCHED'
            AND cmp.fair_value_comparison_state = 'COMPARABLE'
            AND cmp.fair_value_delta IS NOT NULL
            AND cmp.earlier_fair_value_numeric IS NOT NULL
            AND cmp.earlier_fair_value_numeric <> 0
            AND r.fair_value_currency_state IS DISTINCT FROM 'AMBIGUOUS'
            AND cmp.earlier_fair_value_currency_state IS DISTINCT FROM 'AMBIGUOUS'
            AND NOT (
              fair_value_code.currency_code IS NOT NULL
              AND cmp.earlier_fair_value_currency_code IS NOT NULL
              AND fair_value_code.currency_code IS DISTINCT FROM cmp.earlier_fair_value_currency_code
            )
           THEN round(cmp.fair_value_delta / cmp.earlier_fair_value_numeric * 100, 6)::text
         END,
         CASE
           WHEN r.instrument_resolution_state = 'MATCHED'
            AND r.fair_value_state = 'REPORTED'
            AND r.fair_value_numeric IS NOT NULL
            AND r.principal_state = 'REPORTED'
            AND r.principal_numeric IS NOT NULL
            AND r.principal_numeric <> 0
            AND r.fair_value_currency_state IS DISTINCT FROM 'AMBIGUOUS'
            AND r.principal_currency_state IS DISTINCT FROM 'AMBIGUOUS'
            AND NOT (
              fair_value_code.currency_code IS NOT NULL
              AND principal_code.currency_code IS NOT NULL
              AND fair_value_code.currency_code IS DISTINCT FROM principal_code.currency_code
            )
           THEN 'COMPARABLE'
           ELSE 'INSUFFICIENT_DATA'
         END,
         CASE
           WHEN r.instrument_resolution_state = 'MATCHED'
            AND r.fair_value_state = 'REPORTED'
            AND r.fair_value_numeric IS NOT NULL
            AND r.principal_state = 'REPORTED'
            AND r.principal_numeric IS NOT NULL
            AND r.principal_numeric <> 0
            AND r.fair_value_currency_state IS DISTINCT FROM 'AMBIGUOUS'
            AND r.principal_currency_state IS DISTINCT FROM 'AMBIGUOUS'
            AND NOT (
              fair_value_code.currency_code IS NOT NULL
              AND principal_code.currency_code IS NOT NULL
              AND fair_value_code.currency_code IS DISTINCT FROM principal_code.currency_code
            )
           THEN round(r.fair_value_numeric / r.principal_numeric, 6)::text
         END,
         CASE
           WHEN r.instrument_resolution_state = 'MATCHED'
            AND r.fair_value_state = 'REPORTED'
            AND r.fair_value_numeric IS NOT NULL
            AND r.cost_state = 'REPORTED'
            AND r.cost_numeric IS NOT NULL
            AND r.cost_numeric <> 0
            AND r.fair_value_currency_state IS DISTINCT FROM 'AMBIGUOUS'
            AND r.cost_currency_state IS DISTINCT FROM 'AMBIGUOUS'
            AND NOT (
              fair_value_code.currency_code IS NOT NULL
              AND cost_code.currency_code IS NOT NULL
              AND fair_value_code.currency_code IS DISTINCT FROM cost_code.currency_code
            )
           THEN 'COMPARABLE'
           ELSE 'INSUFFICIENT_DATA'
         END,
         CASE
           WHEN r.instrument_resolution_state = 'MATCHED'
            AND r.fair_value_state = 'REPORTED'
            AND r.fair_value_numeric IS NOT NULL
            AND r.cost_state = 'REPORTED'
            AND r.cost_numeric IS NOT NULL
            AND r.cost_numeric <> 0
            AND r.fair_value_currency_state IS DISTINCT FROM 'AMBIGUOUS'
            AND r.cost_currency_state IS DISTINCT FROM 'AMBIGUOUS'
            AND NOT (
              fair_value_code.currency_code IS NOT NULL
              AND cost_code.currency_code IS NOT NULL
              AND fair_value_code.currency_code IS DISTINCT FROM cost_code.currency_code
            )
           THEN round(r.fair_value_numeric / r.cost_numeric, 6)::text
         END,
         'UNAVAILABLE',
         'valuation.position_history.v1'
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
           min(rf.raw_value) AS raw_value,
           min(rf.evidence_level::text) AS evidence_level
    FROM obs.current_position_research_field rf
    WHERE rf.position_observation_id = r.position_observation_id
      AND rf.field_code = 'INSTRUMENT_TYPE'
  ) instrument_type ON true
  LEFT JOIN LATERAL (
    SELECT CASE WHEN count(*) = 1 THEN min(fv.currency_code) END AS currency_code
    FROM obs.current_position_field_value fv
    WHERE fv.position_observation_id = r.position_observation_id
      AND fv.field_code = 'FAIR_VALUE'
  ) fair_value_code ON true
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
    SELECT c.earlier_reported_date,
           c.fair_value_comparison_state,
           c.fair_value_delta,
           c.earlier_fair_value_numeric,
           earlier.fair_value_currency_state AS earlier_fair_value_currency_state,
           earlier_code.currency_code AS earlier_fair_value_currency_code
    FROM registry.position_period_comparison c
    JOIN LATERAL (
      SELECT observed.legal_entity_id,
             observed.entity_resolution_state,
             observed.fair_value_currency_state
      FROM registry.position_read observed
      WHERE observed.position_observation_id = c.earlier_position_observation_id
      OFFSET 0
    ) earlier ON true
    LEFT JOIN LATERAL (
      SELECT CASE WHEN count(*) = 1 THEN min(fv.currency_code) END AS currency_code
      FROM obs.current_position_field_value fv
      WHERE fv.position_observation_id = c.earlier_position_observation_id
        AND fv.field_code = 'FAIR_VALUE'
    ) earlier_code ON true
    WHERE r.instrument_resolution_state = 'MATCHED'
      AND r.continuity_state = 'MATCHED'
      AND r.position_id IS NOT NULL
      AND c.position_id = r.position_id
      AND c.later_position_observation_id = r.position_observation_id
      AND earlier.legal_entity_id = p_legal_entity_id
      AND earlier.entity_resolution_state = 'MATCHED'
  ) cmp ON true
  ORDER BY r.reported_date DESC,
           r.registrant_cik ASC NULLS LAST,
           r.accession_number ASC,
           r.position_observation_id ASC
$$;

COMMENT ON FUNCTION registry.borrower_position_valuation(uuid) IS
  'Historical valuation for one legal entity under valuation.position_history.v1. The legal entity filter is applied before registry.position_read. A fair-value delta is copied from registry.position_period_comparison. The percentage is that stored delta divided by the earlier fair_value_numeric, times 100, rounded to 6 decimal places, and only when the earlier number is stored and not zero. Fair value / principal and fair value / cost use the stored numerics on one observation and require a non-zero denominator. An unresolved instrument does not receive those figures. Different stored currency codes are not combined. Currency is not converted. cross_bdc_comparison_state stays UNAVAILABLE: a cross-BDC comparison requires a resolved legal entity, a resolved instrument, established position continuity, comparable observations, and compatible currency. Unknown is not zero.';

REVOKE ALL ON FUNCTION registry.borrower_position_valuation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION registry.borrower_position_valuation(uuid) TO bdc_reader;

SELECT ops.grant_layer_privileges();
