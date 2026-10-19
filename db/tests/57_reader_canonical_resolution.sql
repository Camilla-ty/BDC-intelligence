-- Group 57: bdc_reader can resolve canonical legal-entity identity without base-table SELECT.

SELECT pg_temp.expect_ok('one legal entity for reader canonical checks', ARRAY[
  format($$INSERT INTO identity.legal_entity (id, creation_reason, run_id)
            VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa57', 'TEST ONLY reader canonical', %s)$$, pg_temp.fx('run'))
]);

SELECT pg_temp.check('reader canonical functions are owner-rights with a fixed search_path',
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'resolution' AND p.proname = 'approved_consolidation_target'
      AND p.prosecdef
      AND 'search_path=pg_catalog, resolution, pg_temp' = ANY (p.proconfig)
  )
  AND EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'resolution' AND p.proname = 'canonical_legal_entity'
      AND p.prosecdef
      AND 'search_path=pg_catalog, resolution, identity, pg_temp' = ANY (p.proconfig)
  )
  AND EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'resolution' AND p.proname = 'legal_entities_with_canonical'
      AND p.prosecdef
      AND 'search_path=pg_catalog, resolution, identity, pg_temp' = ANY (p.proconfig)
  ));

SELECT pg_temp.check('public and the pipeline writer cannot execute reader canonical functions',
  NOT has_function_privilege('public', 'resolution.approved_consolidation_target(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('public', 'resolution.canonical_legal_entity(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('public', 'resolution.legal_entities_with_canonical(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('bdc_pipeline_writer', 'resolution.canonical_legal_entity(uuid)', 'EXECUTE')
  AND has_function_privilege('bdc_reader', 'resolution.canonical_legal_entity(uuid)', 'EXECUTE')
  AND has_function_privilege('resolution_writer', 'resolution.canonical_legal_entity(uuid)', 'EXECUTE')
  AND has_function_privilege('admin_reader', 'resolution.canonical_legal_entity(uuid)', 'EXECUTE'));

SELECT pg_temp.expect_error('bdc_reader still cannot read identity.legal_entity', '42501', ARRAY[
  'SET ROLE bdc_reader',
  $$SELECT count(*) FROM identity.legal_entity$$]);

SELECT pg_temp.expect_ok('bdc_reader resolves a missing entity and an existing entity', ARRAY[
  'SET ROLE bdc_reader',
  $$DO $d$ BEGIN
      IF resolution.canonical_legal_entity('ffffffff-ffff-4fff-8fff-ffffffffffff') IS NOT NULL THEN
        RAISE EXCEPTION 'missing entity must return NULL';
      END IF;
      IF resolution.approved_consolidation_target('ffffffff-ffff-4fff-8fff-ffffffffffff') IS NOT NULL THEN
        RAISE EXCEPTION 'missing consolidation must return NULL';
      END IF;
      IF resolution.canonical_legal_entity('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa57')
         IS DISTINCT FROM 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa57' THEN
        RAISE EXCEPTION 'unconsolidated entity must resolve to itself';
      END IF;
      IF (SELECT count(*) FROM resolution.legal_entities_with_canonical('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa57')) <> 1 THEN
        RAISE EXCEPTION 'canonical set must contain the entity itself';
      END IF;
    END $d$ $$,
  'RESET ROLE']);
