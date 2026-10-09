-- Group 40: registry.position_period_comparison. Fake names and 2099 dates only.
-- Pairs come from stored MATCHED continuity on one identity.position.

CREATE FUNCTION pg_temp.l2_evidence() RETURNS bigint
LANGUAGE sql AS $$
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, run_id)
  VALUES ('L2_ORIGINAL_FILING', pg_temp.fx('artifact'), 'DOCUMENT', pg_temp.fx('run'))
  RETURNING id
$$;

CREATE FUNCTION pg_temp.l2_money(pos_key text, field_code text, raw text, amount numeric) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO obs.position_field_value (
      position_observation_id, field_code, raw_value, normalized_numeric,
      currency_state, scale_state, value_state,
      normalization_rule_version_id, evidence_id, run_id)
  VALUES (pg_temp.fx(pos_key), field_code, raw, amount,
          'UNKNOWN', 'NOT_APPLICABLE', 'REPORTED',
          pg_temp.fx('r_field'), pg_temp.l2_evidence(), pg_temp.fx('run'))
$$;

CREATE FUNCTION pg_temp.l2_coded_money(
  pos_key text, field_code text, raw text, amount numeric, code text
) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO obs.position_field_value (
      position_observation_id, field_code, raw_value, normalized_numeric,
      currency_code, currency_state, scale_state, value_state,
      normalization_rule_version_id, evidence_id, run_id)
  VALUES (pg_temp.fx(pos_key), field_code, raw, amount,
          code, 'FROM_FILING', 'NOT_APPLICABLE', 'REPORTED',
          pg_temp.fx('r_field'), pg_temp.l2_evidence(), pg_temp.fx('run'))
$$;

CREATE FUNCTION pg_temp.l2_ambiguous_money(
  pos_key text, field_code text, raw text, amount numeric
) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO obs.position_field_value (
      position_observation_id, field_code, raw_value, normalized_numeric,
      currency_state, scale_state, value_state,
      normalization_rule_version_id, evidence_id, run_id)
  VALUES (pg_temp.fx(pos_key), field_code, raw, amount,
          'AMBIGUOUS', 'NOT_APPLICABLE', 'REPORTED',
          pg_temp.fx('r_field'), pg_temp.l2_evidence(), pg_temp.fx('run'))
$$;

CREATE FUNCTION pg_temp.l2_rate(pos_key text, field_code text, raw text, amount numeric) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO obs.position_field_value (
      position_observation_id, field_code, raw_value, normalized_numeric,
      currency_state, scale_state, value_state,
      normalization_rule_version_id, evidence_id, run_id)
  VALUES (pg_temp.fx(pos_key), field_code, raw, amount,
          'UNKNOWN', 'NOT_APPLICABLE', 'REPORTED',
          pg_temp.fx('r_field'), pg_temp.l2_evidence(), pg_temp.fx('run'))
$$;

CREATE FUNCTION pg_temp.l2_unresolved_rate(pos_key text, field_code text, raw text) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO obs.position_field_value (
      position_observation_id, field_code, raw_value,
      currency_state, scale_state, value_state,
      normalization_rule_version_id, evidence_id, run_id)
  VALUES (pg_temp.fx(pos_key), field_code, raw,
          'UNKNOWN', 'UNRESOLVED', 'REPORTED',
          pg_temp.fx('r_field'), pg_temp.l2_evidence(), pg_temp.fx('run'))
$$;

CREATE FUNCTION pg_temp.l2_calendar(pos_key text, field_code text, raw text, d date) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO obs.position_field_value (
      position_observation_id, field_code, raw_value, normalized_date,
      currency_state, scale_state, value_state,
      normalization_rule_version_id, evidence_id, run_id)
  VALUES (pg_temp.fx(pos_key), field_code, raw, d,
          'UNKNOWN', 'NOT_APPLICABLE', 'REPORTED',
          pg_temp.fx('r_field'), pg_temp.l2_evidence(), pg_temp.fx('run'))
$$;

CREATE FUNCTION pg_temp.l2_month(pos_key text, field_code text, raw text, y integer, m integer) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO obs.position_field_value (
      position_observation_id, field_code, raw_value, date_precision,
      normalized_year, normalized_month, currency_state, scale_state, value_state,
      normalization_rule_version_id, evidence_id, run_id)
  VALUES (pg_temp.fx(pos_key), field_code, raw, 'MONTH', y, m,
          'UNKNOWN', 'NOT_APPLICABLE', 'REPORTED',
          pg_temp.fx('r_field'), pg_temp.l2_evidence(), pg_temp.fx('run'))
$$;

