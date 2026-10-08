-- Group 45: BDC portfolio holdings. Fake names, CIKs, and 2099 dates only.
-- Two current links to one registrant keep that CIK.
-- Two registrants leave the CIK null and drop the filing from the portfolio.
-- Money is totaled only when every holding in the date has one known currency.

SELECT pg_temp.check('one current link keeps the registrant CIK on the position read', (
  SELECT registrant_link_status = 'LINKED'
     AND registrant_cik = '9999999901'
     AND registrant_id = pg_temp.fx('registrant')
  FROM registry.position_read
  WHERE position_observation_id = pg_temp.fx('po_a')));

SELECT pg_temp.check('holdings for the registrant date reuse that position and accession', (
  SELECT count(*) = 1
     AND min(registrant_cik) = '9999999901'
     AND min(reported_date) = '2099-12-31'
     AND min(position_observation_id) = pg_temp.fx('po_a')::text
     AND min(accession_number) = '0000000000-00-000001'
     AND min(observation_evidence_level) IS NOT NULL
     AND min(holdings_definition) = 'portfolio.holdings.v1'
     AND bool_and(document_url IS NULL OR document_url ~ '^https://www\.sec\.gov/Archives/edgar/data/')
  FROM registry.bdc_portfolio_holdings('9999999901', '2099-12-31', 1, 0)));

SELECT pg_temp.check('another reported date is a separate portfolio', (
  SELECT count(*) = 0
  FROM registry.bdc_portfolio_holdings('9999999901', '2099-06-30', 50, 0)));

SELECT pg_temp.check('another CIK does not receive this filing', (
  SELECT count(*) = 0
  FROM registry.bdc_portfolio_holdings('9999999902', '2099-12-31', 50, 0)));

SELECT pg_temp.check('an unresolved instrument stays in the portfolio and is not a resolved position', (
  SELECT instrument_resolution_state = 'UNRESOLVED'
     AND continuity_state = 'UNRESOLVED'
     AND borrower_name_raw IS NULL
  FROM registry.bdc_portfolio_holdings('9999999901', '2099-12-31', 1, 0)
  WHERE position_observation_id = pg_temp.fx('po_a')::text));

SELECT pg_temp.check('unknown currency is counted and is not a principal total', (
  SELECT observation_count::integer = 2
     AND resolved_position_count = '0'
     AND unresolved_count = '2'
     AND known_principal_count = '1'
     AND known_fair_value_count = '0'
     AND known_maturity_count = '0'
     AND unknown_currency_count::integer >= 1
     AND principal_aggregation_state = 'INSUFFICIENT_DATA'
     AND principal_total IS NULL
     AND principal_currency_code IS NULL
     AND fair_value_aggregation_state = 'INSUFFICIENT_DATA'
     AND fair_value_total IS NULL
     AND holdings_definition = 'portfolio.holdings.v1'
  FROM registry.bdc_portfolio_summary('9999999901', '2099-12-31')));

SELECT pg_temp.check('the reported principal stays the stored raw value', (
  SELECT principal_state = 'REPORTED'
     AND principal_raw = '100'
     AND principal_currency_state = 'UNKNOWN'
     AND principal_currency_code IS NULL
     AND fair_value_state = 'UNKNOWN'
     AND fair_value_raw IS NULL
     AND instrument_type_state = 'UNKNOWN'
  FROM registry.bdc_portfolio_holdings('9999999901', '2099-12-31', 1, 0)
  WHERE position_observation_id = pg_temp.fx('po_a')::text));

SELECT pg_temp.expect_ok('a second current link to the same registrant is still one CIK', ARRAY[
  format($$WITH ev AS (
             INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, run_id)
             VALUES ('L2_ORIGINAL_FILING', %s, 'DOCUMENT', %s)
             RETURNING id)
           INSERT INTO registry.filing_registrant_link (filing_id, registrant_id, link_source, run_id, evidence_id)
           SELECT %s, %s, 'SUBMISSIONS_JSON', %s, ev.id FROM ev$$,
         pg_temp.fx('artifact'), pg_temp.fx('run'),
         pg_temp.fx('filing'), pg_temp.fx('registrant'), pg_temp.fx('run'))]);

SELECT pg_temp.check('duplicate sources for one registrant keep the CIK and do not pick one evidence row', (
  SELECT registrant_link_status = 'LINKED'
     AND registrant_cik = '9999999901'
     AND registrant_evidence_id IS NULL
  FROM registry.position_read
  WHERE position_observation_id = pg_temp.fx('po_a')));

