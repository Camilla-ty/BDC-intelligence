-- Group 46: two reporting periods of one BDC. Fake names and 2099 dates only.
-- A stored comparison is copied. A later resolved position is not an origination.
-- An earlier resolved position that is absent later is not a repayment or a refinancing.
-- An unresolved name is not an instrument.

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

CREATE FUNCTION pg_temp.match_entity(pos_key text, reason text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO resolution.entity_resolution_decision (
      borrower_name_observation_id, legal_entity_id, state, method, rationale,
      actor_kind, decided_by, decided_at, rule_version_id, evidence_id, run_id)
  SELECT b.id, le.id, 'MATCHED', 'EXACT_NORMALIZED_NAME',
         'TEST ONLY: stored decision', 'SYSTEM_RULE', 'db tests', now(),
         pg_temp.fx('r_resolve'), pg_temp.fx('e_soi_a'), pg_temp.fx('run')
  FROM obs.current_borrower_name_observation b
  JOIN identity.legal_entity le ON le.creation_reason = reason
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

SELECT pg_temp.series_position('pair_early', 'TEST PERIOD ENTITY | EARLY', 910, '2099-03-31');
SELECT pg_temp.series_position('pair_late', 'TEST PERIOD ENTITY | LATE', 911, '2099-06-30');
SELECT pg_temp.series_position('pair_sep', 'TEST PERIOD ENTITY | SEP', 912, '2099-09-30');
SELECT pg_temp.series_position('exit_only', 'TEST PERIOD EXIT | ONLY', 913, '2099-03-31');
SELECT pg_temp.series_position('new_only', 'TEST PERIOD NEW | ONLY', 914, '2099-06-30');
SELECT pg_temp.series_position('name_early', 'TEST NAME ONLY', 915, '2099-03-31');
SELECT pg_temp.series_position('name_late', 'TEST NAME ONLY', 916, '2099-06-30');
SELECT pg_temp.series_position('amb_a', 'TEST PERIOD AMBIGUOUS | A', 917, '2099-03-31');
SELECT pg_temp.series_position('amb_b', 'TEST PERIOD AMBIGUOUS | B', 918, '2099-03-31');

SELECT pg_temp.l2_money('pair_early', 'PRINCIPAL_AMOUNT', '100', 100);
SELECT pg_temp.l2_money('pair_early', 'FAIR_VALUE', '70', 70);
SELECT pg_temp.l2_money('pair_early', 'COST', '15', 15);
SELECT pg_temp.l2_month('pair_early', 'MATURITY_DATE', '12/2099', 2099, 12);
SELECT pg_temp.l2_calendar('pair_early', 'ACQUISITION_DATE', '2099-01-15', DATE '2099-01-15');
SELECT pg_temp.l2_money('pair_late', 'PRINCIPAL_AMOUNT', '120', 120);
SELECT pg_temp.l2_money('pair_late', 'FAIR_VALUE', '60', 60);
SELECT pg_temp.l2_month('pair_late', 'MATURITY_DATE', '06/2100', 2100, 6);
SELECT pg_temp.l2_calendar('pair_late', 'ACQUISITION_DATE', '2099-02-02', DATE '2099-02-02');
SELECT pg_temp.l2_money('pair_sep', 'FAIR_VALUE', '55', 55);
SELECT pg_temp.l2_money('exit_only', 'PRINCIPAL_AMOUNT', '40', 40);
SELECT pg_temp.l2_money('exit_only', 'FAIR_VALUE', '30', 30);
SELECT pg_temp.l2_money('new_only', 'PRINCIPAL_AMOUNT', '25', 25);
SELECT pg_temp.l2_money('new_only', 'FAIR_VALUE', '9', 9);
SELECT pg_temp.l2_calendar('new_only', 'ACQUISITION_DATE', '2099-06-01', DATE '2099-06-01');

SELECT pg_temp.history_name('pair_early', 'TEST PERIOD ENTITY | EARLY');
SELECT pg_temp.history_name('pair_late', 'TEST PERIOD ENTITY | LATE');
SELECT pg_temp.history_name('pair_sep', 'TEST PERIOD ENTITY | SEP');
SELECT pg_temp.history_name('exit_only', 'TEST PERIOD EXIT | ONLY');
SELECT pg_temp.history_name('new_only', 'TEST PERIOD NEW | ONLY');
SELECT pg_temp.history_name('name_early', 'TEST NAME ONLY');
SELECT pg_temp.history_name('name_late', 'TEST NAME ONLY');
SELECT pg_temp.history_name('amb_a', 'TEST PERIOD AMBIGUOUS | A');
SELECT pg_temp.history_name('amb_b', 'TEST PERIOD AMBIGUOUS | B');

SELECT pg_temp.expect_ok('period entities and instruments', ARRAY[
  format($$INSERT INTO identity.legal_entity (creation_reason, run_id) VALUES ('TEST ONLY period entity', %s)$$, pg_temp.fx('run')),
  format($$INSERT INTO identity.instrument (creation_reason, run_id) VALUES ('TEST ONLY period instrument', %s)$$, pg_temp.fx('run')),
  format($$INSERT INTO identity.instrument (creation_reason, run_id) VALUES ('TEST ONLY period exit instrument', %s)$$, pg_temp.fx('run')),
  format($$INSERT INTO identity.instrument (creation_reason, run_id) VALUES ('TEST ONLY period new instrument', %s)$$, pg_temp.fx('run')),
  format($$INSERT INTO identity.instrument (creation_reason, run_id) VALUES ('TEST ONLY period ambiguous instrument', %s)$$, pg_temp.fx('run'))]);

SELECT pg_temp.match_entity('pair_early', 'TEST ONLY period entity');
SELECT pg_temp.match_entity('pair_late', 'TEST ONLY period entity');
SELECT pg_temp.match_entity('pair_sep', 'TEST ONLY period entity');
SELECT pg_temp.match_entity('exit_only', 'TEST ONLY period entity');
SELECT pg_temp.match_entity('new_only', 'TEST ONLY period entity');
SELECT pg_temp.match_entity('name_early', 'TEST ONLY period entity');
SELECT pg_temp.match_entity('name_late', 'TEST ONLY period entity');
SELECT pg_temp.match_entity('amb_a', 'TEST ONLY period entity');
SELECT pg_temp.match_entity('amb_b', 'TEST ONLY period entity');

SELECT pg_temp.match_instrument('pair_early', 'TEST ONLY period instrument');
SELECT pg_temp.match_instrument('pair_late', 'TEST ONLY period instrument');
SELECT pg_temp.match_instrument('pair_sep', 'TEST ONLY period instrument');
SELECT pg_temp.match_instrument('exit_only', 'TEST ONLY period exit instrument');
SELECT pg_temp.match_instrument('new_only', 'TEST ONLY period new instrument');
SELECT pg_temp.match_instrument('amb_a', 'TEST ONLY period ambiguous instrument');
SELECT pg_temp.match_instrument('amb_b', 'TEST ONLY period ambiguous instrument');

SELECT pg_temp.add_position('TEST ONLY period series');
SELECT pg_temp.add_position('TEST ONLY period exit');
SELECT pg_temp.add_position('TEST ONLY period new');
SELECT pg_temp.add_position('TEST ONLY period ambiguous');
SELECT pg_temp.link_continuity('pair_early', 'TEST ONLY period series');
SELECT pg_temp.link_continuity('pair_late', 'TEST ONLY period series');
SELECT pg_temp.link_continuity('pair_sep', 'TEST ONLY period series');
SELECT pg_temp.link_continuity('exit_only', 'TEST ONLY period exit');
SELECT pg_temp.link_continuity('new_only', 'TEST ONLY period new');
SELECT pg_temp.link_continuity('amb_a', 'TEST ONLY period ambiguous');
SELECT pg_temp.link_continuity('amb_b', 'TEST ONLY period ambiguous');

SET CONSTRAINTS ALL IMMEDIATE;

SELECT pg_temp.check('the same BDC and the two selected dates copy the stored comparison', (
  SELECT count(*) = 1
     AND min(change_type) = 'EXISTING_POSITION_CHANGED'
     AND min(registrant_cik) = '9999999901'
     AND min(earlier_reported_date) = '2099-03-31'
     AND min(later_reported_date) = '2099-06-30'
     AND min(earlier_position_observation_id) = pg_temp.fx('pair_early')::text
     AND min(later_position_observation_id) = pg_temp.fx('pair_late')::text
     AND min(earlier_accession_number) = '0000000000-00-000001'
     AND min(later_accession_number) = '0000000000-00-000001'
     AND min(changes_definition) = 'portfolio.period_changes.v1'
     AND bool_and(earlier_document_url IS NULL OR earlier_document_url ~ '^https://www\.sec\.gov/Archives/edgar/data/')
  FROM registry.bdc_portfolio_period_changes('9999999901', '2099-03-31', '2099-06-30')
  WHERE position_id = (
    SELECT p.id::text FROM identity.position p WHERE p.creation_reason = 'TEST ONLY period series')));

SELECT pg_temp.check('fair value, principal, cost, and maturity are the stored comparison', (
  SELECT f.fair_value_delta = c.fair_value_delta::text
     AND f.fair_value_delta = '-10'
     AND f.fair_value_comparison_state = 'COMPARABLE'
     AND f.principal_delta = c.principal_delta::text
     AND f.principal_delta = '20'
     AND f.principal_comparison_state = 'COMPARABLE'
     AND f.cost_comparison_state = 'INSUFFICIENT_DATA'
     AND f.cost_delta IS NULL
     AND f.maturity_comparison_state = 'COMPARABLE'
     AND f.maturity_changed IS TRUE
     AND f.earlier_maturity_raw = '12/2099'
     AND f.later_maturity_raw = '06/2100'
  FROM registry.bdc_portfolio_period_changes('9999999901', '2099-03-31', '2099-06-30') f
  JOIN registry.position_period_comparison c
    ON c.earlier_position_observation_id = f.earlier_position_observation_id::bigint
   AND c.later_position_observation_id = f.later_position_observation_id::bigint
  WHERE f.change_type = 'EXISTING_POSITION_CHANGED'));

SELECT pg_temp.check('a later resolved position is observed and is not an origination', (
  SELECT count(*) = 1
     AND min(change_type) = 'NEW_POSITION_OBSERVED'
     AND min(later_reported_date) = '2099-06-30'
     AND min(later_principal_raw) = '25'
     AND min(later_fair_value_raw) = '9'
     AND min(later_accession_number) = '0000000000-00-000001'
     AND min(earlier_accession_number) IS NULL
     AND min(principal_delta) IS NULL
     AND min(instrument_resolution_state) = 'MATCHED'
  FROM registry.bdc_portfolio_period_changes('9999999901', '2099-03-31', '2099-06-30')
  WHERE position_id = (
    SELECT p.id::text FROM identity.position p WHERE p.creation_reason = 'TEST ONLY period new')));

SELECT pg_temp.check('an absent later position stays no longer observed', (
  SELECT count(*) = 1
     AND min(change_type) = 'POSITION_NO_LONGER_OBSERVED'
     AND min(earlier_reported_date) = '2099-03-31'
     AND min(earlier_principal_raw) = '40'
     AND min(earlier_fair_value_raw) = '30'
     AND min(earlier_accession_number) = '0000000000-00-000001'
     AND min(later_accession_number) IS NULL
     AND min(principal_delta) IS NULL
  FROM registry.bdc_portfolio_period_changes('9999999901', '2099-03-31', '2099-06-30')
  WHERE position_id = (
    SELECT p.id::text FROM identity.position p WHERE p.creation_reason = 'TEST ONLY period exit')));

SELECT pg_temp.check('another period and another CIK stay out of this comparison', (
  SELECT (SELECT count(*) FROM registry.bdc_portfolio_period_changes('9999999901', '2099-01-31', '2099-02-28')) = 0
     AND (SELECT count(*) FROM registry.bdc_portfolio_period_changes('9999999902', '2099-03-31', '2099-06-30')) = 0
     AND (SELECT count(*) FROM registry.bdc_portfolio_period_changes('9999999901', '2099-06-30', '2099-03-31')) = 0));

SELECT pg_temp.check('a non-consecutive pair does not invent a field change', (
  SELECT count(*) = 0
  FROM registry.bdc_portfolio_period_changes('9999999901', '2099-03-31', '2099-09-30')
  WHERE change_type = 'EXISTING_POSITION_CHANGED'
    AND position_id = (
      SELECT p.id::text FROM identity.position p WHERE p.creation_reason = 'TEST ONLY period series')));

SELECT pg_temp.check('the same borrower name without an instrument is not a new position', (
  SELECT count(*) = 0
  FROM registry.bdc_portfolio_period_changes('9999999901', '2099-03-31', '2099-06-30')
  WHERE borrower_name_raw = 'TEST NAME ONLY'
     OR earlier_position_observation_id IN (pg_temp.fx('name_early')::text, pg_temp.fx('name_late')::text)
     OR later_position_observation_id IN (pg_temp.fx('name_early')::text, pg_temp.fx('name_late')::text)));

SELECT pg_temp.check('two matched observations on one date are not a disappearance', (
  SELECT count(*) = 0
  FROM registry.bdc_portfolio_period_changes('9999999901', '2099-03-31', '2099-06-30')
  WHERE position_id = (
    SELECT p.id::text FROM identity.position p WHERE p.creation_reason = 'TEST ONLY period ambiguous')));

SELECT pg_temp.check('summary counts keep unresolved and ambiguous positions out of the change totals', (
  SELECT earlier_observation_count::integer >= 4
     AND later_observation_count::integer >= 3
     AND unresolved_count::integer >= 2
     AND observed_in_both_count = '1'
     AND changed_count = '1'
     AND new_count = '1'
     AND no_longer_count = '1'
     AND ambiguous_position_count = '1'
     AND changes_definition = 'portfolio.period_changes.v1'
  FROM registry.bdc_portfolio_period_summary('9999999901', '2099-03-31', '2099-06-30')));

SELECT pg_temp.check('the period read reuses scope and the stored comparison', (
  SELECT position('bdc_portfolio_scope' IN pg_get_functiondef('registry.bdc_portfolio_period_identity(text,date)'::regprocedure)) > 0
     AND position('position_period_comparison' IN pg_get_functiondef('registry.bdc_portfolio_period_changes(text,date,date)'::regprocedure)) > 0
     AND position('principal_numeric' IN pg_get_functiondef('registry.bdc_portfolio_period_changes(text,date,date)'::regprocedure)) = 0
     AND pg_get_functiondef('registry.bdc_portfolio_period_changes(text,date,date)'::regprocedure) !~ 'REPAID|REFINANC|origination|probability|score|rank'
     AND pg_get_function_result('registry.bdc_portfolio_period_changes(text,date,date)'::regprocedure) !~* 'origination|repay|refinanc|score|rank|probability'));

SELECT pg_temp.expect_ok('reader can select portfolio period changes', ARRAY[
  'SET ROLE bdc_reader',
  $$SELECT count(*) FROM registry.bdc_portfolio_period_changes('9999999901', '2099-03-31', '2099-06-30')$$,
  $$SELECT changed_count FROM registry.bdc_portfolio_period_summary('9999999901', '2099-03-31', '2099-06-30')$$,
  'RESET ROLE']);
