-- Group 34: column-heading evidence and month precision.
-- Fake TEST-ONLY locators. Dates are in 2099. No filing bytes are parsed.
-- date_precision NULL is not a day code. A calendar day remains normalized_date.
-- MONTH is the only added annotation, and it cannot be stored with a day.
-- The check constraint does not contain a DAY token.

SELECT pg_temp.check('HTML_COLUMN_HEADING is a locator type', EXISTS (
  SELECT 1 FROM pg_enum e
  JOIN pg_type t ON t.oid = e.enumtypid
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'ref' AND t.typname = 'locator_type' AND e.enumlabel = 'HTML_COLUMN_HEADING'));

SELECT pg_temp.check('heading text has no field code column', NOT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'evidence' AND table_name = 'html_column_heading'
    AND column_name IN ('field_code', 'canonical_field')));

SELECT pg_temp.check('field date precision is null or MONTH and has no DAY token', (
  SELECT pg_get_constraintdef(c.oid) LIKE '%date_precision IS NULL%'
     AND pg_get_constraintdef(c.oid) LIKE '%''MONTH''%'
     AND pg_get_constraintdef(c.oid) NOT LIKE '%DAY%'
  FROM pg_constraint c
  JOIN pg_class r ON r.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = r.relnamespace
  WHERE n.nspname = 'obs' AND r.relname = 'position_field_value'
    AND c.conname = 'field_value_date_precision_check'));

SELECT pg_temp.check('position date precision is still only the SOI month-end marker', (
  SELECT pg_get_constraintdef(c.oid) LIKE '%MONTH_END_ROUNDED%'
     AND pg_get_constraintdef(c.oid) NOT LIKE '%''MONTH''%'
  FROM pg_constraint c
  JOIN pg_class r ON r.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = r.relnamespace
  WHERE n.nspname = 'obs' AND r.relname = 'position_observation'
    AND pg_get_constraintdef(c.oid) LIKE '%date_precision%'));

DO $$
DECLARE
  art bigint;
  other_art bigint;
  purchase bigint;
  maturity bigint;
  date_cell bigint;
  value_cell bigint;
BEGIN
  INSERT INTO raw.artifact (source_url, final_url, source_type_code, http_status, byte_size, sha256,
      retrieved_at, storage_key, run_id)
  VALUES ('https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000041/test-only-heading.htm',
          'https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000041/test-only-heading.htm',
          'SEC_FILING_DOCUMENT', 200, 1, repeat('a', 64), '2099-01-06T00:00:00Z', 'test-only/heading-htm',
          pg_temp.fx('run'))
  RETURNING id INTO art;
  INSERT INTO raw.artifact (source_url, final_url, source_type_code, http_status, byte_size, sha256,
      retrieved_at, storage_key, run_id)
  VALUES ('https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000042/test-only-heading-other.htm',
          'https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000042/test-only-heading-other.htm',
          'SEC_FILING_DOCUMENT', 200, 1, repeat('b', 64), '2099-01-07T00:00:00Z', 'test-only/heading-other-htm',
          pg_temp.fx('run'))
  RETURNING id INTO other_art;

  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_row_ordinal, html_slot_ordinal, run_id)
  VALUES ('L2_ORIGINAL_FILING', art, 'HTML_COLUMN_HEADING', 10, 18, pg_temp.fx('run'))
  RETURNING id INTO purchase;
  INSERT INTO evidence.html_column_heading (evidence_id, raw_text, matched_text)
  VALUES (purchase, 'Purchase Date', 'Purchase Date');

  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_row_ordinal, html_slot_ordinal, run_id)
  VALUES ('L2_ORIGINAL_FILING', art, 'HTML_COLUMN_HEADING', 11, 18, pg_temp.fx('run'))
  RETURNING id INTO maturity;
  INSERT INTO evidence.html_column_heading (evidence_id, raw_text, matched_text, stack_above_evidence_id)
  VALUES (maturity, 'Date', 'Date', purchase);

  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_row_ordinal, html_slot_ordinal, run_id)
  VALUES ('L2_ORIGINAL_FILING', other_art, 'HTML_COLUMN_HEADING', 10, 18, pg_temp.fx('run'))
  RETURNING id INTO date_cell;
  INSERT INTO evidence.html_column_heading (evidence_id, raw_text, matched_text)
  VALUES (date_cell, 'Date', 'Date');

  INSERT INTO evidence.evidence (
    evidence_level, artifact_id, locator_type, html_row_ordinal, html_slot_ordinal, heading_evidence_id, run_id)
  VALUES ('L2_ORIGINAL_FILING', art, 'HTML_TABLE_CELL', 20, 18, maturity, pg_temp.fx('run'))
  RETURNING id INTO value_cell;

  INSERT INTO obs.position_field_value (
    position_observation_id, field_code, raw_value, date_precision, normalized_year, normalized_month,
    currency_state, scale_state, value_state, normalization_rule_version_id, evidence_id, run_id)
  VALUES (
    pg_temp.fx('po_a'), 'MATURITY_DATE', '04/2099', 'MONTH', 2099, 4,
    'UNKNOWN', 'NOT_APPLICABLE', 'REPORTED', pg_temp.fx('r_field'), value_cell, pg_temp.fx('run'));

  PERFORM pg_temp.put('heading_purchase', purchase);
  PERFORM pg_temp.put('heading_other', date_cell);
  PERFORM pg_temp.put('heading_value', value_cell);
