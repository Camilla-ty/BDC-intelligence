-- Group 12: Phase 2 registry ingestion support (migration 0010).
-- All values are obviously fake test data (TEST BDC 1, CIK 9999999901, dates in 2099,
-- URLs under TEST-ONLY paths or for the fake CIK).

DO $$
DECLARE
  body constant text := '{"cik":"9999999901","name":"TEST BDC 1",'
    || '"formerNames":[{"name":"TEST BDC OLD","from":"2099-01-01T00:00:00.000Z","to":"2099-02-01T00:00:00.000Z"}],'
    || '"tickers":[],"filings":{"recent":{"accessionNumber":["0000000000-00-000001"],"form":["10-K"],'
    || '"primaryDocument":["test-only.htm"]},"files":[]}}';
BEGIN
  WITH i AS (
    INSERT INTO raw.artifact (source_url, final_url, source_type_code, http_status, byte_size, sha256, retrieved_at, storage_key, run_id)
    VALUES ('https://data.sec.gov/submissions/CIK9999999901.json', 'https://data.sec.gov/submissions/CIK9999999901.json',
            'SEC_SUBMISSIONS_JSON', 200, octet_length(body), encode(sha256(convert_to(body, 'UTF8')), 'hex'),
            '2099-01-02T00:00:00Z', 'test-only/json', pg_temp.fx('run'))
    RETURNING id)
  INSERT INTO fx SELECT 'a_json', id FROM i;
  INSERT INTO raw.json_document (artifact_id, body, run_id) VALUES (pg_temp.fx('a_json'), body, pg_temp.fx('run'));

  WITH i AS (
    INSERT INTO raw.artifact (source_url, final_url, source_type_code, http_status, byte_size, sha256, retrieved_at, storage_key, run_id)
    VALUES ('https://www.sec.gov/TEST-ONLY/page.html', 'https://www.sec.gov/TEST-ONLY/page.html',
            'SEC_BDC_DATASETS_PAGE', 200, 1, repeat('3', 64), '2099-01-02T00:00:00Z', 'test-only/page', pg_temp.fx('run'))
    RETURNING id)
  INSERT INTO fx SELECT 'a_page', id FROM i;
END
$$;

CREATE FUNCTION pg_temp.json_evidence(path text) RETURNS bigint
LANGUAGE sql AS $$
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, json_path, run_id)
  VALUES ('REGISTRY', pg_temp.fx('a_json'), 'JSON_PATH', path, pg_temp.fx('run'))
  RETURNING id
$$;

CREATE FUNCTION pg_temp.anchor_evidence(href text) RETURNS bigint
LANGUAGE sql AS $$
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_anchor, run_id)
  VALUES ('DISCOVERY', pg_temp.fx('a_page'), 'HTML_ANCHOR', href, pg_temp.fx('run'))
  RETURNING id
$$;

-- Raw JSON
SELECT pg_temp.check('the database flattens the stored JSON body into raw.json_value', (
  SELECT count(*) FILTER (WHERE json_path = '$."filings"."recent"."accessionNumber"[0]'
                            AND value_text = '0000000000-00-000001' AND array_index = 0
                            AND container_path = '$."filings"."recent"."accessionNumber"') = 1
     AND count(*) FILTER (WHERE json_path = '$."tickers"' AND value_type = 'array' AND value_text IS NULL) = 1
  FROM raw.json_value WHERE artifact_id = pg_temp.fx('a_json')));

SELECT pg_temp.expect_error('raw.json_value cannot be written directly', 'BDCI1', ARRAY[format(
  $$INSERT INTO raw.json_value (json_document_id, artifact_id, json_path, container_path, value_type, value_text, run_id)
    SELECT id, artifact_id, '$."test"', '$', 'string', 'x', %s FROM raw.json_document WHERE artifact_id = %s$$,
  pg_temp.fx('run'), pg_temp.fx('a_json'))]);

