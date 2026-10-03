-- Group 32: filing-cell borrower names (G-01, G-11, G-12, G-13, G-14).
-- Fake TEST-ONLY text. No HTML is parsed. No identity or resolution row is created.

SELECT pg_temp.check('the migration inserts no borrower-name rows', (
  SELECT count(*) = 0 FROM obs.borrower_name_observation));

SELECT pg_temp.check('the borrower-name trigger does not read holding_descriptor_raw', (
  SELECT position('holding_descriptor_raw' IN p.prosrc) = 0
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'obs' AND p.proname = 'check_borrower_name_observation'));

SELECT pg_temp.expect_ok('SOI_CELL insert succeeds when raw_text equals the origin cell', ARRAY[format(
  $$INSERT INTO obs.borrower_name_observation (position_observation_id, source_column_label, source_column_position,
      raw_text, normalized_text, extraction_state, rule_version_id, evidence_id, run_id)
    VALUES (%s, 'Investment, Identifier Axis', 6, 'TEST BORROWER A | TEST LOAN 1',
            'TEST BORROWER A | TEST LOAN 1', 'EXTRACTED', %s, %s, %s)$$,
  pg_temp.fx('po_a'), pg_temp.fx('r_field'), pg_temp.fx('e_ident_a'), pg_temp.fx('run'))]);

SELECT pg_temp.check('an omitted name_source defaults to SOI_CELL', (
  SELECT name_source = 'SOI_CELL' AND raw_text = 'TEST BORROWER A | TEST LOAN 1'
  FROM obs.borrower_name_observation
  WHERE position_observation_id = pg_temp.fx('po_a') AND source_column_label = 'Investment, Identifier Axis'));

SELECT pg_temp.expect_error('SOI_CELL insert with mismatched raw_text fails', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.borrower_name_observation (position_observation_id, source_column_label, source_column_position,
      raw_text, normalized_text, extraction_state, rule_version_id, evidence_id, run_id)
    VALUES (%s, 'Investment, Identifier Axis', 6, 'TEST BORROWER A',
            'TEST BORROWER A', 'EXTRACTED', %s, %s, %s)$$,
  pg_temp.fx('po_a'), pg_temp.fx('r_field'), pg_temp.fx('e_ident_a'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('SOI_CELL rejects row-level TSV evidence', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.borrower_name_observation (position_observation_id, source_column_label, source_column_position,
      raw_text, extraction_state, rule_version_id, evidence_id, run_id)
    VALUES (%s, 'Investment, Identifier Axis', 6, 'TEST BORROWER A | TEST LOAN 1',
            'RAW_ONLY', %s, %s, %s)$$,
  pg_temp.fx('po_b'), pg_temp.fx('r_field'), pg_temp.fx('e_soi_b'), pg_temp.fx('run'))]);

DO $$
DECLARE
  art bigint;
  ev bigint;
  doc bigint;
  other_filing bigint;
  other_art bigint;
  other_ev bigint;
  zip_ev bigint;
  doc_ev bigint;
  ix_ev bigint;
