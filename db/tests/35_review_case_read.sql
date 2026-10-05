-- Group 35: case-member review reader (migration 0032).
-- Obviously fake positions, CIK 9999999901, accession 0000000000-00-000001, and 2099 dates.
-- The case key is the synthetic key used by the reader test. It is not a production filing.

DO $$
BEGIN
  FOR i IN 1..32 LOOP
    PERFORM pg_temp.add_identifier_position('geo_pos_' || i, 'TEST SOURCE ' || i, 200 + i);
  END LOOP;
END
$$;

SELECT pg_temp.put('case', review.open_candidate(
  'geo-parent-corporation', 'BORROWER', 'MANUAL_SEED', 'TEST SOURCE CASE', 'TEST RESEARCHER'));

DO $$
DECLARE
  i integer;
BEGIN
  FOR i IN 1..32 LOOP
    PERFORM review.add_member(pg_temp.fx('case'), pg_temp.fx('geo_pos_' || i), NULL, 'TEST RESEARCHER');
  END LOOP;
END
$$;

SELECT pg_temp.put('geo_row', (
  SELECT o.tabular_row_id
  FROM obs.position_observation p
  JOIN obs.soi_row_observation o ON o.id = p.origin_soi_row_observation_id
  WHERE p.id = pg_temp.fx('geo_pos_1')));

SELECT pg_temp.put('e_principal', pg_temp.add_evidence(
  'L1_STRUCTURED_DATASET', pg_temp.fx('artifact'), pg_temp.fx('geo_row'), 7,
  'Investment Owned, Balance, Principal Amount'));

INSERT INTO obs.position_field_value (
  position_observation_id, field_code, column_mapping_id, source_column_label, source_column_position,
  raw_value, normalized_numeric, currency_state, scale_state, value_state,
  normalization_rule_version_id, evidence_id, run_id)
VALUES (
  pg_temp.fx('geo_pos_1'), 'PRINCIPAL_AMOUNT',
  pg_temp.mapping('Investment Owned, Balance, Principal Amount'),
  'Investment Owned, Balance, Principal Amount', 7, '100', 100,
  'UNKNOWN', 'NOT_APPLICABLE', 'REPORTED',
  pg_temp.fx('r_field'), pg_temp.fx('e_principal'), pg_temp.fx('run'));

SELECT pg_temp.put('e_form', pg_temp.add_evidence(
  'L1_STRUCTURED_DATASET', pg_temp.fx('artifact'), pg_temp.fx('geo_row'), 3, 'name'));

INSERT INTO registry.filing_attribute_observation (
  filing_id, attribute_code, raw_value, normalized_text, value_state, rule_version_id, run_id, evidence_id)
VALUES (
  pg_temp.fx('filing'), 'FORM', 'TEST BDC 1', 'TEST BDC 1', 'REPORTED',
  pg_temp.fx('r_project'), pg_temp.fx('run'), pg_temp.fx('e_form'));

SELECT pg_temp.put('e_filed', pg_temp.add_evidence(
  'L1_STRUCTURED_DATASET', pg_temp.fx('artifact'), pg_temp.fx('geo_row'), 4, 'ddate'));

INSERT INTO registry.filing_attribute_observation (
  filing_id, attribute_code, raw_value, normalized_date, value_state, rule_version_id, run_id, evidence_id)
VALUES (
  pg_temp.fx('filing'), 'FILED_DATE', '2099-12-31', DATE '2099-12-31', 'REPORTED',
  pg_temp.fx('r_project'), pg_temp.fx('run'), pg_temp.fx('e_filed'));

INSERT INTO registry.filing_document (
  filing_id, document_name, document_url, named_by, rule_version_id, run_id, evidence_id)
VALUES (
  pg_temp.fx('filing'), 'test-review.htm',
  'https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000001/test-review.htm',
  'SUBMISSIONS_PRIMARY_DOCUMENT', pg_temp.fx('r_project'), pg_temp.fx('run'), pg_temp.fx('e_sub'));

