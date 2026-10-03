-- Group 33: Schedule of Investments disclosure-block evidence.
-- Fake TEST-ONLY locators. No HTML is parsed. No Geo Parent rows are inserted.

SELECT pg_temp.check('DISCLOSURE_BLOCK is a locator type', EXISTS (
  SELECT 1 FROM pg_enum e
  JOIN pg_type t ON t.oid = e.enumtypid
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'ref' AND t.typname = 'locator_type' AND e.enumlabel = 'DISCLOSURE_BLOCK'));

SELECT pg_temp.check('HTML_TABLE_CELL is a locator type', EXISTS (
  SELECT 1 FROM pg_enum e
  JOIN pg_type t ON t.oid = e.enumtypid
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'ref' AND t.typname = 'locator_type' AND e.enumlabel = 'HTML_TABLE_CELL'));

SELECT pg_temp.check('the L2 HTML anchor rule is unchanged', (
  SELECT pg_get_constraintdef(c.oid) LIKE '%ix-context-row:[A-Za-z0-9_-]+$%'
  FROM pg_constraint c
  JOIN pg_class r ON r.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = r.relnamespace
  WHERE n.nspname = 'evidence' AND r.relname = 'evidence' AND c.conname = 'evidence_l2_html_anchor_context_row'));

SELECT pg_temp.check('the evidence trigger does not hard-code a portfolio slot', (
  SELECT position('html_slot_ordinal = 0' IN p.prosrc) = 0
     AND position('holding_descriptor_raw' IN p.prosrc) = 0
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'evidence' AND p.proname = 'check_evidence'));

SELECT pg_temp.check('maturity still requires an ix-context-row anchor', (
  SELECT position('ix-context-row:' IN p.prosrc) > 0
     AND position('DISCLOSURE_BLOCK' IN p.prosrc) = 0
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'obs' AND p.proname = 'check_maturity_inspection'));

SELECT pg_temp.check('the borrower-name trigger does not parse HTML or read the descriptor', (
  SELECT position('holding_descriptor_raw' IN p.prosrc) = 0
     AND position('html_slot_ordinal = 0' IN p.prosrc) = 0
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'obs' AND p.proname = 'check_borrower_name_observation'));

DO $$
DECLARE
  art bigint;
  other_art bigint;
  block bigint;
  wide bigint;
  cell bigint;
  detail bigint;
  later bigint;
  fact bigint;
  anchor bigint;
  document bigint;
  bare_fact bigint;
  registry_anchor bigint;
  discovery_anchor bigint;
  doc bigint;
