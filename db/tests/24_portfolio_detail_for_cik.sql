-- Group 24 portfolio detail: CIK-first functions match the portfolio views.
-- Obviously fake registrants, accessions, and 2099 dates. The production registrant is not loaded.
-- The runner wraps this file in BEGIN and ROLLBACK.

SELECT pg_temp.check('the fixture registrant matches the portfolio view', (
  SELECT count(*) = 1
     AND bool_and(d.registrant_cik = v.registrant_cik)
     AND bool_and(d.name_state = v.name_state AND d.name_state = 'UNKNOWN')
     AND bool_and(d.name_raw IS NOT DISTINCT FROM v.name_raw)
     AND bool_and(d.ticker_state = v.ticker_state AND d.ticker_raw IS NOT DISTINCT FROM v.ticker_raw)
     AND bool_and(d.file_number_state = v.file_number_state AND d.file_number_raw IS NOT DISTINCT FROM v.file_number_raw)
     AND bool_and(d.reported_date_count = v.reported_date_count AND d.reported_date_count = 1)
     AND bool_and(d.registrant_cik = '9999999901')
  FROM registry.portfolio_detail_registrant('9999999901') d
  JOIN registry.portfolio_registrant v ON v.registrant_cik = d.registrant_cik));

SELECT pg_temp.check('the fixture has no name sources on either path',
  (SELECT count(*) = 0 FROM registry.portfolio_detail_names('9999999901'))
  AND (SELECT count(*) = 0 FROM registry.portfolio_registrant_name WHERE registrant_cik = '9999999901'));

SELECT pg_temp.check('the fixture date counts two disclosed lines and does not total an amount', (
  SELECT count(*) = 1
     AND bool_and(d.disclosed_line_count = v.disclosed_line_count AND d.disclosed_line_count = 2)
     AND bool_and(d.point_in_time_line_count = v.point_in_time_line_count AND d.point_in_time_line_count = 2)
     AND bool_and(d.duration_line_count = v.duration_line_count AND d.duration_line_count = 0)
     AND bool_and(d.reported_date = v.reported_date AND d.reported_date = '2099-12-31')
  FROM registry.portfolio_detail_dates('9999999901') d
  JOIN registry.portfolio_reported_date v
    ON v.registrant_cik = '9999999901' AND v.reported_date = d.reported_date));

DO $$
DECLARE
  own_filing bigint;
  shared_filing bigint;
  registrant2 bigint;
  stale_link bigint;
  soi bigint;
  row_id bigint;
