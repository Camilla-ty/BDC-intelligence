-- Group 11: SEC refreshes create new artifact versions; nothing is overwritten (G-10, G-12).

DO $$
BEGIN
  WITH i AS (
    INSERT INTO raw.artifact (source_url, final_url, source_type_code, http_status, byte_size, sha256, retrieved_at, storage_key, run_id)
    VALUES ('https://www.sec.gov/files/TEST-ONLY/test-dataset.zip', 'https://www.sec.gov/files/TEST-ONLY/test-dataset.zip',
            'SEC_BDC_DATASET_ZIP', 200, 1, repeat('9', 64), '2099-02-01T00:00:00Z', 'test-only/none-v2', pg_temp.fx('run'))
    RETURNING id)
  INSERT INTO fx SELECT 'artifact_v2', id FROM i;

  WITH i AS (INSERT INTO raw.artifact_member (artifact_id, member_path, byte_size, sha256, run_id)
             VALUES (pg_temp.fx('artifact_v2'), 'sub.tsv', 1, repeat('8', 64), pg_temp.fx('run')) RETURNING id)
  INSERT INTO fx SELECT 'm_sub_v2', id FROM i;

  WITH i AS (INSERT INTO raw.table_load (artifact_id, artifact_member_id, table_code, delimiter, header, header_sha256,
               parser_rule_version_id, row_count, field_count_mismatch_count, parse_status, run_id)
             VALUES (pg_temp.fx('artifact_v2'), pg_temp.fx('m_sub_v2'), 'SUB', E'\t', ARRAY['adsh', 'cik', 'name'], repeat('f', 64),
                     pg_temp.fx('r_parser'), 2, 0, 'OK', pg_temp.fx('run')) RETURNING id)
  INSERT INTO fx SELECT 'l_sub_v2', id FROM i;

  PERFORM pg_temp.put('row_sub_v2_same', pg_temp.add_row(pg_temp.fx('l_sub_v2'), 2, '0000000000-00-000001' || E'\t9999999901\tTEST BDC 1'));
  PERFORM pg_temp.put('row_sub_v2_changed', pg_temp.add_row(pg_temp.fx('l_sub_v2'), 3, '0000000000-00-000001' || E'\t9999999901\tTEST BDC 1 RENAMED'));
END
$$;

SELECT pg_temp.expect_ok('a refreshed artifact (same URL, new checksum, later retrieval) links to its predecessor', ARRAY[format(
  $$INSERT INTO raw.artifact_lineage (artifact_id, previous_artifact_id, basis, run_id) VALUES (%s, %s, 'SAME_SOURCE_URL', %s)$$,
  pg_temp.fx('artifact_v2'), pg_temp.fx('artifact'), pg_temp.fx('run'))]);

SELECT pg_temp.check('both artifact versions of the URL are retained', (
  SELECT count(*) = 2 FROM raw.artifact WHERE source_url = 'https://www.sec.gov/files/TEST-ONLY/test-dataset.zip'));

SELECT pg_temp.expect_error('the same URL and checksum cannot be stored twice', '23505', ARRAY[format(
  $$INSERT INTO raw.artifact (source_url, final_url, source_type_code, http_status, byte_size, sha256, retrieved_at, storage_key, run_id)
    VALUES ('https://www.sec.gov/files/TEST-ONLY/test-dataset.zip', 'https://www.sec.gov/files/TEST-ONLY/test-dataset.zip',
            'SEC_BDC_DATASET_ZIP', 200, 1, repeat('9', 64), now(), 'test', %s)$$, pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('lineage requires the same source URL', 'BDCI1', ARRAY[
  format($$INSERT INTO raw.artifact (source_url, final_url, source_type_code, http_status, byte_size, sha256, retrieved_at, storage_key, run_id)
           VALUES ('https://www.sec.gov/files/TEST-ONLY/other.zip', 'https://www.sec.gov/files/TEST-ONLY/other.zip',
                   'SEC_BDC_DATASET_ZIP', 200, 1, repeat('7', 64), '2099-03-01T00:00:00Z', 'test', %s)$$, pg_temp.fx('run')),
  format($$INSERT INTO raw.artifact_lineage (artifact_id, previous_artifact_id, basis, run_id)
           SELECT id, %s, 'SAME_SOURCE_URL', %s FROM raw.artifact WHERE source_url LIKE '%%other.zip'$$,
         pg_temp.fx('artifact'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_ok('an unchanged row in the refreshed artifact is linked as equivalent, not overwritten', ARRAY[format(
  $$INSERT INTO obs.observation_equivalence (tabular_row_id, equivalent_tabular_row_id, basis, rule_version_id, run_id)
    VALUES (%s, %s, 'RAW_LINE_SHA256_EQUAL', %s, %s)$$,
  pg_temp.fx('row_sub_v2_same'), pg_temp.fx('row_sub'), pg_temp.fx('r_project'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('a changed row cannot be declared equivalent', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.observation_equivalence (tabular_row_id, equivalent_tabular_row_id, basis, rule_version_id, run_id)
    VALUES (%s, %s, 'RAW_LINE_SHA256_EQUAL', %s, %s)$$,
  pg_temp.fx('row_sub_v2_changed'), pg_temp.fx('row_sub'), pg_temp.fx('r_project'), pg_temp.fx('run'))]);

SELECT pg_temp.check('raw rows from both artifact versions are kept', (
  SELECT count(*) = 3 FROM raw.tabular_row r JOIN raw.table_load tl ON tl.id = r.table_load_id WHERE tl.table_code = 'SUB'));

SELECT pg_temp.expect_ok('a data-set release records every artifact version that served it', ARRAY[
  format($$INSERT INTO registry.dataset_release_artifact (dataset_release_id, artifact_id, run_id) VALUES (%s, %s, %s), (%s, %s, %s)$$,
         pg_temp.fx('release'), pg_temp.fx('artifact'), pg_temp.fx('run'),
         pg_temp.fx('release'), pg_temp.fx('artifact_v2'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_ok('a changed registrant name is a new observation alongside the old one', ARRAY[
  format($$INSERT INTO registry.registrant_attribute_observation (registrant_id, attribute_code, raw_value, rule_version_id, run_id, evidence_id)
           VALUES (%s, 'NAME', 'TEST BDC 1', %s, %s, %s)$$,
         pg_temp.fx('registrant'), pg_temp.fx('r_project'), pg_temp.fx('run'), pg_temp.fx('e_sub')),
  format($$INSERT INTO registry.registrant_attribute_observation (registrant_id, attribute_code, raw_value, rule_version_id, run_id, evidence_id)
           VALUES (%s, 'NAME', 'TEST BDC 1 RENAMED', %s, %s, %s)$$,
         pg_temp.fx('registrant'), pg_temp.fx('r_project'), pg_temp.fx('run'),
         pg_temp.add_evidence('L1_STRUCTURED_DATASET', pg_temp.fx('artifact_v2'), pg_temp.fx('row_sub_v2_changed')))]);

SELECT pg_temp.check('both registrant name observations are retained', (
  SELECT count(*) = 2 FROM registry.registrant_attribute_observation WHERE registrant_id = pg_temp.fx('registrant')));
