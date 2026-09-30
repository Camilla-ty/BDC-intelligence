-- 0002 vocabularies: guardrail-fixed enums, extensible reference tables, and the versioned
-- mapping from SOI column labels to product fields, transcribed from docs/SOURCE_SCHEMAS.md.
-- Reference rows describe SEC column labels and our vocabularies only; they contain no
-- registrant, borrower, or financial data.

-- ---------------------------------------------------------------------------
-- Guardrail-fixed vocabularies (enums)
-- ---------------------------------------------------------------------------

-- G-13: exactly these four states.
CREATE TYPE ref.resolution_state AS ENUM ('MATCHED', 'PROBABLE', 'UNRESOLVED', 'REJECTED');

-- G-04: Unknown and Not applicable are first-class values.
CREATE TYPE ref.value_state AS ENUM ('REPORTED', 'DERIVED', 'UNKNOWN', 'NOT_APPLICABLE');

CREATE TYPE ref.mapping_status AS ENUM (
  'DOCUMENTED', 'DOCUMENTED_AND_OBSERVED', 'OBSERVED_UNCONFIRMED', 'OPEN_QUESTION', 'REJECTED');

CREATE TYPE ref.mapping_basis AS ENUM (
  'DOCUMENTED_PRESET', 'DOCUMENTED_SOURCE', 'OBSERVED_VALUE_AGREEMENT', 'OBSERVED_LABEL', 'NONE');

CREATE TYPE ref.mapping_target AS ENUM ('ROW_METADATA', 'POSITION_FIELD', 'RAW_ONLY');

CREATE TYPE ref.evidence_level AS ENUM (
  'L1_STRUCTURED_DATASET', 'L2_ORIGINAL_FILING', 'REGISTRY', 'DISCOVERY');

CREATE TYPE ref.evidence_status AS ENUM (
  'NOT_CHECKED', 'DATASET_ONLY', 'FILING_VERIFIED', 'FILING_MISMATCH', 'UNVERIFIABLE');

CREATE TYPE ref.evidence_role AS ENUM ('SOURCE', 'CORROBORATES', 'CONTRADICTS');

CREATE TYPE ref.locator_type AS ENUM (
  'TSV_ROW', 'TSV_CELL', 'JSON_PATH', 'IXBRL_FACT', 'HTML_ANCHOR', 'DOCUMENT');

-- G-05: coverage is explicit; only COVERED means the source was ingested for the scope.
CREATE TYPE ref.coverage_state AS ENUM (
  'COVERED', 'EMPTY_PERIOD', 'NOT_INGESTED', 'NOT_IN_SCOPE', 'UNKNOWN');

CREATE TYPE ref.parse_status AS ENUM (
  'OK', 'FIELD_COUNT_MISMATCH', 'EMPTY_MEMBER', 'HEADER_MISSING', 'SCHEMA_DRIFT');

CREATE TYPE ref.row_kind AS ENUM ('IDENTIFIER_ROW', 'NO_IDENTIFIER_ROW', 'UNCLASSIFIED');

CREATE TYPE ref.period_role AS ENUM ('CURRENT_PERIOD', 'OTHER_DATE', 'UNRESOLVED');

CREATE TYPE ref.duration_kind AS ENUM ('POINT_IN_TIME', 'DURATION', 'UNKNOWN');

CREATE TYPE ref.currency_state AS ENUM (
  'FROM_FILING', 'FROM_NUM_UNIQUE_MATCH', 'AMBIGUOUS', 'UNKNOWN');

CREATE TYPE ref.scale_state AS ENUM ('KNOWN', 'UNRESOLVED', 'NOT_APPLICABLE');

CREATE TYPE ref.validation_outcome AS ENUM (
  'PASS', 'FAIL', 'NOT_APPLICABLE', 'NOT_EVALUATED', 'ERROR');

-- G-08: there is deliberately no LLM actor.
CREATE TYPE ref.actor_kind AS ENUM ('SYSTEM_RULE', 'HUMAN_REVIEW');

-- Finding: the accession prefix is the submitter, not the registrant. It is not an option.
CREATE TYPE ref.filing_link_source AS ENUM ('SUB_TABLE', 'SUBMISSIONS_JSON', 'FILING_HEADER');