SELECT pg_temp.check('the portfolio still attributes the filing after the duplicate source link', (
  SELECT count(*) = 2
     AND bool_and(registrant_cik = '9999999901')
  FROM registry.bdc_portfolio_holdings('9999999901', '2099-12-31', 50, 0)));

CREATE FUNCTION pg_temp.coded_portfolio() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  acc constant text := '0000000000-00-000002';
  line text;
  row_id bigint;
  ev_row bigint;
  soi_id bigint;
  po_id bigint;
  filing_id bigint;
  registrant_id bigint;
BEGIN
  line := acc || E'\t9999999902\tTEST BDC 2\t2099-06-30\t0\tTEST BORROWER B | TEST LOAN 2\t10\t8\t\t\t';
  row_id := pg_temp.add_row(pg_temp.fx('l_soi'), 900, line);
  ev_row := pg_temp.add_evidence('L1_STRUCTURED_DATASET', pg_temp.fx('artifact'), row_id);
  INSERT INTO registry.registrant (cik, run_id, evidence_id)
  VALUES (9999999902, pg_temp.fx('run'), pg_temp.fx('e_sub'))
  RETURNING id INTO registrant_id;
  INSERT INTO registry.filing (accession_number, run_id, evidence_id)
  VALUES (acc, pg_temp.fx('run'), pg_temp.fx('e_sub'))
  RETURNING id INTO filing_id;
  INSERT INTO registry.filing_registrant_link (filing_id, registrant_id, link_source, run_id, evidence_id)
  VALUES (filing_id, registrant_id, 'SUB_TABLE', pg_temp.fx('run'), ev_row);
  INSERT INTO obs.soi_row_observation (
      tabular_row_id, filing_id, reported_date_raw, reported_date, date_precision,
      qtrs_raw, qtrs, duration_kind, identifier_raw, rule_version_id, evidence_id, run_id)
  VALUES (row_id, filing_id, '2099-06-30', '2099-06-30', 'MONTH_END_ROUNDED', '0', 0,
          'POINT_IN_TIME', 'TEST BORROWER B | TEST LOAN 2', pg_temp.fx('r_project'), ev_row, pg_temp.fx('run'))
  RETURNING id INTO soi_id;
  INSERT INTO obs.soi_row_classification (soi_row_observation_id, row_kind, period_role, rule_version_id, run_id)
  VALUES (soi_id, 'IDENTIFIER_ROW', 'UNRESOLVED', pg_temp.fx('r_classify'), pg_temp.fx('run'));
  INSERT INTO obs.position_observation (
      origin_soi_row_observation_id, filing_id, reported_date, date_precision, duration_kind,
      holding_descriptor_raw, rule_version_id, evidence_id, run_id)
  VALUES (soi_id, filing_id, '2099-06-30', 'MONTH_END_ROUNDED', 'POINT_IN_TIME',
          'TEST BORROWER B | TEST LOAN 2', pg_temp.fx('r_position'), ev_row, pg_temp.fx('run'))
  RETURNING id INTO po_id;
  INSERT INTO obs.position_observation_source (position_observation_id, soi_row_observation_id, source_role, run_id)
  VALUES (po_id, soi_id, 'PRIMARY', pg_temp.fx('run'));
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, run_id)
  VALUES ('L2_ORIGINAL_FILING', pg_temp.fx('artifact'), 'DOCUMENT', pg_temp.fx('run'));
  INSERT INTO obs.position_field_value (
      position_observation_id, field_code, raw_value, normalized_numeric,
      currency_code, currency_state, scale_state, value_state,
      normalization_rule_version_id, evidence_id, run_id)
  VALUES
    (po_id, 'PRINCIPAL_AMOUNT', '10', 10, 'AAA', 'FROM_FILING', 'NOT_APPLICABLE', 'REPORTED',
     pg_temp.fx('r_field'), (SELECT max(id) FROM evidence.evidence), pg_temp.fx('run')),
    (po_id, 'FAIR_VALUE', '8', 8, 'AAA', 'FROM_FILING', 'NOT_APPLICABLE', 'REPORTED',
     pg_temp.fx('r_field'), (SELECT max(id) FROM evidence.evidence), pg_temp.fx('run'));
  PERFORM pg_temp.put('coded_po', po_id);
  PERFORM pg_temp.put('coded_filing', filing_id);
  PERFORM pg_temp.put('coded_registrant', registrant_id);
END
$$;

SELECT pg_temp.coded_portfolio();
SELECT set_config('search_path', 'pg_temp, public', true);
SET CONSTRAINTS ALL IMMEDIATE;

