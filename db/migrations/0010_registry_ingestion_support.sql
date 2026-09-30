-- 0010 registry ingestion support (Phase 2: BDC master registry and filing history).
-- Forward-only: earlier migrations are not edited. Everything here supports loading the SEC
-- Data Sets page, the BDC Report page and its 2020-2026 CSVs, data set SUB rows, and the
-- submissions JSON (main file and additional pages) with full provenance.
--
-- Integrity added here, enforced in the database rather than trusted from the loader:
--   * JSON bodies are stored verbatim (checksum equals the artifact) and flattened by the
--     database into raw.json_value, so every JSON_PATH evidence resolves to a stored value.
--   * raw_value columns must equal the located source value (TSV cell or JSON value) (G-11).
--   * Filing-to-registrant links backed by a cell or JSON value must name the registrant CIK
--     explicitly (SUB cik cell, or the CIK in the submissions URL); never the accession prefix.
--   * Coverage carries an aspect; FILING_HISTORY coverage is per registrant (G-05).

-- ---------------------------------------------------------------------------
-- Vocabularies
-- ---------------------------------------------------------------------------

INSERT INTO ref.source_type (code, source_register_id, description) VALUES
  ('SEC_BDC_REPORT_PAGE', 'S4', 'BDC Report page listing the yearly files'),
  ('SEC_SUBMISSIONS_PAGE_JSON', 'S5', 'Additional submissions JSON page named in filings.files[]');

INSERT INTO ref.registrant_attribute (code, description) VALUES
  ('ADDRESS_LINE_1', 'Address line 1 as disclosed'),
  ('ADDRESS_LINE_2', 'Address line 2 as disclosed'),
  ('CITY', 'City as disclosed'),
  ('STATE', 'State as disclosed'),
  ('ZIP_CODE', 'ZIP code as disclosed'),
  ('BDC_REPORT_LAST_FILING_DATE', 'BDC Report "Date Last Filing", raw only (two-digit year)'),
  ('BDC_REPORT_LAST_FILING_TYPE', 'BDC Report "Type Last Filing"'),
  ('FISCAL_YEAR_END', 'Submissions fiscalYearEnd (observed key)'),
  ('STATE_OF_INCORPORATION', 'Submissions stateOfIncorporation (observed key)'),
  ('BDC_REPORT_LISTING', 'Presence in a BDC Report year; the raw value is the page link-text year');

INSERT INTO ref.filing_attribute (code, description) VALUES
  ('FILE_NUMBER', 'Submissions fileNumber for the filing (observed key)'),
  ('PRIMARY_DOC_DESCRIPTION', 'Submissions primaryDocDescription (observed key)'),
  ('IS_XBRL', 'Submissions isXBRL flag, raw only (observed key)'),
  ('IS_INLINE_XBRL', 'Submissions isInlineXBRL flag, raw only (observed key)'),
  ('REGISTRANT_NAME_AS_FILED', 'SUB name: registrant name as of the filing date');

CREATE TABLE ref.coverage_aspect (
  code         text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]*$'),
  description  text NOT NULL
);

INSERT INTO ref.coverage_aspect (code, description) VALUES
  ('FILING_METADATA', 'Filing metadata (SUB) of a data set release, release-wide or per registrant'),
  ('FILING_HISTORY', 'Complete submissions filing history of one registrant (main file and every additional page)');

-- Which source field feeds which registry target, and its documentation status (G-01).
-- Observed fields are loaded at the source's evidence level but never labeled documented.
CREATE TABLE ref.registry_field_mapping (
  id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_type_code         text NOT NULL REFERENCES ref.source_type (code),
  source_field             text NOT NULL CHECK (btrim(source_field) <> ''),
  target_kind              text NOT NULL CHECK (target_kind IN (
                             'REGISTRANT', 'REGISTRANT_ATTRIBUTE', 'NAME_HISTORY', 'FILING', 'FILING_LINK',
                             'FILING_ATTRIBUTE', 'FILING_DOCUMENT', 'RELEASE', 'REPORT_EDITION', 'PAGINATION', 'RAW_ONLY')),
  target_code              text,
  mapping_status           ref.mapping_status NOT NULL CHECK (mapping_status IN ('DOCUMENTED_AND_OBSERVED', 'OBSERVED_UNCONFIRMED')),
  source_schema_reference  text NOT NULL CHECK (btrim(source_schema_reference) <> ''),
  recorded_by              text NOT NULL CHECK (btrim(recorded_by) <> ''),
  recorded_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (source_type_code, source_field, target_kind, target_code),
  CHECK ((target_kind IN ('REGISTRANT_ATTRIBUTE', 'FILING_ATTRIBUTE')) = (target_code IS NOT NULL))
);
COMMENT ON TABLE ref.registry_field_mapping IS 'Source field to registry target with its documentation status (docs/SOURCE_SCHEMAS.md section 7.2). source_field is the column label, the JSON path with indexes replaced by [*], or "link" for page anchors.';