WITH i AS (
  INSERT INTO raw.artifact (
    source_url, final_url, source_type_code, http_status, byte_size, sha256, retrieved_at, storage_key, run_id)
  VALUES (
    'https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000001/test-review-maturity.htm',
    'https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000001/test-review-maturity.htm',
    'SEC_FILING_DOCUMENT', 200, 1, repeat('e', 64), '2099-01-04T00:00:00Z', 'test-only/review-maturity',
    pg_temp.fx('run'))
  RETURNING id
) INSERT INTO fx SELECT 'artifact_review_maturity', id FROM i;

WITH i AS (
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_anchor, run_id)
  VALUES ('L2_ORIGINAL_FILING', pg_temp.fx('artifact_review_maturity'), 'HTML_ANCHOR', 'ix-context-row:c-review', pg_temp.fx('run'))
  RETURNING id
) INSERT INTO fx SELECT 'e_maturity', id FROM i;

INSERT INTO obs.position_field_value (
  position_observation_id, field_code, raw_value, normalized_date, currency_state, scale_state, value_state,
  normalization_rule_version_id, evidence_id, run_id)
VALUES (
  pg_temp.fx('geo_pos_1'), 'MATURITY_DATE', '1/2/2099', DATE '2099-01-02',
  'UNKNOWN', 'NOT_APPLICABLE', 'REPORTED',
  pg_temp.fx('r_field'), pg_temp.fx('e_maturity'), pg_temp.fx('run'));

SELECT pg_temp.check('the case reader is security definer with a pinned search path', (
  SELECT p.prosecdef
     AND p.provolatile = 's'
     AND p.proconfig = ARRAY['search_path=pg_catalog, review, registry, obs, evidence, resolution, ref']
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'registry' AND p.proname = 'review_case_read'));

SELECT pg_temp.check('the case reader does not query the broad portfolio or maturity views',
  NOT (pg_get_functiondef('registry.review_case_read(text)'::regprocedure)
       ~ 'registry\.portfolio_line|registry\.maturity_read|obs\.maturity_provenance'));

SELECT pg_temp.check('public cannot execute the case reader',
  NOT has_function_privilege('public', 'registry.review_case_read(text)', 'EXECUTE'));

SELECT pg_temp.check('bdc_reader can execute the case reader',
  has_function_privilege('bdc_reader', 'registry.review_case_read(text)', 'EXECUTE'));

SELECT pg_temp.check('bdc_reader still cannot read a review base table',
  NOT has_table_privilege('bdc_reader', 'review.candidate', 'SELECT')
  AND NOT has_table_privilege('bdc_reader', 'review.candidate_member', 'SELECT'));

SELECT pg_temp.expect_error('pipeline writer cannot execute the case reader', '42501', ARRAY[
  'SET ROLE bdc_pipeline_writer',
  $$SELECT registry.review_case_read('geo-parent-corporation')$$]);

CREATE TEMP TABLE review_case_payload (payload json);
GRANT INSERT, SELECT ON review_case_payload TO bdc_reader;

SELECT pg_temp.put('n_position', (SELECT count(*) FROM obs.position_observation));
SELECT pg_temp.put('n_field', (SELECT count(*) FROM obs.position_field_value));
SELECT pg_temp.put('n_inspection', (SELECT count(*) FROM obs.maturity_inspection));
SELECT pg_temp.put('n_filing', (SELECT count(*) FROM registry.filing));
SELECT pg_temp.put('n_attribute', (SELECT count(*) FROM registry.filing_attribute_observation));
SELECT pg_temp.put('n_document', (SELECT count(*) FROM registry.filing_document));
SELECT pg_temp.put('n_candidate', (SELECT count(*) FROM review.candidate));
SELECT pg_temp.put('n_member', (SELECT count(*) FROM review.candidate_member));
SELECT pg_temp.put('n_evidence', (SELECT count(*) FROM evidence.evidence));
SELECT pg_temp.put('n_artifact', (SELECT count(*) FROM raw.artifact));
SELECT pg_temp.put('n_entity', (SELECT count(*) FROM resolution.entity_resolution_decision));
SELECT pg_temp.put('n_instrument', (SELECT count(*) FROM resolution.instrument_resolution_decision));

SELECT pg_temp.expect_ok('bdc_reader can read the synthetic case', ARRAY[
  'SET ROLE bdc_reader',
  $$INSERT INTO review_case_payload SELECT registry.review_case_read('geo-parent-corporation')$$,
  'RESET ROLE']);

