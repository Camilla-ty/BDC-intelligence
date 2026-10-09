-- 0059 period-comparison currency compatibility.
-- Principal, amortized-cost, and fair-value period deltas are COMPARABLE only when
-- both sides are REPORTED numerics and stored currency is established and compatible:
-- both currency states are present and not UNKNOWN or AMBIGUOUS, both currency codes
-- are present on obs.current_position_field_value, and the codes are equal.
-- Null/null or UNKNOWN currency is INSUFFICIENT_DATA (no numeric delta). Currency is
-- not converted. Aligns period comparison with docs/DATA_MODEL.md maturity-wall and
-- valuation currency rules. Fair-value absolute change follows the COMPARABLE gate.
-- Global view keeps the 0043 continuity_match seed.

CREATE OR REPLACE VIEW registry.position_period_comparison AS
WITH continuity_match AS MATERIALIZED (
  SELECT d.position_observation_id
  FROM resolution.current_position_continuity d
  WHERE d.state = 'MATCHED'
    AND d.position_id IS NOT NULL
),
confirmed AS (
  SELECT r.*
  FROM continuity_match d
  JOIN LATERAL (
    SELECT pr.*
    FROM registry.position_read pr
    WHERE pr.position_observation_id = d.position_observation_id
    OFFSET 0
  ) r ON true
  WHERE r.continuity_state = 'MATCHED'
    AND r.position_id IS NOT NULL
    AND r.reported_date IS NOT NULL
),
date_population AS (
  SELECT position_id, reported_date, count(*)::integer AS observation_count
  FROM confirmed
  GROUP BY position_id, reported_date
),
endpoints AS (
  SELECT c.*
  FROM confirmed c
  JOIN date_population d
    ON d.position_id = c.position_id
   AND d.reported_date = c.reported_date
   AND d.observation_count = 1
)
SELECT
  l.position_id,
  e.position_observation_id AS earlier_position_observation_id,
  l.position_observation_id AS later_position_observation_id,
  e.reported_date AS earlier_reported_date,
  l.reported_date AS later_reported_date,
  e.accession_number AS earlier_accession_number,
  l.accession_number AS later_accession_number,
  e.observation_evidence_id AS earlier_observation_evidence_id,
  l.observation_evidence_id AS later_observation_evidence_id,
  CASE
    WHEN e.principal_state = 'REPORTED' AND e.principal_numeric IS NOT NULL
     AND l.principal_state = 'REPORTED' AND l.principal_numeric IS NOT NULL
     AND e.principal_currency_state IS NOT NULL
     AND l.principal_currency_state IS NOT NULL
     AND e.principal_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
     AND l.principal_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
     AND e_principal_ccy.currency_code IS NOT NULL
     AND l_principal_ccy.currency_code IS NOT NULL
     AND e_principal_ccy.currency_code = l_principal_ccy.currency_code
    THEN 'COMPARABLE'
    ELSE 'INSUFFICIENT_DATA'
  END AS principal_comparison_state,
  e.principal_raw AS earlier_principal_raw,
  l.principal_raw AS later_principal_raw,
  e.principal_numeric AS earlier_principal_numeric,
  l.principal_numeric AS later_principal_numeric,
  CASE
    WHEN e.principal_state = 'REPORTED' AND e.principal_numeric IS NOT NULL
     AND l.principal_state = 'REPORTED' AND l.principal_numeric IS NOT NULL
     AND e.principal_currency_state IS NOT NULL
     AND l.principal_currency_state IS NOT NULL
     AND e.principal_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
     AND l.principal_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
     AND e_principal_ccy.currency_code IS NOT NULL
     AND l_principal_ccy.currency_code IS NOT NULL
     AND e_principal_ccy.currency_code = l_principal_ccy.currency_code
    THEN l.principal_numeric - e.principal_numeric
  END AS principal_delta,
  CASE
    WHEN e.principal_state = 'REPORTED' AND e.principal_numeric IS NOT NULL
     AND l.principal_state = 'REPORTED' AND l.principal_numeric IS NOT NULL
     AND e.principal_currency_state IS NOT NULL
     AND l.principal_currency_state IS NOT NULL
     AND e.principal_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
     AND l.principal_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
     AND e_principal_ccy.currency_code IS NOT NULL
     AND l_principal_ccy.currency_code IS NOT NULL
     AND e_principal_ccy.currency_code = l_principal_ccy.currency_code
    THEN l.principal_numeric IS DISTINCT FROM e.principal_numeric
  END AS principal_changed,
  CASE
    WHEN e.cost_state = 'REPORTED' AND e.cost_numeric IS NOT NULL
     AND l.cost_state = 'REPORTED' AND l.cost_numeric IS NOT NULL
     AND e.cost_currency_state IS NOT NULL
     AND l.cost_currency_state IS NOT NULL
     AND e.cost_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
     AND l.cost_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
     AND e_cost_ccy.currency_code IS NOT NULL
     AND l_cost_ccy.currency_code IS NOT NULL
     AND e_cost_ccy.currency_code = l_cost_ccy.currency_code
    THEN 'COMPARABLE'
    ELSE 'INSUFFICIENT_DATA'
  END AS cost_comparison_state,
  e.cost_raw AS earlier_cost_raw,
  l.cost_raw AS later_cost_raw,
  e.cost_numeric AS earlier_cost_numeric,
  l.cost_numeric AS later_cost_numeric,
  CASE
    WHEN e.cost_state = 'REPORTED' AND e.cost_numeric IS NOT NULL
     AND l.cost_state = 'REPORTED' AND l.cost_numeric IS NOT NULL
     AND e.cost_currency_state IS NOT NULL
     AND l.cost_currency_state IS NOT NULL
     AND e.cost_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
     AND l.cost_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
     AND e_cost_ccy.currency_code IS NOT NULL
     AND l_cost_ccy.currency_code IS NOT NULL
     AND e_cost_ccy.currency_code = l_cost_ccy.currency_code
    THEN l.cost_numeric - e.cost_numeric
  END AS cost_delta,
  CASE
    WHEN e.cost_state = 'REPORTED' AND e.cost_numeric IS NOT NULL
     AND l.cost_state = 'REPORTED' AND l.cost_numeric IS NOT NULL
     AND e.cost_currency_state IS NOT NULL
     AND l.cost_currency_state IS NOT NULL
     AND e.cost_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
     AND l.cost_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
     AND e_cost_ccy.currency_code IS NOT NULL
     AND l_cost_ccy.currency_code IS NOT NULL
     AND e_cost_ccy.currency_code = l_cost_ccy.currency_code
    THEN l.cost_numeric IS DISTINCT FROM e.cost_numeric
  END AS cost_changed,
  CASE
    WHEN e.fair_value_state = 'REPORTED' AND e.fair_value_numeric IS NOT NULL
     AND l.fair_value_state = 'REPORTED' AND l.fair_value_numeric IS NOT NULL
     AND e.fair_value_currency_state IS NOT NULL
     AND l.fair_value_currency_state IS NOT NULL
     AND e.fair_value_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
     AND l.fair_value_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
     AND e_fair_value_ccy.currency_code IS NOT NULL
     AND l_fair_value_ccy.currency_code IS NOT NULL
     AND e_fair_value_ccy.currency_code = l_fair_value_ccy.currency_code
    THEN 'COMPARABLE'
    ELSE 'INSUFFICIENT_DATA'
  END AS fair_value_comparison_state,
  e.fair_value_raw AS earlier_fair_value_raw,
  l.fair_value_raw AS later_fair_value_raw,
  e.fair_value_numeric AS earlier_fair_value_numeric,
  l.fair_value_numeric AS later_fair_value_numeric,
  CASE
    WHEN e.fair_value_state = 'REPORTED' AND e.fair_value_numeric IS NOT NULL
     AND l.fair_value_state = 'REPORTED' AND l.fair_value_numeric IS NOT NULL
     AND e.fair_value_currency_state IS NOT NULL
     AND l.fair_value_currency_state IS NOT NULL
     AND e.fair_value_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
     AND l.fair_value_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
     AND e_fair_value_ccy.currency_code IS NOT NULL
     AND l_fair_value_ccy.currency_code IS NOT NULL
     AND e_fair_value_ccy.currency_code = l_fair_value_ccy.currency_code
    THEN l.fair_value_numeric - e.fair_value_numeric
  END AS fair_value_delta,
  CASE
    WHEN e.fair_value_state = 'REPORTED' AND e.fair_value_numeric IS NOT NULL
     AND l.fair_value_state = 'REPORTED' AND l.fair_value_numeric IS NOT NULL
     AND e.fair_value_currency_state IS NOT NULL
     AND l.fair_value_currency_state IS NOT NULL
     AND e.fair_value_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
     AND l.fair_value_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
     AND e_fair_value_ccy.currency_code IS NOT NULL
     AND l_fair_value_ccy.currency_code IS NOT NULL
     AND e_fair_value_ccy.currency_code = l_fair_value_ccy.currency_code
    THEN l.fair_value_numeric IS DISTINCT FROM e.fair_value_numeric
  END AS fair_value_changed,
  CASE
    WHEN e.maturity_date IS NOT NULL
     AND e.maturity_precision IS NULL
     AND e.maturity_source IN ('REPORTED_STRUCTURED', 'FILING_DISPLAYED')
     AND l.maturity_date IS NOT NULL
     AND l.maturity_precision IS NULL
     AND l.maturity_source IN ('REPORTED_STRUCTURED', 'FILING_DISPLAYED')
    THEN 'COMPARABLE'
    WHEN e.maturity_precision = 'MONTH'
     AND l.maturity_precision = 'MONTH'
     AND e.maturity_year IS NOT NULL
     AND e.maturity_month IS NOT NULL
     AND l.maturity_year IS NOT NULL
     AND l.maturity_month IS NOT NULL
     AND e.maturity_source IN ('REPORTED_MONTH', 'FILING_MONTH')
     AND l.maturity_source IN ('REPORTED_MONTH', 'FILING_MONTH')
    THEN 'COMPARABLE'
    ELSE 'INSUFFICIENT_DATA'
  END AS maturity_comparison_state,
  e.maturity_source AS earlier_maturity_source,
  l.maturity_source AS later_maturity_source,
  e.maturity_raw AS earlier_maturity_raw,
  l.maturity_raw AS later_maturity_raw,
  e.maturity_date AS earlier_maturity_date,
  l.maturity_date AS later_maturity_date,
  e.maturity_precision AS earlier_maturity_precision,
  l.maturity_precision AS later_maturity_precision,
  e.maturity_year AS earlier_maturity_year,
  e.maturity_month AS earlier_maturity_month,
  l.maturity_year AS later_maturity_year,
  l.maturity_month AS later_maturity_month,
  CASE
    WHEN e.maturity_date IS NOT NULL
     AND e.maturity_precision IS NULL
     AND e.maturity_source IN ('REPORTED_STRUCTURED', 'FILING_DISPLAYED')
     AND l.maturity_date IS NOT NULL
     AND l.maturity_precision IS NULL
     AND l.maturity_source IN ('REPORTED_STRUCTURED', 'FILING_DISPLAYED')
    THEN e.maturity_date IS DISTINCT FROM l.maturity_date
    WHEN e.maturity_precision = 'MONTH'
     AND l.maturity_precision = 'MONTH'
     AND e.maturity_year IS NOT NULL
     AND e.maturity_month IS NOT NULL
     AND l.maturity_year IS NOT NULL
     AND l.maturity_month IS NOT NULL
     AND e.maturity_source IN ('REPORTED_MONTH', 'FILING_MONTH')
     AND l.maturity_source IN ('REPORTED_MONTH', 'FILING_MONTH')
    THEN e.maturity_year IS DISTINCT FROM l.maturity_year
      OR e.maturity_month IS DISTINCT FROM l.maturity_month
  END AS maturity_changed,
  CASE
    WHEN e.acquisition_state = 'REPORTED'
     AND e.acquisition_date IS NOT NULL
     AND e.acquisition_precision IS NULL
     AND l.acquisition_state = 'REPORTED'
     AND l.acquisition_date IS NOT NULL
     AND l.acquisition_precision IS NULL
    THEN 'COMPARABLE'
    WHEN e.acquisition_state = 'REPORTED'
     AND e.acquisition_precision = 'MONTH'
     AND e.acquisition_year IS NOT NULL
     AND e.acquisition_month IS NOT NULL
     AND l.acquisition_state = 'REPORTED'
     AND l.acquisition_precision = 'MONTH'
     AND l.acquisition_year IS NOT NULL
     AND l.acquisition_month IS NOT NULL
    THEN 'COMPARABLE'
    ELSE 'INSUFFICIENT_DATA'
  END AS acquisition_comparison_state,
  e.acquisition_raw AS earlier_acquisition_raw,
  l.acquisition_raw AS later_acquisition_raw,
  e.acquisition_date AS earlier_acquisition_date,
  l.acquisition_date AS later_acquisition_date,
  e.acquisition_precision AS earlier_acquisition_precision,
  l.acquisition_precision AS later_acquisition_precision,
  e.acquisition_year AS earlier_acquisition_year,
  e.acquisition_month AS earlier_acquisition_month,
  l.acquisition_year AS later_acquisition_year,
  l.acquisition_month AS later_acquisition_month,
  CASE
    WHEN e.interest_rate_state = 'REPORTED' AND e.interest_rate_numeric IS NOT NULL
     AND l.interest_rate_state = 'REPORTED' AND l.interest_rate_numeric IS NOT NULL
    THEN 'COMPARABLE'
    ELSE 'INSUFFICIENT_DATA'
  END AS interest_rate_comparison_state,
  e.interest_rate_raw AS earlier_interest_rate_raw,
  l.interest_rate_raw AS later_interest_rate_raw,
  e.interest_rate_numeric AS earlier_interest_rate_numeric,
  l.interest_rate_numeric AS later_interest_rate_numeric,
  CASE
    WHEN e.interest_rate_state = 'REPORTED' AND e.interest_rate_numeric IS NOT NULL
     AND l.interest_rate_state = 'REPORTED' AND l.interest_rate_numeric IS NOT NULL
    THEN l.interest_rate_numeric - e.interest_rate_numeric
  END AS interest_rate_delta,
  CASE
    WHEN e.interest_rate_state = 'REPORTED' AND e.interest_rate_numeric IS NOT NULL
     AND l.interest_rate_state = 'REPORTED' AND l.interest_rate_numeric IS NOT NULL
    THEN l.interest_rate_numeric IS DISTINCT FROM e.interest_rate_numeric
  END AS interest_rate_changed,
  CASE
    WHEN e.spread_state = 'REPORTED' AND e.spread_numeric IS NOT NULL
     AND l.spread_state = 'REPORTED' AND l.spread_numeric IS NOT NULL
    THEN 'COMPARABLE'
    ELSE 'INSUFFICIENT_DATA'
  END AS spread_comparison_state,
  e.spread_raw AS earlier_spread_raw,
  l.spread_raw AS later_spread_raw,
  e.spread_numeric AS earlier_spread_numeric,
  l.spread_numeric AS later_spread_numeric,
  CASE
    WHEN e.spread_state = 'REPORTED' AND e.spread_numeric IS NOT NULL
     AND l.spread_state = 'REPORTED' AND l.spread_numeric IS NOT NULL
    THEN l.spread_numeric - e.spread_numeric
  END AS spread_delta,
  CASE
    WHEN e.spread_state = 'REPORTED' AND e.spread_numeric IS NOT NULL
     AND l.spread_state = 'REPORTED' AND l.spread_numeric IS NOT NULL
    THEN l.spread_numeric IS DISTINCT FROM e.spread_numeric
  END AS spread_changed,
  CASE
    WHEN e.interest_rate_floor_state = 'REPORTED' AND e.interest_rate_floor_numeric IS NOT NULL
     AND l.interest_rate_floor_state = 'REPORTED' AND l.interest_rate_floor_numeric IS NOT NULL
    THEN 'COMPARABLE'
    ELSE 'INSUFFICIENT_DATA'
  END AS interest_rate_floor_comparison_state,
  e.interest_rate_floor_raw AS earlier_interest_rate_floor_raw,
  l.interest_rate_floor_raw AS later_interest_rate_floor_raw,
  e.interest_rate_floor_numeric AS earlier_interest_rate_floor_numeric,
  l.interest_rate_floor_numeric AS later_interest_rate_floor_numeric,
  CASE
    WHEN e.interest_rate_floor_state = 'REPORTED' AND e.interest_rate_floor_numeric IS NOT NULL
     AND l.interest_rate_floor_state = 'REPORTED' AND l.interest_rate_floor_numeric IS NOT NULL
    THEN l.interest_rate_floor_numeric - e.interest_rate_floor_numeric
  END AS interest_rate_floor_delta,
  CASE
    WHEN e.interest_rate_floor_state = 'REPORTED' AND e.interest_rate_floor_numeric IS NOT NULL
     AND l.interest_rate_floor_state = 'REPORTED' AND l.interest_rate_floor_numeric IS NOT NULL
    THEN l.interest_rate_floor_numeric IS DISTINCT FROM e.interest_rate_floor_numeric
  END AS interest_rate_floor_changed