END
$$;

SELECT pg_temp.check('the raw Purchase Date heading is stored and is not the field code', (
  SELECT h.raw_text = 'Purchase Date' AND h.matched_text = 'Purchase Date'
  FROM evidence.html_column_heading h
  WHERE h.evidence_id = pg_temp.fx('heading_purchase')));

SELECT pg_temp.check('a month value stores a year and month and no day', (
  SELECT raw_value = '04/2099'
     AND date_precision = 'MONTH'
     AND normalized_year = 2099
     AND normalized_month = 4
     AND normalized_date IS NULL
  FROM obs.position_field_value
  WHERE evidence_id = pg_temp.fx('heading_value')));

SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

SELECT pg_temp.expect_error('a heading without text is rejected', 'BDCI1', ARRAY[
  format($$INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_row_ordinal, html_slot_ordinal, run_id)
          VALUES ('L2_ORIGINAL_FILING', %s, 'HTML_COLUMN_HEADING', 12, 18, %s)$$,
         (SELECT artifact_id FROM evidence.evidence WHERE id = pg_temp.fx('heading_purchase')), pg_temp.fx('run')),
  'SET CONSTRAINTS ALL IMMEDIATE']);
SET CONSTRAINTS ALL DEFERRED;

SELECT pg_temp.expect_error('a heading cannot carry a TSV column label', '23514', ARRAY[
  format($$INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_row_ordinal, html_slot_ordinal, column_label, run_id)
          VALUES ('L2_ORIGINAL_FILING', %s, 'HTML_COLUMN_HEADING', 13, 18, 'Purchase Date', %s)$$,
         (SELECT artifact_id FROM evidence.evidence WHERE id = pg_temp.fx('heading_purchase')), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('a value cell cannot cite a heading from another artifact', 'BDCI1', ARRAY[
  format($$INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_row_ordinal, html_slot_ordinal, heading_evidence_id, run_id)
          VALUES ('L2_ORIGINAL_FILING', %s, 'HTML_TABLE_CELL', 20, 18, %s, %s)$$,
         (SELECT artifact_id FROM evidence.evidence WHERE id = pg_temp.fx('heading_purchase')),
         pg_temp.fx('heading_other'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('a value cell cannot cite a heading on a later row', 'BDCI1', ARRAY[
  format($$INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_row_ordinal, html_slot_ordinal, heading_evidence_id, run_id)
          VALUES ('L2_ORIGINAL_FILING', %s, 'HTML_TABLE_CELL', 10, 18, %s, %s)$$,
         (SELECT artifact_id FROM evidence.evidence WHERE id = pg_temp.fx('heading_purchase')),
         pg_temp.fx('heading_purchase'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('month precision cannot store a day', 'BDCI1', ARRAY[
  format($$INSERT INTO obs.position_field_value (
            position_observation_id, field_code, raw_value, date_precision, normalized_year, normalized_month, normalized_date,
            currency_state, scale_state, value_state, normalization_rule_version_id, evidence_id, run_id)
          VALUES (%s, 'ACQUISITION_DATE', '04/2099', 'MONTH', 2099, 4, '2099-04-01',
                  'UNKNOWN', 'NOT_APPLICABLE', 'REPORTED', %s, %s, %s)$$,
         pg_temp.fx('po_b'), pg_temp.fx('r_field'), pg_temp.fx('heading_value'), pg_temp.fx('run'))]);
