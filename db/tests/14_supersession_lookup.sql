-- Group 14: indexable supersession subject lookup (migration 0012).
-- All values are obviously fake (TEST BDC 1, TEST BORROWER A, accession 0000000000-00-000001).

INSERT INTO fx
SELECT 'cls_a', c.id FROM obs.soi_row_classification c
WHERE c.soi_row_observation_id = pg_temp.fx('soi_a')
  AND NOT EXISTS (SELECT 1 FROM obs.soi_row_classification s WHERE s.supersedes_id = c.id);

SELECT pg_temp.check('check_supersession does not scan subjects via to_jsonb(t)',
  position('to_jsonb(t)' IN pg_get_functiondef('ops.check_supersession()'::regprocedure)) = 0);

SELECT pg_temp.check('soi_row_classification has a non-unique btree on soi_row_observation_id', EXISTS (
  SELECT 1 FROM pg_indexes
  WHERE schemaname = 'obs' AND tablename = 'soi_row_classification'
    AND indexname = 'soi_row_classification_subject_idx'
    AND indexdef LIKE '%USING btree (soi_row_observation_id)%'
    AND indexdef NOT LIKE '%UNIQUE%'));

SELECT pg_temp.check('position_field_value has a non-unique btree on its subject columns', EXISTS (
  SELECT 1 FROM pg_indexes
  WHERE schemaname = 'obs' AND tablename = 'position_field_value'
    AND indexname = 'position_field_value_subject_idx'
    AND indexdef LIKE '%USING btree (position_observation_id, field_code, source_column_label)%'
    AND indexdef NOT LIKE '%UNIQUE%'));

SELECT pg_temp.check('add_supersession creates a subject index for future single_chain tables',
  pg_get_functiondef('ops.add_supersession(regclass,text,text)'::regprocedure) LIKE '%_subject_idx%'
  AND pg_get_functiondef('ops.add_supersession(regclass,text,text)'::regprocedure) LIKE '%single_chain%');

SELECT pg_temp.expect_error('a second independent classification for the same SOI row is rejected', 'BDCS1', ARRAY[format(
  $$INSERT INTO obs.soi_row_classification (soi_row_observation_id, row_kind, period_role, rule_version_id, run_id)
    VALUES (%s, 'IDENTIFIER_ROW', 'UNRESOLVED', %s, %s)$$,
  pg_temp.fx('soi_a'), pg_temp.fx('r_classify'), pg_temp.fx('run'))]);

SELECT pg_temp.expect_ok('a classification is changed by a new row that supersedes it, with a reason', ARRAY[format(
  $$INSERT INTO obs.soi_row_classification (soi_row_observation_id, row_kind, period_role, rule_version_id, run_id,
      supersedes_id, supersede_reason)
    VALUES (%s, 'IDENTIFIER_ROW', 'OTHER_DATE', %s, %s, %s, 'TEST ONLY: period role revised')$$,
  pg_temp.fx('soi_a'), pg_temp.fx('r_classify'), pg_temp.fx('run'), pg_temp.fx('cls_a'))]);

SELECT pg_temp.check('the current classification view returns only the superseding row', (
  SELECT count(*) = 1 AND bool_and(period_role = 'OTHER_DATE' AND supersedes_id = pg_temp.fx('cls_a'))
  FROM obs.current_soi_row_classification
  WHERE soi_row_observation_id = pg_temp.fx('soi_a')));

SELECT pg_temp.check('the superseded classification is still stored', (
  SELECT period_role = 'UNRESOLVED' AND supersedes_id IS NULL
  FROM obs.soi_row_classification WHERE id = pg_temp.fx('cls_a')));

SELECT pg_temp.check('duplicate SOI business keys remain two observations in the metric view', (
  SELECT observation_count = 2 FROM obs.soi_duplicate_key_groups
  WHERE accession_number = '0000000000-00-000001' AND identifier_raw = 'TEST BORROWER A | TEST LOAN 1'
    AND reported_date = '2099-12-31' AND qtrs = 0));
