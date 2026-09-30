-- Group 21: P9-min observation events. Fake dates only. No amount column.

SELECT pg_temp.expect_ok('a first-observed event copies the observation date and evidence', ARRAY[format(
  $$INSERT INTO derived.observation_event (event_code, position_observation_id, reported_date, evidence_id,
      rule_version_id, run_id, rationale)
    VALUES ('REGISTRANT_FIRST_OBSERVED_NAME', %s, '2099-12-31', %s, %s, %s,
            'TEST ONLY earliest observation for this registrant')$$,
  pg_temp.fx('po_a'), pg_temp.fx('e_soi_a'), pg_temp.fx('r_metric'), pg_temp.fx('run'))]);

SELECT pg_temp.check('the event listing exposes the evidence link and no amount', (
  SELECT event_code = 'REGISTRANT_FIRST_OBSERVED_NAME'
     AND position_observation_id = pg_temp.fx('po_a')
     AND evidence_id = pg_temp.fx('e_soi_a')
  FROM derived.observation_event_listing
  WHERE position_observation_id = pg_temp.fx('po_a')));

SELECT pg_temp.expect_error('an event cannot point at different evidence than its observation', 'BDCI1', ARRAY[format(
  $$INSERT INTO derived.observation_event (event_code, position_observation_id, reported_date, evidence_id,
      rule_version_id, run_id, rationale)
    VALUES ('REGISTRANT_FIRST_OBSERVED_NAME', %s, '2099-12-31', %s, %s, %s, 'TEST ONLY wrong evidence')$$,
  pg_temp.fx('po_a'), pg_temp.fx('e_soi_b'), pg_temp.fx('r_metric'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('an event cannot invent a reported date', 'BDCI1', ARRAY[format(
  $$INSERT INTO derived.observation_event (event_code, position_observation_id, reported_date, evidence_id,
      rule_version_id, run_id, rationale)
    VALUES ('REGISTRANT_FIRST_OBSERVED_NAME', %s, '2099-06-30', %s, %s, %s, 'TEST ONLY invented date')$$,
  pg_temp.fx('po_a'), pg_temp.fx('e_soi_a'), pg_temp.fx('r_metric'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('a blocked event code cannot be stored', '23514', ARRAY[format(
  $$INSERT INTO derived.observation_event (event_code, position_observation_id, reported_date, evidence_id,
      rule_version_id, run_id, rationale)
    VALUES ('VALUATION_MOVEMENT', %s, '2099-12-31', %s, %s, %s, 'TEST ONLY valuation')$$,
  pg_temp.fx('po_a'), pg_temp.fx('e_soi_a'), pg_temp.fx('r_metric'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('a non-derivation rule cannot write an observation event', 'BDCD1', ARRAY[format(
  $$INSERT INTO derived.observation_event (event_code, position_observation_id, reported_date, evidence_id,
      rule_version_id, run_id, rationale)
    VALUES ('REGISTRANT_FIRST_OBSERVED_NAME', %s, '2099-12-31', %s, %s, %s, 'TEST ONLY wrong rule kind')$$,
  pg_temp.fx('po_b'), pg_temp.fx('e_soi_b'), pg_temp.fx('r_validate'), pg_temp.fx('run'))]);

SELECT pg_temp.check('observation events have no amount, CIK, or instrument column', NOT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'derived' AND table_name = 'observation_event'
    AND (column_name ILIKE '%cik%' OR column_name ILIKE '%instrument%' OR column_name ILIKE '%amount%'
         OR data_type = 'numeric')));