BEGIN
  WITH i AS (
    INSERT INTO registry.registrant (cik, run_id, evidence_id)
    VALUES (9999999902, pg_temp.fx('run'), pg_temp.fx('e_sub'))
    RETURNING id
  ) SELECT id INTO registrant2 FROM i;
  PERFORM pg_temp.put('registrant2', registrant2);

  WITH i AS (
    INSERT INTO registry.registrant (cik, run_id, evidence_id)
    VALUES (9999999903, pg_temp.fx('run'), pg_temp.fx('e_sub'))
    RETURNING id
  ) SELECT id INTO registrant2 FROM i;
  PERFORM pg_temp.put('registrant_empty', registrant2);

  row_id := pg_temp.add_row(pg_temp.fx('l_soi'), 6,
    '0000000000-00-000002' || E'\t9999999902\tTEST BDC 2\t2099-06-30\t0\tTEST HOLDING PIT\t\t\t\t\t');
  PERFORM pg_temp.put('e_own', pg_temp.add_evidence('L1_STRUCTURED_DATASET', pg_temp.fx('artifact'), row_id));

  WITH i AS (
    INSERT INTO registry.filing (accession_number, run_id, evidence_id)
    VALUES ('0000000000-00-000002', pg_temp.fx('run'), pg_temp.fx('e_own'))
    RETURNING id
  ) SELECT id INTO own_filing FROM i;

  INSERT INTO registry.filing_registrant_link (filing_id, registrant_id, link_source, run_id, evidence_id)
  VALUES (own_filing, pg_temp.fx('registrant2'), 'SUB_TABLE', pg_temp.fx('run'), pg_temp.fx('e_own'));

  INSERT INTO obs.soi_row_observation (tabular_row_id, filing_id, reported_date_raw, reported_date,
      date_precision, qtrs_raw, qtrs, duration_kind, identifier_raw, rule_version_id, evidence_id, run_id)
  VALUES (row_id, own_filing, '2099-06-30', '2099-06-30', 'MONTH_END_ROUNDED', '0', 0,
          'POINT_IN_TIME', 'TEST HOLDING PIT', pg_temp.fx('r_project'), pg_temp.fx('e_own'), pg_temp.fx('run'))
  RETURNING id INTO soi;
  INSERT INTO obs.soi_row_classification (soi_row_observation_id, row_kind, period_role, rule_version_id, run_id)
  VALUES (soi, 'IDENTIFIER_ROW', 'UNRESOLVED', pg_temp.fx('r_classify'), pg_temp.fx('run'));
  INSERT INTO obs.position_observation (origin_soi_row_observation_id, filing_id, reported_date,
      date_precision, duration_kind, holding_descriptor_raw, rule_version_id, evidence_id, run_id)
  VALUES (soi, own_filing, '2099-06-30', 'MONTH_END_ROUNDED', 'POINT_IN_TIME',
          'TEST HOLDING PIT', pg_temp.fx('r_position'), pg_temp.fx('e_own'), pg_temp.fx('run'));

  row_id := pg_temp.add_row(pg_temp.fx('l_soi'), 7,
    '0000000000-00-000002' || E'\t9999999902\tTEST BDC 2\t2099-09-30\t1\tTEST HOLDING DUR\t\t\t\t\t');
  PERFORM pg_temp.put('e_dur', pg_temp.add_evidence('L1_STRUCTURED_DATASET', pg_temp.fx('artifact'), row_id));
  INSERT INTO obs.soi_row_observation (tabular_row_id, filing_id, reported_date_raw, reported_date,
      date_precision, qtrs_raw, qtrs, duration_kind, identifier_raw, rule_version_id, evidence_id, run_id)
  VALUES (row_id, own_filing, '2099-09-30', '2099-09-30', 'MONTH_END_ROUNDED', '1', 1,
          'DURATION', 'TEST HOLDING DUR', pg_temp.fx('r_project'), pg_temp.fx('e_dur'), pg_temp.fx('run'))
  RETURNING id INTO soi;
  INSERT INTO obs.soi_row_classification (soi_row_observation_id, row_kind, period_role, rule_version_id, run_id)
  VALUES (soi, 'IDENTIFIER_ROW', 'UNRESOLVED', pg_temp.fx('r_classify'), pg_temp.fx('run'));
  INSERT INTO obs.position_observation (origin_soi_row_observation_id, filing_id, reported_date,
      date_precision, duration_kind, holding_descriptor_raw, rule_version_id, evidence_id, run_id)
  VALUES (soi, own_filing, '2099-09-30', 'MONTH_END_ROUNDED', 'DURATION',
          'TEST HOLDING DUR', pg_temp.fx('r_position'), pg_temp.fx('e_dur'), pg_temp.fx('run'));

  row_id := pg_temp.add_row(pg_temp.fx('l_soi'), 8,
    '0000000000-00-000002' || E'\t9999999902\tTEST BDC 2\t\t0\tTEST HOLDING UNDATED\t\t\t\t\t');
  PERFORM pg_temp.put('e_undated', pg_temp.add_evidence('L1_STRUCTURED_DATASET', pg_temp.fx('artifact'), row_id));
  INSERT INTO obs.soi_row_observation (tabular_row_id, filing_id, reported_date_raw, reported_date,
      date_precision, qtrs_raw, qtrs, duration_kind, identifier_raw, rule_version_id, evidence_id, run_id)
  VALUES (row_id, own_filing, '', NULL, 'MONTH_END_ROUNDED', '0', 0,
          'POINT_IN_TIME', 'TEST HOLDING UNDATED', pg_temp.fx('r_project'), pg_temp.fx('e_undated'), pg_temp.fx('run'))
  RETURNING id INTO soi;
  INSERT INTO obs.soi_row_classification (soi_row_observation_id, row_kind, period_role, rule_version_id, run_id)
  VALUES (soi, 'IDENTIFIER_ROW', 'UNRESOLVED', pg_temp.fx('r_classify'), pg_temp.fx('run'));
  INSERT INTO obs.position_observation (origin_soi_row_observation_id, filing_id, reported_date,
      date_precision, duration_kind, holding_descriptor_raw, rule_version_id, evidence_id, run_id)
  VALUES (soi, own_filing, NULL, 'MONTH_END_ROUNDED', 'POINT_IN_TIME',
          'TEST HOLDING UNDATED', pg_temp.fx('r_position'), pg_temp.fx('e_undated'), pg_temp.fx('run'));

  INSERT INTO registry.registrant_attribute_observation (registrant_id, attribute_code, raw_value, rule_version_id, run_id, evidence_id)
  VALUES (pg_temp.fx('registrant2'), 'NAME', 'TEST BDC 2', pg_temp.fx('r_project'), pg_temp.fx('run'), pg_temp.fx('e_own')),
         (pg_temp.fx('registrant2'), 'NAME', 'TEST BDC 2', pg_temp.fx('r_project2'), pg_temp.fx('run'), pg_temp.fx('e_dur'));

  row_id := pg_temp.add_row(pg_temp.fx('l_soi'), 9,
    '0000000000-00-000003' || E'\t9999999902\tTEST BDC 2\t2098-12-31\t0\tTEST HOLDING SHARED\t\t\t\t\t');
  PERFORM pg_temp.put('e_shared', pg_temp.add_evidence('L1_STRUCTURED_DATASET', pg_temp.fx('artifact'), row_id));
  WITH i AS (
    INSERT INTO registry.filing (accession_number, run_id, evidence_id)
    VALUES ('0000000000-00-000003', pg_temp.fx('run'), pg_temp.fx('e_shared'))
    RETURNING id
  ) SELECT id INTO shared_filing FROM i;
  INSERT INTO registry.filing_registrant_link (filing_id, registrant_id, link_source, run_id, evidence_id)
  VALUES (shared_filing, pg_temp.fx('registrant'), 'SUB_TABLE', pg_temp.fx('run'), pg_temp.fx('e_shared')),
         (shared_filing, pg_temp.fx('registrant2'), 'SUB_TABLE', pg_temp.fx('run'), pg_temp.fx('e_shared'));
  INSERT INTO obs.soi_row_observation (tabular_row_id, filing_id, reported_date_raw, reported_date,
      date_precision, qtrs_raw, qtrs, duration_kind, identifier_raw, rule_version_id, evidence_id, run_id)
  VALUES (row_id, shared_filing, '2098-12-31', '2098-12-31', 'MONTH_END_ROUNDED', '0', 0,
          'POINT_IN_TIME', 'TEST HOLDING SHARED', pg_temp.fx('r_project'), pg_temp.fx('e_shared'), pg_temp.fx('run'))
  RETURNING id INTO soi;
  INSERT INTO obs.soi_row_classification (soi_row_observation_id, row_kind, period_role, rule_version_id, run_id)
  VALUES (soi, 'IDENTIFIER_ROW', 'UNRESOLVED', pg_temp.fx('r_classify'), pg_temp.fx('run'));
  INSERT INTO obs.position_observation (origin_soi_row_observation_id, filing_id, reported_date,
      date_precision, duration_kind, holding_descriptor_raw, rule_version_id, evidence_id, run_id)
  VALUES (soi, shared_filing, '2098-12-31', 'MONTH_END_ROUNDED', 'POINT_IN_TIME',
          'TEST HOLDING SHARED', pg_temp.fx('r_position'), pg_temp.fx('e_shared'), pg_temp.fx('run'));

  WITH i AS (
    INSERT INTO registry.filing_registrant_link (filing_id, registrant_id, link_source, run_id, evidence_id)
    VALUES (pg_temp.fx('filing'), pg_temp.fx('registrant2'), 'SUB_TABLE', pg_temp.fx('run'), pg_temp.fx('e_sub'))
    RETURNING id
  ) SELECT id INTO stale_link FROM i;
  INSERT INTO registry.filing_registrant_link (filing_id, registrant_id, link_source, run_id, evidence_id, supersedes_id, supersede_reason)
  VALUES (pg_temp.fx('filing'), pg_temp.fx('registrant'), 'SUB_TABLE', pg_temp.fx('run'), pg_temp.fx('e_sub'),
          stale_link, 'TEST ONLY: this link is no longer current');
