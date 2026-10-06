-- Group 36: borrower-name supersession (G-10, G-11).
-- Synthetic TEST-ONLY names. The db test runner wraps this file in a transaction and rolls it back.
-- A successor may correct raw_text. A successor that changes neither rule, state, nor normalized text is rejected.

SELECT pg_temp.check('the migration inserts no borrower-name rows', (
  SELECT count(*) = 0 FROM obs.borrower_name_observation));

SELECT pg_temp.check('supersession columns exist and filing uniqueness is one root per evidence', (
  SELECT count(*) = 2
  FROM information_schema.columns
  WHERE table_schema = 'obs' AND table_name = 'borrower_name_observation'
    AND column_name IN ('supersedes_id', 'supersede_reason'))
  AND EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'obs' AND indexname = 'borrower_name_observation_filing_cell_root_uidx')
  AND NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'obs' AND indexname = 'borrower_name_observation_filing_cell_evidence_uidx')
  AND EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'obs' AND indexname = 'borrower_name_observation_supersedes_once'));

SELECT pg_temp.check('the successor guard does not freeze raw_text', (
  SELECT position('raw_text' IN p.prosrc) = 0
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'obs' AND p.proname = 'check_borrower_name_successor'));

SELECT pg_temp.check('reader and writer can select the current name view',
  has_table_privilege('bdc_reader', 'obs.current_borrower_name_observation', 'SELECT')
  AND has_table_privilege('bdc_pipeline_writer', 'obs.current_borrower_name_observation', 'SELECT')
  AND NOT has_table_privilege('bdc_reader', 'obs.borrower_name_observation', 'SELECT'));

DO $$
DECLARE
  art bigint;
  root_ev bigint;
  fix_ev bigint;
  doc bigint;
BEGIN
  INSERT INTO raw.artifact (source_url, final_url, source_type_code, http_status, byte_size, sha256,
      retrieved_at, storage_key, run_id)
  VALUES ('https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000036/test-only-name.htm',
          'https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000036/test-only-name.htm',
          'SEC_FILING_DOCUMENT', 200, 1, repeat('6', 64), '2099-01-06T00:00:00Z', 'test-only/name-htm',
          pg_temp.fx('run'))
  RETURNING id INTO art;

  INSERT INTO registry.filing_document (filing_id, document_name, document_url, named_by, rule_version_id, run_id, evidence_id)
  VALUES (pg_temp.fx('filing'), 'test-only-name.htm',
          'https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000036/test-only-name.htm',
          'FILING_INDEX_JSON', pg_temp.fx('r_project'), pg_temp.fx('run'), pg_temp.fx('e_sub'))
  RETURNING id INTO doc;

  INSERT INTO registry.filing_document_artifact (filing_document_id, artifact_id, run_id)
  VALUES (doc, art, pg_temp.fx('run'));

  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_anchor, run_id)
  VALUES ('L2_ORIGINAL_FILING', art, 'HTML_ANCHOR', 'ix-context-row:TEST-ONLY-name-root', pg_temp.fx('run'))
  RETURNING id INTO root_ev;

  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_anchor, run_id)
  VALUES ('L2_ORIGINAL_FILING', art, 'HTML_ANCHOR', 'ix-context-row:TEST-ONLY-name-fix', pg_temp.fx('run'))
  RETURNING id INTO fix_ev;

  PERFORM pg_temp.put('e_name_root', root_ev);
  PERFORM pg_temp.put('e_name_fix', fix_ev);
END
$$;

SELECT pg_temp.expect_ok('a filing-cell root can stay RAW_ONLY with null normalized text', ARRAY[format(
  $$INSERT INTO obs.borrower_name_observation (position_observation_id, name_source, raw_text,
      extraction_state, rule_version_id, evidence_id, run_id)
    VALUES (%s, 'FILING_CELL', 'TEST COMPANY CELL', 'RAW_ONLY', %s, %s, %s)$$,
  pg_temp.fx('po_a'), pg_temp.fx('r_field'), pg_temp.fx('e_name_root'), pg_temp.fx('run'))]);
