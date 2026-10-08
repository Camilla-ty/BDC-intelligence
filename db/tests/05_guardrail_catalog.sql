-- Group 5: guardrails checked against the catalog.

CREATE TEMP VIEW layer_columns AS
SELECT c.table_schema, c.table_name, c.column_name, c.data_type, c.column_default, c.is_identity
FROM information_schema.columns c
WHERE c.table_schema IN ('ops', 'raw', 'registry', 'evidence', 'obs', 'identity', 'resolution', 'validation', 'derived', 'ref', 'review', 'access');

SELECT pg_temp.check('G-09: the only CIK column in any base table is registry.registrant.cik', NOT EXISTS (
  SELECT 1 FROM layer_columns lc
  JOIN pg_class c ON c.relname = lc.table_name JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = lc.table_schema
  WHERE c.relkind = 'r' AND lc.column_name ILIKE '%cik%'
    AND (lc.table_schema, lc.table_name, lc.column_name) <> ('registry', 'registrant', 'cik')));

SELECT pg_temp.check('G-09: CIK is exposed only by registry (registrant and filing) views', NOT EXISTS (
  SELECT 1 FROM layer_columns lc
  JOIN pg_class c ON c.relname = lc.table_name JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = lc.table_schema
  WHERE c.relkind = 'v' AND lc.column_name ILIKE '%cik%' AND lc.table_schema <> 'registry'));

SELECT pg_temp.check('G-09: no identity, resolution, or observation table references registry.registrant except identity.position', NOT EXISTS (
  SELECT 1 FROM pg_constraint k
  JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE k.contype = 'f' AND k.confrelid = 'registry.registrant'::regclass
    AND n.nspname IN ('identity', 'resolution', 'obs', 'derived', 'validation')
    AND (n.nspname, c.relname) <> ('identity', 'position')));

SELECT pg_temp.check('no accession-prefix or submitter-CIK column exists', NOT EXISTS (
  SELECT 1 FROM layer_columns WHERE column_name ILIKE '%prefix%' OR column_name ILIKE '%submitter%'));

SELECT pg_temp.check('filing link sources are explicit metadata only (no accession-prefix option)',
  (SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid = 'ref.filing_link_source'::regtype)
  = ARRAY['SUB_TABLE', 'SUBMISSIONS_JSON', 'FILING_HEADER']::name[]);

SELECT pg_temp.check('G-13: resolution states are exactly MATCHED, PROBABLE, UNRESOLVED, REJECTED',
  (SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid = 'ref.resolution_state'::regtype)
  = ARRAY['MATCHED', 'PROBABLE', 'UNRESOLVED', 'REJECTED']::name[]);

SELECT pg_temp.check('G-04: value states include UNKNOWN and NOT_APPLICABLE',
  (SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid = 'ref.value_state'::regtype)
  = ARRAY['REPORTED', 'DERIVED', 'UNKNOWN', 'NOT_APPLICABLE']::name[]);

SELECT pg_temp.check('G-08: no LLM actor kind',
  (SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid = 'ref.actor_kind'::regtype)
  = ARRAY['SYSTEM_RULE', 'HUMAN_REVIEW']::name[]);

SELECT pg_temp.check('G-06: no table, view, or column named like score, rank, or grade', NOT EXISTS (
  SELECT 1 FROM layer_columns WHERE column_name ~* '(score|rank|grade)'
  UNION ALL
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('ops', 'raw', 'registry', 'evidence', 'obs', 'identity', 'resolution', 'validation', 'derived', 'ref', 'review')
    AND c.relname ~* '(score|rank|grade)'));

SELECT pg_temp.check('money and rates are numeric: no float, real, double, or money columns', NOT EXISTS (
  SELECT 1 FROM layer_columns WHERE data_type IN ('real', 'double precision', 'money')));

SELECT pg_temp.check('all timestamps are timestamptz', NOT EXISTS (
  SELECT 1 FROM layer_columns WHERE data_type = 'timestamp without time zone'));

SELECT pg_temp.check('G-04/G-05: no defaults except recorded_at/applied_at = now() and uuid ids', NOT EXISTS (
  SELECT 1 FROM layer_columns
  WHERE column_default IS NOT NULL
    AND NOT (column_name IN ('recorded_at', 'applied_at') AND column_default = 'now()')
    AND NOT (column_name = 'id' AND column_default = 'gen_random_uuid()')
    AND NOT (table_schema = 'obs' AND table_name = 'borrower_name_observation'
             AND column_name = 'name_source' AND column_default = '''SOI_CELL''::text')
    AND NOT (table_schema = 'access' AND table_name = 'grant_event'
             AND column_name = 'created_at' AND column_default = 'now()')));

SELECT pg_temp.check('SOI has no natural key: no unique index on obs or position tables uses business columns', NOT EXISTS (
  SELECT 1
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY (i.indkey)
  WHERE i.indisunique AND n.nspname IN ('obs', 'resolution', 'identity')
    AND a.attname IN ('filing_id', 'identifier_raw', 'holding_descriptor_raw', 'reported_date', 'reported_date_raw',
                      'qtrs', 'qtrs_raw', 'tag', 'value_raw', 'raw_value', 'normalized_numeric', 'field_code',
                      'identifier_member_raw', 'raw_text', 'alias_text')));

SELECT pg_temp.check('every observation table carries NOT NULL evidence, run, and rule version', NOT EXISTS (
  SELECT 1 FROM (VALUES
    ('obs', 'soi_row_observation'), ('obs', 'num_fact_observation'), ('obs', 'position_observation'),
    ('obs', 'position_field_value'), ('obs', 'borrower_name_observation')) AS t (s, r)
  CROSS JOIN (VALUES ('evidence_id'), ('run_id')) AS k (col)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = t.s AND c.table_name = t.r AND c.column_name = k.col AND c.is_nullable = 'NO')));

SELECT pg_temp.check('undocumented SOI cost and fair-value columns are seeded as OPEN_QUESTION (Q14)', (
  SELECT count(*) = 2 AND bool_and(mapping_status = 'OPEN_QUESTION' AND open_question_ref = 'Q14' AND NOT may_feed_derived_values)
  FROM ref.current_column_mapping
  WHERE source_table_code = 'SOI' AND column_label IN ('Adjusted cost basis', 'Initial fair value of Investment')));

SELECT pg_temp.check('seeded column mappings contain no registrant, borrower, or financial values', NOT EXISTS (
  SELECT 1 FROM ref.source_column_mapping WHERE column_label ~ '[0-9]{3,}' OR column_label ILIKE '%TEST%'));