CREATE FUNCTION pg_temp.series_position(pos_key text, ident text, line_no bigint, reported text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  acc constant text := '0000000000-00-000001';
  row_id bigint;
  ev_row bigint;
  soi_id bigint;
  po_id bigint;
  line text;
BEGIN
  line := acc || E'\t9999999901\tTEST BDC 1\t' || reported || E'\t0\t' || ident || E'\t\t\t\t\t';
  row_id := pg_temp.add_row(pg_temp.fx('l_soi'), line_no, line);
  ev_row := pg_temp.add_evidence('L1_STRUCTURED_DATASET', pg_temp.fx('artifact'), row_id);
  INSERT INTO obs.soi_row_observation (
      tabular_row_id, filing_id, reported_date_raw, reported_date, date_precision,
      qtrs_raw, qtrs, duration_kind, identifier_raw, rule_version_id, evidence_id, run_id)
  VALUES (row_id, pg_temp.fx('filing'), reported, reported::date, 'MONTH_END_ROUNDED', '0', 0,
          'POINT_IN_TIME', ident, pg_temp.fx('r_project'), ev_row, pg_temp.fx('run'))
  RETURNING id INTO soi_id;
  INSERT INTO obs.soi_row_classification (soi_row_observation_id, row_kind, period_role, rule_version_id, run_id)
  VALUES (soi_id, 'IDENTIFIER_ROW', 'UNRESOLVED', pg_temp.fx('r_classify'), pg_temp.fx('run'));
  INSERT INTO obs.position_observation (
      origin_soi_row_observation_id, filing_id, reported_date, date_precision, duration_kind,
      holding_descriptor_raw, rule_version_id, evidence_id, run_id)
  VALUES (soi_id, pg_temp.fx('filing'), reported::date, 'MONTH_END_ROUNDED', 'POINT_IN_TIME',
          ident, pg_temp.fx('r_position'), ev_row, pg_temp.fx('run'))
  RETURNING id INTO po_id;
  INSERT INTO obs.position_observation_source (position_observation_id, soi_row_observation_id, source_role, run_id)
  VALUES (po_id, soi_id, 'PRIMARY', pg_temp.fx('run'));
  PERFORM pg_temp.put(pos_key, po_id);
END
$$;

CREATE FUNCTION pg_temp.add_position(reason text) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO identity.position (registrant_id, creation_reason, run_id)
  VALUES (pg_temp.fx('registrant'), reason, pg_temp.fx('run'))
$$;

CREATE FUNCTION pg_temp.link_continuity(pos_key text, reason text, state text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF state = 'UNRESOLVED' THEN
    INSERT INTO resolution.position_continuity_decision (
        position_observation_id, position_id, state, method, rationale,
        actor_kind, decided_by, decided_at, rule_version_id, evidence_id, run_id)
    VALUES (pg_temp.fx(pos_key), NULL, 'UNRESOLVED'::ref.resolution_state,
            'UNKNOWN_CONTINUITY', 'TEST ONLY: unresolved continuity',
            'SYSTEM_RULE', 'db tests', now(),
            pg_temp.fx('r_resolve'), pg_temp.fx('e_soi_a'), pg_temp.fx('run'));
  ELSE
    INSERT INTO resolution.position_continuity_decision (
        position_observation_id, position_id, state, method, rationale,
        actor_kind, decided_by, decided_at, rule_version_id, evidence_id, run_id)
    SELECT pg_temp.fx(pos_key), p.id, state::ref.resolution_state,
           'SAME_REGISTRANT_AND_INSTRUMENT', 'TEST ONLY: stored continuity',
           'SYSTEM_RULE', 'db tests', now(),
           pg_temp.fx('r_resolve'), pg_temp.fx('e_soi_a'), pg_temp.fx('run')
    FROM identity.position p
    WHERE p.creation_reason = reason;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'missing test position %', reason;
    END IF;
  END IF;
END
$$;

SELECT pg_temp.series_position('po_mar', 'TEST COMPARISON SERIES | MAR', 80, '2099-03-31');
SELECT pg_temp.series_position('po_jun', 'TEST COMPARISON SERIES | JUN', 81, '2099-06-30');
SELECT pg_temp.series_position('po_sep', 'TEST COMPARISON SERIES | SEP', 82, '2099-09-30');
SELECT pg_temp.series_position('po_m1', 'TEST COMPARISON MONTH | EARLIER', 83, '2099-03-31');
SELECT pg_temp.series_position('po_m2', 'TEST COMPARISON MONTH | LATER', 84, '2099-06-30');
SELECT pg_temp.series_position('po_same_a', 'TEST COMPARISON SAME DATE | A', 85, '2099-12-31');
SELECT pg_temp.series_position('po_same_b', 'TEST COMPARISON SAME DATE | B', 86, '2099-12-31');
SELECT pg_temp.series_position('po_unres', 'TEST COMPARISON UNRESOLVED', 87, '2099-03-31');
SELECT pg_temp.series_position('po_rej_a', 'TEST COMPARISON REJECTED | A', 88, '2099-03-31');
SELECT pg_temp.series_position('po_rej_b', 'TEST COMPARISON REJECTED | B', 89, '2099-06-30');
SELECT pg_temp.series_position('po_miss_a', 'TEST COMPARISON MISSING | A', 90, '2099-03-31');
SELECT pg_temp.series_position('po_miss_b', 'TEST COMPARISON MISSING | B', 91, '2099-06-30');
SELECT pg_temp.series_position('po_only', 'TEST COMPARISON ONLY ONE', 92, '2099-03-31');
SELECT pg_temp.series_position('po_prob_a', 'TEST COMPARISON PROBABLE | A', 93, '2099-03-31');
SELECT pg_temp.series_position('po_prob_b', 'TEST COMPARISON PROBABLE | B', 94, '2099-06-30');
SELECT pg_temp.series_position('po_raw_a', 'TEST COMPARISON RAW RATE | A', 95, '2099-03-31');
SELECT pg_temp.series_position('po_raw_b', 'TEST COMPARISON RAW RATE | B', 96, '2099-06-30');
SELECT pg_temp.series_position('po_ccy_a', 'TEST COMPARISON CURRENCY | A', 97, '2099-03-31');
SELECT pg_temp.series_position('po_ccy_b', 'TEST COMPARISON CURRENCY | B', 98, '2099-06-30');
SELECT pg_temp.series_position('po_unk_a', 'TEST COMPARISON UNKNOWN CCY | A', 99, '2099-03-31');
SELECT pg_temp.series_position('po_unk_b', 'TEST COMPARISON UNKNOWN CCY | B', 100, '2099-06-30');
SELECT pg_temp.series_position('po_amb_a', 'TEST COMPARISON AMBIGUOUS CCY | A', 101, '2099-03-31');
SELECT pg_temp.series_position('po_amb_b', 'TEST COMPARISON AMBIGUOUS CCY | B', 102, '2099-06-30');

SELECT pg_temp.l2_coded_money('po_mar', 'PRINCIPAL_AMOUNT', '100', 100, 'AAA');
SELECT pg_temp.l2_coded_money('po_mar', 'COST', '80', 80, 'AAA');
SELECT pg_temp.l2_coded_money('po_mar', 'FAIR_VALUE', '70', 70, 'AAA');
SELECT pg_temp.l2_rate('po_mar', 'INTEREST_RATE', '0.05', 0.05);
SELECT pg_temp.l2_rate('po_mar', 'SPREAD', '0.01', 0.01);
SELECT pg_temp.l2_rate('po_mar', 'INTEREST_RATE_FLOOR', '0.04', 0.04);
SELECT pg_temp.l2_calendar('po_mar', 'MATURITY_DATE', '2099-06-15', DATE '2099-06-15');
SELECT pg_temp.l2_calendar('po_mar', 'ACQUISITION_DATE', '2099-01-15', DATE '2099-01-15');

SELECT pg_temp.l2_coded_money('po_jun', 'PRINCIPAL_AMOUNT', '120', 120, 'AAA');
SELECT pg_temp.l2_coded_money('po_jun', 'COST', '90', 90, 'AAA');
SELECT pg_temp.l2_coded_money('po_jun', 'FAIR_VALUE', '60', 60, 'AAA');
SELECT pg_temp.l2_rate('po_jun', 'INTEREST_RATE', '0.06', 0.06);
SELECT pg_temp.l2_rate('po_jun', 'SPREAD', '0.02', 0.02);
SELECT pg_temp.l2_rate('po_jun', 'INTEREST_RATE_FLOOR', '0.05', 0.05);
SELECT pg_temp.l2_calendar('po_jun', 'MATURITY_DATE', '2099-12-15', DATE '2099-12-15');
SELECT pg_temp.l2_calendar('po_jun', 'ACQUISITION_DATE', '2099-01-15', DATE '2099-01-15');

SELECT pg_temp.l2_money('po_sep', 'COST', '90', 90);
SELECT pg_temp.l2_rate('po_sep', 'INTEREST_RATE', '0.06', 0.06);
SELECT pg_temp.l2_rate('po_sep', 'INTEREST_RATE_FLOOR', '0.05', 0.05);
SELECT pg_temp.l2_month('po_sep', 'MATURITY_DATE', '12/2099', 2099, 12);
SELECT pg_temp.l2_month('po_sep', 'ACQUISITION_DATE', '04/2099', 2099, 4);

SELECT pg_temp.l2_month('po_m1', 'MATURITY_DATE', '12/2099', 2099, 12);
SELECT pg_temp.l2_month('po_m2', 'MATURITY_DATE', '06/2100', 2100, 6);

SELECT pg_temp.l2_unresolved_rate('po_raw_a', 'INTEREST_RATE', '0.05');
SELECT pg_temp.l2_unresolved_rate('po_raw_b', 'INTEREST_RATE', '0.07');

SELECT pg_temp.l2_coded_money('po_ccy_a', 'PRINCIPAL_AMOUNT', '10', 10, 'AAA');
SELECT pg_temp.l2_coded_money('po_ccy_a', 'FAIR_VALUE', '8', 8, 'AAA');
SELECT pg_temp.l2_coded_money('po_ccy_b', 'PRINCIPAL_AMOUNT', '25', 25, 'BBB');
SELECT pg_temp.l2_coded_money('po_ccy_b', 'FAIR_VALUE', '20', 20, 'BBB');
SELECT pg_temp.l2_money('po_unk_a', 'PRINCIPAL_AMOUNT', '10', 10);
SELECT pg_temp.l2_money('po_unk_a', 'FAIR_VALUE', '8', 8);
SELECT pg_temp.l2_money('po_unk_b', 'PRINCIPAL_AMOUNT', '25', 25);
SELECT pg_temp.l2_money('po_unk_b', 'FAIR_VALUE', '20', 20);
SELECT pg_temp.l2_ambiguous_money('po_amb_a', 'PRINCIPAL_AMOUNT', '10', 10);
SELECT pg_temp.l2_ambiguous_money('po_amb_a', 'COST', '9', 9);
SELECT pg_temp.l2_ambiguous_money('po_amb_a', 'FAIR_VALUE', '8', 8);
SELECT pg_temp.l2_ambiguous_money('po_amb_b', 'PRINCIPAL_AMOUNT', '25', 25);
SELECT pg_temp.l2_ambiguous_money('po_amb_b', 'COST', '22', 22);
SELECT pg_temp.l2_ambiguous_money('po_amb_b', 'FAIR_VALUE', '20', 20);

SELECT pg_temp.add_position('TEST ONLY comparison series');
SELECT pg_temp.add_position('TEST ONLY comparison month');
SELECT pg_temp.add_position('TEST ONLY comparison same date');
SELECT pg_temp.add_position('TEST ONLY comparison rejected');
SELECT pg_temp.add_position('TEST ONLY comparison probable');
SELECT pg_temp.add_position('TEST ONLY comparison only');
SELECT pg_temp.add_position('TEST ONLY comparison raw rate');
SELECT pg_temp.add_position('TEST ONLY comparison currency mismatch');
SELECT pg_temp.add_position('TEST ONLY comparison unknown currency');
SELECT pg_temp.add_position('TEST ONLY comparison ambiguous currency');

SELECT pg_temp.link_continuity('po_mar', 'TEST ONLY comparison series', 'MATCHED');
SELECT pg_temp.link_continuity('po_jun', 'TEST ONLY comparison series', 'MATCHED');
SELECT pg_temp.link_continuity('po_sep', 'TEST ONLY comparison series', 'MATCHED');
SELECT pg_temp.link_continuity('po_m1', 'TEST ONLY comparison month', 'MATCHED');
SELECT pg_temp.link_continuity('po_m2', 'TEST ONLY comparison month', 'MATCHED');
SELECT pg_temp.link_continuity('po_same_a', 'TEST ONLY comparison same date', 'MATCHED');
SELECT pg_temp.link_continuity('po_same_b', 'TEST ONLY comparison same date', 'MATCHED');
SELECT pg_temp.link_continuity('po_unres', NULL, 'UNRESOLVED');
SELECT pg_temp.link_continuity('po_rej_a', 'TEST ONLY comparison rejected', 'REJECTED');
SELECT pg_temp.link_continuity('po_rej_b', 'TEST ONLY comparison rejected', 'REJECTED');
SELECT pg_temp.link_continuity('po_only', 'TEST ONLY comparison only', 'MATCHED');
SELECT pg_temp.link_continuity('po_prob_a', 'TEST ONLY comparison probable', 'PROBABLE');
SELECT pg_temp.link_continuity('po_prob_b', 'TEST ONLY comparison probable', 'PROBABLE');
SELECT pg_temp.link_continuity('po_raw_a', 'TEST ONLY comparison raw rate', 'MATCHED');
SELECT pg_temp.link_continuity('po_raw_b', 'TEST ONLY comparison raw rate', 'MATCHED');
SELECT pg_temp.link_continuity('po_ccy_a', 'TEST ONLY comparison currency mismatch', 'MATCHED');
SELECT pg_temp.link_continuity('po_ccy_b', 'TEST ONLY comparison currency mismatch', 'MATCHED');
SELECT pg_temp.link_continuity('po_unk_a', 'TEST ONLY comparison unknown currency', 'MATCHED');
SELECT pg_temp.link_continuity('po_unk_b', 'TEST ONLY comparison unknown currency', 'MATCHED');
SELECT pg_temp.link_continuity('po_amb_a', 'TEST ONLY comparison ambiguous currency', 'MATCHED');
SELECT pg_temp.link_continuity('po_amb_b', 'TEST ONLY comparison ambiguous currency', 'MATCHED');

SELECT pg_temp.check('1: one confirmed series produces the consecutive pairs only', (
  SELECT count(*) = 2
     AND count(*) FILTER (
       WHERE earlier_position_observation_id = pg_temp.fx('po_mar')
         AND later_position_observation_id = pg_temp.fx('po_jun')) = 1
     AND count(*) FILTER (
       WHERE earlier_position_observation_id = pg_temp.fx('po_jun')
         AND later_position_observation_id = pg_temp.fx('po_sep')) = 1
  FROM registry.position_period_comparison
  WHERE position_id = (
    SELECT id FROM identity.position WHERE creation_reason = 'TEST ONLY comparison series')));

SELECT pg_temp.check('2: earlier reporting date is strictly before the later date', (
  SELECT count(*) = 7
     AND bool_and(earlier_reported_date < later_reported_date)
  FROM registry.position_period_comparison));

SELECT pg_temp.check('3: an observation is not compared with itself', (
  SELECT count(*) = 0
  FROM registry.position_period_comparison
  WHERE earlier_position_observation_id = later_position_observation_id));

SELECT pg_temp.check('4: the same reporting date produces no comparison', (
  SELECT count(*) = 0
  FROM registry.position_period_comparison
  WHERE earlier_reported_date = later_reported_date
     OR position_id = (
          SELECT id FROM identity.position WHERE creation_reason = 'TEST ONLY comparison same date')));

SELECT pg_temp.check('5: unresolved continuity produces no comparison', (
  SELECT count(*) = 0
  FROM registry.position_period_comparison
  WHERE earlier_position_observation_id = pg_temp.fx('po_unres')
     OR later_position_observation_id = pg_temp.fx('po_unres')));

SELECT pg_temp.check('6: rejected continuity produces no comparison', (
  SELECT count(*) = 0
  FROM registry.position_period_comparison
  WHERE earlier_position_observation_id IN (pg_temp.fx('po_rej_a'), pg_temp.fx('po_rej_b'))
     OR later_position_observation_id IN (pg_temp.fx('po_rej_a'), pg_temp.fx('po_rej_b'))));

SELECT pg_temp.check('7: missing continuity produces no comparison', (
  SELECT count(*) = 0
  FROM registry.position_period_comparison
  WHERE earlier_position_observation_id IN (pg_temp.fx('po_miss_a'), pg_temp.fx('po_miss_b'))
     OR later_position_observation_id IN (pg_temp.fx('po_miss_a'), pg_temp.fx('po_miss_b'))));

SELECT pg_temp.check('8: principal known on both sides is later minus earlier', (
  SELECT principal_comparison_state = 'COMPARABLE'
     AND principal_delta = 20
     AND principal_changed
     AND earlier_principal_numeric = 100
     AND later_principal_numeric = 120
  FROM registry.position_period_comparison
  WHERE earlier_position_observation_id = pg_temp.fx('po_mar')
    AND later_position_observation_id = pg_temp.fx('po_jun')));

SELECT pg_temp.check('9: a missing principal is a null delta', (
  SELECT principal_comparison_state = 'INSUFFICIENT_DATA'
     AND principal_delta IS NULL
     AND principal_changed IS NULL
     AND earlier_principal_numeric = 120
     AND later_principal_numeric IS NULL
  FROM registry.position_period_comparison
  WHERE earlier_position_observation_id = pg_temp.fx('po_jun')
    AND later_position_observation_id = pg_temp.fx('po_sep')));

SELECT pg_temp.check('10: cost known on both sides is later minus earlier', (
  SELECT cost_comparison_state = 'COMPARABLE'
     AND cost_delta = 10
     AND earlier_cost_numeric = 80
     AND later_cost_numeric = 90
  FROM registry.position_period_comparison
  WHERE earlier_position_observation_id = pg_temp.fx('po_mar')
    AND later_position_observation_id = pg_temp.fx('po_jun')));

SELECT pg_temp.check('11: fair value known on both sides is later minus earlier', (
  SELECT fair_value_comparison_state = 'COMPARABLE'
     AND fair_value_delta = -10
     AND fair_value_changed
     AND earlier_fair_value_numeric = 70
     AND later_fair_value_numeric = 60
  FROM registry.position_period_comparison
  WHERE earlier_position_observation_id = pg_temp.fx('po_mar')
    AND later_position_observation_id = pg_temp.fx('po_jun')));

SELECT pg_temp.check('12: missing fair value stays null', (
  SELECT fair_value_comparison_state = 'INSUFFICIENT_DATA'
     AND fair_value_delta IS NULL
     AND fair_value_delta IS DISTINCT FROM 0
     AND later_fair_value_numeric IS NULL
  FROM registry.position_period_comparison
  WHERE earlier_position_observation_id = pg_temp.fx('po_jun')
    AND later_position_observation_id = pg_temp.fx('po_sep')));

SELECT pg_temp.check('13: calendar maturity changes only when both days are stored', (
  SELECT maturity_comparison_state = 'COMPARABLE'
     AND maturity_changed
     AND earlier_maturity_date = DATE '2099-06-15'
     AND later_maturity_date = DATE '2099-12-15'
     AND earlier_maturity_precision IS NULL
     AND later_maturity_precision IS NULL
  FROM registry.position_period_comparison
  WHERE earlier_position_observation_id = pg_temp.fx('po_mar')
    AND later_position_observation_id = pg_temp.fx('po_jun')));

SELECT pg_temp.check('13b: mixed calendar and month maturity is not a change', (
  SELECT maturity_comparison_state = 'INSUFFICIENT_DATA'
     AND maturity_changed IS NULL
     AND earlier_maturity_date = DATE '2099-12-15'
     AND later_maturity_date IS NULL
     AND later_maturity_precision = 'MONTH'
     AND later_maturity_year = 2099
     AND later_maturity_month = 12
  FROM registry.position_period_comparison
  WHERE earlier_position_observation_id = pg_temp.fx('po_jun')
    AND later_position_observation_id = pg_temp.fx('po_sep')));

SELECT pg_temp.check('14: month-only maturity stays month-only', (
  SELECT maturity_comparison_state = 'COMPARABLE'
     AND maturity_changed
     AND earlier_maturity_date IS NULL
     AND later_maturity_date IS NULL
     AND earlier_maturity_precision = 'MONTH'
     AND later_maturity_precision = 'MONTH'
     AND earlier_maturity_raw = '12/2099'
     AND later_maturity_raw = '06/2100'
     AND earlier_maturity_year = 2099
     AND earlier_maturity_month = 12
     AND later_maturity_year = 2100
     AND later_maturity_month = 6
  FROM registry.position_period_comparison
  WHERE earlier_position_observation_id = pg_temp.fx('po_m1')
    AND later_position_observation_id = pg_temp.fx('po_m2')));

SELECT pg_temp.check('15: acquisition values stay stored and are not an origination', (
  SELECT acquisition_comparison_state = 'COMPARABLE'
     AND earlier_acquisition_raw = '2099-01-15'
     AND later_acquisition_raw = '2099-01-15'
     AND earlier_acquisition_date = DATE '2099-01-15'
     AND later_acquisition_date = DATE '2099-01-15'
  FROM registry.position_period_comparison
  WHERE earlier_position_observation_id = pg_temp.fx('po_mar')
    AND later_position_observation_id = pg_temp.fx('po_jun')));

SELECT pg_temp.check('15b: a month acquisition is not promoted to a day', (
  SELECT acquisition_comparison_state = 'INSUFFICIENT_DATA'
     AND later_acquisition_date IS NULL
     AND later_acquisition_precision = 'MONTH'
     AND later_acquisition_raw = '04/2099'
     AND later_acquisition_year = 2099
     AND later_acquisition_month = 4
  FROM registry.position_period_comparison
  WHERE earlier_position_observation_id = pg_temp.fx('po_jun')
    AND later_position_observation_id = pg_temp.fx('po_sep')));

SELECT pg_temp.check('16: interest rate delta uses the stored normalized numbers', (
  SELECT interest_rate_comparison_state = 'COMPARABLE'
     AND interest_rate_delta = 0.01
     AND interest_rate_changed
     AND earlier_interest_rate_numeric = 0.05
     AND later_interest_rate_numeric = 0.06
  FROM registry.position_period_comparison
  WHERE earlier_position_observation_id = pg_temp.fx('po_mar')
    AND later_position_observation_id = pg_temp.fx('po_jun')));

SELECT pg_temp.check('16b: a reported rate with no normalized number is not subtracted', (
  SELECT interest_rate_comparison_state = 'INSUFFICIENT_DATA'
     AND interest_rate_delta IS NULL
     AND interest_rate_changed IS NULL
     AND earlier_interest_rate_raw = '0.05'
     AND later_interest_rate_raw = '0.07'
     AND earlier_interest_rate_numeric IS NULL
     AND later_interest_rate_numeric IS NULL
  FROM registry.position_period_comparison
  WHERE earlier_position_observation_id = pg_temp.fx('po_raw_a')
    AND later_position_observation_id = pg_temp.fx('po_raw_b')));

SELECT pg_temp.check('17: spread delta uses the stored normalized numbers', (
  SELECT spread_comparison_state = 'COMPARABLE'
     AND spread_delta = 0.01
     AND spread_changed
     AND earlier_spread_numeric = 0.01
     AND later_spread_numeric = 0.02
  FROM registry.position_period_comparison
  WHERE earlier_position_observation_id = pg_temp.fx('po_mar')
    AND later_position_observation_id = pg_temp.fx('po_jun')));

SELECT pg_temp.check('17b: a missing spread stays null', (
  SELECT spread_comparison_state = 'INSUFFICIENT_DATA'
     AND spread_delta IS NULL
     AND spread_changed IS NULL
  FROM registry.position_period_comparison
  WHERE earlier_position_observation_id = pg_temp.fx('po_jun')
    AND later_position_observation_id = pg_temp.fx('po_sep')));

SELECT pg_temp.check('18: interest-rate floor delta uses the stored normalized numbers', (
  SELECT interest_rate_floor_comparison_state = 'COMPARABLE'
     AND interest_rate_floor_delta = 0.01
     AND interest_rate_floor_changed
     AND earlier_interest_rate_floor_numeric = 0.04
     AND later_interest_rate_floor_numeric = 0.05
  FROM registry.position_period_comparison
  WHERE earlier_position_observation_id = pg_temp.fx('po_mar')
    AND later_position_observation_id = pg_temp.fx('po_jun')));

SELECT pg_temp.check('19: both source observation ids are retained', (
  SELECT earlier_position_observation_id = pg_temp.fx('po_mar')
     AND later_position_observation_id = pg_temp.fx('po_jun')
  FROM registry.position_period_comparison
  WHERE earlier_reported_date = DATE '2099-03-31'
    AND later_reported_date = DATE '2099-06-30'
    AND position_id = (
      SELECT id FROM identity.position WHERE creation_reason = 'TEST ONLY comparison series')));

SELECT pg_temp.check('20: both accession and observation evidence references are retained', (
  SELECT c.earlier_accession_number = '0000000000-00-000001'
     AND c.later_accession_number = '0000000000-00-000001'
     AND c.earlier_observation_evidence_id = earlier_obs.evidence_id
     AND c.later_observation_evidence_id = later_obs.evidence_id
     AND c.earlier_observation_evidence_id IS NOT NULL
     AND c.later_observation_evidence_id IS NOT NULL
  FROM registry.position_period_comparison c
  JOIN obs.position_observation earlier_obs ON earlier_obs.id = c.earlier_position_observation_id
  JOIN obs.position_observation later_obs ON later_obs.id = c.later_position_observation_id
  WHERE c.earlier_position_observation_id = pg_temp.fx('po_mar')
    AND c.later_position_observation_id = pg_temp.fx('po_jun')));

SELECT pg_temp.check('21: one observation does not create an exit row', (
  SELECT count(*) = 0
  FROM registry.position_period_comparison
  WHERE position_id = (
    SELECT id FROM identity.position WHERE creation_reason = 'TEST ONLY comparison only')));

SELECT pg_temp.check('22: a fair-value decline does not create an observation event', (
  SELECT count(*) = 0 FROM derived.observation_event));

SELECT pg_temp.check('23: a maturity change does not create an observation event', (
  SELECT count(*) = 0
  FROM derived.observation_event e
  WHERE e.position_observation_id IN (pg_temp.fx('po_mar'), pg_temp.fx('po_jun'), pg_temp.fx('po_m2'))));

SELECT pg_temp.check('24: the comparison has no fair-value ratio column', (
  SELECT count(*) = 0 FROM information_schema.columns
  WHERE table_schema = 'registry' AND table_name = 'position_period_comparison'
    AND column_name ILIKE '%fvr%'));

SELECT pg_temp.check('25: the comparison has no score or rank column', (
  SELECT count(*) = 0 FROM information_schema.columns
  WHERE table_schema = 'registry' AND table_name = 'position_period_comparison'
    AND (column_name ILIKE '%score%' OR column_name ILIKE '%rank%')));

SELECT pg_temp.check('a position and period pair is not duplicated', (
  SELECT (
    SELECT count(*) = 0 FROM (
      SELECT position_id, earlier_reported_date, later_reported_date
      FROM registry.position_period_comparison
      GROUP BY position_id, earlier_reported_date, later_reported_date
      HAVING count(*) > 1
    ) d
  ) AND (
    SELECT count(*) = 0 FROM (
      SELECT earlier_position_observation_id, later_position_observation_id
      FROM registry.position_period_comparison
      GROUP BY earlier_position_observation_id, later_position_observation_id
      HAVING count(*) > 1
    ) p
  )));

SELECT pg_temp.check('a stored middle date is not skipped', (
  SELECT count(*) = 0
  FROM registry.position_period_comparison
  WHERE earlier_position_observation_id = pg_temp.fx('po_mar')
    AND later_position_observation_id = pg_temp.fx('po_sep')));

SELECT pg_temp.check('probable continuity produces no comparison', (
  SELECT count(*) = 0
  FROM registry.position_period_comparison
  WHERE earlier_position_observation_id IN (pg_temp.fx('po_prob_a'), pg_temp.fx('po_prob_b'))
     OR later_position_observation_id IN (pg_temp.fx('po_prob_a'), pg_temp.fx('po_prob_b'))));

SELECT pg_temp.check('the comparison does not name an exit, repayment, refinancing, or origination', (
  SELECT count(*) = 0 FROM information_schema.columns
  WHERE table_schema = 'registry' AND table_name = 'position_period_comparison'
    AND (column_name ILIKE '%exit%'
      OR column_name ILIKE '%repay%'
      OR column_name ILIKE '%refinanc%'
      OR column_name ILIKE '%originat%'
      OR column_name ILIKE '%deteriorat%'
      OR column_name ILIKE '%default%'
      OR column_name ILIKE '%non_accrual%')));

SELECT pg_temp.check('different known currency codes are not a principal or fair-value delta', (
  SELECT principal_comparison_state = 'INSUFFICIENT_DATA'
     AND principal_delta IS NULL
     AND principal_changed IS NULL
     AND fair_value_comparison_state = 'INSUFFICIENT_DATA'
     AND fair_value_delta IS NULL
     AND fair_value_changed IS NULL
  FROM registry.position_period_comparison
  WHERE earlier_position_observation_id = pg_temp.fx('po_ccy_a')
    AND later_position_observation_id = pg_temp.fx('po_ccy_b')));

SELECT pg_temp.check('unknown currency on both sides is not comparable', (
  SELECT principal_comparison_state = 'INSUFFICIENT_DATA'
     AND principal_delta IS NULL
     AND fair_value_comparison_state = 'INSUFFICIENT_DATA'
     AND fair_value_delta IS NULL
  FROM registry.position_period_comparison
  WHERE earlier_position_observation_id = pg_temp.fx('po_unk_a')
    AND later_position_observation_id = pg_temp.fx('po_unk_b')));

SELECT pg_temp.check('ambiguous currency on both sides is not a principal, cost, or fair-value delta', (
  SELECT c.principal_comparison_state = 'INSUFFICIENT_DATA'
     AND c.principal_delta IS NULL
     AND c.principal_changed IS NULL
     AND c.cost_comparison_state = 'INSUFFICIENT_DATA'
     AND c.cost_delta IS NULL
     AND c.cost_changed IS NULL
     AND c.fair_value_comparison_state = 'INSUFFICIENT_DATA'
     AND c.fair_value_delta IS NULL
     AND c.fair_value_changed IS NULL
     AND c.earlier_principal_numeric = 10
     AND c.later_principal_numeric = 25
     AND c.earlier_cost_numeric = 9
     AND c.later_cost_numeric = 22
     AND c.earlier_fair_value_numeric = 8
     AND c.later_fair_value_numeric = 20
     AND e.principal_currency_state = 'AMBIGUOUS'
     AND l.principal_currency_state = 'AMBIGUOUS'
     AND e.cost_currency_state = 'AMBIGUOUS'
     AND l.cost_currency_state = 'AMBIGUOUS'
     AND e.fair_value_currency_state = 'AMBIGUOUS'
     AND l.fair_value_currency_state = 'AMBIGUOUS'
     AND earlier_principal.currency_code IS NULL
     AND later_principal.currency_code IS NULL
  FROM registry.position_period_comparison c
  JOIN registry.position_read e
    ON e.position_observation_id = c.earlier_position_observation_id
  JOIN registry.position_read l
    ON l.position_observation_id = c.later_position_observation_id
  JOIN obs.current_position_field_value earlier_principal
    ON earlier_principal.position_observation_id = c.earlier_position_observation_id
   AND earlier_principal.field_code = 'PRINCIPAL_AMOUNT'
  JOIN obs.current_position_field_value later_principal
    ON later_principal.position_observation_id = c.later_position_observation_id
   AND later_principal.field_code = 'PRINCIPAL_AMOUNT'
  WHERE c.earlier_position_observation_id = pg_temp.fx('po_amb_a')
    AND c.later_position_observation_id = pg_temp.fx('po_amb_b')));

SELECT pg_temp.check('the comparison reads position_read and does not invent a date or a ratio', (
  SELECT position('position_read' IN pg_get_viewdef('registry.position_period_comparison'::regclass)) > 0
     AND position('current_position_continuity' IN pg_get_viewdef('registry.position_period_comparison'::regclass)) > 0
     AND position('current_position_field_value' IN pg_get_viewdef('registry.position_period_comparison'::regclass)) > 0
     AND pg_get_viewdef('registry.position_period_comparison'::regclass) !~ 'obs\.position_field_value([^_]|$)'
     AND position('observation_event' IN pg_get_viewdef('registry.position_period_comparison'::regclass)) = 0
     AND position('make_date' IN pg_get_viewdef('registry.position_period_comparison'::regclass)) = 0
     AND pg_get_viewdef('registry.position_period_comparison'::regclass) !~ 'sum\('
     AND pg_get_viewdef('registry.position_period_comparison'::regclass) !~ 'similarity'
     AND position('UNKNOWN' IN pg_get_viewdef('registry.position_period_comparison'::regclass)) > 0
     AND position('AMBIGUOUS' IN pg_get_viewdef('registry.position_period_comparison'::regclass)) > 0));

SELECT pg_temp.check('observation events stay limited to the registrant-first-observed name', (
  SELECT count(*) FILTER (
           WHERE position('REGISTRANT_FIRST_OBSERVED_NAME' IN pg_get_constraintdef(c.oid)) > 0) = 1
     AND count(*) FILTER (
           WHERE position('PRINCIPAL_CHANGED' IN pg_get_constraintdef(c.oid)) > 0) = 0
     AND count(*) FILTER (
           WHERE position('MATURITY_CHANGED' IN pg_get_constraintdef(c.oid)) > 0) = 0
  FROM pg_constraint c
  WHERE c.conrelid = 'derived.observation_event'::regclass
    AND c.contype = 'c'));

SELECT pg_temp.expect_ok('reader can select the position period comparison', ARRAY[
  'SET ROLE bdc_reader',
  'SELECT count(*) FROM registry.position_period_comparison',
  'RESET ROLE']);