INSERT INTO fx SELECT 'name_root', id FROM obs.borrower_name_observation
WHERE evidence_id = pg_temp.fx('e_name_root');

SELECT pg_temp.check('the root stores the disclosed text and no normalized text', (
  SELECT raw_text = 'TEST COMPANY CELL'
     AND normalized_text IS NULL
     AND extraction_state = 'RAW_ONLY'
     AND supersedes_id IS NULL
     AND supersede_reason IS NULL
     AND evidence_id = pg_temp.fx('e_name_root')
  FROM obs.borrower_name_observation
  WHERE id = pg_temp.fx('name_root')));

SELECT pg_temp.expect_ok('a normalization successor reuses the evidence and copies the raw text', ARRAY[format(
  $$INSERT INTO obs.borrower_name_observation (position_observation_id, name_source, raw_text, normalized_text,
      extraction_state, rule_version_id, evidence_id, run_id, supersedes_id, supersede_reason)
    VALUES (%s, 'FILING_CELL', 'TEST COMPANY CELL', 'TEST COMPANY CELL', 'EXTRACTED', %s, %s, %s, %s,
            'TEST ONLY norm.borrower_name v1')$$,
  pg_temp.fx('po_a'), pg_temp.fx('r_project'), pg_temp.fx('e_name_root'), pg_temp.fx('run'), pg_temp.fx('name_root'))]);
INSERT INTO fx SELECT 'name_v1', id FROM obs.borrower_name_observation
WHERE supersedes_id = pg_temp.fx('name_root');

SELECT pg_temp.check('the root is unchanged after the successor insert', (
  SELECT raw_text = 'TEST COMPANY CELL'
     AND normalized_text IS NULL
     AND extraction_state = 'RAW_ONLY'
     AND rule_version_id = pg_temp.fx('r_field')
     AND evidence_id = pg_temp.fx('e_name_root')
     AND supersedes_id IS NULL
  FROM obs.borrower_name_observation
  WHERE id = pg_temp.fx('name_root')));

SELECT pg_temp.check('the successor is EXTRACTED on the same evidence', (
  SELECT raw_text = 'TEST COMPANY CELL'
     AND normalized_text = 'TEST COMPANY CELL'
     AND extraction_state = 'EXTRACTED'
     AND rule_version_id = pg_temp.fx('r_project')
     AND evidence_id = pg_temp.fx('e_name_root')
     AND supersedes_id = pg_temp.fx('name_root')
     AND supersede_reason = 'TEST ONLY norm.borrower_name v1'
  FROM obs.borrower_name_observation
  WHERE id = pg_temp.fx('name_v1')));

SELECT pg_temp.check('the current view returns the successor and not the root', (
  SELECT count(*) = 1 AND bool_and(id = pg_temp.fx('name_v1'))
  FROM obs.current_borrower_name_observation
  WHERE evidence_id = pg_temp.fx('e_name_root')));

SELECT pg_temp.expect_error('a second successor of the same predecessor is rejected', '23505', ARRAY[format(
  $$INSERT INTO obs.borrower_name_observation (position_observation_id, name_source, raw_text, normalized_text,
      extraction_state, rule_version_id, evidence_id, run_id, supersedes_id, supersede_reason)
    VALUES (%s, 'FILING_CELL', 'TEST COMPANY CELL', 'TEST COMPANY CELL', 'EXTRACTED', %s, %s, %s, %s,
            'TEST ONLY fork')$$,
  pg_temp.fx('po_a'), pg_temp.fx('r_project2'), pg_temp.fx('e_name_root'), pg_temp.fx('run'), pg_temp.fx('name_root'))]);

