-- Group 17: P4-min borrower-name observations (G-11, G-10, G-04). Fake names only.
-- SOI_CELL raw_text must equal the cited origin cell.

SELECT pg_temp.add_identifier_position('po_other', 'TEST BORROWER B | TEST LOAN 2', 20);

SELECT pg_temp.expect_ok('EXTRACTED stores raw text next to normalized text', ARRAY[format(
  $$INSERT INTO obs.borrower_name_observation (position_observation_id, source_column_label, source_column_position,
      raw_text, normalized_text, extraction_state, rule_version_id, evidence_id, run_id)
    VALUES (%s, 'Investment, Identifier Axis', 6, 'TEST BORROWER A | TEST LOAN 1',
            'TEST BORROWER A | TEST LOAN 1', 'EXTRACTED', %s, %s, %s)$$,
  pg_temp.fx('po_a'), pg_temp.fx('r_field'), pg_temp.fx('e_ident_a'), pg_temp.fx('run'))]);

SELECT pg_temp.check('raw name is preserved exactly on the EXTRACTED row', (
  SELECT raw_text = 'TEST BORROWER A | TEST LOAN 1'
     AND normalized_text = 'TEST BORROWER A | TEST LOAN 1'
     AND extraction_state = 'EXTRACTED'
     AND rule_version_id IS NOT NULL
     AND evidence_id IS NOT NULL
     AND run_id IS NOT NULL
  FROM obs.borrower_name_observation
  WHERE position_observation_id = pg_temp.fx('po_a')));

SELECT pg_temp.expect_error('EXTRACTED requires a normalized value', '23514', ARRAY[format(
  $$INSERT INTO obs.borrower_name_observation (position_observation_id, source_column_label, source_column_position,
      raw_text, extraction_state, rule_version_id, evidence_id, run_id)
    VALUES (%s, 'Investment, Identifier Axis', 6, 'TEST BORROWER A | TEST LOAN 1',
            'EXTRACTED', %s, %s, %s)$$,
  pg_temp.fx('po_b'), pg_temp.fx('r_field'), pg_temp.fx('e_ident_b'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('RAW_ONLY cannot carry a normalized value', '23514', ARRAY[format(
  $$INSERT INTO obs.borrower_name_observation (position_observation_id, source_column_label, source_column_position,
      raw_text, normalized_text, extraction_state, rule_version_id, evidence_id, run_id)
    VALUES (%s, 'Investment, Identifier Axis', 6, 'TEST BORROWER A | TEST LOAN 1',
            'TEST BORROWER A | TEST LOAN 1', 'RAW_ONLY', %s, %s, %s)$$,
  pg_temp.fx('po_b'), pg_temp.fx('r_field'), pg_temp.fx('e_ident_b'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_ok('a different raw name is a second observation, not a merge', ARRAY[format(
  $$INSERT INTO obs.borrower_name_observation (position_observation_id, source_column_label, source_column_position,
      raw_text, normalized_text, extraction_state, rule_version_id, evidence_id, run_id)
    VALUES (%s, 'Investment, Identifier Axis', 6, 'TEST BORROWER B | TEST LOAN 2',
            'TEST BORROWER B | TEST LOAN 2', 'EXTRACTED', %s, %s, %s)$$,
  pg_temp.fx('po_other'), pg_temp.fx('r_field'), pg_temp.fx('po_other_cell'), pg_temp.fx('run'))]);

SELECT pg_temp.check('two different raw names remain two rows', (
  SELECT count(*) = 2
     AND count(DISTINCT raw_text) = 2
     AND bool_and(raw_text = normalized_text)
  FROM obs.borrower_name_observation
  WHERE position_observation_id IN (pg_temp.fx('po_a'), pg_temp.fx('po_other'))
    AND source_column_label = 'Investment, Identifier Axis'));

SELECT pg_temp.expect_ok('a second disclosed SOI column is a separate observation and does not replace the identifier name', ARRAY[format(
  $$INSERT INTO obs.borrower_name_observation (position_observation_id, source_column_label, source_column_position,
      raw_text, normalized_text, extraction_state, rule_version_id, evidence_id, run_id)
    VALUES (%s, 'name', 3, 'TEST BDC 1',
            'TEST BDC 1', 'EXTRACTED', %s, %s, %s)$$,
  pg_temp.fx('po_a'), pg_temp.fx('r_field'), pg_temp.fx('e_name_a'), pg_temp.fx('run'))]);

SELECT pg_temp.check('identifier and name-column observations coexist on the same position observation', (
  SELECT count(*) FILTER (WHERE source_column_label = 'Investment, Identifier Axis') = 1
     AND count(*) FILTER (WHERE source_column_label = 'name') = 1
     AND bool_and(source_column_label <> 'Investment, Identifier Axis' OR raw_text = 'TEST BORROWER A | TEST LOAN 1')
  FROM obs.borrower_name_observation
  WHERE position_observation_id = pg_temp.fx('po_a')));

SELECT pg_temp.expect_ok('UNRESOLVED is valid when normalized text is absent', ARRAY[format(
  $$INSERT INTO obs.borrower_name_observation (position_observation_id, source_column_label, source_column_position,
      raw_text, extraction_state, rule_version_id, evidence_id, run_id)
    VALUES (%s, 'name', 3, 'TEST BDC 1',
            'UNRESOLVED', %s, %s, %s)$$,
  pg_temp.fx('po_b'), pg_temp.fx('r_field'), pg_temp.fx('e_name_b'), pg_temp.fx('run'))]);

SELECT pg_temp.check('UNRESOLVED has no normalized text', (
  SELECT extraction_state = 'UNRESOLVED' AND normalized_text IS NULL
  FROM obs.borrower_name_observation
  WHERE position_observation_id = pg_temp.fx('po_b')
    AND source_column_label = 'name'));

SELECT pg_temp.expect_error('borrower_name_observation is append-only', 'BDCA1', ARRAY[
  format('UPDATE obs.borrower_name_observation SET raw_text = raw_text WHERE position_observation_id = %s', pg_temp.fx('po_a'))]);
SELECT pg_temp.expect_error('borrower_name_observation deletes are rejected', 'BDCA1', ARRAY[
  format('DELETE FROM obs.borrower_name_observation WHERE position_observation_id = %s', pg_temp.fx('po_a'))]);