END
$$;

SELECT pg_temp.check('both synthetic registrants match the portfolio registrant view',
  NOT EXISTS (
    SELECT registrant_cik, name_state, name_raw, ticker_state, ticker_raw,
           file_number_state, file_number_raw, reported_date_count
    FROM registry.portfolio_detail_registrant('9999999901')
    EXCEPT
    SELECT registrant_cik, name_state, name_raw, ticker_state, ticker_raw,
           file_number_state, file_number_raw, reported_date_count
    FROM registry.portfolio_registrant WHERE registrant_cik = '9999999901'
  )
  AND NOT EXISTS (
    SELECT registrant_cik, name_state, name_raw, ticker_state, ticker_raw,
           file_number_state, file_number_raw, reported_date_count
    FROM registry.portfolio_registrant WHERE registrant_cik = '9999999901'
    EXCEPT
    SELECT registrant_cik, name_state, name_raw, ticker_state, ticker_raw,
           file_number_state, file_number_raw, reported_date_count
    FROM registry.portfolio_detail_registrant('9999999901')
  )
  AND NOT EXISTS (
    SELECT registrant_cik, name_state, name_raw, ticker_state, ticker_raw,
           file_number_state, file_number_raw, reported_date_count
    FROM registry.portfolio_detail_registrant('9999999902')
    EXCEPT
    SELECT registrant_cik, name_state, name_raw, ticker_state, ticker_raw,
           file_number_state, file_number_raw, reported_date_count
    FROM registry.portfolio_registrant WHERE registrant_cik = '9999999902'
  )
  AND NOT EXISTS (
    SELECT registrant_cik, name_state, name_raw, ticker_state, ticker_raw,
           file_number_state, file_number_raw, reported_date_count
    FROM registry.portfolio_registrant WHERE registrant_cik = '9999999902'
    EXCEPT
    SELECT registrant_cik, name_state, name_raw, ticker_state, ticker_raw,
           file_number_state, file_number_raw, reported_date_count
    FROM registry.portfolio_detail_registrant('9999999902')
  ));