BEGIN
  INSERT INTO raw.artifact (source_url, final_url, source_type_code, http_status, byte_size, sha256,
      retrieved_at, storage_key, run_id)
  VALUES ('https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000001/test-only-cell.htm',
          'https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000001/test-only-cell.htm',
          'SEC_FILING_DOCUMENT', 200, 1, repeat('1', 64), '2099-01-02T00:00:00Z', 'test-only/cell-htm',
          pg_temp.fx('run'))
  RETURNING id INTO art;

  INSERT INTO registry.filing_document (filing_id, document_name, document_url, named_by, rule_version_id, run_id, evidence_id)
  VALUES (pg_temp.fx('filing'), 'test-only-cell.htm',
          'https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000001/test-only-cell.htm',
          'FILING_INDEX_JSON', pg_temp.fx('r_project'), pg_temp.fx('run'), pg_temp.fx('e_sub'))
  RETURNING id INTO doc;

  INSERT INTO registry.filing_document_artifact (filing_document_id, artifact_id, run_id)
  VALUES (doc, art, pg_temp.fx('run'));

  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_anchor, run_id)
  VALUES ('L2_ORIGINAL_FILING', art, 'HTML_ANCHOR', 'ix-context-row:TEST-ONLY-company-cell', pg_temp.fx('run'))
  RETURNING id INTO ev;

  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, join_note, run_id)
  VALUES ('L2_ORIGINAL_FILING', art, 'DOCUMENT', 'TEST ONLY whole document', pg_temp.fx('run'))
  RETURNING id INTO doc_ev;

  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, ixbrl_fact_id, run_id)
  VALUES ('L2_ORIGINAL_FILING', art, 'IXBRL_FACT', 'TEST-ONLY-FACT-1', pg_temp.fx('run'))
  RETURNING id INTO ix_ev;

  INSERT INTO registry.filing_document_artifact (filing_document_id, artifact_id, run_id)
  VALUES (doc, pg_temp.fx('artifact'), pg_temp.fx('run'));

  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_anchor, run_id)
  VALUES ('L2_ORIGINAL_FILING', pg_temp.fx('artifact'), 'HTML_ANCHOR', 'ix-context-row:TEST-ONLY-zip-anchor', pg_temp.fx('run'))
  RETURNING id INTO zip_ev;

  INSERT INTO registry.filing (accession_number, run_id, evidence_id)
  VALUES ('0000000000-00-000098', pg_temp.fx('run'), pg_temp.fx('e_sub'))
  RETURNING id INTO other_filing;

  INSERT INTO raw.artifact (source_url, final_url, source_type_code, http_status, byte_size, sha256,
      retrieved_at, storage_key, run_id)
  VALUES ('https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000098/test-only-other.htm',
          'https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000098/test-only-other.htm',
          'SEC_FILING_DOCUMENT', 200, 1, repeat('2', 64), '2099-01-03T00:00:00Z', 'test-only/other-htm',
          pg_temp.fx('run'))
  RETURNING id INTO other_art;

  INSERT INTO registry.filing_document (filing_id, document_name, document_url, named_by, rule_version_id, run_id, evidence_id)
  VALUES (other_filing, 'test-only-other.htm',
          'https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000098/test-only-other.htm',
          'FILING_INDEX_JSON', pg_temp.fx('r_project'), pg_temp.fx('run'), pg_temp.fx('e_sub'))
  RETURNING id INTO doc;

  INSERT INTO registry.filing_document_artifact (filing_document_id, artifact_id, run_id)
  VALUES (doc, other_art, pg_temp.fx('run'));

  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_anchor, run_id)
  VALUES ('L2_ORIGINAL_FILING', other_art, 'HTML_ANCHOR', 'ix-context-row:TEST-ONLY-other-filing', pg_temp.fx('run'))
  RETURNING id INTO other_ev;

  PERFORM pg_temp.put('e_html', ev);
  PERFORM pg_temp.put('e_document', doc_ev);
  PERFORM pg_temp.put('e_ixbrl', ix_ev);
  PERFORM pg_temp.put('e_zip_anchor', zip_ev);
  PERFORM pg_temp.put('e_other_filing', other_ev);
END
$$;

SELECT pg_temp.expect_ok('FILING_CELL insert succeeds for an HTML anchor on the position filing', ARRAY[format(
  $$INSERT INTO obs.borrower_name_observation (position_observation_id, name_source, raw_text, normalized_text,
      extraction_state, rule_version_id, evidence_id, run_id)
    VALUES (%s, 'FILING_CELL', 'TEST  COMPANY CELL', 'TEST  COMPANY CELL', 'EXTRACTED', %s, %s, %s)$$,
  pg_temp.fx('po_a'), pg_temp.fx('r_field'), pg_temp.fx('e_html'), pg_temp.fx('run'))]);

SELECT pg_temp.check('FILING_CELL raw_text is preserved exactly', (
  SELECT raw_text = 'TEST  COMPANY CELL'
     AND normalized_text = 'TEST  COMPANY CELL'
     AND source_column_label IS NULL
     AND source_column_position IS NULL
     AND name_source = 'FILING_CELL'
  FROM obs.borrower_name_observation
  WHERE position_observation_id = pg_temp.fx('po_a') AND name_source = 'FILING_CELL'));

SELECT pg_temp.check('holding_descriptor_raw is unchanged and is not split into the filing cell', (
  SELECT p.holding_descriptor_raw = 'TEST BORROWER A | TEST LOAN 1'
     AND b.raw_text = 'TEST  COMPANY CELL'
     AND b.raw_text IS DISTINCT FROM p.holding_descriptor_raw
  FROM obs.position_observation p
  JOIN obs.borrower_name_observation b ON b.position_observation_id = p.id AND b.name_source = 'FILING_CELL'
  WHERE p.id = pg_temp.fx('po_a')));

SELECT pg_temp.check('SOI_CELL and FILING_CELL coexist on the same position', (
  SELECT count(*) FILTER (WHERE name_source = 'SOI_CELL') = 1
     AND count(*) FILTER (WHERE name_source = 'FILING_CELL') = 1
  FROM obs.borrower_name_observation
  WHERE position_observation_id = pg_temp.fx('po_a')));

