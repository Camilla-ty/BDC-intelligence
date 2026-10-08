-- Group 4: role privileges (P1-D15). Writer = INSERT and SELECT only; reader = views only.

SELECT pg_temp.expect_error('writer cannot UPDATE a history table', '42501',
  ARRAY['SET ROLE bdc_pipeline_writer', 'UPDATE raw.artifact SET storage_key = storage_key']);
SELECT pg_temp.expect_error('writer cannot DELETE from a history table', '42501',
  ARRAY['SET ROLE bdc_pipeline_writer', 'DELETE FROM obs.position_field_value']);
SELECT pg_temp.expect_error('writer cannot TRUNCATE a history table', '42501',
  ARRAY['SET ROLE bdc_pipeline_writer', 'TRUNCATE resolution.entity_resolution_decision']);
SELECT pg_temp.expect_error('writer cannot change column mappings', '42501',
  ARRAY['SET ROLE bdc_pipeline_writer',
        $$INSERT INTO ref.source_column_mapping (source_table_code, column_label, mapping_target, mapping_basis, mapping_status,
            source_schema_reference, rule_version_id, recorded_by)
          VALUES ('SOI', 'TEST COLUMN', 'RAW_ONLY', 'NONE', 'OBSERVED_UNCONFIRMED', 'test', 1, 'test')$$]);
SELECT pg_temp.expect_error('writer cannot write the migration ledger', '42501',
  ARRAY['SET ROLE bdc_pipeline_writer',
        $$INSERT INTO ops.schema_migration (filename, sha256) VALUES ('9999_test.sql', repeat('0', 64))$$]);
SELECT pg_temp.expect_error('reader cannot read base tables', '42501',
  ARRAY['SET ROLE bdc_reader', 'SELECT count(*) FROM raw.artifact']);
SELECT pg_temp.expect_error('reader cannot insert', '42501',
  ARRAY['SET ROLE bdc_reader', $$INSERT INTO ops.run (run_kind, code_version, parameters, started_at) VALUES ('TEST', 'test', '{}', now())$$]);

-- Writer can insert (success path; role is reset afterwards).
SELECT pg_temp.expect_ok('writer can INSERT and SELECT history tables', ARRAY[
  'SET ROLE bdc_pipeline_writer',
  $$INSERT INTO ops.run (run_kind, code_version, parameters, started_at) VALUES ('TEST', 'test', '{}', now())$$,
  'SELECT count(*) FROM raw.tabular_row',
  'RESET ROLE']);

SELECT pg_temp.expect_ok('reader can read integrity views, including computed authority', ARRAY[
  'SET ROLE bdc_reader',
  'SELECT count(*) FROM obs.position_field_status',
  'SELECT count(*) FROM obs.field_value_authority',
  'SELECT count(*) FROM registry.current_filing_registrant',
  'SELECT count(*) FROM obs.current_soi_coverage',
  'SELECT count(*) FROM obs.soi_load_reconciliation',
  'RESET ROLE']);

SELECT pg_temp.check('writer has INSERT on every history table except ref, the ledger, and rule activation', NOT EXISTS (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'r'
    AND n.nspname IN ('ops', 'raw', 'registry', 'evidence', 'obs', 'identity', 'resolution', 'validation', 'derived')
    AND (n.nspname, c.relname) NOT IN (('ops', 'schema_migration'), ('ops', 'rule_activation'))
    AND NOT has_table_privilege('bdc_pipeline_writer', c.oid, 'INSERT')));

SELECT pg_temp.check('no application role has UPDATE, DELETE, or TRUNCATE on any layer table', NOT EXISTS (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN (VALUES ('bdc_pipeline_writer'), ('bdc_reader'), ('review_writer'), ('access_reader')) AS r (role)
  WHERE c.relkind IN ('r', 'v')
    AND n.nspname IN ('ops', 'raw', 'registry', 'evidence', 'obs', 'identity', 'resolution', 'validation', 'derived', 'ref', 'review', 'access')
    AND (has_table_privilege(r.role, c.oid, 'UPDATE') OR has_table_privilege(r.role, c.oid, 'DELETE')
         OR has_table_privilege(r.role, c.oid, 'TRUNCATE'))));

SELECT pg_temp.check('reader has SELECT on no base table and on every view', NOT EXISTS (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('ops', 'raw', 'registry', 'evidence', 'obs', 'identity', 'resolution', 'validation', 'derived', 'ref', 'review')
    AND ((c.relkind = 'r' AND has_table_privilege('bdc_reader', c.oid, 'SELECT'))
      OR (c.relkind = 'v' AND NOT has_table_privilege('bdc_reader', c.oid, 'SELECT')))));

SELECT pg_temp.check('no web role exists yet', NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname ILIKE '%web%'));

SELECT pg_temp.check('access_reader exists and is not a login role',
  EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'access_reader' AND NOT rolcanlogin));

SELECT pg_temp.check('bdc_reader was not granted the access schema',
  NOT has_schema_privilege('bdc_reader', 'access', 'USAGE'));