SELECT pg_temp.check('the second registrant is reported on its own and keeps both name sources', (
  SELECT count(*) = 1
     AND bool_and(name_state = 'REPORTED' AND name_raw = 'TEST BDC 2')
     AND bool_and(ticker_state = 'UNKNOWN' AND ticker_raw IS NULL)
     AND bool_and(file_number_state = 'UNKNOWN' AND file_number_raw IS NULL)
     AND bool_and(reported_date_count = 2)
  FROM registry.portfolio_detail_registrant('9999999902'))
  AND (SELECT count(*) = 2 AND bool_and(raw_value = 'TEST BDC 2')
       FROM registry.portfolio_detail_names('9999999902'))
  AND NOT EXISTS (
    SELECT source_type_code, raw_value, documentation_status
    FROM registry.portfolio_detail_names('9999999902')
    EXCEPT
    SELECT source_type_code, raw_value, documentation_status
    FROM registry.portfolio_registrant_name WHERE registrant_cik = '9999999902'
  ));

SELECT pg_temp.check('point-in-time and duration stay separate and an undated line is not a date',
  (SELECT disclosed_line_count = 1 AND point_in_time_line_count = 1 AND duration_line_count = 0
   FROM registry.portfolio_detail_dates('9999999902') WHERE reported_date = '2099-06-30')
  AND (SELECT disclosed_line_count = 1 AND point_in_time_line_count = 0 AND duration_line_count = 1
   FROM registry.portfolio_detail_dates('9999999902') WHERE reported_date = '2099-09-30')
  AND (SELECT count(*) = 2 AND coalesce(sum(disclosed_line_count), 0) = 2
       FROM registry.portfolio_detail_dates('9999999902'))
  AND NOT EXISTS (
    SELECT reported_date, disclosed_line_count, point_in_time_line_count, duration_line_count
    FROM registry.portfolio_detail_dates('9999999902')
    EXCEPT
    SELECT reported_date, disclosed_line_count, point_in_time_line_count, duration_line_count
    FROM registry.portfolio_reported_date WHERE registrant_cik = '9999999902'
  ));