FROM endpoints e
JOIN endpoints l
  ON l.position_id = e.position_id
 AND l.reported_date > e.reported_date
 AND l.position_observation_id <> e.position_observation_id

LEFT JOIN LATERAL (
  SELECT CASE WHEN count(*) = 1 THEN min(fv.currency_code) END AS currency_code
  FROM obs.current_position_field_value fv
  WHERE fv.position_observation_id = e.position_observation_id
    AND fv.field_code = 'PRINCIPAL_AMOUNT'
) e_principal_ccy ON true
LEFT JOIN LATERAL (
  SELECT CASE WHEN count(*) = 1 THEN min(fv.currency_code) END AS currency_code
  FROM obs.current_position_field_value fv
  WHERE fv.position_observation_id = l.position_observation_id
    AND fv.field_code = 'PRINCIPAL_AMOUNT'
) l_principal_ccy ON true
LEFT JOIN LATERAL (
  SELECT CASE WHEN count(*) = 1 THEN min(fv.currency_code) END AS currency_code
  FROM obs.current_position_field_value fv
  WHERE fv.position_observation_id = e.position_observation_id
    AND fv.field_code = 'COST'
) e_cost_ccy ON true
LEFT JOIN LATERAL (
  SELECT CASE WHEN count(*) = 1 THEN min(fv.currency_code) END AS currency_code
  FROM obs.current_position_field_value fv
  WHERE fv.position_observation_id = l.position_observation_id
    AND fv.field_code = 'COST'
) l_cost_ccy ON true
LEFT JOIN LATERAL (
  SELECT CASE WHEN count(*) = 1 THEN min(fv.currency_code) END AS currency_code
  FROM obs.current_position_field_value fv
  WHERE fv.position_observation_id = e.position_observation_id
    AND fv.field_code = 'FAIR_VALUE'
) e_fair_value_ccy ON true
LEFT JOIN LATERAL (
  SELECT CASE WHEN count(*) = 1 THEN min(fv.currency_code) END AS currency_code
  FROM obs.current_position_field_value fv
  WHERE fv.position_observation_id = l.position_observation_id
    AND fv.field_code = 'FAIR_VALUE'
) l_fair_value_ccy ON true