INSERT INTO ref.registry_field_mapping (source_type_code, source_field, target_kind, target_code, mapping_status, source_schema_reference, recorded_by)
SELECT v.s, v.f, v.k, v.c, v.m::ref.mapping_status, v.r, 'migration 0010_registry_ingestion_support'
FROM (VALUES
  ('SEC_BDC_DATASETS_PAGE', 'link', 'RELEASE', NULL, 'OBSERVED_UNCONFIRMED', 'SOURCE_SCHEMAS 3.2, 7.2'),
  ('SEC_BDC_REPORT_PAGE', 'link', 'REPORT_EDITION', NULL, 'OBSERVED_UNCONFIRMED', 'SOURCE_SCHEMAS 6.1, 7.2'),
  ('SEC_BDC_REPORT_CSV', 'CIK', 'REGISTRANT', NULL, 'DOCUMENTED_AND_OBSERVED', 'SOURCE_SCHEMAS 6, 7.2'),
  ('SEC_BDC_REPORT_CSV', 'File_No', 'REGISTRANT_ATTRIBUTE', 'FILE_NUMBER', 'DOCUMENTED_AND_OBSERVED', 'SOURCE_SCHEMAS 6, 7.2'),
  ('SEC_BDC_REPORT_CSV', 'Registrant_Name', 'REGISTRANT_ATTRIBUTE', 'NAME', 'DOCUMENTED_AND_OBSERVED', 'SOURCE_SCHEMAS 6, 7.2'),
  ('SEC_BDC_REPORT_CSV', 'Address_1', 'REGISTRANT_ATTRIBUTE', 'ADDRESS_LINE_1', 'DOCUMENTED_AND_OBSERVED', 'SOURCE_SCHEMAS 6, 7.2'),
  ('SEC_BDC_REPORT_CSV', 'Address_2', 'REGISTRANT_ATTRIBUTE', 'ADDRESS_LINE_2', 'DOCUMENTED_AND_OBSERVED', 'SOURCE_SCHEMAS 6, 7.2'),
  ('SEC_BDC_REPORT_CSV', 'City', 'REGISTRANT_ATTRIBUTE', 'CITY', 'DOCUMENTED_AND_OBSERVED', 'SOURCE_SCHEMAS 6, 7.2'),
  ('SEC_BDC_REPORT_CSV', 'State', 'REGISTRANT_ATTRIBUTE', 'STATE', 'DOCUMENTED_AND_OBSERVED', 'SOURCE_SCHEMAS 6, 7.2'),
  ('SEC_BDC_REPORT_CSV', 'Zip_Code', 'REGISTRANT_ATTRIBUTE', 'ZIP_CODE', 'DOCUMENTED_AND_OBSERVED', 'SOURCE_SCHEMAS 6, 7.2'),
  ('SEC_BDC_REPORT_CSV', 'Filing Date', 'REGISTRANT_ATTRIBUTE', 'BDC_REPORT_LAST_FILING_DATE', 'DOCUMENTED_AND_OBSERVED', 'SOURCE_SCHEMAS 6, 7.2'),
  ('SEC_BDC_REPORT_CSV', 'Filing Type', 'REGISTRANT_ATTRIBUTE', 'BDC_REPORT_LAST_FILING_TYPE', 'DOCUMENTED_AND_OBSERVED', 'SOURCE_SCHEMAS 6, 7.2'),
  ('SEC_BDC_REPORT_CSV', 'row', 'REGISTRANT_ATTRIBUTE', 'BDC_REPORT_LISTING', 'DOCUMENTED_AND_OBSERVED', 'SOURCE_SCHEMAS 6.1, 7.2'),
  ('SEC_BDC_DATASET_ZIP', 'adsh', 'FILING', NULL, 'DOCUMENTED_AND_OBSERVED', 'SOURCE_SCHEMAS 4.1, 7.2'),
  ('SEC_BDC_DATASET_ZIP', 'cik', 'REGISTRANT', NULL, 'DOCUMENTED_AND_OBSERVED', 'SOURCE_SCHEMAS 4.1, 7.2'),
  ('SEC_BDC_DATASET_ZIP', 'cik', 'FILING_LINK', NULL, 'DOCUMENTED_AND_OBSERVED', 'SOURCE_SCHEMAS 4.1, 7.2'),
  ('SEC_BDC_DATASET_ZIP', 'name', 'FILING_ATTRIBUTE', 'REGISTRANT_NAME_AS_FILED', 'DOCUMENTED_AND_OBSERVED', 'SOURCE_SCHEMAS 4.1, 7.2'),
  ('SEC_BDC_DATASET_ZIP', 'form', 'FILING_ATTRIBUTE', 'FORM', 'DOCUMENTED_AND_OBSERVED', 'SOURCE_SCHEMAS 4.1, 7.2'),
  ('SEC_BDC_DATASET_ZIP', 'period', 'FILING_ATTRIBUTE', 'PERIOD', 'DOCUMENTED_AND_OBSERVED', 'SOURCE_SCHEMAS 4.1, 7.2'),
  ('SEC_BDC_DATASET_ZIP', 'fy', 'FILING_ATTRIBUTE', 'FISCAL_YEAR', 'DOCUMENTED_AND_OBSERVED', 'SOURCE_SCHEMAS 4.1, 7.2'),
  ('SEC_BDC_DATASET_ZIP', 'fp', 'FILING_ATTRIBUTE', 'FISCAL_PERIOD', 'DOCUMENTED_AND_OBSERVED', 'SOURCE_SCHEMAS 4.1, 7.2'),
  ('SEC_BDC_DATASET_ZIP', 'filed', 'FILING_ATTRIBUTE', 'FILED_DATE', 'DOCUMENTED_AND_OBSERVED', 'SOURCE_SCHEMAS 4.1, 7.2'),
  ('SEC_BDC_DATASET_ZIP', 'accepted', 'FILING_ATTRIBUTE', 'ACCEPTED_AT', 'DOCUMENTED_AND_OBSERVED', 'SOURCE_SCHEMAS 4.1, 7.2'),
  ('SEC_BDC_DATASET_ZIP', 'prevrpt', 'FILING_ATTRIBUTE', 'PREVRPT', 'DOCUMENTED_AND_OBSERVED', 'SOURCE_SCHEMAS 4.1, 7.2, 11'),
  ('SEC_BDC_DATASET_ZIP', 'inlineurl', 'FILING_ATTRIBUTE', 'INLINE_URL', 'DOCUMENTED_AND_OBSERVED', 'SOURCE_SCHEMAS 4.1, 7.2'),
  ('SEC_BDC_DATASET_ZIP', 'fileNumber', 'RAW_ONLY', NULL, 'OBSERVED_UNCONFIRMED', 'SOURCE_SCHEMAS 4.1, 7.2'),
  ('SEC_SUBMISSIONS_JSON', '$."cik"', 'REGISTRANT', NULL, 'OBSERVED_UNCONFIRMED', 'SOURCE_SCHEMAS 7, 7.2'),
  ('SEC_SUBMISSIONS_JSON', '$."name"', 'REGISTRANT_ATTRIBUTE', 'NAME', 'OBSERVED_UNCONFIRMED', 'SOURCE_SCHEMAS 7, 7.2'),
  ('SEC_SUBMISSIONS_JSON', '$."formerNames"[*]."name"', 'NAME_HISTORY', NULL, 'OBSERVED_UNCONFIRMED', 'SOURCE_SCHEMAS 7, 7.2'),
  ('SEC_SUBMISSIONS_JSON', '$."tickers"[*]', 'REGISTRANT_ATTRIBUTE', 'TICKER', 'OBSERVED_UNCONFIRMED', 'SOURCE_SCHEMAS 7, 7.2'),
  ('SEC_SUBMISSIONS_JSON', '$."exchanges"[*]', 'REGISTRANT_ATTRIBUTE', 'EXCHANGE', 'OBSERVED_UNCONFIRMED', 'SOURCE_SCHEMAS 7, 7.2'),
  ('SEC_SUBMISSIONS_JSON', '$."fiscalYearEnd"', 'REGISTRANT_ATTRIBUTE', 'FISCAL_YEAR_END', 'OBSERVED_UNCONFIRMED', 'SOURCE_SCHEMAS 7, 7.2'),
  ('SEC_SUBMISSIONS_JSON', '$."stateOfIncorporation"', 'REGISTRANT_ATTRIBUTE', 'STATE_OF_INCORPORATION', 'OBSERVED_UNCONFIRMED', 'SOURCE_SCHEMAS 7, 7.2'),
  ('SEC_SUBMISSIONS_JSON', '$."filings"."files"[*]."name"', 'PAGINATION', NULL, 'OBSERVED_UNCONFIRMED', 'SOURCE_SCHEMAS 7.1, 7.2'),
  ('SEC_SUBMISSIONS_JSON', '$."filings"."files"[*]."filingCount"', 'PAGINATION', NULL, 'OBSERVED_UNCONFIRMED', 'SOURCE_SCHEMAS 7.1, 7.2')
) AS v (s, f, k, c, m, r);

