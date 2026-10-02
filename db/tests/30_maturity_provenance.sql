-- Group 30: product maturity provenance (migration 0025).
-- Obviously fake contexts, facts, and 2099 dates. No production filing.

WITH i AS (
  INSERT INTO raw.artifact (source_url, final_url, source_type_code, http_status, byte_size, sha256, retrieved_at, storage_key, run_id)
  VALUES ('https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000001/test-maturity.htm',
          'https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000001/test-maturity.htm',
          'SEC_FILING_DOCUMENT', 200, 1, repeat('d', 64), '2099-01-03T00:00:00Z', 'test-only/maturity-doc', pg_temp.fx('run'))
  RETURNING id
) INSERT INTO fx SELECT 'artifact_maturity', id FROM i;

WITH i AS (
  INSERT INTO registry.filing_document (filing_id, document_name, document_url, named_by, rule_version_id, run_id, evidence_id)
  VALUES (pg_temp.fx('filing'), 'test-maturity.htm',
          'https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000001/test-maturity.htm',
          'FILING_INDEX_JSON', pg_temp.fx('r_project'), pg_temp.fx('run'), pg_temp.fx('e_sub'))
  RETURNING id
) INSERT INTO fx SELECT 'filing_doc_maturity', id FROM i;

INSERT INTO registry.filing_document_artifact (filing_document_id, artifact_id, run_id)
VALUES (pg_temp.fx('filing_doc_maturity'), pg_temp.fx('artifact_maturity'), pg_temp.fx('run'));

WITH i AS (
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, run_id)
  VALUES ('L2_ORIGINAL_FILING', pg_temp.fx('artifact_maturity'), 'DOCUMENT', pg_temp.fx('run'))
  RETURNING id
) INSERT INTO fx SELECT 'e_doc', id FROM i;

WITH i AS (
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_anchor, run_id)
  VALUES ('L2_ORIGINAL_FILING', pg_temp.fx('artifact_maturity'), 'HTML_ANCHOR', 'ix-context-row:c-1', pg_temp.fx('run'))
  RETURNING id
) INSERT INTO fx SELECT 'e_anchor', id FROM i;

WITH i AS (
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, ixbrl_fact_id, run_id)
  VALUES ('L2_ORIGINAL_FILING', pg_temp.fx('artifact_maturity'), 'IXBRL_FACT', 'f-1', pg_temp.fx('run'))
  RETURNING id
) INSERT INTO fx SELECT 'e_fact', id FROM i;

-- Another position on the setup SOI row, projected under a different rule version.
CREATE FUNCTION pg_temp.add_position(key text, rule_key text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  soi bigint;
  po bigint;
BEGIN
  INSERT INTO obs.soi_row_observation (tabular_row_id, filing_id, reported_date_raw, reported_date,
      date_precision, qtrs_raw, qtrs, duration_kind, identifier_raw, rule_version_id, evidence_id, run_id)
  VALUES (pg_temp.fx('row_soi_a'), pg_temp.fx('filing'), '2099-12-31', '2099-12-31', 'MONTH_END_ROUNDED', '0', 0,
          'POINT_IN_TIME', 'TEST BORROWER A | TEST LOAN 1', pg_temp.fx(rule_key), pg_temp.fx('e_soi_a'), pg_temp.fx('run'))
  RETURNING id INTO soi;
  INSERT INTO obs.soi_row_classification (soi_row_observation_id, row_kind, period_role, rule_version_id, run_id)
  VALUES (soi, 'IDENTIFIER_ROW', 'UNRESOLVED', pg_temp.fx('r_classify'), pg_temp.fx('run'));
  INSERT INTO obs.position_observation (origin_soi_row_observation_id, filing_id, reported_date,
      date_precision, duration_kind, holding_descriptor_raw, rule_version_id, evidence_id, run_id)
  VALUES (soi, pg_temp.fx('filing'), '2099-12-31', 'MONTH_END_ROUNDED', 'POINT_IN_TIME',
          'TEST BORROWER A | TEST LOAN 1', pg_temp.fx('r_position'), pg_temp.fx('e_soi_a'), pg_temp.fx('run'))
  RETURNING id INTO po;
  PERFORM pg_temp.put('soi_' || key, soi);
  PERFORM pg_temp.put('po_' || key, po);
END
$$;

CREATE FUNCTION pg_temp.origin(po_key text) RETURNS bigint
LANGUAGE sql AS $$
  SELECT origin_soi_row_observation_id FROM obs.position_observation WHERE id = pg_temp.fx(po_key)
$$;

CREATE FUNCTION pg_temp.current_inspection(po_key text) RETURNS bigint
LANGUAGE sql AS $$
  SELECT i.id FROM obs.maturity_inspection i
  WHERE i.position_observation_id = pg_temp.fx(po_key)
    AND NOT EXISTS (SELECT 1 FROM obs.maturity_inspection s WHERE s.supersedes_id = i.id)
$$;

-- A bound inspection on context c-1, superseding the current one when there is one.
CREATE FUNCTION pg_temp.inspect_bound(po_key text, state text, raw text, displayed date) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  prior bigint := pg_temp.current_inspection(po_key);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM validation.validation_result
                 WHERE subject_id = pg_temp.fx(po_key) AND outcome = 'PASS' AND detail = 'c-1') THEN
    INSERT INTO validation.validation_result (subject_table, subject_id, rule_version_id, outcome, detail, evidence_id, run_id)
    VALUES ('obs.position_observation', pg_temp.fx(po_key), pg_temp.fx('r_validate'), 'PASS', 'c-1', pg_temp.fx('e_fact'), pg_temp.fx('run'));
  END IF;
  INSERT INTO obs.maturity_inspection (position_observation_id, soi_row_observation_id, inspection_state,
      filing_context_id, raw_value, normalized_date, evidence_id, rule_version_id, run_id, supersedes_id, supersede_reason)
  VALUES (pg_temp.fx(po_key), pg_temp.origin(po_key), state::ref.maturity_inspection_state,
          'c-1', raw, displayed, pg_temp.fx('e_anchor'), pg_temp.fx('r_validate'), pg_temp.fx('run'),
          prior, CASE WHEN prior IS NOT NULL THEN 'TEST ONLY: newer inspection' END);