SELECT pg_temp.check('the reader changes no source rows',
  (SELECT count(*) = pg_temp.fx('n_position') FROM obs.position_observation)
  AND (SELECT count(*) = pg_temp.fx('n_field') FROM obs.position_field_value)
  AND (SELECT count(*) = pg_temp.fx('n_inspection') FROM obs.maturity_inspection)
  AND (SELECT count(*) = pg_temp.fx('n_filing') FROM registry.filing)
  AND (SELECT count(*) = pg_temp.fx('n_attribute') FROM registry.filing_attribute_observation)
  AND (SELECT count(*) = pg_temp.fx('n_document') FROM registry.filing_document)
  AND (SELECT count(*) = pg_temp.fx('n_candidate') FROM review.candidate)
  AND (SELECT count(*) = pg_temp.fx('n_member') FROM review.candidate_member)
  AND (SELECT count(*) = pg_temp.fx('n_evidence') FROM evidence.evidence)
  AND (SELECT count(*) = pg_temp.fx('n_artifact') FROM raw.artifact)
  AND (SELECT count(*) = pg_temp.fx('n_entity') FROM resolution.entity_resolution_decision)
  AND (SELECT count(*) = pg_temp.fx('n_instrument') FROM resolution.instrument_resolution_decision));

SELECT pg_temp.check('the reader returns exactly the 32 case members and omits a stored non-member', (
  SELECT count(*) = 32 FROM review.candidate_member WHERE candidate_id = pg_temp.fx('case'))
  AND (
    SELECT array_agg(id ORDER BY id)
    FROM (
      SELECT (line->>'position_observation_id')::bigint AS id
      FROM review_case_payload, jsonb_array_elements(payload::jsonb->'lines') line
    ) got
  ) = (
    SELECT array_agg(position_observation_id ORDER BY position_observation_id)
    FROM review.candidate_member
    WHERE candidate_id = pg_temp.fx('case')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM review_case_payload, jsonb_array_elements(payload::jsonb->'lines') line
    WHERE (line->>'position_observation_id')::bigint = pg_temp.fx('po_a')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM review_case_payload, jsonb_array_elements(payload::jsonb->'fields') field
    WHERE (field->>'position_observation_id')::bigint = pg_temp.fx('po_a')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM review_case_payload, jsonb_array_elements(payload::jsonb->'maturity') item
    WHERE (item->>'position_observation_id')::bigint = pg_temp.fx('po_a')
  ));

SELECT pg_temp.check('filing attributes, document, and disclosed text stay the stored values',
  (SELECT count(*) = 32 AND bool_and(
      line->>'registrant_cik' = '9999999901'
      AND line->>'accession_number' = '0000000000-00-000001'
      AND line->>'reported_date' = '2099-12-31'
      AND line->>'evidence_level' = 'L1_STRUCTURED_DATASET'
      AND line->>'form_state' = 'REPORTED'
      AND line->>'form_raw' = 'TEST BDC 1'
      AND line->>'filed_date_state' = 'REPORTED'
      AND line->>'filed_date_raw' = '2099-12-31'
      AND line->>'inline_url_state' = 'UNKNOWN'
      AND line->>'inline_url' IS NULL
      AND line->>'document_name' = 'test-review.htm'
      AND line->>'document_url' = 'https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000001/test-review.htm'
      AND line->>'disclosed_line_text' = p.holding_descriptor_raw
    )
   FROM review_case_payload
   CROSS JOIN jsonb_array_elements(payload::jsonb->'lines') line
   JOIN obs.position_observation p ON p.id = (line->>'position_observation_id')::bigint));