-- The filing columns are identical in the main file (under filings.recent) and in the pages (top level).
INSERT INTO ref.registry_field_mapping (source_type_code, source_field, target_kind, target_code, mapping_status, source_schema_reference, recorded_by)
SELECT st.code, st.base || '"' || v.field || '"[*]', v.k, v.c, 'OBSERVED_UNCONFIRMED', 'SOURCE_SCHEMAS 7, 7.1, 7.2',
       'migration 0010_registry_ingestion_support'
FROM (VALUES ('SEC_SUBMISSIONS_JSON', '$."filings"."recent".'), ('SEC_SUBMISSIONS_PAGE_JSON', '$.')) AS st (code, base)
CROSS JOIN (VALUES
  ('accessionNumber', 'FILING', NULL),
  ('accessionNumber', 'FILING_LINK', NULL),
  ('filingDate', 'FILING_ATTRIBUTE', 'FILED_DATE'),
  ('form', 'FILING_ATTRIBUTE', 'FORM'),
  ('reportDate', 'FILING_ATTRIBUTE', 'REPORT_DATE'),
  ('acceptanceDateTime', 'FILING_ATTRIBUTE', 'ACCEPTED_AT'),
  ('fileNumber', 'FILING_ATTRIBUTE', 'FILE_NUMBER'),
  ('primaryDocument', 'FILING_ATTRIBUTE', 'PRIMARY_DOCUMENT_NAME'),
  ('primaryDocument', 'FILING_DOCUMENT', NULL),
  ('primaryDocDescription', 'FILING_ATTRIBUTE', 'PRIMARY_DOC_DESCRIPTION'),
  ('isXBRL', 'FILING_ATTRIBUTE', 'IS_XBRL'),
  ('isInlineXBRL', 'FILING_ATTRIBUTE', 'IS_INLINE_XBRL')
) AS v (field, k, c);

-- ---------------------------------------------------------------------------
-- Raw JSON: verbatim body plus a database-computed flattening
-- ---------------------------------------------------------------------------

CREATE TABLE raw.json_document (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  artifact_id  bigint NOT NULL UNIQUE REFERENCES raw.artifact (id),
  body         text NOT NULL,
  run_id       bigint NOT NULL REFERENCES ops.run (id),
  recorded_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE raw.json_document IS 'A JSON artifact body exactly as received (UTF-8 text whose SHA-256 equals the artifact checksum).';

CREATE TABLE raw.json_value (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  json_document_id  bigint NOT NULL REFERENCES raw.json_document (id),
  artifact_id       bigint NOT NULL REFERENCES raw.artifact (id),
  json_path         text NOT NULL CHECK (json_path ~ '^\$'),
  container_path    text,
  array_index       integer CHECK (array_index >= 0),
  value_type        text NOT NULL CHECK (value_type IN ('object', 'array', 'string', 'number', 'boolean', 'null')),
  value_text        text,
  run_id            bigint NOT NULL REFERENCES ops.run (id),
  recorded_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (artifact_id, json_path),
  CHECK ((value_type IN ('object', 'array', 'null')) = (value_text IS NULL)),
  CHECK ((json_path = '$') = (container_path IS NULL))
);
COMMENT ON TABLE raw.json_value IS 'Every node of a raw.json_document, written only by the database flattening trigger. json_path is an SQL/JSON path with quoted keys and 0-based indexes.';
CREATE INDEX json_value_container_idx ON raw.json_value (artifact_id, container_path, array_index);

CREATE FUNCTION raw.check_json_document() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM raw.artifact a
    WHERE a.id = NEW.artifact_id
      AND a.sha256 = encode(sha256(convert_to(NEW.body, 'UTF8')), 'hex')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1', MESSAGE = 'json_document body must hash to its artifact sha256';
  END IF;
  PERFORM NEW.body::jsonb;
  RETURN NEW;
END
$$;

CREATE TRIGGER check_json_document BEFORE INSERT ON raw.json_document
  FOR EACH ROW EXECUTE FUNCTION raw.check_json_document();

CREATE FUNCTION raw.flatten_json_document() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  INSERT INTO raw.json_value (json_document_id, artifact_id, json_path, container_path, array_index, value_type, value_text, run_id)
  WITH RECURSIVE node (json_path, container_path, array_index, v) AS (
    SELECT '$'::text, NULL::text, NULL::integer, NEW.body::jsonb
    UNION ALL
    SELECT c.json_path, n.json_path, c.array_index, c.v
    FROM node n
    CROSS JOIN LATERAL (
      SELECT n.json_path || '.' || to_jsonb(o.key)::text AS json_path, NULL::integer AS array_index, o.value AS v
      FROM jsonb_each(CASE WHEN jsonb_typeof(n.v) = 'object' THEN n.v END) AS o
      UNION ALL
      SELECT n.json_path || '[' || (a.ord - 1) || ']', (a.ord - 1)::integer, a.value
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(n.v) = 'array' THEN n.v END) WITH ORDINALITY AS a (value, ord)
    ) AS c
  )
  SELECT NEW.id, NEW.artifact_id, node.json_path, node.container_path, node.array_index, jsonb_typeof(node.v),
         CASE WHEN jsonb_typeof(node.v) IN ('object', 'array', 'null') THEN NULL ELSE node.v #>> '{}' END,
         NEW.run_id
  FROM node;
  RETURN NULL;
END
$$;

CREATE TRIGGER flatten_json_document AFTER INSERT ON raw.json_document
  FOR EACH ROW EXECUTE FUNCTION raw.flatten_json_document();

CREATE FUNCTION raw.check_json_value() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'raw.json_value rows are written only by the raw.json_document flattening trigger';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER check_json_value BEFORE INSERT ON raw.json_value
  FOR EACH ROW EXECUTE FUNCTION raw.check_json_value();

-- Facts from one source stream supersede each other; different streams coexist side by side.
-- The submissions main file and its pages form one stream per registrant CIK in the URL.
CREATE FUNCTION raw.source_stream(p_artifact_id bigint) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT CASE
           WHEN a.source_type_code IN ('SEC_SUBMISSIONS_JSON', 'SEC_SUBMISSIONS_PAGE_JSON')
             THEN 'submissions:' || substring(a.source_url FROM '/submissions/CIK([0-9]{10})')
           ELSE a.source_url
         END
  FROM raw.artifact a WHERE a.id = p_artifact_id