SELECT pg_temp.check('golden-gate SOI equality still sees only the identifier column', (
  SELECT count(*) = 1
     AND bool_and(b.raw_text IS NOT DISTINCT FROM s.identifier_raw)
     AND bool_and(b.raw_text IS NOT DISTINCT FROM r.cells[b.source_column_position])
  FROM obs.borrower_name_observation b
  JOIN obs.position_observation p ON p.id = b.position_observation_id
  JOIN obs.soi_row_observation s ON s.id = p.origin_soi_row_observation_id
  JOIN raw.tabular_row r ON r.id = s.tabular_row_id
  WHERE b.position_observation_id = pg_temp.fx('po_a')
    AND b.source_column_label = 'Investment, Identifier Axis'));

SELECT pg_temp.check('FILING_CELL is outside the golden-gate identifier filter', (
  SELECT count(*) = 0
  FROM obs.borrower_name_observation b
  WHERE b.position_observation_id = pg_temp.fx('po_a')
    AND b.name_source = 'FILING_CELL'
    AND b.source_column_label = 'Investment, Identifier Axis'));

SELECT pg_temp.check('FILING_CELL insertion creates no identity or resolution rows', (
  SELECT (SELECT count(*) FROM identity.legal_entity) = 0
     AND (SELECT count(*) FROM identity.economic_group) = 0
     AND (SELECT count(*) FROM identity.instrument) = 0
     AND (SELECT count(*) FROM identity.position) = 0
     AND (SELECT count(*) FROM resolution.entity_resolution_decision) = 0
     AND (SELECT count(*) FROM resolution.match_candidate) = 0));

SELECT pg_temp.expect_error('FILING_CELL rejects L1 evidence', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.borrower_name_observation (position_observation_id, name_source, raw_text,
      extraction_state, rule_version_id, evidence_id, run_id)
    VALUES (%s, 'FILING_CELL', 'TEST COMPANY CELL', 'RAW_ONLY', %s, %s, %s)$$,
  pg_temp.fx('po_a'), pg_temp.fx('r_field'), pg_temp.fx('e_ident_a'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('FILING_CELL rejects a DOCUMENT locator', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.borrower_name_observation (position_observation_id, name_source, raw_text,
      extraction_state, rule_version_id, evidence_id, run_id)
    VALUES (%s, 'FILING_CELL', 'TEST COMPANY CELL', 'RAW_ONLY', %s, %s, %s)$$,
  pg_temp.fx('po_a'), pg_temp.fx('r_field'), pg_temp.fx('e_document'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('FILING_CELL rejects an artifact that is not SEC_FILING_DOCUMENT', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.borrower_name_observation (position_observation_id, name_source, raw_text,
      extraction_state, rule_version_id, evidence_id, run_id)
    VALUES (%s, 'FILING_CELL', 'TEST COMPANY CELL', 'RAW_ONLY', %s, %s, %s)$$,
  pg_temp.fx('po_a'), pg_temp.fx('r_field'), pg_temp.fx('e_zip_anchor'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('FILING_CELL rejects an artifact linked to another filing', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.borrower_name_observation (position_observation_id, name_source, raw_text,
      extraction_state, rule_version_id, evidence_id, run_id)
    VALUES (%s, 'FILING_CELL', 'TEST COMPANY CELL', 'RAW_ONLY', %s, %s, %s)$$,
  pg_temp.fx('po_a'), pg_temp.fx('r_field'), pg_temp.fx('e_other_filing'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('FILING_CELL rejects non-null SOI source columns', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.borrower_name_observation (position_observation_id, name_source, source_column_label,
      source_column_position, raw_text, extraction_state, rule_version_id, evidence_id, run_id)
    VALUES (%s, 'FILING_CELL', 'Investment, Identifier Axis', 6, 'TEST COMPANY CELL', 'RAW_ONLY', %s, %s, %s)$$,
  pg_temp.fx('po_a'), pg_temp.fx('r_field'), pg_temp.fx('e_html'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_ok('IXBRL_FACT is a second FILING_CELL locator on the same filing document', ARRAY[format(
  $$INSERT INTO obs.borrower_name_observation (position_observation_id, name_source, raw_text,
      extraction_state, rule_version_id, evidence_id, run_id)
    VALUES (%s, 'FILING_CELL', 'TEST IX COMPANY', 'RAW_ONLY', %s, %s, %s)$$,
  pg_temp.fx('po_a'), pg_temp.fx('r_field'), pg_temp.fx('e_ixbrl'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('the same FILING_CELL evidence cannot be stored twice on one position', '23505', ARRAY[format(
  $$INSERT INTO obs.borrower_name_observation (position_observation_id, name_source, raw_text,
      extraction_state, rule_version_id, evidence_id, run_id)
    VALUES (%s, 'FILING_CELL', 'TEST  COMPANY CELL', 'RAW_ONLY', %s, %s, %s)$$,
  pg_temp.fx('po_a'), pg_temp.fx('r_field'), pg_temp.fx('e_html'), pg_temp.fx('run'))]);