CREATE TYPE ref.source_role AS ENUM ('PRIMARY', 'SUPPORTING');

CREATE TYPE ref.corroboration_outcome AS ENUM (
  'EQUAL', 'NOT_EQUAL', 'NO_CANDIDATE', 'MULTIPLE_CANDIDATES');

CREATE TYPE ref.comparison_outcome AS ENUM ('AGREE', 'DISAGREE', 'UNKNOWN');

-- ---------------------------------------------------------------------------
-- Extensible vocabularies (reference tables)
-- ---------------------------------------------------------------------------

CREATE TABLE ref.source_type (
  code                text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]*$'),
  source_register_id  text NOT NULL CHECK (source_register_id ~ '^S[0-9]+$'),
  description         text NOT NULL
);
COMMENT ON TABLE ref.source_type IS 'Source types; source_register_id refers to the register in docs/SOURCE_SCHEMAS.md.';

INSERT INTO ref.source_type (code, source_register_id, description) VALUES
  ('SEC_BDC_DATASETS_PAGE', 'S1', 'BDC Data Sets page'),
  ('SEC_BDC_README', 'S2', 'BDC data sets readme'),
  ('SEC_BDC_DATASET_ZIP', 'S3', 'BDC data set ZIP archive'),
  ('SEC_BDC_REPORT_CSV', 'S4', 'BDC Report, CSV'),
  ('SEC_BDC_REPORT_XML', 'S4', 'BDC Report, XML'),
  ('SEC_SUBMISSIONS_JSON', 'S5', 'Submissions API JSON for one CIK'),
  ('SEC_FILING_INDEX_JSON', 'S7', 'EDGAR filing folder index.json'),
  ('SEC_FILING_DOCUMENT', 'S7', 'Document inside an EDGAR filing folder'),
  ('SEC_TICKER_FILE', 'S8', 'SEC ticker association file');

CREATE TABLE ref.dataset_table (
  code         text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]*$'),
  description  text NOT NULL
);

INSERT INTO ref.dataset_table (code, description) VALUES
  ('SUB', 'BDC data set submissions table'),
  ('TAG', 'BDC data set tags table'),
  ('NUM', 'BDC data set numbers table'),
  ('TXT', 'BDC data set plain-text table'),
  ('PRE', 'BDC data set presentation table'),
  ('CAL', 'BDC data set calculations table'),
  ('NON', 'BDC data set non-financial-statement filings table'),
  ('SOI', 'BDC data set schedule of investments report'),
  ('BDC_REPORT_CSV', 'BDC Report registry, CSV');

CREATE TABLE ref.field_definition (
  field_code         text PRIMARY KEY CHECK (field_code ~ '^[A-Z][A-Z0-9_]*$'),
  value_type         text NOT NULL CHECK (value_type IN ('NUMERIC', 'DATE', 'TEXT')),
  unit_kind          text NOT NULL CHECK (unit_kind IN ('MONETARY', 'RATE', 'PERCENT', 'DATE', 'TEXT', 'FLAG')),
  level2_required    boolean NOT NULL,
  description        text NOT NULL
);
COMMENT ON COLUMN ref.field_definition.level2_required IS 'True when docs/SOURCE_SCHEMAS.md marks the field "Level 2 extraction required": values stay UNKNOWN in the authority view until Level 2 evidence exists.';