WHERE NOT EXISTS (
  SELECT 1
  FROM confirmed mid
  WHERE mid.position_id = e.position_id
    AND mid.reported_date > e.reported_date
    AND mid.reported_date < l.reported_date
);

COMMENT ON VIEW registry.position_period_comparison IS
  'One comparison for one identity.position and two consecutive MATCHED observations with strictly increasing reported dates. Continuity is seeded from resolution.current_position_continuity. Both observations must be the only MATCHED observation of that position on their reporting date. Principal, cost, and fair-value deltas require reported numerics and compatible stored currency: both currency states are present and not UNKNOWN or AMBIGUOUS, both currency codes are present, and the codes are equal. Currency is not converted. A missing or incompatible currency is INSUFFICIENT_DATA and null. Observed field change is not itself a credit event. Absence of a later observation is not evidence of repayment or exit.';

COMMENT ON COLUMN registry.position_period_comparison.principal_delta IS
  'Later principal_numeric minus earlier principal_numeric when both are stored with compatible currency codes. Null when either side is missing or currency is not established. Unknown is not zero.';

COMMENT ON COLUMN registry.position_period_comparison.cost_delta IS
  'Later stored COST minus earlier stored COST when both normalized numbers are stored with compatible currency codes. Null when either side is missing or currency is not established.';