END
$$;

CREATE FUNCTION pg_temp.inspect_not_bound(po_key text, reason text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  prior bigint := pg_temp.current_inspection(po_key);
BEGIN
  INSERT INTO validation.validation_result (subject_table, subject_id, rule_version_id, outcome, detail, evidence_id, run_id)
  VALUES ('obs.position_observation', pg_temp.fx(po_key), pg_temp.fx('r_validate'), 'FAIL', reason, pg_temp.fx('e_doc'), pg_temp.fx('run'));
  INSERT INTO obs.maturity_inspection (position_observation_id, soi_row_observation_id, inspection_state,
      no_bind_reason, evidence_id, rule_version_id, run_id, supersedes_id, supersede_reason)
  VALUES (pg_temp.fx(po_key), pg_temp.origin(po_key), 'NOT_BOUND', reason::ref.maturity_no_bind_reason,
          pg_temp.fx('e_doc'), pg_temp.fx('r_validate'), pg_temp.fx('run'),
          prior, CASE WHEN prior IS NOT NULL THEN 'TEST ONLY: superseded by binder rule v2: ' || reason END);
END
$$;

CREATE FUNCTION pg_temp.structured(po_key text, raw text, value date) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO obs.position_field_value (position_observation_id, field_code, raw_value, normalized_date,
      currency_state, scale_state, value_state, normalization_rule_version_id, evidence_id, run_id)
  VALUES (pg_temp.fx(po_key), 'MATURITY_DATE', raw, value, 'UNKNOWN', 'NOT_APPLICABLE', 'REPORTED',
          pg_temp.fx('r_field'), pg_temp.fx('e_anchor'), pg_temp.fx('run'))
$$;

CREATE FUNCTION pg_temp.prov(po_key text) RETURNS obs.maturity_provenance
LANGUAGE sql AS $$
  SELECT * FROM obs.maturity_provenance WHERE position_observation_id = pg_temp.fx(po_key)
$$;

SELECT pg_temp.add_position('agree', 'r_project2');
SELECT pg_temp.add_position('filing', 'r_parser');
SELECT pg_temp.add_position('conflict', 'r_field');
SELECT pg_temp.add_position('not_bound', 'r_classify');
SELECT pg_temp.add_position('unavailable', 'r_group');
SELECT pg_temp.add_position('neither', 'r_validate');
SELECT pg_temp.add_position('struct_nb', 'r_resolve');
SELECT pg_temp.add_position('struct_un', 'r_coverage');
SELECT pg_temp.add_position('dup_1', 'r_mapping');
SELECT pg_temp.add_position('dup_2', 'r_metric');
SELECT pg_temp.add_position('candidates', 'r_metric_strict');

-- Case 1: structured and filing agree.
SELECT pg_temp.structured('po_agree', '1/2/2099', DATE '2099-01-02');
SELECT pg_temp.inspect_bound('po_agree', 'FILING_DISPLAYED', '01/02/2099', DATE '2099-01-02');
SELECT pg_temp.check('case 1: matching structured and filing dates use the structured date, verified by the filing', (
  SELECT provenance_state = 'REPORTED_STRUCTURED'
     AND maturity_date = DATE '2099-01-02' AND maturity_raw = '1/2/2099'
     AND filing_verified AND structured_field_value_id IS NOT NULL
     AND structured_raw = '1/2/2099' AND displayed_raw = '01/02/2099'
  FROM pg_temp.prov('po_agree')));

-- Case 2: no structured date, current FILING_DISPLAYED.
SELECT pg_temp.inspect_bound('po_filing', 'FILING_DISPLAYED', '4/13/2099', DATE '2099-04-13');
SELECT pg_temp.check('case 2: with no structured date the current filing date is the maturity, sourced to the inspection', (
  SELECT provenance_state = 'FILING_DISPLAYED'
     AND maturity_date = DATE '2099-04-13' AND maturity_raw = '4/13/2099'
     AND NOT filing_verified AND structured_date IS NULL AND structured_field_value_id IS NULL
     AND inspection_id = pg_temp.current_inspection('po_filing') AND filing_context_id = 'c-1' AND evidence_id IS NOT NULL
  FROM pg_temp.prov('po_filing')));
SELECT pg_temp.check('case 2: the filing date did not become a MATURITY_DATE field value', (
  SELECT count(*) = 0 FROM obs.position_field_value
  WHERE position_observation_id = pg_temp.fx('po_filing') AND field_code = 'MATURITY_DATE'));

-- Case 3: structured and filing disagree.
SELECT pg_temp.structured('po_conflict', '1/2/2099', DATE '2099-01-02');
SELECT pg_temp.inspect_bound('po_conflict', 'FILING_DISPLAYED', '3/4/2099', DATE '2099-03-04');
SELECT pg_temp.check('case 3: a structured/filing conflict is UNRESOLVED, keeps both raw values, and selects neither', (
  SELECT provenance_state = 'UNRESOLVED' AND maturity_date IS NULL AND maturity_raw IS NULL AND NOT filing_verified
     AND structured_raw = '1/2/2099' AND structured_date = DATE '2099-01-02'
     AND displayed_raw = '3/4/2099' AND displayed_date = DATE '2099-03-04'
  FROM pg_temp.prov('po_conflict')));

-- Case 4: no structured date, NOT_BOUND.
SELECT pg_temp.inspect_not_bound('po_not_bound', 'MULTIPLE_ROWS');
SELECT pg_temp.check('case 4: NOT_BOUND with no structured date is UNKNOWN, not UNRESOLVED, and exposes the reason', (
  SELECT provenance_state = 'UNKNOWN' AND maturity_date IS NULL
     AND inspection_state = 'NOT_BOUND' AND no_bind_reason = 'MULTIPLE_ROWS'
  FROM pg_temp.prov('po_not_bound')));

-- Case 5: no structured date, UNAVAILABLE.
SELECT pg_temp.inspect_bound('po_unavailable', 'UNAVAILABLE', NULL, NULL);
SELECT pg_temp.check('case 5: UNAVAILABLE with no structured date is UNKNOWN', (
  SELECT provenance_state = 'UNKNOWN' AND maturity_date IS NULL AND inspection_state = 'UNAVAILABLE'
     AND no_bind_reason IS NULL AND filing_context_id = 'c-1'
  FROM pg_temp.prov('po_unavailable')));

-- Case 6: neither source.
SELECT pg_temp.check('case 6: no structured date and no inspection is UNKNOWN', (
  SELECT provenance_state = 'UNKNOWN' AND maturity_date IS NULL AND inspection_id IS NULL AND inspection_state IS NULL
  FROM pg_temp.prov('po_neither')));

-- Case 7: structured date with a failed filing inspection.
SELECT pg_temp.structured('po_struct_nb', '5/6/2099', DATE '2099-05-06');
SELECT pg_temp.inspect_not_bound('po_struct_nb', 'SHARED_ROW');
SELECT pg_temp.structured('po_struct_un', '7/8/2099', DATE '2099-07-08');
SELECT pg_temp.inspect_bound('po_struct_un', 'UNAVAILABLE', NULL, NULL);
SELECT pg_temp.check('case 7: a NOT_BOUND inspection does not erase the structured date', (
  SELECT provenance_state = 'REPORTED_STRUCTURED' AND maturity_date = DATE '2099-05-06' AND maturity_raw = '5/6/2099'
     AND NOT filing_verified AND inspection_state = 'NOT_BOUND' AND no_bind_reason = 'SHARED_ROW'
  FROM pg_temp.prov('po_struct_nb')));
SELECT pg_temp.check('case 7: an UNAVAILABLE inspection does not erase the structured date', (
  SELECT provenance_state = 'REPORTED_STRUCTURED' AND maturity_date = DATE '2099-07-08'
     AND NOT filing_verified AND inspection_state = 'UNAVAILABLE'
  FROM pg_temp.prov('po_struct_un')));

-- Duplicate positions that once displayed the same filing date, now both NOT_BOUND SHARED_ROW.
SELECT pg_temp.inspect_bound('po_dup_1', 'FILING_DISPLAYED', '4/13/2099', DATE '2099-04-13');
SELECT pg_temp.inspect_bound('po_dup_2', 'FILING_DISPLAYED', '4/13/2099', DATE '2099-04-13');
SELECT pg_temp.inspect_not_bound('po_dup_1', 'SHARED_ROW');
SELECT pg_temp.inspect_not_bound('po_dup_2', 'SHARED_ROW');
SELECT pg_temp.check('a superseded FILING_DISPLAYED row never supplies a maturity to either duplicate', (
  SELECT count(*) = 2
     AND bool_and(provenance_state = 'UNKNOWN' AND maturity_date IS NULL AND displayed_date IS NULL
                  AND inspection_state = 'NOT_BOUND' AND no_bind_reason = 'SHARED_ROW')
  FROM obs.maturity_provenance
  WHERE position_observation_id IN (pg_temp.fx('po_dup_1'), pg_temp.fx('po_dup_2'))));
SELECT pg_temp.check('the superseded displayed dates stay in history', (
  SELECT count(*) = 2 FROM obs.maturity_inspection
  WHERE position_observation_id IN (pg_temp.fx('po_dup_1'), pg_temp.fx('po_dup_2'))
    AND inspection_state = 'FILING_DISPLAYED' AND normalized_date = DATE '2099-04-13'));
SELECT pg_temp.check('provenance reads exactly one current inspection per position', (
  SELECT count(*) = count(DISTINCT position_observation_id) FROM obs.maturity_provenance));

-- An UNRESOLVED inspection keeps candidates (for example a date under another column) and selects none.
SELECT pg_temp.inspect_bound('po_candidates', 'UNRESOLVED', NULL, NULL);
INSERT INTO obs.maturity_inspection_candidate (maturity_inspection_id, raw_value, normalized_date, evidence_id, run_id)
VALUES (pg_temp.current_inspection('po_candidates'), '1/2/2099', DATE '2099-01-02', pg_temp.fx('e_fact'), pg_temp.fx('run')),
       (pg_temp.current_inspection('po_candidates'), '3/4/2099', DATE '2099-03-04', pg_temp.fx('e_fact'), pg_temp.fx('run'));
SELECT pg_temp.check('an UNRESOLVED inspection never yields a maturity from its candidates', (
  SELECT provenance_state = 'UNRESOLVED' AND maturity_date IS NULL AND maturity_raw IS NULL
  FROM pg_temp.prov('po_candidates')));

SELECT pg_temp.expect_error('expiration prose cannot be stored as a displayed maturity', 'BDCI1', ARRAY[format(
  $$INSERT INTO obs.maturity_inspection (position_observation_id, soi_row_observation_id, inspection_state,
      filing_context_id, raw_value, normalized_date, evidence_id, rule_version_id, run_id)
    VALUES (%s, %s, 'FILING_DISPLAYED', 'c-1', 'Expiration - December 18, 2099', DATE '2099-12-18', %s, %s, %s)$$,
  pg_temp.fx('po_neither'), pg_temp.origin('po_neither'), pg_temp.fx('e_anchor'), pg_temp.fx('r_validate'), pg_temp.fx('run'))]);

SELECT pg_temp.check('maturity_date is NULL exactly when the state is UNKNOWN or UNRESOLVED', (
  SELECT bool_and((maturity_date IS NULL) = (provenance_state IN ('UNKNOWN', 'UNRESOLVED')))
  FROM obs.maturity_provenance));

SELECT pg_temp.check('UNAVAILABLE is no longer a provenance state', (
  SELECT count(*) = 0 FROM obs.maturity_provenance WHERE provenance_state = 'UNAVAILABLE'));

SELECT pg_temp.check('MATURITY_DATE field values are only the structured rows written here', (
  SELECT count(*) = 4 FROM obs.position_field_value WHERE field_code = 'MATURITY_DATE'));

SELECT pg_temp.check('the maturity wall, portfolio listing, and year counts read inspections only through provenance',
  pg_get_viewdef('registry.maturity_position'::regclass) !~ 'maturity_inspection\y'
  AND pg_get_viewdef('registry.portfolio_line'::regclass) !~ 'maturity_inspection\y'
  AND pg_get_viewdef('registry.maturity_year'::regclass) !~ 'maturity_inspection\y'
  AND pg_get_viewdef('registry.maturity_read'::regclass) !~ 'maturity_inspection\y');