SELECT pg_temp.check('one currency on every holding is a stored total', (
  SELECT observation_count = '1'
     AND known_principal_count = '1'
     AND known_fair_value_count = '1'
     AND principal_aggregation_state = 'COMPARABLE'
     AND principal_total = '10'
     AND principal_currency_code = 'AAA'
     AND fair_value_aggregation_state = 'COMPARABLE'
     AND fair_value_total = '8'
     AND fair_value_currency_code = 'AAA'
     AND unknown_currency_count = '0'
  FROM registry.bdc_portfolio_summary('9999999902', '2099-06-30')));

SELECT pg_temp.check('the coded holding stays on its own CIK and date', (
  SELECT count(*) = 1
     AND min(position_observation_id) = pg_temp.fx('coded_po')::text
     AND min(principal_raw) = '10'
     AND min(principal_currency_code) = 'AAA'
     AND min(fair_value_raw) = '8'
     AND min(fair_value_currency_code) = 'AAA'
     AND min(accession_number) = '0000000000-00-000002'
  FROM registry.bdc_portfolio_holdings('9999999902', '2099-06-30', 50, 0)));

SELECT pg_temp.check('the coded holding is absent from the other period and the other CIK', (
  SELECT (SELECT count(*) FROM registry.bdc_portfolio_holdings('9999999902', '2099-12-31', 50, 0)) = 0
     AND (SELECT count(*) FROM registry.bdc_portfolio_holdings('9999999901', '2099-06-30', 50, 0)) = 0));

SELECT pg_temp.check('a period with no confirmed comparison has no portfolio-change row', (
  SELECT count(*) = 0
  FROM registry.bdc_portfolio_changes('9999999902', '2099-06-30')));

SELECT pg_temp.expect_ok('a second registrant makes the filing ambiguous', ARRAY[
  format($$INSERT INTO registry.registrant (cik, run_id, evidence_id) VALUES (9999999903, %s, %s)$$,
         pg_temp.fx('run'), pg_temp.fx('e_sub')),
  format($$INSERT INTO registry.filing_registrant_link (filing_id, registrant_id, link_source, run_id, evidence_id)
           SELECT %s, id, 'SUBMISSIONS_JSON', %s, %s FROM registry.registrant WHERE cik = 9999999903$$,
         pg_temp.fx('coded_filing'), pg_temp.fx('run'), pg_temp.fx('e_sub'))]);

SELECT pg_temp.check('two registrants leave the CIK null', (
  SELECT registrant_link_status = 'MULTIPLE'
     AND registrant_cik IS NULL
     AND registrant_id IS NULL
  FROM registry.position_read
  WHERE position_observation_id = pg_temp.fx('coded_po')));

SELECT pg_temp.check('an ambiguous filing is not attributed to either CIK', (
  SELECT (SELECT count(*) FROM registry.bdc_portfolio_holdings('9999999902', '2099-06-30', 50, 0)) = 0
     AND (SELECT count(*) FROM registry.bdc_portfolio_holdings('9999999903', '2099-06-30', 50, 0)) = 0
     AND (SELECT observation_count FROM registry.bdc_portfolio_summary('9999999902', '2099-06-30')) = '0'
     AND (SELECT principal_total FROM registry.bdc_portfolio_summary('9999999902', '2099-06-30')) IS NULL));

SELECT pg_temp.check('portfolio changes copy stored comparisons and do not classify an exit', (
  SELECT position('position_period_comparison' IN pg_get_functiondef('registry.bdc_portfolio_changes(text,date)'::regprocedure)) > 0
     AND position('bdc_portfolio_scope' IN pg_get_functiondef('registry.bdc_portfolio_holdings(text,date,integer,integer)'::regprocedure)) > 0
     AND pg_get_functiondef('registry.bdc_portfolio_changes(text,date)'::regprocedure) !~ 'REFINANCING|REPAYMENT|POSITION_EXITED|probability|score|rank'
     AND pg_get_function_result('registry.bdc_portfolio_summary(text,date)'::regprocedure) !~* 'score|rank|probability'));

SELECT pg_temp.expect_ok('reader can select a BDC portfolio', ARRAY[
  'SET ROLE bdc_reader',
  $$SELECT count(*) FROM registry.bdc_portfolio_holdings('9999999901', '2099-12-31', 50, 0)$$,
  $$SELECT observation_count FROM registry.bdc_portfolio_summary('9999999901', '2099-12-31')$$,
  $$SELECT count(*) FROM registry.bdc_portfolio_changes('9999999901', '2099-12-31')$$,
  'RESET ROLE']);