INSERT INTO ref.field_definition (field_code, value_type, unit_kind, level2_required, description) VALUES
  ('INDUSTRY', 'TEXT', 'TEXT', false, 'Industry sector member as disclosed'),
  ('ISSUER_AFFILIATION', 'TEXT', 'TEXT', false, 'Issuer affiliation member as disclosed'),
  ('INSTRUMENT_TYPE', 'TEXT', 'TEXT', false, 'Investment type member as disclosed'),
  ('ISSUER_NAME', 'TEXT', 'TEXT', false, 'Separate issuer-name member, where disclosed'),
  ('INTEREST_RATE', 'NUMERIC', 'RATE', false, 'Rate of interest on investment; whether it is all-in is OPEN QUESTION Q18'),
  ('SPREAD', 'NUMERIC', 'RATE', false, 'Basis spread on variable rate'),
  ('INTEREST_RATE_FLOOR', 'NUMERIC', 'RATE', false, 'Interest rate floor'),
  ('PIK_RATE', 'NUMERIC', 'RATE', false, 'Interest rate paid in kind'),
  ('CASH_RATE', 'NUMERIC', 'RATE', false, 'Interest rate paid in cash'),
  ('REFERENCE_RATE', 'TEXT', 'TEXT', false, 'Variable interest rate type (taxonomy URI as disclosed)'),
  ('MATURITY_DATE', 'DATE', 'DATE', false, 'Investment maturity date'),
  ('ACQUISITION_DATE', 'DATE', 'DATE', false, 'Investment acquisition date'),
  ('PRINCIPAL_AMOUNT', 'NUMERIC', 'MONETARY', false, 'Principal amount; currency only via a NUM join'),
  ('COST', 'NUMERIC', 'MONETARY', false, 'Cost; column semantics are OPEN QUESTION Q14'),
  ('FAIR_VALUE', 'NUMERIC', 'MONETARY', false, 'Fair value; column semantics are OPEN QUESTION Q14'),
  ('PERCENT_OF_NET_ASSETS', 'NUMERIC', 'PERCENT', false, 'Percent of net assets; scale per filer is OPEN QUESTION Q4'),
  ('SENIORITY', 'TEXT', 'TEXT', true, 'Lien or seniority category'),
  ('SECURED', 'TEXT', 'FLAG', true, 'Secured flag'),
  ('NON_ACCRUAL', 'TEXT', 'FLAG', true, 'Non-accrual or performance status'),
  ('RESTRICTED', 'TEXT', 'FLAG', false, 'Restriction status'),
  ('GEOGRAPHY', 'TEXT', 'TEXT', false, 'Geographic region or country member as disclosed'),
  ('FAIR_VALUE_LEVEL', 'TEXT', 'TEXT', false, 'Fair value hierarchy level member as disclosed');

CREATE TABLE ref.registrant_attribute (
  code         text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]*$'),
  description  text NOT NULL
);

INSERT INTO ref.registrant_attribute (code, description) VALUES
  ('NAME', 'Registrant name as disclosed by the source'),
  ('FORMER_NAME', 'Former registrant name'),
  ('FILE_NUMBER', 'SEC file number (for example an 814- number)'),
  ('TICKER', 'Ticker symbol'),
  ('EXCHANGE', 'Exchange');

CREATE TABLE ref.filing_attribute (
  code         text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]*$'),
  description  text NOT NULL
);

INSERT INTO ref.filing_attribute (code, description) VALUES
  ('FORM', 'Form type'),
  ('FILED_DATE', 'EDGAR filing date'),
  ('PERIOD', 'Balance-sheet date, rounded to month end by the source'),
  ('FISCAL_YEAR', 'Fiscal year focus'),
  ('FISCAL_PERIOD', 'Fiscal period focus'),
  ('ACCEPTED_AT', 'EDGAR acceptance date-time'),
  ('PREVRPT', 'SUB prevrpt flag, raw only (OPEN QUESTION Q17)'),
  ('INLINE_URL', 'Inline XBRL viewer URL as disclosed'),
  ('PRIMARY_DOCUMENT_NAME', 'Primary document file name'),
  ('REPORT_DATE', 'Submissions reportDate; meaning not documented');

-- ---------------------------------------------------------------------------
-- Versioned source-column mappings (Q14, Q16 live here)
-- ---------------------------------------------------------------------------