SELECT pg_temp.expect_error('a JSON body must hash to its artifact checksum', 'BDCI1', ARRAY[format(
  $$INSERT INTO raw.json_document (artifact_id, body, run_id) VALUES (%s, '{}', %s)$$,
  pg_temp.fx('a_page'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('JSON_PATH evidence must resolve to a stored value', 'BDCI1', ARRAY[
  $$SELECT pg_temp.json_evidence('$."filings"."recent"."form"[5]')$$]);

-- Located values (G-11)
SELECT pg_temp.expect_ok('an attribute raw value equal to the JSON value is accepted', ARRAY[format(
  $$INSERT INTO registry.registrant_attribute_observation (registrant_id, attribute_code, raw_value, rule_version_id, run_id, evidence_id)
    VALUES (%s, 'NAME', 'TEST BDC 1', %s, %s, pg_temp.json_evidence('$."name"'))$$,
  pg_temp.fx('registrant'), pg_temp.fx('r_project'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('an attribute raw value that differs from the JSON value is rejected', 'BDCI1', ARRAY[format(
  $$INSERT INTO registry.registrant_attribute_observation (registrant_id, attribute_code, raw_value, rule_version_id, run_id, evidence_id)
    VALUES (%s, 'NAME', 'TEST BDC ONE', %s, %s, pg_temp.json_evidence('$."name"'))$$,
  pg_temp.fx('registrant'), pg_temp.fx('r_project'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_ok('a filing attribute raw value equal to the SUB cell is accepted', ARRAY[format(
  $$INSERT INTO registry.filing_attribute_observation (filing_id, attribute_code, raw_value, value_state, rule_version_id, run_id, evidence_id)
    VALUES (%s, 'REGISTRANT_NAME_AS_FILED', 'TEST BDC 1', 'REPORTED', %s, %s,
            pg_temp.add_evidence('L1_STRUCTURED_DATASET', %s, %s, 3, 'name'))$$,
  pg_temp.fx('filing'), pg_temp.fx('r_project'), pg_temp.fx('run'), pg_temp.fx('artifact'), pg_temp.fx('row_sub'))]);

SELECT pg_temp.expect_error('a filing attribute raw value that differs from the SUB cell is rejected', 'BDCI1', ARRAY[format(
  $$INSERT INTO registry.filing_attribute_observation (filing_id, attribute_code, raw_value, value_state, rule_version_id, run_id, evidence_id)
    VALUES (%s, 'REGISTRANT_NAME_AS_FILED', 'TEST BDC 1 ', 'REPORTED', %s, %s,
            pg_temp.add_evidence('L1_STRUCTURED_DATASET', %s, %s, 3, 'name'))$$,
  pg_temp.fx('filing'), pg_temp.fx('r_project'), pg_temp.fx('run'), pg_temp.fx('artifact'), pg_temp.fx('row_sub'))]);

SELECT pg_temp.expect_error('a registrant CIK must equal the CIK at its evidence location', 'BDCI1', ARRAY[format(
  $$INSERT INTO registry.registrant (cik, run_id, evidence_id) VALUES (9999999903, %s, pg_temp.json_evidence('$."cik"'))$$,
  pg_temp.fx('run'))]);

SELECT pg_temp.check('views label each current value with its source documentation status', (
  SELECT count(*) = 1 AND bool_and(documentation_status = 'OBSERVED_UNCONFIRMED')
  FROM registry.current_registrant_attribute WHERE registrant_id = pg_temp.fx('registrant') AND attribute_code = 'NAME'
    AND source_type_code = 'SEC_SUBMISSIONS_JSON')
  AND (SELECT documentation_status = 'DOCUMENTED_AND_OBSERVED' FROM registry.current_filing_attribute
       WHERE filing_id = pg_temp.fx('filing') AND attribute_code = 'REGISTRANT_NAME_AS_FILED'));

SELECT pg_temp.check('an attribute no source reports is UNKNOWN, not blank', (
  SELECT attribute_state = 'UNKNOWN' AND current_value_count = 0
  FROM registry.registrant_attribute_status WHERE registrant_id = pg_temp.fx('registrant') AND attribute_code = 'TICKER'));

-- Explicit registrant links only (G-09)
SELECT pg_temp.expect_ok('a submissions link to the CIK named in the submissions URL is accepted', ARRAY[format(
  $$INSERT INTO registry.filing_registrant_link (filing_id, registrant_id, link_source, run_id, evidence_id)
    VALUES (%s, %s, 'SUBMISSIONS_JSON', %s, pg_temp.json_evidence('$."filings"."recent"."accessionNumber"[0]'))$$,
  pg_temp.fx('filing'), pg_temp.fx('registrant'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('a submissions link to a registrant other than the URL CIK is rejected', 'BDCI1', ARRAY[
  format($$INSERT INTO registry.registrant (cik, run_id, evidence_id) VALUES (9999999902, %s, %s)$$, pg_temp.fx('run'), pg_temp.fx('e_sub')),
  format($$INSERT INTO registry.filing_registrant_link (filing_id, registrant_id, link_source, run_id, evidence_id)
           SELECT %s, id, 'SUBMISSIONS_JSON', %s, pg_temp.json_evidence('$."filings"."recent"."accessionNumber"[0]')
           FROM registry.registrant WHERE cik = 9999999902$$, pg_temp.fx('filing'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('a submissions entry cannot link a different accession, even one whose prefix is the CIK', 'BDCI1', ARRAY[
  format($$INSERT INTO registry.filing (accession_number, run_id, evidence_id) VALUES ('9999999901-99-000003', %s, %s)$$,
         pg_temp.fx('run'), pg_temp.fx('e_sub')),
  format($$INSERT INTO registry.filing_registrant_link (filing_id, registrant_id, link_source, run_id, evidence_id)
           SELECT id, %s, 'SUBMISSIONS_JSON', %s, pg_temp.json_evidence('$."filings"."recent"."accessionNumber"[0]')
           FROM registry.filing WHERE accession_number = '9999999901-99-000003'$$, pg_temp.fx('registrant'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('JSON evidence cannot back a SUB_TABLE link', 'BDCI1', ARRAY[format(
  $$INSERT INTO registry.filing_registrant_link (filing_id, registrant_id, link_source, run_id, evidence_id)
    VALUES (%s, %s, 'SUB_TABLE', %s, pg_temp.json_evidence('$."filings"."recent"."accessionNumber"[0]'))$$,
  pg_temp.fx('filing'), pg_temp.fx('registrant'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_ok('a SUB link backed by the cik cell of the filing''s own row is accepted', ARRAY[format(
  $$INSERT INTO registry.filing_registrant_link (filing_id, registrant_id, link_source, run_id, evidence_id)
    VALUES (%s, %s, 'SUB_TABLE', %s, pg_temp.add_evidence('L1_STRUCTURED_DATASET', %s, %s, 2, 'cik'))$$,
  pg_temp.fx('filing'), pg_temp.fx('registrant'), pg_temp.fx('run'), pg_temp.fx('artifact'), pg_temp.fx('row_sub'))]);

SELECT pg_temp.expect_error('a SUB link must use the cik cell, not another column', 'BDCI1', ARRAY[format(
  $$INSERT INTO registry.filing_registrant_link (filing_id, registrant_id, link_source, run_id, evidence_id)
    VALUES (%s, %s, 'SUB_TABLE', %s, pg_temp.add_evidence('L1_STRUCTURED_DATASET', %s, %s, 1, 'adsh'))$$,
  pg_temp.fx('filing'), pg_temp.fx('registrant'), pg_temp.fx('run'), pg_temp.fx('artifact'), pg_temp.fx('row_sub'))]);

-- Primary document URL (P2-D17)
SELECT pg_temp.expect_ok('a primary document URL built from the URL CIK, accession, and name is accepted', ARRAY[format(
  $$INSERT INTO registry.filing_document (filing_id, document_name, document_url, named_by, rule_version_id, run_id, evidence_id)
    VALUES (%s, 'test-only.htm', 'https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000001/test-only.htm',
            'SUBMISSIONS_PRIMARY_DOCUMENT', %s, %s, pg_temp.json_evidence('$."filings"."recent"."primaryDocument"[0]'))$$,
  pg_temp.fx('filing'), pg_temp.fx('r_project'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('the same document cannot be recorded twice by the same source', '23505', ARRAY[format(
  $$INSERT INTO registry.filing_document (filing_id, document_name, document_url, named_by, rule_version_id, run_id, evidence_id)
    VALUES (%s, 'test-only.htm', 'https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000001/test-only.htm',
            'SUBMISSIONS_PRIMARY_DOCUMENT', %s, %s, pg_temp.json_evidence('$."filings"."recent"."primaryDocument"[0]'))$$,
  pg_temp.fx('filing'), pg_temp.fx('r_project'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('a primary document URL with a different folder is rejected', 'BDCI1', ARRAY[
  format($$INSERT INTO registry.filing (accession_number, run_id, evidence_id) VALUES ('0000000000-00-000009', %s, %s)$$,
         pg_temp.fx('run'), pg_temp.fx('e_sub')),
  format($$INSERT INTO registry.filing_document (filing_id, document_name, document_url, named_by, rule_version_id, run_id, evidence_id)
    SELECT id, 'test-only.htm', 'https://www.sec.gov/Archives/edgar/data/0000000000/000000000000000009/test-only.htm',
           'SUBMISSIONS_PRIMARY_DOCUMENT', %s, %s, pg_temp.json_evidence('$."filings"."recent"."primaryDocument"[0]')
    FROM registry.filing WHERE accession_number = '0000000000-00-000009'$$, pg_temp.fx('r_project'), pg_temp.fx('run'))]);

-- Name history (P2-D11)
SELECT pg_temp.expect_ok('a former name keeps its from/to text exactly as disclosed', ARRAY[format(
  $$INSERT INTO registry.registrant_name_history_observation (registrant_id, name_raw, from_raw, to_raw, rule_version_id, run_id, evidence_id)
    VALUES (%s, 'TEST BDC OLD', '2099-01-01T00:00:00.000Z', '2099-02-01T00:00:00.000Z', %s, %s,
            pg_temp.json_evidence('$."formerNames"[0]."name"'))$$,
  pg_temp.fx('registrant'), pg_temp.fx('r_project'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('a former-name date that differs from the source text is rejected', 'BDCI1', ARRAY[format(
  $$INSERT INTO registry.registrant_name_history_observation (registrant_id, name_raw, from_raw, to_raw, rule_version_id, run_id, evidence_id)
    VALUES (%s, 'TEST BDC OLD', '2099-01-01', '2099-02-01T00:00:00.000Z', %s, %s,
            pg_temp.json_evidence('$."formerNames"[0]."name"'))$$,
  pg_temp.fx('registrant'), pg_temp.fx('r_project'), pg_temp.fx('run'))]);

-- Page anchors, releases, and report editions
SELECT pg_temp.expect_ok('a release named by a page anchor with its implied window is accepted and listed', ARRAY[
  format($$INSERT INTO registry.dataset_release (dataset_code, release_label, cadence, window_start, window_end, run_id, evidence_id)
           VALUES ('SEC_BDC_DATA_SETS', '2099q1', 'QUARTERLY', '2099-01-01', '2099-03-31', %s,
                   pg_temp.anchor_evidence('/files/TEST-ONLY/2099q1_bdc.zip'))$$, pg_temp.fx('run')),
  format($$INSERT INTO registry.dataset_release_listing (dataset_release_id, page_artifact_id, link_href, link_text, evidence_id, rule_version_id, run_id)
           SELECT r.id, %s, '/files/TEST-ONLY/2099q1_bdc.zip', 'TEST ONLY 2099 Q1', e.id, %s, %s
           FROM registry.dataset_release r
           JOIN evidence.evidence e ON e.html_anchor = '/files/TEST-ONLY/2099q1_bdc.zip'
           WHERE r.release_label = '2099q1'$$, pg_temp.fx('a_page'), pg_temp.fx('r_parser'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('a release window that does not match its label is rejected', 'BDCI1', ARRAY[format(
  $$INSERT INTO registry.dataset_release (dataset_code, release_label, cadence, window_start, window_end, run_id, evidence_id)
    VALUES ('SEC_BDC_DATA_SETS', '2099_05', 'MONTHLY', '2099-05-01', '2099-05-30', %s,
            pg_temp.anchor_evidence('/files/TEST-ONLY/2099_05_bdc.zip'))$$, pg_temp.fx('run'))]);

SELECT pg_temp.expect_ok('a report edition takes its year from the link text, not the file name', ARRAY[format(
  $$INSERT INTO registry.bdc_report_edition (page_artifact_id, link_href, csv_url, year_label_raw, report_year, updated_label_raw,
      evidence_id, rule_version_id, run_id)
    VALUES (%s, '/files/TEST-ONLY/test_report.csv', 'https://www.sec.gov/files/TEST-ONLY/test_report.csv', '2099', 2099,
            'Updated 1/1/2099', pg_temp.anchor_evidence('/files/TEST-ONLY/test_report.csv'), %s, %s)$$,
  pg_temp.fx('a_page'), pg_temp.fx('r_parser'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('a report year that differs from the link text is rejected', '23514', ARRAY[format(
  $$INSERT INTO registry.bdc_report_edition (page_artifact_id, link_href, csv_url, year_label_raw, report_year, updated_label_raw,
      evidence_id, rule_version_id, run_id)
    VALUES (%s, '/files/TEST-ONLY/test_report_b.csv', 'https://www.sec.gov/files/TEST-ONLY/test_report_b.csv', '2099', 2098,
            NULL, pg_temp.anchor_evidence('/files/TEST-ONLY/test_report_b.csv'), %s, %s)$$,
  pg_temp.fx('a_page'), pg_temp.fx('r_parser'), pg_temp.fx('run'))]);

SELECT pg_temp.check('an edition that was never retrieved shows NOT_RETRIEVED', (
  SELECT edition_state = 'NOT_RETRIEVED' FROM registry.bdc_report_edition_status
  WHERE csv_url = 'https://www.sec.gov/files/TEST-ONLY/test_report.csv'));

-- Member-level documents
SELECT pg_temp.expect_ok('Level 1 DOCUMENT evidence may point at one archive member', ARRAY[format(
  $$INSERT INTO evidence.evidence (evidence_level, artifact_id, artifact_member_id, locator_type, run_id)
    VALUES ('L1_STRUCTURED_DATASET', %s, %s, 'DOCUMENT', %s)$$,
  pg_temp.fx('artifact'), pg_temp.fx('m_sub'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('Level 1 DOCUMENT evidence needs a member', '23514', ARRAY[format(
  $$INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, run_id)
    VALUES ('L1_STRUCTURED_DATASET', %s, 'DOCUMENT', %s)$$, pg_temp.fx('artifact'), pg_temp.fx('run'))]);

-- Coverage aspects (G-05)
SELECT pg_temp.check('a registrant with no filing-history assertion has UNKNOWN coverage', (
  SELECT filing_history_coverage = 'UNKNOWN' FROM registry.registrant_coverage WHERE registrant_id = pg_temp.fx('registrant')));

SELECT pg_temp.expect_ok('filing-history coverage is asserted per registrant, without a release', ARRAY[format(
  $$INSERT INTO ops.coverage_assertion (registrant_id, source_type_code, coverage_aspect, coverage_state, evidence_id, rationale, rule_version_id, run_id)
    VALUES (%s, 'SEC_SUBMISSIONS_JSON', 'FILING_HISTORY', 'COVERED', pg_temp.json_evidence('$."filings"."files"'),
            'TEST ONLY: no additional pages', %s, %s)$$,
  pg_temp.fx('registrant'), pg_temp.fx('r_coverage'), pg_temp.fx('run'))]);

SELECT pg_temp.check('the registrant coverage view reports it', (
  SELECT filing_history_coverage = 'COVERED' FROM registry.registrant_coverage WHERE registrant_id = pg_temp.fx('registrant')));

SELECT pg_temp.expect_error('a second filing-history assertion must supersede the first', 'BDCS1', ARRAY[format(
  $$INSERT INTO ops.coverage_assertion (registrant_id, source_type_code, coverage_aspect, coverage_state, rationale, rule_version_id, run_id)
    VALUES (%s, 'SEC_SUBMISSIONS_JSON', 'FILING_HISTORY', 'UNKNOWN', 'TEST ONLY', %s, %s)$$,
  pg_temp.fx('registrant'), pg_temp.fx('r_coverage'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('filing-metadata coverage still needs a release or period', '23514', ARRAY[format(
  $$INSERT INTO ops.coverage_assertion (registrant_id, source_type_code, coverage_aspect, coverage_state, rationale, rule_version_id, run_id)
    VALUES (%s, 'SEC_BDC_DATASET_ZIP', 'FILING_METADATA', 'NOT_INGESTED', 'TEST ONLY', %s, %s)$$,
  pg_temp.fx('registrant'), pg_temp.fx('r_coverage'), pg_temp.fx('run'))]);

-- Processing ledger and privileges
SELECT pg_temp.expect_error('an artifact is processed once per loader version', '23505', ARRAY[
  format($$INSERT INTO ops.artifact_processing (artifact_id, rule_version_id, outcome, detail, counts, run_id)
           VALUES (%s, %s, 'LOADED', 'TEST ONLY', '{}', %s)$$, pg_temp.fx('a_json'), pg_temp.fx('r_parser'), pg_temp.fx('run')),
  format($$INSERT INTO ops.artifact_processing (artifact_id, rule_version_id, outcome, detail, counts, run_id)
           VALUES (%s, %s, 'LOADED', 'TEST ONLY', '{}', %s)$$, pg_temp.fx('a_json'), pg_temp.fx('r_parser'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('the writer cannot change registry field mappings', '42501', ARRAY[
  'SET ROLE bdc_pipeline_writer',
  $$INSERT INTO ref.registry_field_mapping (source_type_code, source_field, target_kind, mapping_status, source_schema_reference, recorded_by)
    VALUES ('SEC_SUBMISSIONS_JSON', '$."test"', 'RAW_ONLY', 'OBSERVED_UNCONFIRMED', 'test', 'test')$$]);

SELECT pg_temp.check('every observed submissions field is labeled OBSERVED_UNCONFIRMED, never documented', NOT EXISTS (
  SELECT 1 FROM ref.registry_field_mapping
  WHERE source_type_code IN ('SEC_SUBMISSIONS_JSON', 'SEC_SUBMISSIONS_PAGE_JSON') AND mapping_status <> 'OBSERVED_UNCONFIRMED'));

SELECT pg_temp.check('the undocumented SUB fileNumber is raw only', (
  SELECT count(*) = 1 AND bool_and(target_kind = 'RAW_ONLY' AND mapping_status = 'OBSERVED_UNCONFIRMED')
  FROM ref.registry_field_mapping WHERE source_type_code = 'SEC_BDC_DATASET_ZIP' AND source_field = 'fileNumber'));