SELECT pg_temp.check('a filing linked to two registrants is omitted and a superseded link stays historical',
  NOT EXISTS (
    SELECT 1 FROM registry.portfolio_detail_dates('9999999901') WHERE reported_date = '2098-12-31'
  )
  AND NOT EXISTS (
    SELECT 1 FROM registry.portfolio_detail_dates('9999999902') WHERE reported_date = '2098-12-31'
  )
  AND (SELECT disclosed_line_count = 2 AND point_in_time_line_count = 2 AND duration_line_count = 0
       FROM registry.portfolio_detail_dates('9999999901')));

SELECT pg_temp.check('a ten-digit CIK with no positions returns no registrant row',
  (SELECT count(*) = 0 FROM registry.portfolio_detail_registrant('9999999903'))
  AND (SELECT count(*) = 0 FROM registry.portfolio_detail_names('9999999903'))
  AND (SELECT count(*) = 0 FROM registry.portfolio_detail_dates('9999999903'))
  AND (SELECT count(*) = 0 FROM registry.portfolio_registrant WHERE registrant_cik = '9999999903'));

SELECT pg_temp.check('an unknown CIK returns no registrant row',
  (SELECT count(*) = 0 FROM registry.portfolio_detail_registrant('9999999904'))
  AND (SELECT count(*) = 0 FROM registry.portfolio_detail_registrant('not-a-cik')));

SELECT pg_temp.check('detail functions do not read maturity or empty periods and do not write',
  (SELECT count(*) = 4
   FROM pg_proc p
   JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'registry'
     AND p.proname IN ('portfolio_detail_filing', 'portfolio_detail_registrant',
                       'portfolio_detail_names', 'portfolio_detail_dates')
     AND p.prosecdef
     AND p.provolatile = 's'
     AND 'search_path=pg_catalog, registry, obs' = ANY (p.proconfig)
     AND pg_get_functiondef(p.oid) !~* 'maturity'
     AND pg_get_functiondef(p.oid) !~* 'portfolio_empty_period'
     AND pg_get_functiondef(p.oid) !~* '\m(insert|update|delete)\M'));

SELECT pg_temp.check('reader can execute the detail functions without selecting position rows',
  NOT has_table_privilege('bdc_reader', 'obs.position_observation', 'SELECT')
  AND has_function_privilege('bdc_reader', 'registry.portfolio_detail_registrant(text)', 'EXECUTE')
  AND has_function_privilege('bdc_reader', 'registry.portfolio_detail_names(text)', 'EXECUTE')
  AND has_function_privilege('bdc_reader', 'registry.portfolio_detail_dates(text)', 'EXECUTE')
  AND NOT has_function_privilege('bdc_reader', 'registry.portfolio_detail_filing(text)', 'EXECUTE'));

SELECT pg_temp.expect_ok('reader can read one registrant detail and the empty-period view', ARRAY[
  'SET ROLE bdc_reader',
  'SET statement_timeout = ''30s''',
  'SELECT registrant_cik FROM registry.portfolio_detail_registrant(''9999999901'')',
  'SELECT source_type_code FROM registry.portfolio_detail_names(''9999999902'')',
  'SELECT reported_date FROM registry.portfolio_detail_dates(''9999999902'')',
  'SELECT release_label FROM registry.portfolio_empty_period',
  'RESET ROLE']);