SELECT pg_temp.check('stored field values for the case members are unchanged',
  NOT EXISTS (
    SELECT m.position_observation_id, fv.field_code, fv.raw_value, fv.value_state::text, fv.scale_state::text, fv.source_column_label
    FROM review.candidate_member m
    JOIN obs.current_position_field_value fv ON fv.position_observation_id = m.position_observation_id
    WHERE m.candidate_id = pg_temp.fx('case')
      AND fv.field_code IN (
        'PRINCIPAL_AMOUNT', 'COST', 'FAIR_VALUE', 'INTEREST_RATE', 'SPREAD', 'PERCENT_OF_NET_ASSETS',
        'INSTRUMENT_TYPE', 'INDUSTRY', 'GEOGRAPHY', 'ACQUISITION_DATE', 'ISSUER_AFFILIATION', 'MATURITY_DATE'
      )
    EXCEPT
    SELECT (field->>'position_observation_id')::bigint,
           field->>'field_code',
           field->>'raw_value',
           field->>'value_state',
           field->>'scale_state',
           field->>'source_column_label'
    FROM review_case_payload, jsonb_array_elements(payload::jsonb->'fields') field
  )
  AND NOT EXISTS (
    SELECT (field->>'position_observation_id')::bigint,
           field->>'field_code',
           field->>'raw_value',
           field->>'value_state',
           field->>'scale_state',
           field->>'source_column_label'
    FROM review_case_payload, jsonb_array_elements(payload::jsonb->'fields') field
    EXCEPT
    SELECT m.position_observation_id, fv.field_code, fv.raw_value, fv.value_state::text, fv.scale_state::text, fv.source_column_label
    FROM review.candidate_member m
    JOIN obs.current_position_field_value fv ON fv.position_observation_id = m.position_observation_id
    WHERE m.candidate_id = pg_temp.fx('case')
      AND fv.field_code IN (
        'PRINCIPAL_AMOUNT', 'COST', 'FAIR_VALUE', 'INTEREST_RATE', 'SPREAD', 'PERCENT_OF_NET_ASSETS',
        'INSTRUMENT_TYPE', 'INDUSTRY', 'GEOGRAPHY', 'ACQUISITION_DATE', 'ISSUER_AFFILIATION', 'MATURITY_DATE'
      )
  )
  AND EXISTS (
    SELECT 1
    FROM review_case_payload, jsonb_array_elements(payload::jsonb->'fields') field
    WHERE (field->>'position_observation_id')::bigint = pg_temp.fx('geo_pos_1')
      AND field->>'field_code' = 'PRINCIPAL_AMOUNT'
      AND field->>'raw_value' = '100'
      AND field->>'value_state' = 'REPORTED'
  ));

SELECT pg_temp.check('maturity matches the product maturity for every case member',
  (SELECT count(*) = 32
   FROM review_case_payload, jsonb_array_elements(payload::jsonb->'maturity') item)
  AND NOT EXISTS (
    SELECT 1
    FROM review.candidate_member m
    JOIN registry.maturity_read r ON r.position_observation_id = m.position_observation_id
    JOIN (
      SELECT (item->>'position_observation_id')::bigint AS position_observation_id,
             item->>'maturity_source' AS maturity_source,
             item->>'maturity_raw' AS maturity_raw
      FROM review_case_payload, jsonb_array_elements(payload::jsonb->'maturity') item
    ) got ON got.position_observation_id = m.position_observation_id
    WHERE m.candidate_id = pg_temp.fx('case')
      AND (got.maturity_source IS DISTINCT FROM r.maturity_source
           OR got.maturity_raw IS DISTINCT FROM r.maturity_raw)
  )
  AND (
    SELECT item->>'maturity_source' = 'REPORTED_STRUCTURED' AND item->>'maturity_raw' = '1/2/2099'
    FROM review_case_payload, jsonb_array_elements(payload::jsonb->'maturity') item
    WHERE (item->>'position_observation_id')::bigint = pg_temp.fx('geo_pos_1')
  )
  AND (
    SELECT count(*) = 31
    FROM review_case_payload, jsonb_array_elements(payload::jsonb->'maturity') item
    WHERE (item->>'position_observation_id')::bigint <> pg_temp.fx('geo_pos_1')
      AND item->>'maturity_source' = 'UNKNOWN'
      AND item->>'maturity_raw' IS NULL
  ));

SELECT pg_temp.check('an unknown case key returns no lines and does not invent a member',
  (SELECT jsonb_array_length(registry.review_case_read('missing-case')::jsonb->'lines') = 0));

-- A filing with no current registrant, and a filing with two current registrants.
-- Both are members. The portfolio line omits both. The reader must omit both and keep the linked members.
DO $$
DECLARE
  bare_row bigint;
  bare_evidence bigint;
  bare_filing bigint;
  bare_soi bigint;
  bare_pos bigint;
  multi_row bigint;
  multi_evidence bigint;
  other_registrant bigint;
  multi_filing bigint;
  multi_soi bigint;
  multi_pos bigint;
  bare_line text := '0000000000-00-000002' || E'\t9999999901\tTEST BDC 1\t2099-12-31\t0\tTEST BORROWER BARE\t100\t90\t\t0.05\t0.01';
  multi_line text := '0000000000-00-000003' || E'\t9999999901\tTEST BDC 1\t2099-12-31\t0\tTEST BORROWER MULTI\t100\t90\t\t0.05\t0.01';
