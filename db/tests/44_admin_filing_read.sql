-- Group 44: Admin Filing read layer (migration 0048). Views only; no invented statuses.

SELECT pg_temp.check('admin schema exists',
  EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'admin'));

SELECT pg_temp.check('admin_reader is NOLOGIN',
  EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_reader' AND NOT rolcanlogin));

SELECT pg_temp.check('PUBLIC has no SELECT on Admin Filing views',
  NOT has_table_privilege('public', 'admin.filing_inventory', 'SELECT')
  AND NOT has_table_privilege('public', 'admin.filing_registrant', 'SELECT')
  AND NOT has_table_privilege('public', 'admin.filing_attribute', 'SELECT')
  AND NOT has_table_privilege('public', 'admin.filing_document', 'SELECT')
  AND NOT has_table_privilege('public', 'admin.filing_artifact', 'SELECT')
  AND NOT has_table_privilege('public', 'admin.filing_processing', 'SELECT'));

SELECT pg_temp.check('admin_reader has SELECT on every Admin Filing view',
  has_table_privilege('admin_reader', 'admin.filing_inventory', 'SELECT')
  AND has_table_privilege('admin_reader', 'admin.filing_registrant', 'SELECT')
  AND has_table_privilege('admin_reader', 'admin.filing_attribute', 'SELECT')
  AND has_table_privilege('admin_reader', 'admin.filing_document', 'SELECT')
  AND has_table_privilege('admin_reader', 'admin.filing_artifact', 'SELECT')
  AND has_table_privilege('admin_reader', 'admin.filing_processing', 'SELECT'));

SELECT pg_temp.check('bdc_reader has no SELECT on Admin Filing views',
  NOT has_table_privilege('bdc_reader', 'admin.filing_inventory', 'SELECT')
  AND NOT has_table_privilege('bdc_reader', 'admin.filing_document', 'SELECT')
  AND NOT has_table_privilege('bdc_reader', 'admin.filing_artifact', 'SELECT')
  AND NOT has_table_privilege('bdc_reader', 'admin.filing_processing', 'SELECT')
  AND NOT has_schema_privilege('bdc_reader', 'admin', 'USAGE'));

SELECT pg_temp.check('access_reader, pipeline, and review writers have no Admin Filing SELECT',
  NOT has_table_privilege('access_reader', 'admin.filing_inventory', 'SELECT')
  AND NOT has_table_privilege('bdc_pipeline_writer', 'admin.filing_inventory', 'SELECT')
  AND NOT has_table_privilege('review_writer', 'admin.filing_inventory', 'SELECT')
  AND NOT has_schema_privilege('access_reader', 'admin', 'USAGE'));

SELECT pg_temp.check('admin_reader cannot read grant_event or base artifact tables',
  NOT has_table_privilege('admin_reader', 'access.grant_event', 'SELECT')
  AND NOT has_table_privilege('admin_reader', 'raw.artifact', 'SELECT')
  AND NOT has_table_privilege('admin_reader', 'ops.artifact_processing', 'SELECT')
  AND NOT has_table_privilege('admin_reader', 'ops.projection_exception', 'SELECT'));

SELECT pg_temp.check('bdc_reader still reads layer views and not base tables',
  has_table_privilege('bdc_reader', 'registry.filing_history', 'SELECT')
  AND has_table_privilege('bdc_reader', 'registry.position_read', 'SELECT')
  AND NOT has_table_privilege('bdc_reader', 'registry.filing', 'SELECT')
  AND NOT has_table_privilege('bdc_reader', 'raw.artifact', 'SELECT'));

-- Bare fixture filing: no documents, artifacts, attributes, or processing.
SELECT pg_temp.check('inventory has one row per fixture filing',
  (SELECT count(*) FROM admin.filing_inventory WHERE filing_id = pg_temp.fx('filing')) = 1);

SELECT pg_temp.check('inventory ordering key is deterministic by accession then filing_id',
  (SELECT count(*) = count(DISTINCT (accession_number, filing_id))
     FROM admin.filing_inventory));

SELECT pg_temp.check('missing documents/artifacts/processing stay empty or null, not invented statuses',
  (SELECT document_count = 0
          AND artifact_count = 0
          AND documents_available IS FALSE
          AND artifacts_available IS FALSE
          AND processing_outcomes IS NULL
          AND processing_row_count = 0
          AND forms IS NULL
          AND filed_dates IS NULL
          AND report_periods IS NULL
          AND soi_row_observation_count = 3
          AND position_observation_count = 2
          AND num_fact_observation_count = 1
     FROM admin.filing_inventory
    WHERE filing_id = pg_temp.fx('filing')));

SELECT pg_temp.check('registrant link from fixture is LINKED with the fixture CIK',
  (SELECT registrant_link_status = 'LINKED'
          AND registrant_ciks = ARRAY[9999999901::bigint]
          AND registrant_name_state IN ('UNKNOWN', 'REPORTED', 'MULTIPLE_VALUES')
     FROM admin.filing_inventory
    WHERE filing_id = pg_temp.fx('filing')));

-- Attach one document, one artifact, two processing outcomes (disagreement preserved).
WITH i AS (
  INSERT INTO raw.artifact (
    source_url, final_url, source_type_code, http_status, byte_size, sha256,
    retrieved_at, storage_key, run_id)
  VALUES (
    'https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000001/admin-read.htm',
    'https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000001/admin-read.htm',
    'SEC_FILING_DOCUMENT', 200, 12, repeat('ab', 32),
    '2099-01-04T00:00:00Z', 'test-only/admin-read', pg_temp.fx('run'))
  RETURNING id
) INSERT INTO fx SELECT 'artifact_admin_read', id FROM i;

WITH i AS (
  INSERT INTO registry.filing_document (
    filing_id, document_name, document_url, named_by, rule_version_id, run_id, evidence_id)
  VALUES (
    pg_temp.fx('filing'), 'admin-read.htm',
    'https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000001/admin-read.htm',
    'FILING_INDEX_JSON', pg_temp.fx('r_project'), pg_temp.fx('run'), pg_temp.fx('e_sub'))
  RETURNING id
) INSERT INTO fx SELECT 'filing_doc_admin_read', id FROM i;

INSERT INTO registry.filing_document_artifact (filing_document_id, artifact_id, run_id)
VALUES (pg_temp.fx('filing_doc_admin_read'), pg_temp.fx('artifact_admin_read'), pg_temp.fx('run'));

INSERT INTO ops.artifact_processing (artifact_id, rule_version_id, outcome, detail, counts, run_id)
VALUES
  (pg_temp.fx('artifact_admin_read'), pg_temp.fx('r_parser'), 'LOADED',
   'TEST ONLY admin read LOADED', '{"rows":1}'::jsonb, pg_temp.fx('run')),
  (pg_temp.fx('artifact_admin_read'), pg_temp.fx('r_project'), 'NOT_IN_SCOPE',
   'TEST ONLY admin read second outcome', '{"rows":0}'::jsonb, pg_temp.fx('run'));

SELECT pg_temp.check('document and artifact counts do not multiply filing inventory rows',
  (SELECT count(*) FROM admin.filing_inventory WHERE filing_id = pg_temp.fx('filing')) = 1
  AND (SELECT document_count = 1
              AND artifact_count = 1
              AND documents_available
              AND artifacts_available
              AND processing_row_count = 2
              AND processing_outcomes = ARRAY['LOADED', 'NOT_IN_SCOPE']
         FROM admin.filing_inventory
        WHERE filing_id = pg_temp.fx('filing')));

SELECT pg_temp.check('filing detail document surface is scoped to the filing',
  (SELECT count(*) FROM admin.filing_document WHERE filing_id = pg_temp.fx('filing')) = 1
  AND (SELECT document_url
         FROM admin.filing_document
        WHERE filing_id = pg_temp.fx('filing'))
        = 'https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000001/admin-read.htm'
  AND NOT EXISTS (
        SELECT 1 FROM admin.filing_document
        WHERE filing_id <> pg_temp.fx('filing')
          AND filing_document_id = pg_temp.fx('filing_doc_admin_read')));

SELECT pg_temp.check('filing artifact exposes stored checksum and retrieval time',
  (SELECT sha256 = repeat('ab', 32)
          AND retrieved_at = '2099-01-04T00:00:00Z'
          AND source_url = document_url
     FROM admin.filing_artifact
    WHERE filing_id = pg_temp.fx('filing')
      AND artifact_id = pg_temp.fx('artifact_admin_read')));

SELECT pg_temp.check('processing rows preserve multiple outcomes without inventing a rollup status',
  (SELECT count(*) FROM admin.filing_processing WHERE filing_id = pg_temp.fx('filing')) = 2
  AND (SELECT array_agg(outcome ORDER BY outcome)
         FROM admin.filing_processing
        WHERE filing_id = pg_temp.fx('filing'))
        = ARRAY['LOADED', 'NOT_IN_SCOPE']
  AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'admin'
          AND column_name IN ('health_score', 'quality_score', 'processing_status', 'edition_state')));