COMMENT ON COLUMN registry.position_period_comparison.fair_value_delta IS
  'Later fair_value_numeric minus earlier fair_value_numeric when both are stored with compatible currency codes. A decrease is a numeric delta, not a credit event. Null when currency is not established.';

COMMENT ON COLUMN registry.position_period_comparison.maturity_changed IS
  'True when both maturities are comparable calendar days and the days differ, or both are month precision and the year or month differs. Null when the two precisions are not comparable. A month is not converted to a day.';

COMMENT ON COLUMN registry.position_period_comparison.acquisition_comparison_state IS
  'COMPARABLE when both stored acquisition values share calendar-day precision or both share month precision. A difference is not an origination.';

COMMENT ON COLUMN registry.position_period_comparison.interest_rate_delta IS
  'Later interest_rate_numeric minus earlier interest_rate_numeric when both are stored. A reported raw rate with no normalized number is not subtracted.';

CREATE OR REPLACE FUNCTION registry.borrower_valuation_period_comparison(p_legal_entity_id uuid)
RETURNS TABLE (
  position_id uuid,
  earlier_position_observation_id bigint,
  later_position_observation_id bigint,
  earlier_reported_date date,
  later_reported_date date,
  earlier_accession_number text,
  later_accession_number text,
  earlier_observation_evidence_id bigint,
  later_observation_evidence_id bigint,
  principal_comparison_state text,
  earlier_principal_raw text,
  later_principal_raw text,
  earlier_principal_numeric numeric,
  later_principal_numeric numeric,
  principal_delta numeric,
  principal_changed boolean,
  cost_comparison_state text,
  earlier_cost_raw text,
  later_cost_raw text,
  earlier_cost_numeric numeric,
  later_cost_numeric numeric,
  cost_delta numeric,
  cost_changed boolean,
  fair_value_comparison_state text,
  earlier_fair_value_raw text,
  later_fair_value_raw text,
  earlier_fair_value_numeric numeric,
  later_fair_value_numeric numeric,
  fair_value_delta numeric,
  fair_value_changed boolean,
  maturity_comparison_state text,
  earlier_maturity_source text,
  later_maturity_source text,
  earlier_maturity_raw text,
  later_maturity_raw text,
  earlier_maturity_date date,
  later_maturity_date date,
  earlier_maturity_precision text,
  later_maturity_precision text,
  earlier_maturity_year integer,
  earlier_maturity_month integer,
  later_maturity_year integer,
  later_maturity_month integer,
  maturity_changed boolean,
  acquisition_comparison_state text,
  earlier_acquisition_raw text,
  later_acquisition_raw text,
  earlier_acquisition_date date,
  later_acquisition_date date,
  earlier_acquisition_precision text,
  later_acquisition_precision text,
  earlier_acquisition_year integer,
  earlier_acquisition_month integer,
  later_acquisition_year integer,
  later_acquisition_month integer,
  interest_rate_comparison_state text,
  earlier_interest_rate_raw text,
  later_interest_rate_raw text,
  earlier_interest_rate_numeric numeric,
  later_interest_rate_numeric numeric,
  interest_rate_delta numeric,
  interest_rate_changed boolean,
  spread_comparison_state text,
  earlier_spread_raw text,
  later_spread_raw text,
  earlier_spread_numeric numeric,
  later_spread_numeric numeric,
  spread_delta numeric,
  spread_changed boolean,
  interest_rate_floor_comparison_state text,
  earlier_interest_rate_floor_raw text,
  later_interest_rate_floor_raw text,
  earlier_interest_rate_floor_numeric numeric,
  later_interest_rate_floor_numeric numeric,
  interest_rate_floor_delta numeric,
  interest_rate_floor_changed boolean
)
LANGUAGE sql
STABLE
AS $$
  WITH entity_position_ids AS MATERIALIZED (
    SELECT DISTINCT d.position_id
    FROM registry.matched_entity_position m
    JOIN resolution.current_position_continuity d
      ON d.position_observation_id = m.position_observation_id
    WHERE m.legal_entity_id = p_legal_entity_id
      AND d.state = 'MATCHED'
      AND d.position_id IS NOT NULL
  ),
  continuity_match AS MATERIALIZED (
    SELECT d.position_observation_id
    FROM resolution.current_position_continuity d
    WHERE d.state = 'MATCHED'
      AND d.position_id IS NOT NULL
      AND d.position_id IN (SELECT e.position_id FROM entity_position_ids e)
  ),
  confirmed AS (
    SELECT r.*
    FROM continuity_match d
    JOIN LATERAL (
      SELECT pr.*
      FROM registry.position_read pr
      WHERE pr.position_observation_id = d.position_observation_id
      OFFSET 0
    ) r ON true
    WHERE r.continuity_state = 'MATCHED'
      AND r.position_id IS NOT NULL
      AND r.reported_date IS NOT NULL
  ),
  date_population AS (
    SELECT position_id, reported_date, count(*)::integer AS observation_count
    FROM confirmed
    GROUP BY position_id, reported_date
  ),
  endpoints AS (
    SELECT c.*
    FROM confirmed c
    JOIN date_population d
      ON d.position_id = c.position_id
     AND d.reported_date = c.reported_date
     AND d.observation_count = 1
  )
  SELECT
    l.position_id,
    e.position_observation_id AS earlier_position_observation_id,
    l.position_observation_id AS later_position_observation_id,
    e.reported_date AS earlier_reported_date,
    l.reported_date AS later_reported_date,
    e.accession_number AS earlier_accession_number,
    l.accession_number AS later_accession_number,
    e.observation_evidence_id AS earlier_observation_evidence_id,
    l.observation_evidence_id AS later_observation_evidence_id,
    CASE
      WHEN e.principal_state = 'REPORTED' AND e.principal_numeric IS NOT NULL
       AND l.principal_state = 'REPORTED' AND l.principal_numeric IS NOT NULL
       AND e.principal_currency_state IS NOT NULL
       AND l.principal_currency_state IS NOT NULL
       AND e.principal_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
       AND l.principal_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
       AND e_principal_ccy.currency_code IS NOT NULL
       AND l_principal_ccy.currency_code IS NOT NULL
       AND e_principal_ccy.currency_code = l_principal_ccy.currency_code
      THEN 'COMPARABLE'
      ELSE 'INSUFFICIENT_DATA'
    END AS principal_comparison_state,
    e.principal_raw AS earlier_principal_raw,
    l.principal_raw AS later_principal_raw,
    e.principal_numeric AS earlier_principal_numeric,
    l.principal_numeric AS later_principal_numeric,
    CASE
      WHEN e.principal_state = 'REPORTED' AND e.principal_numeric IS NOT NULL
       AND l.principal_state = 'REPORTED' AND l.principal_numeric IS NOT NULL
       AND e.principal_currency_state IS NOT NULL
       AND l.principal_currency_state IS NOT NULL
       AND e.principal_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
       AND l.principal_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
       AND e_principal_ccy.currency_code IS NOT NULL
       AND l_principal_ccy.currency_code IS NOT NULL
       AND e_principal_ccy.currency_code = l_principal_ccy.currency_code
      THEN l.principal_numeric - e.principal_numeric
    END AS principal_delta,
    CASE
      WHEN e.principal_state = 'REPORTED' AND e.principal_numeric IS NOT NULL
       AND l.principal_state = 'REPORTED' AND l.principal_numeric IS NOT NULL
       AND e.principal_currency_state IS NOT NULL
       AND l.principal_currency_state IS NOT NULL
       AND e.principal_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
       AND l.principal_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
       AND e_principal_ccy.currency_code IS NOT NULL
       AND l_principal_ccy.currency_code IS NOT NULL
       AND e_principal_ccy.currency_code = l_principal_ccy.currency_code
      THEN l.principal_numeric IS DISTINCT FROM e.principal_numeric
    END AS principal_changed,
    CASE
      WHEN e.cost_state = 'REPORTED' AND e.cost_numeric IS NOT NULL
       AND l.cost_state = 'REPORTED' AND l.cost_numeric IS NOT NULL
       AND e.cost_currency_state IS NOT NULL
       AND l.cost_currency_state IS NOT NULL
       AND e.cost_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
       AND l.cost_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
       AND e_cost_ccy.currency_code IS NOT NULL
       AND l_cost_ccy.currency_code IS NOT NULL
       AND e_cost_ccy.currency_code = l_cost_ccy.currency_code
      THEN 'COMPARABLE'
      ELSE 'INSUFFICIENT_DATA'
    END AS cost_comparison_state,
    e.cost_raw AS earlier_cost_raw,
    l.cost_raw AS later_cost_raw,
    e.cost_numeric AS earlier_cost_numeric,
    l.cost_numeric AS later_cost_numeric,
    CASE
      WHEN e.cost_state = 'REPORTED' AND e.cost_numeric IS NOT NULL
       AND l.cost_state = 'REPORTED' AND l.cost_numeric IS NOT NULL
       AND e.cost_currency_state IS NOT NULL
       AND l.cost_currency_state IS NOT NULL
       AND e.cost_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
       AND l.cost_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
       AND e_cost_ccy.currency_code IS NOT NULL
       AND l_cost_ccy.currency_code IS NOT NULL
       AND e_cost_ccy.currency_code = l_cost_ccy.currency_code
      THEN l.cost_numeric - e.cost_numeric
    END AS cost_delta,
    CASE
      WHEN e.cost_state = 'REPORTED' AND e.cost_numeric IS NOT NULL
       AND l.cost_state = 'REPORTED' AND l.cost_numeric IS NOT NULL
       AND e.cost_currency_state IS NOT NULL
       AND l.cost_currency_state IS NOT NULL
       AND e.cost_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
       AND l.cost_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
       AND e_cost_ccy.currency_code IS NOT NULL
       AND l_cost_ccy.currency_code IS NOT NULL
       AND e_cost_ccy.currency_code = l_cost_ccy.currency_code
      THEN l.cost_numeric IS DISTINCT FROM e.cost_numeric
    END AS cost_changed,
    CASE
      WHEN e.fair_value_state = 'REPORTED' AND e.fair_value_numeric IS NOT NULL
       AND l.fair_value_state = 'REPORTED' AND l.fair_value_numeric IS NOT NULL
       AND e.fair_value_currency_state IS NOT NULL
       AND l.fair_value_currency_state IS NOT NULL
       AND e.fair_value_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
       AND l.fair_value_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
       AND e_fair_value_ccy.currency_code IS NOT NULL
       AND l_fair_value_ccy.currency_code IS NOT NULL
       AND e_fair_value_ccy.currency_code = l_fair_value_ccy.currency_code
      THEN 'COMPARABLE'
      ELSE 'INSUFFICIENT_DATA'
    END AS fair_value_comparison_state,
    e.fair_value_raw AS earlier_fair_value_raw,
    l.fair_value_raw AS later_fair_value_raw,
    e.fair_value_numeric AS earlier_fair_value_numeric,
    l.fair_value_numeric AS later_fair_value_numeric,
    CASE
      WHEN e.fair_value_state = 'REPORTED' AND e.fair_value_numeric IS NOT NULL
       AND l.fair_value_state = 'REPORTED' AND l.fair_value_numeric IS NOT NULL
       AND e.fair_value_currency_state IS NOT NULL
       AND l.fair_value_currency_state IS NOT NULL
       AND e.fair_value_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
       AND l.fair_value_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
       AND e_fair_value_ccy.currency_code IS NOT NULL
       AND l_fair_value_ccy.currency_code IS NOT NULL
       AND e_fair_value_ccy.currency_code = l_fair_value_ccy.currency_code
      THEN l.fair_value_numeric - e.fair_value_numeric
    END AS fair_value_delta,
    CASE
      WHEN e.fair_value_state = 'REPORTED' AND e.fair_value_numeric IS NOT NULL
       AND l.fair_value_state = 'REPORTED' AND l.fair_value_numeric IS NOT NULL
       AND e.fair_value_currency_state IS NOT NULL
       AND l.fair_value_currency_state IS NOT NULL
       AND e.fair_value_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
       AND l.fair_value_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
       AND e_fair_value_ccy.currency_code IS NOT NULL
       AND l_fair_value_ccy.currency_code IS NOT NULL
       AND e_fair_value_ccy.currency_code = l_fair_value_ccy.currency_code
      THEN l.fair_value_numeric IS DISTINCT FROM e.fair_value_numeric
    END AS fair_value_changed,
    CASE
      WHEN e.maturity_date IS NOT NULL
       AND e.maturity_precision IS NULL
       AND e.maturity_source IN ('REPORTED_STRUCTURED', 'FILING_DISPLAYED')
       AND l.maturity_date IS NOT NULL
       AND l.maturity_precision IS NULL
       AND l.maturity_source IN ('REPORTED_STRUCTURED', 'FILING_DISPLAYED')
      THEN 'COMPARABLE'
      WHEN e.maturity_precision = 'MONTH'
       AND l.maturity_precision = 'MONTH'
       AND e.maturity_year IS NOT NULL
       AND e.maturity_month IS NOT NULL
       AND l.maturity_year IS NOT NULL
       AND l.maturity_month IS NOT NULL
       AND e.maturity_source IN ('REPORTED_MONTH', 'FILING_MONTH')
       AND l.maturity_source IN ('REPORTED_MONTH', 'FILING_MONTH')
      THEN 'COMPARABLE'
      ELSE 'INSUFFICIENT_DATA'
    END AS maturity_comparison_state,
    e.maturity_source AS earlier_maturity_source,
    l.maturity_source AS later_maturity_source,
    e.maturity_raw AS earlier_maturity_raw,
    l.maturity_raw AS later_maturity_raw,
    e.maturity_date AS earlier_maturity_date,
    l.maturity_date AS later_maturity_date,
    e.maturity_precision AS earlier_maturity_precision,
    l.maturity_precision AS later_maturity_precision,
    e.maturity_year AS earlier_maturity_year,
    e.maturity_month AS earlier_maturity_month,
    l.maturity_year AS later_maturity_year,
    l.maturity_month AS later_maturity_month,
    CASE
      WHEN e.maturity_date IS NOT NULL
       AND e.maturity_precision IS NULL
       AND e.maturity_source IN ('REPORTED_STRUCTURED', 'FILING_DISPLAYED')
       AND l.maturity_date IS NOT NULL
       AND l.maturity_precision IS NULL
       AND l.maturity_source IN ('REPORTED_STRUCTURED', 'FILING_DISPLAYED')
      THEN e.maturity_date IS DISTINCT FROM l.maturity_date
      WHEN e.maturity_precision = 'MONTH'
       AND l.maturity_precision = 'MONTH'
       AND e.maturity_year IS NOT NULL
       AND e.maturity_month IS NOT NULL
       AND l.maturity_year IS NOT NULL
       AND l.maturity_month IS NOT NULL
       AND e.maturity_source IN ('REPORTED_MONTH', 'FILING_MONTH')
       AND l.maturity_source IN ('REPORTED_MONTH', 'FILING_MONTH')
      THEN e.maturity_year IS DISTINCT FROM l.maturity_year
        OR e.maturity_month IS DISTINCT FROM l.maturity_month
    END AS maturity_changed,
    CASE
      WHEN e.acquisition_state = 'REPORTED'
       AND e.acquisition_date IS NOT NULL
       AND e.acquisition_precision IS NULL
       AND l.acquisition_state = 'REPORTED'
       AND l.acquisition_date IS NOT NULL
       AND l.acquisition_precision IS NULL
      THEN 'COMPARABLE'
      WHEN e.acquisition_state = 'REPORTED'
       AND e.acquisition_precision = 'MONTH'
       AND e.acquisition_year IS NOT NULL
       AND e.acquisition_month IS NOT NULL
       AND l.acquisition_state = 'REPORTED'
       AND l.acquisition_precision = 'MONTH'
       AND l.acquisition_year IS NOT NULL
       AND l.acquisition_month IS NOT NULL
      THEN 'COMPARABLE'
      ELSE 'INSUFFICIENT_DATA'
    END AS acquisition_comparison_state,
    e.acquisition_raw AS earlier_acquisition_raw,
    l.acquisition_raw AS later_acquisition_raw,
    e.acquisition_date AS earlier_acquisition_date,
    l.acquisition_date AS later_acquisition_date,
    e.acquisition_precision AS earlier_acquisition_precision,
    l.acquisition_precision AS later_acquisition_precision,
    e.acquisition_year AS earlier_acquisition_year,
    e.acquisition_month AS earlier_acquisition_month,
    l.acquisition_year AS later_acquisition_year,
    l.acquisition_month AS later_acquisition_month,
    CASE
      WHEN e.interest_rate_state = 'REPORTED' AND e.interest_rate_numeric IS NOT NULL
       AND l.interest_rate_state = 'REPORTED' AND l.interest_rate_numeric IS NOT NULL
      THEN 'COMPARABLE'
      ELSE 'INSUFFICIENT_DATA'
    END AS interest_rate_comparison_state,
    e.interest_rate_raw AS earlier_interest_rate_raw,
    l.interest_rate_raw AS later_interest_rate_raw,
    e.interest_rate_numeric AS earlier_interest_rate_numeric,
    l.interest_rate_numeric AS later_interest_rate_numeric,
    CASE
      WHEN e.interest_rate_state = 'REPORTED' AND e.interest_rate_numeric IS NOT NULL
       AND l.interest_rate_state = 'REPORTED' AND l.interest_rate_numeric IS NOT NULL
      THEN l.interest_rate_numeric - e.interest_rate_numeric
    END AS interest_rate_delta,
    CASE
      WHEN e.interest_rate_state = 'REPORTED' AND e.interest_rate_numeric IS NOT NULL
       AND l.interest_rate_state = 'REPORTED' AND l.interest_rate_numeric IS NOT NULL
      THEN l.interest_rate_numeric IS DISTINCT FROM e.interest_rate_numeric
    END AS interest_rate_changed,
    CASE
      WHEN e.spread_state = 'REPORTED' AND e.spread_numeric IS NOT NULL
       AND l.spread_state = 'REPORTED' AND l.spread_numeric IS NOT NULL
      THEN 'COMPARABLE'
      ELSE 'INSUFFICIENT_DATA'
    END AS spread_comparison_state,
    e.spread_raw AS earlier_spread_raw,
    l.spread_raw AS later_spread_raw,
    e.spread_numeric AS earlier_spread_numeric,
    l.spread_numeric AS later_spread_numeric,
    CASE
      WHEN e.spread_state = 'REPORTED' AND e.spread_numeric IS NOT NULL
       AND l.spread_state = 'REPORTED' AND l.spread_numeric IS NOT NULL
      THEN l.spread_numeric - e.spread_numeric
    END AS spread_delta,
    CASE
      WHEN e.spread_state = 'REPORTED' AND e.spread_numeric IS NOT NULL
       AND l.spread_state = 'REPORTED' AND l.spread_numeric IS NOT NULL
      THEN l.spread_numeric IS DISTINCT FROM e.spread_numeric
    END AS spread_changed,
    CASE
      WHEN e.interest_rate_floor_state = 'REPORTED' AND e.interest_rate_floor_numeric IS NOT NULL
       AND l.interest_rate_floor_state = 'REPORTED' AND l.interest_rate_floor_numeric IS NOT NULL
      THEN 'COMPARABLE'
      ELSE 'INSUFFICIENT_DATA'
    END AS interest_rate_floor_comparison_state,
    e.interest_rate_floor_raw AS earlier_interest_rate_floor_raw,
    l.interest_rate_floor_raw AS later_interest_rate_floor_raw,
    e.interest_rate_floor_numeric AS earlier_interest_rate_floor_numeric,
    l.interest_rate_floor_numeric AS later_interest_rate_floor_numeric,
    CASE
      WHEN e.interest_rate_floor_state = 'REPORTED' AND e.interest_rate_floor_numeric IS NOT NULL
       AND l.interest_rate_floor_state = 'REPORTED' AND l.interest_rate_floor_numeric IS NOT NULL
      THEN l.interest_rate_floor_numeric - e.interest_rate_floor_numeric
    END AS interest_rate_floor_delta,
    CASE
      WHEN e.interest_rate_floor_state = 'REPORTED' AND e.interest_rate_floor_numeric IS NOT NULL
       AND l.interest_rate_floor_state = 'REPORTED' AND l.interest_rate_floor_numeric IS NOT NULL
      THEN l.interest_rate_floor_numeric IS DISTINCT FROM e.interest_rate_floor_numeric
    END AS interest_rate_floor_changed
  FROM endpoints e
  JOIN endpoints l
    ON l.position_id = e.position_id
   AND l.reported_date > e.reported_date
   AND l.position_observation_id <> e.position_observation_id
  LEFT JOIN LATERAL (
    SELECT CASE WHEN count(*) = 1 THEN min(fv.currency_code) END AS currency_code
    FROM obs.current_position_field_value fv
    WHERE fv.position_observation_id = e.position_observation_id
      AND fv.field_code = 'PRINCIPAL_AMOUNT'
  ) e_principal_ccy ON true
  LEFT JOIN LATERAL (
    SELECT CASE WHEN count(*) = 1 THEN min(fv.currency_code) END AS currency_code
    FROM obs.current_position_field_value fv
    WHERE fv.position_observation_id = l.position_observation_id
      AND fv.field_code = 'PRINCIPAL_AMOUNT'
  ) l_principal_ccy ON true
  LEFT JOIN LATERAL (
    SELECT CASE WHEN count(*) = 1 THEN min(fv.currency_code) END AS currency_code
    FROM obs.current_position_field_value fv
    WHERE fv.position_observation_id = e.position_observation_id
      AND fv.field_code = 'COST'
  ) e_cost_ccy ON true
  LEFT JOIN LATERAL (
    SELECT CASE WHEN count(*) = 1 THEN min(fv.currency_code) END AS currency_code
    FROM obs.current_position_field_value fv
    WHERE fv.position_observation_id = l.position_observation_id
      AND fv.field_code = 'COST'
  ) l_cost_ccy ON true
  LEFT JOIN LATERAL (
    SELECT CASE WHEN count(*) = 1 THEN min(fv.currency_code) END AS currency_code
    FROM obs.current_position_field_value fv
    WHERE fv.position_observation_id = e.position_observation_id
      AND fv.field_code = 'FAIR_VALUE'
  ) e_fair_value_ccy ON true
  LEFT JOIN LATERAL (
    SELECT CASE WHEN count(*) = 1 THEN min(fv.currency_code) END AS currency_code
    FROM obs.current_position_field_value fv
    WHERE fv.position_observation_id = l.position_observation_id
      AND fv.field_code = 'FAIR_VALUE'
  ) l_fair_value_ccy ON true
  WHERE NOT EXISTS (
    SELECT 1
    FROM confirmed mid
    WHERE mid.position_id = e.position_id
      AND mid.reported_date > e.reported_date
      AND mid.reported_date < l.reported_date
  )