BEGIN
  bare_row := pg_temp.add_row(pg_temp.fx('l_soi'), 400, bare_line);
  bare_evidence := pg_temp.add_evidence('L1_STRUCTURED_DATASET', pg_temp.fx('artifact'), bare_row);
  INSERT INTO registry.filing (accession_number, run_id, evidence_id)
  VALUES ('0000000000-00-000002', pg_temp.fx('run'), bare_evidence)
  RETURNING id INTO bare_filing;
  INSERT INTO obs.soi_row_observation (
    tabular_row_id, filing_id, reported_date_raw, reported_date, date_precision, qtrs_raw, qtrs,
    duration_kind, identifier_raw, rule_version_id, evidence_id, run_id)
  VALUES (
    bare_row, bare_filing, '2099-12-31', '2099-12-31', 'MONTH_END_ROUNDED', '0', 0,
    'POINT_IN_TIME', 'TEST BORROWER BARE', pg_temp.fx('r_project'), bare_evidence, pg_temp.fx('run'))
  RETURNING id INTO bare_soi;
  INSERT INTO obs.soi_row_classification (soi_row_observation_id, row_kind, period_role, rule_version_id, run_id)
  VALUES (bare_soi, 'IDENTIFIER_ROW', 'UNRESOLVED', pg_temp.fx('r_classify'), pg_temp.fx('run'));
  INSERT INTO obs.position_observation (
    origin_soi_row_observation_id, filing_id, reported_date, date_precision, duration_kind,
    holding_descriptor_raw, rule_version_id, evidence_id, run_id)
  VALUES (
    bare_soi, bare_filing, '2099-12-31', 'MONTH_END_ROUNDED', 'POINT_IN_TIME',
    'TEST BORROWER BARE', pg_temp.fx('r_position'), bare_evidence, pg_temp.fx('run'))
  RETURNING id INTO bare_pos;
  PERFORM review.add_member(pg_temp.fx('case'), bare_pos, NULL, 'TEST RESEARCHER');
  PERFORM pg_temp.put('bare_pos', bare_pos);

  INSERT INTO registry.registrant (cik, run_id, evidence_id)
  VALUES (9999999902, pg_temp.fx('run'), pg_temp.fx('e_sub'))
  RETURNING id INTO other_registrant;
  multi_row := pg_temp.add_row(pg_temp.fx('l_soi'), 401, multi_line);
  multi_evidence := pg_temp.add_evidence('L1_STRUCTURED_DATASET', pg_temp.fx('artifact'), multi_row);
  INSERT INTO registry.filing (accession_number, run_id, evidence_id)
  VALUES ('0000000000-00-000003', pg_temp.fx('run'), multi_evidence)
  RETURNING id INTO multi_filing;
  INSERT INTO registry.filing_registrant_link (filing_id, registrant_id, link_source, run_id, evidence_id)
  VALUES
    (multi_filing, pg_temp.fx('registrant'), 'SUB_TABLE', pg_temp.fx('run'), pg_temp.fx('e_sub')),
    (multi_filing, other_registrant, 'SUB_TABLE', pg_temp.fx('run'), pg_temp.fx('e_sub'));
  INSERT INTO obs.soi_row_observation (
    tabular_row_id, filing_id, reported_date_raw, reported_date, date_precision, qtrs_raw, qtrs,
    duration_kind, identifier_raw, rule_version_id, evidence_id, run_id)
  VALUES (
    multi_row, multi_filing, '2099-12-31', '2099-12-31', 'MONTH_END_ROUNDED', '0', 0,
    'POINT_IN_TIME', 'TEST BORROWER MULTI', pg_temp.fx('r_project'), multi_evidence, pg_temp.fx('run'))
  RETURNING id INTO multi_soi;
  INSERT INTO obs.soi_row_classification (soi_row_observation_id, row_kind, period_role, rule_version_id, run_id)
  VALUES (multi_soi, 'IDENTIFIER_ROW', 'UNRESOLVED', pg_temp.fx('r_classify'), pg_temp.fx('run'));
  INSERT INTO obs.position_observation (
    origin_soi_row_observation_id, filing_id, reported_date, date_precision, duration_kind,
    holding_descriptor_raw, rule_version_id, evidence_id, run_id)
  VALUES (
    multi_soi, multi_filing, '2099-12-31', 'MONTH_END_ROUNDED', 'POINT_IN_TIME',
    'TEST BORROWER MULTI', pg_temp.fx('r_position'), multi_evidence, pg_temp.fx('run'))
  RETURNING id INTO multi_pos;
  PERFORM review.add_member(pg_temp.fx('case'), multi_pos, NULL, 'TEST RESEARCHER');
  PERFORM pg_temp.put('multi_pos', multi_pos);