SELECT pg_temp.expect_error('a second filing-cell root for the same evidence is rejected', 'BDCS1', ARRAY[format(
  $$INSERT INTO obs.borrower_name_observation (position_observation_id, name_source, raw_text,
      extraction_state, rule_version_id, evidence_id, run_id)
    VALUES (%s, 'FILING_CELL', 'TEST COMPANY CELL', 'RAW_ONLY', %s, %s, %s)$$,
  pg_temp.fx('po_a'), pg_temp.fx('r_field'), pg_temp.fx('e_name_root'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('UPDATE of a borrower-name row is rejected', 'BDCA1', ARRAY[format(
  'UPDATE obs.borrower_name_observation SET raw_text = raw_text WHERE id = %s', pg_temp.fx('name_root'))]);

SELECT pg_temp.expect_ok('a later rule version supersedes the current head', ARRAY[format(
  $$INSERT INTO obs.borrower_name_observation (position_observation_id, name_source, raw_text, normalized_text,
      extraction_state, rule_version_id, evidence_id, run_id, supersedes_id, supersede_reason)
    VALUES (%s, 'FILING_CELL', 'TEST COMPANY CELL', 'TEST COMPANY CELL', 'EXTRACTED', %s, %s, %s, %s,
            'TEST ONLY norm.borrower_name v2')$$,
  pg_temp.fx('po_a'), pg_temp.fx('r_project2'), pg_temp.fx('e_name_root'), pg_temp.fx('run'), pg_temp.fx('name_v1'))]);
INSERT INTO fx SELECT 'name_v2', id FROM obs.borrower_name_observation
WHERE supersedes_id = pg_temp.fx('name_v1');

SELECT pg_temp.check('only version 2 is current and the earlier rows remain stored', (
  SELECT (SELECT count(*) = 1 AND bool_and(id = pg_temp.fx('name_v2'))
          FROM obs.current_borrower_name_observation
          WHERE evidence_id = pg_temp.fx('e_name_root'))
     AND (SELECT count(*) = 3
          FROM obs.borrower_name_observation
          WHERE evidence_id = pg_temp.fx('e_name_root'))
     AND (SELECT extraction_state = 'RAW_ONLY' AND normalized_text IS NULL
          FROM obs.borrower_name_observation WHERE id = pg_temp.fx('name_root'))
     AND (SELECT rule_version_id = pg_temp.fx('r_project')
          FROM obs.borrower_name_observation WHERE id = pg_temp.fx('name_v1'))));

SELECT pg_temp.expect_ok('an SOI root stays current beside the filing-cell head', ARRAY[format(
  $$INSERT INTO obs.borrower_name_observation (position_observation_id, source_column_label, source_column_position,
      raw_text, normalized_text, extraction_state, rule_version_id, evidence_id, run_id)
    VALUES (%s, 'Investment, Identifier Axis', 6, 'TEST BORROWER A | TEST LOAN 1',
            'TEST BORROWER A | TEST LOAN 1', 'EXTRACTED', %s, %s, %s)$$,
  pg_temp.fx('po_a'), pg_temp.fx('r_field'), pg_temp.fx('e_ident_a'), pg_temp.fx('run'))]);
INSERT INTO fx SELECT 'name_soi', id FROM obs.borrower_name_observation
WHERE position_observation_id = pg_temp.fx('po_a') AND name_source = 'SOI_CELL';

SELECT pg_temp.check('SOI and filing-cell heads are both current because their subjects differ', (
  SELECT count(*) = 2
     AND bool_or(id = pg_temp.fx('name_v2') AND name_source = 'FILING_CELL')
     AND bool_or(id = pg_temp.fx('name_soi') AND name_source = 'SOI_CELL')
  FROM obs.current_borrower_name_observation
  WHERE position_observation_id = pg_temp.fx('po_a')));

SELECT pg_temp.expect_error('a successor that changes neither rule, state, nor normalized text is rejected', 'BDCS1', ARRAY[format(
  $$INSERT INTO obs.borrower_name_observation (position_observation_id, name_source, raw_text, normalized_text,
      extraction_state, rule_version_id, evidence_id, run_id, supersedes_id, supersede_reason)
    VALUES (%s, 'FILING_CELL', 'TEST COMPANY CELL', 'TEST COMPANY CELL', 'EXTRACTED', %s, %s, %s, %s,
            'TEST ONLY no-op')$$,
  pg_temp.fx('po_a'), pg_temp.fx('r_project2'), pg_temp.fx('e_name_root'), pg_temp.fx('run'), pg_temp.fx('name_v2'))]);

SELECT pg_temp.expect_error('changing only raw_text does not make a successor', 'BDCS1', ARRAY[format(
  $$INSERT INTO obs.borrower_name_observation (position_observation_id, name_source, raw_text, normalized_text,
      extraction_state, rule_version_id, evidence_id, run_id, supersedes_id, supersede_reason)
    VALUES (%s, 'FILING_CELL', 'TEST COMPANY CELL CORRECTED', 'TEST COMPANY CELL', 'EXTRACTED', %s, %s, %s, %s,
            'TEST ONLY raw text alone')$$,
  pg_temp.fx('po_a'), pg_temp.fx('r_project2'), pg_temp.fx('e_name_root'), pg_temp.fx('run'), pg_temp.fx('name_v2'))]);

SELECT pg_temp.expect_ok('a capture correction can store a different raw text with a new rule', ARRAY[format(
  $$INSERT INTO obs.borrower_name_observation (position_observation_id, name_source, raw_text,
      extraction_state, rule_version_id, evidence_id, run_id)
    VALUES (%s, 'FILING_CELL', 'TEST  COMPANY CELL', 'RAW_ONLY', %s, %s, %s)$$,
  pg_temp.fx('po_b'), pg_temp.fx('r_field'), pg_temp.fx('e_name_fix'), pg_temp.fx('run'))]);
INSERT INTO fx SELECT 'name_fix_root', id FROM obs.borrower_name_observation
WHERE evidence_id = pg_temp.fx('e_name_fix');

SELECT pg_temp.expect_ok('the corrected successor keeps its own raw text and the same evidence', ARRAY[format(
  $$INSERT INTO obs.borrower_name_observation (position_observation_id, name_source, raw_text, normalized_text,
      extraction_state, rule_version_id, evidence_id, run_id, supersedes_id, supersede_reason)
    VALUES (%s, 'FILING_CELL', 'TEST COMPANY CELL', 'TEST COMPANY CELL', 'EXTRACTED', %s, %s, %s, %s,
            'TEST ONLY capture correction')$$,
  pg_temp.fx('po_b'), pg_temp.fx('r_project'), pg_temp.fx('e_name_fix'), pg_temp.fx('run'), pg_temp.fx('name_fix_root'))]);

SELECT pg_temp.check('the corrected chain keeps both raw texts and shows only the successor', (
  SELECT (SELECT raw_text = 'TEST  COMPANY CELL' AND extraction_state = 'RAW_ONLY'
          FROM obs.borrower_name_observation WHERE id = pg_temp.fx('name_fix_root'))
     AND (SELECT raw_text = 'TEST COMPANY CELL' AND normalized_text = 'TEST COMPANY CELL'
             AND extraction_state = 'EXTRACTED' AND evidence_id = pg_temp.fx('e_name_fix')
          FROM obs.current_borrower_name_observation
          WHERE evidence_id = pg_temp.fx('e_name_fix'))));

SELECT pg_temp.check('supersession creates no identity or resolution rows', (
  SELECT (SELECT count(*) FROM identity.legal_entity) = 0
     AND (SELECT count(*) FROM identity.legal_entity_alias) = 0
     AND (SELECT count(*) FROM resolution.entity_resolution_decision) = 0
     AND (SELECT count(*) FROM resolution.instrument_resolution_decision) = 0));

SELECT pg_temp.check('the successor is visible in this rolled-back test transaction', (
  SELECT id = pg_temp.fx('name_v2')
  FROM obs.current_borrower_name_observation
  WHERE evidence_id = pg_temp.fx('e_name_root')));