CREATE TABLE ref.source_column_mapping (
  id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_table_code        text NOT NULL REFERENCES ref.dataset_table (code),
  column_label             text NOT NULL CHECK (column_label <> ''),
  mapping_target           ref.mapping_target NOT NULL,
  field_code               text REFERENCES ref.field_definition (field_code),
  mapping_basis            ref.mapping_basis NOT NULL,
  mapping_status           ref.mapping_status NOT NULL,
  open_question_ref        text CHECK (open_question_ref ~ '^Q[0-9]+$'),
  source_schema_reference  text NOT NULL CHECK (btrim(source_schema_reference) <> ''),
  rule_version_id          bigint NOT NULL REFERENCES ops.rule_version (id),
  recorded_by              text NOT NULL CHECK (btrim(recorded_by) <> ''),
  supersedes_id            bigint REFERENCES ref.source_column_mapping (id),
  supersede_reason         text,
  recorded_at              timestamptz NOT NULL DEFAULT now(),
  CHECK ((mapping_target = 'POSITION_FIELD') = (field_code IS NOT NULL)),
  CHECK (mapping_status <> 'OPEN_QUESTION' OR open_question_ref IS NOT NULL),
  CHECK (mapping_status NOT IN ('DOCUMENTED', 'DOCUMENTED_AND_OBSERVED')
         OR mapping_basis IN ('DOCUMENTED_PRESET', 'DOCUMENTED_SOURCE'))
);
COMMENT ON TABLE ref.source_column_mapping IS 'Which source column feeds which field, and on what basis. Only DOCUMENTED and DOCUMENTED_AND_OBSERVED mappings may feed derived values.';

SELECT ops.add_supersession('ref.source_column_mapping', 'source_table_code,column_label,field_code', 'single_chain');

-- SECURITY DEFINER so view readers (who have no base-table access) can evaluate authority.
CREATE FUNCTION ref.current_mapping_status(mapping_id bigint) RETURNS ref.mapping_status
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT head.mapping_status
  FROM ref.source_column_mapping m
  JOIN ref.source_column_mapping head
    ON (head.source_table_code, head.column_label, head.field_code)
       IS NOT DISTINCT FROM (m.source_table_code, m.column_label, m.field_code)
  WHERE m.id = mapping_id
    AND NOT EXISTS (SELECT 1 FROM ref.source_column_mapping s WHERE s.supersedes_id = head.id)
$$;
COMMENT ON FUNCTION ref.current_mapping_status(bigint) IS 'Status of the current (non-superseded) mapping in the same chain as mapping_id.';

WITH seed_rule AS (
  INSERT INTO ops.rule_version (rule_code, rule_kind, version, definition_sha256, spec_reference, description, created_by)
  VALUES (
    'mapping.soi_columns', 'MAPPING', '1',
    encode(sha256(convert_to('mapping.soi_columns v1: docs/SOURCE_SCHEMAS.md sections 5.1, 5.4, 12', 'UTF8')), 'hex'),
    'docs/SOURCE_SCHEMAS.md sections 5.1, 5.4, 12',
    'Initial SOI column mappings transcribed from the Phase 0.2 source-schema documentation',
    'migration 0002_vocabularies')
  RETURNING id
)
INSERT INTO ref.source_column_mapping
  (source_table_code, column_label, mapping_target, field_code, mapping_basis, mapping_status,
   open_question_ref, source_schema_reference, rule_version_id, recorded_by)
SELECT 'SOI', v.column_label, v.mapping_target::ref.mapping_target, v.field_code,
       v.mapping_basis::ref.mapping_basis, v.mapping_status::ref.mapping_status,
       v.open_question_ref, v.source_schema_reference, seed_rule.id, 'migration 0002_vocabularies'