END
$$;

CREATE TEMP TABLE review_case_linked (payload json);
GRANT INSERT, SELECT ON review_case_linked TO bdc_reader;

SELECT pg_temp.expect_ok('bdc_reader can read the case after unlinked members are added', ARRAY[
  'SET ROLE bdc_reader',
  $$INSERT INTO review_case_linked SELECT registry.review_case_read('geo-parent-corporation')$$,
  'RESET ROLE']);

SELECT pg_temp.check('zero current CIKs and multiple current CIKs are omitted with the linked members kept',
  (SELECT count(*) = 0 FROM registry.portfolio_line
   WHERE position_observation_id IN (pg_temp.fx('bare_pos'), pg_temp.fx('multi_pos')))
  AND NOT EXISTS (
    SELECT 1
    FROM review_case_linked, jsonb_array_elements(payload::jsonb->'lines') line
    WHERE (line->>'position_observation_id')::bigint IN (pg_temp.fx('bare_pos'), pg_temp.fx('multi_pos'))
  )
  AND NOT EXISTS (
    SELECT 1
    FROM review_case_linked, jsonb_array_elements(payload::jsonb->'fields') field
    WHERE (field->>'position_observation_id')::bigint IN (pg_temp.fx('bare_pos'), pg_temp.fx('multi_pos'))
  )
  AND NOT EXISTS (
    SELECT 1
    FROM review_case_linked, jsonb_array_elements(payload::jsonb->'maturity') item
    WHERE (item->>'position_observation_id')::bigint IN (pg_temp.fx('bare_pos'), pg_temp.fx('multi_pos'))
  )
  AND (
    SELECT array_agg(id ORDER BY id)
    FROM (
      SELECT (line->>'position_observation_id')::bigint AS id
      FROM review_case_linked, jsonb_array_elements(payload::jsonb->'lines') line
    ) got
  ) = (
    SELECT array_agg(m.position_observation_id ORDER BY m.position_observation_id)
    FROM review.candidate_member m
    WHERE m.candidate_id = pg_temp.fx('case')
      AND m.position_observation_id IN (SELECT position_observation_id FROM registry.portfolio_line)
  )
  AND (
    SELECT bool_and(line->>'registrant_cik' ~ '^[0-9]{10}$')
    FROM review_case_linked, jsonb_array_elements(payload::jsonb->'lines') line
  ));

-- A month-precision date is a reported year and month. The stand-in is 2099, the same
-- shape as a stored M/YYYY value. It must not become the first or last calendar day.

INSERT INTO obs.position_field_value (
  position_observation_id, field_code, raw_value, date_precision, normalized_year, normalized_month,
  currency_state, scale_state, value_state, normalization_rule_version_id, evidence_id, run_id)
VALUES
  (pg_temp.fx('geo_pos_2'), 'MATURITY_DATE', '12/2099', 'MONTH', 2099, 12,
   'UNKNOWN', 'NOT_APPLICABLE', 'REPORTED', pg_temp.fx('r_field'), pg_temp.fx('e_maturity'), pg_temp.fx('run')),
  (pg_temp.fx('geo_pos_2'), 'ACQUISITION_DATE', '04/2099', 'MONTH', 2099, 4,
   'UNKNOWN', 'NOT_APPLICABLE', 'REPORTED', pg_temp.fx('r_field'), pg_temp.fx('e_maturity'), pg_temp.fx('run'));

