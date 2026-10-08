-- Group 48: borrower maturity wall. Fake names and 2099 dates only.
-- Maturity is copied. A month does not become a day. Money is not summed across unknown currency.

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
  ev_cell bigint;
  soi_id bigint;
  po_id bigint;
  line text;
BEGIN
  line := acc || E'\t9999999901\tTEST BDC 1\t' || reported || E'\t0\t' || ident || E'\t\t\t\t\t';
  row_id := pg_temp.add_row(pg_temp.fx('l_soi'), line_no, line);
  ev_row := pg_temp.add_evidence('L1_STRUCTURED_DATASET', pg_temp.fx('artifact'), row_id);
  ev_cell := pg_temp.add_evidence('L1_STRUCTURED_DATASET', pg_temp.fx('artifact'), row_id, 6, 'Investment, Identifier Axis');
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
  PERFORM pg_temp.put(pos_key || '_cell', ev_cell);
END
$$;

CREATE FUNCTION pg_temp.history_name(pos_key text, ident text) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO obs.borrower_name_observation (
      position_observation_id, source_column_label, source_column_position,
      raw_text, normalized_text, extraction_state, rule_version_id, evidence_id, run_id)
  VALUES (pg_temp.fx(pos_key), 'Investment, Identifier Axis', 6, ident, ident, 'EXTRACTED',
          pg_temp.fx('r_field'), pg_temp.fx(pos_key || '_cell'), pg_temp.fx('run'))
$$;