$$;

-- ---------------------------------------------------------------------------
-- Evidence: member-level documents, page anchors, and located values
-- ---------------------------------------------------------------------------

ALTER TABLE evidence.evidence ADD COLUMN artifact_member_id bigint;
ALTER TABLE evidence.evidence
  ADD CONSTRAINT evidence_artifact_member_fkey
  FOREIGN KEY (artifact_member_id, artifact_id) REFERENCES raw.artifact_member (id, artifact_id);
COMMENT ON COLUMN evidence.evidence.artifact_member_id IS 'For DOCUMENT evidence about one archive member (for example a whole SUB table).';

ALTER TABLE evidence.evidence DROP CONSTRAINT evidence_locator_fields;
ALTER TABLE evidence.evidence ADD CONSTRAINT evidence_locator_fields CHECK (
  CASE locator_type
    WHEN 'TSV_ROW' THEN tabular_row_id IS NOT NULL
      AND num_nonnulls(column_position, column_label, json_path, ixbrl_fact_id, html_anchor, artifact_member_id) = 0
    WHEN 'TSV_CELL' THEN tabular_row_id IS NOT NULL AND column_position IS NOT NULL AND column_label IS NOT NULL
      AND num_nonnulls(json_path, ixbrl_fact_id, html_anchor, artifact_member_id) = 0
    WHEN 'JSON_PATH' THEN json_path IS NOT NULL
      AND num_nonnulls(tabular_row_id, column_position, column_label, ixbrl_fact_id, html_anchor, artifact_member_id) = 0
    WHEN 'IXBRL_FACT' THEN ixbrl_fact_id IS NOT NULL
      AND num_nonnulls(tabular_row_id, column_position, column_label, json_path, html_anchor, artifact_member_id) = 0
    WHEN 'HTML_ANCHOR' THEN html_anchor IS NOT NULL
      AND num_nonnulls(tabular_row_id, column_position, column_label, json_path, ixbrl_fact_id, artifact_member_id) = 0
    WHEN 'DOCUMENT' THEN
      num_nonnulls(tabular_row_id, column_position, column_label, json_path, ixbrl_fact_id, html_anchor) = 0
  END);

ALTER TABLE evidence.evidence DROP CONSTRAINT evidence_level_locator;
ALTER TABLE evidence.evidence ADD CONSTRAINT evidence_level_locator CHECK (
  CASE evidence_level
    WHEN 'L1_STRUCTURED_DATASET' THEN locator_type IN ('TSV_ROW', 'TSV_CELL')
      OR (locator_type = 'DOCUMENT' AND artifact_member_id IS NOT NULL)
    WHEN 'L2_ORIGINAL_FILING' THEN locator_type IN ('IXBRL_FACT', 'HTML_ANCHOR', 'DOCUMENT')
    WHEN 'REGISTRY' THEN locator_type IN ('TSV_ROW', 'TSV_CELL', 'JSON_PATH', 'HTML_ANCHOR', 'DOCUMENT')
    WHEN 'DISCOVERY' THEN locator_type IN ('JSON_PATH', 'HTML_ANCHOR', 'DOCUMENT')
  END);