BEGIN
  INSERT INTO raw.artifact (source_url, final_url, source_type_code, http_status, byte_size, sha256,
      retrieved_at, storage_key, run_id)
  VALUES ('https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000033/test-only-block.htm',
          'https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000033/test-only-block.htm',
          'SEC_FILING_DOCUMENT', 200, 1, repeat('3', 64), '2099-01-04T00:00:00Z', 'test-only/block-htm',
          pg_temp.fx('run'))
  RETURNING id INTO art;

  INSERT INTO raw.artifact (source_url, final_url, source_type_code, http_status, byte_size, sha256,
      retrieved_at, storage_key, run_id)
  VALUES ('https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000034/test-only-other-block.htm',
          'https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000034/test-only-other-block.htm',
          'SEC_FILING_DOCUMENT', 200, 1, repeat('4', 64), '2099-01-05T00:00:00Z', 'test-only/other-block-htm',
          pg_temp.fx('run'))
  RETURNING id INTO other_art;

  INSERT INTO registry.filing_document (filing_id, document_name, document_url, named_by, rule_version_id, run_id, evidence_id)
  VALUES (pg_temp.fx('filing'), 'test-only-block.htm',
          'https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000033/test-only-block.htm',
          'FILING_INDEX_JSON', pg_temp.fx('r_project'), pg_temp.fx('run'), pg_temp.fx('e_sub'))
  RETURNING id INTO doc;

  INSERT INTO registry.filing_document_artifact (filing_document_id, artifact_id, run_id)
  VALUES (doc, art, pg_temp.fx('run'));

  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_row_ordinal, html_row_end_ordinal, run_id)
  VALUES ('L2_ORIGINAL_FILING', art, 'DISCLOSURE_BLOCK', 10, 12, pg_temp.fx('run'))
  RETURNING id INTO block;

  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_row_ordinal, html_row_end_ordinal, run_id)
  VALUES ('L2_ORIGINAL_FILING', other_art, 'DISCLOSURE_BLOCK', 10, 12, pg_temp.fx('run'))
  RETURNING id INTO wide;

  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_row_ordinal, html_slot_ordinal, block_evidence_id, run_id)
  VALUES ('L2_ORIGINAL_FILING', art, 'HTML_TABLE_CELL', 10, 0, block, pg_temp.fx('run'))
  RETURNING id INTO cell;

  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_row_ordinal, html_slot_ordinal, block_evidence_id, run_id)
  VALUES ('L2_ORIGINAL_FILING', art, 'HTML_TABLE_CELL', 11, 6, block, pg_temp.fx('run'))
  RETURNING id INTO detail;

  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_row_ordinal, html_slot_ordinal, block_evidence_id, run_id)
  VALUES ('L2_ORIGINAL_FILING', art, 'HTML_TABLE_CELL', 10, 6, block, pg_temp.fx('run'))
  RETURNING id INTO later;

  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, ixbrl_fact_id, html_row_ordinal, block_evidence_id, run_id)
  VALUES ('L2_ORIGINAL_FILING', art, 'IXBRL_FACT', 'TEST-ONLY-FACT-IN-BLOCK', 11, block, pg_temp.fx('run'))
  RETURNING id INTO fact;

  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_anchor, run_id)
  VALUES ('L2_ORIGINAL_FILING', art, 'HTML_ANCHOR', 'ix-context-row:TEST-ONLY-cswc-row', pg_temp.fx('run'))
  RETURNING id INTO anchor;

  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, run_id)
  VALUES ('L2_ORIGINAL_FILING', art, 'DOCUMENT', pg_temp.fx('run'))
  RETURNING id INTO document;

  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, ixbrl_fact_id, run_id)
  VALUES ('L2_ORIGINAL_FILING', art, 'IXBRL_FACT', 'TEST-ONLY-FACT-BARE', pg_temp.fx('run'))
  RETURNING id INTO bare_fact;

  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_anchor, run_id)
  VALUES ('REGISTRY', pg_temp.fx('artifact'), 'HTML_ANCHOR', '/files/TEST-ONLY/2099q1_bdc.zip', pg_temp.fx('run'))
  RETURNING id INTO registry_anchor;

  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_anchor, run_id)
  VALUES ('DISCOVERY', pg_temp.fx('artifact'), 'HTML_ANCHOR', '/files/TEST-ONLY/discovery.htm', pg_temp.fx('run'))
  RETURNING id INTO discovery_anchor;

  PERFORM pg_temp.put('block_art', art);
  PERFORM pg_temp.put('block_other_art', other_art);
  PERFORM pg_temp.put('block_id', block);
  PERFORM pg_temp.put('block_other', wide);
  PERFORM pg_temp.put('block_cell', cell);
  PERFORM pg_temp.put('block_detail_cell', detail);
  PERFORM pg_temp.put('block_nonzero_slot', later);
  PERFORM pg_temp.put('block_fact', fact);
  PERFORM pg_temp.put('block_anchor', anchor);
  PERFORM pg_temp.put('block_document', document);
  PERFORM pg_temp.put('block_bare_fact', bare_fact);
  PERFORM pg_temp.put('block_registry_anchor', registry_anchor);
  PERFORM pg_temp.put('block_discovery_anchor', discovery_anchor);
END
$$;

SELECT pg_temp.check('a disclosure block stores the inclusive row span', (
  SELECT locator_type = 'DISCLOSURE_BLOCK'
     AND html_row_ordinal = 10
     AND html_row_end_ordinal = 12
     AND html_slot_ordinal IS NULL
     AND block_evidence_id IS NULL
  FROM evidence.evidence WHERE id = pg_temp.fx('block_id')));

SELECT pg_temp.check('an HTML table cell stores its row, slot, and block', (
  SELECT locator_type = 'HTML_TABLE_CELL'
     AND html_row_ordinal = 10
     AND html_slot_ordinal = 0
     AND block_evidence_id = pg_temp.fx('block_id')
  FROM evidence.evidence WHERE id = pg_temp.fx('block_cell')));

SELECT pg_temp.check('a fact inside the block keeps its fact id and row', (
  SELECT locator_type = 'IXBRL_FACT'
     AND ixbrl_fact_id = 'TEST-ONLY-FACT-IN-BLOCK'
     AND html_row_ordinal = 11
     AND block_evidence_id = pg_temp.fx('block_id')
     AND html_slot_ordinal IS NULL
  FROM evidence.evidence WHERE id = pg_temp.fx('block_fact')));

SELECT pg_temp.check('the database accepts a non-zero slot on the block start row', (
  SELECT html_slot_ordinal = 6 AND html_row_ordinal = 10
  FROM evidence.evidence WHERE id = pg_temp.fx('block_nonzero_slot')));

SELECT pg_temp.check('an existing context-row anchor remains valid', (
  SELECT locator_type = 'HTML_ANCHOR' AND html_anchor = 'ix-context-row:TEST-ONLY-cswc-row'
     AND block_evidence_id IS NULL
  FROM evidence.evidence WHERE id = pg_temp.fx('block_anchor')));