CREATE FUNCTION pg_temp.match_entity(pos_key text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO resolution.entity_resolution_decision (
      borrower_name_observation_id, legal_entity_id, state, method, rationale,
      actor_kind, decided_by, decided_at, rule_version_id, evidence_id, run_id)
  SELECT b.id, le.id, 'MATCHED', 'EXACT_NORMALIZED_NAME',
         'TEST ONLY: stored decision', 'SYSTEM_RULE', 'db tests', now(),
         pg_temp.fx('r_resolve'), pg_temp.fx('e_soi_a'), pg_temp.fx('run')
  FROM obs.current_borrower_name_observation b
  JOIN identity.legal_entity le ON le.creation_reason = 'TEST ONLY maturity entity'
  WHERE b.position_observation_id = pg_temp.fx(pos_key);
END
$$;

CREATE FUNCTION pg_temp.add_instrument(reason text) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO identity.instrument (creation_reason, run_id) VALUES (reason, pg_temp.fx('run'))
$$;

CREATE FUNCTION pg_temp.match_instrument(pos_key text, reason text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO resolution.instrument_resolution_decision (
      position_observation_id, instrument_id, state, method, rationale,
      actor_kind, decided_by, decided_at, rule_version_id, evidence_id, run_id)
  SELECT pg_temp.fx(pos_key), i.id, 'MATCHED', 'EXACT_IDENTIFIER_AND_TYPE',
         'TEST ONLY: stored instrument', 'SYSTEM_RULE', 'db tests', now(),
         pg_temp.fx('r_resolve'), pg_temp.fx('e_soi_a'), pg_temp.fx('run')
  FROM identity.instrument i
  WHERE i.creation_reason = reason;
END
$$;

CREATE FUNCTION pg_temp.add_position(reason text) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO identity.position (registrant_id, creation_reason, run_id)
  VALUES (pg_temp.fx('registrant'), reason, pg_temp.fx('run'))
$$;

CREATE FUNCTION pg_temp.link_continuity(pos_key text, reason text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO resolution.position_continuity_decision (
      position_observation_id, position_id, state, method, rationale,
      actor_kind, decided_by, decided_at, rule_version_id, evidence_id, run_id)
  SELECT pg_temp.fx(pos_key), p.id, 'MATCHED',
         'SAME_REGISTRANT_AND_INSTRUMENT', 'TEST ONLY: stored continuity',
         'SYSTEM_RULE', 'db tests', now(),
         pg_temp.fx('r_resolve'), pg_temp.fx('e_soi_a'), pg_temp.fx('run')
  FROM identity.position p
  WHERE p.creation_reason = reason;
END
$$;

SELECT pg_temp.series_position('day_early', 'TEST MATURITY ENTITY | EARLY DAY', 120, '2099-06-30');
SELECT pg_temp.series_position('day_late', 'TEST MATURITY ENTITY | LATE DAY', 121, '2099-03-31');
SELECT pg_temp.series_position('month_early', 'TEST MATURITY ENTITY | MONTH EARLY', 122, '2099-03-31');
SELECT pg_temp.series_position('month_late', 'TEST MATURITY ENTITY | MONTH LATE', 123, '2099-09-30');
SELECT pg_temp.series_position('unknown_row', 'TEST MATURITY ENTITY | UNKNOWN', 124, '2099-04-30');
SELECT pg_temp.series_position('open_row', 'TEST MATURITY ENTITY | UNRESOLVED', 125, '2099-05-31');
SELECT pg_temp.series_position('missing_principal', 'TEST MATURITY ENTITY | NO PRINCIPAL', 126, '2099-07-31');
SELECT pg_temp.series_position('unknown_currency', 'TEST MATURITY ENTITY | UNKNOWN CURRENCY', 127, '2099-08-31');
SELECT pg_temp.series_position('other_code', 'TEST MATURITY ENTITY | OTHER CODE', 128, '2099-10-31');

SELECT pg_temp.l2_calendar('day_early', 'MATURITY_DATE', '01/10/2099', DATE '2099-01-10');
SELECT pg_temp.l2_coded_money('day_early', 'PRINCIPAL_AMOUNT', '20', 20, 'AAA');
SELECT pg_temp.l2_coded_money('day_early', 'FAIR_VALUE', '10', 10, 'AAA');
SELECT pg_temp.l2_calendar('day_late', 'MATURITY_DATE', '06/15/2099', DATE '2099-06-15');
SELECT pg_temp.l2_coded_money('day_late', 'PRINCIPAL_AMOUNT', '100', 100, 'AAA');
SELECT pg_temp.l2_coded_money('day_late', 'FAIR_VALUE', '40', 40, 'AAA');
SELECT pg_temp.l2_month('month_early', 'MATURITY_DATE', '12/2099', 2099, 12);
SELECT pg_temp.l2_month('month_late', 'MATURITY_DATE', '06/2100', 2100, 6);
SELECT pg_temp.l2_calendar('open_row', 'MATURITY_DATE', '08/01/2099', DATE '2099-08-01');
SELECT pg_temp.l2_coded_money('open_row', 'PRINCIPAL_AMOUNT', '999', 999, 'AAA');
SELECT pg_temp.l2_calendar('missing_principal', 'MATURITY_DATE', '03/15/2101', DATE '2101-03-15');
SELECT pg_temp.l2_calendar('unknown_currency', 'MATURITY_DATE', '02/02/2100', DATE '2100-02-02');
SELECT pg_temp.l2_money('unknown_currency', 'PRINCIPAL_AMOUNT', '50', 50);
SELECT pg_temp.l2_calendar('other_code', 'MATURITY_DATE', '04/04/2102', DATE '2102-04-04');
SELECT pg_temp.l2_coded_money('other_code', 'PRINCIPAL_AMOUNT', '7', 7, 'BBB');
SELECT pg_temp.l2_coded_money('other_code', 'FAIR_VALUE', '3', 3, 'CCC');

SELECT pg_temp.history_name('day_early', 'TEST MATURITY ENTITY | EARLY DAY');
SELECT pg_temp.history_name('day_late', 'TEST MATURITY ENTITY | LATE DAY');
SELECT pg_temp.history_name('month_early', 'TEST MATURITY ENTITY | MONTH EARLY');
SELECT pg_temp.history_name('month_late', 'TEST MATURITY ENTITY | MONTH LATE');
SELECT pg_temp.history_name('unknown_row', 'TEST MATURITY ENTITY | UNKNOWN');
SELECT pg_temp.history_name('open_row', 'TEST MATURITY ENTITY | UNRESOLVED');
SELECT pg_temp.history_name('missing_principal', 'TEST MATURITY ENTITY | NO PRINCIPAL');
SELECT pg_temp.history_name('unknown_currency', 'TEST MATURITY ENTITY | UNKNOWN CURRENCY');
SELECT pg_temp.history_name('other_code', 'TEST MATURITY ENTITY | OTHER CODE');

SELECT pg_temp.expect_ok('maturity entity', ARRAY[
  format($$INSERT INTO identity.legal_entity (creation_reason, run_id) VALUES ('TEST ONLY maturity entity', %s)$$, pg_temp.fx('run'))]);

SELECT pg_temp.match_entity('day_early');
SELECT pg_temp.match_entity('day_late');
SELECT pg_temp.match_entity('month_early');
SELECT pg_temp.match_entity('month_late');
SELECT pg_temp.match_entity('unknown_row');
SELECT pg_temp.match_entity('open_row');
SELECT pg_temp.match_entity('missing_principal');
SELECT pg_temp.match_entity('unknown_currency');
SELECT pg_temp.match_entity('other_code');

SELECT pg_temp.add_instrument('TEST ONLY maturity instrument days');
SELECT pg_temp.add_instrument('TEST ONLY maturity instrument months');
SELECT pg_temp.add_instrument('TEST ONLY maturity instrument unknown');
SELECT pg_temp.add_instrument('TEST ONLY maturity instrument missing');
SELECT pg_temp.add_instrument('TEST ONLY maturity instrument currency');
SELECT pg_temp.add_instrument('TEST ONLY maturity instrument other');
SELECT pg_temp.match_instrument('day_early', 'TEST ONLY maturity instrument days');
SELECT pg_temp.match_instrument('day_late', 'TEST ONLY maturity instrument days');
SELECT pg_temp.match_instrument('month_early', 'TEST ONLY maturity instrument months');
SELECT pg_temp.match_instrument('month_late', 'TEST ONLY maturity instrument months');
SELECT pg_temp.match_instrument('unknown_row', 'TEST ONLY maturity instrument unknown');
SELECT pg_temp.match_instrument('missing_principal', 'TEST ONLY maturity instrument missing');
SELECT pg_temp.match_instrument('unknown_currency', 'TEST ONLY maturity instrument currency');
SELECT pg_temp.match_instrument('other_code', 'TEST ONLY maturity instrument other');

SELECT pg_temp.add_position('TEST ONLY maturity series days');
SELECT pg_temp.add_position('TEST ONLY maturity series months');
SELECT pg_temp.add_position('TEST ONLY maturity series unknown');
SELECT pg_temp.add_position('TEST ONLY maturity series missing');
SELECT pg_temp.add_position('TEST ONLY maturity series currency');
SELECT pg_temp.add_position('TEST ONLY maturity series other');
SELECT pg_temp.link_continuity('day_early', 'TEST ONLY maturity series days');
SELECT pg_temp.link_continuity('day_late', 'TEST ONLY maturity series days');
SELECT pg_temp.link_continuity('month_early', 'TEST ONLY maturity series months');
SELECT pg_temp.link_continuity('month_late', 'TEST ONLY maturity series months');
SELECT pg_temp.link_continuity('unknown_row', 'TEST ONLY maturity series unknown');
SELECT pg_temp.link_continuity('missing_principal', 'TEST ONLY maturity series missing');
SELECT pg_temp.link_continuity('unknown_currency', 'TEST ONLY maturity series currency');
SELECT pg_temp.link_continuity('other_code', 'TEST ONLY maturity series other');

SET CONSTRAINTS ALL IMMEDIATE;

SELECT pg_temp.check('calendar days sort before months and unknown stays undated', (
  SELECT (array_agg(position_observation_id ORDER BY ordinality))[1] = pg_temp.fx('day_early')::text
     AND (array_agg(maturity_raw ORDER BY ordinality))[1] = '01/10/2099'
     AND (array_agg(maturity_date ORDER BY ordinality))[1] = '2099-01-10'
     AND (array_agg(maturity_precision ORDER BY ordinality))[1] IS NULL
     AND (array_agg(position_observation_id ORDER BY ordinality))[2] = pg_temp.fx('day_late')::text
     AND (array_agg(maturity_precision_class ORDER BY ordinality))[1] = 'DAY'
     AND (array_agg(maturity_precision_class ORDER BY ordinality))[6] = 'MONTH'
  FROM registry.borrower_maturity_observations(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY maturity entity')
  ) WITH ORDINALITY
  WHERE maturity_observation_state = 'OBSERVED'));

SELECT pg_temp.check('evidence and accession stay on the maturity row', (
  SELECT accession_number = '0000000000-00-000001'
     AND observation_evidence_level = 'L1_STRUCTURED_DATASET'
     AND maturity_source = 'REPORTED_STRUCTURED'
     AND maturity_definition = 'maturity.position_history.v1'
  FROM registry.borrower_maturity_observations(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY maturity entity')
  )
  WHERE position_observation_id = pg_temp.fx('day_early')::text));

SELECT pg_temp.check('an unresolved instrument is not an observed maturity', (
  SELECT maturity_observation_state = 'UNRESOLVED_INSTRUMENT'
     AND maturity_precision_class = 'NONE'
     AND maturity_raw = '08/01/2099'
     AND refinancing_outcome_state = 'UNKNOWN'
     AND (SELECT count(*) = 0 FROM registry.borrower_maturity_years(
            (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY maturity entity'))
          WHERE maturity_year = '2099' AND maturity_precision_class = 'DAY'
            AND observation_count::integer > 2)
  FROM registry.borrower_maturity_observations(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY maturity entity')
  )
  WHERE position_observation_id = pg_temp.fx('open_row')::text));

SELECT pg_temp.check('unknown maturity stays unknown and is not a year bucket', (
  SELECT maturity_observation_state = 'UNKNOWN'
     AND maturity_raw IS NULL
     AND maturity_date IS NULL
     AND (SELECT count(*) = 0 FROM registry.borrower_maturity_years(
            (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY maturity entity')) y
          WHERE y.maturity_precision_class = 'NONE')
  FROM registry.borrower_maturity_observations(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY maturity entity')
  )
  WHERE position_observation_id = pg_temp.fx('unknown_row')::text));

SELECT pg_temp.check('compatible currency principal and fair value sum inside one year', (
  SELECT observation_count = '2'
     AND principal_aggregation_state = 'COMPARABLE'
     AND principal_total = '120'
     AND principal_currency_code = 'AAA'
     AND fair_value_aggregation_state = 'COMPARABLE'
     AND fair_value_total = '50'
     AND fair_value_currency_code = 'AAA'
  FROM registry.borrower_maturity_years(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY maturity entity')
  )
  WHERE maturity_year = '2099' AND maturity_precision_class = 'DAY'));

SELECT pg_temp.check('unknown currency is not a principal total', (
  SELECT observation_count = '1'
     AND principal_aggregation_state = 'INSUFFICIENT_DATA'
     AND principal_total IS NULL
     AND principal_currency_code IS NULL
  FROM registry.borrower_maturity_years(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY maturity entity')
  )
  WHERE maturity_year = '2100' AND maturity_precision_class = 'DAY'));

SELECT pg_temp.check('a missing principal is not zero and fair value is not substituted', (
  SELECT principal_state = 'UNKNOWN'
     AND principal_raw IS NULL
     AND (SELECT principal_aggregation_state = 'INSUFFICIENT_DATA'
            AND principal_total IS NULL
            AND fair_value_aggregation_state = 'INSUFFICIENT_DATA'
          FROM registry.borrower_maturity_years(
            (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY maturity entity'))
          WHERE maturity_year = '2101' AND maturity_precision_class = 'DAY')
  FROM registry.borrower_maturity_observations(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY maturity entity')
  )
  WHERE position_observation_id = pg_temp.fx('missing_principal')::text));

SELECT pg_temp.check('a month maturity stays a month and a changed month is not a refinancing', (
  SELECT o.maturity_precision_class = 'MONTH'
     AND o.maturity_date IS NULL
     AND o.maturity_raw = '06/2100'
     AND o.refinancing_outcome_state = 'UNKNOWN'
     AND c.maturity_comparison_state = 'COMPARABLE'
     AND c.maturity_changed
     AND c.earlier_maturity_raw = '12/2099'
     AND c.later_maturity_raw = '06/2100'
     AND (SELECT count(*) = 1 FROM registry.borrower_maturity_observations(
            (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY maturity entity'))
          WHERE position_id = o.position_id AND reported_date = '2099-03-31')
  FROM registry.borrower_maturity_observations(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY maturity entity')
  ) o
  JOIN registry.position_period_comparison c
    ON c.later_position_observation_id = o.position_observation_id::bigint
  WHERE o.position_observation_id = pg_temp.fx('month_late')::text));

SELECT pg_temp.check('summary counts separate known, unknown, and unresolved maturity', (
  SELECT resolved_observation_count = '8'
     AND known_maturity_count = '7'
     AND unknown_maturity_count = '1'
     AND unresolved_count = '1'
     AND earliest_calendar_maturity = '01/10/2099'
     AND earliest_month_maturity = '12/2099'
     AND refinancing_outcome_state = 'UNKNOWN'
  FROM registry.borrower_maturity_summary(
    (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY maturity entity'))));

SELECT pg_temp.check('the maturity read does not invent a refinancing or an origination', (
  SELECT position('position_read' IN pg_get_functiondef('registry.borrower_maturity_observations(uuid)'::regprocedure)) > 0
     AND position('matched_entity_position' IN pg_get_functiondef('registry.borrower_maturity_observations(uuid)'::regprocedure)) > 0
     AND position('OFFSET 0' IN pg_get_functiondef('registry.borrower_maturity_observations(uuid)'::regprocedure)) > 0
     AND position('maturity_read' IN pg_get_viewdef('registry.position_read'::regclass)) > 0
     AND pg_get_functiondef('registry.borrower_maturity_observations(uuid)'::regprocedure) !~* 'origination|score|rank|probability'
     AND pg_get_functiondef('registry.borrower_maturity_years(uuid)'::regprocedure) !~* 'origination|score|rank|probability'));

SELECT pg_temp.expect_ok('reader can select the maturity wall', ARRAY[
  'SET ROLE bdc_reader',
  format('SELECT count(*) FROM registry.borrower_maturity_observations(%L)',
         (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY maturity entity')),
  format('SELECT resolved_observation_count FROM registry.borrower_maturity_summary(%L)',
         (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY maturity entity')),
  format('SELECT count(*) FROM registry.borrower_maturity_years(%L)',
         (SELECT id FROM identity.legal_entity WHERE creation_reason = 'TEST ONLY maturity entity')),
  'RESET ROLE']);
