-- 0041 confirmed position period comparison.
-- One row per consecutive pair of MATCHED observations of the same identity.position.
-- Continuity is the current position_continuity_decision. UNRESOLVED, REJECTED,
-- PROBABLE, and a missing decision are not pairs. A date with more than one
-- MATCHED observation is not an endpoint and blocks a pair across it.
-- Numeric delta is later minus earlier only when both sides have one stored
-- normalized number. A missing number stays null. Month maturity stays a month.
-- This view does not insert derived.observation_event rows.

CREATE VIEW registry.position_period_comparison AS
WITH confirmed AS (
  SELECT *
  FROM registry.position_read
  WHERE continuity_state = 'MATCHED'
    AND position_id IS NOT NULL
    AND reported_date IS NOT NULL
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
    THEN l.principal_numeric - e.principal_numeric
  END AS principal_delta,
  CASE
    WHEN e.principal_state = 'REPORTED' AND e.principal_numeric IS NOT NULL
     AND l.principal_state = 'REPORTED' AND l.principal_numeric IS NOT NULL
    THEN l.principal_numeric IS DISTINCT FROM e.principal_numeric
  END AS principal_changed,
  CASE
    WHEN e.cost_state = 'REPORTED' AND e.cost_numeric IS NOT NULL
     AND l.cost_state = 'REPORTED' AND l.cost_numeric IS NOT NULL
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
    THEN l.cost_numeric - e.cost_numeric
  END AS cost_delta,
  CASE
    WHEN e.cost_state = 'REPORTED' AND e.cost_numeric IS NOT NULL
     AND l.cost_state = 'REPORTED' AND l.cost_numeric IS NOT NULL
    THEN l.cost_numeric IS DISTINCT FROM e.cost_numeric
  END AS cost_changed,
  CASE
    WHEN e.fair_value_state = 'REPORTED' AND e.fair_value_numeric IS NOT NULL
     AND l.fair_value_state = 'REPORTED' AND l.fair_value_numeric IS NOT NULL
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
    THEN l.fair_value_numeric - e.fair_value_numeric
  END AS fair_value_delta,
  CASE
    WHEN e.fair_value_state = 'REPORTED' AND e.fair_value_numeric IS NOT NULL
     AND l.fair_value_state = 'REPORTED' AND l.fair_value_numeric IS NOT NULL
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
WHERE NOT EXISTS (
  SELECT 1
  FROM confirmed mid
  WHERE mid.position_id = e.position_id
    AND mid.reported_date > e.reported_date
    AND mid.reported_date < l.reported_date
);

COMMENT ON VIEW registry.position_period_comparison IS
  'One comparison for one identity.position and two consecutive MATCHED observations with strictly increasing reported dates. Both observations must be the only MATCHED observation of that position on their reporting date. Delta is later normalized value minus earlier normalized value when both are stored. A missing value is INSUFFICIENT_DATA and null. Observed field change is not itself a credit event. Absence of a later observation is not evidence of repayment or exit.';

COMMENT ON COLUMN registry.position_period_comparison.principal_delta IS
  'Later principal_numeric minus earlier principal_numeric when both are stored. Null when either side is missing. Unknown is not zero.';

COMMENT ON COLUMN registry.position_period_comparison.cost_delta IS
  'Later stored COST minus earlier stored COST when both normalized numbers are stored. Null when either side is missing.';

COMMENT ON COLUMN registry.position_period_comparison.fair_value_delta IS
  'Later fair_value_numeric minus earlier fair_value_numeric when both are stored. A decrease is a numeric delta, not a credit event.';

COMMENT ON COLUMN registry.position_period_comparison.maturity_changed IS
  'True when both maturities are comparable calendar days and the days differ, or both are month precision and the year or month differs. Null when the two precisions are not comparable. A month is not converted to a day.';

COMMENT ON COLUMN registry.position_period_comparison.acquisition_comparison_state IS
  'COMPARABLE when both stored acquisition values share calendar-day precision or both share month precision. A difference is not an origination.';

COMMENT ON COLUMN registry.position_period_comparison.interest_rate_delta IS
  'Later interest_rate_numeric minus earlier interest_rate_numeric when both are stored. A reported raw rate with no normalized number is not subtracted.';

SELECT ops.grant_layer_privileges();