$$;

COMMENT ON FUNCTION registry.borrower_valuation_period_comparison(uuid) IS
  'Entity-scoped consecutive MATCHED position comparisons for valuation.position_history.v1. Continuity is seeded from position_ids already MATCHED to the requested legal entity on registry.matched_entity_position, then confirmed observations, single-date endpoints, and consecutive pairs follow the same rules as registry.position_period_comparison. Principal, cost, and fair-value deltas require reported numerics and compatible stored currency codes (same non-null code; currency state not UNKNOWN or AMBIGUOUS). Currency is not converted. The global comparison view is unchanged by this function body. Unknown is not zero.';

REVOKE ALL ON FUNCTION registry.borrower_valuation_period_comparison(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION registry.borrower_valuation_period_comparison(uuid) TO bdc_reader;

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
  WITH entity_cmp AS MATERIALIZED (
    SELECT c.position_id,
           c.later_position_observation_id,
           c.earlier_position_observation_id,
           c.earlier_reported_date,
           c.fair_value_comparison_state,
           c.fair_value_delta,
           c.earlier_fair_value_numeric
    FROM registry.borrower_valuation_period_comparison(p_legal_entity_id) c
  )
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
            AND cmp.fair_value_comparison_state = 'COMPARABLE'
           THEN 'COMPARABLE'
           ELSE 'INSUFFICIENT_DATA'
         END,
         CASE
           WHEN r.instrument_resolution_state = 'MATCHED'
            AND r.continuity_state = 'MATCHED'
            AND cmp.fair_value_comparison_state = 'COMPARABLE'
           THEN cmp.fair_value_delta::text
         END,
         CASE
           WHEN r.instrument_resolution_state = 'MATCHED'
            AND r.continuity_state = 'MATCHED'
            AND cmp.fair_value_comparison_state = 'COMPARABLE'
            AND cmp.fair_value_delta IS NOT NULL
            AND cmp.earlier_fair_value_numeric IS NOT NULL
            AND cmp.earlier_fair_value_numeric <> 0
            AND r.fair_value_currency_state IS NOT NULL
            AND cmp.earlier_fair_value_currency_state IS NOT NULL
            AND r.fair_value_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
            AND cmp.earlier_fair_value_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
            AND fair_value_code.currency_code IS NOT NULL
            AND cmp.earlier_fair_value_currency_code IS NOT NULL
            AND fair_value_code.currency_code = cmp.earlier_fair_value_currency_code
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
            AND r.fair_value_currency_state IS NOT NULL
            AND cmp.earlier_fair_value_currency_state IS NOT NULL
            AND r.fair_value_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
            AND cmp.earlier_fair_value_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
            AND fair_value_code.currency_code IS NOT NULL
            AND cmp.earlier_fair_value_currency_code IS NOT NULL
            AND fair_value_code.currency_code = cmp.earlier_fair_value_currency_code
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
    FROM entity_cmp c
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
  'Historical valuation for one legal entity under valuation.position_history.v1. The legal entity filter is applied before registry.position_read. A fair-value delta is copied from registry.borrower_valuation_period_comparison only when that comparison is COMPARABLE, which requires compatible stored currency codes. The percentage uses that delta divided by the earlier fair_value_numeric, times 100, rounded to 6 decimal places, only when the earlier number is stored and not zero and currency is established. Fair value / principal and fair value / cost use the stored numerics on one observation and require a non-zero denominator. An unresolved instrument does not receive those figures. Different stored currency codes are not combined. Unknown or missing currency does not become comparable. Currency is not converted. cross_bdc_comparison_state stays UNAVAILABLE. Unknown is not zero.';

REVOKE ALL ON FUNCTION registry.borrower_position_valuation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION registry.borrower_position_valuation(uuid) TO bdc_reader;

SELECT ops.grant_layer_privileges();
