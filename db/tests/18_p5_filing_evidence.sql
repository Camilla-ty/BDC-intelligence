-- Group 18: P5-min Level 2 filing evidence and Golden string-check statuses (G-01, G-10, G-12).
-- Fake TEST-ONLY Archives URL; no iXBRL parser.

CREATE FUNCTION pg_temp.derive_from(field_value bigint, metric text DEFAULT 'r_metric') RETURNS text[]
LANGUAGE sql AS $$
  SELECT ARRAY[
    format($q$INSERT INTO derived.derived_value (metric_rule_version_id, subject_table, subject_id, result_numeric, result_state, run_id)
              VALUES (%s, 'obs.position_observation', %s, 1, 'DERIVED', %s)$q$,
           pg_temp.fx(metric), pg_temp.fx('po_a'), pg_temp.fx('run')),
    format($q$INSERT INTO derived.derived_value_input (derived_value_id, field_value_id, input_role, run_id)
              VALUES (currval(pg_get_serial_sequence('derived.derived_value', 'id')), %s, 'input', %s)$q$,
           field_value, pg_temp.fx('run')),
    'SET CONSTRAINTS ALL IMMEDIATE']
$$;

SELECT pg_temp.expect_ok('a filing-document artifact may use a TEST-ONLY Archives URL', ARRAY[format(
  $$INSERT INTO raw.artifact (source_url, final_url, source_type_code, http_status, byte_size, sha256, retrieved_at, storage_key, run_id)
    VALUES ('https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000001/test-only.htm',
            'https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000001/test-only.htm',
            'SEC_FILING_DOCUMENT', 200, 1, repeat('c', 64), '2099-01-02T00:00:00Z', 'test-only/filing-doc', %s)$$,
  pg_temp.fx('run'))]);

SELECT pg_temp.expect_ok('Level 2 DOCUMENT evidence may point at the filing-document artifact', ARRAY[format(
  $$INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, join_note, run_id)
    VALUES ('L2_ORIGINAL_FILING', currval(pg_get_serial_sequence('raw.artifact', 'id')), 'DOCUMENT',
            'TEST ONLY whole-document string search', %s)$$,
  pg_temp.fx('run'))]);

SELECT pg_temp.expect_ok('filing_document can be named without inventing a submissions URL formula', ARRAY[format(
  $$INSERT INTO registry.filing_document (filing_id, document_name, document_url, named_by, rule_version_id, run_id, evidence_id)
    VALUES (%s, 'test-only.htm',
            'https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000001/test-only.htm',
            'FILING_INDEX_JSON', %s, %s, %s)$$,
  pg_temp.fx('filing'), pg_temp.fx('r_project'), pg_temp.fx('run'), pg_temp.fx('e_sub'))]);

SELECT pg_temp.expect_ok('filing_document_artifact links the fetched bytes to the named document', ARRAY[format(
  $$INSERT INTO registry.filing_document_artifact (filing_document_id, artifact_id, run_id)
    VALUES (currval(pg_get_serial_sequence('registry.filing_document', 'id')),
            currval(pg_get_serial_sequence('raw.artifact', 'id')), %s)$$,
  pg_temp.fx('run'))]);

SELECT pg_temp.expect_ok('FILING_VERIFIED is allowed with PASS and Level 2 evidence', ARRAY[
  format($$INSERT INTO validation.validation_result (subject_table, subject_id, rule_version_id, outcome, detail, evidence_id, run_id)
           VALUES ('obs.position_field_value', %s, %s, 'PASS', 'exact_string_present',
                   currval(pg_get_serial_sequence('evidence.evidence', 'id')), %s)$$,
         pg_temp.fx('fv_principal'), pg_temp.fx('r_validate'), pg_temp.fx('run')),
  format($$INSERT INTO validation.evidence_status_assertion (field_value_id, evidence_status, validation_result_id, rule_version_id, run_id)
           VALUES (%s, 'FILING_VERIFIED', currval(pg_get_serial_sequence('validation.validation_result', 'id')), %s, %s)$$,
         pg_temp.fx('fv_principal'), pg_temp.fx('r_validate'), pg_temp.fx('run'))]);

SELECT pg_temp.check('a documented principal that is filing-verified is AUTHORITATIVE', (
  SELECT authority = 'AUTHORITATIVE' FROM obs.field_value_authority WHERE field_value_id = pg_temp.fx('fv_principal')));

SELECT pg_temp.expect_ok('Q14 cost may be string-verified without changing mapping status', ARRAY[
  format($$INSERT INTO validation.validation_result (subject_table, subject_id, rule_version_id, outcome, detail, evidence_id, run_id)
           VALUES ('obs.position_field_value', %s, %s, 'PASS', 'exact_string_present',
                   currval(pg_get_serial_sequence('evidence.evidence', 'id')), %s)$$,
         pg_temp.fx('fv_adj_cost'), pg_temp.fx('r_validate'), pg_temp.fx('run')),
  format($$INSERT INTO validation.evidence_status_assertion (field_value_id, evidence_status, validation_result_id, rule_version_id, run_id)
           VALUES (%s, 'FILING_VERIFIED', currval(pg_get_serial_sequence('validation.validation_result', 'id')), %s, %s)$$,
         pg_temp.fx('fv_adj_cost'), pg_temp.fx('r_validate'), pg_temp.fx('run'))]);

SELECT pg_temp.check('Q14 remains PROVISIONAL after FILING_VERIFIED because mapping is OPEN_QUESTION', (
  SELECT authority = 'PROVISIONAL' AND mapping_status = 'OPEN_QUESTION'
  FROM obs.field_value_authority WHERE field_value_id = pg_temp.fx('fv_adj_cost')));

SELECT pg_temp.expect_error('Q14 still cannot feed derived.derived_value_input after a filing string match', 'BDCD1',
  pg_temp.derive_from(pg_temp.fx('fv_adj_cost')));
SET CONSTRAINTS ALL DEFERRED;

SELECT pg_temp.expect_ok('UNVERIFIABLE may use NOT_EVALUATED when no filing bytes exist', ARRAY[
  format($$INSERT INTO validation.validation_result (subject_table, subject_id, rule_version_id, outcome, detail, run_id)
           VALUES ('obs.position_field_value', %s, %s, 'NOT_EVALUATED', 'document_unavailable', %s)$$,
         pg_temp.fx('fv_pik'), pg_temp.fx('r_validate'), pg_temp.fx('run')),
  format($$INSERT INTO validation.evidence_status_assertion (field_value_id, evidence_status, validation_result_id, rule_version_id, run_id)
           VALUES (%s, 'UNVERIFIABLE', currval(pg_get_serial_sequence('validation.validation_result', 'id')), %s, %s)$$,
         pg_temp.fx('fv_pik'), pg_temp.fx('r_validate'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('SOI field values remain append-only during P5 checks', 'BDCA1', ARRAY[
  format('UPDATE obs.position_field_value SET raw_value = raw_value WHERE id = %s', pg_temp.fx('fv_principal'))]);