SELECT pg_temp.check('processing view does not fan out when the same artifact is linked once',
  (SELECT count(*) FROM admin.filing_processing
    WHERE filing_id = pg_temp.fx('filing')
      AND artifact_id = pg_temp.fx('artifact_admin_read')) = 2);

SELECT pg_temp.expect_ok('admin_reader can select filing_inventory', ARRAY[
  'SET ROLE admin_reader',
  format('SELECT accession_number FROM admin.filing_inventory WHERE filing_id = %s', pg_temp.fx('filing')),
  'RESET ROLE']);

SELECT pg_temp.expect_error('bdc_reader cannot select admin.filing_inventory', '42501',
  ARRAY['SET ROLE bdc_reader', 'SELECT count(*) FROM admin.filing_inventory']);

SELECT pg_temp.expect_error('admin_reader cannot select raw.artifact', '42501',
  ARRAY['SET ROLE admin_reader', 'SELECT count(*) FROM raw.artifact']);

-- Second filing with no observations: Unknown/empty surfaces stay null/zero.
WITH i AS (
  INSERT INTO registry.filing (accession_number, run_id, evidence_id)
  VALUES ('9999999901-99-000002', pg_temp.fx('run'), pg_temp.fx('e_sub'))
  RETURNING id
) INSERT INTO fx SELECT 'filing_empty_admin', id FROM i;

SELECT pg_temp.check('empty second filing stays one inventory row with null processing and zero observations',
  (SELECT count(*) FROM admin.filing_inventory WHERE filing_id = pg_temp.fx('filing_empty_admin')) = 1
  AND (SELECT document_count = 0
              AND artifact_count = 0
              AND processing_outcomes IS NULL
              AND soi_row_observation_count = 0
              AND position_observation_count = 0
              AND num_fact_observation_count = 0
              AND registrant_link_status = 'UNKNOWN'
              AND registrant_ciks IS NULL
         FROM admin.filing_inventory
        WHERE filing_id = pg_temp.fx('filing_empty_admin')));

SELECT pg_temp.check('detail child views for empty filing return no document/artifact/processing rows',
  NOT EXISTS (SELECT 1 FROM admin.filing_document WHERE filing_id = pg_temp.fx('filing_empty_admin'))
  AND NOT EXISTS (SELECT 1 FROM admin.filing_artifact WHERE filing_id = pg_temp.fx('filing_empty_admin'))
  AND NOT EXISTS (SELECT 1 FROM admin.filing_processing WHERE filing_id = pg_temp.fx('filing_empty_admin')));