SELECT pg_temp.check('an IXBRL fact without a block remains valid', (
  SELECT ixbrl_fact_id = 'TEST-ONLY-FACT-BARE' AND html_row_ordinal IS NULL AND block_evidence_id IS NULL
  FROM evidence.evidence WHERE id = pg_temp.fx('block_bare_fact')));

SELECT pg_temp.check('a document locator remains valid', (
  SELECT locator_type = 'DOCUMENT' AND block_evidence_id IS NULL
  FROM evidence.evidence WHERE id = pg_temp.fx('block_document')));

SELECT pg_temp.check('a registry HTML anchor remains valid', (
  SELECT evidence_level = 'REGISTRY' AND html_anchor = '/files/TEST-ONLY/2099q1_bdc.zip'
  FROM evidence.evidence WHERE id = pg_temp.fx('block_registry_anchor')));

SELECT pg_temp.check('a discovery HTML anchor remains valid', (
  SELECT evidence_level = 'DISCOVERY' AND html_anchor = '/files/TEST-ONLY/discovery.htm'
  FROM evidence.evidence WHERE id = pg_temp.fx('block_discovery_anchor')));

SELECT pg_temp.expect_ok('SOI_CELL still matches the origin identifier cell', ARRAY[format(
  $$INSERT INTO obs.borrower_name_observation (position_observation_id, source_column_label, source_column_position,
      raw_text, normalized_text, extraction_state, rule_version_id, evidence_id, run_id)
    VALUES (%s, 'Investment, Identifier Axis', 6, 'TEST BORROWER A | TEST LOAN 1',
            'TEST BORROWER A | TEST LOAN 1', 'EXTRACTED', %s, %s, %s)$$,
  pg_temp.fx('po_a'), pg_temp.fx('r_field'), pg_temp.fx('e_ident_a'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_ok('FILING_CELL accepts the block-start company cell', ARRAY[format(
  $$INSERT INTO obs.borrower_name_observation (position_observation_id, name_source, raw_text,
      extraction_state, rule_version_id, evidence_id, run_id)
    VALUES (%s, 'FILING_CELL', 'TEST COMPANY CELL', 'RAW_ONLY', %s, %s, %s)$$,
  pg_temp.fx('po_b'), pg_temp.fx('r_field'), pg_temp.fx('block_cell'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('a disclosure block cannot carry a slot', '23514', ARRAY[format(
  $$INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_row_ordinal, html_row_end_ordinal, html_slot_ordinal, run_id)
    VALUES ('L2_ORIGINAL_FILING', %s, 'DISCLOSURE_BLOCK', 1, 2, 0, %s)$$,
  pg_temp.fx('block_art'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('a disclosure block cannot name a parent', '23514', ARRAY[format(
  $$INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_row_ordinal, html_row_end_ordinal, block_evidence_id, run_id)
    VALUES ('L2_ORIGINAL_FILING', %s, 'DISCLOSURE_BLOCK', 10, 11, %s, %s)$$,
  pg_temp.fx('block_art'), pg_temp.fx('block_id'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('a disclosure block end cannot precede its start', '23514', ARRAY[format(
  $$INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_row_ordinal, html_row_end_ordinal, run_id)
    VALUES ('L2_ORIGINAL_FILING', %s, 'DISCLOSURE_BLOCK', 5, 4, %s)$$,
  pg_temp.fx('block_art'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('an HTML table cell requires a block', '23514', ARRAY[format(
  $$INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_row_ordinal, html_slot_ordinal, run_id)
    VALUES ('L2_ORIGINAL_FILING', %s, 'HTML_TABLE_CELL', 10, 0, %s)$$,
  pg_temp.fx('block_art'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('an HTML table cell cannot store an end row', '23514', ARRAY[format(
  $$INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_row_ordinal, html_row_end_ordinal, html_slot_ordinal, block_evidence_id, run_id)
    VALUES ('L2_ORIGINAL_FILING', %s, 'HTML_TABLE_CELL', 10, 12, 0, %s, %s)$$,
  pg_temp.fx('block_art'), pg_temp.fx('block_id'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('L1 rejects a disclosure block', '23514', ARRAY[format(
  $$INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_row_ordinal, html_row_end_ordinal, run_id)
    VALUES ('L1_STRUCTURED_DATASET', %s, 'DISCLOSURE_BLOCK', 1, 1, %s)$$,
  pg_temp.fx('block_art'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('registry rejects an HTML table cell', '23514', ARRAY[format(
  $$INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_row_ordinal, html_slot_ordinal, block_evidence_id, run_id)
    VALUES ('REGISTRY', %s, 'HTML_TABLE_CELL', 10, 0, %s, %s)$$,
  pg_temp.fx('block_art'), pg_temp.fx('block_id'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('a free-form L2 anchor is still rejected', '23514', ARRAY[format(
  $$INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_anchor, run_id)
    VALUES ('L2_ORIGINAL_FILING', %s, 'HTML_ANCHOR', 'company-cell', %s)$$,
  pg_temp.fx('block_art'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('a fact cannot cite a block without its row', 'BDCI1', ARRAY[format(
  $$INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, ixbrl_fact_id, block_evidence_id, run_id)
    VALUES ('L2_ORIGINAL_FILING', %s, 'IXBRL_FACT', 'TEST-ONLY-FACT-NO-ROW', %s, %s)$$,
  pg_temp.fx('block_art'), pg_temp.fx('block_id'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('a fact row outside the block is rejected', 'BDCI1', ARRAY[format(
  $$INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, ixbrl_fact_id, html_row_ordinal, block_evidence_id, run_id)
    VALUES ('L2_ORIGINAL_FILING', %s, 'IXBRL_FACT', 'TEST-ONLY-FACT-OUTSIDE', 13, %s, %s)$$,
  pg_temp.fx('block_art'), pg_temp.fx('block_id'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('a cell cannot use a block from another artifact', 'BDCI1', ARRAY[format(
  $$INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_row_ordinal, html_slot_ordinal, block_evidence_id, run_id)
    VALUES ('L2_ORIGINAL_FILING', %s, 'HTML_TABLE_CELL', 10, 0, %s, %s)$$,
  pg_temp.fx('block_art'), pg_temp.fx('block_other'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('a cell row outside the block is rejected', 'BDCI1', ARRAY[format(
  $$INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_row_ordinal, html_slot_ordinal, block_evidence_id, run_id)
    VALUES ('L2_ORIGINAL_FILING', %s, 'HTML_TABLE_CELL', 9, 0, %s, %s)$$,
  pg_temp.fx('block_art'), pg_temp.fx('block_id'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('L1 rejects an HTML table cell', '23514', ARRAY[format(
  $$INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_row_ordinal, html_slot_ordinal, block_evidence_id, run_id)
    VALUES ('L1_STRUCTURED_DATASET', %s, 'HTML_TABLE_CELL', 10, 0, %s, %s)$$,
  pg_temp.fx('block_art'), pg_temp.fx('block_id'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('registry rejects a disclosure block', '23514', ARRAY[format(
  $$INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_row_ordinal, html_row_end_ordinal, run_id)
    VALUES ('REGISTRY', %s, 'DISCLOSURE_BLOCK', 1, 1, %s)$$,
  pg_temp.fx('artifact'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('discovery rejects a disclosure block', '23514', ARRAY[format(
  $$INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_row_ordinal, html_row_end_ordinal, run_id)
    VALUES ('DISCOVERY', %s, 'DISCLOSURE_BLOCK', 1, 1, %s)$$,
  pg_temp.fx('artifact'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('discovery rejects an HTML table cell', '23514', ARRAY[format(
  $$INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_row_ordinal, html_slot_ordinal, block_evidence_id, run_id)
    VALUES ('DISCOVERY', %s, 'HTML_TABLE_CELL', 10, 0, %s, %s)$$,
  pg_temp.fx('block_art'), pg_temp.fx('block_id'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('a cell cannot use an anchor as its block parent', 'BDCI1', ARRAY[format(
  $$INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_row_ordinal, html_slot_ordinal, block_evidence_id, run_id)
    VALUES ('L2_ORIGINAL_FILING', %s, 'HTML_TABLE_CELL', 10, 0, %s, %s)$$,
  pg_temp.fx('block_art'), pg_temp.fx('block_anchor'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('FILING_CELL rejects a detail-row cell', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.borrower_name_observation (position_observation_id, name_source, raw_text,
      extraction_state, rule_version_id, evidence_id, run_id)
    VALUES (%s, 'FILING_CELL', 'TEST DETAIL CELL', 'RAW_ONLY', %s, %s, %s)$$,
  pg_temp.fx('po_b'), pg_temp.fx('r_field'), pg_temp.fx('block_detail_cell'), pg_temp.fx('run'))]);

SELECT pg_temp.check('no identity or resolution rows were created', (
  SELECT (SELECT count(*) FROM identity.legal_entity) = 0
     AND (SELECT count(*) FROM identity.economic_group) = 0
     AND (SELECT count(*) FROM identity.instrument) = 0
     AND (SELECT count(*) FROM identity.position) = 0
     AND (SELECT count(*) FROM resolution.entity_resolution_decision) = 0
     AND (SELECT count(*) FROM resolution.match_candidate) = 0));