FROM seed_rule
CROSS JOIN (VALUES
  -- Preset columns (documented in the readme SOI figure; observed in every sampled file)
  ('adsh', 'ROW_METADATA', NULL, 'DOCUMENTED_PRESET', 'DOCUMENTED_AND_OBSERVED', NULL, 'SOURCE_SCHEMAS 5.1'),
  ('cik', 'ROW_METADATA', NULL, 'DOCUMENTED_PRESET', 'DOCUMENTED_AND_OBSERVED', NULL, 'SOURCE_SCHEMAS 5.1'),
  ('name', 'ROW_METADATA', NULL, 'DOCUMENTED_PRESET', 'DOCUMENTED_AND_OBSERVED', NULL, 'SOURCE_SCHEMAS 5.1'),
  ('ddate', 'ROW_METADATA', NULL, 'DOCUMENTED_PRESET', 'DOCUMENTED_AND_OBSERVED', NULL, 'SOURCE_SCHEMAS 5.1, 5.5'),
  ('qtrs', 'ROW_METADATA', NULL, 'DOCUMENTED_PRESET', 'DOCUMENTED_AND_OBSERVED', NULL, 'SOURCE_SCHEMAS 5.1, 5.6'),
  ('form', 'ROW_METADATA', NULL, 'DOCUMENTED_PRESET', 'DOCUMENTED_AND_OBSERVED', NULL, 'SOURCE_SCHEMAS 5.1'),
  ('filed', 'ROW_METADATA', NULL, 'DOCUMENTED_PRESET', 'DOCUMENTED_AND_OBSERVED', NULL, 'SOURCE_SCHEMAS 5.1'),
  ('period', 'ROW_METADATA', NULL, 'DOCUMENTED_PRESET', 'DOCUMENTED_AND_OBSERVED', NULL, 'SOURCE_SCHEMAS 5.1, 5.5'),
  ('inlineurl', 'ROW_METADATA', NULL, 'DOCUMENTED_PRESET', 'DOCUMENTED_AND_OBSERVED', NULL, 'SOURCE_SCHEMAS 5.1, 8'),
  ('cstm', 'RAW_ONLY', NULL, 'DOCUMENTED_PRESET', 'OPEN_QUESTION', 'Q19', 'SOURCE_SCHEMAS 5.7, 14'),
  ('Industry Sector Axis', 'POSITION_FIELD', 'INDUSTRY', 'DOCUMENTED_PRESET', 'DOCUMENTED_AND_OBSERVED', NULL, 'SOURCE_SCHEMAS 5.1, 12'),
  ('Investment, Identifier Axis', 'ROW_METADATA', NULL, 'DOCUMENTED_PRESET', 'DOCUMENTED_AND_OBSERVED', NULL, 'SOURCE_SCHEMAS 5.1, 5.3'),
  ('Investment, Issuer Affiliation Axis', 'POSITION_FIELD', 'ISSUER_AFFILIATION', 'DOCUMENTED_PRESET', 'DOCUMENTED_AND_OBSERVED', NULL, 'SOURCE_SCHEMAS 5.1, 12'),
  ('Investment Type Axis', 'POSITION_FIELD', 'INSTRUMENT_TYPE', 'DOCUMENTED_PRESET', 'DOCUMENTED_AND_OBSERVED', NULL, 'SOURCE_SCHEMAS 5.1, 12'),
  ('Investment Interest Rate', 'POSITION_FIELD', 'INTEREST_RATE', 'DOCUMENTED_PRESET', 'DOCUMENTED_AND_OBSERVED', NULL, 'SOURCE_SCHEMAS 5.1, 5.4, 12'),
  ('Investment, Basis Spread, Variable Rate', 'POSITION_FIELD', 'SPREAD', 'DOCUMENTED_PRESET', 'DOCUMENTED_AND_OBSERVED', NULL, 'SOURCE_SCHEMAS 5.1, 5.4, 12'),
  ('Investment Maturity Date', 'POSITION_FIELD', 'MATURITY_DATE', 'DOCUMENTED_PRESET', 'DOCUMENTED_AND_OBSERVED', NULL, 'SOURCE_SCHEMAS 5.1, 12'),
  ('Investment Owned, Balance, Principal Amount', 'POSITION_FIELD', 'PRINCIPAL_AMOUNT', 'DOCUMENTED_PRESET', 'DOCUMENTED_AND_OBSERVED', NULL, 'SOURCE_SCHEMAS 5.1, 5.4, 12'),
  ('Investment Owned, Cost', 'POSITION_FIELD', 'COST', 'DOCUMENTED_PRESET', 'DOCUMENTED', NULL, 'SOURCE_SCHEMAS 5.1, 5.4 (essentially empty)'),
  ('Investment Owned, Fair Value', 'POSITION_FIELD', 'FAIR_VALUE', 'DOCUMENTED_PRESET', 'DOCUMENTED', NULL, 'SOURCE_SCHEMAS 5.1, 5.4 (essentially empty)'),
  ('Investment Owned, Net Assets, Percentage', 'POSITION_FIELD', 'PERCENT_OF_NET_ASSETS', 'DOCUMENTED_PRESET', 'DOCUMENTED_AND_OBSERVED', NULL, 'SOURCE_SCHEMAS 5.1, 5.4, 12'),
  -- Dynamic columns: values agree with standard cost and fair-value facts, but the labels are undocumented (Q14)
  ('Adjusted cost basis', 'POSITION_FIELD', 'COST', 'OBSERVED_VALUE_AGREEMENT', 'OPEN_QUESTION', 'Q14', 'SOURCE_SCHEMAS 5.4, 12'),
  ('Initial fair value of Investment', 'POSITION_FIELD', 'FAIR_VALUE', 'OBSERVED_VALUE_AGREEMENT', 'OPEN_QUESTION', 'Q14', 'SOURCE_SCHEMAS 5.4, 12'),
  -- Other dynamic columns named in the availability matrix (observed labels only)
  ('Investment, Issuer Name Axis', 'POSITION_FIELD', 'ISSUER_NAME', 'OBSERVED_LABEL', 'OBSERVED_UNCONFIRMED', NULL, 'SOURCE_SCHEMAS 5.3, 12'),
  ('Investment, Interest Rate, Floor', 'POSITION_FIELD', 'INTEREST_RATE_FLOOR', 'OBSERVED_LABEL', 'OBSERVED_UNCONFIRMED', NULL, 'SOURCE_SCHEMAS 12'),
  ('Investment, Interest Rate, Paid in Kind', 'POSITION_FIELD', 'PIK_RATE', 'OBSERVED_LABEL', 'OBSERVED_UNCONFIRMED', NULL, 'SOURCE_SCHEMAS 12'),
  ('Investment, Interest Rate, Paid in Cash', 'POSITION_FIELD', 'CASH_RATE', 'OBSERVED_LABEL', 'OBSERVED_UNCONFIRMED', NULL, 'SOURCE_SCHEMAS 12'),
  ('Investment, Variable Interest Rate, Type [Extensible Enumeration]', 'POSITION_FIELD', 'REFERENCE_RATE', 'OBSERVED_LABEL', 'OBSERVED_UNCONFIRMED', NULL, 'SOURCE_SCHEMAS 12'),
  ('Investment, Acquisition Date', 'POSITION_FIELD', 'ACQUISITION_DATE', 'OBSERVED_LABEL', 'OBSERVED_UNCONFIRMED', NULL, 'SOURCE_SCHEMAS 12'),
  ('Lien Category Axis', 'POSITION_FIELD', 'SENIORITY', 'OBSERVED_LABEL', 'OBSERVED_UNCONFIRMED', NULL, 'SOURCE_SCHEMAS 12 (Level 2 extraction required)'),
  ('Financial Instrument Performance Status Axis', 'POSITION_FIELD', 'NON_ACCRUAL', 'OBSERVED_LABEL', 'OBSERVED_UNCONFIRMED', NULL, 'SOURCE_SCHEMAS 12 (Level 2 extraction required)'),
  ('Investment, Restriction Status [true false]', 'POSITION_FIELD', 'RESTRICTED', 'OBSERVED_LABEL', 'OBSERVED_UNCONFIRMED', NULL, 'SOURCE_SCHEMAS 12'),
  ('Geographical Axis', 'POSITION_FIELD', 'GEOGRAPHY', 'OBSERVED_LABEL', 'OBSERVED_UNCONFIRMED', NULL, 'SOURCE_SCHEMAS 12'),
  ('Investment, Issuer Geographic Region [Extensible Enumeration]', 'POSITION_FIELD', 'GEOGRAPHY', 'OBSERVED_LABEL', 'OBSERVED_UNCONFIRMED', NULL, 'SOURCE_SCHEMAS 12'),
  ('Fair Value Hierarchy and NAV Axis', 'POSITION_FIELD', 'FAIR_VALUE_LEVEL', 'OBSERVED_LABEL', 'OBSERVED_UNCONFIRMED', NULL, 'SOURCE_SCHEMAS 12')
) AS v (column_label, mapping_target, field_code, mapping_basis, mapping_status, open_question_ref, source_schema_reference);

SELECT ops.apply_append_only_to_all();
