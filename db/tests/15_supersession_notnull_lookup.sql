-- Group 15: NOT NULL subject lookup (migration 0013).
-- All values are obviously fake (TEST BDC 1, TEST BORROWER A, dates in 2099).

SELECT pg_temp.check('check_supersession chooses = from attnotnull',
  position('attnotnull' IN pg_get_functiondef('ops.check_supersession()'::regprocedure)) > 0
  AND position('t.%I = ($1).%I' IN pg_get_functiondef('ops.check_supersession()'::regprocedure)) > 0
  AND position('IS NOT DISTINCT FROM ($1).%I' IN pg_get_functiondef('ops.check_supersession()'::regprocedure)) > 0);

SELECT pg_temp.check('0012 subject indexes remain', EXISTS (
  SELECT 1 FROM pg_indexes
  WHERE schemaname = 'obs' AND indexname = 'soi_row_classification_subject_idx')
  AND EXISTS (
  SELECT 1 FROM pg_indexes
  WHERE schemaname = 'obs' AND indexname = 'position_field_value_subject_idx'));

SELECT pg_temp.expect_error('a second independent field value for the same subject is rejected', 'BDCS1', ARRAY[format(
  $$INSERT INTO obs.position_field_value (position_observation_id, field_code, column_mapping_id,
      source_column_label, source_column_position, raw_value, normalized_numeric, currency_state, scale_state,
      value_state, normalization_rule_version_id, evidence_id, run_id)
    VALUES (%s, 'COST', %s, 'Adjusted cost basis', 8, '90', 90, 'UNKNOWN', 'NOT_APPLICABLE', 'REPORTED', %s, %s, %s)$$,
  pg_temp.fx('po_a'), pg_temp.mapping('Adjusted cost basis'), pg_temp.fx('r_field'),
  pg_temp.add_evidence('L1_STRUCTURED_DATASET', pg_temp.fx('artifact'), pg_temp.fx('row_soi_a'), 8, 'Adjusted cost basis'),
  pg_temp.fx('run'))]);

SELECT pg_temp.expect_ok('release-wide coverage with NULL registrant_id is accepted', ARRAY[format(
  $$INSERT INTO ops.coverage_assertion (dataset_release_id, source_type_code, coverage_aspect, coverage_state, evidence_id,
      rationale, rule_version_id, run_id)
    VALUES (%s, 'SEC_BDC_DATASET_ZIP', 'SOI_HOLDINGS', 'EMPTY_PERIOD', %s, 'TEST ONLY: 0-byte soi.tsv', %s, %s)$$,
  pg_temp.fx('release'), pg_temp.fx('e_sub'), pg_temp.fx('r_coverage'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_error('a second release-wide assertion for the same nullable subject is rejected', 'BDCS1', ARRAY[format(
  $$INSERT INTO ops.coverage_assertion (dataset_release_id, source_type_code, coverage_aspect, coverage_state, evidence_id,
      rationale, rule_version_id, run_id)
    VALUES (%s, 'SEC_BDC_DATASET_ZIP', 'SOI_HOLDINGS', 'EMPTY_PERIOD', %s, 'TEST ONLY: duplicate EMPTY_PERIOD', %s, %s)$$,
  pg_temp.fx('release'), pg_temp.fx('e_sub'), pg_temp.fx('r_coverage'), pg_temp.fx('run'))]);

CREATE TEMP TABLE pg_temp.explain_fv (
  position_observation_id bigint NOT NULL,
  field_code text NOT NULL,
  source_column_label text
) ON COMMIT DROP;
INSERT INTO pg_temp.explain_fv
SELECT i, 'COST', 'TEST COL'
FROM generate_series(1, 8000) AS i;
CREATE INDEX explain_fv_subject_idx
  ON pg_temp.explain_fv (position_observation_id, field_code, source_column_label);
ANALYZE pg_temp.explain_fv;

CREATE TEMP TABLE pg_temp.explain_fv_plan (line text) ON COMMIT DROP;
DO $$
DECLARE
  p text;
BEGIN
  FOR p IN
    EXPLAIN (COSTS OFF)
    SELECT EXISTS (
      SELECT 1 FROM pg_temp.explain_fv t
      WHERE t.position_observation_id = 1
        AND t.field_code = 'COST'
        AND t.source_column_label IS NOT DISTINCT FROM 'TEST COL')
  LOOP
    INSERT INTO pg_temp.explain_fv_plan VALUES (p);
  END LOOP;
END
$$;

SELECT pg_temp.check('NOT NULL prefix of the field-value subject lookup is an Index Cond', (
  SELECT bool_or(line LIKE '%Index Cond%position_observation_id%')
     AND bool_or(line LIKE '%field_code%')
     AND bool_or(line LIKE '%Index Only Scan%' OR line LIKE '%Index Scan%')
  FROM pg_temp.explain_fv_plan));

SELECT pg_temp.check('duplicate SOI business keys remain two observations in the metric view', (
  SELECT observation_count = 2 FROM obs.soi_duplicate_key_groups
  WHERE accession_number = '0000000000-00-000001' AND identifier_raw = 'TEST BORROWER A | TEST LOAN 1'
    AND reported_date = '2099-12-31' AND qtrs = 0));