CREATE TEMP TABLE review_case_month (payload json);
GRANT INSERT, SELECT ON review_case_month TO bdc_reader;

SELECT pg_temp.expect_ok('bdc_reader can read a month-precision date', ARRAY[
  'SET ROLE bdc_reader',
  $$INSERT INTO review_case_month SELECT registry.review_case_read('geo-parent-corporation')$$,
  'RESET ROLE']);

SELECT pg_temp.check('a month maturity stays reported and does not become a calendar day', (
  SELECT item->>'maturity_source' = 'REPORTED'
     AND item->>'maturity_raw' = '12/2099'
     AND item->>'maturity_raw' IS DISTINCT FROM '2099-12-01'
     AND item->>'maturity_raw' IS DISTINCT FROM '2099-12-31'
  FROM review_case_month, jsonb_array_elements(payload::jsonb->'maturity') item
  WHERE (item->>'position_observation_id')::bigint = pg_temp.fx('geo_pos_2')
) AND (
  SELECT field->>'raw_value' = '12/2099'
     AND field->>'value_state' = 'REPORTED'
     AND field->>'date_precision' = 'MONTH'
     AND (field->>'normalized_year')::integer = 2099
     AND (field->>'normalized_month')::integer = 12
     AND field->>'normalized_date' IS NULL
  FROM review_case_month, jsonb_array_elements(payload::jsonb->'fields') field
  WHERE (field->>'position_observation_id')::bigint = pg_temp.fx('geo_pos_2')
    AND field->>'field_code' = 'MATURITY_DATE'
));

SELECT pg_temp.check('a month acquisition stays reported and does not become a calendar day', (
  SELECT field->>'raw_value' = '04/2099'
     AND field->>'value_state' = 'REPORTED'
     AND field->>'date_precision' = 'MONTH'
     AND (field->>'normalized_year')::integer = 2099
     AND (field->>'normalized_month')::integer = 4
     AND field->>'normalized_date' IS NULL
     AND field->>'raw_value' IS DISTINCT FROM '2099-04-01'
     AND field->>'raw_value' IS DISTINCT FROM '2099-04-30'
  FROM review_case_month, jsonb_array_elements(payload::jsonb->'fields') field
  WHERE (field->>'position_observation_id')::bigint = pg_temp.fx('geo_pos_2')
    AND field->>'field_code' = 'ACQUISITION_DATE'
));

SELECT pg_temp.check('an existing calendar-day maturity is unchanged', (
  SELECT item->>'maturity_source' = 'REPORTED_STRUCTURED'
     AND item->>'maturity_raw' = '1/2/2099'
  FROM review_case_month, jsonb_array_elements(payload::jsonb->'maturity') item
  WHERE (item->>'position_observation_id')::bigint = pg_temp.fx('geo_pos_1')
) AND (
  SELECT field->>'raw_value' = '1/2/2099'
     AND field->>'date_precision' IS NULL
     AND field->>'normalized_year' IS NULL
     AND field->>'normalized_month' IS NULL
     AND field->>'normalized_date' = '2099-01-02'
  FROM review_case_month, jsonb_array_elements(payload::jsonb->'fields') field
  WHERE (field->>'position_observation_id')::bigint = pg_temp.fx('geo_pos_1')
    AND field->>'field_code' = 'MATURITY_DATE'
));

SELECT pg_temp.check('a member with no maturity field stays unknown', (
  SELECT item->>'maturity_source' = 'UNKNOWN'
     AND item->>'maturity_raw' IS NULL
  FROM review_case_month, jsonb_array_elements(payload::jsonb->'maturity') item
  WHERE (item->>'position_observation_id')::bigint = pg_temp.fx('geo_pos_3')
) AND NOT EXISTS (
  SELECT 1
  FROM review_case_month, jsonb_array_elements(payload::jsonb->'fields') field
  WHERE (field->>'position_observation_id')::bigint = pg_temp.fx('geo_pos_3')
    AND field->>'field_code' IN ('MATURITY_DATE', 'ACQUISITION_DATE')
));

SELECT pg_temp.check('the case reader does not build a calendar day for a month',
  NOT (pg_get_functiondef('registry.review_case_read(text)'::regprocedure) ~ 'make_date|date_trunc|to_date'));
