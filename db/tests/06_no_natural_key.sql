-- Group 6: SOI has no natural key; registrant identity never comes from the accession prefix.

SELECT pg_temp.check('two SOI rows with identical accession, identifier, ddate, and qtrs are both kept', (
  SELECT count(*) = 2 FROM obs.soi_row_observation
  WHERE filing_id = pg_temp.fx('filing') AND identifier_raw = 'TEST BORROWER A | TEST LOAN 1'
    AND reported_date = '2099-12-31' AND qtrs = 0));

SELECT pg_temp.check('each duplicate SOI row has its own position observation (never merged)', (
  SELECT count(*) = 2 FROM obs.position_observation
  WHERE filing_id = pg_temp.fx('filing') AND holding_descriptor_raw = 'TEST BORROWER A | TEST LOAN 1'));

SELECT pg_temp.expect_ok('the same raw row may be projected again under a new rule version', ARRAY[format(
  $$INSERT INTO obs.soi_row_observation (tabular_row_id, filing_id, reported_date_raw, reported_date, date_precision,
      qtrs_raw, qtrs, duration_kind, identifier_raw, rule_version_id, evidence_id, run_id)
    VALUES (%s, %s, '2099-12-31', '2099-12-31', 'MONTH_END_ROUNDED', '0', 0, 'POINT_IN_TIME',
            'TEST BORROWER A | TEST LOAN 1', %s, %s, %s)$$,
  pg_temp.fx('row_soi_a'), pg_temp.fx('filing'), pg_temp.fx('r_project2'), pg_temp.fx('e_soi_a'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('projecting the same raw row twice under one rule version is rejected (provenance idempotency)', '23505',
  ARRAY[format(
  $$INSERT INTO obs.soi_row_observation (tabular_row_id, filing_id, reported_date_raw, reported_date, date_precision,
      qtrs_raw, qtrs, duration_kind, identifier_raw, rule_version_id, evidence_id, run_id)
    VALUES (%s, %s, '2099-12-31', '2099-12-31', 'MONTH_END_ROUNDED', '0', 0, 'POINT_IN_TIME',
            'TEST BORROWER A | TEST LOAN 1', %s, %s, %s)$$,
  pg_temp.fx('row_soi_a'), pg_temp.fx('filing'), pg_temp.fx('r_project'), pg_temp.fx('e_soi_a'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('a raw line location (load, line number) is stored once', '23505',
  ARRAY[format($$SELECT pg_temp.add_row(%s, 2, 'TEST')$$, pg_temp.fx('l_soi'))]);

SELECT pg_temp.expect_error('a row with the wrong field count cannot be projected into a typed observation', 'BDCI1',
  ARRAY[format(
  $$INSERT INTO obs.soi_row_observation (tabular_row_id, filing_id, reported_date_raw, date_precision,
      qtrs_raw, duration_kind, rule_version_id, evidence_id, run_id)
    VALUES (%s, %s, '', 'MONTH_END_ROUNDED', '', 'UNKNOWN', %s, %s, %s)$$,
  pg_temp.fx('row_soi_short'), pg_temp.fx('filing'), pg_temp.fx('r_project'),
  pg_temp.add_evidence('L1_STRUCTURED_DATASET', pg_temp.fx('artifact'), pg_temp.fx('row_soi_short')), pg_temp.fx('run'))]);

SELECT pg_temp.check('the mismatched raw row itself is kept losslessly with FIELD_COUNT_MISMATCH', (
  SELECT parse_status = 'FIELD_COUNT_MISMATCH' AND field_count = 3 FROM raw.tabular_row WHERE id = pg_temp.fx('row_soi_short')));

SELECT pg_temp.expect_error('raw identifier must equal the source cell (no silent cleanup)', 'BDCI1',
  ARRAY[format(
  $$INSERT INTO obs.soi_row_observation (tabular_row_id, filing_id, reported_date_raw, reported_date, date_precision,
      qtrs_raw, qtrs, duration_kind, identifier_raw, rule_version_id, evidence_id, run_id)
    VALUES (%s, %s, '2099-12-31', '2099-12-31', 'MONTH_END_ROUNDED', '0', 0, 'POINT_IN_TIME',
            'TEST BORROWER A', %s, %s, %s)$$,
  pg_temp.fx('row_soi_b'), pg_temp.fx('filing'), pg_temp.fx('r_project2'), pg_temp.fx('e_soi_b'), pg_temp.fx('run'))]);

-- Accession prefix is not the registrant: a filing whose prefix equals a registrant's CIK,
-- with no explicit link, has UNKNOWN registrant.
SELECT pg_temp.expect_ok('a filing with no explicit registrant link can exist', ARRAY[format(
  $$INSERT INTO registry.filing (accession_number, run_id, evidence_id) VALUES ('9999999901-99-000002', %s, %s)$$,
  pg_temp.fx('run'), pg_temp.fx('e_sub'))]);

SELECT pg_temp.check('its registrant is UNKNOWN even though the accession prefix equals a registrant CIK', (
  SELECT registrant_id IS NULL AND cik IS NULL AND registrant_link_status = 'UNKNOWN'
  FROM registry.current_filing_registrant WHERE accession_number = '9999999901-99-000002'));

SELECT pg_temp.expect_error('ACCESSION_PREFIX is not a valid registrant link source', '22P02',
  ARRAY[format(
  $$INSERT INTO registry.filing_registrant_link (filing_id, registrant_id, link_source, run_id, evidence_id)
    VALUES (%s, %s, 'ACCESSION_PREFIX', %s, %s)$$,
  pg_temp.fx('filing'), pg_temp.fx('registrant'), pg_temp.fx('run'), pg_temp.fx('e_sub'))]);

SELECT pg_temp.expect_ok('two sources naming different registrants are both kept', ARRAY[
  format($$INSERT INTO registry.registrant (cik, run_id, evidence_id) VALUES (9999999902, %s, %s)$$, pg_temp.fx('run'), pg_temp.fx('e_sub')),
  format($$INSERT INTO registry.filing_registrant_link (filing_id, registrant_id, link_source, run_id, evidence_id)
           SELECT %s, id, 'SUBMISSIONS_JSON', %s, %s FROM registry.registrant WHERE cik = 9999999902$$,
         pg_temp.fx('filing'), pg_temp.fx('run'), pg_temp.fx('e_sub'))]);

SELECT pg_temp.check('conflicting explicit links surface as MULTIPLE, not a silent choice', (
  SELECT bool_and(registrant_link_status = 'MULTIPLE') AND count(*) = 2
  FROM registry.current_filing_registrant WHERE filing_id = pg_temp.fx('filing')));

SELECT pg_temp.expect_error('accession numbers must have the EDGAR format', '23514',
  ARRAY[format($$INSERT INTO registry.filing (accession_number, run_id, evidence_id) VALUES ('0000000000000000001', %s, %s)$$,
               pg_temp.fx('run'), pg_temp.fx('e_sub'))]);