CREATE OR REPLACE FUNCTION evidence.check_evidence() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tabular_row_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM raw.tabular_row r JOIN raw.table_load tl ON tl.id = r.table_load_id
    WHERE r.id = NEW.tabular_row_id AND tl.artifact_id = NEW.artifact_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1', MESSAGE = 'evidence tabular_row_id must belong to evidence artifact_id';
  END IF;
  IF NEW.column_position IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM raw.tabular_row r JOIN raw.table_load tl ON tl.id = r.table_load_id
    WHERE r.id = NEW.tabular_row_id AND tl.header[NEW.column_position] = NEW.column_label
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1', MESSAGE = 'evidence column_label must equal the header label at column_position';
  END IF;
  -- Level 1 JSON paths are left to the level/locator CHECK so that error stays a check violation.
  IF NEW.locator_type = 'JSON_PATH' AND NEW.evidence_level IN ('REGISTRY', 'DISCOVERY') AND NOT EXISTS (
    SELECT 1 FROM raw.json_value v WHERE v.artifact_id = NEW.artifact_id AND v.json_path = NEW.json_path
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1', MESSAGE = 'evidence json_path must resolve to a stored raw.json_value of the artifact';
  END IF;
  RETURN NEW;
END
$$;

-- The value a TSV_CELL or JSON_PATH evidence points at; checkable is false for other locators.
CREATE FUNCTION evidence.located_value(p_evidence_id bigint, OUT checkable boolean, OUT value text)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  e evidence.evidence;
BEGIN
  SELECT * INTO e FROM evidence.evidence WHERE id = p_evidence_id;
  checkable := e.locator_type IN ('TSV_CELL', 'JSON_PATH');
  IF e.locator_type = 'TSV_CELL' THEN
    SELECT r.cells[e.column_position] INTO value FROM raw.tabular_row r WHERE r.id = e.tabular_row_id;
  ELSIF e.locator_type = 'JSON_PATH' THEN
    SELECT v.value_text INTO value FROM raw.json_value v WHERE v.artifact_id = e.artifact_id AND v.json_path = e.json_path;
  END IF;
END
$$;

CREATE FUNCTION evidence.source_field(p_locator ref.locator_type, p_column_label text, p_json_path text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_locator
           WHEN 'TSV_CELL' THEN p_column_label
           WHEN 'TSV_ROW' THEN 'row'
           WHEN 'JSON_PATH' THEN regexp_replace(p_json_path, '\[[0-9]+\]', '[*]', 'g')
           WHEN 'HTML_ANCHOR' THEN 'link'
         END
$$;
COMMENT ON FUNCTION evidence.source_field(ref.locator_type, text, text) IS 'Key into ref.registry_field_mapping.source_field for an evidence location.';

-- ---------------------------------------------------------------------------
-- Located-value integrity on registry facts (G-11)
--   TG_ARGV[0]: the claimed column; TG_ARGV[1]: 'exact' (text equality) or 'cik' (numeric).
-- Only TSV_CELL and JSON_PATH evidence can be checked; other locators pass unchanged.
-- ---------------------------------------------------------------------------

CREATE FUNCTION registry.check_located_value() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  claimed text := to_jsonb(NEW) ->> TG_ARGV[0];
  mode text := TG_ARGV[1];
  loc record;
BEGIN
  SELECT * INTO loc FROM evidence.located_value(NEW.evidence_id);
  IF loc.checkable IS NOT TRUE THEN
    RETURN NEW;
  END IF;
  IF mode = 'cik' THEN
    IF loc.value IS NULL OR loc.value !~ '^[0-9]{1,10}$' OR loc.value::bigint <> claimed::bigint THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = format('%I.%I.%s must equal the CIK at its evidence location', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_ARGV[0]);
    END IF;
  ELSIF loc.value IS DISTINCT FROM claimed THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = format('%I.%I.%s must equal the value at its evidence location', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_ARGV[0]);
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER check_located_value BEFORE INSERT ON registry.registrant
  FOR EACH ROW EXECUTE FUNCTION registry.check_located_value('cik', 'cik');
CREATE TRIGGER check_located_value BEFORE INSERT ON registry.filing
  FOR EACH ROW EXECUTE FUNCTION registry.check_located_value('accession_number', 'exact');
CREATE TRIGGER check_located_value BEFORE INSERT ON registry.registrant_attribute_observation
  FOR EACH ROW EXECUTE FUNCTION registry.check_located_value('raw_value', 'exact');
CREATE TRIGGER check_located_value BEFORE INSERT ON registry.filing_attribute_observation
  FOR EACH ROW EXECUTE FUNCTION registry.check_located_value('raw_value', 'exact');

-- A link backed by a cell or JSON value must name the registrant explicitly: the SUB cik cell of
-- the filing's own row, or an accessionNumber entry in the submissions file of that CIK.
CREATE FUNCTION registry.check_filing_registrant_link() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  e evidence.evidence;
  a raw.artifact;
  reg_cik bigint;
  acc text;
  ok boolean;
BEGIN
  SELECT * INTO e FROM evidence.evidence WHERE id = NEW.evidence_id;
  IF e.locator_type IS NULL OR e.locator_type NOT IN ('TSV_CELL', 'JSON_PATH') THEN
    RETURN NEW;
  END IF;
  SELECT * INTO a FROM raw.artifact WHERE id = e.artifact_id;
  SELECT cik INTO reg_cik FROM registry.registrant WHERE id = NEW.registrant_id;
  SELECT accession_number INTO acc FROM registry.filing WHERE id = NEW.filing_id;

  IF e.locator_type = 'TSV_CELL' THEN
    SELECT NEW.link_source = 'SUB_TABLE' AND tl.table_code = 'SUB' AND e.column_label = 'cik'
           AND r.cells[e.column_position] ~ '^[0-9]{1,10}$' AND r.cells[e.column_position]::bigint = reg_cik
           AND r.cells[array_position(tl.header, 'adsh')] = acc
      INTO ok
    FROM raw.tabular_row r JOIN raw.table_load tl ON tl.id = r.table_load_id
    WHERE r.id = e.tabular_row_id;
  ELSE
    SELECT NEW.link_source = 'SUBMISSIONS_JSON'
           AND a.source_type_code IN ('SEC_SUBMISSIONS_JSON', 'SEC_SUBMISSIONS_PAGE_JSON')
           AND substring(a.source_url FROM '/submissions/CIK([0-9]{10})')::bigint = reg_cik
           AND e.json_path ~ '"accessionNumber"\[[0-9]+\]$'
           AND v.value_text = acc
      INTO ok
    FROM raw.json_value v
    WHERE v.artifact_id = e.artifact_id AND v.json_path = e.json_path;
  END IF;

  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'filing_registrant_link evidence must name this registrant CIK explicitly for this accession (SUB cik cell or submissions file of that CIK)';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER check_filing_registrant_link BEFORE INSERT ON registry.filing_registrant_link
  FOR EACH ROW EXECUTE FUNCTION registry.check_filing_registrant_link();

-- A submissions primaryDocument URL is built from the registrant CIK in the submissions URL,
-- the accession without dashes, and the document name (SOURCE_SCHEMAS section 8).
CREATE UNIQUE INDEX filing_document_named_once ON registry.filing_document (filing_id, document_name, named_by);

CREATE FUNCTION registry.check_filing_document() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  e evidence.evidence;
  ok boolean;
BEGIN
  SELECT * INTO e FROM evidence.evidence WHERE id = NEW.evidence_id;
  IF NEW.named_by IS DISTINCT FROM 'SUBMISSIONS_PRIMARY_DOCUMENT' OR e.locator_type IS DISTINCT FROM 'JSON_PATH' THEN
    RETURN NEW;
  END IF;
  SELECT v.value_text = NEW.document_name
         AND e.json_path ~ '"primaryDocument"\[[0-9]+\]$'
         AND NEW.document_url = format('https://www.sec.gov/Archives/edgar/data/%s/%s/%s',
               substring(a.source_url FROM '/submissions/CIK([0-9]{10})')::bigint,
               replace(f.accession_number, '-', ''), NEW.document_name)
    INTO ok
  FROM raw.json_value v
  JOIN raw.artifact a ON a.id = v.artifact_id
  CROSS JOIN registry.filing f
  WHERE v.artifact_id = e.artifact_id AND v.json_path = e.json_path AND f.id = NEW.filing_id;
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'submissions primary document name and URL must match the evidence value, registrant CIK, and accession';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER check_filing_document BEFORE INSERT ON registry.filing_document
  FOR EACH ROW EXECUTE FUNCTION registry.check_filing_document();

-- A release backed by a page anchor must be the ZIP named by that anchor, with the
-- filing-date window implied by its label (SOURCE_SCHEMAS 3.2, 3.6).
CREATE FUNCTION registry.check_dataset_release() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  e evidence.evidence;
  y integer := substring(NEW.release_label FROM 1 FOR 4)::integer;
  start_date date;
BEGIN
  SELECT * INTO e FROM evidence.evidence WHERE id = NEW.evidence_id;
  IF e.locator_type IS DISTINCT FROM 'HTML_ANCHOR' THEN
    RETURN NEW;
  END IF;
  start_date := CASE WHEN NEW.cadence = 'QUARTERLY'
                     THEN make_date(y, (substring(NEW.release_label FROM 6 FOR 1)::integer - 1) * 3 + 1, 1)
                     ELSE make_date(y, substring(NEW.release_label FROM 6 FOR 2)::integer, 1) END;
  IF e.html_anchor !~ ('/' || NEW.release_label || '_bdc\.zip$')
     OR NEW.window_start <> start_date
     OR NEW.window_end <> (start_date + CASE WHEN NEW.cadence = 'QUARTERLY' THEN interval '3 months' ELSE interval '1 month' END - interval '1 day')::date
  THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'dataset_release must match its page anchor and the filing-date window implied by the label';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER check_dataset_release BEFORE INSERT ON registry.dataset_release
  FOR EACH ROW EXECUTE FUNCTION registry.check_dataset_release();

-- ---------------------------------------------------------------------------
-- Page listings and name history
-- ---------------------------------------------------------------------------

CREATE FUNCTION evidence.assert_anchor_on_artifact(p_evidence_id bigint, p_artifact_id bigint, p_href text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM evidence.evidence e
    WHERE e.id = p_evidence_id AND e.artifact_id = p_artifact_id
      AND e.locator_type = 'HTML_ANCHOR' AND e.html_anchor = p_href
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1', MESSAGE = 'evidence must be the HTML anchor with this href on this page artifact';
  END IF;
END
$$;

CREATE TABLE registry.dataset_release_listing (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dataset_release_id  bigint NOT NULL REFERENCES registry.dataset_release (id),
  page_artifact_id    bigint NOT NULL REFERENCES raw.artifact (id),
  link_href           text NOT NULL CHECK (link_href ~ '^/files/.+_bdc\.zip$'),
  link_text           text NOT NULL,
  evidence_id         bigint NOT NULL REFERENCES evidence.evidence (id),
  rule_version_id     bigint NOT NULL REFERENCES ops.rule_version (id),
  run_id              bigint NOT NULL REFERENCES ops.run (id),
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dataset_release_id, page_artifact_id)
);
COMMENT ON TABLE registry.dataset_release_listing IS 'Each Data Sets page retrieval that listed a release. A release absent from a later page retrieval stays recorded.';

CREATE FUNCTION registry.check_dataset_release_listing() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM evidence.assert_anchor_on_artifact(NEW.evidence_id, NEW.page_artifact_id, NEW.link_href);
  IF NOT EXISTS (
    SELECT 1 FROM registry.dataset_release r
    WHERE r.id = NEW.dataset_release_id AND NEW.link_href ~ ('/' || r.release_label || '_bdc\.zip$')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1', MESSAGE = 'listing href must name the release label';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER check_dataset_release_listing BEFORE INSERT ON registry.dataset_release_listing
  FOR EACH ROW EXECUTE FUNCTION registry.check_dataset_release_listing();

CREATE TABLE registry.bdc_report_edition (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  page_artifact_id    bigint NOT NULL REFERENCES raw.artifact (id),
  link_href           text NOT NULL CHECK (link_href ~ '^/files/.+\.csv$'),
  csv_url             text NOT NULL,
  year_label_raw      text NOT NULL,
  report_year         integer CHECK (report_year BETWEEN 1990 AND 2999),
  updated_label_raw   text,
  evidence_id         bigint NOT NULL REFERENCES evidence.evidence (id),
  rule_version_id     bigint NOT NULL REFERENCES ops.rule_version (id),
  run_id              bigint NOT NULL REFERENCES ops.run (id),
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (page_artifact_id, link_href),
  CHECK (csv_url = 'https://www.sec.gov' || link_href),
  CHECK ((report_year IS NOT NULL) = (year_label_raw ~ '^[0-9]{4}$')),
  CHECK (report_year IS NULL OR report_year = year_label_raw::integer)
);
COMMENT ON TABLE registry.bdc_report_edition IS 'Each BDC Report CSV link on one page retrieval. The year comes from the link text, never from the file name (SOURCE_SCHEMAS 6.1).';
COMMENT ON COLUMN registry.bdc_report_edition.updated_label_raw IS 'The adjacent "Updated" text exactly as shown; not normalized.';

CREATE FUNCTION registry.check_bdc_report_edition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM evidence.assert_anchor_on_artifact(NEW.evidence_id, NEW.page_artifact_id, NEW.link_href);
  RETURN NEW;
END
$$;

CREATE TRIGGER check_bdc_report_edition BEFORE INSERT ON registry.bdc_report_edition
  FOR EACH ROW EXECUTE FUNCTION registry.check_bdc_report_edition();

CREATE TABLE registry.registrant_name_history_observation (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  registrant_id     bigint NOT NULL REFERENCES registry.registrant (id),
  name_raw          text NOT NULL,
  from_raw          text,
  to_raw            text,
  rule_version_id   bigint NOT NULL REFERENCES ops.rule_version (id),
  run_id            bigint NOT NULL REFERENCES ops.run (id),
  evidence_id       bigint NOT NULL REFERENCES evidence.evidence (id),
  supersedes_id     bigint REFERENCES registry.registrant_name_history_observation (id),
  supersede_reason  text,
  recorded_at       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE registry.registrant_name_history_observation IS 'One former-name entry as disclosed. from/to are raw text only: their time zone meaning is OPEN QUESTION Q22.';
SELECT ops.add_supersession('registry.registrant_name_history_observation', 'registrant_id', 'multi');

CREATE TRIGGER check_located_value BEFORE INSERT ON registry.registrant_name_history_observation
  FOR EACH ROW EXECUTE FUNCTION registry.check_located_value('name_raw', 'exact');

CREATE FUNCTION registry.check_name_history_siblings() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  e evidence.evidence;
BEGIN
  SELECT * INTO e FROM evidence.evidence WHERE id = NEW.evidence_id;
  IF e.locator_type IS DISTINCT FROM 'JSON_PATH' THEN
    RETURN NEW;
  END IF;
  IF e.json_path !~ '"name"$'
     OR NEW.from_raw IS DISTINCT FROM (SELECT v.value_text FROM raw.json_value v
                                        WHERE v.artifact_id = e.artifact_id AND v.json_path = regexp_replace(e.json_path, '"name"$', '"from"'))
     OR NEW.to_raw IS DISTINCT FROM (SELECT v.value_text FROM raw.json_value v
                                      WHERE v.artifact_id = e.artifact_id AND v.json_path = regexp_replace(e.json_path, '"name"$', '"to"'))
  THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1', MESSAGE = 'name history from/to must equal the sibling values of the evidence entry';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER check_name_history_siblings BEFORE INSERT ON registry.registrant_name_history_observation
  FOR EACH ROW EXECUTE FUNCTION registry.check_name_history_siblings();

-- ---------------------------------------------------------------------------
-- Artifact processing ledger (idempotent, offline rebuilds)
-- ---------------------------------------------------------------------------

CREATE TABLE ops.artifact_processing (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  artifact_id      bigint NOT NULL REFERENCES raw.artifact (id),
  rule_version_id  bigint NOT NULL REFERENCES ops.rule_version (id),
  outcome          text NOT NULL CHECK (outcome IN ('LOADED', 'SCHEMA_DRIFT', 'NOT_IN_SCOPE')),
  detail           text NOT NULL CHECK (btrim(detail) <> ''),
  counts           jsonb NOT NULL,
  run_id           bigint NOT NULL REFERENCES ops.run (id),
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (artifact_id, rule_version_id)
);
COMMENT ON TABLE ops.artifact_processing IS 'One processing of one artifact by one loader version; reprocessing the same artifact with the same loader is a no-op.';

-- ---------------------------------------------------------------------------
-- Coverage aspect (G-05)
-- ---------------------------------------------------------------------------

ALTER TABLE ops.coverage_assertion ADD COLUMN coverage_aspect text NOT NULL REFERENCES ref.coverage_aspect (code);
ALTER TABLE ops.coverage_assertion DROP CONSTRAINT coverage_assertion_check;
ALTER TABLE ops.coverage_assertion ADD CONSTRAINT coverage_assertion_scope CHECK (
  num_nonnulls(dataset_release_id, reporting_period_end) >= 1
  OR (coverage_aspect = 'FILING_HISTORY' AND registrant_id IS NOT NULL));

DROP TRIGGER check_supersession ON ops.coverage_assertion;
CREATE TRIGGER check_supersession BEFORE INSERT ON ops.coverage_assertion FOR EACH ROW
  EXECUTE FUNCTION ops.check_supersession(
    'registrant_id,dataset_release_id,reporting_period_end,source_type_code,coverage_aspect', 'single_chain');

CREATE OR REPLACE VIEW ops.current_coverage AS
SELECT c.id AS coverage_assertion_id, c.registrant_id, c.dataset_release_id, c.reporting_period_end,
       c.source_type_code, c.coverage_state, c.evidence_id, c.rule_version_id, c.recorded_at,
       (c.coverage_state = 'COVERED') AS is_covered,
       c.coverage_aspect
FROM ops.coverage_assertion c
WHERE NOT EXISTS (SELECT 1 FROM ops.coverage_assertion s WHERE s.supersedes_id = c.id);

-- ---------------------------------------------------------------------------
-- Integrity views (not product read models)
-- ---------------------------------------------------------------------------

CREATE VIEW registry.current_registrant_attribute AS
SELECT o.id AS observation_id, o.registrant_id, r.cik, o.attribute_code, o.raw_value, o.normalized_value,
       o.source_as_of, a.source_type_code, raw.source_stream(a.id) AS source_stream, e.evidence_level,
       m.mapping_status AS documentation_status, o.evidence_id, o.rule_version_id, o.run_id
FROM registry.registrant_attribute_observation o
JOIN registry.registrant r ON r.id = o.registrant_id
JOIN evidence.evidence e ON e.id = o.evidence_id
JOIN raw.artifact a ON a.id = e.artifact_id
LEFT JOIN ref.registry_field_mapping m
  ON m.source_type_code = a.source_type_code
 AND m.source_field = evidence.source_field(e.locator_type, e.column_label, e.json_path)
 AND m.target_kind = 'REGISTRANT_ATTRIBUTE' AND m.target_code = o.attribute_code
WHERE NOT EXISTS (SELECT 1 FROM registry.registrant_attribute_observation s WHERE s.supersedes_id = o.id);
COMMENT ON VIEW registry.current_registrant_attribute IS 'Every current registrant attribute value per source, with its documentation status. Sources are never merged.';

-- One row per registrant and attribute; UNKNOWN when no source reports it (G-04).
CREATE VIEW registry.registrant_attribute_status AS
SELECT r.id AS registrant_id, r.cik, ra.code AS attribute_code,
       count(c.observation_id) AS current_value_count,
       count(DISTINCT c.raw_value) AS distinct_raw_value_count,
       CASE WHEN count(c.observation_id) = 0 THEN 'UNKNOWN'
            WHEN count(DISTINCT c.raw_value) > 1 THEN 'MULTIPLE_VALUES'
            ELSE 'REPORTED' END AS attribute_state
FROM registry.registrant r
CROSS JOIN ref.registrant_attribute ra
LEFT JOIN registry.current_registrant_attribute c ON c.registrant_id = r.id AND c.attribute_code = ra.code
GROUP BY r.id, r.cik, ra.code;

CREATE VIEW registry.current_registrant_name_history AS
SELECT h.id AS observation_id, h.registrant_id, r.cik, h.name_raw, h.from_raw, h.to_raw,
       raw.source_stream(e.artifact_id) AS source_stream, h.evidence_id, h.rule_version_id, h.run_id
FROM registry.registrant_name_history_observation h
JOIN registry.registrant r ON r.id = h.registrant_id
JOIN evidence.evidence e ON e.id = h.evidence_id
WHERE NOT EXISTS (SELECT 1 FROM registry.registrant_name_history_observation s WHERE s.supersedes_id = h.id);

CREATE VIEW registry.current_filing_attribute AS
SELECT o.id AS observation_id, o.filing_id, f.accession_number, o.attribute_code, o.raw_value, o.value_state,
       o.normalized_text, o.normalized_date, o.normalized_timestamp, a.source_type_code,
       raw.source_stream(a.id) AS source_stream, e.evidence_level,
       m.mapping_status AS documentation_status, o.evidence_id, o.rule_version_id, o.run_id
FROM registry.filing_attribute_observation o
JOIN registry.filing f ON f.id = o.filing_id
JOIN evidence.evidence e ON e.id = o.evidence_id
JOIN raw.artifact a ON a.id = e.artifact_id
LEFT JOIN ref.registry_field_mapping m
  ON m.source_type_code = a.source_type_code
 AND m.source_field = evidence.source_field(e.locator_type, e.column_label, e.json_path)
 AND m.target_kind = 'FILING_ATTRIBUTE' AND m.target_code = o.attribute_code
WHERE NOT EXISTS (SELECT 1 FROM registry.filing_attribute_observation s WHERE s.supersedes_id = o.id);
COMMENT ON VIEW registry.current_filing_attribute IS 'Every current filing attribute value per source, side by side. Disagreements stay visible.';

CREATE VIEW registry.filing_history AS
SELECT fr.filing_id, fr.accession_number, fr.registrant_id, fr.cik, fr.registrant_link_status,
       (SELECT array_agg(DISTINCT c.normalized_text ORDER BY c.normalized_text) FROM registry.current_filing_attribute c
         WHERE c.filing_id = fr.filing_id AND c.attribute_code = 'FORM' AND c.normalized_text IS NOT NULL) AS forms,
       (SELECT array_agg(DISTINCT c.normalized_date ORDER BY c.normalized_date) FROM registry.current_filing_attribute c
         WHERE c.filing_id = fr.filing_id AND c.attribute_code = 'FILED_DATE' AND c.normalized_date IS NOT NULL) AS filed_dates,
       (SELECT array_agg(DISTINCT c.source_type_code ORDER BY c.source_type_code) FROM registry.current_filing_attribute c
         WHERE c.filing_id = fr.filing_id) AS source_types,
       rel.state AS amends_decision_state
FROM registry.current_filing_registrant fr
LEFT JOIN registry.current_filing_relationship rel
  ON rel.filing_id = fr.filing_id AND rel.relationship_type = 'AMENDS';
COMMENT ON VIEW registry.filing_history IS 'Filings per registrant from explicit links; forms and filing dates as reported by each source (several values mean the sources disagree).';

CREATE VIEW registry.filing_file_number AS
SELECT c.filing_id, c.accession_number, c.raw_value AS file_number_raw, (c.raw_value ~ '^814-') AS is_814_file_number,
       c.source_stream, c.evidence_id
FROM registry.current_filing_attribute c
WHERE c.attribute_code = 'FILE_NUMBER';

CREATE VIEW registry.bdc_report_edition_status AS
SELECT ed.id AS edition_id, ed.page_artifact_id, ed.csv_url, ed.year_label_raw, ed.report_year, ed.updated_label_raw,
       csv.artifact_id AS csv_artifact_id, csv.outcome AS load_outcome, csv.detail AS load_detail,
       coalesce(csv.outcome, 'NOT_RETRIEVED') AS edition_state
FROM registry.bdc_report_edition ed
LEFT JOIN LATERAL (
  SELECT a.id AS artifact_id, p.outcome, p.detail
  FROM raw.artifact a
  LEFT JOIN ops.artifact_processing p ON p.artifact_id = a.id
  WHERE a.source_url = ed.csv_url
  ORDER BY a.retrieved_at DESC, a.id DESC, p.id DESC
  LIMIT 1
) csv ON true;
COMMENT ON VIEW registry.bdc_report_edition_status IS 'Each listed BDC Report CSV and whether its latest retrieval was LOADED, recorded as SCHEMA_DRIFT or NOT_IN_SCOPE, or not retrieved.';

CREATE VIEW registry.dataset_release_status AS
SELECT dr.id AS dataset_release_id, dr.release_label, dr.cadence, dr.window_start, dr.window_end,
       (SELECT count(*) FROM registry.dataset_release_artifact x WHERE x.dataset_release_id = dr.id) AS artifact_count,
       (SELECT count(*) FROM registry.dataset_release_listing l WHERE l.dataset_release_id = dr.id) AS page_listing_count,
       coalesce(cov.coverage_state, 'UNKNOWN'::ref.coverage_state) AS filing_metadata_coverage,
       coalesce(cov.is_covered, false) AS is_covered
FROM registry.dataset_release dr
LEFT JOIN ops.current_coverage cov
  ON cov.dataset_release_id = dr.id AND cov.registrant_id IS NULL
 AND cov.coverage_aspect = 'FILING_METADATA' AND cov.source_type_code = 'SEC_BDC_DATASET_ZIP';

CREATE VIEW registry.registrant_coverage AS
SELECT r.id AS registrant_id, r.cik,
       coalesce(h.coverage_state, 'UNKNOWN'::ref.coverage_state) AS filing_history_coverage,
       (SELECT count(*) FROM ops.current_coverage c
         WHERE c.registrant_id = r.id AND c.coverage_aspect = 'FILING_METADATA' AND c.is_covered) AS covered_release_count
FROM registry.registrant r
LEFT JOIN ops.current_coverage h
  ON h.registrant_id = r.id AND h.coverage_aspect = 'FILING_HISTORY' AND h.dataset_release_id IS NULL
 AND h.reporting_period_end IS NULL AND h.source_type_code = 'SEC_SUBMISSIONS_JSON';
COMMENT ON VIEW registry.registrant_coverage IS 'Filing-history coverage per registrant. UNKNOWN when never asserted; only COVERED means the full history was loaded.';

-- ---------------------------------------------------------------------------
-- Lookup indexes for incremental loads (current-row and per-artifact lookups)
-- ---------------------------------------------------------------------------

CREATE INDEX evidence_artifact_idx ON evidence.evidence (artifact_id);
CREATE INDEX registrant_attribute_observation_subject_idx ON registry.registrant_attribute_observation (registrant_id, attribute_code);
CREATE INDEX registrant_name_history_observation_subject_idx ON registry.registrant_name_history_observation (registrant_id);
CREATE INDEX filing_attribute_observation_subject_idx ON registry.filing_attribute_observation (filing_id, attribute_code);
CREATE INDEX filing_registrant_link_filing_idx ON registry.filing_registrant_link (filing_id);
CREATE INDEX filing_relationship_decision_filing_idx ON registry.filing_relationship_decision (filing_id, relationship_type);
CREATE INDEX coverage_assertion_registrant_idx ON ops.coverage_assertion (registrant_id);
CREATE INDEX coverage_assertion_release_idx ON ops.coverage_assertion (dataset_release_id);
CREATE INDEX validation_result_subject_idx ON validation.validation_result (subject_table, subject_id);
CREATE INDEX supplementary_evidence_subject_idx ON evidence.supplementary_evidence (subject_table, subject_id);

-- ---------------------------------------------------------------------------
-- Privileges: the 0009 policy as a reusable function, applied to the new objects
-- ---------------------------------------------------------------------------

CREATE FUNCTION ops.grant_layer_privileges() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  s text;
  t record;
BEGIN
  FOR t IN
    SELECT n.nspname, c.relname, c.relkind
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('ops', 'raw', 'registry', 'evidence', 'obs', 'identity',
                        'resolution', 'validation', 'derived', 'ref')
      AND c.relkind IN ('r', 'v')
  LOOP
    EXECUTE format('REVOKE ALL ON %I.%I FROM PUBLIC', t.nspname, t.relname);
    IF t.relkind = 'v' THEN
      EXECUTE format('GRANT SELECT ON %I.%I TO bdc_pipeline_writer, bdc_reader', t.nspname, t.relname);
    ELSIF t.nspname = 'ref' THEN
      EXECUTE format('GRANT SELECT ON %I.%I TO bdc_pipeline_writer', t.nspname, t.relname);
    ELSIF (t.nspname, t.relname) IN (('ops', 'schema_migration'), ('ops', 'rule_activation')) THEN
      NULL;
    ELSE
      EXECUTE format('GRANT SELECT, INSERT ON %I.%I TO bdc_pipeline_writer', t.nspname, t.relname);
    END IF;
  END LOOP;

  FOREACH s IN ARRAY ARRAY['ops', 'raw', 'registry', 'evidence', 'obs', 'identity',
                           'resolution', 'validation', 'derived'] LOOP
    EXECUTE format('GRANT USAGE ON ALL SEQUENCES IN SCHEMA %I TO bdc_pipeline_writer', s);
  END LOOP;
END
$$;
COMMENT ON FUNCTION ops.grant_layer_privileges() IS 'Writer: SELECT and INSERT on history tables, SELECT on ref; reader: SELECT on views only. Call from every migration that creates tables or views.';

SELECT ops.grant_layer_privileges();

SELECT ops.apply_append_only_to_all();
