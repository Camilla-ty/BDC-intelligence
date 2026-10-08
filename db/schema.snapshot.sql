CREATE SCHEMA access;

COMMENT ON SCHEMA access IS 'Application authorization. Append-only ADMIN and PRO grants keyed by Supabase Auth user id. Not the identity layer.';

CREATE SCHEMA admin;

COMMENT ON SCHEMA admin IS 'Admin Filing read models. Views only. SELECT granted to admin_reader alone.';

CREATE SCHEMA derived;

COMMENT ON SCHEMA derived IS 'Values computed by versioned deterministic rules, with their exact inputs.';

CREATE SCHEMA evidence;

COMMENT ON SCHEMA evidence IS 'Locations inside source artifacts that support each fact.';

CREATE SCHEMA identity;

COMMENT ON SCHEMA identity IS 'Stable identifiers for legal entities, economic groups, instruments, positions. No facts.';

CREATE SCHEMA obs;

COMMENT ON SCHEMA obs IS 'Typed observations projected from raw rows. Rows are never merged.';

CREATE SCHEMA ops;

COMMENT ON SCHEMA ops IS 'Runs, rule versions, migrations, audit events, coverage assertions.';

CREATE SCHEMA raw;

COMMENT ON SCHEMA raw IS 'Lossless landing of source bytes and rows, before any interpretation.';

CREATE SCHEMA ref;

COMMENT ON SCHEMA ref IS 'Controlled vocabularies and versioned source-column mappings.';

CREATE SCHEMA registry;

COMMENT ON SCHEMA registry IS 'SEC registrants, filings, filing documents, dataset releases.';

CREATE SCHEMA resolution;

COMMENT ON SCHEMA resolution IS 'Versioned identity decisions (MATCHED, PROBABLE, UNRESOLVED, REJECTED) and candidates.';

CREATE SCHEMA review;

COMMENT ON SCHEMA review IS 'Research cases, source citations, researcher notes, and evidence sets. Not identity resolution.';

CREATE SCHEMA validation;

COMMENT ON SCHEMA validation IS 'Validation results and evidence-status assertions.';

CREATE TYPE access.grant_action AS ENUM (
    'GRANT',
    'REVOKE'
);

CREATE TYPE access.grant_kind AS ENUM (
    'ADMIN',
    'PRO'
);

CREATE TYPE access.grant_source AS ENUM (
    'BOOTSTRAP',
    'OPERATOR',
    'SUBSCRIPTION'
);

CREATE TYPE obs.soi_fact_member_role AS ENUM (
    'BALANCE',
    'SPREAD',
    'PIK'
);

CREATE TYPE ops.rule_kind AS ENUM (
    'PARSER',
    'NORMALIZATION',
    'CLASSIFICATION',
    'GROUPING',
    'EQUIVALENCE',
    'MAPPING',
    'EXTRACTION',
    'VALIDATION',
    'RESOLUTION',
    'DERIVATION',
    'COVERAGE',
    'REVIEW_PROCEDURE'
);

CREATE TYPE ops.run_status AS ENUM (
    'STARTED',
    'SUCCEEDED',
    'FAILED',
    'ABORTED'
);

CREATE TYPE ops.unknown_input_policy AS ENUM (
    'REJECT_UNKNOWN_INPUTS',
    'PROPAGATE_UNKNOWN'
);

CREATE TYPE ref.actor_kind AS ENUM (
    'SYSTEM_RULE',
    'HUMAN_REVIEW'
);

CREATE TYPE ref.comparison_outcome AS ENUM (
    'AGREE',
    'DISAGREE',
    'UNKNOWN'
);

CREATE TYPE ref.corroboration_outcome AS ENUM (
    'EQUAL',
    'NOT_EQUAL',
    'NO_CANDIDATE',
    'MULTIPLE_CANDIDATES'
);

CREATE TYPE ref.coverage_state AS ENUM (
    'COVERED',
    'EMPTY_PERIOD',
    'NOT_INGESTED',
    'NOT_IN_SCOPE',
    'UNKNOWN'
);

CREATE TYPE ref.currency_state AS ENUM (
    'FROM_FILING',
    'FROM_NUM_UNIQUE_MATCH',
    'AMBIGUOUS',
    'UNKNOWN'
);

CREATE TYPE ref.duration_kind AS ENUM (
    'POINT_IN_TIME',
    'DURATION',
    'UNKNOWN'
);

CREATE TYPE ref.evidence_level AS ENUM (
    'L1_STRUCTURED_DATASET',
    'L2_ORIGINAL_FILING',
    'REGISTRY',
    'DISCOVERY'
);

CREATE TYPE ref.evidence_role AS ENUM (
    'SOURCE',
    'CORROBORATES',
    'CONTRADICTS'
);

CREATE TYPE ref.evidence_status AS ENUM (
    'NOT_CHECKED',
    'DATASET_ONLY',
    'FILING_VERIFIED',
    'FILING_MISMATCH',
    'UNVERIFIABLE'
);

CREATE TYPE ref.filing_link_source AS ENUM (
    'SUB_TABLE',
    'SUBMISSIONS_JSON',
    'FILING_HEADER'
);

CREATE TYPE ref.locator_type AS ENUM (
    'TSV_ROW',
    'TSV_CELL',
    'JSON_PATH',
    'IXBRL_FACT',
    'HTML_ANCHOR',
    'DOCUMENT',
    'DISCLOSURE_BLOCK',
    'HTML_TABLE_CELL',
    'HTML_COLUMN_HEADING'
);

CREATE TYPE ref.mapping_basis AS ENUM (
    'DOCUMENTED_PRESET',
    'DOCUMENTED_SOURCE',
    'OBSERVED_VALUE_AGREEMENT',
    'OBSERVED_LABEL',
    'NONE'
);

CREATE TYPE ref.mapping_status AS ENUM (
    'DOCUMENTED',
    'DOCUMENTED_AND_OBSERVED',
    'OBSERVED_UNCONFIRMED',
    'OPEN_QUESTION',
    'REJECTED'
);

CREATE TYPE ref.mapping_target AS ENUM (
    'ROW_METADATA',
    'POSITION_FIELD',
    'RAW_ONLY'
);

CREATE TYPE ref.maturity_inspection_state AS ENUM (
    'FILING_DISPLAYED',
    'UNAVAILABLE',
    'UNRESOLVED',
    'NOT_BOUND',
    'FILING_MONTH'
);

CREATE TYPE ref.maturity_no_bind_reason AS ENUM (
    'NO_MATCH',
    'MULTIPLE_ROWS',
    'SHARED_ROW',
    'CONTEXT_NOT_SINGLE_ROW',
    'NO_COMPARABLE_FIELD',
    'NO_REPORTED_DATE'
);

CREATE TYPE ref.maturity_provenance_state AS ENUM (
    'REPORTED_STRUCTURED',
    'FILING_DISPLAYED',
    'UNAVAILABLE',
    'UNKNOWN',
    'UNRESOLVED',
    'FILING_MONTH',
    'REPORTED_MONTH'
);

COMMENT ON TYPE ref.maturity_provenance_state IS 'Source of the product maturity. Since 0025, UNAVAILABLE is not produced: an UNAVAILABLE inspection with no structured date is UNKNOWN, and inspection_state carries UNAVAILABLE.';

CREATE TYPE ref.parse_status AS ENUM (
    'OK',
    'FIELD_COUNT_MISMATCH',
    'EMPTY_MEMBER',
    'HEADER_MISSING',
    'SCHEMA_DRIFT'
);

CREATE TYPE ref.period_role AS ENUM (
    'CURRENT_PERIOD',
    'OTHER_DATE',
    'UNRESOLVED'
);

CREATE TYPE ref.resolution_state AS ENUM (
    'MATCHED',
    'PROBABLE',
    'UNRESOLVED',
    'REJECTED'
);

CREATE TYPE ref.row_kind AS ENUM (
    'IDENTIFIER_ROW',
    'NO_IDENTIFIER_ROW',
    'UNCLASSIFIED',
    'SUBTOTAL_ROW',
    'DIMENSION_FACT_ROW'
);

COMMENT ON TYPE ref.row_kind IS 'IDENTIFIER_ROW: this row''s Investment, Identifier Axis cell is non-empty. NO_IDENTIFIER_ROW: historical classification of an empty identifier cell; existing rows stay stored. SUBTOTAL_ROW and DIMENSION_FACT_ROW: filing-evidence kinds recorded by a superseding classification, only when that cell is empty. UNCLASSIFIED: the evidence does not assign one of those kinds. A blank identifier is not copied from another row.';

CREATE TYPE ref.scale_state AS ENUM (
    'KNOWN',
    'UNRESOLVED',
    'NOT_APPLICABLE'
);

CREATE TYPE ref.source_role AS ENUM (
    'PRIMARY',
    'SUPPORTING'
);

CREATE TYPE ref.validation_outcome AS ENUM (
    'PASS',
    'FAIL',
    'NOT_APPLICABLE',
    'NOT_EVALUATED',
    'ERROR'
);

CREATE TYPE ref.value_state AS ENUM (
    'REPORTED',
    'DERIVED',
    'UNKNOWN',
    'NOT_APPLICABLE'
);

CREATE TYPE review.candidate_type AS ENUM (
    'BORROWER'
);

CREATE TYPE review.case_status AS ENUM (
    'OPEN',
    'CLOSED'
);

CREATE TYPE review.evidence_origin AS ENUM (
    'INTERNAL',
    'EXTERNAL'
);

CREATE TYPE review.source_type AS ENUM (
    'INTERNAL_SEC_FILING',
    'COMPANY_WEBSITE',
    'SEC_FILING',
    'TRANSACTION_DOCUMENT',
    'COURT_DOCUMENT',
    'RATING_AGENCY',
    'STATE_REGISTRY',
    'OTHER'
);

CREATE FUNCTION access.record_grant(p_user_id uuid, p_grant_kind access.grant_kind, p_action access.grant_action, p_source access.grant_source, p_reason text, p_actor_user_id uuid) RETURNS bigint
    LANGUAGE plpgsql
    AS $$
DECLARE
  new_id bigint;
BEGIN
  INSERT INTO access.grant_event (user_id, grant_kind, action, source, actor_user_id, reason)
  VALUES (p_user_id, p_grant_kind, p_action, p_source, p_actor_user_id, p_reason)
  RETURNING id INTO new_id;
  RETURN new_id;
END
$$;

COMMENT ON FUNCTION access.record_grant(p_user_id uuid, p_grant_kind access.grant_kind, p_action access.grant_action, p_source access.grant_source, p_reason text, p_actor_user_id uuid) IS 'Operator/bootstrap insert. EXECUTE is not granted to application roles. The web application must not call this.';

CREATE FUNCTION derived.check_derived_value() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ops.rule_version r WHERE r.id = NEW.metric_rule_version_id AND r.rule_kind = 'DERIVATION') THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCD1', MESSAGE = 'metric_rule_version_id must be a DERIVATION rule version';
  END IF;
  PERFORM ops.assert_subject_exists(NEW.subject_table, NEW.subject_id);
  RETURN NEW;
END
$$;

CREATE FUNCTION derived.check_observation_event() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  po obs.position_observation;
  rule_kind ops.rule_kind;
BEGIN
  SELECT * INTO po FROM obs.position_observation WHERE id = NEW.position_observation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'observation event requires an existing position observation';
  END IF;
  IF NEW.evidence_id IS DISTINCT FROM po.evidence_id THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'observation event evidence_id must be the position observation evidence';
  END IF;
  IF NEW.reported_date IS DISTINCT FROM po.reported_date THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'observation event reported_date must equal the position observation reported_date';
  END IF;
  SELECT r.rule_kind INTO rule_kind FROM ops.rule_version r WHERE r.id = NEW.rule_version_id;
  IF rule_kind IS DISTINCT FROM 'DERIVATION' THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCD1',
      MESSAGE = 'observation event rule_version_id must be a DERIVATION rule';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION derived.enforce_input_gate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  dv derived.derived_value;
  policy ops.unknown_input_policy;
  fv obs.position_field_value;
  input_state ref.value_state;
  mapping_state ref.mapping_status;
BEGIN
  SELECT * INTO dv FROM derived.derived_value WHERE id = NEW.derived_value_id;
  SELECT unknown_input_policy INTO policy FROM ops.rule_version WHERE id = dv.metric_rule_version_id;

  IF NEW.field_value_id IS NOT NULL THEN
    SELECT * INTO fv FROM obs.position_field_value WHERE id = NEW.field_value_id;
    IF EXISTS (SELECT 1 FROM obs.position_field_value s WHERE s.supersedes_id = fv.id) THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCD1',
        MESSAGE = format('field value %s is superseded; use the current version', fv.id);
    END IF;
    IF fv.column_mapping_id IS NOT NULL THEN
      mapping_state := ref.current_mapping_status(fv.column_mapping_id);
      IF mapping_state NOT IN ('DOCUMENTED', 'DOCUMENTED_AND_OBSERVED') THEN
        RAISE EXCEPTION USING ERRCODE = 'BDCD1',
          MESSAGE = format('field value %s comes from a column whose current mapping status is %s; it cannot feed derived values',
                           fv.id, mapping_state);
      END IF;
    END IF;
    input_state := fv.value_state;
  ELSE
    SELECT result_state INTO input_state FROM derived.derived_value WHERE id = NEW.input_derived_value_id;
  END IF;

  IF input_state IN ('UNKNOWN', 'NOT_APPLICABLE') THEN
    IF policy = 'REJECT_UNKNOWN_INPUTS' THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCD1',
        MESSAGE = 'this metric rejects UNKNOWN or NOT_APPLICABLE inputs';
    ELSIF dv.result_state = 'DERIVED' THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCD1',
        MESSAGE = 'an UNKNOWN or NOT_APPLICABLE input cannot produce a DERIVED result';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION derived.require_input() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM derived.derived_value_input i WHERE i.derived_value_id = NEW.id) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCL1', MESSAGE = format('derived value %s has no inputs', NEW.id);
  END IF;
  RETURN NULL;
END
$$;

CREATE FUNCTION evidence.assert_anchor_on_artifact(p_evidence_id bigint, p_artifact_id bigint, p_href text) RETURNS void
    LANGUAGE plpgsql
    AS $$
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

CREATE FUNCTION evidence.check_evidence() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  parent evidence.evidence;
  heading evidence.evidence;
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
  IF NEW.locator_type = 'JSON_PATH' AND NEW.evidence_level IN ('REGISTRY', 'DISCOVERY') AND NOT EXISTS (
    SELECT 1 FROM raw.json_value v WHERE v.artifact_id = NEW.artifact_id AND v.json_path = NEW.json_path
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1', MESSAGE = 'evidence json_path must resolve to a stored raw.json_value of the artifact';
  END IF;
  IF NEW.block_evidence_id IS NOT NULL THEN
    SELECT * INTO parent FROM evidence.evidence WHERE id = NEW.block_evidence_id;
    IF parent.id IS NULL
       OR parent.locator_type IS DISTINCT FROM 'DISCLOSURE_BLOCK'
       OR parent.artifact_id IS DISTINCT FROM NEW.artifact_id THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'disclosure block parent must be a DISCLOSURE_BLOCK on the same artifact';
    END IF;
    IF NEW.locator_type = 'IXBRL_FACT' AND NEW.html_row_ordinal IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'an IXBRL_FACT inside a disclosure block requires html_row_ordinal';
    END IF;
    IF NEW.html_row_ordinal IS NULL
       OR parent.html_row_ordinal IS NULL
       OR parent.html_row_end_ordinal IS NULL
       OR NEW.html_row_ordinal < parent.html_row_ordinal
       OR NEW.html_row_ordinal > parent.html_row_end_ordinal THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'child row ordinal must fall inside the disclosure block';
    END IF;
  END IF;
  IF NEW.heading_evidence_id IS NOT NULL THEN
    SELECT * INTO heading FROM evidence.evidence WHERE id = NEW.heading_evidence_id;
    IF heading.id IS NULL
       OR heading.locator_type IS DISTINCT FROM 'HTML_COLUMN_HEADING'
       OR heading.artifact_id IS DISTINCT FROM NEW.artifact_id
       OR heading.html_slot_ordinal IS DISTINCT FROM NEW.html_slot_ordinal
       OR heading.html_row_ordinal IS NULL
       OR NEW.html_row_ordinal IS NULL
       OR heading.html_row_ordinal >= NEW.html_row_ordinal THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'value cell heading must be an HTML_COLUMN_HEADING on the same artifact and slot, on an earlier row';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION evidence.check_evidence() IS 'A block parent must be a DISCLOSURE_BLOCK on the same artifact, and the child row must fall inside that block. A heading link must be an earlier HTML_COLUMN_HEADING on the same artifact and slot. The function does not parse HTML and does not assign a field code.';

CREATE FUNCTION evidence.check_html_column_heading() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  ev evidence.evidence;
  above evidence.evidence;
BEGIN
  SELECT * INTO ev FROM evidence.evidence WHERE id = NEW.evidence_id;
  IF ev.locator_type IS DISTINCT FROM 'HTML_COLUMN_HEADING' THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'heading text belongs only to an HTML_COLUMN_HEADING';
  END IF;
  IF NEW.stack_above_evidence_id IS NOT NULL THEN
    SELECT * INTO above FROM evidence.evidence WHERE id = NEW.stack_above_evidence_id;
    IF above.locator_type IS DISTINCT FROM 'HTML_COLUMN_HEADING'
       OR above.artifact_id IS DISTINCT FROM ev.artifact_id
       OR above.html_slot_ordinal IS DISTINCT FROM ev.html_slot_ordinal
       OR above.html_row_ordinal IS NULL
       OR ev.html_row_ordinal IS NULL
       OR above.html_row_ordinal >= ev.html_row_ordinal THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'stacked heading must be an earlier HTML_COLUMN_HEADING on the same artifact and slot';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION evidence.check_supplementary_subject() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM ops.assert_subject_exists(NEW.subject_table, NEW.subject_id);
  RETURN NEW;
END
$$;

CREATE FUNCTION evidence.located_value(p_evidence_id bigint, OUT checkable boolean, OUT value text) RETURNS record
    LANGUAGE plpgsql STABLE
    AS $$
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

CREATE FUNCTION evidence.require_html_column_heading() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.locator_type = 'HTML_COLUMN_HEADING' AND NOT EXISTS (
    SELECT 1 FROM evidence.html_column_heading h WHERE h.evidence_id = NEW.id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'HTML_COLUMN_HEADING requires raw heading text and matched heading text';
  END IF;
  RETURN NULL;
END
$$;

CREATE FUNCTION evidence.source_field(p_locator ref.locator_type, p_column_label text, p_json_path text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE p_locator
           WHEN 'TSV_CELL' THEN p_column_label
           WHEN 'TSV_ROW' THEN 'row'
           WHEN 'JSON_PATH' THEN regexp_replace(p_json_path, '\[[0-9]+\]', '[*]', 'g')
           WHEN 'HTML_ANCHOR' THEN 'link'
         END
$$;

COMMENT ON FUNCTION evidence.source_field(p_locator ref.locator_type, p_column_label text, p_json_path text) IS 'Key into ref.registry_field_mapping.source_field for an evidence location.';

CREATE FUNCTION obs.cell_by_label(p_row_id bigint, p_label text) RETURNS text
    LANGUAGE sql STABLE
    AS $$
  SELECT r.cells[array_position(tl.header, p_label)]
  FROM raw.tabular_row r JOIN raw.table_load tl ON tl.id = r.table_load_id
  WHERE r.id = p_row_id
$$;

CREATE FUNCTION obs.check_borrower_name_observation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  origin_row bigint;
  filing bigint;
BEGIN
  IF NEW.name_source = 'SOI_CELL' THEN
    IF NEW.source_column_label IS NULL OR NEW.source_column_position IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'SOI_CELL requires source_column_label and source_column_position';
    END IF;
    SELECT s.tabular_row_id INTO origin_row
    FROM obs.position_observation p
    JOIN obs.soi_row_observation s ON s.id = p.origin_soi_row_observation_id
    WHERE p.id = NEW.position_observation_id;
    IF origin_row IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'SOI_CELL requires the position observation origin SOI row';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM evidence.evidence e
      WHERE e.id = NEW.evidence_id
        AND e.evidence_level = 'L1_STRUCTURED_DATASET'
        AND e.locator_type = 'TSV_CELL'
        AND e.tabular_row_id = origin_row
        AND e.column_label = NEW.source_column_label
        AND e.column_position = NEW.source_column_position
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'SOI_CELL evidence must be an L1 TSV_CELL on the origin SOI row at the named column';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM raw.tabular_row r
      JOIN raw.table_load tl ON tl.id = r.table_load_id
      WHERE r.id = origin_row
        AND tl.header[NEW.source_column_position] = NEW.source_column_label
        AND r.cells[NEW.source_column_position] IS NOT DISTINCT FROM NEW.raw_text
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'SOI_CELL raw_text must equal the origin SOI cell';
    END IF;
  ELSIF NEW.name_source = 'FILING_CELL' THEN
    IF NEW.source_column_label IS NOT NULL OR NEW.source_column_position IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'FILING_CELL cannot carry SOI source columns';
    END IF;
    IF NEW.raw_text IS NULL OR NEW.raw_text = '' THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'FILING_CELL raw_text must be non-empty';
    END IF;
    SELECT p.filing_id INTO filing
    FROM obs.position_observation p
    WHERE p.id = NEW.position_observation_id;
    IF NOT EXISTS (
      SELECT 1
      FROM evidence.evidence e
      JOIN raw.artifact a ON a.id = e.artifact_id
      JOIN registry.filing_document_artifact fda ON fda.artifact_id = a.id
      JOIN registry.filing_document fd ON fd.id = fda.filing_document_id
      WHERE e.id = NEW.evidence_id
        AND e.evidence_level = 'L2_ORIGINAL_FILING'
        AND a.source_type_code = 'SEC_FILING_DOCUMENT'
        AND fd.filing_id = filing
        AND (
          e.locator_type IN ('HTML_ANCHOR', 'IXBRL_FACT')
          OR (
            e.locator_type = 'HTML_TABLE_CELL'
            AND e.block_evidence_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM evidence.evidence parent
              WHERE parent.id = e.block_evidence_id
                AND parent.locator_type = 'DISCLOSURE_BLOCK'
                AND parent.artifact_id = e.artifact_id
                AND parent.html_row_ordinal = e.html_row_ordinal
            )
          )
        )
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'FILING_CELL evidence must be L2 HTML_ANCHOR, IXBRL_FACT, or a block-start HTML_TABLE_CELL on a SEC_FILING_DOCUMENT linked to the position filing';
    END IF;
  ELSE
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'name_source must be SOI_CELL or FILING_CELL';
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION obs.check_borrower_name_observation() IS 'SOI_CELL must match the origin SOI cell through L1 TSV_CELL evidence. FILING_CELL cites L2 HTML_ANCHOR, IXBRL_FACT, or an HTML_TABLE_CELL on the disclosure block start row. The function does not parse HTML and does not read holding_descriptor_raw.';

CREATE FUNCTION obs.check_borrower_name_successor() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  previous_rule bigint;
  previous_state text;
  previous_text text;
BEGIN
  IF NEW.supersedes_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT rule_version_id, extraction_state, normalized_text
    INTO previous_rule, previous_state, previous_text
  FROM obs.borrower_name_observation
  WHERE id = NEW.supersedes_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF previous_rule IS NOT DISTINCT FROM NEW.rule_version_id
     AND previous_state IS NOT DISTINCT FROM NEW.extraction_state
     AND previous_text IS NOT DISTINCT FROM NEW.normalized_text THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCS1',
      MESSAGE = 'obs.borrower_name_observation: a successor must change rule_version_id, extraction_state, or normalized_text';
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION obs.check_borrower_name_successor() IS 'A successor must change the rule version, the extraction state, or the normalized text. raw_text may differ when the reason records a capture correction.';

CREATE FUNCTION obs.check_fact_group_member_evidence() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM obs.position_observation_source src
    JOIN obs.soi_row_observation s ON s.id = src.soi_row_observation_id
    JOIN evidence.evidence e ON e.id = NEW.evidence_id AND e.tabular_row_id = s.tabular_row_id
    WHERE src.position_observation_id = NEW.position_observation_id
      AND src.source_role = 'PRIMARY'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'fact group member evidence must point at the member source row';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION obs.check_field_value_corroboration() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.num_fact_observation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM obs.position_field_value f
    JOIN obs.position_observation p ON p.id = f.position_observation_id
    JOIN obs.num_fact_observation n ON n.id = NEW.num_fact_observation_id
    WHERE f.id = NEW.field_value_id AND n.filing_id = p.filing_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1', MESSAGE = 'corroborating NUM fact must be from the same filing';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION obs.check_group_member() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM obs.position_observation_group g JOIN obs.position_observation p ON p.filing_id = g.filing_id
    WHERE g.id = NEW.group_id AND p.id = NEW.position_observation_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1', MESSAGE = 'group members must be from the group filing';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION obs.check_maturity_inspection() RETURNS trigger
    LANGUAGE plpgsql
    AS $_$
DECLARE
  origin bigint;
  displayed date;
  raw_month integer;
  raw_year integer;
BEGIN
  SELECT p.origin_soi_row_observation_id INTO origin
  FROM obs.position_observation p
  WHERE p.id = NEW.position_observation_id;
  IF origin IS NULL OR origin IS DISTINCT FROM NEW.soi_row_observation_id THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'maturity inspection must use the position origin SOI row';
  END IF;

  IF NEW.inspection_state::text = 'NOT_BOUND' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM evidence.evidence e
      JOIN registry.filing_document_artifact fda ON fda.artifact_id = e.artifact_id
      JOIN registry.filing_document fd ON fd.id = fda.filing_document_id
      JOIN obs.position_observation p ON p.id = NEW.position_observation_id
      WHERE e.id = NEW.evidence_id
        AND e.evidence_level = 'L2_ORIGINAL_FILING'
        AND e.locator_type = 'DOCUMENT'
        AND fd.filing_id = p.filing_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'NOT_BOUND requires L2 DOCUMENT evidence on the position filing artifact';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM validation.validation_result v
      JOIN evidence.evidence ve ON ve.id = v.evidence_id
      JOIN evidence.evidence doc ON doc.id = NEW.evidence_id
      WHERE v.subject_table = 'obs.position_observation'
        AND v.subject_id = NEW.position_observation_id
        AND v.outcome = 'FAIL'
        AND v.rule_version_id = NEW.rule_version_id
        AND v.run_id = NEW.run_id
        AND v.detail = NEW.no_bind_reason::text
        AND ve.evidence_level = 'L2_ORIGINAL_FILING'
        AND ve.artifact_id = doc.artifact_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'NOT_BOUND requires a FAIL validation of the same rule version and run whose detail is no_bind_reason';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.inspection_state::text = 'FILING_DISPLAYED' THEN
    IF NEW.raw_value !~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$' THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'FILING_DISPLAYED raw_value must be a month/day/year date';
    END IF;
    displayed := to_date(NEW.raw_value, 'FMMM/FMDD/YYYY');
    IF NEW.normalized_date IS DISTINCT FROM displayed THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'normalized_date must equal the displayed month/day/year';
    END IF;
  END IF;

  IF NEW.inspection_state::text = 'FILING_MONTH' THEN
    IF NEW.raw_value !~ '^[0-9]{1,2}/[0-9]{4}$' THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'FILING_MONTH raw_value must be a month/year';
    END IF;
    IF NEW.normalized_date IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'FILING_MONTH normalized_date must be null';
    END IF;
    raw_month := split_part(NEW.raw_value, '/', 1)::integer;
    raw_year := split_part(NEW.raw_value, '/', 2)::integer;
    IF NEW.displayed_month IS DISTINCT FROM raw_month OR NEW.displayed_year IS DISTINCT FROM raw_year THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'FILING_MONTH displayed month and year must equal the raw month/year';
    END IF;
    IF raw_month < 1 OR raw_month > 12 THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'FILING_MONTH month must be 1 through 12';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM evidence.evidence e
    JOIN registry.filing_document_artifact fda ON fda.artifact_id = e.artifact_id
    JOIN registry.filing_document fd ON fd.id = fda.filing_document_id
    JOIN obs.position_observation p ON p.id = NEW.position_observation_id
    WHERE e.id = NEW.evidence_id
      AND e.evidence_level = 'L2_ORIGINAL_FILING'
      AND e.locator_type = 'HTML_ANCHOR'
      AND e.html_anchor = 'ix-context-row:' || NEW.filing_context_id
      AND fd.filing_id = p.filing_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'maturity inspection requires an L2 ix-context-row anchor on the position filing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM validation.validation_result v
    JOIN evidence.evidence fact ON fact.id = v.evidence_id
    JOIN evidence.evidence anchor ON anchor.id = NEW.evidence_id
    WHERE v.subject_table = 'obs.position_observation'
      AND v.subject_id = NEW.position_observation_id
      AND v.outcome = 'PASS'
      AND v.detail = NEW.filing_context_id
      AND fact.evidence_level = 'L2_ORIGINAL_FILING'
      AND fact.locator_type = 'IXBRL_FACT'
      AND fact.artifact_id = anchor.artifact_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'maturity inspection requires a PASS validation of an IXBRL_FACT on the same filing artifact for this context';
  END IF;
  RETURN NEW;
END
$_$;

CREATE FUNCTION obs.check_maturity_inspection_candidate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM obs.maturity_inspection i
    WHERE i.id = NEW.maturity_inspection_id AND i.inspection_state = 'UNRESOLVED'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'maturity candidates belong only to an UNRESOLVED inspection';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION obs.check_num_fact_observation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM obs.check_row_projection('NUM', NEW.tabular_row_id, NEW.filing_id, NEW.evidence_id);
  IF NEW.value_raw IS DISTINCT FROM obs.cell_by_label(NEW.tabular_row_id, 'value')
     OR NEW.uom_raw IS DISTINCT FROM obs.cell_by_label(NEW.tabular_row_id, 'uom') THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1', MESSAGE = 'raw value and uom must equal the source row cells';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION obs.check_observation_equivalence() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM raw.tabular_row a JOIN raw.table_load la ON la.id = a.table_load_id,
         raw.tabular_row b JOIN raw.table_load lb ON lb.id = b.table_load_id
    WHERE a.id = NEW.tabular_row_id AND b.id = NEW.equivalent_tabular_row_id
      AND a.raw_line_sha256 = b.raw_line_sha256 AND la.artifact_id <> lb.artifact_id
      AND la.table_code = lb.table_code
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'equivalent rows must have equal raw_line_sha256, the same table, and different artifacts';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION obs.check_position_field_value() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  fd ref.field_definition;
  m ref.source_column_mapping;
  origin_row bigint;
BEGIN
  SELECT * INTO fd FROM ref.field_definition WHERE field_code = NEW.field_code;
  IF (NEW.normalized_numeric IS NOT NULL AND fd.value_type <> 'NUMERIC')
     OR (NEW.normalized_date IS NOT NULL AND fd.value_type <> 'DATE')
     OR (NEW.normalized_text IS NOT NULL AND fd.value_type <> 'TEXT') THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = format('field %s takes %s values only', fd.field_code, fd.value_type);
  END IF;
  IF NEW.date_precision = 'MONTH' AND fd.value_type IS DISTINCT FROM 'DATE' THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'month precision is only valid for a DATE field';
  END IF;
  IF NEW.date_precision = 'MONTH' AND NEW.normalized_date IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'month precision cannot store a day';
  END IF;
  IF NEW.value_state = 'REPORTED' AND NEW.column_mapping_id IS NULL AND NOT EXISTS (
    SELECT 1 FROM evidence.evidence e WHERE e.id = NEW.evidence_id AND e.evidence_level = 'L2_ORIGINAL_FILING'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'a REPORTED value needs a source column mapping or Level 2 (original filing) evidence';
  END IF;
  IF NEW.column_mapping_id IS NOT NULL THEN
    SELECT * INTO m FROM ref.source_column_mapping WHERE id = NEW.column_mapping_id;
    IF m.field_code IS DISTINCT FROM NEW.field_code OR m.column_label <> NEW.source_column_label THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'column_mapping_id must map source_column_label to field_code';
    END IF;
  END IF;
  IF NEW.source_column_label IS NOT NULL THEN
    SELECT s.tabular_row_id INTO origin_row
    FROM obs.position_observation p JOIN obs.soi_row_observation s ON s.id = p.origin_soi_row_observation_id
    WHERE p.id = NEW.position_observation_id;
    IF NOT EXISTS (
      SELECT 1 FROM raw.tabular_row r JOIN raw.table_load tl ON tl.id = r.table_load_id
      WHERE r.id = origin_row
        AND tl.header[NEW.source_column_position] = NEW.source_column_label
        AND r.cells[NEW.source_column_position] IS NOT DISTINCT FROM NEW.raw_value
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCI1',
        MESSAGE = 'source column label, position, and raw value must match the origin SOI row';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION obs.check_position_field_value() IS 'A field value must match its value type. MONTH precision is a year and month on a DATE field, with no normalized_date. The function does not invent a day.';

CREATE FUNCTION obs.check_position_observation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  s obs.soi_row_observation;
  cell text;
BEGIN
  SELECT * INTO s FROM obs.soi_row_observation WHERE id = NEW.origin_soi_row_observation_id;
  IF s.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1', MESSAGE = 'position observation origin SOI row does not exist';
  END IF;
  cell := nullif(obs.cell_by_label(s.tabular_row_id, 'Investment, Identifier Axis'), '');
  IF cell IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'a blank identifier cell cannot become a position';
  END IF;
  IF NEW.holding_descriptor_raw IS DISTINCT FROM cell THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'holding_descriptor_raw must equal the origin identifier cell';
  END IF;
  IF s.filing_id <> NEW.filing_id
     OR s.reported_date IS DISTINCT FROM NEW.reported_date
     OR s.date_precision <> NEW.date_precision
     OR s.duration_kind <> NEW.duration_kind
     OR s.identifier_raw IS DISTINCT FROM NEW.holding_descriptor_raw THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'position observation must match its origin SOI row (filing, date, duration, identifier)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM obs.current_soi_row_classification c
    WHERE c.soi_row_observation_id = s.id AND c.row_kind = 'IDENTIFIER_ROW'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'a position origin must be IDENTIFIER_ROW';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM evidence.evidence e
    WHERE e.id = NEW.evidence_id AND e.tabular_row_id = s.tabular_row_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1', MESSAGE = 'evidence must point at the origin SOI row';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION obs.check_position_observation_source() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM obs.position_observation p JOIN obs.soi_row_observation s ON s.id = NEW.soi_row_observation_id
    WHERE p.id = NEW.position_observation_id AND p.filing_id = s.filing_id
      AND (NEW.source_role <> 'PRIMARY' OR p.origin_soi_row_observation_id = s.id)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'source rows must be from the same filing; the PRIMARY source must be the origin row';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION obs.check_row_projection(p_table text, p_row_id bigint, p_filing_id bigint, p_evidence_id bigint) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM raw.tabular_row r JOIN raw.table_load tl ON tl.id = r.table_load_id
    WHERE r.id = p_row_id AND tl.table_code = p_table AND r.parse_status = 'OK'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = format('source row must be an OK row of a %s table load', p_table);
  END IF;
  IF obs.cell_by_label(p_row_id, 'adsh') IS DISTINCT FROM
     (SELECT f.accession_number FROM registry.filing f WHERE f.id = p_filing_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'filing_id must be the filing whose accession equals the row adsh cell';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM evidence.evidence e WHERE e.id = p_evidence_id AND e.tabular_row_id = p_row_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1', MESSAGE = 'evidence must point at the same source row';
  END IF;
END
$$;

CREATE FUNCTION obs.check_soi_fact_group_shape() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  rule_code text;
  n_balance integer;
  n_spread integer;
  n_pik integer;
  n_all integer;
BEGIN
  SELECT rv.rule_code INTO rule_code
  FROM ops.rule_version rv
  WHERE rv.id = NEW.rule_version_id;
  IF rule_code IS DISTINCT FROM 'obs.soi_fact_group' THEN
    RETURN NULL;
  END IF;
  IF NEW.grouping_key IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCL1',
      MESSAGE = 'soi fact group requires a grouping key';
  END IF;
  SELECT count(*) FILTER (WHERE m.member_role = 'BALANCE'),
         count(*) FILTER (WHERE m.member_role = 'SPREAD'),
         count(*) FILTER (WHERE m.member_role = 'PIK'),
         count(*)
    INTO n_balance, n_spread, n_pik, n_all
  FROM obs.position_observation_group_member m
  WHERE m.group_id = NEW.id;
  IF n_balance <> 1 OR n_spread <> 1 OR n_pik > 1 OR n_all <> n_balance + n_spread + n_pik
     OR n_all NOT IN (2, 3) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCL1',
      MESSAGE = 'soi fact group must be one balance row, one spread row, and at most one PIK row';
  END IF;
  RETURN NULL;
END
$$;

CREATE FUNCTION obs.check_soi_row_classification() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  ident text;
BEGIN
  SELECT o.identifier_raw INTO ident
  FROM obs.soi_row_observation o
  WHERE o.id = NEW.soi_row_observation_id;

  IF NEW.row_kind::text = 'IDENTIFIER_ROW' AND ident IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'IDENTIFIER_ROW requires a non-empty origin identifier cell';
  END IF;
  IF NEW.row_kind::text IN ('NO_IDENTIFIER_ROW', 'SUBTOTAL_ROW', 'DIMENSION_FACT_ROW') AND ident IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'this row kind requires an empty origin identifier cell';
  END IF;
  IF NEW.row_kind::text IS DISTINCT FROM 'IDENTIFIER_ROW'
     AND EXISTS (
       SELECT 1 FROM obs.position_observation p
       WHERE p.origin_soi_row_observation_id = NEW.soi_row_observation_id
     ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'a position origin must stay IDENTIFIER_ROW';
  END IF;
  IF NEW.row_kind::text IN ('SUBTOTAL_ROW', 'DIMENSION_FACT_ROW') AND NEW.evidence_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'SUBTOTAL_ROW and DIMENSION_FACT_ROW require filing evidence';
  END IF;
  IF NEW.row_kind::text IN ('SUBTOTAL_ROW', 'DIMENSION_FACT_ROW') AND NOT EXISTS (
    SELECT 1
    FROM evidence.evidence e
    JOIN registry.filing_document_artifact fda ON fda.artifact_id = e.artifact_id
    JOIN registry.filing_document fd ON fd.id = fda.filing_document_id
    JOIN obs.soi_row_observation o ON o.id = NEW.soi_row_observation_id
    WHERE e.id = NEW.evidence_id
      AND e.evidence_level = 'L2_ORIGINAL_FILING'
      AND e.locator_type IN ('IXBRL_FACT', 'HTML_ANCHOR')
      AND fd.filing_id = o.filing_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'filing evidence must be L2 IXBRL_FACT or HTML_ANCHOR on the same filing';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION obs.check_soi_row_observation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM obs.check_row_projection('SOI', NEW.tabular_row_id, NEW.filing_id, NEW.evidence_id);
  IF NEW.reported_date_raw IS DISTINCT FROM obs.cell_by_label(NEW.tabular_row_id, 'ddate')
     OR NEW.qtrs_raw IS DISTINCT FROM obs.cell_by_label(NEW.tabular_row_id, 'qtrs')
     OR NEW.identifier_raw IS DISTINCT FROM
        nullif(obs.cell_by_label(NEW.tabular_row_id, 'Investment, Identifier Axis'), '') THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'raw ddate, qtrs, and identifier must equal the source row cells';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION obs.require_group_member() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM obs.position_observation_group_member m WHERE m.group_id = NEW.id) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCL1', MESSAGE = format('group %s has no members', NEW.id);
  END IF;
  RETURN NULL;
END
$$;

CREATE FUNCTION obs.require_position_observation_source() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM obs.position_observation_source s
    WHERE s.position_observation_id = NEW.id AND s.source_role = 'PRIMARY'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCL1',
      MESSAGE = format('position observation %s has no PRIMARY source link', NEW.id);
  END IF;
  RETURN NULL;
END
$$;

CREATE FUNCTION ops.add_supersession(rel regclass, subject_columns text, chain_mode text) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  short_name text := (SELECT relname FROM pg_class WHERE oid = rel);
  col text;
  col_list text;
BEGIN
  IF chain_mode NOT IN ('single_chain', 'multi') THEN
    RAISE EXCEPTION 'chain_mode must be single_chain or multi';
  END IF;
  FOREACH col IN ARRAY string_to_array(subject_columns, ',') LOOP
    col := btrim(col);
    IF col = '' OR NOT EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = rel AND a.attnum > 0 AND NOT a.attisdropped AND a.attname = col
    ) THEN
      RAISE EXCEPTION 'ops.add_supersession: % is not a column of %', col, rel;
    END IF;
  END LOOP;
  EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I CHECK (supersedes_id IS DISTINCT FROM id)',
                 rel, short_name || '_not_self_superseding');
  EXECUTE format('CREATE UNIQUE INDEX %I ON %s (supersedes_id) WHERE supersedes_id IS NOT NULL',
                 short_name || '_supersedes_once', rel);
  EXECUTE format('CREATE TRIGGER check_supersession BEFORE INSERT ON %s FOR EACH ROW '
                 'EXECUTE FUNCTION ops.check_supersession(%L, %L)', rel, subject_columns, chain_mode);
  IF chain_mode = 'single_chain' THEN
    SELECT string_agg(format('%I', btrim(c)), ', ' ORDER BY ord)
      INTO col_list
    FROM unnest(string_to_array(subject_columns, ',')) WITH ORDINALITY AS x(c, ord);
    EXECUTE format('CREATE INDEX %I ON %s (%s)', short_name || '_subject_idx', rel, col_list);
  END IF;
END
$$;

CREATE FUNCTION ops.apply_append_only_to_all() RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  t record;
  attached integer := 0;
BEGIN
  FOR t IN
    SELECT c.oid::regclass AS rel
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p')
      AND n.nspname IN ('ops', 'raw', 'registry', 'evidence', 'obs', 'identity',
                        'resolution', 'validation', 'derived', 'ref', 'review', 'access')
      AND NOT EXISTS (
        SELECT 1 FROM pg_trigger tg
        WHERE tg.tgrelid = c.oid AND tg.tgname = 'append_only_row'
      )
  LOOP
    EXECUTE format(
      'CREATE TRIGGER append_only_row BEFORE UPDATE OR DELETE ON %s '
      'FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation()', t.rel);
    EXECUTE format(
      'CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON %s '
      'FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation()', t.rel);
    attached := attached + 1;
  END LOOP;
  RETURN attached;
END
$$;

CREATE FUNCTION ops.assert_subject_exists(subject_table text, subject_id bigint) RETURNS void
    LANGUAGE plpgsql
    AS $_$
DECLARE
  found boolean;
BEGIN
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE id = $1)', subject_table::regclass)
    INTO found USING subject_id;
  IF NOT found THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = format('subject %s id=%s does not exist', subject_table, subject_id);
  END IF;
END
$_$;

CREATE FUNCTION ops.check_projection_exception() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM raw.tabular_row r
    WHERE r.id = NEW.tabular_row_id AND r.table_load_id = NEW.table_load_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'projection_exception tabular_row_id must belong to table_load_id';
  END IF;
  IF NEW.kind = 'FIELD_COUNT_MISMATCH' AND NOT EXISTS (
    SELECT 1 FROM raw.tabular_row r
    WHERE r.id = NEW.tabular_row_id AND r.parse_status = 'FIELD_COUNT_MISMATCH'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'FIELD_COUNT_MISMATCH exceptions require a FIELD_COUNT_MISMATCH raw row';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM evidence.evidence e
    WHERE e.id = NEW.evidence_id AND e.tabular_row_id = NEW.tabular_row_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'projection_exception evidence must point at the same raw row';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION ops.check_supersession() RETURNS trigger
    LANGUAGE plpgsql
    AS $_$
DECLARE
  cols text[] := string_to_array(TG_ARGV[0], ',');
  chain_mode text := TG_ARGV[1];
  subject_match text;
  n_cols integer;
  n_matched integer;
  found boolean;
BEGIN
  SELECT count(*) INTO n_cols FROM unnest(cols) AS c WHERE btrim(c) <> '';
  SELECT string_agg(
           format(
             CASE WHEN a.attnotnull
               THEN 't.%I = ($1).%I'
               ELSE 't.%I IS NOT DISTINCT FROM ($1).%I'
             END,
             btrim(x.c), btrim(x.c)),
           ' AND ' ORDER BY x.ord),
         count(*)
    INTO subject_match, n_matched
  FROM unnest(cols) WITH ORDINALITY AS x(c, ord)
  JOIN pg_attribute a
    ON a.attrelid = format('%I.%I', TG_TABLE_SCHEMA, TG_TABLE_NAME)::regclass
   AND a.attname = btrim(x.c)
   AND a.attnum > 0
   AND NOT a.attisdropped
  WHERE btrim(x.c) <> '';
  IF subject_match IS NULL OR n_matched <> n_cols THEN
    RAISE EXCEPTION 'ops.check_supersession: subject column missing on %.%', TG_TABLE_SCHEMA, TG_TABLE_NAME;
  END IF;

  IF NEW.supersedes_id IS NULL THEN
    IF NEW.supersede_reason IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCS1',
        MESSAGE = format('%I.%I: supersede_reason given without supersedes_id', TG_TABLE_SCHEMA, TG_TABLE_NAME);
    END IF;
    IF chain_mode = 'single_chain' THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.%I t WHERE %s)',
                     TG_TABLE_SCHEMA, TG_TABLE_NAME, subject_match)
        INTO found USING NEW;
      IF found THEN
        RAISE EXCEPTION USING ERRCODE = 'BDCS1',
          MESSAGE = format('%I.%I: this subject already has a row; insert a row that supersedes the current one',
                           TG_TABLE_SCHEMA, TG_TABLE_NAME);
      END IF;
    END IF;
  ELSE
    IF coalesce(btrim(NEW.supersede_reason), '') = '' THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCS1',
        MESSAGE = format('%I.%I: a superseding row needs a supersede_reason', TG_TABLE_SCHEMA, TG_TABLE_NAME);
    END IF;
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.%I t WHERE t.id = ($1).supersedes_id AND %s)',
                   TG_TABLE_SCHEMA, TG_TABLE_NAME, subject_match)
      INTO found USING NEW;
    IF NOT found THEN
      RAISE EXCEPTION USING ERRCODE = 'BDCS1',
        MESSAGE = format('%I.%I: supersedes_id must reference a row of the same table with the same subject (%s)',
                         TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_ARGV[0]);
    END IF;
  END IF;
  RETURN NEW;
END
$_$;

COMMENT ON FUNCTION ops.check_supersession() IS 'G-10: first single_chain insert rejects an existing subject; a superseding row must share subject columns and carry a reason. NOT NULL subject columns compare with = so a btree Index Cond can be used; nullable columns keep IS NOT DISTINCT FROM.';

CREATE FUNCTION ops.forbid_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = 'BDCA1',
    MESSAGE = format('%I.%I is append-only: %s is not allowed', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP),
    HINT = 'Insert a new row that supersedes the previous one, with a reason.';
END
$$;

CREATE FUNCTION ops.grant_layer_privileges() RETURNS void
    LANGUAGE plpgsql
    AS $$
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

CREATE FUNCTION ops.text_is_numeric_zero(value text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $_$
  SELECT value ~ '^\s*[+-]?(0+(\.0*)?|\.0+)([eE][+-]?[0-9]+)?\s*$'
$_$;

CREATE FUNCTION raw.check_artifact_lineage() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM raw.artifact a JOIN raw.artifact p ON p.id = NEW.previous_artifact_id
    WHERE a.id = NEW.artifact_id AND a.source_url = p.source_url AND a.sha256 <> p.sha256
      AND a.retrieved_at >= p.retrieved_at
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'artifact lineage requires the same source_url, a different sha256, and a later retrieval';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION raw.check_json_document() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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

CREATE FUNCTION raw.check_json_value() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'raw.json_value rows are written only by the raw.json_document flattening trigger';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION raw.check_table_load_header() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF cardinality(NEW.header) >= 1 THEN
    RETURN NEW;
  END IF;
  IF NEW.table_code IS DISTINCT FROM 'SOI'
     OR NEW.row_count <> 0
     OR NEW.field_count_mismatch_count <> 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'an empty header is allowed only for a 0-byte SOI member with row_count = 0';
  END IF;
  IF NEW.artifact_member_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM raw.artifact_member m
    WHERE m.id = NEW.artifact_member_id AND m.artifact_id = NEW.artifact_id AND m.byte_size = 0
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'an empty SOI header requires the artifact member to be 0 bytes';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION raw.check_tabular_row() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  tl raw.table_load;
BEGIN
  SELECT * INTO tl FROM raw.table_load WHERE id = NEW.table_load_id;
  IF encode(sha256(convert_to(NEW.raw_line, 'UTF8')), 'hex') <> NEW.raw_line_sha256 THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1', MESSAGE = 'raw_line_sha256 does not match raw_line';
  END IF;
  IF tl.delimiter = E'\t' AND NEW.cells IS DISTINCT FROM string_to_array(NEW.raw_line, E'\t') THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1', MESSAGE = 'cells must be the exact tab split of raw_line';
  END IF;
  IF (NEW.parse_status = 'OK') <> (NEW.field_count = cardinality(tl.header)) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'parse_status must be OK exactly when field_count equals the header width';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION raw.flatten_json_document() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $_$
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
$_$;

CREATE FUNCTION raw.source_stream(p_artifact_id bigint) RETURNS text
    LANGUAGE sql STABLE
    AS $$
  SELECT CASE
           WHEN a.source_type_code IN ('SEC_SUBMISSIONS_JSON', 'SEC_SUBMISSIONS_PAGE_JSON')
             THEN 'submissions:' || substring(a.source_url FROM '/submissions/CIK([0-9]{10})')
           ELSE a.source_url
         END
  FROM raw.artifact a WHERE a.id = p_artifact_id
$$;

CREATE FUNCTION ref.current_mapping_status(mapping_id bigint) RETURNS ref.mapping_status
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
  SELECT head.mapping_status
  FROM ref.source_column_mapping m
  JOIN ref.source_column_mapping head
    ON (head.source_table_code, head.column_label, head.field_code)
       IS NOT DISTINCT FROM (m.source_table_code, m.column_label, m.field_code)
  WHERE m.id = mapping_id
    AND NOT EXISTS (SELECT 1 FROM ref.source_column_mapping s WHERE s.supersedes_id = head.id)
$$;

COMMENT ON FUNCTION ref.current_mapping_status(mapping_id bigint) IS 'Status of the current (non-superseded) mapping in the same chain as mapping_id.';

CREATE FUNCTION registry.bdc_portfolio_changes(p_cik text, p_reported_date date) RETURNS TABLE(position_id text, earlier_reported_date text, later_reported_date text, earlier_accession_number text, later_accession_number text, principal_comparison_state text, earlier_principal_raw text, later_principal_raw text, principal_delta text, fair_value_comparison_state text, earlier_fair_value_raw text, later_fair_value_raw text, fair_value_delta text, maturity_comparison_state text, maturity_changed boolean, earlier_maturity_raw text, later_maturity_raw text, holdings_definition text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'registry', 'obs'
    AS $$
  SELECT c.position_id::text,
         c.earlier_reported_date::text,
         c.later_reported_date::text,
         c.earlier_accession_number,
         c.later_accession_number,
         c.principal_comparison_state,
         c.earlier_principal_raw,
         c.later_principal_raw,
         c.principal_delta::text,
         c.fair_value_comparison_state,
         c.earlier_fair_value_raw,
         c.later_fair_value_raw,
         c.fair_value_delta::text,
         c.maturity_comparison_state,
         c.maturity_changed,
         c.earlier_maturity_raw,
         c.later_maturity_raw,
         'portfolio.holdings.v1'
  FROM registry.position_period_comparison c
  JOIN registry.bdc_portfolio_scope(p_cik, p_reported_date) scoped
    ON scoped.position_observation_id = c.later_position_observation_id
  ORDER BY c.later_reported_date DESC, c.position_id, c.later_position_observation_id
$$;

COMMENT ON FUNCTION registry.bdc_portfolio_changes(p_cik text, p_reported_date date) IS 'Confirmed comparisons whose later observation is in this CIK and reported date. Deltas are copied from registry.position_period_comparison. A missing later observation is not a row and is not a repayment or a refinancing.';

CREATE FUNCTION registry.bdc_portfolio_holdings(p_cik text, p_reported_date date, p_limit integer, p_offset integer) RETURNS TABLE(registrant_cik text, reported_date text, position_observation_id text, position_id text, borrower_name_raw text, holding_descriptor_raw text, instrument_id text, instrument_resolution_state text, continuity_state text, instrument_type_state text, instrument_type_raw text, principal_state text, principal_raw text, principal_currency_state text, principal_currency_code text, cost_state text, cost_raw text, cost_currency_state text, cost_currency_code text, fair_value_state text, fair_value_raw text, fair_value_currency_state text, fair_value_currency_code text, maturity_source text, maturity_raw text, maturity_precision text, accession_number text, observation_evidence_level text, document_url text, holdings_definition text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'registry', 'obs'
    AS $$
  SELECT r.registrant_cik,
         r.reported_date::text,
         r.position_observation_id::text,
         r.position_id::text,
         r.borrower_name_raw,
         r.holding_descriptor_raw,
         r.instrument_id::text,
         r.instrument_resolution_state,
         r.continuity_state,
         CASE
           WHEN instrument_type.n IS NULL OR instrument_type.n = 0 THEN 'UNKNOWN'
           WHEN instrument_type.n = 1 AND instrument_type.reported_n = 1 THEN 'REPORTED'
           ELSE 'MULTIPLE_VALUES'
         END,
         CASE WHEN instrument_type.n = 1 AND instrument_type.reported_n = 1 THEN instrument_type.raw_value END,
         r.principal_state,
         r.principal_raw,
         r.principal_currency_state,
         principal_code.currency_code,
         r.cost_state,
         r.cost_raw,
         r.cost_currency_state,
         cost_code.currency_code,
         r.fair_value_state,
         r.fair_value_raw,
         r.fair_value_currency_state,
         fair_value_code.currency_code,
         r.maturity_source,
         r.maturity_raw,
         r.maturity_precision,
         r.accession_number,
         r.observation_evidence_level,
         doc.document_url,
         'portfolio.holdings.v1'
  FROM registry.bdc_portfolio_scope(p_cik, p_reported_date) scoped
  JOIN LATERAL (
    SELECT observed.*
    FROM registry.position_read observed
    WHERE observed.position_observation_id = scoped.position_observation_id
      AND observed.reported_date = p_reported_date
    OFFSET 0
  ) r ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS n,
           count(*) FILTER (WHERE rf.value_state = 'REPORTED')::integer AS reported_n,
           min(rf.raw_value) AS raw_value
    FROM obs.current_position_research_field rf
    WHERE rf.position_observation_id = r.position_observation_id
      AND rf.field_code = 'INSTRUMENT_TYPE'
  ) instrument_type ON true
  LEFT JOIN LATERAL (
    SELECT CASE WHEN count(*) = 1 THEN min(fv.currency_code) END AS currency_code
    FROM obs.current_position_field_value fv
    WHERE fv.position_observation_id = r.position_observation_id
      AND fv.field_code = 'PRINCIPAL_AMOUNT'
  ) principal_code ON true
  LEFT JOIN LATERAL (
    SELECT CASE WHEN count(*) = 1 THEN min(fv.currency_code) END AS currency_code
    FROM obs.current_position_field_value fv
    WHERE fv.position_observation_id = r.position_observation_id
      AND fv.field_code = 'COST'
  ) cost_code ON true
  LEFT JOIN LATERAL (
    SELECT CASE WHEN count(*) = 1 THEN min(fv.currency_code) END AS currency_code
    FROM obs.current_position_field_value fv
    WHERE fv.position_observation_id = r.position_observation_id
      AND fv.field_code = 'FAIR_VALUE'
  ) fair_value_code ON true
  LEFT JOIN LATERAL (
    SELECT filing_document.document_url
    FROM registry.filing_document filing_document
    WHERE filing_document.filing_id = r.filing_id
      AND filing_document.document_url ~ '^https://www\.sec\.gov/Archives/edgar/data/'
    ORDER BY CASE WHEN filing_document.named_by = 'SUBMISSIONS_PRIMARY_DOCUMENT' THEN 0 ELSE 1 END,
             filing_document.id
    LIMIT 1
  ) doc ON true
  ORDER BY r.borrower_name_raw ASC NULLS LAST, r.position_observation_id ASC
  LIMIT greatest(coalesce(p_limit, 0), 0)
  OFFSET greatest(coalesce(p_offset, 0), 0)
$$;

COMMENT ON FUNCTION registry.bdc_portfolio_holdings(p_cik text, p_reported_date date, p_limit integer, p_offset integer) IS 'One page of holdings for one CIK and one reported date under portfolio.holdings.v1. Facts are registry.position_read. A missing amount stays unknown. Currency is not converted.';

CREATE FUNCTION registry.bdc_portfolio_period_changes(p_cik text, p_earlier date, p_later date) RETURNS TABLE(change_type text, registrant_cik text, earlier_reported_date text, later_reported_date text, position_id text, instrument_id text, legal_entity_id text, borrower_name_raw text, holding_descriptor_raw text, instrument_resolution_state text, continuity_state text, instrument_type_state text, instrument_type_raw text, principal_comparison_state text, principal_delta text, earlier_principal_raw text, later_principal_raw text, earlier_principal_currency_state text, later_principal_currency_state text, fair_value_comparison_state text, fair_value_delta text, earlier_fair_value_raw text, later_fair_value_raw text, earlier_fair_value_currency_state text, later_fair_value_currency_state text, cost_comparison_state text, cost_delta text, earlier_cost_raw text, later_cost_raw text, maturity_comparison_state text, maturity_changed boolean, earlier_maturity_raw text, later_maturity_raw text, earlier_accession_number text, later_accession_number text, earlier_document_url text, later_document_url text, earlier_position_observation_id text, later_position_observation_id text, changes_definition text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'registry', 'obs'
    AS $$
  WITH earlier_resolved AS (
    SELECT position_id,
           count(*)::integer AS n,
           min(position_observation_id) AS position_observation_id
    FROM registry.bdc_portfolio_period_identity(p_cik, p_earlier)
    WHERE p_earlier < p_later
      AND instrument_resolution_state = 'MATCHED'
      AND continuity_state = 'MATCHED'
      AND position_id IS NOT NULL
    GROUP BY position_id
  ),
  later_resolved AS (
    SELECT position_id,
           count(*)::integer AS n,
           min(position_observation_id) AS position_observation_id
    FROM registry.bdc_portfolio_period_identity(p_cik, p_later)
    WHERE p_earlier < p_later
      AND instrument_resolution_state = 'MATCHED'
      AND continuity_state = 'MATCHED'
      AND position_id IS NOT NULL
    GROUP BY position_id
  ),
  classified AS (
    SELECT 'EXISTING_POSITION_CHANGED'::text AS change_type,
           earlier_resolved.position_observation_id AS earlier_id,
           later_resolved.position_observation_id AS later_id
    FROM earlier_resolved
    JOIN later_resolved ON later_resolved.position_id = earlier_resolved.position_id
    JOIN registry.position_period_comparison compared
      ON compared.earlier_position_observation_id = earlier_resolved.position_observation_id
     AND compared.later_position_observation_id = later_resolved.position_observation_id
     AND compared.earlier_reported_date = p_earlier
     AND compared.later_reported_date = p_later
    WHERE earlier_resolved.n = 1
      AND later_resolved.n = 1
      AND (compared.fair_value_changed IS TRUE
           OR compared.principal_changed IS TRUE
           OR compared.cost_changed IS TRUE
           OR compared.maturity_changed IS TRUE)
    UNION ALL
    SELECT 'NEW_POSITION_OBSERVED',
           NULL::bigint,
           later_resolved.position_observation_id
    FROM later_resolved
    WHERE later_resolved.n = 1
      AND NOT EXISTS (
        SELECT 1
        FROM earlier_resolved earlier_position
        WHERE earlier_position.position_id = later_resolved.position_id)
    UNION ALL
    SELECT 'POSITION_NO_LONGER_OBSERVED',
           earlier_resolved.position_observation_id,
           NULL::bigint
    FROM earlier_resolved
    WHERE earlier_resolved.n = 1
      AND NOT EXISTS (
        SELECT 1
        FROM later_resolved later_position
        WHERE later_position.position_id = earlier_resolved.position_id)
  )
  SELECT classified.change_type,
         p_cik,
         p_earlier::text,
         p_later::text,
         coalesce(later_read.position_id, earlier_read.position_id)::text,
         coalesce(later_read.instrument_id, earlier_read.instrument_id)::text,
         coalesce(later_read.legal_entity_id, earlier_read.legal_entity_id)::text,
         coalesce(later_read.borrower_name_raw, earlier_read.borrower_name_raw),
         coalesce(later_read.holding_descriptor_raw, earlier_read.holding_descriptor_raw),
         coalesce(later_read.instrument_resolution_state, earlier_read.instrument_resolution_state),
         coalesce(later_read.continuity_state, earlier_read.continuity_state),
         CASE
           WHEN instrument_type.n IS NULL OR instrument_type.n = 0 THEN 'UNKNOWN'
           WHEN instrument_type.n = 1 AND instrument_type.reported_n = 1 THEN 'REPORTED'
           ELSE 'MULTIPLE_VALUES'
         END,
         CASE WHEN instrument_type.n = 1 AND instrument_type.reported_n = 1 THEN instrument_type.raw_value END,
         compared.principal_comparison_state,
         compared.principal_delta::text,
         coalesce(compared.earlier_principal_raw, earlier_read.principal_raw),
         coalesce(compared.later_principal_raw, later_read.principal_raw),
         earlier_read.principal_currency_state,
         later_read.principal_currency_state,
         compared.fair_value_comparison_state,
         compared.fair_value_delta::text,
         coalesce(compared.earlier_fair_value_raw, earlier_read.fair_value_raw),
         coalesce(compared.later_fair_value_raw, later_read.fair_value_raw),
         earlier_read.fair_value_currency_state,
         later_read.fair_value_currency_state,
         compared.cost_comparison_state,
         compared.cost_delta::text,
         coalesce(compared.earlier_cost_raw, earlier_read.cost_raw),
         coalesce(compared.later_cost_raw, later_read.cost_raw),
         compared.maturity_comparison_state,
         compared.maturity_changed,
         coalesce(compared.earlier_maturity_raw, earlier_read.maturity_raw),
         coalesce(compared.later_maturity_raw, later_read.maturity_raw),
         coalesce(compared.earlier_accession_number, earlier_read.accession_number),
         coalesce(compared.later_accession_number, later_read.accession_number),
         earlier_doc.document_url,
         later_doc.document_url,
         classified.earlier_id::text,
         classified.later_id::text,
         'portfolio.period_changes.v1'
  FROM classified
  LEFT JOIN registry.position_period_comparison compared
    ON compared.earlier_position_observation_id = classified.earlier_id
   AND compared.later_position_observation_id = classified.later_id
   AND classified.change_type = 'EXISTING_POSITION_CHANGED'
  LEFT JOIN LATERAL (
    SELECT observed.*
    FROM registry.position_read observed
    WHERE observed.position_observation_id = classified.earlier_id
    OFFSET 0
  ) earlier_read ON classified.earlier_id IS NOT NULL
  LEFT JOIN LATERAL (
    SELECT observed.*
    FROM registry.position_read observed
    WHERE observed.position_observation_id = classified.later_id
    OFFSET 0
  ) later_read ON classified.later_id IS NOT NULL
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS n,
           count(*) FILTER (WHERE rf.value_state = 'REPORTED')::integer AS reported_n,
           min(rf.raw_value) AS raw_value
    FROM obs.current_position_research_field rf
    WHERE rf.position_observation_id = coalesce(classified.later_id, classified.earlier_id)
      AND rf.field_code = 'INSTRUMENT_TYPE'
  ) instrument_type ON true
  LEFT JOIN LATERAL (
    SELECT filing_document.document_url
    FROM registry.filing_document filing_document
    WHERE filing_document.filing_id = earlier_read.filing_id
      AND filing_document.document_url ~ '^https://www\.sec\.gov/Archives/edgar/data/'
    ORDER BY CASE WHEN filing_document.named_by = 'SUBMISSIONS_PRIMARY_DOCUMENT' THEN 0 ELSE 1 END,
             filing_document.id
    LIMIT 1
  ) earlier_doc ON true
  LEFT JOIN LATERAL (
    SELECT filing_document.document_url
    FROM registry.filing_document filing_document
    WHERE filing_document.filing_id = later_read.filing_id
      AND filing_document.document_url ~ '^https://www\.sec\.gov/Archives/edgar/data/'
    ORDER BY CASE WHEN filing_document.named_by = 'SUBMISSIONS_PRIMARY_DOCUMENT' THEN 0 ELSE 1 END,
             filing_document.id
    LIMIT 1
  ) later_doc ON true
  ORDER BY classified.change_type, coalesce(later_read.borrower_name_raw, earlier_read.borrower_name_raw), classified.later_id, classified.earlier_id
$$;

COMMENT ON FUNCTION registry.bdc_portfolio_period_changes(p_cik text, p_earlier date, p_later date) IS 'Observable changes between two reporting periods of one CIK under portfolio.period_changes.v1. EXISTING_POSITION_CHANGED copies registry.position_period_comparison for that pair. NEW_POSITION_OBSERVED is a resolved position present only in the later period. POSITION_NO_LONGER_OBSERVED is a resolved position present only in the earlier period. Neither is an origination, a repayment, or a refinancing. An unresolved instrument is absent. A borrower name is not an instrument.';

CREATE FUNCTION registry.bdc_portfolio_period_identity(p_cik text, p_reported_date date) RETURNS TABLE(position_observation_id bigint, position_id uuid, instrument_resolution_state text, continuity_state text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'registry', 'obs'
    AS $$
  SELECT r.position_observation_id,
         r.position_id,
         r.instrument_resolution_state,
         r.continuity_state
  FROM registry.bdc_portfolio_scope(p_cik, p_reported_date) scoped
  JOIN LATERAL (
    SELECT observed.position_observation_id,
           observed.position_id,
           observed.instrument_resolution_state,
           observed.continuity_state
    FROM registry.position_read observed
    WHERE observed.position_observation_id = scoped.position_observation_id
      AND observed.reported_date = p_reported_date
    OFFSET 0
  ) r ON true
$$;

COMMENT ON FUNCTION registry.bdc_portfolio_period_identity(p_cik text, p_reported_date date) IS 'Position identity for one CIK and one reported date. The population is registry.bdc_portfolio_scope. Resolution columns are registry.position_read.';

CREATE FUNCTION registry.bdc_portfolio_period_summary(p_cik text, p_earlier date, p_later date) RETURNS TABLE(earlier_observation_count text, later_observation_count text, unresolved_count text, observed_in_both_count text, changed_count text, new_count text, no_longer_count text, ambiguous_position_count text, changes_definition text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'registry', 'obs'
    AS $$
  WITH earlier_rows AS (
    SELECT *
    FROM registry.bdc_portfolio_period_identity(p_cik, p_earlier)
    WHERE p_earlier < p_later
  ),
  later_rows AS (
    SELECT *
    FROM registry.bdc_portfolio_period_identity(p_cik, p_later)
    WHERE p_earlier < p_later
  ),
  earlier_resolved AS (
    SELECT position_id,
           count(*)::integer AS n,
           min(position_observation_id) AS position_observation_id
    FROM earlier_rows
    WHERE instrument_resolution_state = 'MATCHED'
      AND continuity_state = 'MATCHED'
      AND position_id IS NOT NULL
    GROUP BY position_id
  ),
  later_resolved AS (
    SELECT position_id,
           count(*)::integer AS n,
           min(position_observation_id) AS position_observation_id
    FROM later_rows
    WHERE instrument_resolution_state = 'MATCHED'
      AND continuity_state = 'MATCHED'
      AND position_id IS NOT NULL
    GROUP BY position_id
  )
  SELECT (SELECT count(*) FROM earlier_rows)::text,
         (SELECT count(*) FROM later_rows)::text,
         (
           (SELECT count(*) FROM earlier_rows
            WHERE instrument_resolution_state IS DISTINCT FROM 'MATCHED'
               OR continuity_state IS DISTINCT FROM 'MATCHED'
               OR position_id IS NULL)
           +
           (SELECT count(*) FROM later_rows
            WHERE instrument_resolution_state IS DISTINCT FROM 'MATCHED'
               OR continuity_state IS DISTINCT FROM 'MATCHED'
               OR position_id IS NULL)
         )::text,
         (SELECT count(*)
          FROM earlier_resolved
          JOIN later_resolved USING (position_id)
          WHERE earlier_resolved.n = 1 AND later_resolved.n = 1)::text,
         (SELECT count(*)
          FROM earlier_resolved
          JOIN later_resolved USING (position_id)
          JOIN registry.position_period_comparison compared
            ON compared.earlier_position_observation_id = earlier_resolved.position_observation_id
           AND compared.later_position_observation_id = later_resolved.position_observation_id
           AND compared.earlier_reported_date = p_earlier
           AND compared.later_reported_date = p_later
          WHERE earlier_resolved.n = 1
            AND later_resolved.n = 1
            AND (compared.fair_value_changed IS TRUE
                 OR compared.principal_changed IS TRUE
                 OR compared.cost_changed IS TRUE
                 OR compared.maturity_changed IS TRUE))::text,
         (SELECT count(*)
          FROM later_resolved
          WHERE n = 1
            AND NOT EXISTS (
              SELECT 1 FROM earlier_resolved earlier_position
              WHERE earlier_position.position_id = later_resolved.position_id))::text,
         (SELECT count(*)
          FROM earlier_resolved
          WHERE n = 1
            AND NOT EXISTS (
              SELECT 1 FROM later_resolved later_position
              WHERE later_position.position_id = earlier_resolved.position_id))::text,
         (
           (SELECT count(*) FROM earlier_resolved WHERE n > 1)
           +
           (SELECT count(*) FROM later_resolved WHERE n > 1)
         )::text,
         'portfolio.period_changes.v1'
$$;

COMMENT ON FUNCTION registry.bdc_portfolio_period_summary(p_cik text, p_earlier date, p_later date) IS 'Counts for two reporting periods of one CIK. Counts are stored rows or stored positions, not a score. Unresolved instruments stay out of the change counts. A position with more than one matched observation on a selected date is ambiguous and is not a new or absent position.';

CREATE FUNCTION registry.bdc_portfolio_scope(p_cik text, p_reported_date date) RETURNS TABLE(position_observation_id bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'registry', 'obs'
    AS $$
  SELECT p.id
  FROM registry.portfolio_detail_filing(p_cik) filing
  JOIN obs.position_observation p
    ON p.filing_id = filing.filing_id
   AND p.reported_date = p_reported_date
$$;

COMMENT ON FUNCTION registry.bdc_portfolio_scope(p_cik text, p_reported_date date) IS 'Position observations for one CIK and one reported date. The CIK filter is registry.portfolio_detail_filing. A filing with more than one registrant is absent. Another reported date is absent.';

CREATE FUNCTION registry.bdc_portfolio_summary(p_cik text, p_reported_date date) RETURNS TABLE(observation_count text, resolved_position_count text, unresolved_count text, known_principal_count text, known_fair_value_count text, known_maturity_count text, unknown_currency_count text, principal_aggregation_state text, principal_total text, principal_currency_code text, fair_value_aggregation_state text, fair_value_total text, fair_value_currency_code text, holdings_definition text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'registry', 'obs'
    AS $$
  SELECT count(*)::text,
         count(*) FILTER (
           WHERE instrument_resolution_state = 'MATCHED' AND continuity_state = 'MATCHED'
         )::text,
         count(*) FILTER (
           WHERE instrument_resolution_state IS DISTINCT FROM 'MATCHED'
              OR continuity_state IS DISTINCT FROM 'MATCHED'
         )::text,
         count(*) FILTER (WHERE principal_state = 'REPORTED')::text,
         count(*) FILTER (WHERE fair_value_state = 'REPORTED')::text,
         count(*) FILTER (
           WHERE maturity_source IN ('REPORTED_STRUCTURED', 'FILING_DISPLAYED', 'REPORTED_MONTH', 'FILING_MONTH')
         )::text,
         count(*) FILTER (
           WHERE (principal_state = 'REPORTED' AND principal_currency_state IN ('UNKNOWN', 'AMBIGUOUS'))
              OR (fair_value_state = 'REPORTED' AND fair_value_currency_state IN ('UNKNOWN', 'AMBIGUOUS'))
         )::text,
         CASE
           WHEN count(*) > 0
            AND bool_and(
                  principal_state = 'REPORTED'
                  AND principal_numeric IS NOT NULL
                  AND principal_currency_state IS NOT NULL
                  AND principal_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
                  AND principal_currency_code IS NOT NULL
                )
            AND count(DISTINCT principal_currency_code) = 1
           THEN 'COMPARABLE'
           ELSE 'INSUFFICIENT_DATA'
         END,
         CASE
           WHEN count(*) > 0
            AND bool_and(
                  principal_state = 'REPORTED'
                  AND principal_numeric IS NOT NULL
                  AND principal_currency_state IS NOT NULL
                  AND principal_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
                  AND principal_currency_code IS NOT NULL
                )
            AND count(DISTINCT principal_currency_code) = 1
           THEN sum(principal_numeric::numeric)::text
         END,
         CASE
           WHEN count(*) > 0
            AND bool_and(
                  principal_state = 'REPORTED'
                  AND principal_numeric IS NOT NULL
                  AND principal_currency_state IS NOT NULL
                  AND principal_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
                  AND principal_currency_code IS NOT NULL
                )
            AND count(DISTINCT principal_currency_code) = 1
           THEN min(principal_currency_code)
         END,
         CASE
           WHEN count(*) > 0
            AND bool_and(
                  fair_value_state = 'REPORTED'
                  AND fair_value_numeric IS NOT NULL
                  AND fair_value_currency_state IS NOT NULL
                  AND fair_value_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
                  AND fair_value_currency_code IS NOT NULL
                )
            AND count(DISTINCT fair_value_currency_code) = 1
           THEN 'COMPARABLE'
           ELSE 'INSUFFICIENT_DATA'
         END,
         CASE
           WHEN count(*) > 0
            AND bool_and(
                  fair_value_state = 'REPORTED'
                  AND fair_value_numeric IS NOT NULL
                  AND fair_value_currency_state IS NOT NULL
                  AND fair_value_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
                  AND fair_value_currency_code IS NOT NULL
                )
            AND count(DISTINCT fair_value_currency_code) = 1
           THEN sum(fair_value_numeric::numeric)::text
         END,
         CASE
           WHEN count(*) > 0
            AND bool_and(
                  fair_value_state = 'REPORTED'
                  AND fair_value_numeric IS NOT NULL
                  AND fair_value_currency_state IS NOT NULL
                  AND fair_value_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
                  AND fair_value_currency_code IS NOT NULL
                )
            AND count(DISTINCT fair_value_currency_code) = 1
           THEN min(fair_value_currency_code)
         END,
         'portfolio.holdings.v1'
  FROM (
    SELECT r.instrument_resolution_state,
           r.continuity_state,
           r.principal_state,
           r.principal_numeric,
           r.principal_currency_state,
           principal_code.currency_code AS principal_currency_code,
           r.fair_value_state,
           r.fair_value_numeric,
           r.fair_value_currency_state,
           fair_value_code.currency_code AS fair_value_currency_code,
           r.maturity_source
    FROM registry.bdc_portfolio_scope(p_cik, p_reported_date) scoped
    JOIN LATERAL (
      SELECT observed.*
      FROM registry.position_read observed
      WHERE observed.position_observation_id = scoped.position_observation_id
        AND observed.reported_date = p_reported_date
      OFFSET 0
    ) r ON true
    LEFT JOIN LATERAL (
      SELECT CASE WHEN count(*) = 1 THEN min(fv.currency_code) END AS currency_code
      FROM obs.current_position_field_value fv
      WHERE fv.position_observation_id = r.position_observation_id
        AND fv.field_code = 'PRINCIPAL_AMOUNT'
    ) principal_code ON true
    LEFT JOIN LATERAL (
      SELECT CASE WHEN count(*) = 1 THEN min(fv.currency_code) END AS currency_code
      FROM obs.current_position_field_value fv
      WHERE fv.position_observation_id = r.position_observation_id
        AND fv.field_code = 'FAIR_VALUE'
    ) fair_value_code ON true
  ) holding
$$;

COMMENT ON FUNCTION registry.bdc_portfolio_summary(p_cik text, p_reported_date date) IS 'Observable counts for one CIK and one reported date. Principal and fair value are totaled only when every holding in that date has a reported number and the same known currency. A missing amount is not zero. Unknown currency is not a total. Counts are stored rows, not a score.';

CREATE FUNCTION registry.borrower_maturity_observations(p_legal_entity_id uuid) RETURNS TABLE(legal_entity_id text, position_observation_id text, position_id text, instrument_id text, borrower_name_raw text, reported_date text, accession_number text, registrant_cik text, registrant_link_status text, entity_resolution_state text, instrument_resolution_state text, continuity_state text, instrument_type_state text, instrument_type_raw text, maturity_source text, maturity_raw text, maturity_date text, maturity_precision text, maturity_year text, maturity_month text, maturity_precision_class text, maturity_bucket_year text, maturity_observation_state text, maturity_evidence_id text, maturity_filing_verified boolean, maturity_document_url text, observation_evidence_level text, principal_state text, principal_raw text, principal_numeric text, principal_currency_state text, principal_currency_code text, fair_value_state text, fair_value_raw text, fair_value_numeric text, fair_value_currency_state text, fair_value_currency_code text, refinancing_outcome_state text, maturity_definition text)
    LANGUAGE sql STABLE
    AS $$
  SELECT r.legal_entity_id::text,
         r.position_observation_id::text,
         r.position_id::text,
         r.instrument_id::text,
         r.borrower_name_raw,
         r.reported_date::text,
         r.accession_number,
         r.registrant_cik,
         r.registrant_link_status,
         r.entity_resolution_state,
         r.instrument_resolution_state,
         r.continuity_state,
         CASE
           WHEN instrument_type.n IS NULL OR instrument_type.n = 0 THEN 'UNKNOWN'
           WHEN instrument_type.n = 1 AND instrument_type.reported_n = 1 THEN 'REPORTED'
           ELSE 'MULTIPLE_VALUES'
         END,
         CASE WHEN instrument_type.n = 1 AND instrument_type.reported_n = 1 THEN instrument_type.raw_value END,
         r.maturity_source,
         r.maturity_raw,
         r.maturity_date::text,
         r.maturity_precision,
         r.maturity_year::text,
         r.maturity_month::text,
         CASE
           WHEN r.instrument_resolution_state = 'MATCHED'
            AND r.continuity_state = 'MATCHED'
            AND r.maturity_source IN ('REPORTED_STRUCTURED', 'FILING_DISPLAYED')
            AND r.maturity_date IS NOT NULL
            AND r.maturity_precision IS NULL
           THEN 'DAY'
           WHEN r.instrument_resolution_state = 'MATCHED'
            AND r.continuity_state = 'MATCHED'
            AND r.maturity_precision = 'MONTH'
            AND r.maturity_year IS NOT NULL
            AND r.maturity_month IS NOT NULL
            AND r.maturity_source IN ('REPORTED_MONTH', 'FILING_MONTH')
           THEN 'MONTH'
           ELSE 'NONE'
         END,
         CASE
           WHEN r.instrument_resolution_state = 'MATCHED'
            AND r.continuity_state = 'MATCHED'
            AND r.maturity_source IN ('REPORTED_STRUCTURED', 'FILING_DISPLAYED')
            AND r.maturity_date IS NOT NULL
            AND r.maturity_precision IS NULL
           THEN extract(year FROM r.maturity_date)::integer::text
           WHEN r.instrument_resolution_state = 'MATCHED'
            AND r.continuity_state = 'MATCHED'
            AND r.maturity_precision = 'MONTH'
            AND r.maturity_year IS NOT NULL
            AND r.maturity_month IS NOT NULL
            AND r.maturity_source IN ('REPORTED_MONTH', 'FILING_MONTH')
           THEN r.maturity_year::text
         END,
         CASE
           WHEN r.instrument_resolution_state IS DISTINCT FROM 'MATCHED'
           THEN 'UNRESOLVED_INSTRUMENT'
           WHEN r.continuity_state IS DISTINCT FROM 'MATCHED'
           THEN 'UNRESOLVED_POSITION'
           WHEN r.maturity_source IN ('REPORTED_STRUCTURED', 'FILING_DISPLAYED')
            AND r.maturity_date IS NOT NULL
            AND r.maturity_precision IS NULL
           THEN 'OBSERVED'
           WHEN r.maturity_precision = 'MONTH'
            AND r.maturity_year IS NOT NULL
            AND r.maturity_month IS NOT NULL
            AND r.maturity_source IN ('REPORTED_MONTH', 'FILING_MONTH')
           THEN 'OBSERVED'
           ELSE 'UNKNOWN'
         END,
         r.maturity_evidence_id::text,
         r.maturity_filing_verified,
         r.maturity_document_url,
         r.observation_evidence_level,
         r.principal_state,
         r.principal_raw,
         r.principal_numeric::text,
         r.principal_currency_state,
         principal_code.currency_code,
         r.fair_value_state,
         r.fair_value_raw,
         r.fair_value_numeric::text,
         r.fair_value_currency_state,
         fair_value_code.currency_code,
         'UNKNOWN',
         'maturity.position_history.v1'
  FROM (
    SELECT DISTINCT m.position_observation_id
    FROM registry.matched_entity_position m
    WHERE m.legal_entity_id = p_legal_entity_id
  ) matched
  JOIN LATERAL (
    SELECT observed.*
    FROM registry.position_read observed
    WHERE observed.position_observation_id = matched.position_observation_id
      AND observed.legal_entity_id = p_legal_entity_id
      AND observed.entity_resolution_state = 'MATCHED'
    OFFSET 0
  ) r ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS n,
           count(*) FILTER (WHERE rf.value_state = 'REPORTED')::integer AS reported_n,
           min(rf.raw_value) AS raw_value
    FROM obs.current_position_research_field rf
    WHERE rf.position_observation_id = r.position_observation_id
      AND rf.field_code = 'INSTRUMENT_TYPE'
  ) instrument_type ON true
  LEFT JOIN LATERAL (
    SELECT CASE WHEN count(*) = 1 THEN min(fv.currency_code) END AS currency_code
    FROM obs.current_position_field_value fv
    WHERE fv.position_observation_id = r.position_observation_id
      AND fv.field_code = 'PRINCIPAL_AMOUNT'
  ) principal_code ON true
  LEFT JOIN LATERAL (
    SELECT CASE WHEN count(*) = 1 THEN min(fv.currency_code) END AS currency_code
    FROM obs.current_position_field_value fv
    WHERE fv.position_observation_id = r.position_observation_id
      AND fv.field_code = 'FAIR_VALUE'
  ) fair_value_code ON true
  ORDER BY CASE
             WHEN r.instrument_resolution_state = 'MATCHED'
              AND r.continuity_state = 'MATCHED'
              AND r.maturity_source IN ('REPORTED_STRUCTURED', 'FILING_DISPLAYED')
              AND r.maturity_date IS NOT NULL
              AND r.maturity_precision IS NULL
             THEN 0
             WHEN r.instrument_resolution_state = 'MATCHED'
              AND r.continuity_state = 'MATCHED'
              AND r.maturity_precision = 'MONTH'
              AND r.maturity_year IS NOT NULL
              AND r.maturity_month IS NOT NULL
              AND r.maturity_source IN ('REPORTED_MONTH', 'FILING_MONTH')
             THEN 1
             ELSE 2
           END,
           r.maturity_date ASC NULLS LAST,
           r.maturity_year ASC NULLS LAST,
           r.maturity_month ASC NULLS LAST,
           r.reported_date DESC,
           r.position_observation_id ASC
$$;

COMMENT ON FUNCTION registry.borrower_maturity_observations(p_legal_entity_id uuid) IS 'Historical maturity for one legal entity under maturity.position_history.v1. Values come from registry.position_read. A calendar day is not created from a month. Unknown stays unknown. refinancing_outcome_state is UNKNOWN: a maturity change, a missing later observation, and an acquisition date are not a refinancing or an origination. Unresolved instruments stay out of observed maturity buckets.';

CREATE FUNCTION registry.borrower_maturity_summary(p_legal_entity_id uuid) RETURNS TABLE(resolved_observation_count text, known_maturity_count text, unknown_maturity_count text, unresolved_count text, earliest_calendar_maturity text, earliest_month_maturity text, refinancing_outcome_state text, maturity_definition text)
    LANGUAGE sql STABLE
    AS $$
  SELECT count(*) FILTER (
           WHERE instrument_resolution_state = 'MATCHED' AND continuity_state = 'MATCHED'
         )::text,
         count(*) FILTER (WHERE maturity_observation_state = 'OBSERVED')::text,
         count(*) FILTER (
           WHERE instrument_resolution_state = 'MATCHED'
             AND continuity_state = 'MATCHED'
             AND maturity_observation_state = 'UNKNOWN'
         )::text,
         count(*) FILTER (
           WHERE maturity_observation_state IN ('UNRESOLVED_INSTRUMENT', 'UNRESOLVED_POSITION')
         )::text,
         (array_agg(maturity_raw ORDER BY maturity_date)
            FILTER (WHERE maturity_precision_class = 'DAY'))[1],
         (array_agg(maturity_raw ORDER BY maturity_year::integer, maturity_month::integer)
            FILTER (WHERE maturity_precision_class = 'MONTH'))[1],
         'UNKNOWN',
         'maturity.position_history.v1'
  FROM registry.borrower_maturity_observations(p_legal_entity_id)
$$;

COMMENT ON FUNCTION registry.borrower_maturity_summary(p_legal_entity_id uuid) IS 'Counts for one legal entity. Known maturity is an observed day or month on a resolved position. Earliest calendar maturity and earliest month maturity stay separate. A count is a stored-row count, not exposure. refinancing_outcome_state stays UNKNOWN.';

CREATE FUNCTION registry.borrower_maturity_years(p_legal_entity_id uuid) RETURNS TABLE(maturity_year text, maturity_precision_class text, observation_count text, principal_aggregation_state text, principal_total text, principal_currency_code text, fair_value_aggregation_state text, fair_value_total text, fair_value_currency_code text, maturity_definition text)
    LANGUAGE sql STABLE
    AS $$
  SELECT observed.maturity_bucket_year,
         observed.maturity_precision_class,
         count(*)::text,
         CASE
           WHEN bool_and(
                  observed.principal_state = 'REPORTED'
                  AND observed.principal_numeric IS NOT NULL
                  AND observed.principal_currency_state IS NOT NULL
                  AND observed.principal_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
                  AND observed.principal_currency_code IS NOT NULL
                )
            AND count(DISTINCT observed.principal_currency_code) = 1
           THEN 'COMPARABLE'
           ELSE 'INSUFFICIENT_DATA'
         END,
         CASE
           WHEN bool_and(
                  observed.principal_state = 'REPORTED'
                  AND observed.principal_numeric IS NOT NULL
                  AND observed.principal_currency_state IS NOT NULL
                  AND observed.principal_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
                  AND observed.principal_currency_code IS NOT NULL
                )
            AND count(DISTINCT observed.principal_currency_code) = 1
           THEN sum(observed.principal_numeric::numeric)::text
         END,
         CASE
           WHEN bool_and(
                  observed.principal_state = 'REPORTED'
                  AND observed.principal_numeric IS NOT NULL
                  AND observed.principal_currency_state IS NOT NULL
                  AND observed.principal_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
                  AND observed.principal_currency_code IS NOT NULL
                )
            AND count(DISTINCT observed.principal_currency_code) = 1
           THEN min(observed.principal_currency_code)
         END,
         CASE
           WHEN bool_and(
                  observed.fair_value_state = 'REPORTED'
                  AND observed.fair_value_numeric IS NOT NULL
                  AND observed.fair_value_currency_state IS NOT NULL
                  AND observed.fair_value_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
                  AND observed.fair_value_currency_code IS NOT NULL
                )
            AND count(DISTINCT observed.fair_value_currency_code) = 1
           THEN 'COMPARABLE'
           ELSE 'INSUFFICIENT_DATA'
         END,
         CASE
           WHEN bool_and(
                  observed.fair_value_state = 'REPORTED'
                  AND observed.fair_value_numeric IS NOT NULL
                  AND observed.fair_value_currency_state IS NOT NULL
                  AND observed.fair_value_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
                  AND observed.fair_value_currency_code IS NOT NULL
                )
            AND count(DISTINCT observed.fair_value_currency_code) = 1
           THEN sum(observed.fair_value_numeric::numeric)::text
         END,
         CASE
           WHEN bool_and(
                  observed.fair_value_state = 'REPORTED'
                  AND observed.fair_value_numeric IS NOT NULL
                  AND observed.fair_value_currency_state IS NOT NULL
                  AND observed.fair_value_currency_state NOT IN ('UNKNOWN', 'AMBIGUOUS')
                  AND observed.fair_value_currency_code IS NOT NULL
                )
            AND count(DISTINCT observed.fair_value_currency_code) = 1
           THEN min(observed.fair_value_currency_code)
         END,
         'maturity.position_history.v1'
  FROM registry.borrower_maturity_observations(p_legal_entity_id) observed
  WHERE observed.maturity_observation_state = 'OBSERVED'
  GROUP BY observed.maturity_bucket_year, observed.maturity_precision_class
  ORDER BY observed.maturity_bucket_year, observed.maturity_precision_class
$$;

COMMENT ON FUNCTION registry.borrower_maturity_years(p_legal_entity_id uuid) IS 'Observed maturity counts by stored year and precision. Principal and fair value are summed only when every observation in the bucket has a reported number and the same non-unknown currency code. A missing amount is not zero. Unknown currency is not a total. Fair value is not a substitute for principal. Unresolved instruments are excluded.';

CREATE FUNCTION registry.borrower_position_comparisons(p_legal_entity_id uuid) RETURNS TABLE(legal_entity_id text, position_id text, earlier_position_observation_id text, later_position_observation_id text, earlier_reported_date text, later_reported_date text, earlier_accession_number text, later_accession_number text, earlier_observation_evidence_id text, later_observation_evidence_id text, earlier_observation_evidence_level text, later_observation_evidence_level text, earlier_registrant_cik text, earlier_registrant_link_status text, later_registrant_cik text, later_registrant_link_status text, principal_comparison_state text, earlier_principal_raw text, later_principal_raw text, principal_delta text, earlier_principal_currency_state text, later_principal_currency_state text, cost_comparison_state text, earlier_cost_raw text, later_cost_raw text, cost_delta text, earlier_cost_currency_state text, later_cost_currency_state text, fair_value_comparison_state text, earlier_fair_value_raw text, later_fair_value_raw text, fair_value_delta text, earlier_fair_value_currency_state text, later_fair_value_currency_state text, maturity_comparison_state text, maturity_changed boolean, earlier_maturity_raw text, later_maturity_raw text, earlier_maturity_precision text, later_maturity_precision text, earlier_maturity_date text, later_maturity_date text, acquisition_comparison_state text, earlier_acquisition_raw text, later_acquisition_raw text, earlier_acquisition_precision text, later_acquisition_precision text, earlier_acquisition_date text, later_acquisition_date text, interest_rate_comparison_state text, earlier_interest_rate_raw text, later_interest_rate_raw text, interest_rate_delta text, spread_comparison_state text, earlier_spread_raw text, later_spread_raw text, spread_delta text, interest_rate_floor_comparison_state text, earlier_interest_rate_floor_raw text, later_interest_rate_floor_raw text, interest_rate_floor_delta text)
    LANGUAGE sql STABLE
    AS $$
  SELECT p_legal_entity_id::text,
         c.position_id::text,
         c.earlier_position_observation_id::text,
         c.later_position_observation_id::text,
         c.earlier_reported_date::text,
         c.later_reported_date::text,
         c.earlier_accession_number,
         c.later_accession_number,
         c.earlier_observation_evidence_id::text,
         c.later_observation_evidence_id::text,
         earlier.observation_evidence_level,
         later.observation_evidence_level,
         earlier.registrant_cik,
         earlier.registrant_link_status,
         later.registrant_cik,
         later.registrant_link_status,
         c.principal_comparison_state,
         c.earlier_principal_raw,
         c.later_principal_raw,
         c.principal_delta::text,
         earlier.principal_currency_state,
         later.principal_currency_state,
         c.cost_comparison_state,
         c.earlier_cost_raw,
         c.later_cost_raw,
         c.cost_delta::text,
         earlier.cost_currency_state,
         later.cost_currency_state,
         c.fair_value_comparison_state,
         c.earlier_fair_value_raw,
         c.later_fair_value_raw,
         c.fair_value_delta::text,
         earlier.fair_value_currency_state,
         later.fair_value_currency_state,
         c.maturity_comparison_state,
         c.maturity_changed,
         c.earlier_maturity_raw,
         c.later_maturity_raw,
         c.earlier_maturity_precision,
         c.later_maturity_precision,
         c.earlier_maturity_date::text,
         c.later_maturity_date::text,
         c.acquisition_comparison_state,
         c.earlier_acquisition_raw,
         c.later_acquisition_raw,
         c.earlier_acquisition_precision,
         c.later_acquisition_precision,
         c.earlier_acquisition_date::text,
         c.later_acquisition_date::text,
         c.interest_rate_comparison_state,
         c.earlier_interest_rate_raw,
         c.later_interest_rate_raw,
         c.interest_rate_delta::text,
         c.spread_comparison_state,
         c.earlier_spread_raw,
         c.later_spread_raw,
         c.spread_delta::text,
         c.interest_rate_floor_comparison_state,
         c.earlier_interest_rate_floor_raw,
         c.later_interest_rate_floor_raw,
         c.interest_rate_floor_delta::text
  FROM registry.position_period_comparison c
  JOIN LATERAL (
    SELECT observed.*
    FROM registry.position_read observed
    WHERE observed.position_observation_id = c.earlier_position_observation_id
    OFFSET 0
  ) earlier ON true
  JOIN LATERAL (
    SELECT observed.*
    FROM registry.position_read observed
    WHERE observed.position_observation_id = c.later_position_observation_id
    OFFSET 0
  ) later ON true
  WHERE earlier.legal_entity_id = p_legal_entity_id
    AND later.legal_entity_id = p_legal_entity_id
    AND earlier.entity_resolution_state = 'MATCHED'
    AND later.entity_resolution_state = 'MATCHED'
  ORDER BY c.later_reported_date DESC,
           c.earlier_reported_date DESC,
           later.registrant_cik ASC NULLS LAST,
           c.position_id ASC,
           c.earlier_position_observation_id ASC,
           c.later_position_observation_id ASC
$$;

COMMENT ON FUNCTION registry.borrower_position_comparisons(p_legal_entity_id uuid) IS 'Confirmed position comparisons for one legal entity. Both observations must be MATCHED to that entity on registry.position_read. Values and deltas are copied from registry.position_period_comparison. A field change is not a credit event.';

CREATE FUNCTION registry.borrower_position_observations(p_legal_entity_id uuid) RETURNS TABLE(legal_entity_id text, position_observation_id text, reported_date text, accession_number text, registrant_cik text, registrant_link_status text, entity_resolution_state text, instrument_resolution_state text, continuity_state text, economic_group_state text, principal_state text, principal_raw text, principal_currency_state text, cost_state text, cost_raw text, cost_currency_state text, fair_value_state text, fair_value_raw text, fair_value_currency_state text, acquisition_state text, acquisition_raw text, acquisition_precision text, interest_rate_state text, interest_rate_raw text, spread_state text, spread_raw text, interest_rate_floor_state text, interest_rate_floor_raw text, maturity_source text, maturity_raw text, maturity_precision text, maturity_filing_verified boolean, maturity_document_url text, observation_evidence_level text)
    LANGUAGE sql STABLE
    AS $$
  SELECT r.legal_entity_id::text,
         r.position_observation_id::text,
         r.reported_date::text,
         r.accession_number,
         r.registrant_cik,
         r.registrant_link_status,
         r.entity_resolution_state,
         r.instrument_resolution_state,
         r.continuity_state,
         r.economic_group_state,
         r.principal_state,
         r.principal_raw,
         r.principal_currency_state,
         r.cost_state,
         r.cost_raw,
         r.cost_currency_state,
         r.fair_value_state,
         r.fair_value_raw,
         r.fair_value_currency_state,
         r.acquisition_state,
         r.acquisition_raw,
         r.acquisition_precision,
         r.interest_rate_state,
         r.interest_rate_raw,
         r.spread_state,
         r.spread_raw,
         r.interest_rate_floor_state,
         r.interest_rate_floor_raw,
         r.maturity_source,
         r.maturity_raw,
         r.maturity_precision,
         r.maturity_filing_verified,
         r.maturity_document_url,
         r.observation_evidence_level
  FROM (
    SELECT DISTINCT m.position_observation_id
    FROM registry.matched_entity_position m
    WHERE m.legal_entity_id = p_legal_entity_id
  ) matched
  JOIN LATERAL (
    SELECT observed.*
    FROM registry.position_read observed
    WHERE observed.position_observation_id = matched.position_observation_id
      AND observed.legal_entity_id = p_legal_entity_id
      AND observed.entity_resolution_state = 'MATCHED'
    OFFSET 0
  ) r ON true
  ORDER BY r.reported_date DESC,
           r.registrant_cik ASC NULLS LAST,
           r.accession_number ASC,
           r.position_observation_id ASC
$$;

COMMENT ON FUNCTION registry.borrower_position_observations(p_legal_entity_id uuid) IS 'Matched position observations for one legal entity, read from registry.position_read. Newest reported date first. A missing field stays the stored UNKNOWN state. Absence of a later period is not a row.';

CREATE FUNCTION registry.borrower_position_valuation(p_legal_entity_id uuid) RETURNS TABLE(legal_entity_id text, position_observation_id text, position_id text, instrument_id text, borrower_name_raw text, reported_date text, accession_number text, registrant_cik text, registrant_link_status text, entity_resolution_state text, instrument_resolution_state text, continuity_state text, instrument_type_state text, instrument_type_raw text, instrument_type_evidence_level text, fair_value_state text, fair_value_raw text, fair_value_numeric text, fair_value_currency_state text, fair_value_currency_code text, principal_state text, principal_raw text, principal_numeric text, principal_currency_state text, principal_currency_code text, cost_state text, cost_raw text, cost_numeric text, cost_currency_state text, cost_currency_code text, observation_evidence_id text, observation_evidence_level text, earlier_reported_date text, fair_value_change_state text, fair_value_delta text, fair_value_percentage_state text, fair_value_percentage text, fair_value_to_principal_state text, fair_value_to_principal text, fair_value_to_cost_state text, fair_value_to_cost text, cross_bdc_comparison_state text, valuation_definition text)
    LANGUAGE sql STABLE
    AS $$
  SELECT r.legal_entity_id::text,
         r.position_observation_id::text,
         r.position_id::text,
         r.instrument_id::text,
         r.borrower_name_raw,
         r.reported_date::text,
         r.accession_number,
         r.registrant_cik,
         r.registrant_link_status,
         r.entity_resolution_state,
         r.instrument_resolution_state,
         r.continuity_state,
         CASE
           WHEN instrument_type.n IS NULL OR instrument_type.n = 0 THEN 'UNKNOWN'
           WHEN instrument_type.n = 1 AND instrument_type.reported_n = 1 THEN 'REPORTED'
           ELSE 'MULTIPLE_VALUES'
         END,
         CASE WHEN instrument_type.n = 1 AND instrument_type.reported_n = 1 THEN instrument_type.raw_value END,
         CASE WHEN instrument_type.n = 1 THEN instrument_type.evidence_level END,
         r.fair_value_state,
         r.fair_value_raw,
         r.fair_value_numeric::text,
         r.fair_value_currency_state,
         fair_value_code.currency_code,
         r.principal_state,
         r.principal_raw,
         r.principal_numeric::text,
         r.principal_currency_state,
         principal_code.currency_code,
         r.cost_state,
         r.cost_raw,
         r.cost_numeric::text,
         r.cost_currency_state,
         cost_code.currency_code,
         r.observation_evidence_id::text,
         r.observation_evidence_level,
         cmp.earlier_reported_date::text,
         CASE
           WHEN r.instrument_resolution_state = 'MATCHED'
            AND r.continuity_state = 'MATCHED'
            AND cmp.fair_value_comparison_state IS NOT NULL
           THEN cmp.fair_value_comparison_state
           ELSE 'INSUFFICIENT_DATA'
         END,
         CASE
           WHEN r.instrument_resolution_state = 'MATCHED'
            AND r.continuity_state = 'MATCHED'
           THEN cmp.fair_value_delta::text
         END,
         CASE
           WHEN r.instrument_resolution_state = 'MATCHED'
            AND r.continuity_state = 'MATCHED'
            AND cmp.fair_value_comparison_state = 'COMPARABLE'
            AND cmp.fair_value_delta IS NOT NULL
            AND cmp.earlier_fair_value_numeric IS NOT NULL
            AND cmp.earlier_fair_value_numeric <> 0
            AND r.fair_value_currency_state IS DISTINCT FROM 'AMBIGUOUS'
            AND cmp.earlier_fair_value_currency_state IS DISTINCT FROM 'AMBIGUOUS'
            AND NOT (
              fair_value_code.currency_code IS NOT NULL
              AND cmp.earlier_fair_value_currency_code IS NOT NULL
              AND fair_value_code.currency_code IS DISTINCT FROM cmp.earlier_fair_value_currency_code
            )
           THEN 'COMPARABLE'
           ELSE 'INSUFFICIENT_DATA'
         END,
         CASE
           WHEN r.instrument_resolution_state = 'MATCHED'
            AND r.continuity_state = 'MATCHED'
            AND cmp.fair_value_comparison_state = 'COMPARABLE'
            AND cmp.fair_value_delta IS NOT NULL
            AND cmp.earlier_fair_value_numeric IS NOT NULL
            AND cmp.earlier_fair_value_numeric <> 0
            AND r.fair_value_currency_state IS DISTINCT FROM 'AMBIGUOUS'
            AND cmp.earlier_fair_value_currency_state IS DISTINCT FROM 'AMBIGUOUS'
            AND NOT (
              fair_value_code.currency_code IS NOT NULL
              AND cmp.earlier_fair_value_currency_code IS NOT NULL
              AND fair_value_code.currency_code IS DISTINCT FROM cmp.earlier_fair_value_currency_code
            )
           THEN round(cmp.fair_value_delta / cmp.earlier_fair_value_numeric * 100, 6)::text
         END,
         CASE
           WHEN r.instrument_resolution_state = 'MATCHED'
            AND r.fair_value_state = 'REPORTED'
            AND r.fair_value_numeric IS NOT NULL
            AND r.principal_state = 'REPORTED'
            AND r.principal_numeric IS NOT NULL
            AND r.principal_numeric <> 0
            AND r.fair_value_currency_state IS DISTINCT FROM 'AMBIGUOUS'
            AND r.principal_currency_state IS DISTINCT FROM 'AMBIGUOUS'
            AND NOT (
              fair_value_code.currency_code IS NOT NULL
              AND principal_code.currency_code IS NOT NULL
              AND fair_value_code.currency_code IS DISTINCT FROM principal_code.currency_code
            )
           THEN 'COMPARABLE'
           ELSE 'INSUFFICIENT_DATA'
         END,
         CASE
           WHEN r.instrument_resolution_state = 'MATCHED'
            AND r.fair_value_state = 'REPORTED'
            AND r.fair_value_numeric IS NOT NULL
            AND r.principal_state = 'REPORTED'
            AND r.principal_numeric IS NOT NULL
            AND r.principal_numeric <> 0
            AND r.fair_value_currency_state IS DISTINCT FROM 'AMBIGUOUS'
            AND r.principal_currency_state IS DISTINCT FROM 'AMBIGUOUS'
            AND NOT (
              fair_value_code.currency_code IS NOT NULL
              AND principal_code.currency_code IS NOT NULL
              AND fair_value_code.currency_code IS DISTINCT FROM principal_code.currency_code
            )
           THEN round(r.fair_value_numeric / r.principal_numeric, 6)::text
         END,
         CASE
           WHEN r.instrument_resolution_state = 'MATCHED'
            AND r.fair_value_state = 'REPORTED'
            AND r.fair_value_numeric IS NOT NULL
            AND r.cost_state = 'REPORTED'
            AND r.cost_numeric IS NOT NULL
            AND r.cost_numeric <> 0
            AND r.fair_value_currency_state IS DISTINCT FROM 'AMBIGUOUS'
            AND r.cost_currency_state IS DISTINCT FROM 'AMBIGUOUS'
            AND NOT (
              fair_value_code.currency_code IS NOT NULL
              AND cost_code.currency_code IS NOT NULL
              AND fair_value_code.currency_code IS DISTINCT FROM cost_code.currency_code
            )
           THEN 'COMPARABLE'
           ELSE 'INSUFFICIENT_DATA'
         END,
         CASE
           WHEN r.instrument_resolution_state = 'MATCHED'
            AND r.fair_value_state = 'REPORTED'
            AND r.fair_value_numeric IS NOT NULL
            AND r.cost_state = 'REPORTED'
            AND r.cost_numeric IS NOT NULL
            AND r.cost_numeric <> 0
            AND r.fair_value_currency_state IS DISTINCT FROM 'AMBIGUOUS'
            AND r.cost_currency_state IS DISTINCT FROM 'AMBIGUOUS'
            AND NOT (
              fair_value_code.currency_code IS NOT NULL
              AND cost_code.currency_code IS NOT NULL
              AND fair_value_code.currency_code IS DISTINCT FROM cost_code.currency_code
            )
           THEN round(r.fair_value_numeric / r.cost_numeric, 6)::text
         END,
         'UNAVAILABLE',
         'valuation.position_history.v1'
  FROM (
    SELECT DISTINCT m.position_observation_id
    FROM registry.matched_entity_position m
    WHERE m.legal_entity_id = p_legal_entity_id
  ) matched
  JOIN LATERAL (
    SELECT observed.*
    FROM registry.position_read observed
    WHERE observed.position_observation_id = matched.position_observation_id
      AND observed.legal_entity_id = p_legal_entity_id
      AND observed.entity_resolution_state = 'MATCHED'
    OFFSET 0
  ) r ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS n,
           count(*) FILTER (WHERE rf.value_state = 'REPORTED')::integer AS reported_n,
           min(rf.raw_value) AS raw_value,
           min(rf.evidence_level::text) AS evidence_level
    FROM obs.current_position_research_field rf
    WHERE rf.position_observation_id = r.position_observation_id
      AND rf.field_code = 'INSTRUMENT_TYPE'
  ) instrument_type ON true
  LEFT JOIN LATERAL (
    SELECT CASE WHEN count(*) = 1 THEN min(fv.currency_code) END AS currency_code
    FROM obs.current_position_field_value fv
    WHERE fv.position_observation_id = r.position_observation_id
      AND fv.field_code = 'FAIR_VALUE'
  ) fair_value_code ON true
  LEFT JOIN LATERAL (
    SELECT CASE WHEN count(*) = 1 THEN min(fv.currency_code) END AS currency_code
    FROM obs.current_position_field_value fv
    WHERE fv.position_observation_id = r.position_observation_id
      AND fv.field_code = 'PRINCIPAL_AMOUNT'
  ) principal_code ON true
  LEFT JOIN LATERAL (
    SELECT CASE WHEN count(*) = 1 THEN min(fv.currency_code) END AS currency_code
    FROM obs.current_position_field_value fv
    WHERE fv.position_observation_id = r.position_observation_id
      AND fv.field_code = 'COST'
  ) cost_code ON true
  LEFT JOIN LATERAL (
    SELECT c.earlier_reported_date,
           c.fair_value_comparison_state,
           c.fair_value_delta,
           c.earlier_fair_value_numeric,
           earlier.fair_value_currency_state AS earlier_fair_value_currency_state,
           earlier_code.currency_code AS earlier_fair_value_currency_code
    FROM registry.position_period_comparison c
    JOIN LATERAL (
      SELECT observed.legal_entity_id,
             observed.entity_resolution_state,
             observed.fair_value_currency_state
      FROM registry.position_read observed
      WHERE observed.position_observation_id = c.earlier_position_observation_id
      OFFSET 0
    ) earlier ON true
    LEFT JOIN LATERAL (
      SELECT CASE WHEN count(*) = 1 THEN min(fv.currency_code) END AS currency_code
      FROM obs.current_position_field_value fv
      WHERE fv.position_observation_id = c.earlier_position_observation_id
        AND fv.field_code = 'FAIR_VALUE'
    ) earlier_code ON true
    WHERE r.instrument_resolution_state = 'MATCHED'
      AND r.continuity_state = 'MATCHED'
      AND r.position_id IS NOT NULL
      AND c.position_id = r.position_id
      AND c.later_position_observation_id = r.position_observation_id
      AND earlier.legal_entity_id = p_legal_entity_id
      AND earlier.entity_resolution_state = 'MATCHED'
  ) cmp ON true
  ORDER BY r.reported_date DESC,
           r.registrant_cik ASC NULLS LAST,
           r.accession_number ASC,
           r.position_observation_id ASC
$$;

COMMENT ON FUNCTION registry.borrower_position_valuation(p_legal_entity_id uuid) IS 'Historical valuation for one legal entity under valuation.position_history.v1. The legal entity filter is applied before registry.position_read. A fair-value delta is copied from registry.position_period_comparison. The percentage is that stored delta divided by the earlier fair_value_numeric, times 100, rounded to 6 decimal places, and only when the earlier number is stored and not zero. Fair value / principal and fair value / cost use the stored numerics on one observation and require a non-zero denominator. An unresolved instrument does not receive those figures. Different stored currency codes are not combined. Currency is not converted. cross_bdc_comparison_state stays UNAVAILABLE: a cross-BDC comparison requires a resolved legal entity, a resolved instrument, established position continuity, comparable observations, and compatible currency. Unknown is not zero.';

CREATE FUNCTION registry.borrower_refinancing_outcomes(p_legal_entity_id uuid) RETURNS TABLE(legal_entity_id text, position_id text, instrument_id text, instrument_resolution_state text, continuity_state text, instrument_type_state text, instrument_type_raw text, earlier_position_observation_id text, later_position_observation_id text, earlier_reported_date text, later_reported_date text, event_date text, event_type text, refinancing_outcome_state text, earlier_maturity_raw text, later_maturity_raw text, earlier_maturity_precision text, later_maturity_precision text, earlier_principal_state text, earlier_principal_raw text, earlier_principal_currency_state text, earlier_principal_currency_code text, later_principal_state text, later_principal_raw text, later_principal_currency_state text, later_principal_currency_code text, earlier_accession_number text, later_accession_number text, earlier_observation_evidence_id text, later_observation_evidence_id text, earlier_observation_evidence_level text, later_observation_evidence_level text, registrant_cik text, registrant_link_status text, outcome_definition text)
    LANGUAGE sql STABLE
    AS $$
  SELECT p_legal_entity_id::text,
         c.position_id,
         later.instrument_id::text,
         later.instrument_resolution_state,
         later.continuity_state,
         CASE
           WHEN instrument_type.n IS NULL OR instrument_type.n = 0 THEN 'UNKNOWN'
           WHEN instrument_type.n = 1 AND instrument_type.reported_n = 1 THEN 'REPORTED'
           ELSE 'MULTIPLE_VALUES'
         END,
         CASE WHEN instrument_type.n = 1 AND instrument_type.reported_n = 1 THEN instrument_type.raw_value END,
         c.earlier_position_observation_id,
         c.later_position_observation_id,
         c.earlier_reported_date,
         c.later_reported_date,
         NULL::text,
         'MATURITY_CHANGED',
         'UNKNOWN',
         c.earlier_maturity_raw,
         c.later_maturity_raw,
         c.earlier_maturity_precision,
         c.later_maturity_precision,
         earlier.principal_state,
         earlier.principal_raw,
         earlier.principal_currency_state,
         earlier_principal.currency_code,
         later.principal_state,
         later.principal_raw,
         later.principal_currency_state,
         later_principal.currency_code,
         c.earlier_accession_number,
         c.later_accession_number,
         c.earlier_observation_evidence_id,
         c.later_observation_evidence_id,
         earlier.observation_evidence_level,
         later.observation_evidence_level,
         later.registrant_cik,
         later.registrant_link_status,
         'refinancing.outcome_history.v1'
  FROM registry.borrower_position_comparisons(p_legal_entity_id) c
  JOIN LATERAL (
    SELECT observed.instrument_id,
           observed.instrument_resolution_state,
           observed.continuity_state,
           observed.principal_state,
           observed.principal_raw,
           observed.principal_currency_state,
           observed.observation_evidence_level,
           observed.registrant_cik,
           observed.registrant_link_status
    FROM registry.position_read observed
    WHERE observed.position_observation_id = c.later_position_observation_id::bigint
      AND observed.legal_entity_id = p_legal_entity_id
      AND observed.entity_resolution_state = 'MATCHED'
    OFFSET 0
  ) later ON true
  JOIN LATERAL (
    SELECT observed.instrument_id,
           observed.instrument_resolution_state,
           observed.continuity_state,
           observed.principal_state,
           observed.principal_raw,
           observed.principal_currency_state,
           observed.observation_evidence_level
    FROM registry.position_read observed
    WHERE observed.position_observation_id = c.earlier_position_observation_id::bigint
      AND observed.legal_entity_id = p_legal_entity_id
      AND observed.entity_resolution_state = 'MATCHED'
    OFFSET 0
  ) earlier ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS n,
           count(*) FILTER (WHERE rf.value_state = 'REPORTED')::integer AS reported_n,
           min(rf.raw_value) AS raw_value
    FROM obs.current_position_research_field rf
    WHERE rf.position_observation_id = c.later_position_observation_id::bigint
      AND rf.field_code = 'INSTRUMENT_TYPE'
  ) instrument_type ON true
  LEFT JOIN LATERAL (
    SELECT CASE WHEN count(*) = 1 THEN min(fv.currency_code) END AS currency_code
    FROM obs.current_position_field_value fv
    WHERE fv.position_observation_id = c.earlier_position_observation_id::bigint
      AND fv.field_code = 'PRINCIPAL_AMOUNT'
  ) earlier_principal ON true
  LEFT JOIN LATERAL (
    SELECT CASE WHEN count(*) = 1 THEN min(fv.currency_code) END AS currency_code
    FROM obs.current_position_field_value fv
    WHERE fv.position_observation_id = c.later_position_observation_id::bigint
      AND fv.field_code = 'PRINCIPAL_AMOUNT'
  ) later_principal ON true
  WHERE c.maturity_changed IS TRUE
    AND c.maturity_comparison_state = 'COMPARABLE'
    AND earlier.instrument_resolution_state = 'MATCHED'
    AND later.instrument_resolution_state = 'MATCHED'
    AND earlier.continuity_state = 'MATCHED'
    AND later.continuity_state = 'MATCHED'
    AND earlier.instrument_id IS NOT DISTINCT FROM later.instrument_id
  ORDER BY c.later_reported_date DESC,
           c.earlier_reported_date DESC,
           c.position_id,
           c.later_position_observation_id
$$;

COMMENT ON FUNCTION registry.borrower_refinancing_outcomes(p_legal_entity_id uuid) IS 'Historical outcomes for one legal entity under refinancing.outcome_history.v1. The only emitted event_type is MATURITY_CHANGED, copied from a comparable registry.position_period_comparison row. refinancing_outcome_state is UNKNOWN. event_date is null because a report date is not a transaction date. A missing later observation is not a row. Acquisition date is not an input. No probability, score, or amount is calculated.';

CREATE FUNCTION registry.check_bdc_report_edition() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM evidence.assert_anchor_on_artifact(NEW.evidence_id, NEW.page_artifact_id, NEW.link_href);
  RETURN NEW;
END
$$;

CREATE FUNCTION registry.check_dataset_release() RETURNS trigger
    LANGUAGE plpgsql
    AS $_$
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
$_$;

CREATE FUNCTION registry.check_dataset_release_listing() RETURNS trigger
    LANGUAGE plpgsql
    AS $_$
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
$_$;

CREATE FUNCTION registry.check_filing_document() RETURNS trigger
    LANGUAGE plpgsql
    AS $_$
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
$_$;

CREATE FUNCTION registry.check_filing_registrant_link() RETURNS trigger
    LANGUAGE plpgsql
    AS $_$
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
$_$;

CREATE FUNCTION registry.check_located_value() RETURNS trigger
    LANGUAGE plpgsql
    AS $_$
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
$_$;

CREATE FUNCTION registry.check_name_history_siblings() RETURNS trigger
    LANGUAGE plpgsql
    AS $_$
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
$_$;

CREATE FUNCTION registry.market_date_registrant(p_date date) RETURNS TABLE(registrant_cik text, name_state text, name_raw text, disclosed_line_count integer, maturity_cell_line_count integer, maturity_unknown_line_count integer, principal_cell_line_count integer, principal_unknown_line_count integer, basis_cell_line_count integer, basis_unknown_line_count integer, initial_cell_line_count integer, initial_unknown_line_count integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'registry', 'obs'
    AS $$
  WITH lines AS (
    SELECT p.id, fr.registrant_id, fr.registrant_cik
    FROM obs.position_observation p
    JOIN registry.portfolio_filing_registrant fr
      ON fr.filing_id = p.filing_id AND fr.registrant_link_status = 'LINKED'
    WHERE p.reported_date = p_date
  ),
  cells AS (
    SELECT fv.position_observation_id,
           bool_or(fv.field_code = 'MATURITY_DATE') AS maturity_cell,
           bool_or(fv.field_code = 'PRINCIPAL_AMOUNT') AS principal_cell,
           bool_or(fv.field_code = 'COST') AS basis_cell,
           bool_or(fv.field_code = 'FAIR_VALUE') AS initial_cell
    FROM obs.current_position_field_value fv
    JOIN lines l ON l.id = fv.position_observation_id
    WHERE fv.value_state = 'REPORTED'
      AND fv.field_code IN ('MATURITY_DATE', 'PRINCIPAL_AMOUNT', 'COST', 'FAIR_VALUE')
    GROUP BY fv.position_observation_id
  )
  SELECT l.registrant_cik,
         ns.attribute_state,
         CASE WHEN ns.attribute_state = 'REPORTED' THEN nm.raw_value END,
         count(*)::integer,
         count(*) FILTER (WHERE c.maturity_cell)::integer,
         count(*) FILTER (WHERE c.maturity_cell IS NOT TRUE)::integer,
         count(*) FILTER (WHERE c.principal_cell)::integer,
         count(*) FILTER (WHERE c.principal_cell IS NOT TRUE)::integer,
         count(*) FILTER (WHERE c.basis_cell)::integer,
         count(*) FILTER (WHERE c.basis_cell IS NOT TRUE)::integer,
         count(*) FILTER (WHERE c.initial_cell)::integer,
         count(*) FILTER (WHERE c.initial_cell IS NOT TRUE)::integer
  FROM lines l
  JOIN registry.registrant_attribute_status ns
    ON ns.registrant_id = l.registrant_id AND ns.attribute_code = 'NAME'
  LEFT JOIN cells c ON c.position_observation_id = l.id
  LEFT JOIN LATERAL (
    SELECT min(a.raw_value) AS raw_value
    FROM registry.current_registrant_attribute a
    WHERE a.registrant_id = l.registrant_id AND a.attribute_code = 'NAME'
  ) nm ON ns.attribute_state = 'REPORTED'
  GROUP BY l.registrant_cik, ns.attribute_state, nm.raw_value
$$;

COMMENT ON FUNCTION registry.market_date_registrant(p_date date) IS 'Disclosed-line counts and cell coverage for one reported date. Cell counts are lines with a reported cell. A line without the cell stays in the unknown count. No amount is returned.';

CREATE FUNCTION registry.market_release_date(p_label text) RETURNS TABLE(registrant_cik text, name_state text, name_raw text, reported_date date, disclosed_line_count integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'registry', 'obs', 'raw'
    AS $_$
  SELECT fr.registrant_cik,
         ns.attribute_state,
         CASE WHEN ns.attribute_state = 'REPORTED' THEN nm.raw_value END,
         p.reported_date,
         count(*)::integer
  FROM registry.dataset_release dr
  JOIN registry.dataset_release_artifact dra ON dra.dataset_release_id = dr.id
  JOIN raw.table_load tl ON tl.artifact_id = dra.artifact_id
  JOIN raw.tabular_row tr ON tr.table_load_id = tl.id
  JOIN obs.soi_row_observation o ON o.tabular_row_id = tr.id
  JOIN obs.position_observation p ON p.origin_soi_row_observation_id = o.id
  JOIN registry.portfolio_filing_registrant fr
    ON fr.filing_id = p.filing_id AND fr.registrant_link_status = 'LINKED'
  JOIN registry.registrant_attribute_status ns
    ON ns.registrant_id = fr.registrant_id AND ns.attribute_code = 'NAME'
  LEFT JOIN LATERAL (
    SELECT min(a.raw_value) AS raw_value
    FROM registry.current_registrant_attribute a
    WHERE a.registrant_id = fr.registrant_id AND a.attribute_code = 'NAME'
  ) nm ON ns.attribute_state = 'REPORTED'
  WHERE p_label ~ '^[0-9]{4}(_[0-9]{2}|q[1-4])$'
    AND dr.release_label = p_label
    AND p.reported_date IS NOT NULL
  GROUP BY fr.registrant_cik, ns.attribute_state, nm.raw_value, p.reported_date
$_$;

COMMENT ON FUNCTION registry.market_release_date(p_label text) IS 'Disclosed-line counts by registrant and reported date inside one release. A label outside the release pattern returns no rows. An empty release returns no rows.';

CREATE FUNCTION registry.maturity_coverage(p_cik text) RETURNS TABLE(reported_date date, disclosed_line_count integer, maturity_reported_count integer, maturity_structured_count integer, maturity_filing_count integer, maturity_unknown_count integer, maturity_unresolved_count integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'registry', 'obs'
    AS $$
  SELECT s.reported_date,
         count(*)::integer,
         count(*) FILTER (WHERE s.maturity_date IS NOT NULL)::integer,
         count(*) FILTER (WHERE s.maturity_source = 'REPORTED_STRUCTURED')::integer,
         count(*) FILTER (WHERE s.maturity_source = 'FILING_DISPLAYED')::integer,
         count(*) FILTER (WHERE s.maturity_source = 'UNKNOWN')::integer,
         count(*) FILTER (WHERE s.maturity_source = 'UNRESOLVED')::integer
  FROM registry.maturity_position_for_cik(p_cik) s
  GROUP BY s.reported_date
$$;

CREATE FUNCTION registry.maturity_line_count(p_cik text, p_date date, p_kind text, p_year integer) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'registry', 'obs'
    AS $$
  SELECT count(*)::integer
  FROM registry.maturity_position_for_cik(p_cik) s
  WHERE s.reported_date = p_date
    AND p_kind IN ('all', 'unknown', 'unresolved', 'year')
    AND (
      p_kind = 'all'
      OR (p_kind = 'unknown' AND s.maturity_source = 'UNKNOWN')
      OR (p_kind = 'unresolved' AND s.maturity_source = 'UNRESOLVED')
      OR (p_kind = 'year' AND p_year BETWEEN 0 AND 9999
          AND s.maturity_date IS NOT NULL
          AND extract(YEAR FROM s.maturity_date)::integer = p_year)
    )
$$;

CREATE FUNCTION registry.maturity_line_page(p_cik text, p_date date, p_kind text, p_year integer, p_limit integer, p_offset integer) RETURNS TABLE(position_observation_id bigint, disclosed_line_text text, principal_state text, principal_raw text, principal_currency_state text, maturity_source text, maturity_raw text, maturity_year integer, maturity_inspection_state text, maturity_no_bind_reason text, maturity_filing_verified boolean, maturity_document_url text, accession_number text, evidence_level text, form_state text, form_raw text, filed_date_state text, filed_date_raw text, inline_url_state text, inline_url text, document_url text, release_state text, release_label text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'registry', 'obs'
    AS $$
  SELECT page.position_observation_id,
         p.holding_descriptor_raw,
         principal.principal_state,
         principal.principal_raw,
         'UNKNOWN'::text,
         page.maturity_source,
         page.maturity_raw,
         extract(YEAR FROM page.maturity_date)::integer,
         page.inspection_state,
         page.no_bind_reason,
         page.filing_verified,
         page.maturity_document_url,
         f.accession_number,
         e.evidence_level::text,
         form.form_state,
         form.form_raw,
         filed.filed_date_state,
         filed.filed_date_raw,
         inline_url.inline_url_state,
         inline_url.inline_url,
         doc.document_url,
         rel.release_state,
         rel.release_label
  FROM (
    SELECT s.position_observation_id, s.maturity_source, s.maturity_raw, s.maturity_date,
           s.inspection_state, s.no_bind_reason, s.filing_verified, s.maturity_document_url
    FROM registry.maturity_position_for_cik(p_cik) s
    WHERE s.reported_date = p_date
      AND p_kind IN ('all', 'unknown', 'unresolved', 'year')
      AND (
        p_kind = 'all'
        OR (p_kind = 'unknown' AND s.maturity_source = 'UNKNOWN')
        OR (p_kind = 'unresolved' AND s.maturity_source = 'UNRESOLVED')
        OR (p_kind = 'year' AND p_year BETWEEN 0 AND 9999
            AND s.maturity_date IS NOT NULL
            AND extract(YEAR FROM s.maturity_date)::integer = p_year)
      )
    ORDER BY s.position_observation_id
    LIMIT CASE WHEN p_limit BETWEEN 1 AND 50 THEN p_limit ELSE 0 END
    OFFSET CASE WHEN p_offset BETWEEN 0 AND 1000000 THEN p_offset ELSE 0 END
  ) page
  JOIN obs.position_observation p ON p.id = page.position_observation_id
  JOIN registry.filing f ON f.id = p.filing_id
  JOIN evidence.evidence e ON e.id = p.evidence_id
  LEFT JOIN LATERAL (
    SELECT
      CASE WHEN count(DISTINCT fv.raw_value) = 1 THEN 'REPORTED'
           WHEN count(*) = 0 THEN 'UNKNOWN'
           ELSE 'MULTIPLE_VALUES' END AS principal_state,
      CASE WHEN count(DISTINCT fv.raw_value) = 1 THEN min(fv.raw_value) END AS principal_raw
    FROM obs.current_position_field_value fv
    WHERE fv.position_observation_id = p.id AND fv.field_code = 'PRINCIPAL_AMOUNT'
  ) principal ON true
  LEFT JOIN LATERAL (
    SELECT
      CASE WHEN count(DISTINCT fa.normalized_text) = 1 THEN 'REPORTED'
           WHEN count(*) = 0 THEN 'UNKNOWN'
           ELSE 'MULTIPLE_VALUES' END AS form_state,
      CASE WHEN count(DISTINCT fa.normalized_text) = 1 THEN min(fa.normalized_text) END AS form_raw
    FROM registry.current_filing_attribute fa
    WHERE fa.filing_id = p.filing_id AND fa.attribute_code = 'FORM' AND fa.value_state = 'REPORTED'
  ) form ON true
  LEFT JOIN LATERAL (
    SELECT
      CASE WHEN count(DISTINCT fa.normalized_date) = 1 THEN 'REPORTED'
           WHEN count(*) = 0 THEN 'UNKNOWN'
           ELSE 'MULTIPLE_VALUES' END AS filed_date_state,
      CASE WHEN count(DISTINCT fa.normalized_date) = 1 THEN min(fa.normalized_date)::text END AS filed_date_raw
    FROM registry.current_filing_attribute fa
    WHERE fa.filing_id = p.filing_id AND fa.attribute_code = 'FILED_DATE' AND fa.value_state = 'REPORTED'
  ) filed ON true
  LEFT JOIN LATERAL (
    SELECT
      CASE WHEN count(DISTINCT fa.raw_value) = 1
            AND min(fa.raw_value) ~ '^https://www\.sec\.gov/(Archives/edgar/data/|ix\?doc=/Archives/edgar/data/)'
           THEN 'REPORTED'
           WHEN count(*) = 0 THEN 'UNKNOWN'
           ELSE 'MULTIPLE_VALUES' END AS inline_url_state,
      CASE WHEN count(DISTINCT fa.raw_value) = 1
            AND min(fa.raw_value) ~ '^https://www\.sec\.gov/(Archives/edgar/data/|ix\?doc=/Archives/edgar/data/)'
           THEN min(fa.raw_value) END AS inline_url
    FROM registry.current_filing_attribute fa
    WHERE fa.filing_id = p.filing_id AND fa.attribute_code = 'INLINE_URL' AND fa.value_state = 'REPORTED'
  ) inline_url ON true
  LEFT JOIN LATERAL (
    SELECT filing_document.document_url
    FROM registry.filing_document
    WHERE filing_document.filing_id = p.filing_id
      AND filing_document.document_url ~ '^https://www\.sec\.gov/Archives/edgar/data/'
    ORDER BY CASE WHEN filing_document.named_by = 'SUBMISSIONS_PRIMARY_DOCUMENT' THEN 0 ELSE 1 END, filing_document.id
    LIMIT 1
  ) doc ON true
  LEFT JOIN LATERAL (
    SELECT
      CASE WHEN count(DISTINCT dr.release_label) = 1 THEN 'REPORTED'
           WHEN count(*) = 0 THEN 'UNKNOWN'
           ELSE 'MULTIPLE_VALUES' END AS release_state,
      CASE WHEN count(DISTINCT dr.release_label) = 1 THEN min(dr.release_label) END AS release_label
    FROM obs.soi_row_observation o
    JOIN raw.tabular_row tr ON tr.id = o.tabular_row_id
    JOIN raw.table_load tl ON tl.id = tr.table_load_id
    JOIN registry.dataset_release_artifact dra ON dra.artifact_id = tl.artifact_id
    JOIN registry.dataset_release dr ON dr.id = dra.dataset_release_id
    WHERE o.id = p.origin_soi_row_observation_id
  ) rel ON true
  ORDER BY page.position_observation_id
$$;

CREATE FUNCTION registry.maturity_position_for_cik(p_cik text) RETURNS TABLE(position_observation_id bigint, reported_date date, maturity_date date, maturity_raw text, maturity_source text, inspection_state text, no_bind_reason text, filing_verified boolean, maturity_document_url text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'registry', 'obs'
    AS $_$
  SELECT mp.position_observation_id,
         mp.reported_date,
         mp.maturity_date,
         mp.maturity_raw,
         mp.maturity_source,
         mp.inspection_state,
         mp.no_bind_reason,
         mp.filing_verified,
         mp.maturity_document_url
  FROM registry.maturity_position mp
  WHERE mp.registrant_cik = p_cik
    AND p_cik ~ '^[0-9]{10}$'
$_$;

CREATE FUNCTION registry.maturity_years(p_cik text) RETURNS TABLE(reported_date date, maturity_year integer, disclosed_line_count integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'registry', 'obs'
    AS $$
  SELECT s.reported_date,
         extract(YEAR FROM s.maturity_date)::integer,
         count(*)::integer
  FROM registry.maturity_position_for_cik(p_cik) s
  WHERE s.maturity_date IS NOT NULL
  GROUP BY s.reported_date, extract(YEAR FROM s.maturity_date)
$$;

CREATE FUNCTION registry.portfolio_detail_dates(p_cik text) RETURNS TABLE(reported_date date, disclosed_line_count integer, point_in_time_line_count integer, duration_line_count integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'registry', 'obs'
    AS $$
  SELECT p.reported_date,
         count(*)::integer,
         count(*) FILTER (WHERE p.duration_kind = 'POINT_IN_TIME')::integer,
         count(*) FILTER (WHERE p.duration_kind = 'DURATION')::integer
  FROM obs.position_observation p
  WHERE p.reported_date IS NOT NULL
    AND p.filing_id IN (SELECT e.filing_id FROM registry.portfolio_detail_filing(p_cik) e)
  GROUP BY p.reported_date;
$$;

COMMENT ON FUNCTION registry.portfolio_detail_dates(p_cik text) IS 'Disclosed-line counts for one registrant by reported date. A date that is absent was not observed. Counts are rows, not amounts.';

CREATE FUNCTION registry.portfolio_detail_filing(p_cik text) RETURNS TABLE(filing_id bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'registry', 'obs'
    AS $_$
  WITH reg AS (
    SELECT r.id
    FROM registry.registrant r
    WHERE r.cik = CASE WHEN p_cik ~ '^[0-9]{10}$' THEN p_cik::bigint END
  ),
  touched AS (
    SELECT DISTINCT l.filing_id
    FROM registry.filing_registrant_link l
    JOIN reg ON reg.id = l.registrant_id
    WHERE NOT EXISTS (
      SELECT 1 FROM registry.filing_registrant_link s WHERE s.supersedes_id = l.id
    )
  ),
  heads AS (
    SELECT l.filing_id, l.registrant_id, rr.cik
    FROM registry.filing_registrant_link l
    JOIN touched t ON t.filing_id = l.filing_id
    JOIN registry.registrant rr ON rr.id = l.registrant_id
    WHERE NOT EXISTS (
      SELECT 1 FROM registry.filing_registrant_link s WHERE s.supersedes_id = l.id
    )
  )
  SELECT h.filing_id
  FROM heads h
  GROUP BY h.filing_id
  HAVING count(DISTINCT h.registrant_id) = 1
     AND count(DISTINCT h.cik) = 1;
$_$;

COMMENT ON FUNCTION registry.portfolio_detail_filing(p_cik text) IS 'Current filing heads for one CIK. A filing stays only when every current link names that one registrant and one CIK.';

CREATE FUNCTION registry.portfolio_detail_names(p_cik text) RETURNS TABLE(source_type_code text, raw_value text, documentation_status text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'registry', 'obs'
    AS $_$
  SELECT a.source_type_code,
         a.raw_value,
         a.documentation_status::text
  FROM registry.current_registrant_attribute a
  JOIN registry.registrant r ON r.id = a.registrant_id
  WHERE r.cik = CASE WHEN p_cik ~ '^[0-9]{10}$' THEN p_cik::bigint END
    AND a.attribute_code = 'NAME'
    AND EXISTS (
      SELECT 1 FROM registry.portfolio_detail_registrant(p_cik)
    );
$_$;

COMMENT ON FUNCTION registry.portfolio_detail_names(p_cik text) IS 'Each current registrant-name source for a portfolio registrant, unmerged.';

CREATE FUNCTION registry.portfolio_detail_registrant(p_cik text) RETURNS TABLE(registrant_cik text, name_state text, name_raw text, ticker_state text, ticker_raw text, file_number_state text, file_number_raw text, reported_date_count integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'registry', 'obs'
    AS $_$
  WITH reg AS (
    SELECT r.id, lpad(r.cik::text, 10, '0') AS registrant_cik
    FROM registry.registrant r
    WHERE r.cik = CASE WHEN p_cik ~ '^[0-9]{10}$' THEN p_cik::bigint END
  ),
  attrs AS (
    SELECT a.attribute_code,
           CASE WHEN count(c.observation_id) = 0 THEN 'UNKNOWN'
                WHEN count(DISTINCT c.raw_value) > 1 THEN 'MULTIPLE_VALUES'
                ELSE 'REPORTED' END AS attribute_state,
           min(c.raw_value) AS raw_value
    FROM reg
    CROSS JOIN (VALUES ('NAME'::text), ('TICKER'::text), ('FILE_NUMBER'::text)) AS a(attribute_code)
    LEFT JOIN registry.current_registrant_attribute c
      ON c.registrant_id = reg.id AND c.attribute_code = a.attribute_code
    GROUP BY a.attribute_code
  )
  SELECT reg.registrant_cik,
         n.attribute_state,
         CASE WHEN n.attribute_state = 'REPORTED' THEN n.raw_value END,
         t.attribute_state,
         CASE WHEN t.attribute_state = 'REPORTED' THEN t.raw_value END,
         f.attribute_state,
         CASE WHEN f.attribute_state = 'REPORTED' THEN f.raw_value END,
         (SELECT count(DISTINCT p.reported_date)::integer
          FROM obs.position_observation p
          WHERE p.filing_id IN (SELECT e.filing_id FROM registry.portfolio_detail_filing(p_cik) e))
  FROM reg
  JOIN attrs n ON n.attribute_code = 'NAME'
  JOIN attrs t ON t.attribute_code = 'TICKER'
  JOIN attrs f ON f.attribute_code = 'FILE_NUMBER'
  WHERE EXISTS (
    SELECT 1
    FROM obs.position_observation p
    WHERE p.filing_id IN (SELECT e.filing_id FROM registry.portfolio_detail_filing(p_cik) e)
  );
$_$;

COMMENT ON FUNCTION registry.portfolio_detail_registrant(p_cik text) IS 'One portfolio registrant for a CIK that has position observations. A name, ticker, or file number is present only when current sources agree.';

CREATE FUNCTION registry.review_case_read(p_case_key text) RETURNS json
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'review', 'registry', 'obs', 'evidence', 'resolution', 'ref'
    AS $_$
  WITH members AS MATERIALIZED (
    SELECT m.position_observation_id,
           p.filing_id,
           p.reported_date,
           p.holding_descriptor_raw,
           p.evidence_id
    FROM review.current_candidate c
    JOIN review.candidate_member m ON m.candidate_id = c.candidate_id
    JOIN obs.position_observation p ON p.id = m.position_observation_id
    WHERE c.case_key = p_case_key
      AND p_case_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  linked AS MATERIALIZED (
    SELECT m.position_observation_id,
           m.filing_id,
           m.reported_date,
           m.holding_descriptor_raw,
           m.evidence_id,
           reg.registrant_cik
    FROM members m
    JOIN LATERAL (
      SELECT CASE
               WHEN count(DISTINCT l.registrant_id) = 1 AND count(DISTINCT r.cik) = 1
               THEN lpad(min(r.cik)::text, 10, '0')
             END AS registrant_cik
      FROM registry.filing_registrant_link l
      JOIN registry.registrant r ON r.id = l.registrant_id
      WHERE l.filing_id = m.filing_id
        AND NOT EXISTS (
          SELECT 1 FROM registry.filing_registrant_link s WHERE s.supersedes_id = l.id
        )
    ) reg ON reg.registrant_cik IS NOT NULL
  ),
  case_filings AS MATERIALIZED (
    SELECT DISTINCT filing_id FROM linked
  ),
  chosen_document AS MATERIALIZED (
    SELECT DISTINCT ON (doc.filing_id)
           doc.filing_id,
           doc.document_name,
           doc.document_url
    FROM case_filings cf
    JOIN registry.filing_document doc ON doc.filing_id = cf.filing_id
    WHERE doc.document_url ~ '^https://www\.sec\.gov/Archives/edgar/data/'
    ORDER BY doc.filing_id,
             CASE WHEN doc.named_by = 'SUBMISSIONS_PRIMARY_DOCUMENT' THEN 0 ELSE 1 END,
             doc.id
  ),
  lines AS (
    SELECT m.position_observation_id,
           m.registrant_cik,
           m.reported_date,
           m.holding_descriptor_raw AS disclosed_line_text,
           f.accession_number,
           e.evidence_level,
           form.form_state,
           form.form_raw,
           filed.filed_date_state,
           filed.filed_date_raw,
           inline_url.inline_url_state,
           inline_url.inline_url,
           doc.document_name,
           doc.document_url
    FROM linked m
    JOIN registry.filing f ON f.id = m.filing_id
    JOIN evidence.evidence e ON e.id = m.evidence_id
    LEFT JOIN LATERAL (
      SELECT CASE
               WHEN count(DISTINCT o.normalized_text) = 1 THEN 'REPORTED'
               WHEN count(*) = 0 THEN 'UNKNOWN'
               ELSE 'MULTIPLE_VALUES'
             END AS form_state,
             CASE
               WHEN count(DISTINCT o.normalized_text) = 1 THEN min(o.normalized_text)
             END AS form_raw
      FROM registry.filing_attribute_observation o
      WHERE o.filing_id = m.filing_id
        AND o.attribute_code = 'FORM'
        AND o.value_state = 'REPORTED'
        AND NOT EXISTS (
          SELECT 1 FROM registry.filing_attribute_observation s WHERE s.supersedes_id = o.id
        )
    ) form ON true
    LEFT JOIN LATERAL (
      SELECT CASE
               WHEN count(DISTINCT o.normalized_date) = 1 THEN 'REPORTED'
               WHEN count(*) = 0 THEN 'UNKNOWN'
               ELSE 'MULTIPLE_VALUES'
             END AS filed_date_state,
             CASE
               WHEN count(DISTINCT o.normalized_date) = 1 THEN min(o.normalized_date)::text
             END AS filed_date_raw
      FROM registry.filing_attribute_observation o
      WHERE o.filing_id = m.filing_id
        AND o.attribute_code = 'FILED_DATE'
        AND o.value_state = 'REPORTED'
        AND NOT EXISTS (
          SELECT 1 FROM registry.filing_attribute_observation s WHERE s.supersedes_id = o.id
        )
    ) filed ON true
    LEFT JOIN LATERAL (
      SELECT CASE
               WHEN count(DISTINCT o.raw_value) = 1
                AND min(o.raw_value) ~ '^https://www\.sec\.gov/(Archives/edgar/data/|ix\?doc=/Archives/edgar/data/)'
                 THEN 'REPORTED'
               WHEN count(*) = 0 THEN 'UNKNOWN'
               ELSE 'MULTIPLE_VALUES'
             END AS inline_url_state,
             CASE
               WHEN count(DISTINCT o.raw_value) = 1
                AND min(o.raw_value) ~ '^https://www\.sec\.gov/(Archives/edgar/data/|ix\?doc=/Archives/edgar/data/)'
                 THEN min(o.raw_value)
             END AS inline_url
      FROM registry.filing_attribute_observation o
      WHERE o.filing_id = m.filing_id
        AND o.attribute_code = 'INLINE_URL'
        AND o.value_state = 'REPORTED'
        AND NOT EXISTS (
          SELECT 1 FROM registry.filing_attribute_observation s WHERE s.supersedes_id = o.id
        )
    ) inline_url ON true
    LEFT JOIN chosen_document doc ON doc.filing_id = m.filing_id
  ),
  maturity_rows AS (
    SELECT m.position_observation_id,
           mp.provenance_state::text AS provenance_state,
           mp.maturity_raw
    FROM linked m
    JOIN obs.maturity_provenance mp ON mp.position_observation_id = m.position_observation_id
  )
  SELECT json_build_object(
    'lines', COALESCE((
      SELECT json_agg(row_to_json(line) ORDER BY line.disclosed_line_text, line.reported_date, line.accession_number, line.position_observation_id)
      FROM (
        SELECT position_observation_id::text,
               registrant_cik,
               reported_date::text,
               disclosed_line_text,
               accession_number,
               evidence_level::text,
               form_state,
               form_raw,
               filed_date_state,
               filed_date_raw,
               inline_url_state,
               inline_url,
               document_name,
               document_url
        FROM lines
      ) line
    ), '[]'::json),
    'fields', COALESCE((
      SELECT json_agg(row_to_json(field))
      FROM (
        SELECT m.position_observation_id::text,
               fv.field_code,
               fv.raw_value,
               fv.value_state::text,
               fv.scale_state::text,
               fv.source_column_label,
               fv.date_precision,
               fv.normalized_year,
               fv.normalized_month,
               fv.normalized_date
        FROM linked m
        JOIN LATERAL (
          SELECT field_code, raw_value, value_state, scale_state, source_column_label,
                 date_precision, normalized_year, normalized_month, normalized_date
          FROM obs.position_field_value fv
          WHERE fv.position_observation_id = m.position_observation_id
            AND fv.field_code IN (
              'PRINCIPAL_AMOUNT', 'COST', 'FAIR_VALUE', 'INTEREST_RATE', 'SPREAD', 'PERCENT_OF_NET_ASSETS',
              'INSTRUMENT_TYPE', 'INDUSTRY', 'GEOGRAPHY', 'ACQUISITION_DATE', 'ISSUER_AFFILIATION', 'MATURITY_DATE'
            )
            AND NOT EXISTS (
              SELECT 1 FROM obs.position_field_value s WHERE s.supersedes_id = fv.id
            )
        ) fv ON true
      ) field
    ), '[]'::json),
    'names', COALESCE((
      SELECT json_agg(row_to_json(name))
      FROM (
        SELECT DISTINCT ri.registrant_cik, n.name_raw
        FROM (
          SELECT DISTINCT r.id AS registrant_id, lpad(r.cik::text, 10, '0') AS registrant_cik
          FROM linked m
          JOIN registry.filing_registrant_link l ON l.filing_id = m.filing_id
          JOIN registry.registrant r ON r.id = l.registrant_id
          WHERE NOT EXISTS (
            SELECT 1 FROM registry.filing_registrant_link s WHERE s.supersedes_id = l.id
          )
        ) ri
        JOIN LATERAL (
          SELECT h.name_raw
          FROM registry.registrant_name_history_observation h
          JOIN evidence.evidence e ON e.id = h.evidence_id
          WHERE h.registrant_id = ri.registrant_id
            AND NOT EXISTS (
              SELECT 1 FROM registry.registrant_name_history_observation s WHERE s.supersedes_id = h.id
            )
        ) n ON true
      ) name
    ), '[]'::json),
    'instruments', COALESCE((
      SELECT json_agg(row_to_json(instrument))
      FROM (
        SELECT m.position_observation_id::text, d.state::text
        FROM linked m
        JOIN LATERAL (
          SELECT state
          FROM resolution.instrument_resolution_decision d
          WHERE d.position_observation_id = m.position_observation_id
            AND NOT EXISTS (
              SELECT 1 FROM resolution.instrument_resolution_decision s WHERE s.supersedes_id = d.id
            )
        ) d ON true
      ) instrument
    ), '[]'::json),
    'maturity', COALESCE((
      SELECT json_agg(row_to_json(maturity))
      FROM (
        SELECT position_observation_id::text,
               provenance_state AS maturity_source,
               maturity_raw
        FROM maturity_rows
      ) maturity
    ), '[]'::json),
    'entity_resolution_count', (SELECT count(*)::int FROM resolution.current_entity_resolution),
    'group_membership_count', (SELECT count(*)::int FROM resolution.current_group_membership)
  );
$_$;

COMMENT ON FUNCTION registry.review_case_read(p_case_key text) IS 'One research case, read from its current members whose filing has one current registrant and one CIK. Filing form, filed date, inline URL, document, field values, and maturity are looked up for those positions only. A missing field stays absent. A calendar-day maturity stays REPORTED_STRUCTURED. A single MONTH field stays REPORTED_MONTH. A filing month stays FILING_MONTH. Both keep the raw month text and a null maturity date. This does not resolve a borrower or an instrument.';

CREATE FUNCTION resolution.check_position_continuity() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.position_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM identity.position pos
    JOIN obs.position_observation po ON po.id = NEW.position_observation_id
    JOIN registry.filing_registrant_link l ON l.filing_id = po.filing_id AND l.registrant_id = pos.registrant_id
    WHERE pos.id = NEW.position_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'position continuity requires the observation filing to be linked to the position registrant';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION review.add_evidence_set(p_candidate_id bigint, p_title text, p_description text, p_created_by text) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'review'
    AS $$
DECLARE
  new_id bigint;
BEGIN
  PERFORM review.assert_writer();
  INSERT INTO review.evidence_set (candidate_id, title, description, created_by)
  VALUES (p_candidate_id, p_title, p_description, p_created_by)
  RETURNING id INTO new_id;
  RETURN new_id;
END
$$;

CREATE FUNCTION review.add_external_evidence(p_candidate_id bigint, p_source_type text, p_title text, p_source_url text, p_document_date date, p_relevant_excerpt text, p_position_observation_id bigint, p_created_by text) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'review'
    AS $$
DECLARE
  new_id bigint;
BEGIN
  PERFORM review.assert_writer();
  INSERT INTO review.evidence_item (
    candidate_id, origin, source_type, title, source_url, document_date,
    retrieved_at, relevant_excerpt, position_observation_id, created_by)
  VALUES (
    p_candidate_id, 'EXTERNAL', p_source_type::review.source_type, p_title, p_source_url,
    p_document_date, clock_timestamp(), p_relevant_excerpt, p_position_observation_id, p_created_by)
  RETURNING id INTO new_id;
  RETURN new_id;
END
$$;

CREATE FUNCTION review.add_internal_evidence(p_candidate_id bigint, p_title text, p_position_observation_id bigint, p_filing_document_id bigint, p_evidence_id bigint, p_created_by text) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'review'
    AS $$
DECLARE
  new_id bigint;
BEGIN
  PERFORM review.assert_writer();
  INSERT INTO review.evidence_item (
    candidate_id, origin, source_type, title,
    position_observation_id, filing_document_id, evidence_id, created_by)
  VALUES (
    p_candidate_id, 'INTERNAL', 'INTERNAL_SEC_FILING', p_title,
    p_position_observation_id, p_filing_document_id, p_evidence_id, p_created_by)
  RETURNING id INTO new_id;
  RETURN new_id;
END
$$;

CREATE FUNCTION review.add_member(p_candidate_id bigint, p_position_observation_id bigint, p_borrower_name_observation_id bigint, p_created_by text) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'review'
    AS $$
DECLARE
  new_id bigint;
BEGIN
  PERFORM review.assert_writer();
  INSERT INTO review.candidate_member (
    candidate_id, position_observation_id, borrower_name_observation_id, created_by)
  VALUES (p_candidate_id, p_position_observation_id, p_borrower_name_observation_id, p_created_by)
  RETURNING id INTO new_id;
  RETURN new_id;
END
$$;

CREATE FUNCTION review.add_note(p_candidate_id bigint, p_evidence_item_id bigint, p_note_text text, p_created_by text) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'review'
    AS $$
DECLARE
  new_id bigint;
BEGIN
  PERFORM review.assert_writer();
  INSERT INTO review.researcher_note (candidate_id, evidence_item_id, note_text, created_by)
  VALUES (p_candidate_id, p_evidence_item_id, p_note_text, p_created_by)
  RETURNING id INTO new_id;
  RETURN new_id;
END
$$;

CREATE FUNCTION review.add_set_member(p_evidence_set_id bigint, p_evidence_item_id bigint, p_created_by text) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'review'
    AS $$
DECLARE
  new_id bigint;
BEGIN
  PERFORM review.assert_writer();
  INSERT INTO review.evidence_set_member (evidence_set_id, evidence_item_id, created_by)
  VALUES (p_evidence_set_id, p_evidence_item_id, p_created_by)
  RETURNING id INTO new_id;
  RETURN new_id;
END
$$;

CREATE FUNCTION review.assert_writer() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF session_user IS DISTINCT FROM 'review_writer'
     AND NOT pg_has_role(session_user, 'review_writer', 'MEMBER') THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'review writes require review_writer';
  END IF;
END
$$;

CREATE FUNCTION review.check_candidate_member() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'obs'
    AS $$
BEGIN
  IF NEW.borrower_name_observation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM obs.borrower_name_observation b
    WHERE b.id = NEW.borrower_name_observation_id
      AND b.position_observation_id = NEW.position_observation_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'borrower name observation does not belong to this position observation';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION review.check_candidate_status() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'review'
    AS $$
BEGIN
  IF NEW.supersedes_id IS NULL AND NEW.status IS DISTINCT FROM 'OPEN' THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'a review candidate opens as OPEN';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION review.check_evidence_item() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'review', 'obs', 'registry'
    AS $$
BEGIN
  IF NEW.position_observation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM review.candidate_member m
    WHERE m.candidate_id = NEW.candidate_id
      AND m.position_observation_id = NEW.position_observation_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'evidence can cite only a position observation that is a member of this candidate';
  END IF;
  IF NEW.position_observation_id IS NOT NULL AND NEW.filing_document_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM registry.filing_document d
    JOIN obs.position_observation p ON p.filing_id = d.filing_id
    WHERE d.id = NEW.filing_document_id
      AND p.id = NEW.position_observation_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'filing document does not belong to this position observation';
  END IF;
  IF NEW.position_observation_id IS NOT NULL AND NEW.evidence_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM obs.position_observation p
    WHERE p.id = NEW.position_observation_id AND p.evidence_id = NEW.evidence_id
    UNION ALL
    SELECT 1 FROM obs.position_field_value f
    WHERE f.position_observation_id = NEW.position_observation_id AND f.evidence_id = NEW.evidence_id
    UNION ALL
    SELECT 1 FROM obs.borrower_name_observation b
    WHERE b.position_observation_id = NEW.position_observation_id AND b.evidence_id = NEW.evidence_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'evidence row is not provenance for this position observation';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION review.check_evidence_set_member() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'review'
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM review.evidence_set s
    JOIN review.evidence_item i ON i.candidate_id = s.candidate_id
    WHERE s.id = NEW.evidence_set_id AND i.id = NEW.evidence_item_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'an evidence set can include only evidence from the same candidate';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION review.check_researcher_note() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'review'
    AS $$
BEGIN
  IF NEW.evidence_item_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM review.evidence_item i
    WHERE i.id = NEW.evidence_item_id AND i.candidate_id = NEW.candidate_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'researcher note must cite evidence from the same candidate';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION review.open_candidate(p_case_key text, p_candidate_type text, p_source text, p_title text, p_created_by text) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'review'
    AS $$
DECLARE
  new_id bigint;
BEGIN
  PERFORM review.assert_writer();
  INSERT INTO review.candidate (case_key, candidate_type, source, title, created_by)
  VALUES (p_case_key, p_candidate_type::review.candidate_type, p_source, p_title, p_created_by)
  RETURNING id INTO new_id;
  INSERT INTO review.candidate_status (candidate_id, status, created_by)
  VALUES (new_id, 'OPEN', p_created_by);
  RETURN new_id;
END
$$;

CREATE FUNCTION review.set_candidate_status(p_candidate_id bigint, p_status text, p_reason text, p_created_by text) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'review'
    AS $$
DECLARE
  current_id bigint;
  new_id bigint;
BEGIN
  PERFORM review.assert_writer();
  IF p_status NOT IN ('OPEN', 'CLOSED') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'review status is OPEN or CLOSED';
  END IF;
  SELECT s.id INTO current_id
  FROM review.candidate_status s
  WHERE s.candidate_id = p_candidate_id
    AND NOT EXISTS (SELECT 1 FROM review.candidate_status n WHERE n.supersedes_id = s.id);
  IF current_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'review candidate has no status';
  END IF;
  INSERT INTO review.candidate_status (candidate_id, status, supersedes_id, supersede_reason, created_by)
  VALUES (p_candidate_id, p_status::review.case_status, current_id, p_reason, p_created_by)
  RETURNING id INTO new_id;
  RETURN new_id;
END
$$;

CREATE FUNCTION validation.check_evidence_status_assertion() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.validation_result_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM validation.validation_result v
    WHERE v.id = NEW.validation_result_id
      AND v.subject_table = 'obs.position_field_value' AND v.subject_id = NEW.field_value_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'validation_result_id must be a result for the same field value';
  END IF;
  IF NEW.evidence_status = 'FILING_VERIFIED' AND NOT EXISTS (
    SELECT 1 FROM validation.validation_result v JOIN evidence.evidence e ON e.id = v.evidence_id
    WHERE v.id = NEW.validation_result_id AND v.outcome = 'PASS' AND e.evidence_level = 'L2_ORIGINAL_FILING'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'FILING_VERIFIED requires a PASS validation result with Level 2 (original filing) evidence';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION validation.check_validation_subject() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM ops.assert_subject_exists(NEW.subject_table, NEW.subject_id);
  RETURN NEW;
END
$$;

CREATE TABLE access.grant_event (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    grant_kind access.grant_kind NOT NULL,
    action access.grant_action NOT NULL,
    source access.grant_source NOT NULL,
    actor_user_id uuid,
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT grant_event_bootstrap_actor CHECK ((((source = 'BOOTSTRAP'::access.grant_source) AND (actor_user_id IS NULL)) OR ((source <> 'BOOTSTRAP'::access.grant_source) AND (actor_user_id IS NOT NULL)))),
    CONSTRAINT grant_event_not_self CHECK ((actor_user_id IS DISTINCT FROM user_id)),
    CONSTRAINT grant_event_reason_check CHECK ((btrim(reason) <> ''::text))
);

COMMENT ON TABLE access.grant_event IS 'Immutable GRANT and REVOKE events. Current access is access.current_access. MEMBER is never stored.';

COMMENT ON COLUMN access.grant_event.user_id IS 'Supabase Auth user id (JWT sub). Not an email address.';

COMMENT ON COLUMN access.grant_event.actor_user_id IS 'Authenticated administrator who recorded the event. Null only for BOOTSTRAP.';

CREATE VIEW access.current_grant AS
 SELECT DISTINCT ON (user_id, grant_kind) id,
    user_id,
    grant_kind,
    action,
    source,
    actor_user_id,
    reason,
    created_at
   FROM access.grant_event
  ORDER BY user_id, grant_kind, created_at DESC, id DESC;

COMMENT ON VIEW access.current_grant IS 'Latest event per user and grant kind. action GRANT means the kind is active; REVOKE means it is not.';

CREATE VIEW access.current_access AS
 SELECT user_id,
    bool_or(((grant_kind = 'ADMIN'::access.grant_kind) AND (action = 'GRANT'::access.grant_action))) AS is_admin,
    bool_or(((grant_kind = 'PRO'::access.grant_kind) AND (action = 'GRANT'::access.grant_action))) AS is_pro,
        CASE
            WHEN bool_or(((grant_kind = 'ADMIN'::access.grant_kind) AND (action = 'GRANT'::access.grant_action))) THEN 'ADMIN'::text
            WHEN bool_or(((grant_kind = 'PRO'::access.grant_kind) AND (action = 'GRANT'::access.grant_action))) THEN 'PRO'::text
            ELSE 'MEMBER'::text
        END AS effective_role
   FROM access.current_grant
  GROUP BY user_id;

COMMENT ON VIEW access.current_access IS 'Users with at least one grant_event. Active ADMIN wins over active PRO. Users absent from this view are MEMBER if authenticated.';

ALTER TABLE access.grant_event ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME access.grant_event_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE raw.artifact (
    id bigint NOT NULL,
    source_url text NOT NULL,
    final_url text NOT NULL,
    source_type_code text NOT NULL,
    http_status integer NOT NULL,
    content_type text,
    last_modified text,
    etag text,
    byte_size bigint NOT NULL,
    sha256 text NOT NULL,
    retrieved_at timestamp with time zone NOT NULL,
    storage_key text NOT NULL,
    run_id bigint NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT artifact_byte_size_check CHECK ((byte_size >= 0)),
    CONSTRAINT artifact_final_url_check CHECK ((final_url ~ '^https://(www|data|xbrl)\.sec\.gov/'::text)),
    CONSTRAINT artifact_http_status_check CHECK (((http_status >= 100) AND (http_status <= 599))),
    CONSTRAINT artifact_sha256_check CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT artifact_source_url_check CHECK ((source_url ~ '^https://(www|data|xbrl)\.sec\.gov/'::text)),
    CONSTRAINT artifact_storage_key_check CHECK ((btrim(storage_key) <> ''::text))
);

COMMENT ON TABLE raw.artifact IS 'One downloaded byte stream. A SEC refresh of the same URL (new SHA-256) is a new artifact, never an overwrite.';

COMMENT ON COLUMN raw.artifact.last_modified IS 'HTTP Last-Modified header exactly as received.';

COMMENT ON COLUMN raw.artifact.storage_key IS 'Where the immutable bytes are kept (local cache path or object key). No storage vendor is chosen yet.';

CREATE TABLE registry.filing (
    id bigint NOT NULL,
    accession_number text NOT NULL,
    run_id bigint NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    evidence_id bigint NOT NULL,
    CONSTRAINT filing_accession_number_check CHECK ((accession_number ~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$'::text))
);

COMMENT ON TABLE registry.filing IS 'An EDGAR filing, identified by accession number. The first ten digits identify the submitter, never the registrant.';

CREATE TABLE registry.filing_document (
    id bigint NOT NULL,
    filing_id bigint NOT NULL,
    document_name text NOT NULL,
    document_url text NOT NULL,
    named_by text NOT NULL,
    rule_version_id bigint NOT NULL,
    run_id bigint NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    evidence_id bigint NOT NULL,
    CONSTRAINT filing_document_document_name_check CHECK ((btrim(document_name) <> ''::text)),
    CONSTRAINT filing_document_document_url_check CHECK ((document_url ~ '^https://www\.sec\.gov/Archives/edgar/data/'::text)),
    CONSTRAINT filing_document_named_by_check CHECK ((named_by = ANY (ARRAY['FILING_INDEX_JSON'::text, 'SUBMISSIONS_PRIMARY_DOCUMENT'::text, 'SOI_INLINEURL'::text])))
);

CREATE TABLE registry.filing_document_artifact (
    id bigint NOT NULL,
    filing_document_id bigint NOT NULL,
    artifact_id bigint NOT NULL,
    run_id bigint NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE VIEW admin.filing_artifact AS
 SELECT d.filing_id,
    f.accession_number,
    d.id AS filing_document_id,
    d.document_name,
    d.document_url,
    fda.id AS filing_document_artifact_id,
    a.id AS artifact_id,
    a.source_url,
    a.final_url,
    a.source_type_code,
    a.http_status,
    a.content_type,
    a.last_modified,
    a.etag,
    a.byte_size,
    a.sha256,
    a.retrieved_at,
    a.storage_key,
    a.run_id AS artifact_run_id,
    a.recorded_at AS artifact_recorded_at
   FROM (((registry.filing_document d
     JOIN registry.filing f ON ((f.id = d.filing_id)))
     JOIN registry.filing_document_artifact fda ON ((fda.filing_document_id = d.id)))
     JOIN raw.artifact a ON ((a.id = fda.artifact_id)));

COMMENT ON VIEW admin.filing_artifact IS 'Artifacts linked through filing_document_artifact. Checksums and retrieval metadata are raw.artifact values.';

CREATE TABLE evidence.evidence (
    id bigint NOT NULL,
    evidence_level ref.evidence_level NOT NULL,
    artifact_id bigint NOT NULL,
    locator_type ref.locator_type NOT NULL,
    tabular_row_id bigint,
    column_position integer,
    column_label text,
    json_path text,
    ixbrl_fact_id text,
    html_anchor text,
    join_note text,
    run_id bigint NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    artifact_member_id bigint,
    html_row_ordinal integer,
    html_row_end_ordinal integer,
    html_slot_ordinal integer,
    block_evidence_id bigint,
    heading_evidence_id bigint,
    CONSTRAINT evidence_column_position_check CHECK ((column_position >= 1)),
    CONSTRAINT evidence_heading_link_locator CHECK (((heading_evidence_id IS NULL) OR (locator_type = 'HTML_TABLE_CELL'::ref.locator_type))),
    CONSTRAINT evidence_html_row_end_ordinal_check CHECK (((html_row_end_ordinal IS NULL) OR (html_row_end_ordinal >= 1))),
    CONSTRAINT evidence_html_row_ordinal_check CHECK (((html_row_ordinal IS NULL) OR (html_row_ordinal >= 1))),
    CONSTRAINT evidence_html_row_span_check CHECK (((html_row_ordinal IS NULL) OR (html_row_end_ordinal IS NULL) OR (html_row_end_ordinal >= html_row_ordinal))),
    CONSTRAINT evidence_html_slot_ordinal_check CHECK (((html_slot_ordinal IS NULL) OR (html_slot_ordinal >= 0))),
    CONSTRAINT evidence_json_path_check CHECK ((json_path ~ '^\$'::text)),
    CONSTRAINT evidence_l2_html_anchor_context_row CHECK (((evidence_level <> 'L2_ORIGINAL_FILING'::ref.evidence_level) OR (locator_type <> 'HTML_ANCHOR'::ref.locator_type) OR (html_anchor ~ '^ix-context-row:[A-Za-z0-9_-]+$'::text))),
    CONSTRAINT evidence_level_locator CHECK (
CASE evidence_level
    WHEN 'L1_STRUCTURED_DATASET'::ref.evidence_level THEN ((locator_type = ANY (ARRAY['TSV_ROW'::ref.locator_type, 'TSV_CELL'::ref.locator_type])) OR ((locator_type = 'DOCUMENT'::ref.locator_type) AND (artifact_member_id IS NOT NULL)))
    WHEN 'L2_ORIGINAL_FILING'::ref.evidence_level THEN (locator_type = ANY (ARRAY['IXBRL_FACT'::ref.locator_type, 'HTML_ANCHOR'::ref.locator_type, 'DOCUMENT'::ref.locator_type, 'DISCLOSURE_BLOCK'::ref.locator_type, 'HTML_TABLE_CELL'::ref.locator_type, 'HTML_COLUMN_HEADING'::ref.locator_type]))
    WHEN 'REGISTRY'::ref.evidence_level THEN (locator_type = ANY (ARRAY['TSV_ROW'::ref.locator_type, 'TSV_CELL'::ref.locator_type, 'JSON_PATH'::ref.locator_type, 'HTML_ANCHOR'::ref.locator_type, 'DOCUMENT'::ref.locator_type]))
    WHEN 'DISCOVERY'::ref.evidence_level THEN (locator_type = ANY (ARRAY['JSON_PATH'::ref.locator_type, 'HTML_ANCHOR'::ref.locator_type, 'DOCUMENT'::ref.locator_type]))
    ELSE NULL::boolean
END),
    CONSTRAINT evidence_locator_fields CHECK (
CASE locator_type
    WHEN 'TSV_ROW'::ref.locator_type THEN ((tabular_row_id IS NOT NULL) AND (num_nonnulls(column_position, column_label, json_path, ixbrl_fact_id, html_anchor, artifact_member_id, html_row_ordinal, html_row_end_ordinal, html_slot_ordinal, block_evidence_id) = 0))
    WHEN 'TSV_CELL'::ref.locator_type THEN ((tabular_row_id IS NOT NULL) AND (column_position IS NOT NULL) AND (column_label IS NOT NULL) AND (num_nonnulls(json_path, ixbrl_fact_id, html_anchor, artifact_member_id, html_row_ordinal, html_row_end_ordinal, html_slot_ordinal, block_evidence_id) = 0))
    WHEN 'JSON_PATH'::ref.locator_type THEN ((json_path IS NOT NULL) AND (num_nonnulls(tabular_row_id, column_position, column_label, ixbrl_fact_id, html_anchor, artifact_member_id, html_row_ordinal, html_row_end_ordinal, html_slot_ordinal, block_evidence_id) = 0))
    WHEN 'IXBRL_FACT'::ref.locator_type THEN ((ixbrl_fact_id IS NOT NULL) AND (html_row_end_ordinal IS NULL) AND (html_slot_ordinal IS NULL) AND (num_nonnulls(tabular_row_id, column_position, column_label, json_path, html_anchor, artifact_member_id) = 0) AND ((block_evidence_id IS NULL) = (html_row_ordinal IS NULL)))
    WHEN 'HTML_ANCHOR'::ref.locator_type THEN ((html_anchor IS NOT NULL) AND (num_nonnulls(tabular_row_id, column_position, column_label, json_path, ixbrl_fact_id, artifact_member_id, html_row_ordinal, html_row_end_ordinal, html_slot_ordinal, block_evidence_id) = 0))
    WHEN 'DOCUMENT'::ref.locator_type THEN (num_nonnulls(tabular_row_id, column_position, column_label, json_path, ixbrl_fact_id, html_anchor, html_row_ordinal, html_row_end_ordinal, html_slot_ordinal, block_evidence_id) = 0)
    WHEN 'DISCLOSURE_BLOCK'::ref.locator_type THEN ((html_row_ordinal IS NOT NULL) AND (html_row_end_ordinal IS NOT NULL) AND (html_row_end_ordinal >= html_row_ordinal) AND (html_slot_ordinal IS NULL) AND (block_evidence_id IS NULL) AND (num_nonnulls(tabular_row_id, column_position, column_label, json_path, ixbrl_fact_id, html_anchor, artifact_member_id) = 0))
    WHEN 'HTML_TABLE_CELL'::ref.locator_type THEN ((html_row_ordinal IS NOT NULL) AND (html_slot_ordinal IS NOT NULL) AND ((block_evidence_id IS NOT NULL) OR (heading_evidence_id IS NOT NULL)) AND (html_row_end_ordinal IS NULL) AND (num_nonnulls(tabular_row_id, column_position, column_label, json_path, ixbrl_fact_id, html_anchor, artifact_member_id) = 0))
    WHEN 'HTML_COLUMN_HEADING'::ref.locator_type THEN ((html_row_ordinal IS NOT NULL) AND (html_slot_ordinal IS NOT NULL) AND (html_row_end_ordinal IS NULL) AND (block_evidence_id IS NULL) AND (heading_evidence_id IS NULL) AND (num_nonnulls(tabular_row_id, column_position, column_label, json_path, ixbrl_fact_id, html_anchor, artifact_member_id) = 0))
    ELSE NULL::boolean
END)
);

COMMENT ON TABLE evidence.evidence IS 'A location inside a source artifact. Retrieval time and checksum come from raw.artifact.';

COMMENT ON COLUMN evidence.evidence.join_note IS 'Set when the fact depends on a join that SEC does not document (for example SOI to NUM).';

COMMENT ON COLUMN evidence.evidence.artifact_member_id IS 'For DOCUMENT evidence about one archive member (for example a whole SUB table).';

COMMENT ON COLUMN evidence.evidence.html_row_ordinal IS '1-based document order of a <tr>, using the schedule disclosure parser row scan. Null for locators that are not an HTML row.';

COMMENT ON COLUMN evidence.evidence.html_row_end_ordinal IS 'Inclusive end row of a DISCLOSURE_BLOCK. Null for every other locator.';

COMMENT ON COLUMN evidence.evidence.html_slot_ordinal IS 'Colspan-grid slot of an HTML_TABLE_CELL. Slot 0 is allowed. The database does not decide which slot is the Portfolio Company column.';

COMMENT ON COLUMN evidence.evidence.block_evidence_id IS 'DISCLOSURE_BLOCK that contains this cell or fact. Null on the block itself and on evidence that is not inside a block.';

COMMENT ON COLUMN evidence.evidence.heading_evidence_id IS 'HTML_COLUMN_HEADING aligned with this value cell. Null when the cell has no stored heading. The column does not store a field code.';

CREATE TABLE ref.registry_field_mapping (
    id bigint NOT NULL,
    source_type_code text NOT NULL,
    source_field text NOT NULL,
    target_kind text NOT NULL,
    target_code text,
    mapping_status ref.mapping_status NOT NULL,
    source_schema_reference text NOT NULL,
    recorded_by text NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT registry_field_mapping_check CHECK (((target_kind = ANY (ARRAY['REGISTRANT_ATTRIBUTE'::text, 'FILING_ATTRIBUTE'::text])) = (target_code IS NOT NULL))),
    CONSTRAINT registry_field_mapping_mapping_status_check CHECK ((mapping_status = ANY (ARRAY['DOCUMENTED_AND_OBSERVED'::ref.mapping_status, 'OBSERVED_UNCONFIRMED'::ref.mapping_status]))),
    CONSTRAINT registry_field_mapping_recorded_by_check CHECK ((btrim(recorded_by) <> ''::text)),
    CONSTRAINT registry_field_mapping_source_field_check CHECK ((btrim(source_field) <> ''::text)),
    CONSTRAINT registry_field_mapping_source_schema_reference_check CHECK ((btrim(source_schema_reference) <> ''::text)),
    CONSTRAINT registry_field_mapping_target_kind_check CHECK ((target_kind = ANY (ARRAY['REGISTRANT'::text, 'REGISTRANT_ATTRIBUTE'::text, 'NAME_HISTORY'::text, 'FILING'::text, 'FILING_LINK'::text, 'FILING_ATTRIBUTE'::text, 'FILING_DOCUMENT'::text, 'RELEASE'::text, 'REPORT_EDITION'::text, 'PAGINATION'::text, 'RAW_ONLY'::text])))
);

COMMENT ON TABLE ref.registry_field_mapping IS 'Source field to registry target with its documentation status (docs/SOURCE_SCHEMAS.md section 7.2). source_field is the column label, the JSON path with indexes replaced by [*], or "link" for page anchors.';

CREATE TABLE registry.filing_attribute_observation (
    id bigint NOT NULL,
    filing_id bigint NOT NULL,
    attribute_code text NOT NULL,
    raw_value text NOT NULL,
    normalized_text text,
    normalized_date date,
    normalized_timestamp timestamp with time zone,
    value_state ref.value_state NOT NULL,
    rule_version_id bigint NOT NULL,
    run_id bigint NOT NULL,
    supersedes_id bigint,
    supersede_reason text,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    evidence_id bigint NOT NULL,
    CONSTRAINT filing_attribute_observation_check CHECK ((num_nonnulls(normalized_text, normalized_date, normalized_timestamp) <= 1)),
    CONSTRAINT filing_attribute_observation_check1 CHECK (((value_state = 'REPORTED'::ref.value_state) OR (num_nonnulls(normalized_text, normalized_date, normalized_timestamp) = 0))),
    CONSTRAINT filing_attribute_observation_not_self_superseding CHECK ((supersedes_id IS DISTINCT FROM id)),
    CONSTRAINT filing_attribute_observation_value_state_check CHECK ((value_state = ANY (ARRAY['REPORTED'::ref.value_state, 'UNKNOWN'::ref.value_state, 'NOT_APPLICABLE'::ref.value_state])))
);

COMMENT ON TABLE registry.filing_attribute_observation IS 'Form, dates, fiscal focus, prevrpt, and document names per source. Sources may disagree side by side.';

CREATE VIEW registry.current_filing_attribute AS
 SELECT o.id AS observation_id,
    o.filing_id,
    f.accession_number,
    o.attribute_code,
    o.raw_value,
    o.value_state,
    o.normalized_text,
    o.normalized_date,
    o.normalized_timestamp,
    a.source_type_code,
    raw.source_stream(a.id) AS source_stream,
    e.evidence_level,
    m.mapping_status AS documentation_status,
    o.evidence_id,
    o.rule_version_id,
    o.run_id
   FROM ((((registry.filing_attribute_observation o
     JOIN registry.filing f ON ((f.id = o.filing_id)))
     JOIN evidence.evidence e ON ((e.id = o.evidence_id)))
     JOIN raw.artifact a ON ((a.id = e.artifact_id)))
     LEFT JOIN ref.registry_field_mapping m ON (((m.source_type_code = a.source_type_code) AND (m.source_field = evidence.source_field(e.locator_type, e.column_label, e.json_path)) AND (m.target_kind = 'FILING_ATTRIBUTE'::text) AND (m.target_code = o.attribute_code))))
  WHERE (NOT (EXISTS ( SELECT 1
           FROM registry.filing_attribute_observation s
          WHERE (s.supersedes_id = o.id))));

COMMENT ON VIEW registry.current_filing_attribute IS 'Every current filing attribute value per source, side by side. Disagreements stay visible.';

CREATE VIEW admin.filing_attribute AS
 SELECT filing_id,
    accession_number,
    observation_id,
    attribute_code,
    raw_value,
    value_state,
    normalized_text,
    normalized_date,
    normalized_timestamp,
    source_type_code,
    source_stream,
    evidence_level,
    documentation_status,
    evidence_id,
    rule_version_id,
    run_id
   FROM registry.current_filing_attribute c;

COMMENT ON VIEW admin.filing_attribute IS 'Current filing attributes per source. Multiple rows for the same attribute_code mean sources disagree.';

CREATE VIEW admin.filing_document AS
 SELECT d.filing_id,
    f.accession_number,
    d.id AS filing_document_id,
    d.document_name,
    d.document_url,
    d.named_by,
    d.rule_version_id,
    d.run_id,
    d.evidence_id,
    d.recorded_at,
    (EXISTS ( SELECT 1
           FROM registry.filing_document_artifact fda
          WHERE (fda.filing_document_id = d.id))) AS artifact_linked
   FROM (registry.filing_document d
     JOIN registry.filing f ON ((f.id = d.filing_id)));

COMMENT ON VIEW admin.filing_document IS 'Named SEC filing documents with stored document_url locators only. No URL is constructed here.';

CREATE TABLE obs.num_fact_observation (
    id bigint NOT NULL,
    tabular_row_id bigint NOT NULL,
    filing_id bigint NOT NULL,
    tag text NOT NULL,
    tag_version text NOT NULL,
    reported_date_raw text NOT NULL,
    reported_date date,
    qtrs_raw text NOT NULL,
    qtrs integer,
    duration_kind ref.duration_kind NOT NULL,
    uom_raw text NOT NULL,
    segments_raw text,
    identifier_member_raw text,
    value_raw text NOT NULL,
    value_numeric numeric,
    value_state ref.value_state NOT NULL,
    rule_version_id bigint NOT NULL,
    evidence_id bigint NOT NULL,
    run_id bigint NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT num_fact_observation_check CHECK (((value_state = 'REPORTED'::ref.value_state) = (value_numeric IS NOT NULL))),
    CONSTRAINT num_fact_observation_check1 CHECK (((value_numeric IS DISTINCT FROM (0)::numeric) OR ops.text_is_numeric_zero(value_raw))),
    CONSTRAINT num_fact_observation_check2 CHECK ((duration_kind =
CASE
    WHEN (qtrs IS NULL) THEN 'UNKNOWN'::ref.duration_kind
    WHEN (qtrs = 0) THEN 'POINT_IN_TIME'::ref.duration_kind
    ELSE 'DURATION'::ref.duration_kind
END)),
    CONSTRAINT num_fact_observation_identifier_member_raw_check CHECK ((identifier_member_raw <> ''::text)),
    CONSTRAINT num_fact_observation_qtrs_check CHECK ((qtrs >= 0)),
    CONSTRAINT num_fact_observation_tag_check CHECK ((tag <> ''::text)),
    CONSTRAINT num_fact_observation_tag_version_check CHECK ((tag_version <> ''::text)),
    CONSTRAINT num_fact_observation_value_state_check CHECK ((value_state = ANY (ARRAY['REPORTED'::ref.value_state, 'UNKNOWN'::ref.value_state])))
);

COMMENT ON COLUMN obs.num_fact_observation.identifier_member_raw IS 'Typed member of the investment identifier axis, parsed from segments by the rule version.';

CREATE TABLE obs.position_observation (
    id bigint NOT NULL,
    origin_soi_row_observation_id bigint NOT NULL,
    filing_id bigint NOT NULL,
    reported_date date,
    date_precision text NOT NULL,
    duration_kind ref.duration_kind NOT NULL,
    holding_descriptor_raw text NOT NULL,
    rule_version_id bigint NOT NULL,
    evidence_id bigint NOT NULL,
    run_id bigint NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT position_observation_date_precision_check CHECK ((date_precision = 'MONTH_END_ROUNDED'::text)),
    CONSTRAINT position_observation_holding_descriptor_raw_check CHECK ((holding_descriptor_raw <> ''::text))
);

COMMENT ON TABLE obs.position_observation IS 'One identifier-bearing SOI row. The current classification of the origin is IDENTIFIER_ROW, and holding_descriptor_raw equals that row''s identifier cell. It is not an economically usable investment. Instrument and position links exist only as resolution decisions.';

CREATE TABLE obs.soi_row_observation (
    id bigint NOT NULL,
    tabular_row_id bigint NOT NULL,
    filing_id bigint NOT NULL,
    reported_date_raw text NOT NULL,
    reported_date date,
    date_precision text NOT NULL,
    qtrs_raw text NOT NULL,
    qtrs integer,
    duration_kind ref.duration_kind NOT NULL,
    identifier_raw text,
    rule_version_id bigint NOT NULL,
    evidence_id bigint NOT NULL,
    run_id bigint NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT soi_row_observation_check CHECK ((duration_kind =
CASE
    WHEN (qtrs IS NULL) THEN 'UNKNOWN'::ref.duration_kind
    WHEN (qtrs = 0) THEN 'POINT_IN_TIME'::ref.duration_kind
    ELSE 'DURATION'::ref.duration_kind
END)),
    CONSTRAINT soi_row_observation_date_precision_check CHECK ((date_precision = 'MONTH_END_ROUNDED'::text)),
    CONSTRAINT soi_row_observation_identifier_raw_check CHECK ((identifier_raw <> ''::text)),
    CONSTRAINT soi_row_observation_qtrs_check CHECK ((qtrs >= 0))
);

COMMENT ON TABLE obs.soi_row_observation IS 'Exactly one per raw SOI row per rule version. Not unique on accession, identifier, date, or qtrs: SOI has no natural key.';

COMMENT ON COLUMN obs.soi_row_observation.identifier_raw IS 'Investment identifier text exactly as disclosed; NULL when the cell is empty.';

CREATE TABLE ops.artifact_processing (
    id bigint NOT NULL,
    artifact_id bigint NOT NULL,
    rule_version_id bigint NOT NULL,
    outcome text NOT NULL,
    detail text NOT NULL,
    counts jsonb NOT NULL,
    run_id bigint NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT artifact_processing_detail_check CHECK ((btrim(detail) <> ''::text)),
    CONSTRAINT artifact_processing_outcome_check CHECK ((outcome = ANY (ARRAY['LOADED'::text, 'SCHEMA_DRIFT'::text, 'NOT_IN_SCOPE'::text])))
);

COMMENT ON TABLE ops.artifact_processing IS 'One processing of one artifact by one loader version; reprocessing the same artifact with the same loader is a no-op.';

CREATE TABLE ref.registrant_attribute (
    code text NOT NULL,
    description text NOT NULL,
    CONSTRAINT registrant_attribute_code_check CHECK ((code ~ '^[A-Z][A-Z0-9_]*$'::text))
);

CREATE TABLE registry.filing_registrant_link (
    id bigint NOT NULL,
    filing_id bigint NOT NULL,
    registrant_id bigint NOT NULL,
    link_source ref.filing_link_source NOT NULL,
    run_id bigint NOT NULL,
    supersedes_id bigint,
    supersede_reason text,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    evidence_id bigint NOT NULL,
    CONSTRAINT filing_registrant_link_not_self_superseding CHECK ((supersedes_id IS DISTINCT FROM id))
);

COMMENT ON TABLE registry.filing_registrant_link IS 'Filing to registrant, only from explicit filing metadata. Several links (co-registrants or disagreeing sources) may coexist; none is chosen silently.';

CREATE TABLE registry.registrant (
    id bigint NOT NULL,
    cik bigint NOT NULL,
    run_id bigint NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    evidence_id bigint NOT NULL,
    CONSTRAINT registrant_cik_check CHECK (((cik >= 1) AND (cik <= '9999999999'::bigint)))
);

COMMENT ON TABLE registry.registrant IS 'An SEC registrant (filing entity, typically a BDC). Never a borrower, legal entity, or economic group.';

COMMENT ON COLUMN registry.registrant.cik IS 'Stored as a number; sources show it unpadded (data sets) or zero-padded to 10 digits (BDC Report, submissions URL).';

CREATE VIEW registry.current_filing_registrant AS
 WITH heads AS (
         SELECT l.id,
            l.filing_id,
            l.registrant_id,
            l.link_source,
            l.run_id,
            l.supersedes_id,
            l.supersede_reason,
            l.recorded_at,
            l.evidence_id
           FROM registry.filing_registrant_link l
          WHERE (NOT (EXISTS ( SELECT 1
                   FROM registry.filing_registrant_link s
                  WHERE (s.supersedes_id = l.id))))
        ), per_filing AS (
         SELECT heads.filing_id,
            count(DISTINCT heads.registrant_id) AS registrant_count
           FROM heads
          GROUP BY heads.filing_id
        )
 SELECT f.id AS filing_id,
    f.accession_number,
    h.registrant_id,
    r.cik,
    h.link_source,
    h.evidence_id,
        CASE
            WHEN (h.id IS NULL) THEN 'UNKNOWN'::text
            WHEN (p.registrant_count > 1) THEN 'MULTIPLE'::text
            ELSE 'LINKED'::text
        END AS registrant_link_status
   FROM (((registry.filing f
     LEFT JOIN heads h ON ((h.filing_id = f.id)))
     LEFT JOIN per_filing p ON ((p.filing_id = f.id)))
     LEFT JOIN registry.registrant r ON ((r.id = h.registrant_id)));

COMMENT ON VIEW registry.current_filing_registrant IS 'Registrant per filing from explicit metadata only. UNKNOWN when no link exists; MULTIPLE when links name more than one registrant.';

CREATE TABLE registry.registrant_attribute_observation (
    id bigint NOT NULL,
    registrant_id bigint NOT NULL,
    attribute_code text NOT NULL,
    raw_value text NOT NULL,
    normalized_value text,
    source_as_of date,
    rule_version_id bigint NOT NULL,
    run_id bigint NOT NULL,
    supersedes_id bigint,
    supersede_reason text,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    evidence_id bigint NOT NULL,
    CONSTRAINT registrant_attribute_observation_not_self_superseding CHECK ((supersedes_id IS DISTINCT FROM id))
);

COMMENT ON TABLE registry.registrant_attribute_observation IS 'Names, file numbers, tickers change over time and differ by source; each value is an observation.';

CREATE VIEW registry.current_registrant_attribute AS
 SELECT o.id AS observation_id,
    o.registrant_id,
    r.cik,
    o.attribute_code,
    o.raw_value,
    o.normalized_value,
    o.source_as_of,
    a.source_type_code,
    raw.source_stream(a.id) AS source_stream,
    e.evidence_level,
    m.mapping_status AS documentation_status,
    o.evidence_id,
    o.rule_version_id,
    o.run_id
   FROM ((((registry.registrant_attribute_observation o
     JOIN registry.registrant r ON ((r.id = o.registrant_id)))
     JOIN evidence.evidence e ON ((e.id = o.evidence_id)))
     JOIN raw.artifact a ON ((a.id = e.artifact_id)))
     LEFT JOIN ref.registry_field_mapping m ON (((m.source_type_code = a.source_type_code) AND (m.source_field = evidence.source_field(e.locator_type, e.column_label, e.json_path)) AND (m.target_kind = 'REGISTRANT_ATTRIBUTE'::text) AND (m.target_code = o.attribute_code))))
  WHERE (NOT (EXISTS ( SELECT 1
           FROM registry.registrant_attribute_observation s
          WHERE (s.supersedes_id = o.id))));

COMMENT ON VIEW registry.current_registrant_attribute IS 'Every current registrant attribute value per source, with its documentation status. Sources are never merged.';

CREATE VIEW registry.registrant_attribute_status AS
 SELECT r.id AS registrant_id,
    r.cik,
    ra.code AS attribute_code,
    count(c.observation_id) AS current_value_count,
    count(DISTINCT c.raw_value) AS distinct_raw_value_count,
        CASE
            WHEN (count(c.observation_id) = 0) THEN 'UNKNOWN'::text
            WHEN (count(DISTINCT c.raw_value) > 1) THEN 'MULTIPLE_VALUES'::text
            ELSE 'REPORTED'::text
        END AS attribute_state
   FROM ((registry.registrant r
     CROSS JOIN ref.registrant_attribute ra)
     LEFT JOIN registry.current_registrant_attribute c ON (((c.registrant_id = r.id) AND (c.attribute_code = ra.code))))
  GROUP BY r.id, r.cik, ra.code;

CREATE VIEW admin.filing_inventory AS
 SELECT id AS filing_id,
    accession_number,
    run_id AS filing_run_id,
    recorded_at AS filing_recorded_at,
    ( SELECT
                CASE
                    WHEN (count(*) FILTER (WHERE (fr.registrant_id IS NOT NULL)) = 0) THEN 'UNKNOWN'::text
                    WHEN (count(DISTINCT fr.registrant_id) > 1) THEN 'MULTIPLE'::text
                    ELSE 'LINKED'::text
                END AS "case"
           FROM registry.current_filing_registrant fr
          WHERE (fr.filing_id = f.id)) AS registrant_link_status,
    ( SELECT array_agg(DISTINCT fr.registrant_id ORDER BY fr.registrant_id) AS array_agg
           FROM registry.current_filing_registrant fr
          WHERE ((fr.filing_id = f.id) AND (fr.registrant_id IS NOT NULL))) AS registrant_ids,
    ( SELECT array_agg(DISTINCT fr.cik ORDER BY fr.cik) AS array_agg
           FROM registry.current_filing_registrant fr
          WHERE ((fr.filing_id = f.id) AND (fr.cik IS NOT NULL))) AS registrant_ciks,
    ( SELECT
                CASE
                    WHEN (count(DISTINCT fr.registrant_id) FILTER (WHERE (fr.registrant_id IS NOT NULL)) = 0) THEN 'UNKNOWN'::text
                    WHEN (count(DISTINCT fr.registrant_id) FILTER (WHERE (fr.registrant_id IS NOT NULL)) > 1) THEN 'MULTIPLE_REGISTRANTS'::text
                    ELSE min(ns.attribute_state)
                END AS min
           FROM (registry.current_filing_registrant fr
             LEFT JOIN registry.registrant_attribute_status ns ON (((ns.registrant_id = fr.registrant_id) AND (ns.attribute_code = 'NAME'::text))))
          WHERE (fr.filing_id = f.id)) AS registrant_name_state,
    ( SELECT
                CASE
                    WHEN ((count(DISTINCT fr.registrant_id) FILTER (WHERE (fr.registrant_id IS NOT NULL)) = 1) AND (min(ns.attribute_state) = 'REPORTED'::text) AND (count(DISTINCT cra.raw_value) = 1)) THEN min(cra.raw_value)
                    ELSE NULL::text
                END AS "case"
           FROM ((registry.current_filing_registrant fr
             LEFT JOIN registry.registrant_attribute_status ns ON (((ns.registrant_id = fr.registrant_id) AND (ns.attribute_code = 'NAME'::text))))
             LEFT JOIN registry.current_registrant_attribute cra ON (((cra.registrant_id = fr.registrant_id) AND (cra.attribute_code = 'NAME'::text))))
          WHERE ((fr.filing_id = f.id) AND (fr.registrant_id IS NOT NULL))) AS registrant_name_raw,
    ( SELECT array_agg(DISTINCT c.normalized_text ORDER BY c.normalized_text) AS array_agg
           FROM registry.current_filing_attribute c
          WHERE ((c.filing_id = f.id) AND (c.attribute_code = 'FORM'::text) AND (c.normalized_text IS NOT NULL))) AS forms,
    ( SELECT array_agg(DISTINCT c.raw_value ORDER BY c.raw_value) AS array_agg
           FROM registry.current_filing_attribute c
          WHERE ((c.filing_id = f.id) AND (c.attribute_code = 'FORM'::text))) AS form_raw_values,
    ( SELECT array_agg(DISTINCT c.normalized_date ORDER BY c.normalized_date) AS array_agg
           FROM registry.current_filing_attribute c
          WHERE ((c.filing_id = f.id) AND (c.attribute_code = 'FILED_DATE'::text) AND (c.normalized_date IS NOT NULL))) AS filed_dates,
    ( SELECT array_agg(DISTINCT c.raw_value ORDER BY c.raw_value) AS array_agg
           FROM registry.current_filing_attribute c
          WHERE ((c.filing_id = f.id) AND (c.attribute_code = 'FILED_DATE'::text))) AS filed_date_raw_values,
    ( SELECT array_agg(DISTINCT c.normalized_date ORDER BY c.normalized_date) AS array_agg
           FROM registry.current_filing_attribute c
          WHERE ((c.filing_id = f.id) AND (c.attribute_code = 'PERIOD'::text) AND (c.normalized_date IS NOT NULL))) AS report_periods,
    ( SELECT array_agg(DISTINCT c.raw_value ORDER BY c.raw_value) AS array_agg
           FROM registry.current_filing_attribute c
          WHERE ((c.filing_id = f.id) AND (c.attribute_code = 'PERIOD'::text))) AS report_period_raw_values,
    ( SELECT count(*) AS count
           FROM registry.filing_document d
          WHERE (d.filing_id = f.id)) AS document_count,
    ( SELECT count(DISTINCT fda.artifact_id) AS count
           FROM (registry.filing_document d
             JOIN registry.filing_document_artifact fda ON ((fda.filing_document_id = d.id)))
          WHERE (d.filing_id = f.id)) AS artifact_count,
    (EXISTS ( SELECT 1
           FROM registry.filing_document d
          WHERE (d.filing_id = f.id))) AS documents_available,
    (EXISTS ( SELECT 1
           FROM (registry.filing_document d
             JOIN registry.filing_document_artifact fda ON ((fda.filing_document_id = d.id)))
          WHERE (d.filing_id = f.id))) AS artifacts_available,
    ( SELECT array_agg(DISTINCT p.outcome ORDER BY p.outcome) AS array_agg
           FROM ((registry.filing_document d
             JOIN registry.filing_document_artifact fda ON ((fda.filing_document_id = d.id)))
             JOIN ops.artifact_processing p ON ((p.artifact_id = fda.artifact_id)))
          WHERE (d.filing_id = f.id)) AS processing_outcomes,
    ( SELECT count(*) AS count
           FROM ( SELECT DISTINCT p.id
                   FROM ((registry.filing_document d
                     JOIN registry.filing_document_artifact fda ON ((fda.filing_document_id = d.id)))
                     JOIN ops.artifact_processing p ON ((p.artifact_id = fda.artifact_id)))
                  WHERE (d.filing_id = f.id)) proc) AS processing_row_count,
    ( SELECT count(*) AS count
           FROM obs.soi_row_observation o
          WHERE (o.filing_id = f.id)) AS soi_row_observation_count,
    ( SELECT count(*) AS count
           FROM obs.position_observation o
          WHERE (o.filing_id = f.id)) AS position_observation_count,
    ( SELECT count(*) AS count
           FROM obs.num_fact_observation o
          WHERE (o.filing_id = f.id)) AS num_fact_observation_count
   FROM registry.filing f;

COMMENT ON VIEW admin.filing_inventory IS 'One row per SEC filing. Attribute arrays preserve source disagreement. processing_outcomes lists distinct linked outcomes; NULL means none linked, not a fabricated status. Projection exceptions are omitted: they are not filing-keyed.';

CREATE TABLE ops.run (
    id bigint NOT NULL,
    run_kind text NOT NULL,
    code_version text NOT NULL,
    input_sha256 text,
    parameters jsonb NOT NULL,
    started_at timestamp with time zone NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT run_code_version_check CHECK ((btrim(code_version) <> ''::text)),
    CONSTRAINT run_input_sha256_check CHECK ((input_sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT run_run_kind_check CHECK ((run_kind ~ '^[A-Z][A-Z0-9_]*$'::text))
);

COMMENT ON TABLE ops.run IS 'One execution of any job. A run with no ops.run_outcome row is STARTED.';

COMMENT ON COLUMN ops.run.parameters IS 'Non-secret parameters only. Never store the SEC User-Agent value.';

CREATE TABLE ops.run_outcome (
    id bigint NOT NULL,
    run_id bigint NOT NULL,
    status ops.run_status NOT NULL,
    finished_at timestamp with time zone NOT NULL,
    counts jsonb NOT NULL,
    error_summary text,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT run_outcome_check CHECK (((status = 'SUCCEEDED'::ops.run_status) OR (error_summary IS NOT NULL))),
    CONSTRAINT run_outcome_status_check CHECK ((status <> 'STARTED'::ops.run_status))
);

CREATE VIEW ops.current_run_status AS
 SELECT r.id AS run_id,
    r.run_kind,
    r.started_at,
    COALESCE(o.status, 'STARTED'::ops.run_status) AS status,
    o.finished_at
   FROM (ops.run r
     LEFT JOIN ops.run_outcome o ON ((o.run_id = r.id)));

CREATE TABLE ops.rule_version (
    id bigint NOT NULL,
    rule_code text NOT NULL,
    rule_kind ops.rule_kind NOT NULL,
    version text NOT NULL,
    definition_sha256 text NOT NULL,
    spec_reference text NOT NULL,
    description text NOT NULL,
    unknown_input_policy ops.unknown_input_policy,
    created_by text NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rule_version_check CHECK (((rule_kind = 'DERIVATION'::ops.rule_kind) = (unknown_input_policy IS NOT NULL))),
    CONSTRAINT rule_version_created_by_check CHECK ((btrim(created_by) <> ''::text)),
    CONSTRAINT rule_version_definition_sha256_check CHECK ((definition_sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT rule_version_description_check CHECK ((btrim(description) <> ''::text)),
    CONSTRAINT rule_version_rule_code_check CHECK ((rule_code ~ '^[a-z][a-z0-9_.]*$'::text)),
    CONSTRAINT rule_version_spec_reference_check CHECK ((btrim(spec_reference) <> ''::text)),
    CONSTRAINT rule_version_version_check CHECK ((version ~ '^[0-9A-Za-z][0-9A-Za-z._-]*$'::text))
);

COMMENT ON TABLE ops.rule_version IS 'Immutable definition of a parser, normalization, classification, validation, resolution, or derivation rule.';

COMMENT ON COLUMN ops.rule_version.unknown_input_policy IS 'Derivation rules only: how Unknown inputs are handled. Unknown never becomes zero.';

CREATE VIEW admin.filing_processing AS
 SELECT DISTINCT link.filing_id,
    f.accession_number,
    p.id AS artifact_processing_id,
    p.artifact_id,
    p.rule_version_id,
    rv.rule_code,
    rv.version AS rule_version,
    rv.rule_kind,
    p.outcome,
    p.detail,
    p.counts,
    p.run_id,
    rs.run_kind,
    rs.status AS run_status,
    rs.started_at AS run_started_at,
    rs.finished_at AS run_finished_at,
    p.recorded_at AS processing_recorded_at
   FROM ((((( SELECT DISTINCT d.filing_id,
            fda.artifact_id
           FROM (registry.filing_document d
             JOIN registry.filing_document_artifact fda ON ((fda.filing_document_id = d.id)))) link
     JOIN registry.filing f ON ((f.id = link.filing_id)))
     JOIN ops.artifact_processing p ON ((p.artifact_id = link.artifact_id)))
     JOIN ops.rule_version rv ON ((rv.id = p.rule_version_id)))
     LEFT JOIN ops.current_run_status rs ON ((rs.run_id = p.run_id)));

COMMENT ON VIEW admin.filing_processing IS 'artifact_processing rows for artifacts linked to the filing. Multiple outcomes stay as multiple rows; none are collapsed into a health status.';

CREATE VIEW admin.filing_registrant AS
 SELECT fr.filing_id,
    fr.accession_number,
    fr.registrant_id,
    fr.cik,
    fr.link_source,
    fr.registrant_link_status,
    fr.evidence_id,
    ns.attribute_state AS name_state,
        CASE
            WHEN ((ns.attribute_state = 'REPORTED'::text) AND (( SELECT count(DISTINCT cra.raw_value) AS count
               FROM registry.current_registrant_attribute cra
              WHERE ((cra.registrant_id = fr.registrant_id) AND (cra.attribute_code = 'NAME'::text))) = 1)) THEN ( SELECT min(cra.raw_value) AS min
               FROM registry.current_registrant_attribute cra
              WHERE ((cra.registrant_id = fr.registrant_id) AND (cra.attribute_code = 'NAME'::text)))
            ELSE NULL::text
        END AS name_raw
   FROM (registry.current_filing_registrant fr
     LEFT JOIN registry.registrant_attribute_status ns ON (((ns.registrant_id = fr.registrant_id) AND (ns.attribute_code = 'NAME'::text))));

COMMENT ON VIEW admin.filing_registrant IS 'Current filing–registrant links. UNKNOWN/MULTIPLE link status and name_state stay visible; name_raw is set only for a single REPORTED name.';

CREATE TABLE derived.derived_value (
    id bigint NOT NULL,
    metric_rule_version_id bigint NOT NULL,
    subject_table text NOT NULL,
    subject_id bigint NOT NULL,
    result_numeric numeric,
    result_state ref.value_state NOT NULL,
    unknown_reason text,
    run_id bigint NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT derived_value_check CHECK (((result_state = 'DERIVED'::ref.value_state) = (result_numeric IS NOT NULL))),
    CONSTRAINT derived_value_check1 CHECK (((result_state <> 'UNKNOWN'::ref.value_state) OR (COALESCE(btrim(unknown_reason), ''::text) <> ''::text))),
    CONSTRAINT derived_value_result_state_check CHECK ((result_state = ANY (ARRAY['DERIVED'::ref.value_state, 'UNKNOWN'::ref.value_state, 'NOT_APPLICABLE'::ref.value_state]))),
    CONSTRAINT derived_value_subject_table_check CHECK ((subject_table ~ '^(registry|obs|derived)\.[a-z_]+$'::text))
);

COMMENT ON TABLE derived.derived_value IS 'A value computed by a versioned deterministic rule. Unknown inputs yield UNKNOWN, never zero.';

ALTER TABLE derived.derived_value ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME derived.derived_value_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE derived.derived_value_input (
    id bigint NOT NULL,
    derived_value_id bigint NOT NULL,
    field_value_id bigint,
    input_derived_value_id bigint,
    input_role text NOT NULL,
    run_id bigint NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT derived_value_input_check CHECK ((num_nonnulls(field_value_id, input_derived_value_id) = 1)),
    CONSTRAINT derived_value_input_check1 CHECK ((input_derived_value_id IS DISTINCT FROM derived_value_id)),
    CONSTRAINT derived_value_input_input_role_check CHECK ((input_role ~ '^[a-z][a-z0-9_]*$'::text))
);

ALTER TABLE derived.derived_value_input ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME derived.derived_value_input_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE derived.observation_event (
    id bigint NOT NULL,
    event_code text NOT NULL,
    position_observation_id bigint NOT NULL,
    reported_date date NOT NULL,
    evidence_id bigint NOT NULL,
    rule_version_id bigint NOT NULL,
    run_id bigint NOT NULL,
    rationale text NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT observation_event_event_code_check CHECK ((event_code = 'REGISTRANT_FIRST_OBSERVED_NAME'::text)),
    CONSTRAINT observation_event_rationale_check CHECK ((btrim(rationale) <> ''::text))
);

COMMENT ON TABLE derived.observation_event IS 'A derived event anchored to one position observation. P9-min stores only REGISTRANT_FIRST_OBSERVED_NAME. No amount, instrument, CIK, or economic group.';

ALTER TABLE derived.observation_event ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME derived.observation_event_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE VIEW derived.observation_event_listing AS
 SELECT id,
    event_code,
    position_observation_id,
    reported_date,
    evidence_id,
    rule_version_id,
    run_id,
    rationale,
    recorded_at
   FROM derived.observation_event;

COMMENT ON VIEW derived.observation_event_listing IS 'Observation events with their evidence link. No amount and no instrument identity.';

ALTER TABLE evidence.evidence ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME evidence.evidence_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE evidence.html_column_heading (
    evidence_id bigint NOT NULL,
    raw_text text NOT NULL,
    matched_text text NOT NULL,
    stack_above_evidence_id bigint,
    CONSTRAINT html_column_heading_check CHECK ((stack_above_evidence_id IS DISTINCT FROM evidence_id)),
    CONSTRAINT html_column_heading_matched_text_check CHECK ((btrim(matched_text) <> ''::text)),
    CONSTRAINT html_column_heading_raw_text_check CHECK ((btrim(raw_text) <> ''::text))
);

COMMENT ON TABLE evidence.html_column_heading IS 'Raw heading text and the whitespace-normalized match text for one HTML_COLUMN_HEADING. No field code is stored.';

COMMENT ON COLUMN evidence.html_column_heading.raw_text IS 'Heading text nodes exactly as read. A line break that was markup is not turned into a space here.';

COMMENT ON COLUMN evidence.html_column_heading.matched_text IS 'Heading text after a line break becomes a space and whitespace collapses. This is the string a rule may match.';

COMMENT ON COLUMN evidence.html_column_heading.stack_above_evidence_id IS 'Earlier heading cell in the same artifact and slot. The pair is a stacked header, not a field mapping.';

CREATE TABLE evidence.supplementary_evidence (
    id bigint NOT NULL,
    subject_table text NOT NULL,
    subject_id bigint NOT NULL,
    evidence_id bigint NOT NULL,
    role ref.evidence_role NOT NULL,
    note text,
    run_id bigint NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT supplementary_evidence_subject_table_check CHECK ((subject_table ~ '^(registry|obs|resolution|validation|derived)\.[a-z_]+$'::text))
);

ALTER TABLE evidence.supplementary_evidence ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME evidence.supplementary_evidence_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE identity.economic_group (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    display_label text NOT NULL,
    creation_reason text NOT NULL,
    run_id bigint NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT economic_group_creation_reason_check CHECK ((btrim(creation_reason) <> ''::text)),
    CONSTRAINT economic_group_display_label_check CHECK ((btrim(display_label) <> ''::text))
);

COMMENT ON TABLE identity.economic_group IS 'Related legal entities. Never inferred from name similarity alone; membership is a decision.';

CREATE TABLE identity.instrument (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    creation_reason text NOT NULL,
    run_id bigint NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT instrument_creation_reason_check CHECK ((btrim(creation_reason) <> ''::text))
);

COMMENT ON TABLE identity.instrument IS 'A specific loan, tranche, or security. Attributes are evidenced assertions, not columns.';

CREATE TABLE identity.instrument_attribute_assertion (
    id bigint NOT NULL,
    instrument_id uuid NOT NULL,
    field_code text NOT NULL,
    value_numeric numeric,
    value_date date,
    value_text text,
    value_state ref.value_state NOT NULL,
    rule_version_id bigint NOT NULL,
    evidence_id bigint NOT NULL,
    run_id bigint NOT NULL,
    supersedes_id bigint,
    supersede_reason text,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT instrument_attribute_assertion_check CHECK ((num_nonnulls(value_numeric, value_date, value_text) <= 1)),
    CONSTRAINT instrument_attribute_assertion_check1 CHECK (((value_state = 'REPORTED'::ref.value_state) = (num_nonnulls(value_numeric, value_date, value_text) = 1))),
    CONSTRAINT instrument_attribute_assertion_not_self_superseding CHECK ((supersedes_id IS DISTINCT FROM id)),
    CONSTRAINT instrument_attribute_assertion_value_state_check CHECK ((value_state = ANY (ARRAY['REPORTED'::ref.value_state, 'UNKNOWN'::ref.value_state, 'NOT_APPLICABLE'::ref.value_state])))
);

ALTER TABLE identity.instrument_attribute_assertion ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME identity.instrument_attribute_assertion_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE identity.legal_entity (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    creation_reason text NOT NULL,
    run_id bigint NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT legal_entity_creation_reason_check CHECK ((btrim(creation_reason) <> ''::text))
);

COMMENT ON TABLE identity.legal_entity IS 'A legal entity. Names live in identity.legal_entity_alias; there is no CIK column.';

CREATE TABLE identity.legal_entity_alias (
    id bigint NOT NULL,
    legal_entity_id uuid NOT NULL,
    alias_text text NOT NULL,
    verification_state text NOT NULL,
    rule_version_id bigint NOT NULL,
    evidence_id bigint NOT NULL,
    run_id bigint NOT NULL,
    supersedes_id bigint,
    supersede_reason text,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT legal_entity_alias_alias_text_check CHECK ((btrim(alias_text) <> ''::text)),
    CONSTRAINT legal_entity_alias_not_self_superseding CHECK ((supersedes_id IS DISTINCT FROM id)),
    CONSTRAINT legal_entity_alias_verification_state_check CHECK ((verification_state = ANY (ARRAY['UNVERIFIED'::text, 'VERIFIED'::text])))
);

ALTER TABLE identity.legal_entity_alias ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME identity.legal_entity_alias_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE identity."position" (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    registrant_id bigint NOT NULL,
    creation_reason text NOT NULL,
    run_id bigint NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT position_creation_reason_check CHECK ((btrim(creation_reason) <> ''::text))
);

COMMENT ON TABLE identity."position" IS 'Continuity of one registrant''s holding over time. registrant_id is the holder (the BDC), never the borrower.';

CREATE TABLE obs.borrower_name_observation (
    id bigint NOT NULL,
    position_observation_id bigint NOT NULL,
    source_column_label text,
    source_column_position integer,
    raw_text text NOT NULL,
    normalized_text text,
    extraction_state text NOT NULL,
    rule_version_id bigint NOT NULL,
    evidence_id bigint NOT NULL,
    run_id bigint NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    name_source text DEFAULT 'SOI_CELL'::text NOT NULL,
    supersedes_id bigint,
    supersede_reason text,
    CONSTRAINT borrower_name_observation_check CHECK (((extraction_state = 'EXTRACTED'::text) = (normalized_text IS NOT NULL))),
    CONSTRAINT borrower_name_observation_extraction_state_check CHECK ((extraction_state = ANY (ARRAY['RAW_ONLY'::text, 'EXTRACTED'::text, 'UNRESOLVED'::text]))),
    CONSTRAINT borrower_name_observation_name_source_check CHECK ((name_source = ANY (ARRAY['SOI_CELL'::text, 'FILING_CELL'::text]))),
    CONSTRAINT borrower_name_observation_not_self_superseding CHECK ((supersedes_id IS DISTINCT FROM id)),
    CONSTRAINT borrower_name_observation_raw_text_check CHECK ((raw_text <> ''::text)),
    CONSTRAINT borrower_name_observation_source_column_position_check CHECK ((source_column_position >= 1))
);

COMMENT ON TABLE obs.borrower_name_observation IS 'Name text as disclosed. It is an observation, not a legal entity; linking happens only through resolution decisions.';

COMMENT ON COLUMN obs.borrower_name_observation.name_source IS 'SOI_CELL cites an origin SOI cell. FILING_CELL cites a primary-filing cell and leaves the SOI source columns null. Neither source is derived from holding_descriptor_raw.';

COMMENT ON COLUMN obs.borrower_name_observation.supersedes_id IS 'The borrower-name row this row replaces. Null on a root. The replaced row is not updated.';

COMMENT ON COLUMN obs.borrower_name_observation.supersede_reason IS 'Why this row replaces supersedes_id. Required when supersedes_id is set. Null on a root.';

ALTER TABLE obs.borrower_name_observation ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME obs.borrower_name_observation_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE VIEW obs.current_borrower_name_observation AS
 SELECT id,
    position_observation_id,
    source_column_label,
    source_column_position,
    raw_text,
    normalized_text,
    extraction_state,
    rule_version_id,
    evidence_id,
    run_id,
    recorded_at,
    name_source,
    supersedes_id,
    supersede_reason
   FROM obs.borrower_name_observation b
  WHERE (NOT (EXISTS ( SELECT 1
           FROM obs.borrower_name_observation s
          WHERE (s.supersedes_id = b.id))));

COMMENT ON VIEW obs.current_borrower_name_observation IS 'The head of each borrower-name chain. One position may have several heads when its cells differ. A head is not a legal entity.';

CREATE TABLE obs.position_field_value (
    id bigint NOT NULL,
    position_observation_id bigint NOT NULL,
    field_code text NOT NULL,
    column_mapping_id bigint,
    source_column_label text,
    source_column_position integer,
    raw_value text,
    normalized_numeric numeric,
    normalized_date date,
    normalized_text text,
    unit_code text,
    currency_code text,
    currency_state ref.currency_state NOT NULL,
    scale_state ref.scale_state NOT NULL,
    value_state ref.value_state NOT NULL,
    unknown_reason text,
    not_applicable_reason text,
    normalization_rule_version_id bigint NOT NULL,
    evidence_id bigint NOT NULL,
    run_id bigint NOT NULL,
    supersedes_id bigint,
    supersede_reason text,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    date_precision text,
    normalized_year integer,
    normalized_month integer,
    CONSTRAINT field_value_currency CHECK (((currency_code IS NULL) = (currency_state = ANY (ARRAY['UNKNOWN'::ref.currency_state, 'AMBIGUOUS'::ref.currency_state])))),
    CONSTRAINT field_value_date_precision_check CHECK (((date_precision IS NULL) OR (date_precision = 'MONTH'::text))),
    CONSTRAINT field_value_mapping_needs_column CHECK (((column_mapping_id IS NULL) OR (source_column_label IS NOT NULL))),
    CONSTRAINT field_value_month_shape CHECK ((((date_precision IS NULL) AND (normalized_year IS NULL) AND (normalized_month IS NULL)) OR ((date_precision = 'MONTH'::text) AND ((normalized_year >= 1000) AND (normalized_year <= 9999)) AND ((normalized_month >= 1) AND (normalized_month <= 12)) AND (normalized_date IS NULL) AND (normalized_numeric IS NULL) AND (normalized_text IS NULL) AND (raw_value IS NOT NULL)))),
    CONSTRAINT field_value_not_applicable CHECK (((value_state <> 'NOT_APPLICABLE'::ref.value_state) OR ((num_nonnulls(normalized_numeric, normalized_date, normalized_text) = 0) AND (COALESCE(btrim(not_applicable_reason), ''::text) <> ''::text)))),
    CONSTRAINT field_value_reported CHECK (((value_state <> 'REPORTED'::ref.value_state) OR ((raw_value IS NOT NULL) AND ((num_nonnulls(normalized_numeric, normalized_date, normalized_text) = 1) OR (NOT (date_precision IS DISTINCT FROM 'MONTH'::text)) OR (scale_state = 'UNRESOLVED'::ref.scale_state))))),
    CONSTRAINT field_value_single_normalized CHECK ((num_nonnulls(normalized_numeric, normalized_date, normalized_text) <= 1)),
    CONSTRAINT field_value_source_column CHECK (((source_column_label IS NULL) = (source_column_position IS NULL))),
    CONSTRAINT field_value_unknown CHECK (((value_state <> 'UNKNOWN'::ref.value_state) OR ((num_nonnulls(normalized_numeric, normalized_date, normalized_text) = 0) AND (COALESCE(btrim(unknown_reason), ''::text) <> ''::text)))),
    CONSTRAINT field_value_zero_only_if_disclosed CHECK (((normalized_numeric IS DISTINCT FROM (0)::numeric) OR ops.text_is_numeric_zero(raw_value))),
    CONSTRAINT position_field_value_currency_code_check CHECK ((currency_code ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT position_field_value_not_self_superseding CHECK ((supersedes_id IS DISTINCT FROM id)),
    CONSTRAINT position_field_value_source_column_position_check CHECK ((source_column_position >= 1)),
    CONSTRAINT position_field_value_value_state_check CHECK ((value_state <> 'DERIVED'::ref.value_state))
);

COMMENT ON TABLE obs.position_field_value IS 'One field of one position observation. A field with no row is UNKNOWN in the views, never zero. Authority is computed by obs.field_value_authority.';

COMMENT ON COLUMN obs.position_field_value.date_precision IS 'MONTH means normalized_year and normalized_month, with normalized_date null. Null is not a precision token: an existing or disclosed calendar day stays in normalized_date, and a non-date value is also null. There is no DAY token.';

COMMENT ON COLUMN obs.position_field_value.normalized_year IS 'Four-digit year for date_precision MONTH. Null for every other value.';

COMMENT ON COLUMN obs.position_field_value.normalized_month IS 'Month 1 through 12 for date_precision MONTH. Null for every other value.';

CREATE VIEW obs.current_position_field_value AS
 SELECT id,
    position_observation_id,
    field_code,
    column_mapping_id,
    source_column_label,
    source_column_position,
    raw_value,
    normalized_numeric,
    normalized_date,
    normalized_text,
    unit_code,
    currency_code,
    currency_state,
    scale_state,
    value_state,
    unknown_reason,
    not_applicable_reason,
    normalization_rule_version_id,
    evidence_id,
    run_id,
    supersedes_id,
    supersede_reason,
    recorded_at
   FROM obs.position_field_value f
  WHERE (NOT (EXISTS ( SELECT 1
           FROM obs.position_field_value s
          WHERE (s.supersedes_id = f.id))));

CREATE VIEW obs.current_position_research_field AS
 SELECT fv.position_observation_id,
    fv.field_code,
    fv.raw_value,
    fv.value_state,
    e.evidence_level
   FROM (obs.position_field_value fv
     JOIN evidence.evidence e ON ((e.id = fv.evidence_id)))
  WHERE ((fv.field_code = ANY (ARRAY['INDUSTRY'::text, 'INSTRUMENT_TYPE'::text])) AND (NOT (EXISTS ( SELECT 1
           FROM obs.position_field_value newer
          WHERE (newer.supersedes_id = fv.id)))));

COMMENT ON VIEW obs.current_position_research_field IS 'Current INDUSTRY and INSTRUMENT_TYPE heads, with the evidence level of the stored value. A position with no current head has no row. Absence is not a value and is not copied from another row.';

CREATE TABLE ops.coverage_assertion (
    id bigint NOT NULL,
    registrant_id bigint,
    dataset_release_id bigint,
    reporting_period_end date,
    source_type_code text NOT NULL,
    coverage_state ref.coverage_state NOT NULL,
    evidence_id bigint,
    rationale text NOT NULL,
    rule_version_id bigint NOT NULL,
    run_id bigint NOT NULL,
    supersedes_id bigint,
    supersede_reason text,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    coverage_aspect text NOT NULL,
    CONSTRAINT coverage_assertion_check1 CHECK (((coverage_state <> ALL (ARRAY['COVERED'::ref.coverage_state, 'EMPTY_PERIOD'::ref.coverage_state])) OR (evidence_id IS NOT NULL))),
    CONSTRAINT coverage_assertion_not_self_superseding CHECK ((supersedes_id IS DISTINCT FROM id)),
    CONSTRAINT coverage_assertion_rationale_check CHECK ((btrim(rationale) <> ''::text)),
    CONSTRAINT coverage_assertion_scope CHECK ((((num_nonnulls(dataset_release_id, reporting_period_end) >= 1) OR ((coverage_aspect = 'FILING_HISTORY'::text) AND (registrant_id IS NOT NULL))) AND ((coverage_aspect <> 'SOI_HOLDINGS'::text) OR ((dataset_release_id IS NOT NULL) AND (source_type_code = 'SEC_BDC_DATASET_ZIP'::text)))))
);

COMMENT ON TABLE ops.coverage_assertion IS 'Explicit coverage per registrant (or release-wide when registrant_id is NULL), release or period, and source. Only COVERED means the source was ingested for that scope.';

CREATE VIEW ops.current_coverage AS
 SELECT id AS coverage_assertion_id,
    registrant_id,
    dataset_release_id,
    reporting_period_end,
    source_type_code,
    coverage_state,
    evidence_id,
    rule_version_id,
    recorded_at,
    (coverage_state = 'COVERED'::ref.coverage_state) AS is_covered,
    coverage_aspect
   FROM ops.coverage_assertion c
  WHERE (NOT (EXISTS ( SELECT 1
           FROM ops.coverage_assertion s
          WHERE (s.supersedes_id = c.id))));

COMMENT ON VIEW ops.current_coverage IS 'A scope with no row here has UNKNOWN coverage. Only is_covered = true allows "not reported" conclusions.';

CREATE VIEW obs.current_soi_coverage AS
 SELECT coverage_assertion_id,
    registrant_id,
    dataset_release_id,
    reporting_period_end,
    source_type_code,
    coverage_state,
    evidence_id,
    rule_version_id,
    recorded_at,
    is_covered,
    coverage_aspect
   FROM ops.current_coverage c
  WHERE (coverage_aspect = 'SOI_HOLDINGS'::text);

COMMENT ON VIEW obs.current_soi_coverage IS 'Current SOI_HOLDINGS coverage. Independent of FILING_METADATA. A scope with no row has UNKNOWN coverage, never zero holdings.';

CREATE TABLE obs.soi_row_classification (
    id bigint NOT NULL,
    soi_row_observation_id bigint NOT NULL,
    row_kind ref.row_kind NOT NULL,
    period_role ref.period_role NOT NULL,
    rule_version_id bigint NOT NULL,
    run_id bigint NOT NULL,
    supersedes_id bigint,
    supersede_reason text,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    evidence_id bigint,
    CONSTRAINT soi_row_classification_filing_evidence_check CHECK ((((row_kind)::text <> ALL (ARRAY['SUBTOTAL_ROW'::text, 'DIMENSION_FACT_ROW'::text])) OR (evidence_id IS NOT NULL))),
    CONSTRAINT soi_row_classification_not_self_superseding CHECK ((supersedes_id IS DISTINCT FROM id))
);

COMMENT ON TABLE obs.soi_row_classification IS 'Rule-versioned classification of a SOI row. Historical NO_IDENTIFIER_ROW rows stay stored with null evidence_id. SUBTOTAL_ROW and DIMENSION_FACT_ROW are new rows that supersede them and cite L2 filing evidence. Selecting current holdings is OPEN QUESTION Q6; UNRESOLVED is valid.';

COMMENT ON COLUMN obs.soi_row_classification.evidence_id IS 'Filing evidence for SUBTOTAL_ROW and DIMENSION_FACT_ROW. Null on IDENTIFIER_ROW, historical NO_IDENTIFIER_ROW, and UNCLASSIFIED. The SOI row observation keeps its own TSV evidence.';

CREATE VIEW obs.current_soi_row_classification AS
 SELECT id,
    soi_row_observation_id,
    row_kind,
    period_role,
    rule_version_id,
    run_id,
    supersedes_id,
    supersede_reason,
    recorded_at,
    evidence_id
   FROM obs.soi_row_classification c
  WHERE (NOT (EXISTS ( SELECT 1
           FROM obs.soi_row_classification s
          WHERE (s.supersedes_id = c.id))));

CREATE TABLE ref.field_definition (
    field_code text NOT NULL,
    value_type text NOT NULL,
    unit_kind text NOT NULL,
    level2_required boolean NOT NULL,
    description text NOT NULL,
    CONSTRAINT field_definition_field_code_check CHECK ((field_code ~ '^[A-Z][A-Z0-9_]*$'::text)),
    CONSTRAINT field_definition_unit_kind_check CHECK ((unit_kind = ANY (ARRAY['MONETARY'::text, 'RATE'::text, 'PERCENT'::text, 'DATE'::text, 'TEXT'::text, 'FLAG'::text]))),
    CONSTRAINT field_definition_value_type_check CHECK ((value_type = ANY (ARRAY['NUMERIC'::text, 'DATE'::text, 'TEXT'::text])))
);

COMMENT ON COLUMN ref.field_definition.level2_required IS 'True when docs/SOURCE_SCHEMAS.md marks the field "Level 2 extraction required": values stay UNKNOWN in the authority view until Level 2 evidence exists.';

CREATE TABLE validation.evidence_status_assertion (
    id bigint NOT NULL,
    field_value_id bigint NOT NULL,
    evidence_status ref.evidence_status NOT NULL,
    validation_result_id bigint,
    rule_version_id bigint NOT NULL,
    run_id bigint NOT NULL,
    supersedes_id bigint,
    supersede_reason text,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT evidence_status_assertion_check CHECK (((evidence_status <> ALL (ARRAY['FILING_VERIFIED'::ref.evidence_status, 'FILING_MISMATCH'::ref.evidence_status, 'UNVERIFIABLE'::ref.evidence_status])) OR (validation_result_id IS NOT NULL))),
    CONSTRAINT evidence_status_assertion_not_self_superseding CHECK ((supersedes_id IS DISTINCT FROM id))
);

COMMENT ON TABLE validation.evidence_status_assertion IS 'Evidence status of a field value over time. A field value with no assertion is NOT_CHECKED.';

CREATE VIEW validation.current_evidence_status AS
 SELECT f.id AS field_value_id,
    COALESCE(a.evidence_status, 'NOT_CHECKED'::ref.evidence_status) AS evidence_status,
    a.validation_result_id
   FROM (obs.current_position_field_value f
     LEFT JOIN validation.evidence_status_assertion a ON (((a.field_value_id = f.id) AND (NOT (EXISTS ( SELECT 1
           FROM validation.evidence_status_assertion s
          WHERE (s.supersedes_id = a.id)))))));

CREATE VIEW obs.field_value_authority AS
 SELECT f.id AS field_value_id,
    f.position_observation_id,
    f.field_code,
    f.source_column_label,
    f.value_state,
    f.currency_state,
    f.scale_state,
    e.evidence_level,
    es.evidence_status,
        CASE
            WHEN (f.column_mapping_id IS NULL) THEN NULL::ref.mapping_status
            ELSE ref.current_mapping_status(f.column_mapping_id)
        END AS mapping_status,
        CASE
            WHEN (f.value_state = 'UNKNOWN'::ref.value_state) THEN 'UNKNOWN'::text
            WHEN (f.value_state = 'NOT_APPLICABLE'::ref.value_state) THEN 'NOT_APPLICABLE'::text
            WHEN ((f.column_mapping_id IS NOT NULL) AND (ref.current_mapping_status(f.column_mapping_id) = 'REJECTED'::ref.mapping_status)) THEN 'UNRESOLVED'::text
            WHEN (fd.level2_required AND (e.evidence_level <> 'L2_ORIGINAL_FILING'::ref.evidence_level) AND (es.evidence_status <> 'FILING_VERIFIED'::ref.evidence_status)) THEN 'UNKNOWN'::text
            WHEN (es.evidence_status = 'FILING_MISMATCH'::ref.evidence_status) THEN 'UNRESOLVED'::text
            WHEN ((f.column_mapping_id IS NOT NULL) AND (ref.current_mapping_status(f.column_mapping_id) = ANY (ARRAY['OPEN_QUESTION'::ref.mapping_status, 'OBSERVED_UNCONFIRMED'::ref.mapping_status]))) THEN 'PROVISIONAL'::text
            WHEN (f.currency_state = 'FROM_NUM_UNIQUE_MATCH'::ref.currency_state) THEN 'PROVISIONAL'::text
            WHEN (f.scale_state = 'UNRESOLVED'::ref.scale_state) THEN 'UNRESOLVED'::text
            WHEN ((es.evidence_status = 'FILING_VERIFIED'::ref.evidence_status) OR (e.evidence_level = 'L2_ORIGINAL_FILING'::ref.evidence_level)) THEN 'AUTHORITATIVE'::text
            ELSE 'REPORTED_STRUCTURED'::text
        END AS authority
   FROM (((obs.current_position_field_value f
     JOIN ref.field_definition fd ON ((fd.field_code = f.field_code)))
     JOIN evidence.evidence e ON ((e.id = f.evidence_id)))
     JOIN validation.current_evidence_status es ON ((es.field_value_id = f.id)));

COMMENT ON VIEW obs.field_value_authority IS 'AUTHORITATIVE, REPORTED_STRUCTURED, PROVISIONAL, UNRESOLVED, UNKNOWN, or NOT_APPLICABLE per current field value. Derived values carry DERIVED in derived.derived_value.';

CREATE TABLE obs.field_value_corroboration (
    id bigint NOT NULL,
    field_value_id bigint NOT NULL,
    num_fact_observation_id bigint,
    outcome ref.corroboration_outcome NOT NULL,
    join_basis text NOT NULL,
    rule_version_id bigint NOT NULL,
    run_id bigint NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT field_value_corroboration_check CHECK (((num_fact_observation_id IS NOT NULL) = (outcome = ANY (ARRAY['EQUAL'::ref.corroboration_outcome, 'NOT_EQUAL'::ref.corroboration_outcome])))),
    CONSTRAINT field_value_corroboration_join_basis_check CHECK ((join_basis = ANY (ARRAY['DOCUMENTED'::text, 'OBSERVED_UNDOCUMENTED'::text])))
);

ALTER TABLE obs.field_value_corroboration ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME obs.field_value_corroboration_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE obs.maturity_inspection (
    id bigint NOT NULL,
    position_observation_id bigint NOT NULL,
    soi_row_observation_id bigint NOT NULL,
    inspection_state ref.maturity_inspection_state NOT NULL,
    filing_context_id text,
    raw_value text,
    normalized_date date,
    evidence_id bigint NOT NULL,
    rule_version_id bigint NOT NULL,
    run_id bigint NOT NULL,
    supersedes_id bigint,
    supersede_reason text,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    no_bind_reason ref.maturity_no_bind_reason,
    displayed_year integer,
    displayed_month integer,
    CONSTRAINT maturity_inspection_check CHECK ((supersedes_id IS DISTINCT FROM id)),
    CONSTRAINT maturity_inspection_filing_context_id_check CHECK ((filing_context_id ~ '^[A-Za-z0-9_-]+$'::text)),
    CONSTRAINT maturity_inspection_not_self_superseding CHECK ((supersedes_id IS DISTINCT FROM id)),
    CONSTRAINT maturity_inspection_state_shape CHECK (
CASE (inspection_state)::text
    WHEN 'FILING_DISPLAYED'::text THEN ((filing_context_id IS NOT NULL) AND (no_bind_reason IS NULL) AND (raw_value IS NOT NULL) AND (normalized_date IS NOT NULL) AND (displayed_year IS NULL) AND (displayed_month IS NULL))
    WHEN 'UNAVAILABLE'::text THEN ((filing_context_id IS NOT NULL) AND (no_bind_reason IS NULL) AND (raw_value IS NULL) AND (normalized_date IS NULL) AND (displayed_year IS NULL) AND (displayed_month IS NULL))
    WHEN 'UNRESOLVED'::text THEN ((filing_context_id IS NOT NULL) AND (no_bind_reason IS NULL) AND (normalized_date IS NULL) AND (displayed_year IS NULL) AND (displayed_month IS NULL))
    WHEN 'NOT_BOUND'::text THEN ((filing_context_id IS NULL) AND (no_bind_reason IS NOT NULL) AND (raw_value IS NULL) AND (normalized_date IS NULL) AND (displayed_year IS NULL) AND (displayed_month IS NULL))
    WHEN 'FILING_MONTH'::text THEN ((filing_context_id IS NOT NULL) AND (no_bind_reason IS NULL) AND (raw_value IS NOT NULL) AND (normalized_date IS NULL) AND ((displayed_year >= 1000) AND (displayed_year <= 9999)) AND ((displayed_month >= 1) AND (displayed_month <= 12)))
    ELSE false
END)
);

COMMENT ON TABLE obs.maturity_inspection IS 'Append-only inspection of one position origin. No row means the filing row has not been inspected. FILING_DISPLAYED is not a MATURITY_DATE field value.';

COMMENT ON COLUMN obs.maturity_inspection.evidence_id IS 'Bound states: L2 HTML_ANCHOR ix-context-row:<filing_context_id> on the position filing, and a PASS validation on the position cites a same-artifact IXBRL_FACT for that context. NOT_BOUND: L2 DOCUMENT on the position filing artifact, and a FAIL validation of the same rule version and run carries no_bind_reason.';

COMMENT ON COLUMN obs.maturity_inspection.no_bind_reason IS 'Why no filing row was accepted. Set only for NOT_BOUND.';

COMMENT ON COLUMN obs.maturity_inspection.displayed_year IS 'Four-digit year for FILING_MONTH. Null for every other inspection state. This is not a calendar day.';

COMMENT ON COLUMN obs.maturity_inspection.displayed_month IS 'Month 1 through 12 for FILING_MONTH. Null for every other inspection state. This is not a calendar day.';

CREATE TABLE obs.maturity_inspection_candidate (
    id bigint NOT NULL,
    maturity_inspection_id bigint NOT NULL,
    raw_value text NOT NULL,
    normalized_date date,
    evidence_id bigint NOT NULL,
    run_id bigint NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT maturity_inspection_candidate_raw_value_check CHECK ((btrim(raw_value) <> ''::text))
);

COMMENT ON TABLE obs.maturity_inspection_candidate IS 'One candidate displayed date for an UNRESOLVED inspection. None of the candidates is selected.';

ALTER TABLE obs.maturity_inspection_candidate ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME obs.maturity_inspection_candidate_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE obs.maturity_inspection ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME obs.maturity_inspection_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE VIEW obs.maturity_provenance AS
 SELECT position_observation_id,
    provenance_state,
    inspection_id,
    inspection_state,
    filing_context_id,
    structured_raw,
    structured_date,
    displayed_raw,
    displayed_date,
    evidence_id,
    no_bind_reason,
        CASE (provenance_state)::text
            WHEN 'REPORTED_STRUCTURED'::text THEN structured_date
            WHEN 'FILING_DISPLAYED'::text THEN displayed_date
            ELSE NULL::date
        END AS maturity_date,
        CASE (provenance_state)::text
            WHEN 'REPORTED_STRUCTURED'::text THEN structured_raw
            WHEN 'FILING_DISPLAYED'::text THEN displayed_raw
            WHEN 'REPORTED_MONTH'::text THEN structured_raw
            WHEN 'FILING_MONTH'::text THEN displayed_raw
            ELSE NULL::text
        END AS maturity_raw,
    ((provenance_state = 'REPORTED_STRUCTURED'::ref.maturity_provenance_state) AND (NOT (inspection_state IS DISTINCT FROM 'FILING_DISPLAYED'::ref.maturity_inspection_state))) AS filing_verified,
    structured_field_value_id,
        CASE (provenance_state)::text
            WHEN 'FILING_MONTH'::text THEN 'MONTH'::text
            WHEN 'REPORTED_MONTH'::text THEN 'MONTH'::text
            ELSE NULL::text
        END AS maturity_precision,
        CASE (provenance_state)::text
            WHEN 'FILING_MONTH'::text THEN displayed_year
            WHEN 'REPORTED_MONTH'::text THEN structured_year
            ELSE NULL::integer
        END AS maturity_year,
        CASE (provenance_state)::text
            WHEN 'FILING_MONTH'::text THEN displayed_month
            WHEN 'REPORTED_MONTH'::text THEN structured_month
            ELSE NULL::integer
        END AS maturity_month
   FROM ( SELECT p.id AS position_observation_id,
                CASE
                    WHEN ((structured.n = 1) AND (structured.distinct_dates = 1) AND ((i.id IS NULL) OR ((i.inspection_state)::text = ANY (ARRAY['NOT_BOUND'::text, 'UNAVAILABLE'::text])) OR (((i.inspection_state)::text = 'FILING_DISPLAYED'::text) AND (i.normalized_date = structured.maturity_date)))) THEN 'REPORTED_STRUCTURED'::ref.maturity_provenance_state
                    WHEN ((structured.n = 1) AND (structured.distinct_dates = 0) AND (structured.month_rows = 1) AND ((i.id IS NULL) OR ((i.inspection_state)::text = ANY (ARRAY['NOT_BOUND'::text, 'UNAVAILABLE'::text])) OR (((i.inspection_state)::text = 'FILING_MONTH'::text) AND (i.displayed_year = structured.maturity_year) AND (i.displayed_month = structured.maturity_month)))) THEN 'REPORTED_MONTH'::ref.maturity_provenance_state
                    WHEN ((structured.n = 0) AND ((i.id IS NULL) OR ((i.inspection_state)::text = ANY (ARRAY['NOT_BOUND'::text, 'UNAVAILABLE'::text])))) THEN 'UNKNOWN'::ref.maturity_provenance_state
                    WHEN ((structured.n = 0) AND ((i.inspection_state)::text = 'FILING_DISPLAYED'::text)) THEN 'FILING_DISPLAYED'::ref.maturity_provenance_state
                    WHEN ((structured.n = 0) AND ((i.inspection_state)::text = 'FILING_MONTH'::text)) THEN 'FILING_MONTH'::ref.maturity_provenance_state
                    ELSE 'UNRESOLVED'::ref.maturity_provenance_state
                END AS provenance_state,
            i.id AS inspection_id,
            i.inspection_state,
            i.filing_context_id,
            structured.raw_value AS structured_raw,
            structured.maturity_date AS structured_date,
            structured.maturity_year AS structured_year,
            structured.maturity_month AS structured_month,
            i.raw_value AS displayed_raw,
            i.normalized_date AS displayed_date,
            i.displayed_year,
            i.displayed_month,
            i.evidence_id,
            i.no_bind_reason,
            structured.field_value_id AS structured_field_value_id
           FROM ((obs.position_observation p
             LEFT JOIN obs.maturity_inspection i ON (((i.position_observation_id = p.id) AND (NOT (EXISTS ( SELECT 1
                   FROM obs.maturity_inspection s
                  WHERE (s.supersedes_id = i.id)))))))
             LEFT JOIN LATERAL ( SELECT (count(fv.id))::integer AS n,
                    (count(DISTINCT fv.normalized_date))::integer AS distinct_dates,
                    (count(*) FILTER (WHERE ((fv.date_precision = 'MONTH'::text) AND (fv.normalized_date IS NULL) AND ((fv.normalized_year >= 1000) AND (fv.normalized_year <= 9999)) AND ((fv.normalized_month >= 1) AND (fv.normalized_month <= 12)) AND (fv.raw_value IS NOT NULL))))::integer AS month_rows,
                    min(fv.normalized_date) AS maturity_date,
                    min(fv.raw_value) AS raw_value,
                    min(fv.normalized_year) FILTER (WHERE (fv.date_precision = 'MONTH'::text)) AS maturity_year,
                    min(fv.normalized_month) FILTER (WHERE (fv.date_precision = 'MONTH'::text)) AS maturity_month,
                        CASE
                            WHEN (count(fv.id) = 1) THEN min(fv.id)
                            ELSE NULL::bigint
                        END AS field_value_id
                   FROM obs.position_field_value fv
                  WHERE ((fv.position_observation_id = p.id) AND (fv.field_code = 'MATURITY_DATE'::text) AND (fv.value_state = 'REPORTED'::ref.value_state) AND (NOT (EXISTS ( SELECT 1
                           FROM obs.position_field_value s
                          WHERE (s.supersedes_id = fv.id)))))) structured ON (true))) b;

COMMENT ON VIEW obs.maturity_provenance IS 'One product maturity per position. maturity_date is a calendar day from REPORTED_STRUCTURED or FILING_DISPLAYED only. FILING_MONTH and REPORTED_MONTH keep maturity_date null and expose maturity_precision MONTH. UNRESOLVED selects nothing. FILING_DISPLAYED is not copied into MATURITY_DATE.';

COMMENT ON COLUMN obs.maturity_provenance.maturity_date IS 'Product maturity calendar day. NULL for UNKNOWN, UNRESOLVED, FILING_MONTH, and REPORTED_MONTH.';

COMMENT ON COLUMN obs.maturity_provenance.maturity_raw IS 'The value exactly as disclosed by the source named in provenance_state.';

COMMENT ON COLUMN obs.maturity_provenance.filing_verified IS 'The structured date is the product maturity and the current filing inspection displays the same date.';

COMMENT ON COLUMN obs.maturity_provenance.structured_field_value_id IS 'The single current REPORTED MATURITY_DATE field value, when there is exactly one.';

COMMENT ON COLUMN obs.maturity_provenance.maturity_precision IS 'MONTH when the product maturity is a disclosed month and year. NULL when it is a calendar day or absent.';

COMMENT ON COLUMN obs.maturity_provenance.maturity_year IS 'Four-digit year for maturity_precision MONTH. NULL for a calendar day; that year stays on maturity_date.';

COMMENT ON COLUMN obs.maturity_provenance.maturity_month IS 'Month 1 through 12 for maturity_precision MONTH. NULL otherwise.';

ALTER TABLE obs.num_fact_observation ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME obs.num_fact_observation_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE obs.observation_equivalence (
    id bigint NOT NULL,
    tabular_row_id bigint NOT NULL,
    equivalent_tabular_row_id bigint NOT NULL,
    basis text NOT NULL,
    rule_version_id bigint NOT NULL,
    run_id bigint NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT observation_equivalence_basis_check CHECK ((basis = 'RAW_LINE_SHA256_EQUAL'::text)),
    CONSTRAINT observation_equivalence_check CHECK ((tabular_row_id <> equivalent_tabular_row_id))
);

ALTER TABLE obs.observation_equivalence ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME obs.observation_equivalence_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE VIEW obs.position_field_status AS
 SELECT p.id AS position_observation_id,
    fd.field_code,
    a.field_value_id,
    a.source_column_label,
    COALESCE(a.value_state, 'UNKNOWN'::ref.value_state) AS value_state,
    COALESCE(a.authority, 'UNKNOWN'::text) AS authority
   FROM ((obs.position_observation p
     CROSS JOIN ref.field_definition fd)
     LEFT JOIN obs.field_value_authority a ON (((a.position_observation_id = p.id) AND (a.field_code = fd.field_code))));

ALTER TABLE obs.position_field_value ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME obs.position_field_value_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE obs.position_observation_group (
    id bigint NOT NULL,
    filing_id bigint NOT NULL,
    state ref.resolution_state NOT NULL,
    rationale text NOT NULL,
    rule_version_id bigint NOT NULL,
    run_id bigint NOT NULL,
    supersedes_id bigint,
    supersede_reason text,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    grouping_key text,
    CONSTRAINT position_observation_group_key_check CHECK (((grouping_key IS NULL) OR (btrim(grouping_key) <> ''::text))),
    CONSTRAINT position_observation_group_not_self_superseding CHECK ((supersedes_id IS DISTINCT FROM id)),
    CONSTRAINT position_observation_group_rationale_check CHECK ((btrim(rationale) <> ''::text))
);

COMMENT ON COLUMN obs.position_observation_group.grouping_key IS 'Deterministic identity of one fact group for one rule version. A second insert of the same key is rejected. The key does not replace the source observations.';

ALTER TABLE obs.position_observation_group ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME obs.position_observation_group_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE obs.position_observation_group_member (
    id bigint NOT NULL,
    group_id bigint NOT NULL,
    position_observation_id bigint NOT NULL,
    run_id bigint NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    member_role obs.soi_fact_member_role NOT NULL,
    evidence_id bigint NOT NULL
);

COMMENT ON COLUMN obs.position_observation_group_member.member_role IS 'Fact role of this source row inside the group: BALANCE, SPREAD, or PIK. The role does not merge the row into another observation.';

COMMENT ON COLUMN obs.position_observation_group_member.evidence_id IS 'Evidence whose tabular row is the member observation source row.';

ALTER TABLE obs.position_observation_group_member ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME obs.position_observation_group_member_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE obs.position_observation ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME obs.position_observation_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE obs.position_observation_source (
    id bigint NOT NULL,
    position_observation_id bigint NOT NULL,
    soi_row_observation_id bigint NOT NULL,
    source_role ref.source_role NOT NULL,
    run_id bigint NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE obs.position_observation_source ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME obs.position_observation_source_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE VIEW obs.soi_duplicate_key_groups AS
 SELECT o.filing_id,
    f.accession_number,
    o.identifier_raw,
    o.reported_date,
    o.qtrs,
    count(*) AS observation_count
   FROM (obs.soi_row_observation o
     JOIN registry.filing f ON ((f.id = o.filing_id)))
  WHERE (o.identifier_raw IS NOT NULL)
  GROUP BY o.filing_id, f.accession_number, o.identifier_raw, o.reported_date, o.qtrs
 HAVING (count(*) > 1);

COMMENT ON VIEW obs.soi_duplicate_key_groups IS 'Metric only: groups sharing accession, identifier, ddate, and qtrs. Not an identity key and not a merge.';

CREATE TABLE ops.projection_exception (
    id bigint NOT NULL,
    table_load_id bigint NOT NULL,
    tabular_row_id bigint,
    kind text NOT NULL,
    detail text NOT NULL,
    evidence_id bigint NOT NULL,
    rule_version_id bigint NOT NULL,
    run_id bigint NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT projection_exception_detail_check CHECK ((btrim(detail) <> ''::text)),
    CONSTRAINT projection_exception_kind_check CHECK ((kind = ANY (ARRAY['FIELD_COUNT_MISMATCH'::text, 'ORPHAN_ADSH'::text]))),
    CONSTRAINT projection_exception_tabular_row_id_check CHECK ((tabular_row_id IS NOT NULL))
);

COMMENT ON TABLE ops.projection_exception IS 'Raw SOI lines that were kept losslessly but not projected: field-count mismatches and accession values with no registry.filing row.';

CREATE TABLE raw.artifact_member (
    id bigint NOT NULL,
    artifact_id bigint NOT NULL,
    member_path text NOT NULL,
    byte_size bigint NOT NULL,
    sha256 text NOT NULL,
    run_id bigint NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT artifact_member_byte_size_check CHECK ((byte_size >= 0)),
    CONSTRAINT artifact_member_member_path_check CHECK ((btrim(member_path) <> ''::text)),
    CONSTRAINT artifact_member_sha256_check CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text))
);

CREATE TABLE raw.table_load (
    id bigint NOT NULL,
    artifact_id bigint NOT NULL,
    artifact_member_id bigint,
    table_code text NOT NULL,
    delimiter text NOT NULL,
    header text[] NOT NULL,
    header_sha256 text NOT NULL,
    parser_rule_version_id bigint NOT NULL,
    row_count bigint NOT NULL,
    field_count_mismatch_count bigint NOT NULL,
    parse_status ref.parse_status NOT NULL,
    run_id bigint NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT table_load_check CHECK (((field_count_mismatch_count >= 0) AND (field_count_mismatch_count <= row_count))),
    CONSTRAINT table_load_delimiter_check CHECK ((delimiter = ANY (ARRAY['	'::text, ','::text]))),
    CONSTRAINT table_load_header_sha256_check CHECK ((header_sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT table_load_row_count_check CHECK ((row_count >= 0))
);

COMMENT ON TABLE raw.table_load IS 'One parse of one tabular member. header is the exact header row, in order.';

CREATE TABLE raw.tabular_row (
    id bigint NOT NULL,
    table_load_id bigint NOT NULL,
    line_number bigint NOT NULL,
    raw_line text NOT NULL,
    raw_line_sha256 text NOT NULL,
    cells text[] NOT NULL,
    field_count integer NOT NULL,
    parse_status ref.parse_status NOT NULL,
    run_id bigint NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tabular_row_check CHECK ((cardinality(cells) = field_count)),
    CONSTRAINT tabular_row_field_count_check CHECK ((field_count >= 0)),
    CONSTRAINT tabular_row_line_number_check CHECK ((line_number >= 1)),
    CONSTRAINT tabular_row_parse_status_check CHECK ((parse_status = ANY (ARRAY['OK'::ref.parse_status, 'FIELD_COUNT_MISMATCH'::ref.parse_status]))),
    CONSTRAINT tabular_row_raw_line_sha256_check CHECK ((raw_line_sha256 ~ '^[0-9a-f]{64}$'::text))
);

COMMENT ON TABLE raw.tabular_row IS 'One physical line of a TSV/CSV member, exactly as received. (table_load_id, line_number) is a location, not a business key.';

COMMENT ON COLUMN raw.tabular_row.cells IS 'Cells aligned by position with raw.table_load.header. For tab-delimited loads, cells must equal the raw line split on tabs.';

CREATE VIEW obs.soi_load_reconciliation AS
 SELECT tl.id AS table_load_id,
    tl.artifact_id,
    m.member_path,
    m.byte_size AS member_byte_size,
    cardinality(tl.header) AS header_width,
    tl.row_count,
    tl.field_count_mismatch_count,
    tl.parse_status,
    ( SELECT count(*) AS count
           FROM raw.tabular_row r
          WHERE ((r.table_load_id = tl.id) AND (r.parse_status = 'OK'::ref.parse_status))) AS ok_row_count,
    ( SELECT count(*) AS count
           FROM (obs.soi_row_observation o
             JOIN raw.tabular_row r ON ((r.id = o.tabular_row_id)))
          WHERE (r.table_load_id = tl.id)) AS soi_row_observation_count,
    ( SELECT count(*) AS count
           FROM ((obs.position_observation p
             JOIN obs.soi_row_observation o ON ((o.id = p.origin_soi_row_observation_id)))
             JOIN raw.tabular_row r ON ((r.id = o.tabular_row_id)))
          WHERE (r.table_load_id = tl.id)) AS position_observation_count,
    ( SELECT count(*) AS count
           FROM (obs.soi_row_observation o
             JOIN raw.tabular_row r ON ((r.id = o.tabular_row_id)))
          WHERE ((r.table_load_id = tl.id) AND (o.identifier_raw IS NOT NULL))) AS identifier_row_count,
    ( SELECT count(*) AS count
           FROM (obs.soi_row_observation o
             JOIN raw.tabular_row r ON ((r.id = o.tabular_row_id)))
          WHERE ((r.table_load_id = tl.id) AND (o.identifier_raw IS NULL))) AS no_identifier_row_count,
    ( SELECT count(*) AS count
           FROM ops.projection_exception e
          WHERE ((e.table_load_id = tl.id) AND (e.kind = 'ORPHAN_ADSH'::text))) AS orphan_adsh_count,
    ( SELECT count(*) AS count
           FROM ops.projection_exception e
          WHERE ((e.table_load_id = tl.id) AND (e.kind = 'FIELD_COUNT_MISMATCH'::text))) AS quarantined_mismatch_count
   FROM (raw.table_load tl
     LEFT JOIN raw.artifact_member m ON ((m.id = tl.artifact_member_id)))
  WHERE (tl.table_code = 'SOI'::text);

COMMENT ON VIEW obs.soi_load_reconciliation IS 'Per SOI table load: landed rows vs projected observations. Duplicate business keys are not collapsed.';

ALTER TABLE obs.soi_row_classification ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME obs.soi_row_classification_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE obs.soi_row_observation ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME obs.soi_row_observation_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE ops.artifact_processing ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME ops.artifact_processing_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE ops.audit_event (
    id bigint NOT NULL,
    event_kind text NOT NULL,
    subject_table text,
    subject_id text,
    actor text NOT NULL,
    reason text NOT NULL,
    details jsonb,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT audit_event_actor_check CHECK ((btrim(actor) <> ''::text)),
    CONSTRAINT audit_event_event_kind_check CHECK ((event_kind ~ '^[A-Z][A-Z0-9_]*$'::text)),
    CONSTRAINT audit_event_reason_check CHECK ((btrim(reason) <> ''::text)),
    CONSTRAINT audit_event_subject_table_check CHECK ((subject_table ~ '^[a-z_]+\.[a-z_]+$'::text))
);

ALTER TABLE ops.audit_event ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME ops.audit_event_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE ops.coverage_assertion ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME ops.coverage_assertion_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE ops.projection_exception ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME ops.projection_exception_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE ops.rule_activation (
    id bigint NOT NULL,
    rule_version_id bigint NOT NULL,
    action text NOT NULL,
    effective_at timestamp with time zone NOT NULL,
    reason text NOT NULL,
    actor text NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rule_activation_action_check CHECK ((action = ANY (ARRAY['ACTIVATE'::text, 'DEACTIVATE'::text]))),
    CONSTRAINT rule_activation_actor_check CHECK ((btrim(actor) <> ''::text)),
    CONSTRAINT rule_activation_reason_check CHECK ((btrim(reason) <> ''::text))
);

ALTER TABLE ops.rule_activation ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME ops.rule_activation_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE ops.rule_version ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME ops.rule_version_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE ops.run ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME ops.run_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE ops.run_outcome ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME ops.run_outcome_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE ops.run_rule_version (
    id bigint NOT NULL,
    run_id bigint NOT NULL,
    rule_version_id bigint NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ops.run_rule_version ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME ops.run_rule_version_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE ops.schema_migration (
    filename text NOT NULL,
    sha256 text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT schema_migration_filename_check CHECK ((filename ~ '^[0-9]{4}_[a-z0-9_]+\.sql$'::text)),
    CONSTRAINT schema_migration_sha256_check CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text))
);

ALTER TABLE raw.artifact ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME raw.artifact_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE raw.artifact_lineage (
    id bigint NOT NULL,
    artifact_id bigint NOT NULL,
    previous_artifact_id bigint NOT NULL,
    basis text NOT NULL,
    run_id bigint NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT artifact_lineage_basis_check CHECK ((basis = 'SAME_SOURCE_URL'::text)),
    CONSTRAINT artifact_lineage_check CHECK ((artifact_id <> previous_artifact_id))
);

ALTER TABLE raw.artifact_lineage ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME raw.artifact_lineage_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE raw.artifact_member ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME raw.artifact_member_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE raw.json_document (
    id bigint NOT NULL,
    artifact_id bigint NOT NULL,
    body text NOT NULL,
    run_id bigint NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL
);

COMMENT ON TABLE raw.json_document IS 'A JSON artifact body exactly as received (UTF-8 text whose SHA-256 equals the artifact checksum).';

ALTER TABLE raw.json_document ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME raw.json_document_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE raw."json_value" (
    id bigint NOT NULL,
    json_document_id bigint NOT NULL,
    artifact_id bigint NOT NULL,
    json_path text NOT NULL,
    container_path text,
    array_index integer,
    value_type text NOT NULL,
    value_text text,
    run_id bigint NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT json_value_array_index_check CHECK ((array_index >= 0)),
    CONSTRAINT json_value_check CHECK (((value_type = ANY (ARRAY['object'::text, 'array'::text, 'null'::text])) = (value_text IS NULL))),
    CONSTRAINT json_value_check1 CHECK (((json_path = '$'::text) = (container_path IS NULL))),
    CONSTRAINT json_value_json_path_check CHECK ((json_path ~ '^\$'::text)),
    CONSTRAINT json_value_value_type_check CHECK ((value_type = ANY (ARRAY['object'::text, 'array'::text, 'string'::text, 'number'::text, 'boolean'::text, 'null'::text])))
);

COMMENT ON TABLE raw."json_value" IS 'Every node of a raw.json_document, written only by the database flattening trigger. json_path is an SQL/JSON path with quoted keys and 0-based indexes.';

ALTER TABLE raw."json_value" ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME raw.json_value_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE raw.table_load ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME raw.table_load_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE raw.tabular_row ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME raw.tabular_row_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE ref.coverage_aspect (
    code text NOT NULL,
    description text NOT NULL,
    CONSTRAINT coverage_aspect_code_check CHECK ((code ~ '^[A-Z][A-Z0-9_]*$'::text))
);

CREATE TABLE ref.source_column_mapping (
    id bigint NOT NULL,
    source_table_code text NOT NULL,
    column_label text NOT NULL,
    mapping_target ref.mapping_target NOT NULL,
    field_code text,
    mapping_basis ref.mapping_basis NOT NULL,
    mapping_status ref.mapping_status NOT NULL,
    open_question_ref text,
    source_schema_reference text NOT NULL,
    rule_version_id bigint NOT NULL,
    recorded_by text NOT NULL,
    supersedes_id bigint,
    supersede_reason text,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT source_column_mapping_check CHECK (((mapping_target = 'POSITION_FIELD'::ref.mapping_target) = (field_code IS NOT NULL))),
    CONSTRAINT source_column_mapping_check1 CHECK (((mapping_status <> 'OPEN_QUESTION'::ref.mapping_status) OR (open_question_ref IS NOT NULL))),
    CONSTRAINT source_column_mapping_check2 CHECK (((mapping_status <> ALL (ARRAY['DOCUMENTED'::ref.mapping_status, 'DOCUMENTED_AND_OBSERVED'::ref.mapping_status])) OR (mapping_basis = ANY (ARRAY['DOCUMENTED_PRESET'::ref.mapping_basis, 'DOCUMENTED_SOURCE'::ref.mapping_basis])))),
    CONSTRAINT source_column_mapping_column_label_check CHECK ((column_label <> ''::text)),
    CONSTRAINT source_column_mapping_not_self_superseding CHECK ((supersedes_id IS DISTINCT FROM id)),
    CONSTRAINT source_column_mapping_open_question_ref_check CHECK ((open_question_ref ~ '^Q[0-9]+$'::text)),
    CONSTRAINT source_column_mapping_recorded_by_check CHECK ((btrim(recorded_by) <> ''::text)),
    CONSTRAINT source_column_mapping_source_schema_reference_check CHECK ((btrim(source_schema_reference) <> ''::text))
);

COMMENT ON TABLE ref.source_column_mapping IS 'Which source column feeds which field, and on what basis. Only DOCUMENTED and DOCUMENTED_AND_OBSERVED mappings may feed derived values.';

CREATE VIEW ref.current_column_mapping AS
 SELECT id AS mapping_id,
    source_table_code,
    column_label,
    mapping_target,
    field_code,
    mapping_basis,
    mapping_status,
    open_question_ref,
    source_schema_reference,
    rule_version_id,
    (mapping_status = ANY (ARRAY['DOCUMENTED'::ref.mapping_status, 'DOCUMENTED_AND_OBSERVED'::ref.mapping_status])) AS may_feed_derived_values
   FROM ref.source_column_mapping m
  WHERE (NOT (EXISTS ( SELECT 1
           FROM ref.source_column_mapping s
          WHERE (s.supersedes_id = m.id))));

CREATE TABLE ref.dataset_table (
    code text NOT NULL,
    description text NOT NULL,
    CONSTRAINT dataset_table_code_check CHECK ((code ~ '^[A-Z][A-Z0-9_]*$'::text))
);

CREATE TABLE ref.filing_attribute (
    code text NOT NULL,
    description text NOT NULL,
    CONSTRAINT filing_attribute_code_check CHECK ((code ~ '^[A-Z][A-Z0-9_]*$'::text))
);

ALTER TABLE ref.registry_field_mapping ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME ref.registry_field_mapping_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE ref.source_column_mapping ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME ref.source_column_mapping_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE ref.source_type (
    code text NOT NULL,
    source_register_id text NOT NULL,
    description text NOT NULL,
    CONSTRAINT source_type_code_check CHECK ((code ~ '^[A-Z][A-Z0-9_]*$'::text)),
    CONSTRAINT source_type_source_register_id_check CHECK ((source_register_id ~ '^S[0-9]+$'::text))
);

COMMENT ON TABLE ref.source_type IS 'Source types; source_register_id refers to the register in docs/SOURCE_SCHEMAS.md.';

CREATE TABLE registry.bdc_report_edition (
    id bigint NOT NULL,
    page_artifact_id bigint NOT NULL,
    link_href text NOT NULL,
    csv_url text NOT NULL,
    year_label_raw text NOT NULL,
    report_year integer,
    updated_label_raw text,
    evidence_id bigint NOT NULL,
    rule_version_id bigint NOT NULL,
    run_id bigint NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bdc_report_edition_check CHECK ((csv_url = ('https://www.sec.gov'::text || link_href))),
    CONSTRAINT bdc_report_edition_check1 CHECK (((report_year IS NOT NULL) = (year_label_raw ~ '^[0-9]{4}$'::text))),
    CONSTRAINT bdc_report_edition_check2 CHECK (((report_year IS NULL) OR (report_year = (year_label_raw)::integer))),
    CONSTRAINT bdc_report_edition_link_href_check CHECK ((link_href ~ '^/files/.+\.csv$'::text)),
    CONSTRAINT bdc_report_edition_report_year_check CHECK (((report_year >= 1990) AND (report_year <= 2999)))
);

COMMENT ON TABLE registry.bdc_report_edition IS 'Each BDC Report CSV link on one page retrieval. The year comes from the link text, never from the file name (SOURCE_SCHEMAS 6.1).';

COMMENT ON COLUMN registry.bdc_report_edition.updated_label_raw IS 'The adjacent "Updated" text exactly as shown; not normalized.';

ALTER TABLE registry.bdc_report_edition ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME registry.bdc_report_edition_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE VIEW registry.bdc_report_edition_status AS
 SELECT ed.id AS edition_id,
    ed.page_artifact_id,
    ed.csv_url,
    ed.year_label_raw,
    ed.report_year,
    ed.updated_label_raw,
    csv.artifact_id AS csv_artifact_id,
    csv.outcome AS load_outcome,
    csv.detail AS load_detail,
    COALESCE(csv.outcome, 'NOT_RETRIEVED'::text) AS edition_state
   FROM (registry.bdc_report_edition ed
     LEFT JOIN LATERAL ( SELECT a.id AS artifact_id,
            p.outcome,
            p.detail
           FROM (raw.artifact a
             LEFT JOIN ops.artifact_processing p ON ((p.artifact_id = a.id)))
          WHERE (a.source_url = ed.csv_url)
          ORDER BY a.retrieved_at DESC, a.id DESC, p.id DESC
         LIMIT 1) csv ON (true));

COMMENT ON VIEW registry.bdc_report_edition_status IS 'Each listed BDC Report CSV and whether its latest retrieval was LOADED, recorded as SCHEMA_DRIFT or NOT_IN_SCOPE, or not retrieved.';

CREATE TABLE registry.registrant_name_history_observation (
    id bigint NOT NULL,
    registrant_id bigint NOT NULL,
    name_raw text NOT NULL,
    from_raw text,
    to_raw text,
    rule_version_id bigint NOT NULL,
    run_id bigint NOT NULL,
    evidence_id bigint NOT NULL,
    supersedes_id bigint,
    supersede_reason text,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT registrant_name_history_observation_not_self_superseding CHECK ((supersedes_id IS DISTINCT FROM id))
);

COMMENT ON TABLE registry.registrant_name_history_observation IS 'One former-name entry as disclosed. from/to are raw text only: their time zone meaning is OPEN QUESTION Q22.';

CREATE VIEW registry.current_registrant_name_history AS
 SELECT h.id AS observation_id,
    h.registrant_id,
    r.cik,
    h.name_raw,
    h.from_raw,
    h.to_raw,
    raw.source_stream(e.artifact_id) AS source_stream,
    h.evidence_id,
    h.rule_version_id,
    h.run_id
   FROM ((registry.registrant_name_history_observation h
     JOIN registry.registrant r ON ((r.id = h.registrant_id)))
     JOIN evidence.evidence e ON ((e.id = h.evidence_id)))
  WHERE (NOT (EXISTS ( SELECT 1
           FROM registry.registrant_name_history_observation s
          WHERE (s.supersedes_id = h.id))));

CREATE TABLE resolution.entity_resolution_decision (
    id bigint NOT NULL,
    borrower_name_observation_id bigint NOT NULL,
    legal_entity_id uuid,
    match_candidate_id bigint,
    state ref.resolution_state NOT NULL,
    method text NOT NULL,
    rationale text NOT NULL,
    actor_kind ref.actor_kind NOT NULL,
    decided_by text NOT NULL,
    decided_at timestamp with time zone NOT NULL,
    rule_version_id bigint NOT NULL,
    evidence_id bigint NOT NULL,
    run_id bigint NOT NULL,
    supersedes_id bigint,
    supersede_reason text,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT entity_resolution_decision_check CHECK (((state = 'UNRESOLVED'::ref.resolution_state) OR (legal_entity_id IS NOT NULL))),
    CONSTRAINT entity_resolution_decision_decided_by_check CHECK ((btrim(decided_by) <> ''::text)),
    CONSTRAINT entity_resolution_decision_method_check CHECK ((btrim(method) <> ''::text)),
    CONSTRAINT entity_resolution_decision_not_self_superseding CHECK ((supersedes_id IS DISTINCT FROM id)),
    CONSTRAINT entity_resolution_decision_rationale_check CHECK ((btrim(rationale) <> ''::text))
);

CREATE VIEW resolution.current_entity_resolution AS
 SELECT id,
    borrower_name_observation_id,
    legal_entity_id,
    match_candidate_id,
    state,
    method,
    rationale,
    actor_kind,
    decided_by,
    decided_at,
    rule_version_id,
    evidence_id,
    run_id,
    supersedes_id,
    supersede_reason,
    recorded_at
   FROM resolution.entity_resolution_decision d
  WHERE (NOT (EXISTS ( SELECT 1
           FROM resolution.entity_resolution_decision s
          WHERE (s.supersedes_id = d.id))));

CREATE TABLE resolution.instrument_resolution_decision (
    id bigint NOT NULL,
    position_observation_id bigint,
    position_observation_group_id bigint,
    instrument_id uuid,
    match_candidate_id bigint,
    state ref.resolution_state NOT NULL,
    method text NOT NULL,
    rationale text NOT NULL,
    actor_kind ref.actor_kind NOT NULL,
    decided_by text NOT NULL,
    decided_at timestamp with time zone NOT NULL,
    rule_version_id bigint NOT NULL,
    evidence_id bigint NOT NULL,
    run_id bigint NOT NULL,
    supersedes_id bigint,
    supersede_reason text,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT instrument_resolution_decision_check CHECK ((num_nonnulls(position_observation_id, position_observation_group_id) = 1)),
    CONSTRAINT instrument_resolution_decision_check1 CHECK (((state = 'UNRESOLVED'::ref.resolution_state) OR (instrument_id IS NOT NULL))),
    CONSTRAINT instrument_resolution_decision_decided_by_check CHECK ((btrim(decided_by) <> ''::text)),
    CONSTRAINT instrument_resolution_decision_method_check CHECK ((btrim(method) <> ''::text)),
    CONSTRAINT instrument_resolution_decision_not_self_superseding CHECK ((supersedes_id IS DISTINCT FROM id)),
    CONSTRAINT instrument_resolution_decision_rationale_check CHECK ((btrim(rationale) <> ''::text))
);

CREATE VIEW resolution.current_instrument_resolution AS
 SELECT id,
    position_observation_id,
    position_observation_group_id,
    instrument_id,
    match_candidate_id,
    state,
    method,
    rationale,
    actor_kind,
    decided_by,
    decided_at,
    rule_version_id,
    evidence_id,
    run_id,
    supersedes_id,
    supersede_reason,
    recorded_at
   FROM resolution.instrument_resolution_decision d
  WHERE (NOT (EXISTS ( SELECT 1
           FROM resolution.instrument_resolution_decision s
          WHERE (s.supersedes_id = d.id))));

CREATE TABLE validation.validation_result (
    id bigint NOT NULL,
    subject_table text NOT NULL,
    subject_id bigint NOT NULL,
    rule_version_id bigint NOT NULL,
    outcome ref.validation_outcome NOT NULL,
    detail text,
    evidence_id bigint,
    run_id bigint NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT validation_result_check CHECK (((outcome <> ALL (ARRAY['PASS'::ref.validation_outcome, 'FAIL'::ref.validation_outcome])) OR (evidence_id IS NOT NULL))),
    CONSTRAINT validation_result_subject_table_check CHECK ((subject_table ~ '^(registry|obs|resolution|derived)\.[a-z_]+$'::text))
);

CREATE VIEW registry.borrower_observation_listing AS
 SELECT d.legal_entity_id,
    a.alias_text,
    a.verification_state,
    (d.state)::text AS entity_resolution_state,
    d.method AS entity_resolution_method,
    p.reported_date,
    f.accession_number,
    fd.document_name,
    fd.document_url,
    fr.registrant_link_status,
        CASE
            WHEN (fr.cik IS NULL) THEN NULL::text
            ELSE lpad((fr.cik)::text, 10, '0'::text)
        END AS registrant_cik,
    nh.registrant_name,
    COALESCE((ir.state)::text, 'UNRESOLVED'::text) AS instrument_resolution_state,
    ir.method AS instrument_resolution_method,
        CASE
            WHEN ((fv.value_state = 'REPORTED'::ref.value_state) AND (COALESCE(fv.raw_value, ''::text) <> ''::text)) THEN 'REPORTED'::text
            ELSE 'UNKNOWN'::text
        END AS instrument_type_state,
    ev.event_code,
    (e.evidence_level)::text AS observation_evidence_level,
    (nv.outcome)::text AS name_validation_outcome
   FROM ((((((((((((resolution.current_entity_resolution d
     JOIN obs.borrower_name_observation b ON ((b.id = d.borrower_name_observation_id)))
     JOIN obs.position_observation p ON ((p.id = b.position_observation_id)))
     JOIN registry.filing f ON ((f.id = p.filing_id)))
     JOIN evidence.evidence e ON ((e.id = p.evidence_id)))
     JOIN LATERAL ( SELECT al.alias_text,
            al.verification_state
           FROM identity.legal_entity_alias al
          WHERE ((al.legal_entity_id = d.legal_entity_id) AND (al.verification_state = 'VERIFIED'::text) AND (NOT (EXISTS ( SELECT 1
                   FROM identity.legal_entity_alias s
                  WHERE (s.supersedes_id = al.id)))))
          ORDER BY al.id
         LIMIT 1) a ON (true))
     LEFT JOIN LATERAL ( SELECT doc.document_name,
            doc.document_url
           FROM registry.filing_document doc
          WHERE (doc.filing_id = f.id)
          ORDER BY
                CASE
                    WHEN (doc.named_by = 'SUBMISSIONS_PRIMARY_DOCUMENT'::text) THEN 0
                    ELSE 1
                END, doc.id
         LIMIT 1) fd ON (true))
     LEFT JOIN LATERAL ( SELECT cfr.registrant_id,
            cfr.cik,
            cfr.registrant_link_status
           FROM registry.current_filing_registrant cfr
          WHERE (cfr.filing_id = p.filing_id)
          ORDER BY
                CASE
                    WHEN (cfr.registrant_link_status = 'LINKED'::text) THEN 0
                    ELSE 1
                END, cfr.registrant_id
         LIMIT 1) fr ON (true))
     LEFT JOIN LATERAL ( SELECT string_agg(DISTINCT h.name_raw, ' · '::text ORDER BY h.name_raw) AS registrant_name
           FROM registry.current_registrant_name_history h
          WHERE (h.registrant_id = fr.registrant_id)) nh ON (true))
     LEFT JOIN LATERAL ( SELECT cir.state,
            cir.method
           FROM resolution.current_instrument_resolution cir
          WHERE (cir.position_observation_id = p.id)
         LIMIT 1) ir ON (true))
     LEFT JOIN LATERAL ( SELECT cfv.value_state,
            cfv.raw_value
           FROM obs.current_position_field_value cfv
          WHERE ((cfv.position_observation_id = p.id) AND (cfv.field_code = 'INSTRUMENT_TYPE'::text))
         LIMIT 1) fv ON (true))
     LEFT JOIN LATERAL ( SELECT oe.event_code
           FROM derived.observation_event oe
          WHERE ((oe.position_observation_id = p.id) AND (oe.event_code = 'REGISTRANT_FIRST_OBSERVED_NAME'::text))
          ORDER BY oe.id
         LIMIT 1) ev ON (true))
     LEFT JOIN LATERAL ( SELECT v.outcome
           FROM validation.validation_result v
          WHERE ((v.subject_table = 'obs.borrower_name_observation'::text) AND (v.subject_id = b.id))
          ORDER BY v.id
         LIMIT 1) nv ON (true))
  WHERE ((d.state = 'MATCHED'::ref.resolution_state) AND (d.legal_entity_id IS NOT NULL) AND (b.source_column_label = 'Investment, Identifier Axis'::text) AND (b.extraction_state = 'EXTRACTED'::text));

COMMENT ON VIEW registry.borrower_observation_listing IS 'Phase 10-min borrower observations. One row per MATCHED name observation. No cost, fair value, or invented instrument attributes. A missing date is absent, not zero.';

CREATE TABLE registry.filing_relationship_decision (
    id bigint NOT NULL,
    filing_id bigint NOT NULL,
    relationship_type text NOT NULL,
    related_filing_id bigint,
    state ref.resolution_state NOT NULL,
    method text NOT NULL,
    rationale text NOT NULL,
    actor_kind ref.actor_kind NOT NULL,
    decided_by text NOT NULL,
    decided_at timestamp with time zone NOT NULL,
    rule_version_id bigint NOT NULL,
    run_id bigint NOT NULL,
    supersedes_id bigint,
    supersede_reason text,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    evidence_id bigint NOT NULL,
    CONSTRAINT filing_relationship_decision_check CHECK (((state = 'UNRESOLVED'::ref.resolution_state) OR (related_filing_id IS NOT NULL))),
    CONSTRAINT filing_relationship_decision_check1 CHECK ((related_filing_id IS DISTINCT FROM filing_id)),
    CONSTRAINT filing_relationship_decision_decided_by_check CHECK ((btrim(decided_by) <> ''::text)),
    CONSTRAINT filing_relationship_decision_method_check CHECK ((btrim(method) <> ''::text)),
    CONSTRAINT filing_relationship_decision_not_self_superseding CHECK ((supersedes_id IS DISTINCT FROM id)),
    CONSTRAINT filing_relationship_decision_rationale_check CHECK ((btrim(rationale) <> ''::text)),
    CONSTRAINT filing_relationship_decision_relationship_type_check CHECK ((relationship_type = 'AMENDS'::text))
);

COMMENT ON TABLE registry.filing_relationship_decision IS 'Whether a filing amends another. Supersession detection is OPEN QUESTION Q17; UNRESOLVED is the expected default.';

CREATE VIEW registry.current_filing_relationship AS
 SELECT id,
    filing_id,
    relationship_type,
    related_filing_id,
    state,
    method,
    rationale,
    actor_kind,
    decided_by,
    decided_at,
    rule_version_id,
    run_id,
    supersedes_id,
    supersede_reason,
    recorded_at,
    evidence_id
   FROM registry.filing_relationship_decision d
  WHERE (NOT (EXISTS ( SELECT 1
           FROM registry.filing_relationship_decision s
          WHERE (s.supersedes_id = d.id))));

CREATE TABLE registry.dataset_release (
    id bigint NOT NULL,
    dataset_code text NOT NULL,
    release_label text NOT NULL,
    cadence text NOT NULL,
    window_start date NOT NULL,
    window_end date NOT NULL,
    run_id bigint NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    evidence_id bigint NOT NULL,
    CONSTRAINT dataset_release_cadence_check CHECK ((cadence = ANY (ARRAY['MONTHLY'::text, 'QUARTERLY'::text]))),
    CONSTRAINT dataset_release_check CHECK ((window_start <= window_end)),
    CONSTRAINT dataset_release_check1 CHECK (((cadence = 'QUARTERLY'::text) = (release_label ~ 'q[1-4]$'::text))),
    CONSTRAINT dataset_release_dataset_code_check CHECK ((dataset_code = 'SEC_BDC_DATA_SETS'::text)),
    CONSTRAINT dataset_release_release_label_check CHECK ((release_label ~ '^[0-9]{4}(q[1-4]|_[0-9]{2})$'::text))
);

COMMENT ON TABLE registry.dataset_release IS 'A data set file identity (for example 2026_08). The window is a filing-date window, not a reporting period.';

CREATE TABLE registry.dataset_release_artifact (
    id bigint NOT NULL,
    dataset_release_id bigint NOT NULL,
    artifact_id bigint NOT NULL,
    run_id bigint NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL
);

COMMENT ON TABLE registry.dataset_release_artifact IS 'Every artifact version that has served a release; refreshes add rows.';

ALTER TABLE registry.dataset_release_artifact ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME registry.dataset_release_artifact_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE registry.dataset_release ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME registry.dataset_release_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE registry.dataset_release_listing (
    id bigint NOT NULL,
    dataset_release_id bigint NOT NULL,
    page_artifact_id bigint NOT NULL,
    link_href text NOT NULL,
    link_text text NOT NULL,
    evidence_id bigint NOT NULL,
    rule_version_id bigint NOT NULL,
    run_id bigint NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT dataset_release_listing_link_href_check CHECK ((link_href ~ '^/files/.+_bdc\.zip$'::text))
);

COMMENT ON TABLE registry.dataset_release_listing IS 'Each Data Sets page retrieval that listed a release. A release absent from a later page retrieval stays recorded.';

ALTER TABLE registry.dataset_release_listing ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME registry.dataset_release_listing_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE VIEW registry.dataset_release_status AS
 SELECT dr.id AS dataset_release_id,
    dr.release_label,
    dr.cadence,
    dr.window_start,
    dr.window_end,
    ( SELECT count(*) AS count
           FROM registry.dataset_release_artifact x
          WHERE (x.dataset_release_id = dr.id)) AS artifact_count,
    ( SELECT count(*) AS count
           FROM registry.dataset_release_listing l
          WHERE (l.dataset_release_id = dr.id)) AS page_listing_count,
    COALESCE(cov.coverage_state, 'UNKNOWN'::ref.coverage_state) AS filing_metadata_coverage,
    COALESCE(cov.is_covered, false) AS is_covered
   FROM (registry.dataset_release dr
     LEFT JOIN ops.current_coverage cov ON (((cov.dataset_release_id = dr.id) AND (cov.registrant_id IS NULL) AND (cov.coverage_aspect = 'FILING_METADATA'::text) AND (cov.source_type_code = 'SEC_BDC_DATASET_ZIP'::text))));

ALTER TABLE registry.filing_attribute_observation ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME registry.filing_attribute_observation_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE registry.filing_document_artifact ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME registry.filing_document_artifact_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE registry.filing_document ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME registry.filing_document_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE VIEW registry.filing_file_number AS
 SELECT filing_id,
    accession_number,
    raw_value AS file_number_raw,
    (raw_value ~ '^814-'::text) AS is_814_file_number,
    source_stream,
    evidence_id
   FROM registry.current_filing_attribute c
  WHERE (attribute_code = 'FILE_NUMBER'::text);

CREATE VIEW registry.filing_history AS
 SELECT fr.filing_id,
    fr.accession_number,
    fr.registrant_id,
    fr.cik,
    fr.registrant_link_status,
    ( SELECT array_agg(DISTINCT c.normalized_text ORDER BY c.normalized_text) AS array_agg
           FROM registry.current_filing_attribute c
          WHERE ((c.filing_id = fr.filing_id) AND (c.attribute_code = 'FORM'::text) AND (c.normalized_text IS NOT NULL))) AS forms,
    ( SELECT array_agg(DISTINCT c.normalized_date ORDER BY c.normalized_date) AS array_agg
           FROM registry.current_filing_attribute c
          WHERE ((c.filing_id = fr.filing_id) AND (c.attribute_code = 'FILED_DATE'::text) AND (c.normalized_date IS NOT NULL))) AS filed_dates,
    ( SELECT array_agg(DISTINCT c.source_type_code ORDER BY c.source_type_code) AS array_agg
           FROM registry.current_filing_attribute c
          WHERE (c.filing_id = fr.filing_id)) AS source_types,
    rel.state AS amends_decision_state
   FROM (registry.current_filing_registrant fr
     LEFT JOIN registry.current_filing_relationship rel ON (((rel.filing_id = fr.filing_id) AND (rel.relationship_type = 'AMENDS'::text))));

COMMENT ON VIEW registry.filing_history IS 'Filings per registrant from explicit links; forms and filing dates as reported by each source (several values mean the sources disagree).';

ALTER TABLE registry.filing ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME registry.filing_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE registry.filing_registrant_link ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME registry.filing_registrant_link_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE registry.filing_relationship_decision ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME registry.filing_relationship_decision_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE VIEW registry.portfolio_filing_registrant AS
 SELECT filing_id,
        CASE
            WHEN (count(DISTINCT registrant_id) = 1) THEN min(registrant_id)
            ELSE NULL::bigint
        END AS registrant_id,
        CASE
            WHEN (count(DISTINCT cik) = 1) THEN lpad((min(cik))::text, 10, '0'::text)
            ELSE NULL::text
        END AS registrant_cik,
        CASE
            WHEN (count(DISTINCT cik) = 1) THEN 'LINKED'::text
            ELSE 'UNRESOLVED'::text
        END AS registrant_link_status
   FROM registry.current_filing_registrant
  WHERE (registrant_link_status = 'LINKED'::text)
  GROUP BY filing_id;

COMMENT ON VIEW registry.portfolio_filing_registrant IS 'Filing registrant for portfolio reads. LINKED only when every current linked row names one CIK.';

CREATE VIEW registry.market_registrant_coverage AS
 WITH positioned AS (
         SELECT DISTINCT fr.registrant_id
           FROM (obs.position_observation p_1
             JOIN registry.portfolio_filing_registrant fr ON (((fr.filing_id = p_1.filing_id) AND (fr.registrant_link_status = 'LINKED'::text))))
        ), covered AS (
         SELECT DISTINCT c_1.registrant_id
           FROM obs.current_soi_coverage c_1
          WHERE ((c_1.registrant_id IS NOT NULL) AND (c_1.coverage_state = 'COVERED'::ref.coverage_state))
        )
 SELECT r.id AS registrant_id,
    lpad((r.cik)::text, 10, '0'::text) AS registrant_cik,
    ns.attribute_state AS name_state,
        CASE
            WHEN (ns.attribute_state = 'REPORTED'::text) THEN nm.raw_value
            ELSE NULL::text
        END AS name_raw,
        CASE
            WHEN (p.registrant_id IS NOT NULL) THEN 'STORED_LINES'::text
            WHEN (c.registrant_id IS NOT NULL) THEN 'COVERED_NO_IDENTIFIED_LINE'::text
            ELSE 'UNKNOWN'::text
        END AS coverage_state
   FROM ((((registry.registrant r
     JOIN registry.registrant_attribute_status ns ON (((ns.registrant_id = r.id) AND (ns.attribute_code = 'NAME'::text))))
     LEFT JOIN positioned p ON ((p.registrant_id = r.id)))
     LEFT JOIN covered c ON ((c.registrant_id = r.id)))
     LEFT JOIN LATERAL ( SELECT min(a.raw_value) AS raw_value
           FROM registry.current_registrant_attribute a
          WHERE ((a.registrant_id = r.id) AND (a.attribute_code = 'NAME'::text))) nm ON ((ns.attribute_state = 'REPORTED'::text)));

COMMENT ON VIEW registry.market_registrant_coverage IS 'One registry registrant and its SOI coverage state. UNKNOWN has no assertion and no position. COVERED_NO_IDENTIFIED_LINE has a covered filing and no identified line. Neither state is zero exposure.';

CREATE VIEW registry.market_release_coverage AS
 WITH observed AS (
         SELECT dr_1.id AS dataset_release_id,
            (count(DISTINCT fr.registrant_cik))::integer AS registrants_observed,
            (count(DISTINCT p.reported_date))::integer AS reported_dates_observed
           FROM ((((((obs.position_observation p
             JOIN registry.portfolio_filing_registrant fr ON (((fr.filing_id = p.filing_id) AND (fr.registrant_link_status = 'LINKED'::text))))
             JOIN obs.soi_row_observation o_1 ON ((o_1.id = p.origin_soi_row_observation_id)))
             JOIN raw.tabular_row tr ON ((tr.id = o_1.tabular_row_id)))
             JOIN raw.table_load tl ON ((tl.id = tr.table_load_id)))
             JOIN registry.dataset_release_artifact dra ON ((dra.artifact_id = tl.artifact_id)))
             JOIN registry.dataset_release dr_1 ON ((dr_1.id = dra.dataset_release_id)))
          GROUP BY dr_1.id
        ), release_assertion AS (
         SELECT c.dataset_release_id,
                CASE
                    WHEN bool_or((c.coverage_state = 'EMPTY_PERIOD'::ref.coverage_state)) THEN 'EMPTY_PERIOD'::text
                    WHEN bool_or((c.coverage_state = 'COVERED'::ref.coverage_state)) THEN 'COVERED'::text
                    ELSE 'UNKNOWN'::text
                END AS assertion_state
           FROM obs.current_soi_coverage c
          WHERE ((c.registrant_id IS NULL) AND (c.dataset_release_id IS NOT NULL))
          GROUP BY c.dataset_release_id
        )
 SELECT dr.release_label,
        CASE
            WHEN (ra.assertion_state = 'EMPTY_PERIOD'::text) THEN 'UNAVAILABLE'::text
            WHEN (o.dataset_release_id IS NOT NULL) THEN 'OBSERVED'::text
            WHEN (ra.assertion_state = 'COVERED'::text) THEN 'COVERED_NO_IDENTIFIED_LINE'::text
            ELSE 'UNKNOWN'::text
        END AS coverage_state,
        CASE
            WHEN ((ra.assertion_state = 'EMPTY_PERIOD'::text) OR (o.dataset_release_id IS NULL)) THEN NULL::integer
            ELSE o.registrants_observed
        END AS registrants_observed,
        CASE
            WHEN ((ra.assertion_state = 'EMPTY_PERIOD'::text) OR (o.dataset_release_id IS NULL)) THEN NULL::integer
            ELSE o.reported_dates_observed
        END AS reported_dates_observed
   FROM ((registry.dataset_release dr
     LEFT JOIN observed o ON ((o.dataset_release_id = dr.id)))
     LEFT JOIN release_assertion ra ON ((ra.dataset_release_id = dr.id)));

COMMENT ON VIEW registry.market_release_coverage IS 'Registrants and reported dates observed in one release. An empty period is UNAVAILABLE and its counts are null. A release with no assertion and no positions is UNKNOWN. Counts are not a market size.';

CREATE VIEW registry.market_reported_date AS
 SELECT p.reported_date,
    (count(DISTINCT fr.registrant_cik))::integer AS registrants_observed
   FROM (obs.position_observation p
     JOIN registry.portfolio_filing_registrant fr ON (((fr.filing_id = p.filing_id) AND (fr.registrant_link_status = 'LINKED'::text))))
  WHERE (p.reported_date IS NOT NULL)
  GROUP BY p.reported_date;

COMMENT ON VIEW registry.market_reported_date IS 'Registrants observed on one reported date. A date that is absent was not observed. The count is co-presence, not a sum of lines or exposure.';

CREATE VIEW registry.matched_entity_position AS
 SELECT er.legal_entity_id,
    b.position_observation_id
   FROM ((resolution.current_entity_resolution er
     JOIN obs.current_borrower_name_observation b ON ((b.id = er.borrower_name_observation_id)))
     JOIN LATERAL ( SELECT (count(*))::integer AS name_count
           FROM obs.current_borrower_name_observation other_name
          WHERE ((other_name.position_observation_id = b.position_observation_id) AND (other_name.source_column_label = 'Investment, Identifier Axis'::text) AND (other_name.extraction_state = 'EXTRACTED'::text))) names ON ((names.name_count = 1)))
  WHERE ((er.state = 'MATCHED'::ref.resolution_state) AND (er.legal_entity_id IS NOT NULL) AND (b.source_column_label = 'Investment, Identifier Axis'::text) AND (b.extraction_state = 'EXTRACTED'::text));

COMMENT ON VIEW registry.matched_entity_position IS 'Position observations whose single current Investment Identifier name has a current MATCHED entity resolution. This is the same legal-entity predicate as registry.position_read. It does not resolve a name and it does not add a row.';

CREATE VIEW registry.maturity_read AS
 SELECT mp.position_observation_id,
    mp.maturity_date,
    mp.maturity_raw,
    (mp.provenance_state)::text AS maturity_source,
    (mp.inspection_state)::text AS inspection_state,
    (mp.no_bind_reason)::text AS no_bind_reason,
    mp.filing_verified,
    doc.document_url AS maturity_document_url,
    mp.maturity_precision,
    mp.maturity_year,
    mp.maturity_month
   FROM ((obs.maturity_provenance mp
     JOIN obs.position_observation p ON ((p.id = mp.position_observation_id)))
     LEFT JOIN LATERAL ( SELECT
                CASE
                    WHEN (count(DISTINCT fd.document_url) = 1) THEN min(fd.document_url)
                    ELSE NULL::text
                END AS document_url
           FROM ((evidence.evidence e
             JOIN registry.filing_document_artifact fda ON ((fda.artifact_id = e.artifact_id)))
             JOIN registry.filing_document fd ON (((fd.id = fda.filing_document_id) AND (fd.filing_id = p.filing_id))))
          WHERE ((e.id = mp.evidence_id) AND (((mp.provenance_state)::text = ANY (ARRAY['FILING_DISPLAYED'::text, 'FILING_MONTH'::text])) OR mp.filing_verified))) doc ON (true));

COMMENT ON VIEW registry.maturity_read IS 'The product maturity of one disclosed line. maturity_date is a calendar day and is NULL for a month. maturity_precision MONTH carries maturity_year and maturity_month without a day.';

COMMENT ON COLUMN registry.maturity_read.maturity_raw IS 'The maturity exactly as disclosed by the source named in maturity_source.';

COMMENT ON COLUMN registry.maturity_read.maturity_source IS 'obs.maturity_provenance.provenance_state: REPORTED_STRUCTURED, FILING_DISPLAYED, UNKNOWN, or UNRESOLVED.';

COMMENT ON COLUMN registry.maturity_read.maturity_document_url IS 'The EDGAR document of the current filing inspection, when that inspection supplies or confirms the maturity.';

COMMENT ON COLUMN registry.maturity_read.maturity_precision IS 'MONTH for a month-precision product maturity. NULL when maturity_date is a calendar day or no maturity was selected.';

COMMENT ON COLUMN registry.maturity_read.maturity_year IS 'Disclosed year for maturity_precision MONTH. Not the year extracted from maturity_date.';

COMMENT ON COLUMN registry.maturity_read.maturity_month IS 'Disclosed month 1 through 12 for maturity_precision MONTH. NULL otherwise.';

CREATE VIEW registry.maturity_position AS
 SELECT p.id AS position_observation_id,
    fr.registrant_cik,
    p.reported_date,
    mr.maturity_date,
    mr.maturity_raw,
    mr.maturity_source,
    mr.inspection_state,
    mr.no_bind_reason,
    mr.filing_verified,
    mr.maturity_document_url
   FROM ((obs.position_observation p
     JOIN registry.portfolio_filing_registrant fr ON (((fr.filing_id = p.filing_id) AND (fr.registrant_link_status = 'LINKED'::text))))
     JOIN registry.maturity_read mr ON ((mr.position_observation_id = p.id)));

COMMENT ON VIEW registry.maturity_position IS 'One disclosed line of a linked registrant and its product maturity from registry.maturity_read. A line with no maturity_date is not a year and not zero.';

CREATE VIEW registry.portfolio_line AS
 SELECT p.id AS position_observation_id,
    fr.registrant_cik,
    p.reported_date,
    (p.duration_kind)::text AS duration_kind,
    o.qtrs,
    COALESCE((cl.period_role)::text, 'UNKNOWN'::text) AS period_role,
    p.holding_descriptor_raw AS disclosed_line_text,
    f.accession_number,
    (e.evidence_level)::text AS evidence_level,
    attrs.principal_state,
    attrs.principal_raw,
    'UNKNOWN'::text AS principal_currency_state,
    mr.maturity_source,
    mr.maturity_raw,
    mr.maturity_date,
    mr.inspection_state AS maturity_inspection_state,
    mr.no_bind_reason AS maturity_no_bind_reason,
    mr.filing_verified AS maturity_filing_verified,
    mr.maturity_document_url,
    attrs.instrument_type_state,
    attrs.instrument_type_raw,
    attrs.industry_state,
    attrs.industry_raw,
    attrs.affiliation_state,
    attrs.affiliation_raw,
    attrs.geography_state,
    attrs.geography_raw,
    attrs.acquisition_date_state,
    attrs.acquisition_date_raw,
    attrs.restricted_state,
    attrs.restricted_raw,
    attrs.reference_uri_state,
    attrs.reference_uri_raw,
    form.form_state,
    form.form_raw,
    filed.filed_date_state,
    filed.filed_date_raw,
    inline_url.inline_url_state,
    inline_url.inline_url,
    doc.document_name,
    doc.document_url,
    rel.release_state,
    rel.release_label
   FROM ((((((((((((obs.position_observation p
     JOIN obs.soi_row_observation o ON ((o.id = p.origin_soi_row_observation_id)))
     JOIN registry.filing f ON ((f.id = p.filing_id)))
     JOIN evidence.evidence e ON ((e.id = p.evidence_id)))
     JOIN registry.portfolio_filing_registrant fr ON (((fr.filing_id = p.filing_id) AND (fr.registrant_link_status = 'LINKED'::text))))
     JOIN registry.maturity_read mr ON ((mr.position_observation_id = p.id)))
     LEFT JOIN obs.current_soi_row_classification cl ON ((cl.soi_row_observation_id = o.id)))
     LEFT JOIN LATERAL ( SELECT
                CASE
                    WHEN (count(DISTINCT fv.raw_value) FILTER (WHERE (fv.field_code = 'PRINCIPAL_AMOUNT'::text)) = 1) THEN 'REPORTED'::text
                    WHEN (count(*) FILTER (WHERE (fv.field_code = 'PRINCIPAL_AMOUNT'::text)) = 0) THEN 'UNKNOWN'::text
                    ELSE 'MULTIPLE_VALUES'::text
                END AS principal_state,
                CASE
                    WHEN (count(DISTINCT fv.raw_value) FILTER (WHERE (fv.field_code = 'PRINCIPAL_AMOUNT'::text)) = 1) THEN min(fv.raw_value) FILTER (WHERE (fv.field_code = 'PRINCIPAL_AMOUNT'::text))
                    ELSE NULL::text
                END AS principal_raw,
                CASE
                    WHEN (count(DISTINCT fv.raw_value) FILTER (WHERE (fv.field_code = 'INSTRUMENT_TYPE'::text)) = 1) THEN 'REPORTED'::text
                    WHEN (count(*) FILTER (WHERE (fv.field_code = 'INSTRUMENT_TYPE'::text)) = 0) THEN 'UNKNOWN'::text
                    ELSE 'MULTIPLE_VALUES'::text
                END AS instrument_type_state,
                CASE
                    WHEN (count(DISTINCT fv.raw_value) FILTER (WHERE (fv.field_code = 'INSTRUMENT_TYPE'::text)) = 1) THEN min(fv.raw_value) FILTER (WHERE (fv.field_code = 'INSTRUMENT_TYPE'::text))
                    ELSE NULL::text
                END AS instrument_type_raw,
                CASE
                    WHEN (count(DISTINCT fv.raw_value) FILTER (WHERE (fv.field_code = 'INDUSTRY'::text)) = 1) THEN 'REPORTED'::text
                    WHEN (count(*) FILTER (WHERE (fv.field_code = 'INDUSTRY'::text)) = 0) THEN 'UNKNOWN'::text
                    ELSE 'MULTIPLE_VALUES'::text
                END AS industry_state,
                CASE
                    WHEN (count(DISTINCT fv.raw_value) FILTER (WHERE (fv.field_code = 'INDUSTRY'::text)) = 1) THEN min(fv.raw_value) FILTER (WHERE (fv.field_code = 'INDUSTRY'::text))
                    ELSE NULL::text
                END AS industry_raw,
                CASE
                    WHEN (count(DISTINCT fv.raw_value) FILTER (WHERE (fv.field_code = 'ISSUER_AFFILIATION'::text)) = 1) THEN 'REPORTED'::text
                    WHEN (count(*) FILTER (WHERE (fv.field_code = 'ISSUER_AFFILIATION'::text)) = 0) THEN 'UNKNOWN'::text
                    ELSE 'MULTIPLE_VALUES'::text
                END AS affiliation_state,
                CASE
                    WHEN (count(DISTINCT fv.raw_value) FILTER (WHERE (fv.field_code = 'ISSUER_AFFILIATION'::text)) = 1) THEN min(fv.raw_value) FILTER (WHERE (fv.field_code = 'ISSUER_AFFILIATION'::text))
                    ELSE NULL::text
                END AS affiliation_raw,
                CASE
                    WHEN (count(DISTINCT fv.raw_value) FILTER (WHERE (fv.field_code = 'GEOGRAPHY'::text)) = 1) THEN 'REPORTED'::text
                    WHEN (count(*) FILTER (WHERE (fv.field_code = 'GEOGRAPHY'::text)) = 0) THEN 'UNKNOWN'::text
                    ELSE 'MULTIPLE_VALUES'::text
                END AS geography_state,
                CASE
                    WHEN (count(DISTINCT fv.raw_value) FILTER (WHERE (fv.field_code = 'GEOGRAPHY'::text)) = 1) THEN min(fv.raw_value) FILTER (WHERE (fv.field_code = 'GEOGRAPHY'::text))
                    ELSE NULL::text
                END AS geography_raw,
                CASE
                    WHEN (count(DISTINCT fv.raw_value) FILTER (WHERE (fv.field_code = 'ACQUISITION_DATE'::text)) = 1) THEN 'REPORTED'::text
                    WHEN (count(*) FILTER (WHERE (fv.field_code = 'ACQUISITION_DATE'::text)) = 0) THEN 'UNKNOWN'::text
                    ELSE 'MULTIPLE_VALUES'::text
                END AS acquisition_date_state,
                CASE
                    WHEN (count(DISTINCT fv.raw_value) FILTER (WHERE (fv.field_code = 'ACQUISITION_DATE'::text)) = 1) THEN min(fv.raw_value) FILTER (WHERE (fv.field_code = 'ACQUISITION_DATE'::text))
                    ELSE NULL::text
                END AS acquisition_date_raw,
                CASE
                    WHEN (count(DISTINCT fv.raw_value) FILTER (WHERE (fv.field_code = 'RESTRICTED'::text)) = 1) THEN 'REPORTED'::text
                    WHEN (count(*) FILTER (WHERE (fv.field_code = 'RESTRICTED'::text)) = 0) THEN 'UNKNOWN'::text
                    ELSE 'MULTIPLE_VALUES'::text
                END AS restricted_state,
                CASE
                    WHEN (count(DISTINCT fv.raw_value) FILTER (WHERE (fv.field_code = 'RESTRICTED'::text)) = 1) THEN min(fv.raw_value) FILTER (WHERE (fv.field_code = 'RESTRICTED'::text))
                    ELSE NULL::text
                END AS restricted_raw,
                CASE
                    WHEN (count(DISTINCT fv.raw_value) FILTER (WHERE (fv.field_code = 'REFERENCE_RATE'::text)) = 1) THEN 'REPORTED'::text
                    WHEN (count(*) FILTER (WHERE (fv.field_code = 'REFERENCE_RATE'::text)) = 0) THEN 'UNKNOWN'::text
                    ELSE 'MULTIPLE_VALUES'::text
                END AS reference_uri_state,
                CASE
                    WHEN (count(DISTINCT fv.raw_value) FILTER (WHERE (fv.field_code = 'REFERENCE_RATE'::text)) = 1) THEN min(fv.raw_value) FILTER (WHERE (fv.field_code = 'REFERENCE_RATE'::text))
                    ELSE NULL::text
                END AS reference_uri_raw
           FROM obs.current_position_field_value fv
          WHERE ((fv.position_observation_id = p.id) AND (fv.field_code = ANY (ARRAY['PRINCIPAL_AMOUNT'::text, 'INSTRUMENT_TYPE'::text, 'INDUSTRY'::text, 'ISSUER_AFFILIATION'::text, 'GEOGRAPHY'::text, 'ACQUISITION_DATE'::text, 'RESTRICTED'::text, 'REFERENCE_RATE'::text])))) attrs ON (true))
     LEFT JOIN LATERAL ( SELECT
                CASE
                    WHEN (count(DISTINCT fa.normalized_text) = 1) THEN 'REPORTED'::text
                    WHEN (count(*) = 0) THEN 'UNKNOWN'::text
                    ELSE 'MULTIPLE_VALUES'::text
                END AS form_state,
                CASE
                    WHEN (count(DISTINCT fa.normalized_text) = 1) THEN min(fa.normalized_text)
                    ELSE NULL::text
                END AS form_raw
           FROM registry.current_filing_attribute fa
          WHERE ((fa.filing_id = p.filing_id) AND (fa.attribute_code = 'FORM'::text) AND (fa.value_state = 'REPORTED'::ref.value_state))) form ON (true))
     LEFT JOIN LATERAL ( SELECT
                CASE
                    WHEN (count(DISTINCT fa.normalized_date) = 1) THEN 'REPORTED'::text
                    WHEN (count(*) = 0) THEN 'UNKNOWN'::text
                    ELSE 'MULTIPLE_VALUES'::text
                END AS filed_date_state,
                CASE
                    WHEN (count(DISTINCT fa.normalized_date) = 1) THEN (min(fa.normalized_date))::text
                    ELSE NULL::text
                END AS filed_date_raw
           FROM registry.current_filing_attribute fa
          WHERE ((fa.filing_id = p.filing_id) AND (fa.attribute_code = 'FILED_DATE'::text) AND (fa.value_state = 'REPORTED'::ref.value_state))) filed ON (true))
     LEFT JOIN LATERAL ( SELECT
                CASE
                    WHEN ((count(DISTINCT fa.raw_value) = 1) AND (min(fa.raw_value) ~ '^https://www\.sec\.gov/(Archives/edgar/data/|ix\?doc=/Archives/edgar/data/)'::text)) THEN 'REPORTED'::text
                    WHEN (count(*) = 0) THEN 'UNKNOWN'::text
                    ELSE 'MULTIPLE_VALUES'::text
                END AS inline_url_state,
                CASE
                    WHEN ((count(DISTINCT fa.raw_value) = 1) AND (min(fa.raw_value) ~ '^https://www\.sec\.gov/(Archives/edgar/data/|ix\?doc=/Archives/edgar/data/)'::text)) THEN min(fa.raw_value)
                    ELSE NULL::text
                END AS inline_url
           FROM registry.current_filing_attribute fa
          WHERE ((fa.filing_id = p.filing_id) AND (fa.attribute_code = 'INLINE_URL'::text) AND (fa.value_state = 'REPORTED'::ref.value_state))) inline_url ON (true))
     LEFT JOIN LATERAL ( SELECT doc_1.document_name,
            doc_1.document_url
           FROM registry.filing_document doc_1
          WHERE ((doc_1.filing_id = p.filing_id) AND (doc_1.document_url ~ '^https://www\.sec\.gov/Archives/edgar/data/'::text))
          ORDER BY
                CASE
                    WHEN (doc_1.named_by = 'SUBMISSIONS_PRIMARY_DOCUMENT'::text) THEN 0
                    ELSE 1
                END, doc_1.id
         LIMIT 1) doc ON (true))
     LEFT JOIN LATERAL ( SELECT
                CASE
                    WHEN (count(DISTINCT dr.release_label) = 1) THEN 'REPORTED'::text
                    WHEN (count(*) = 0) THEN 'UNKNOWN'::text
                    ELSE 'MULTIPLE_VALUES'::text
                END AS release_state,
                CASE
                    WHEN (count(DISTINCT dr.release_label) = 1) THEN min(dr.release_label)
                    ELSE NULL::text
                END AS release_label
           FROM (((raw.tabular_row tr
             JOIN raw.table_load tl ON ((tl.id = tr.table_load_id)))
             JOIN registry.dataset_release_artifact dra ON ((dra.artifact_id = tl.artifact_id)))
             JOIN registry.dataset_release dr ON ((dr.id = dra.dataset_release_id)))
          WHERE (tr.id = o.tabular_row_id)) rel ON (true));

COMMENT ON VIEW registry.portfolio_line IS 'One disclosed SOI position line. Maturity is the product maturity from registry.maturity_read. Principal currency is UNKNOWN. Cost, fair value, rates, and spreads are omitted. period_role stays the stored classification.';

CREATE VIEW registry.maturity_line AS
 SELECT mp.position_observation_id,
    mp.registrant_cik,
    mp.reported_date,
    pl.disclosed_line_text,
    pl.principal_state,
    pl.principal_raw,
    pl.principal_currency_state,
    mp.maturity_source,
    mp.maturity_raw,
    mp.maturity_date,
    (EXTRACT(year FROM mp.maturity_date))::integer AS maturity_year,
    mp.filing_verified,
    mp.maturity_document_url,
    pl.accession_number,
    pl.evidence_level,
    pl.form_state,
    pl.form_raw,
    pl.filed_date_state,
    pl.filed_date_raw,
    pl.inline_url_state,
    pl.inline_url,
    pl.document_name,
    pl.document_url,
    pl.release_state,
    pl.release_label
   FROM (registry.maturity_position mp
     JOIN registry.portfolio_line pl ON ((pl.position_observation_id = mp.position_observation_id)));

COMMENT ON VIEW registry.maturity_line IS 'One disclosed line for the maturity wall: product maturity and its source, principal, and SEC filing attributes. Principal currency stays UNKNOWN.';

CREATE VIEW registry.maturity_reported_date AS
 SELECT registrant_cik,
    reported_date,
    (count(*))::integer AS disclosed_line_count,
    (count(*) FILTER (WHERE (maturity_date IS NOT NULL)))::integer AS maturity_reported_count,
    (count(*) FILTER (WHERE (maturity_source = 'REPORTED_STRUCTURED'::text)))::integer AS maturity_structured_count,
    (count(*) FILTER (WHERE (maturity_source = 'FILING_DISPLAYED'::text)))::integer AS maturity_filing_count,
    (count(*) FILTER (WHERE (maturity_source = 'UNKNOWN'::text)))::integer AS maturity_unknown_count,
    (count(*) FILTER (WHERE (maturity_source = 'UNRESOLVED'::text)))::integer AS maturity_unresolved_count
   FROM registry.maturity_position
  GROUP BY registrant_cik, reported_date;

COMMENT ON VIEW registry.maturity_reported_date IS 'Disclosed-line counts by registrant and reported date. maturity_reported_count is structured plus filing-displayed lines. Unknown and unresolved maturity are row counts, not zero maturity.';

CREATE VIEW registry.maturity_year AS
 SELECT registrant_cik,
    reported_date,
    (EXTRACT(year FROM maturity_date))::integer AS maturity_year,
    (count(*))::integer AS disclosed_line_count
   FROM registry.maturity_position
  WHERE (maturity_date IS NOT NULL)
  GROUP BY registrant_cik, reported_date, (EXTRACT(year FROM maturity_date));

COMMENT ON VIEW registry.maturity_year IS 'Disclosed lines with one product maturity calendar date, counted by the year of that date. A month-precision maturity has a null maturity_date and is omitted here. Unknown and unresolved maturity are omitted here and kept on maturity_reported_date.';

CREATE VIEW registry.portfolio_empty_period AS
 SELECT dr.release_label
   FROM (obs.current_soi_coverage c
     JOIN registry.dataset_release dr ON ((dr.id = c.dataset_release_id)))
  WHERE ((c.registrant_id IS NULL) AND (c.source_type_code = 'SEC_BDC_DATASET_ZIP'::text) AND (c.coverage_state = 'EMPTY_PERIOD'::ref.coverage_state));

COMMENT ON VIEW registry.portfolio_empty_period IS 'Dataset releases with no SOI rows. Empty means unavailable, not a zero portfolio.';

CREATE VIEW registry.portfolio_registrant AS
 SELECT fr.registrant_id,
    fr.registrant_cik,
    ns.attribute_state AS name_state,
        CASE
            WHEN (ns.attribute_state = 'REPORTED'::text) THEN nm.raw_value
            ELSE NULL::text
        END AS name_raw,
    ts.attribute_state AS ticker_state,
        CASE
            WHEN (ts.attribute_state = 'REPORTED'::text) THEN tm.raw_value
            ELSE NULL::text
        END AS ticker_raw,
    fs.attribute_state AS file_number_state,
        CASE
            WHEN (fs.attribute_state = 'REPORTED'::text) THEN fm.raw_value
            ELSE NULL::text
        END AS file_number_raw,
    (count(DISTINCT p.reported_date))::integer AS reported_date_count
   FROM (((((((obs.position_observation p
     JOIN registry.portfolio_filing_registrant fr ON (((fr.filing_id = p.filing_id) AND (fr.registrant_link_status = 'LINKED'::text))))
     JOIN registry.registrant_attribute_status ns ON (((ns.registrant_id = fr.registrant_id) AND (ns.attribute_code = 'NAME'::text))))
     JOIN registry.registrant_attribute_status ts ON (((ts.registrant_id = fr.registrant_id) AND (ts.attribute_code = 'TICKER'::text))))
     JOIN registry.registrant_attribute_status fs ON (((fs.registrant_id = fr.registrant_id) AND (fs.attribute_code = 'FILE_NUMBER'::text))))
     LEFT JOIN LATERAL ( SELECT min(a.raw_value) AS raw_value
           FROM registry.current_registrant_attribute a
          WHERE ((a.registrant_id = fr.registrant_id) AND (a.attribute_code = 'NAME'::text))) nm ON ((ns.attribute_state = 'REPORTED'::text)))
     LEFT JOIN LATERAL ( SELECT min(a.raw_value) AS raw_value
           FROM registry.current_registrant_attribute a
          WHERE ((a.registrant_id = fr.registrant_id) AND (a.attribute_code = 'TICKER'::text))) tm ON ((ts.attribute_state = 'REPORTED'::text)))
     LEFT JOIN LATERAL ( SELECT min(a.raw_value) AS raw_value
           FROM registry.current_registrant_attribute a
          WHERE ((a.registrant_id = fr.registrant_id) AND (a.attribute_code = 'FILE_NUMBER'::text))) fm ON ((fs.attribute_state = 'REPORTED'::text)))
  GROUP BY fr.registrant_id, fr.registrant_cik, ns.attribute_state, nm.raw_value, ts.attribute_state, tm.raw_value, fs.attribute_state, fm.raw_value;

COMMENT ON VIEW registry.portfolio_registrant IS 'Registrants that have position observations. reported_date_count is a count of disclosed dates, not holdings or exposure. A name is present only when current sources agree.';

CREATE VIEW registry.portfolio_registrant_name AS
 SELECT r.registrant_cik,
    a.source_type_code,
    a.raw_value,
    (a.documentation_status)::text AS documentation_status
   FROM (registry.portfolio_registrant r
     JOIN registry.current_registrant_attribute a ON (((a.registrant_id = r.registrant_id) AND (a.attribute_code = 'NAME'::text))));

COMMENT ON VIEW registry.portfolio_registrant_name IS 'Each current registrant-name source, unmerged. Disagreeing values stay on separate rows.';

CREATE VIEW registry.portfolio_reported_date AS
 SELECT fr.registrant_cik,
    p.reported_date,
    (count(*))::integer AS disclosed_line_count,
    (count(*) FILTER (WHERE (p.duration_kind = 'POINT_IN_TIME'::ref.duration_kind)))::integer AS point_in_time_line_count,
    (count(*) FILTER (WHERE (p.duration_kind = 'DURATION'::ref.duration_kind)))::integer AS duration_line_count
   FROM (obs.position_observation p
     JOIN registry.portfolio_filing_registrant fr ON (((fr.filing_id = p.filing_id) AND (fr.registrant_link_status = 'LINKED'::text))))
  WHERE (p.reported_date IS NOT NULL)
  GROUP BY fr.registrant_cik, p.reported_date;

COMMENT ON VIEW registry.portfolio_reported_date IS 'Disclosed-line counts by registrant and reported date. A date that is absent was not observed. Counts are rows, not amounts.';

CREATE TABLE resolution.group_membership_decision (
    id bigint NOT NULL,
    legal_entity_id uuid NOT NULL,
    economic_group_id uuid NOT NULL,
    effective_from date,
    effective_to date,
    match_candidate_id bigint,
    state ref.resolution_state NOT NULL,
    method text NOT NULL,
    rationale text NOT NULL,
    actor_kind ref.actor_kind NOT NULL,
    decided_by text NOT NULL,
    decided_at timestamp with time zone NOT NULL,
    rule_version_id bigint NOT NULL,
    evidence_id bigint NOT NULL,
    run_id bigint NOT NULL,
    supersedes_id bigint,
    supersede_reason text,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT group_membership_decision_check CHECK (((effective_from IS NULL) OR (effective_to IS NULL) OR (effective_from <= effective_to))),
    CONSTRAINT group_membership_decision_decided_by_check CHECK ((btrim(decided_by) <> ''::text)),
    CONSTRAINT group_membership_decision_method_check CHECK ((btrim(method) <> ''::text)),
    CONSTRAINT group_membership_decision_not_self_superseding CHECK ((supersedes_id IS DISTINCT FROM id)),
    CONSTRAINT group_membership_decision_rationale_check CHECK ((btrim(rationale) <> ''::text))
);

CREATE VIEW resolution.current_group_membership AS
 SELECT id,
    legal_entity_id,
    economic_group_id,
    effective_from,
    effective_to,
    match_candidate_id,
    state,
    method,
    rationale,
    actor_kind,
    decided_by,
    decided_at,
    rule_version_id,
    evidence_id,
    run_id,
    supersedes_id,
    supersede_reason,
    recorded_at
   FROM resolution.group_membership_decision d
  WHERE (NOT (EXISTS ( SELECT 1
           FROM resolution.group_membership_decision s
          WHERE (s.supersedes_id = d.id))));

CREATE TABLE resolution.position_continuity_decision (
    id bigint NOT NULL,
    position_observation_id bigint NOT NULL,
    position_id uuid,
    match_candidate_id bigint,
    state ref.resolution_state NOT NULL,
    method text NOT NULL,
    rationale text NOT NULL,
    actor_kind ref.actor_kind NOT NULL,
    decided_by text NOT NULL,
    decided_at timestamp with time zone NOT NULL,
    rule_version_id bigint NOT NULL,
    evidence_id bigint NOT NULL,
    run_id bigint NOT NULL,
    supersedes_id bigint,
    supersede_reason text,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT position_continuity_decision_check CHECK (((state = 'UNRESOLVED'::ref.resolution_state) OR (position_id IS NOT NULL))),
    CONSTRAINT position_continuity_decision_decided_by_check CHECK ((btrim(decided_by) <> ''::text)),
    CONSTRAINT position_continuity_decision_method_check CHECK ((btrim(method) <> ''::text)),
    CONSTRAINT position_continuity_decision_not_self_superseding CHECK ((supersedes_id IS DISTINCT FROM id)),
    CONSTRAINT position_continuity_decision_rationale_check CHECK ((btrim(rationale) <> ''::text))
);

CREATE VIEW resolution.current_position_continuity AS
 SELECT id,
    position_observation_id,
    position_id,
    match_candidate_id,
    state,
    method,
    rationale,
    actor_kind,
    decided_by,
    decided_at,
    rule_version_id,
    evidence_id,
    run_id,
    supersedes_id,
    supersede_reason,
    recorded_at
   FROM resolution.position_continuity_decision d
  WHERE (NOT (EXISTS ( SELECT 1
           FROM resolution.position_continuity_decision s
          WHERE (s.supersedes_id = d.id))));

CREATE VIEW registry.position_read AS
 SELECT p.id AS position_observation_id,
    p.reported_date,
    p.filing_id,
    f.accession_number,
    reg.registrant_id,
    reg.registrant_cik,
    reg.registrant_link_status,
    reg.registrant_evidence_id,
        CASE
            WHEN (names.name_count = 1) THEN names.borrower_name_observation_id
            ELSE NULL::bigint
        END AS borrower_name_observation_id,
        CASE
            WHEN (names.name_count = 1) THEN names.borrower_name_raw
            ELSE NULL::text
        END AS borrower_name_raw,
        CASE
            WHEN (names.name_count = 1) THEN names.borrower_name_evidence_id
            ELSE NULL::bigint
        END AS borrower_name_evidence_id,
        CASE
            WHEN (names.name_count = 1) THEN er.legal_entity_id
            ELSE NULL::uuid
        END AS legal_entity_id,
        CASE
            WHEN (names.name_count IS DISTINCT FROM 1) THEN 'UNRESOLVED'::text
            WHEN (er.id IS NULL) THEN 'UNRESOLVED'::text
            ELSE (er.state)::text
        END AS entity_resolution_state,
        CASE
            WHEN (names.name_count = 1) THEN er.method
            ELSE NULL::text
        END AS entity_resolution_method,
        CASE
            WHEN (names.name_count = 1) THEN er.evidence_id
            ELSE NULL::bigint
        END AS entity_resolution_evidence_id,
        CASE
            WHEN (grp.n = 1) THEN grp.economic_group_id
            ELSE NULL::uuid
        END AS economic_group_id,
        CASE
            WHEN (grp.n = 1) THEN grp.state
            ELSE 'UNRESOLVED'::text
        END AS economic_group_state,
        CASE
            WHEN (grp.n = 1) THEN grp.evidence_id
            ELSE NULL::bigint
        END AS economic_group_evidence_id,
        CASE
            WHEN (inst.n = 1) THEN inst.instrument_id
            ELSE NULL::uuid
        END AS instrument_id,
        CASE
            WHEN (inst.n = 1) THEN inst.state
            ELSE 'UNRESOLVED'::text
        END AS instrument_resolution_state,
        CASE
            WHEN (inst.n = 1) THEN inst.method
            ELSE NULL::text
        END AS instrument_resolution_method,
        CASE
            WHEN (inst.n = 1) THEN inst.evidence_id
            ELSE NULL::bigint
        END AS instrument_resolution_evidence_id,
        CASE
            WHEN (cont.n = 1) THEN cont.position_id
            ELSE NULL::uuid
        END AS position_id,
        CASE
            WHEN (cont.n = 1) THEN cont.state
            ELSE 'UNRESOLVED'::text
        END AS continuity_state,
        CASE
            WHEN (cont.n = 1) THEN cont.method
            ELSE NULL::text
        END AS continuity_method,
        CASE
            WHEN (cont.n = 1) THEN cont.evidence_id
            ELSE NULL::bigint
        END AS continuity_evidence_id,
    first_observed.event_code AS first_observed_event_code,
    p.origin_soi_row_observation_id,
    p.holding_descriptor_raw,
    p.evidence_id AS observation_evidence_id,
    (oe.evidence_level)::text AS observation_evidence_level,
        CASE
            WHEN (principal.n IS NULL) THEN 'UNKNOWN'::text
            WHEN ((principal.n = 1) AND (principal.reported_n = 1) AND (principal.distinct_raw = 1)) THEN 'REPORTED'::text
            WHEN ((principal.n = 1) AND (principal.only_state = 'UNKNOWN'::text)) THEN 'UNKNOWN'::text
            WHEN ((principal.n = 1) AND (principal.only_state = 'NOT_APPLICABLE'::text)) THEN 'NOT_APPLICABLE'::text
            ELSE 'MULTIPLE_VALUES'::text
        END AS principal_state,
        CASE
            WHEN ((principal.n = 1) AND (principal.reported_n = 1) AND (principal.distinct_raw = 1)) THEN principal.raw_value
            ELSE NULL::text
        END AS principal_raw,
        CASE
            WHEN ((principal.n = 1) AND (principal.reported_n = 1) AND (principal.distinct_raw = 1)) THEN principal.normalized_numeric
            ELSE NULL::numeric
        END AS principal_numeric,
        CASE
            WHEN (principal.n = 1) THEN principal.evidence_id
            ELSE NULL::bigint
        END AS principal_evidence_id,
        CASE
            WHEN ((principal.n = 1) AND (principal.reported_n = 1) AND (principal.distinct_raw = 1)) THEN principal.currency_state
            ELSE NULL::text
        END AS principal_currency_state,
        CASE
            WHEN ((principal.n = 1) AND (principal.reported_n = 1) AND (principal.distinct_raw = 1)) THEN principal.scale_state
            ELSE NULL::text
        END AS principal_scale_state,
        CASE
            WHEN (cost.n IS NULL) THEN 'UNKNOWN'::text
            WHEN ((cost.n = 1) AND (cost.reported_n = 1) AND (cost.distinct_raw = 1)) THEN 'REPORTED'::text
            WHEN ((cost.n = 1) AND (cost.only_state = 'UNKNOWN'::text)) THEN 'UNKNOWN'::text
            WHEN ((cost.n = 1) AND (cost.only_state = 'NOT_APPLICABLE'::text)) THEN 'NOT_APPLICABLE'::text
            ELSE 'MULTIPLE_VALUES'::text
        END AS cost_state,
        CASE
            WHEN ((cost.n = 1) AND (cost.reported_n = 1) AND (cost.distinct_raw = 1)) THEN cost.raw_value
            ELSE NULL::text
        END AS cost_raw,
        CASE
            WHEN ((cost.n = 1) AND (cost.reported_n = 1) AND (cost.distinct_raw = 1)) THEN cost.normalized_numeric
            ELSE NULL::numeric
        END AS cost_numeric,
        CASE
            WHEN (cost.n = 1) THEN cost.evidence_id
            ELSE NULL::bigint
        END AS cost_evidence_id,
        CASE
            WHEN ((cost.n = 1) AND (cost.reported_n = 1) AND (cost.distinct_raw = 1)) THEN cost.currency_state
            ELSE NULL::text
        END AS cost_currency_state,
        CASE
            WHEN ((cost.n = 1) AND (cost.reported_n = 1) AND (cost.distinct_raw = 1)) THEN cost.scale_state
            ELSE NULL::text
        END AS cost_scale_state,
        CASE
            WHEN (fair_value.n IS NULL) THEN 'UNKNOWN'::text
            WHEN ((fair_value.n = 1) AND (fair_value.reported_n = 1) AND (fair_value.distinct_raw = 1)) THEN 'REPORTED'::text
            WHEN ((fair_value.n = 1) AND (fair_value.only_state = 'UNKNOWN'::text)) THEN 'UNKNOWN'::text
            WHEN ((fair_value.n = 1) AND (fair_value.only_state = 'NOT_APPLICABLE'::text)) THEN 'NOT_APPLICABLE'::text
            ELSE 'MULTIPLE_VALUES'::text
        END AS fair_value_state,
        CASE
            WHEN ((fair_value.n = 1) AND (fair_value.reported_n = 1) AND (fair_value.distinct_raw = 1)) THEN fair_value.raw_value
            ELSE NULL::text
        END AS fair_value_raw,
        CASE
            WHEN ((fair_value.n = 1) AND (fair_value.reported_n = 1) AND (fair_value.distinct_raw = 1)) THEN fair_value.normalized_numeric
            ELSE NULL::numeric
        END AS fair_value_numeric,
        CASE
            WHEN (fair_value.n = 1) THEN fair_value.evidence_id
            ELSE NULL::bigint
        END AS fair_value_evidence_id,
        CASE
            WHEN ((fair_value.n = 1) AND (fair_value.reported_n = 1) AND (fair_value.distinct_raw = 1)) THEN fair_value.currency_state
            ELSE NULL::text
        END AS fair_value_currency_state,
        CASE
            WHEN ((fair_value.n = 1) AND (fair_value.reported_n = 1) AND (fair_value.distinct_raw = 1)) THEN fair_value.scale_state
            ELSE NULL::text
        END AS fair_value_scale_state,
        CASE
            WHEN (acquisition.n IS NULL) THEN 'UNKNOWN'::text
            WHEN ((acquisition.n = 1) AND (acquisition.reported_n = 1) AND (acquisition.distinct_raw = 1)) THEN 'REPORTED'::text
            WHEN ((acquisition.n = 1) AND (acquisition.only_state = 'UNKNOWN'::text)) THEN 'UNKNOWN'::text
            WHEN ((acquisition.n = 1) AND (acquisition.only_state = 'NOT_APPLICABLE'::text)) THEN 'NOT_APPLICABLE'::text
            ELSE 'MULTIPLE_VALUES'::text
        END AS acquisition_state,
        CASE
            WHEN ((acquisition.n = 1) AND (acquisition.reported_n = 1) AND (acquisition.distinct_raw = 1)) THEN acquisition.raw_value
            ELSE NULL::text
        END AS acquisition_raw,
        CASE
            WHEN ((acquisition.n = 1) AND (acquisition.reported_n = 1) AND (acquisition.distinct_raw = 1)) THEN acquisition.normalized_date
            ELSE NULL::date
        END AS acquisition_date,
        CASE
            WHEN ((acquisition.n = 1) AND (acquisition.reported_n = 1) AND (acquisition.distinct_raw = 1)) THEN acquisition.date_precision
            ELSE NULL::text
        END AS acquisition_precision,
        CASE
            WHEN ((acquisition.n = 1) AND (acquisition.reported_n = 1) AND (acquisition.distinct_raw = 1)) THEN acquisition.normalized_year
            ELSE NULL::integer
        END AS acquisition_year,
        CASE
            WHEN ((acquisition.n = 1) AND (acquisition.reported_n = 1) AND (acquisition.distinct_raw = 1)) THEN acquisition.normalized_month
            ELSE NULL::integer
        END AS acquisition_month,
        CASE
            WHEN (acquisition.n = 1) THEN acquisition.evidence_id
            ELSE NULL::bigint
        END AS acquisition_evidence_id,
        CASE
            WHEN (interest_rate.n IS NULL) THEN 'UNKNOWN'::text
            WHEN ((interest_rate.n = 1) AND (interest_rate.reported_n = 1) AND (interest_rate.distinct_raw = 1)) THEN 'REPORTED'::text
            WHEN ((interest_rate.n = 1) AND (interest_rate.only_state = 'UNKNOWN'::text)) THEN 'UNKNOWN'::text
            WHEN ((interest_rate.n = 1) AND (interest_rate.only_state = 'NOT_APPLICABLE'::text)) THEN 'NOT_APPLICABLE'::text
            ELSE 'MULTIPLE_VALUES'::text
        END AS interest_rate_state,
        CASE
            WHEN ((interest_rate.n = 1) AND (interest_rate.reported_n = 1) AND (interest_rate.distinct_raw = 1)) THEN interest_rate.raw_value
            ELSE NULL::text
        END AS interest_rate_raw,
        CASE
            WHEN ((interest_rate.n = 1) AND (interest_rate.reported_n = 1) AND (interest_rate.distinct_raw = 1)) THEN interest_rate.normalized_numeric
            ELSE NULL::numeric
        END AS interest_rate_numeric,
        CASE
            WHEN (interest_rate.n = 1) THEN interest_rate.evidence_id
            ELSE NULL::bigint
        END AS interest_rate_evidence_id,
        CASE
            WHEN ((interest_rate.n = 1) AND (interest_rate.reported_n = 1) AND (interest_rate.distinct_raw = 1)) THEN interest_rate.scale_state
            ELSE NULL::text
        END AS interest_rate_scale_state,
        CASE
            WHEN (spread.n IS NULL) THEN 'UNKNOWN'::text
            WHEN ((spread.n = 1) AND (spread.reported_n = 1) AND (spread.distinct_raw = 1)) THEN 'REPORTED'::text
            WHEN ((spread.n = 1) AND (spread.only_state = 'UNKNOWN'::text)) THEN 'UNKNOWN'::text
            WHEN ((spread.n = 1) AND (spread.only_state = 'NOT_APPLICABLE'::text)) THEN 'NOT_APPLICABLE'::text
            ELSE 'MULTIPLE_VALUES'::text
        END AS spread_state,
        CASE
            WHEN ((spread.n = 1) AND (spread.reported_n = 1) AND (spread.distinct_raw = 1)) THEN spread.raw_value
            ELSE NULL::text
        END AS spread_raw,
        CASE
            WHEN ((spread.n = 1) AND (spread.reported_n = 1) AND (spread.distinct_raw = 1)) THEN spread.normalized_numeric
            ELSE NULL::numeric
        END AS spread_numeric,
        CASE
            WHEN (spread.n = 1) THEN spread.evidence_id
            ELSE NULL::bigint
        END AS spread_evidence_id,
        CASE
            WHEN ((spread.n = 1) AND (spread.reported_n = 1) AND (spread.distinct_raw = 1)) THEN spread.scale_state
            ELSE NULL::text
        END AS spread_scale_state,
        CASE
            WHEN (floor_rate.n IS NULL) THEN 'UNKNOWN'::text
            WHEN ((floor_rate.n = 1) AND (floor_rate.reported_n = 1) AND (floor_rate.distinct_raw = 1)) THEN 'REPORTED'::text
            WHEN ((floor_rate.n = 1) AND (floor_rate.only_state = 'UNKNOWN'::text)) THEN 'UNKNOWN'::text
            WHEN ((floor_rate.n = 1) AND (floor_rate.only_state = 'NOT_APPLICABLE'::text)) THEN 'NOT_APPLICABLE'::text
            ELSE 'MULTIPLE_VALUES'::text
        END AS interest_rate_floor_state,
        CASE
            WHEN ((floor_rate.n = 1) AND (floor_rate.reported_n = 1) AND (floor_rate.distinct_raw = 1)) THEN floor_rate.raw_value
            ELSE NULL::text
        END AS interest_rate_floor_raw,
        CASE
            WHEN ((floor_rate.n = 1) AND (floor_rate.reported_n = 1) AND (floor_rate.distinct_raw = 1)) THEN floor_rate.normalized_numeric
            ELSE NULL::numeric
        END AS interest_rate_floor_numeric,
        CASE
            WHEN (floor_rate.n = 1) THEN floor_rate.evidence_id
            ELSE NULL::bigint
        END AS interest_rate_floor_evidence_id,
        CASE
            WHEN ((floor_rate.n = 1) AND (floor_rate.reported_n = 1) AND (floor_rate.distinct_raw = 1)) THEN floor_rate.scale_state
            ELSE NULL::text
        END AS interest_rate_floor_scale_state,
    mr.maturity_source,
    mr.maturity_raw,
    mr.maturity_date,
    mr.maturity_precision,
    mr.maturity_year,
    mr.maturity_month,
    mr.inspection_state AS maturity_inspection_state,
    mr.no_bind_reason AS maturity_no_bind_reason,
    mr.filing_verified AS maturity_filing_verified,
    mr.maturity_document_url,
    mp.evidence_id AS maturity_evidence_id
   FROM ((((((((((((((((((obs.position_observation p
     JOIN registry.filing f ON ((f.id = p.filing_id)))
     JOIN evidence.evidence oe ON ((oe.id = p.evidence_id)))
     JOIN LATERAL ( SELECT mr_row.position_observation_id,
            mr_row.maturity_date,
            mr_row.maturity_raw,
            mr_row.maturity_source,
            mr_row.inspection_state,
            mr_row.no_bind_reason,
            mr_row.filing_verified,
            mr_row.maturity_document_url,
            mr_row.maturity_precision,
            mr_row.maturity_year,
            mr_row.maturity_month
           FROM registry.maturity_read mr_row
          WHERE (mr_row.position_observation_id = p.id)) mr ON (true))
     JOIN LATERAL ( SELECT mp_row.position_observation_id,
            mp_row.provenance_state,
            mp_row.inspection_id,
            mp_row.inspection_state,
            mp_row.filing_context_id,
            mp_row.structured_raw,
            mp_row.structured_date,
            mp_row.displayed_raw,
            mp_row.displayed_date,
            mp_row.evidence_id,
            mp_row.no_bind_reason,
            mp_row.maturity_date,
            mp_row.maturity_raw,
            mp_row.filing_verified,
            mp_row.structured_field_value_id,
            mp_row.maturity_precision,
            mp_row.maturity_year,
            mp_row.maturity_month
           FROM obs.maturity_provenance mp_row
          WHERE (mp_row.position_observation_id = p.id)) mp ON (true))
     LEFT JOIN LATERAL ( SELECT (NULLIF(count(*), 0))::integer AS name_count,
                CASE
                    WHEN (count(*) = 1) THEN min(b.id)
                    ELSE NULL::bigint
                END AS borrower_name_observation_id,
                CASE
                    WHEN (count(*) = 1) THEN min(b.raw_text)
                    ELSE NULL::text
                END AS borrower_name_raw,
                CASE
                    WHEN (count(*) = 1) THEN min(b.evidence_id)
                    ELSE NULL::bigint
                END AS borrower_name_evidence_id
           FROM obs.current_borrower_name_observation b
          WHERE ((b.position_observation_id = p.id) AND (b.source_column_label = 'Investment, Identifier Axis'::text) AND (b.extraction_state = 'EXTRACTED'::text))) names ON (true))
     LEFT JOIN resolution.current_entity_resolution er ON (((names.name_count = 1) AND (er.borrower_name_observation_id = names.borrower_name_observation_id))))
     LEFT JOIN LATERAL ( SELECT (count(*))::integer AS n,
            (count(*) FILTER (WHERE (fv.value_state = 'REPORTED'::ref.value_state)))::integer AS reported_n,
            (count(DISTINCT fv.raw_value))::integer AS distinct_raw,
            min((fv.value_state)::text) AS only_state,
            min(fv.raw_value) AS raw_value,
            min(fv.normalized_numeric) AS normalized_numeric,
            min(fv.normalized_date) AS normalized_date,
            min(fv.date_precision) AS date_precision,
            min(fv.normalized_year) AS normalized_year,
            min(fv.normalized_month) AS normalized_month,
            min(fv.evidence_id) AS evidence_id,
            min((fv.currency_state)::text) AS currency_state,
            min((fv.scale_state)::text) AS scale_state
           FROM obs.position_field_value fv
          WHERE ((fv.position_observation_id = p.id) AND (fv.field_code = 'PRINCIPAL_AMOUNT'::text) AND (NOT (EXISTS ( SELECT 1
                   FROM obs.position_field_value newer
                  WHERE (newer.supersedes_id = fv.id)))))
         HAVING (count(*) > 0)) principal ON (true))
     LEFT JOIN LATERAL ( SELECT (count(*))::integer AS n,
            (count(*) FILTER (WHERE (fv.value_state = 'REPORTED'::ref.value_state)))::integer AS reported_n,
            (count(DISTINCT fv.raw_value))::integer AS distinct_raw,
            min((fv.value_state)::text) AS only_state,
            min(fv.raw_value) AS raw_value,
            min(fv.normalized_numeric) AS normalized_numeric,
            min(fv.normalized_date) AS normalized_date,
            min(fv.date_precision) AS date_precision,
            min(fv.normalized_year) AS normalized_year,
            min(fv.normalized_month) AS normalized_month,
            min(fv.evidence_id) AS evidence_id,
            min((fv.currency_state)::text) AS currency_state,
            min((fv.scale_state)::text) AS scale_state
           FROM obs.position_field_value fv
          WHERE ((fv.position_observation_id = p.id) AND (fv.field_code = 'COST'::text) AND (NOT (EXISTS ( SELECT 1
                   FROM obs.position_field_value newer
                  WHERE (newer.supersedes_id = fv.id)))))
         HAVING (count(*) > 0)) cost ON (true))
     LEFT JOIN LATERAL ( SELECT (count(*))::integer AS n,
            (count(*) FILTER (WHERE (fv.value_state = 'REPORTED'::ref.value_state)))::integer AS reported_n,
            (count(DISTINCT fv.raw_value))::integer AS distinct_raw,
            min((fv.value_state)::text) AS only_state,
            min(fv.raw_value) AS raw_value,
            min(fv.normalized_numeric) AS normalized_numeric,
            min(fv.normalized_date) AS normalized_date,
            min(fv.date_precision) AS date_precision,
            min(fv.normalized_year) AS normalized_year,
            min(fv.normalized_month) AS normalized_month,
            min(fv.evidence_id) AS evidence_id,
            min((fv.currency_state)::text) AS currency_state,
            min((fv.scale_state)::text) AS scale_state
           FROM obs.position_field_value fv
          WHERE ((fv.position_observation_id = p.id) AND (fv.field_code = 'FAIR_VALUE'::text) AND (NOT (EXISTS ( SELECT 1
                   FROM obs.position_field_value newer
                  WHERE (newer.supersedes_id = fv.id)))))
         HAVING (count(*) > 0)) fair_value ON (true))
     LEFT JOIN LATERAL ( SELECT (count(*))::integer AS n,
            (count(*) FILTER (WHERE (fv.value_state = 'REPORTED'::ref.value_state)))::integer AS reported_n,
            (count(DISTINCT fv.raw_value))::integer AS distinct_raw,
            min((fv.value_state)::text) AS only_state,
            min(fv.raw_value) AS raw_value,
            min(fv.normalized_numeric) AS normalized_numeric,
            min(fv.normalized_date) AS normalized_date,
            min(fv.date_precision) AS date_precision,
            min(fv.normalized_year) AS normalized_year,
            min(fv.normalized_month) AS normalized_month,
            min(fv.evidence_id) AS evidence_id,
            min((fv.currency_state)::text) AS currency_state,
            min((fv.scale_state)::text) AS scale_state
           FROM obs.position_field_value fv
          WHERE ((fv.position_observation_id = p.id) AND (fv.field_code = 'ACQUISITION_DATE'::text) AND (NOT (EXISTS ( SELECT 1
                   FROM obs.position_field_value newer
                  WHERE (newer.supersedes_id = fv.id)))))
         HAVING (count(*) > 0)) acquisition ON (true))
     LEFT JOIN LATERAL ( SELECT (count(*))::integer AS n,
            (count(*) FILTER (WHERE (fv.value_state = 'REPORTED'::ref.value_state)))::integer AS reported_n,
            (count(DISTINCT fv.raw_value))::integer AS distinct_raw,
            min((fv.value_state)::text) AS only_state,
            min(fv.raw_value) AS raw_value,
            min(fv.normalized_numeric) AS normalized_numeric,
            min(fv.normalized_date) AS normalized_date,
            min(fv.date_precision) AS date_precision,
            min(fv.normalized_year) AS normalized_year,
            min(fv.normalized_month) AS normalized_month,
            min(fv.evidence_id) AS evidence_id,
            min((fv.currency_state)::text) AS currency_state,
            min((fv.scale_state)::text) AS scale_state
           FROM obs.position_field_value fv
          WHERE ((fv.position_observation_id = p.id) AND (fv.field_code = 'INTEREST_RATE'::text) AND (NOT (EXISTS ( SELECT 1
                   FROM obs.position_field_value newer
                  WHERE (newer.supersedes_id = fv.id)))))
         HAVING (count(*) > 0)) interest_rate ON (true))
     LEFT JOIN LATERAL ( SELECT (count(*))::integer AS n,
            (count(*) FILTER (WHERE (fv.value_state = 'REPORTED'::ref.value_state)))::integer AS reported_n,
            (count(DISTINCT fv.raw_value))::integer AS distinct_raw,
            min((fv.value_state)::text) AS only_state,
            min(fv.raw_value) AS raw_value,
            min(fv.normalized_numeric) AS normalized_numeric,
            min(fv.normalized_date) AS normalized_date,
            min(fv.date_precision) AS date_precision,
            min(fv.normalized_year) AS normalized_year,
            min(fv.normalized_month) AS normalized_month,
            min(fv.evidence_id) AS evidence_id,
            min((fv.currency_state)::text) AS currency_state,
            min((fv.scale_state)::text) AS scale_state
           FROM obs.position_field_value fv
          WHERE ((fv.position_observation_id = p.id) AND (fv.field_code = 'SPREAD'::text) AND (NOT (EXISTS ( SELECT 1
                   FROM obs.position_field_value newer
                  WHERE (newer.supersedes_id = fv.id)))))
         HAVING (count(*) > 0)) spread ON (true))
     LEFT JOIN LATERAL ( SELECT (count(*))::integer AS n,
            (count(*) FILTER (WHERE (fv.value_state = 'REPORTED'::ref.value_state)))::integer AS reported_n,
            (count(DISTINCT fv.raw_value))::integer AS distinct_raw,
            min((fv.value_state)::text) AS only_state,
            min(fv.raw_value) AS raw_value,
            min(fv.normalized_numeric) AS normalized_numeric,
            min(fv.normalized_date) AS normalized_date,
            min(fv.date_precision) AS date_precision,
            min(fv.normalized_year) AS normalized_year,
            min(fv.normalized_month) AS normalized_month,
            min(fv.evidence_id) AS evidence_id,
            min((fv.currency_state)::text) AS currency_state,
            min((fv.scale_state)::text) AS scale_state
           FROM obs.position_field_value fv
          WHERE ((fv.position_observation_id = p.id) AND (fv.field_code = 'INTEREST_RATE_FLOOR'::text) AND (NOT (EXISTS ( SELECT 1
                   FROM obs.position_field_value newer
                  WHERE (newer.supersedes_id = fv.id)))))
         HAVING (count(*) > 0)) floor_rate ON (true))
     LEFT JOIN LATERAL ( SELECT (count(*))::integer AS n,
                CASE
                    WHEN (count(*) = 1) THEN (array_agg(g.economic_group_id))[1]
                    ELSE NULL::uuid
                END AS economic_group_id,
                CASE
                    WHEN (count(*) = 1) THEN min((g.state)::text)
                    ELSE NULL::text
                END AS state,
                CASE
                    WHEN (count(*) = 1) THEN min(g.evidence_id)
                    ELSE NULL::bigint
                END AS evidence_id
           FROM resolution.current_group_membership g
          WHERE ((names.name_count = 1) AND (er.legal_entity_id IS NOT NULL) AND (g.legal_entity_id = er.legal_entity_id))) grp ON (true))
     LEFT JOIN LATERAL ( SELECT (count(*))::integer AS n,
                CASE
                    WHEN (count(*) = 1) THEN (array_agg(d.instrument_id))[1]
                    ELSE NULL::uuid
                END AS instrument_id,
                CASE
                    WHEN (count(*) = 1) THEN min((d.state)::text)
                    ELSE NULL::text
                END AS state,
                CASE
                    WHEN (count(*) = 1) THEN min(d.method)
                    ELSE NULL::text
                END AS method,
                CASE
                    WHEN (count(*) = 1) THEN min(d.evidence_id)
                    ELSE NULL::bigint
                END AS evidence_id
           FROM resolution.current_instrument_resolution d
          WHERE (d.position_observation_id = p.id)) inst ON (true))
     LEFT JOIN LATERAL ( SELECT (count(*))::integer AS n,
                CASE
                    WHEN (count(*) = 1) THEN (array_agg(d.position_id))[1]
                    ELSE NULL::uuid
                END AS position_id,
                CASE
                    WHEN (count(*) = 1) THEN min((d.state)::text)
                    ELSE NULL::text
                END AS state,
                CASE
                    WHEN (count(*) = 1) THEN min(d.method)
                    ELSE NULL::text
                END AS method,
                CASE
                    WHEN (count(*) = 1) THEN min(d.evidence_id)
                    ELSE NULL::bigint
                END AS evidence_id
           FROM resolution.current_position_continuity d
          WHERE (d.position_observation_id = p.id)) cont ON (true))
     LEFT JOIN LATERAL ( SELECT min(e.event_code) AS event_code
           FROM derived.observation_event e
          WHERE ((e.position_observation_id = p.id) AND (e.event_code = 'REGISTRANT_FIRST_OBSERVED_NAME'::text))) first_observed ON (true))
     LEFT JOIN LATERAL ( SELECT
                CASE
                    WHEN ((filing_link.multiple_n > 0) OR (filing_link.linked_registrants > 1)) THEN 'MULTIPLE'::text
                    WHEN (filing_link.linked_registrants = 1) THEN 'LINKED'::text
                    ELSE 'UNKNOWN'::text
                END AS registrant_link_status,
                CASE
                    WHEN ((filing_link.multiple_n = 0) AND (filing_link.linked_registrants = 1)) THEN filing_link.registrant_id
                    ELSE NULL::bigint
                END AS registrant_id,
                CASE
                    WHEN ((filing_link.multiple_n = 0) AND (filing_link.linked_registrants = 1)) THEN lpad((filing_link.cik)::text, 10, '0'::text)
                    ELSE NULL::text
                END AS registrant_cik,
                CASE
                    WHEN ((filing_link.multiple_n = 0) AND (filing_link.linked_registrants = 1) AND (filing_link.linked_evidence_n = 1)) THEN filing_link.evidence_id
                    ELSE NULL::bigint
                END AS registrant_evidence_id
           FROM ( SELECT (count(DISTINCT filing_registrant.registrant_id) FILTER (WHERE (filing_registrant.link_status = 'LINKED'::text)))::integer AS linked_registrants,
                    (count(DISTINCT filing_registrant.evidence_id) FILTER (WHERE (filing_registrant.link_status = 'LINKED'::text)))::integer AS linked_evidence_n,
                    (count(*) FILTER (WHERE (filing_registrant.link_status = 'MULTIPLE'::text)))::integer AS multiple_n,
                    min(filing_registrant.registrant_id) FILTER (WHERE (filing_registrant.link_status = 'LINKED'::text)) AS registrant_id,
                    min(filing_registrant.cik) FILTER (WHERE (filing_registrant.link_status = 'LINKED'::text)) AS cik,
                    min(filing_registrant.evidence_id) FILTER (WHERE (filing_registrant.link_status = 'LINKED'::text)) AS evidence_id
                   FROM ( SELECT h.registrant_id,
                            h.evidence_id,
                            registrant.cik,
                                CASE
                                    WHEN (h.id IS NULL) THEN 'UNKNOWN'::text
                                    WHEN (counts.registrant_count > 1) THEN 'MULTIPLE'::text
                                    ELSE 'LINKED'::text
                                END AS link_status
                           FROM (((( SELECT 1 AS "?column?") filing_anchor
                             LEFT JOIN ( SELECT l.id,
                                    l.registrant_id,
                                    l.evidence_id
                                   FROM registry.filing_registrant_link l
                                  WHERE ((l.filing_id = p.filing_id) AND (NOT (EXISTS ( SELECT 1
   FROM registry.filing_registrant_link superseded
  WHERE (superseded.supersedes_id = l.id)))))) h ON (true))
                             LEFT JOIN LATERAL ( SELECT (count(DISTINCT l2.registrant_id))::integer AS registrant_count
                                   FROM registry.filing_registrant_link l2
                                  WHERE ((l2.filing_id = p.filing_id) AND (NOT (EXISTS ( SELECT 1
   FROM registry.filing_registrant_link superseded
  WHERE (superseded.supersedes_id = l2.id)))))) counts ON (true))
                             LEFT JOIN registry.registrant registrant ON ((registrant.id = h.registrant_id)))) filing_registrant) filing_link) reg ON (true));

COMMENT ON VIEW registry.position_read IS 'One row per position observation. Observed field heads stay REPORTED only when exactly one current raw value is stored. A missing head is UNKNOWN and null, never zero. Resolution columns repeat the current decision, or UNRESOLVED when there is no single current decision. Maturity columns are registry.maturity_read. Acquisition date is the stored ACQUISITION_DATE, not an origination date. No row is created for a period that was not observed, and absence is not an exit. Registrant CIK is present when every current filing link names one registrant. More than one registrant leaves the CIK null.';

COMMENT ON COLUMN registry.position_read.economic_group_state IS 'Current group-membership state when the legal entity has exactly one current membership. UNRESOLVED when there is no membership or more than one. Name similarity does not create a membership.';

COMMENT ON COLUMN registry.position_read.continuity_state IS 'Current position_continuity_decision state, or UNRESOLVED when that observation has no single current decision. A later period with no observation is not represented.';

COMMENT ON COLUMN registry.position_read.first_observed_event_code IS 'REGISTRANT_FIRST_OBSERVED_NAME when that stored event exists. Null otherwise. Not an exit, repayment, or instrument event.';

COMMENT ON COLUMN registry.position_read.acquisition_date IS 'Stored ACQUISITION_DATE calendar day. Null when the stored precision is MONTH, and null when acquisition was not observed. This is not an origination date.';

COMMENT ON COLUMN registry.position_read.acquisition_precision IS 'MONTH when the stored acquisition date is a year and month. Null for a calendar day and when acquisition was not observed.';

COMMENT ON COLUMN registry.position_read.maturity_date IS 'Calendar maturity from registry.maturity_read. Null for month precision and when no maturity was selected.';

CREATE VIEW registry.position_period_comparison AS
 WITH continuity_match AS MATERIALIZED (
         SELECT d.position_observation_id
           FROM resolution.current_position_continuity d
          WHERE ((d.state = 'MATCHED'::ref.resolution_state) AND (d.position_id IS NOT NULL))
        ), confirmed AS (
         SELECT r.position_observation_id,
            r.reported_date,
            r.filing_id,
            r.accession_number,
            r.registrant_id,
            r.registrant_cik,
            r.registrant_link_status,
            r.registrant_evidence_id,
            r.borrower_name_observation_id,
            r.borrower_name_raw,
            r.borrower_name_evidence_id,
            r.legal_entity_id,
            r.entity_resolution_state,
            r.entity_resolution_method,
            r.entity_resolution_evidence_id,
            r.economic_group_id,
            r.economic_group_state,
            r.economic_group_evidence_id,
            r.instrument_id,
            r.instrument_resolution_state,
            r.instrument_resolution_method,
            r.instrument_resolution_evidence_id,
            r.position_id,
            r.continuity_state,
            r.continuity_method,
            r.continuity_evidence_id,
            r.first_observed_event_code,
            r.origin_soi_row_observation_id,
            r.holding_descriptor_raw,
            r.observation_evidence_id,
            r.observation_evidence_level,
            r.principal_state,
            r.principal_raw,
            r.principal_numeric,
            r.principal_evidence_id,
            r.principal_currency_state,
            r.principal_scale_state,
            r.cost_state,
            r.cost_raw,
            r.cost_numeric,
            r.cost_evidence_id,
            r.cost_currency_state,
            r.cost_scale_state,
            r.fair_value_state,
            r.fair_value_raw,
            r.fair_value_numeric,
            r.fair_value_evidence_id,
            r.fair_value_currency_state,
            r.fair_value_scale_state,
            r.acquisition_state,
            r.acquisition_raw,
            r.acquisition_date,
            r.acquisition_precision,
            r.acquisition_year,
            r.acquisition_month,
            r.acquisition_evidence_id,
            r.interest_rate_state,
            r.interest_rate_raw,
            r.interest_rate_numeric,
            r.interest_rate_evidence_id,
            r.interest_rate_scale_state,
            r.spread_state,
            r.spread_raw,
            r.spread_numeric,
            r.spread_evidence_id,
            r.spread_scale_state,
            r.interest_rate_floor_state,
            r.interest_rate_floor_raw,
            r.interest_rate_floor_numeric,
            r.interest_rate_floor_evidence_id,
            r.interest_rate_floor_scale_state,
            r.maturity_source,
            r.maturity_raw,
            r.maturity_date,
            r.maturity_precision,
            r.maturity_year,
            r.maturity_month,
            r.maturity_inspection_state,
            r.maturity_no_bind_reason,
            r.maturity_filing_verified,
            r.maturity_document_url,
            r.maturity_evidence_id
           FROM (continuity_match d
             JOIN LATERAL ( SELECT pr.position_observation_id,
                    pr.reported_date,
                    pr.filing_id,
                    pr.accession_number,
                    pr.registrant_id,
                    pr.registrant_cik,
                    pr.registrant_link_status,
                    pr.registrant_evidence_id,
                    pr.borrower_name_observation_id,
                    pr.borrower_name_raw,
                    pr.borrower_name_evidence_id,
                    pr.legal_entity_id,
                    pr.entity_resolution_state,
                    pr.entity_resolution_method,
                    pr.entity_resolution_evidence_id,
                    pr.economic_group_id,
                    pr.economic_group_state,
                    pr.economic_group_evidence_id,
                    pr.instrument_id,
                    pr.instrument_resolution_state,
                    pr.instrument_resolution_method,
                    pr.instrument_resolution_evidence_id,
                    pr.position_id,
                    pr.continuity_state,
                    pr.continuity_method,
                    pr.continuity_evidence_id,
                    pr.first_observed_event_code,
                    pr.origin_soi_row_observation_id,
                    pr.holding_descriptor_raw,
                    pr.observation_evidence_id,
                    pr.observation_evidence_level,
                    pr.principal_state,
                    pr.principal_raw,
                    pr.principal_numeric,
                    pr.principal_evidence_id,
                    pr.principal_currency_state,
                    pr.principal_scale_state,
                    pr.cost_state,
                    pr.cost_raw,
                    pr.cost_numeric,
                    pr.cost_evidence_id,
                    pr.cost_currency_state,
                    pr.cost_scale_state,
                    pr.fair_value_state,
                    pr.fair_value_raw,
                    pr.fair_value_numeric,
                    pr.fair_value_evidence_id,
                    pr.fair_value_currency_state,
                    pr.fair_value_scale_state,
                    pr.acquisition_state,
                    pr.acquisition_raw,
                    pr.acquisition_date,
                    pr.acquisition_precision,
                    pr.acquisition_year,
                    pr.acquisition_month,
                    pr.acquisition_evidence_id,
                    pr.interest_rate_state,
                    pr.interest_rate_raw,
                    pr.interest_rate_numeric,
                    pr.interest_rate_evidence_id,
                    pr.interest_rate_scale_state,
                    pr.spread_state,
                    pr.spread_raw,
                    pr.spread_numeric,
                    pr.spread_evidence_id,
                    pr.spread_scale_state,
                    pr.interest_rate_floor_state,
                    pr.interest_rate_floor_raw,
                    pr.interest_rate_floor_numeric,
                    pr.interest_rate_floor_evidence_id,
                    pr.interest_rate_floor_scale_state,
                    pr.maturity_source,
                    pr.maturity_raw,
                    pr.maturity_date,
                    pr.maturity_precision,
                    pr.maturity_year,
                    pr.maturity_month,
                    pr.maturity_inspection_state,
                    pr.maturity_no_bind_reason,
                    pr.maturity_filing_verified,
                    pr.maturity_document_url,
                    pr.maturity_evidence_id
                   FROM registry.position_read pr
                  WHERE (pr.position_observation_id = d.position_observation_id)
                 OFFSET 0) r ON (true))
          WHERE ((r.continuity_state = 'MATCHED'::text) AND (r.position_id IS NOT NULL) AND (r.reported_date IS NOT NULL))
        ), date_population AS (
         SELECT confirmed.position_id,
            confirmed.reported_date,
            (count(*))::integer AS observation_count
           FROM confirmed
          GROUP BY confirmed.position_id, confirmed.reported_date
        ), endpoints AS (
         SELECT c.position_observation_id,
            c.reported_date,
            c.filing_id,
            c.accession_number,
            c.registrant_id,
            c.registrant_cik,
            c.registrant_link_status,
            c.registrant_evidence_id,
            c.borrower_name_observation_id,
            c.borrower_name_raw,
            c.borrower_name_evidence_id,
            c.legal_entity_id,
            c.entity_resolution_state,
            c.entity_resolution_method,
            c.entity_resolution_evidence_id,
            c.economic_group_id,
            c.economic_group_state,
            c.economic_group_evidence_id,
            c.instrument_id,
            c.instrument_resolution_state,
            c.instrument_resolution_method,
            c.instrument_resolution_evidence_id,
            c.position_id,
            c.continuity_state,
            c.continuity_method,
            c.continuity_evidence_id,
            c.first_observed_event_code,
            c.origin_soi_row_observation_id,
            c.holding_descriptor_raw,
            c.observation_evidence_id,
            c.observation_evidence_level,
            c.principal_state,
            c.principal_raw,
            c.principal_numeric,
            c.principal_evidence_id,
            c.principal_currency_state,
            c.principal_scale_state,
            c.cost_state,
            c.cost_raw,
            c.cost_numeric,
            c.cost_evidence_id,
            c.cost_currency_state,
            c.cost_scale_state,
            c.fair_value_state,
            c.fair_value_raw,
            c.fair_value_numeric,
            c.fair_value_evidence_id,
            c.fair_value_currency_state,
            c.fair_value_scale_state,
            c.acquisition_state,
            c.acquisition_raw,
            c.acquisition_date,
            c.acquisition_precision,
            c.acquisition_year,
            c.acquisition_month,
            c.acquisition_evidence_id,
            c.interest_rate_state,
            c.interest_rate_raw,
            c.interest_rate_numeric,
            c.interest_rate_evidence_id,
            c.interest_rate_scale_state,
            c.spread_state,
            c.spread_raw,
            c.spread_numeric,
            c.spread_evidence_id,
            c.spread_scale_state,
            c.interest_rate_floor_state,
            c.interest_rate_floor_raw,
            c.interest_rate_floor_numeric,
            c.interest_rate_floor_evidence_id,
            c.interest_rate_floor_scale_state,
            c.maturity_source,
            c.maturity_raw,
            c.maturity_date,
            c.maturity_precision,
            c.maturity_year,
            c.maturity_month,
            c.maturity_inspection_state,
            c.maturity_no_bind_reason,
            c.maturity_filing_verified,
            c.maturity_document_url,
            c.maturity_evidence_id
           FROM (confirmed c
             JOIN date_population d ON (((d.position_id = c.position_id) AND (d.reported_date = c.reported_date) AND (d.observation_count = 1))))
        )
 SELECT l.position_id,
    e.position_observation_id AS earlier_position_observation_id,
    l.position_observation_id AS later_position_observation_id,
    e.reported_date AS earlier_reported_date,
    l.reported_date AS later_reported_date,
    e.accession_number AS earlier_accession_number,
    l.accession_number AS later_accession_number,
    e.observation_evidence_id AS earlier_observation_evidence_id,
    l.observation_evidence_id AS later_observation_evidence_id,
        CASE
            WHEN ((e.principal_state = 'REPORTED'::text) AND (e.principal_numeric IS NOT NULL) AND (l.principal_state = 'REPORTED'::text) AND (l.principal_numeric IS NOT NULL)) THEN 'COMPARABLE'::text
            ELSE 'INSUFFICIENT_DATA'::text
        END AS principal_comparison_state,
    e.principal_raw AS earlier_principal_raw,
    l.principal_raw AS later_principal_raw,
    e.principal_numeric AS earlier_principal_numeric,
    l.principal_numeric AS later_principal_numeric,
        CASE
            WHEN ((e.principal_state = 'REPORTED'::text) AND (e.principal_numeric IS NOT NULL) AND (l.principal_state = 'REPORTED'::text) AND (l.principal_numeric IS NOT NULL)) THEN (l.principal_numeric - e.principal_numeric)
            ELSE NULL::numeric
        END AS principal_delta,
        CASE
            WHEN ((e.principal_state = 'REPORTED'::text) AND (e.principal_numeric IS NOT NULL) AND (l.principal_state = 'REPORTED'::text) AND (l.principal_numeric IS NOT NULL)) THEN (l.principal_numeric IS DISTINCT FROM e.principal_numeric)
            ELSE NULL::boolean
        END AS principal_changed,
        CASE
            WHEN ((e.cost_state = 'REPORTED'::text) AND (e.cost_numeric IS NOT NULL) AND (l.cost_state = 'REPORTED'::text) AND (l.cost_numeric IS NOT NULL)) THEN 'COMPARABLE'::text
            ELSE 'INSUFFICIENT_DATA'::text
        END AS cost_comparison_state,
    e.cost_raw AS earlier_cost_raw,
    l.cost_raw AS later_cost_raw,
    e.cost_numeric AS earlier_cost_numeric,
    l.cost_numeric AS later_cost_numeric,
        CASE
            WHEN ((e.cost_state = 'REPORTED'::text) AND (e.cost_numeric IS NOT NULL) AND (l.cost_state = 'REPORTED'::text) AND (l.cost_numeric IS NOT NULL)) THEN (l.cost_numeric - e.cost_numeric)
            ELSE NULL::numeric
        END AS cost_delta,
        CASE
            WHEN ((e.cost_state = 'REPORTED'::text) AND (e.cost_numeric IS NOT NULL) AND (l.cost_state = 'REPORTED'::text) AND (l.cost_numeric IS NOT NULL)) THEN (l.cost_numeric IS DISTINCT FROM e.cost_numeric)
            ELSE NULL::boolean
        END AS cost_changed,
        CASE
            WHEN ((e.fair_value_state = 'REPORTED'::text) AND (e.fair_value_numeric IS NOT NULL) AND (l.fair_value_state = 'REPORTED'::text) AND (l.fair_value_numeric IS NOT NULL)) THEN 'COMPARABLE'::text
            ELSE 'INSUFFICIENT_DATA'::text
        END AS fair_value_comparison_state,
    e.fair_value_raw AS earlier_fair_value_raw,
    l.fair_value_raw AS later_fair_value_raw,
    e.fair_value_numeric AS earlier_fair_value_numeric,
    l.fair_value_numeric AS later_fair_value_numeric,
        CASE
            WHEN ((e.fair_value_state = 'REPORTED'::text) AND (e.fair_value_numeric IS NOT NULL) AND (l.fair_value_state = 'REPORTED'::text) AND (l.fair_value_numeric IS NOT NULL)) THEN (l.fair_value_numeric - e.fair_value_numeric)
            ELSE NULL::numeric
        END AS fair_value_delta,
        CASE
            WHEN ((e.fair_value_state = 'REPORTED'::text) AND (e.fair_value_numeric IS NOT NULL) AND (l.fair_value_state = 'REPORTED'::text) AND (l.fair_value_numeric IS NOT NULL)) THEN (l.fair_value_numeric IS DISTINCT FROM e.fair_value_numeric)
            ELSE NULL::boolean
        END AS fair_value_changed,
        CASE
            WHEN ((e.maturity_date IS NOT NULL) AND (e.maturity_precision IS NULL) AND (e.maturity_source = ANY (ARRAY['REPORTED_STRUCTURED'::text, 'FILING_DISPLAYED'::text])) AND (l.maturity_date IS NOT NULL) AND (l.maturity_precision IS NULL) AND (l.maturity_source = ANY (ARRAY['REPORTED_STRUCTURED'::text, 'FILING_DISPLAYED'::text]))) THEN 'COMPARABLE'::text
            WHEN ((e.maturity_precision = 'MONTH'::text) AND (l.maturity_precision = 'MONTH'::text) AND (e.maturity_year IS NOT NULL) AND (e.maturity_month IS NOT NULL) AND (l.maturity_year IS NOT NULL) AND (l.maturity_month IS NOT NULL) AND (e.maturity_source = ANY (ARRAY['REPORTED_MONTH'::text, 'FILING_MONTH'::text])) AND (l.maturity_source = ANY (ARRAY['REPORTED_MONTH'::text, 'FILING_MONTH'::text]))) THEN 'COMPARABLE'::text
            ELSE 'INSUFFICIENT_DATA'::text
        END AS maturity_comparison_state,
    e.maturity_source AS earlier_maturity_source,
    l.maturity_source AS later_maturity_source,
    e.maturity_raw AS earlier_maturity_raw,
    l.maturity_raw AS later_maturity_raw,
    e.maturity_date AS earlier_maturity_date,
    l.maturity_date AS later_maturity_date,
    e.maturity_precision AS earlier_maturity_precision,
    l.maturity_precision AS later_maturity_precision,
    e.maturity_year AS earlier_maturity_year,
    e.maturity_month AS earlier_maturity_month,
    l.maturity_year AS later_maturity_year,
    l.maturity_month AS later_maturity_month,
        CASE
            WHEN ((e.maturity_date IS NOT NULL) AND (e.maturity_precision IS NULL) AND (e.maturity_source = ANY (ARRAY['REPORTED_STRUCTURED'::text, 'FILING_DISPLAYED'::text])) AND (l.maturity_date IS NOT NULL) AND (l.maturity_precision IS NULL) AND (l.maturity_source = ANY (ARRAY['REPORTED_STRUCTURED'::text, 'FILING_DISPLAYED'::text]))) THEN (e.maturity_date IS DISTINCT FROM l.maturity_date)
            WHEN ((e.maturity_precision = 'MONTH'::text) AND (l.maturity_precision = 'MONTH'::text) AND (e.maturity_year IS NOT NULL) AND (e.maturity_month IS NOT NULL) AND (l.maturity_year IS NOT NULL) AND (l.maturity_month IS NOT NULL) AND (e.maturity_source = ANY (ARRAY['REPORTED_MONTH'::text, 'FILING_MONTH'::text])) AND (l.maturity_source = ANY (ARRAY['REPORTED_MONTH'::text, 'FILING_MONTH'::text]))) THEN ((e.maturity_year IS DISTINCT FROM l.maturity_year) OR (e.maturity_month IS DISTINCT FROM l.maturity_month))
            ELSE NULL::boolean
        END AS maturity_changed,
        CASE
            WHEN ((e.acquisition_state = 'REPORTED'::text) AND (e.acquisition_date IS NOT NULL) AND (e.acquisition_precision IS NULL) AND (l.acquisition_state = 'REPORTED'::text) AND (l.acquisition_date IS NOT NULL) AND (l.acquisition_precision IS NULL)) THEN 'COMPARABLE'::text
            WHEN ((e.acquisition_state = 'REPORTED'::text) AND (e.acquisition_precision = 'MONTH'::text) AND (e.acquisition_year IS NOT NULL) AND (e.acquisition_month IS NOT NULL) AND (l.acquisition_state = 'REPORTED'::text) AND (l.acquisition_precision = 'MONTH'::text) AND (l.acquisition_year IS NOT NULL) AND (l.acquisition_month IS NOT NULL)) THEN 'COMPARABLE'::text
            ELSE 'INSUFFICIENT_DATA'::text
        END AS acquisition_comparison_state,
    e.acquisition_raw AS earlier_acquisition_raw,
    l.acquisition_raw AS later_acquisition_raw,
    e.acquisition_date AS earlier_acquisition_date,
    l.acquisition_date AS later_acquisition_date,
    e.acquisition_precision AS earlier_acquisition_precision,
    l.acquisition_precision AS later_acquisition_precision,
    e.acquisition_year AS earlier_acquisition_year,
    e.acquisition_month AS earlier_acquisition_month,
    l.acquisition_year AS later_acquisition_year,
    l.acquisition_month AS later_acquisition_month,
        CASE
            WHEN ((e.interest_rate_state = 'REPORTED'::text) AND (e.interest_rate_numeric IS NOT NULL) AND (l.interest_rate_state = 'REPORTED'::text) AND (l.interest_rate_numeric IS NOT NULL)) THEN 'COMPARABLE'::text
            ELSE 'INSUFFICIENT_DATA'::text
        END AS interest_rate_comparison_state,
    e.interest_rate_raw AS earlier_interest_rate_raw,
    l.interest_rate_raw AS later_interest_rate_raw,
    e.interest_rate_numeric AS earlier_interest_rate_numeric,
    l.interest_rate_numeric AS later_interest_rate_numeric,
        CASE
            WHEN ((e.interest_rate_state = 'REPORTED'::text) AND (e.interest_rate_numeric IS NOT NULL) AND (l.interest_rate_state = 'REPORTED'::text) AND (l.interest_rate_numeric IS NOT NULL)) THEN (l.interest_rate_numeric - e.interest_rate_numeric)
            ELSE NULL::numeric
        END AS interest_rate_delta,
        CASE
            WHEN ((e.interest_rate_state = 'REPORTED'::text) AND (e.interest_rate_numeric IS NOT NULL) AND (l.interest_rate_state = 'REPORTED'::text) AND (l.interest_rate_numeric IS NOT NULL)) THEN (l.interest_rate_numeric IS DISTINCT FROM e.interest_rate_numeric)
            ELSE NULL::boolean
        END AS interest_rate_changed,
        CASE
            WHEN ((e.spread_state = 'REPORTED'::text) AND (e.spread_numeric IS NOT NULL) AND (l.spread_state = 'REPORTED'::text) AND (l.spread_numeric IS NOT NULL)) THEN 'COMPARABLE'::text
            ELSE 'INSUFFICIENT_DATA'::text
        END AS spread_comparison_state,
    e.spread_raw AS earlier_spread_raw,
    l.spread_raw AS later_spread_raw,
    e.spread_numeric AS earlier_spread_numeric,
    l.spread_numeric AS later_spread_numeric,
        CASE
            WHEN ((e.spread_state = 'REPORTED'::text) AND (e.spread_numeric IS NOT NULL) AND (l.spread_state = 'REPORTED'::text) AND (l.spread_numeric IS NOT NULL)) THEN (l.spread_numeric - e.spread_numeric)
            ELSE NULL::numeric
        END AS spread_delta,
        CASE
            WHEN ((e.spread_state = 'REPORTED'::text) AND (e.spread_numeric IS NOT NULL) AND (l.spread_state = 'REPORTED'::text) AND (l.spread_numeric IS NOT NULL)) THEN (l.spread_numeric IS DISTINCT FROM e.spread_numeric)
            ELSE NULL::boolean
        END AS spread_changed,
        CASE
            WHEN ((e.interest_rate_floor_state = 'REPORTED'::text) AND (e.interest_rate_floor_numeric IS NOT NULL) AND (l.interest_rate_floor_state = 'REPORTED'::text) AND (l.interest_rate_floor_numeric IS NOT NULL)) THEN 'COMPARABLE'::text
            ELSE 'INSUFFICIENT_DATA'::text
        END AS interest_rate_floor_comparison_state,
    e.interest_rate_floor_raw AS earlier_interest_rate_floor_raw,
    l.interest_rate_floor_raw AS later_interest_rate_floor_raw,
    e.interest_rate_floor_numeric AS earlier_interest_rate_floor_numeric,
    l.interest_rate_floor_numeric AS later_interest_rate_floor_numeric,
        CASE
            WHEN ((e.interest_rate_floor_state = 'REPORTED'::text) AND (e.interest_rate_floor_numeric IS NOT NULL) AND (l.interest_rate_floor_state = 'REPORTED'::text) AND (l.interest_rate_floor_numeric IS NOT NULL)) THEN (l.interest_rate_floor_numeric - e.interest_rate_floor_numeric)
            ELSE NULL::numeric
        END AS interest_rate_floor_delta,
        CASE
            WHEN ((e.interest_rate_floor_state = 'REPORTED'::text) AND (e.interest_rate_floor_numeric IS NOT NULL) AND (l.interest_rate_floor_state = 'REPORTED'::text) AND (l.interest_rate_floor_numeric IS NOT NULL)) THEN (l.interest_rate_floor_numeric IS DISTINCT FROM e.interest_rate_floor_numeric)
            ELSE NULL::boolean
        END AS interest_rate_floor_changed
   FROM (endpoints e
     JOIN endpoints l ON (((l.position_id = e.position_id) AND (l.reported_date > e.reported_date) AND (l.position_observation_id <> e.position_observation_id))))
  WHERE (NOT (EXISTS ( SELECT 1
           FROM confirmed mid
          WHERE ((mid.position_id = e.position_id) AND (mid.reported_date > e.reported_date) AND (mid.reported_date < l.reported_date)))));

COMMENT ON VIEW registry.position_period_comparison IS 'One comparison for one identity.position and two consecutive MATCHED observations with strictly increasing reported dates. Both observations must be the only MATCHED observation of that position on their reporting date. Delta is later normalized value minus earlier normalized value when both are stored. A missing value is INSUFFICIENT_DATA and null. Observed field change is not itself a credit event. Absence of a later observation is not evidence of repayment or exit.';

COMMENT ON COLUMN registry.position_period_comparison.principal_delta IS 'Later principal_numeric minus earlier principal_numeric when both are stored. Null when either side is missing. Unknown is not zero.';

COMMENT ON COLUMN registry.position_period_comparison.cost_delta IS 'Later stored COST minus earlier stored COST when both normalized numbers are stored. Null when either side is missing.';

COMMENT ON COLUMN registry.position_period_comparison.fair_value_delta IS 'Later fair_value_numeric minus earlier fair_value_numeric when both are stored. A decrease is a numeric delta, not a credit event.';

COMMENT ON COLUMN registry.position_period_comparison.maturity_changed IS 'True when both maturities are comparable calendar days and the days differ, or both are month precision and the year or month differs. Null when the two precisions are not comparable. A month is not converted to a day.';

COMMENT ON COLUMN registry.position_period_comparison.acquisition_comparison_state IS 'COMPARABLE when both stored acquisition values share calendar-day precision or both share month precision. A difference is not an origination.';

COMMENT ON COLUMN registry.position_period_comparison.interest_rate_delta IS 'Later interest_rate_numeric minus earlier interest_rate_numeric when both are stored. A reported raw rate with no normalized number is not subtracted.';

ALTER TABLE registry.registrant_attribute_observation ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME registry.registrant_attribute_observation_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE VIEW registry.registrant_coverage AS
 SELECT r.id AS registrant_id,
    r.cik,
    COALESCE(h.coverage_state, 'UNKNOWN'::ref.coverage_state) AS filing_history_coverage,
    ( SELECT count(*) AS count
           FROM ops.current_coverage c
          WHERE ((c.registrant_id = r.id) AND (c.coverage_aspect = 'FILING_METADATA'::text) AND c.is_covered)) AS covered_release_count
   FROM (registry.registrant r
     LEFT JOIN ops.current_coverage h ON (((h.registrant_id = r.id) AND (h.coverage_aspect = 'FILING_HISTORY'::text) AND (h.dataset_release_id IS NULL) AND (h.reporting_period_end IS NULL) AND (h.source_type_code = 'SEC_SUBMISSIONS_JSON'::text))));

COMMENT ON VIEW registry.registrant_coverage IS 'Filing-history coverage per registrant. UNKNOWN when never asserted; only COVERED means the full history was loaded.';

ALTER TABLE registry.registrant ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME registry.registrant_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE registry.registrant_name_history_observation ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME registry.registrant_name_history_observation_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE resolution.entity_resolution_decision ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME resolution.entity_resolution_decision_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE resolution.group_membership_decision ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME resolution.group_membership_decision_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE resolution.instrument_resolution_decision ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME resolution.instrument_resolution_decision_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE resolution.match_candidate (
    id bigint NOT NULL,
    candidate_kind text NOT NULL,
    borrower_name_observation_id bigint,
    position_observation_id bigint,
    legal_entity_id uuid,
    economic_group_id uuid,
    instrument_id uuid,
    position_id uuid,
    rule_version_id bigint NOT NULL,
    run_id bigint NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT match_candidate_candidate_kind_check CHECK ((candidate_kind = ANY (ARRAY['LEGAL_ENTITY'::text, 'ECONOMIC_GROUP'::text, 'INSTRUMENT'::text, 'POSITION'::text]))),
    CONSTRAINT match_candidate_check CHECK (
CASE candidate_kind
    WHEN 'LEGAL_ENTITY'::text THEN ((borrower_name_observation_id IS NOT NULL) AND (legal_entity_id IS NOT NULL) AND (num_nonnulls(position_observation_id, economic_group_id, instrument_id, position_id) = 0))
    WHEN 'ECONOMIC_GROUP'::text THEN ((legal_entity_id IS NOT NULL) AND (economic_group_id IS NOT NULL) AND (num_nonnulls(borrower_name_observation_id, position_observation_id, instrument_id, position_id) = 0))
    WHEN 'INSTRUMENT'::text THEN ((position_observation_id IS NOT NULL) AND (instrument_id IS NOT NULL) AND (num_nonnulls(borrower_name_observation_id, legal_entity_id, economic_group_id, position_id) = 0))
    WHEN 'POSITION'::text THEN ((position_observation_id IS NOT NULL) AND (position_id IS NOT NULL) AND (num_nonnulls(borrower_name_observation_id, legal_entity_id, economic_group_id, instrument_id) = 0))
    ELSE NULL::boolean
END)
);

CREATE TABLE resolution.match_candidate_comparison (
    id bigint NOT NULL,
    match_candidate_id bigint NOT NULL,
    attribute_code text NOT NULL,
    outcome ref.comparison_outcome NOT NULL,
    left_evidence_id bigint,
    right_evidence_id bigint,
    rule_version_id bigint NOT NULL,
    run_id bigint NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT match_candidate_comparison_attribute_code_check CHECK ((attribute_code ~ '^[A-Z][A-Z0-9_]*$'::text))
);

ALTER TABLE resolution.match_candidate_comparison ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME resolution.match_candidate_comparison_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE resolution.match_candidate ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME resolution.match_candidate_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE resolution.position_continuity_decision ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME resolution.position_continuity_decision_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE review.candidate (
    id bigint NOT NULL,
    case_key text NOT NULL,
    candidate_type review.candidate_type NOT NULL,
    source text NOT NULL,
    title text NOT NULL,
    created_by text NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT candidate_case_key_check CHECK ((case_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text)),
    CONSTRAINT candidate_created_by_check CHECK ((btrim(created_by) <> ''::text)),
    CONSTRAINT candidate_source_check CHECK ((source = ANY (ARRAY['MANUAL_SEED'::text, 'RESEARCHER'::text]))),
    CONSTRAINT candidate_title_check CHECK ((btrim(title) <> ''::text))
);

COMMENT ON TABLE review.candidate IS 'An investigation case. Status lives in review.candidate_status. This row is not a borrower and not a decision.';

ALTER TABLE review.candidate ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME review.candidate_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE review.candidate_member (
    id bigint NOT NULL,
    candidate_id bigint NOT NULL,
    position_observation_id bigint NOT NULL,
    borrower_name_observation_id bigint,
    created_by text NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT candidate_member_created_by_check CHECK ((btrim(created_by) <> ''::text))
);

COMMENT ON TABLE review.candidate_member IS 'The source observations included in a case. The observation row is not copied.';

ALTER TABLE review.candidate_member ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME review.candidate_member_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE VIEW review.candidate_member_read AS
 SELECT m.candidate_id,
    m.position_observation_id,
    m.borrower_name_observation_id,
    p.holding_descriptor_raw AS disclosed_line_text,
    p.filing_id,
    p.reported_date,
    p.evidence_id AS position_evidence_id,
    m.created_by,
    m.recorded_at AS created_at
   FROM (review.candidate_member m
     JOIN obs.position_observation p ON ((p.id = m.position_observation_id)));

COMMENT ON VIEW review.candidate_member_read IS 'Case membership plus the stored disclosed line. The observation is not copied into review.';

CREATE TABLE review.candidate_status (
    id bigint NOT NULL,
    candidate_id bigint NOT NULL,
    status review.case_status NOT NULL,
    supersedes_id bigint,
    supersede_reason text,
    created_by text NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT candidate_status_created_by_check CHECK ((btrim(created_by) <> ''::text)),
    CONSTRAINT candidate_status_not_self_superseding CHECK ((supersedes_id IS DISTINCT FROM id))
);

COMMENT ON TABLE review.candidate_status IS 'Append-only OPEN or CLOSED. The first row is OPEN. Closing inserts a new row.';

ALTER TABLE review.candidate_status ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME review.candidate_status_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE VIEW review.current_candidate AS
 SELECT c.id AS candidate_id,
    c.case_key,
    (c.candidate_type)::text AS candidate_type,
    c.source,
    c.title,
    (s.status)::text AS status,
    c.created_by,
    c.recorded_at AS created_at
   FROM (review.candidate c
     JOIN review.candidate_status s ON ((s.candidate_id = c.id)))
  WHERE (NOT (EXISTS ( SELECT 1
           FROM review.candidate_status n
          WHERE (n.supersedes_id = s.id))));

COMMENT ON VIEW review.current_candidate IS 'The current OPEN or CLOSED status. A candidate is not a resolved borrower.';

CREATE TABLE review.evidence_item (
    id bigint NOT NULL,
    candidate_id bigint NOT NULL,
    origin review.evidence_origin NOT NULL,
    source_type review.source_type NOT NULL,
    title text NOT NULL,
    source_url text,
    document_date date,
    retrieved_at timestamp with time zone,
    relevant_excerpt text,
    position_observation_id bigint,
    filing_document_id bigint,
    evidence_id bigint,
    created_by text NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT evidence_item_created_by_check CHECK ((btrim(created_by) <> ''::text)),
    CONSTRAINT evidence_item_external_shape CHECK (((origin <> 'EXTERNAL'::review.evidence_origin) OR ((source_url ~ '^https://[^[:space:]]+$'::text) AND (relevant_excerpt IS NOT NULL) AND (btrim(relevant_excerpt) <> ''::text) AND (retrieved_at IS NOT NULL) AND (evidence_id IS NULL) AND (filing_document_id IS NULL)))),
    CONSTRAINT evidence_item_internal_shape CHECK (((origin <> 'INTERNAL'::review.evidence_origin) OR ((source_url IS NULL) AND (relevant_excerpt IS NULL) AND (retrieved_at IS NULL) AND (num_nonnulls(position_observation_id, filing_document_id, evidence_id) >= 1)))),
    CONSTRAINT evidence_item_origin_type CHECK ((((origin = 'INTERNAL'::review.evidence_origin) AND (source_type = 'INTERNAL_SEC_FILING'::review.source_type)) OR ((origin = 'EXTERNAL'::review.evidence_origin) AND (source_type <> 'INTERNAL_SEC_FILING'::review.source_type)))),
    CONSTRAINT evidence_item_title_check CHECK ((btrim(title) <> ''::text))
);

COMMENT ON TABLE review.evidence_item IS 'A citation. INTERNAL references stored provenance. EXTERNAL is a researcher-added source and is not ingested.';

COMMENT ON COLUMN review.evidence_item.relevant_excerpt IS 'Required for a researcher-added source. Null for internal items so stored evidence text is not copied.';

ALTER TABLE review.evidence_item ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME review.evidence_item_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE VIEW review.evidence_item_read AS
 SELECT i.id AS evidence_item_id,
    i.candidate_id,
    (i.origin)::text AS origin,
    (i.source_type)::text AS source_type,
    i.title,
    COALESCE(i.source_url, d.document_url) AS source_url,
    d.document_name,
    i.document_date,
    i.retrieved_at,
    i.relevant_excerpt,
    p.holding_descriptor_raw AS stored_line_text,
    i.position_observation_id,
    i.filing_document_id,
    i.evidence_id,
    (e.locator_type)::text AS locator_type,
    e.html_row_ordinal,
    e.html_slot_ordinal,
    i.created_by,
    i.recorded_at AS created_at,
        CASE i.origin
            WHEN 'EXTERNAL'::review.evidence_origin THEN 'RESEARCHER_ADDED_SOURCE'::text
            ELSE 'STORED_SEC_SOURCE'::text
        END AS source_trust
   FROM (((review.evidence_item i
     LEFT JOIN obs.position_observation p ON ((p.id = i.position_observation_id)))
     LEFT JOIN registry.filing_document d ON ((d.id = i.filing_document_id)))
     LEFT JOIN evidence.evidence e ON ((e.id = i.evidence_id)));

COMMENT ON VIEW review.evidence_item_read IS 'Narrow provenance for a citation. Artifact bytes, storage keys, and checksums are not selected.';

CREATE TABLE review.evidence_set (
    id bigint NOT NULL,
    candidate_id bigint NOT NULL,
    title text NOT NULL,
    description text,
    created_by text NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT evidence_set_created_by_check CHECK ((btrim(created_by) <> ''::text)),
    CONSTRAINT evidence_set_description_check CHECK (((description IS NULL) OR (btrim(description) <> ''::text))),
    CONSTRAINT evidence_set_title_check CHECK ((btrim(title) <> ''::text))
);

COMMENT ON TABLE review.evidence_set IS 'A named collection for one research step. It stores no conclusion and no decision.';

ALTER TABLE review.evidence_set ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME review.evidence_set_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE review.evidence_set_member (
    id bigint NOT NULL,
    evidence_set_id bigint NOT NULL,
    evidence_item_id bigint NOT NULL,
    created_by text NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT evidence_set_member_created_by_check CHECK ((btrim(created_by) <> ''::text))
);

COMMENT ON TABLE review.evidence_set_member IS 'Append-only membership. Removing an item is not granted.';

ALTER TABLE review.evidence_set_member ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME review.evidence_set_member_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE VIEW review.evidence_set_member_read AS
 SELECT evidence_set_id,
    evidence_item_id,
    created_by,
    recorded_at AS created_at
   FROM review.evidence_set_member m;

CREATE VIEW review.evidence_set_read AS
 SELECT id AS evidence_set_id,
    candidate_id,
    title,
    description,
    created_by,
    recorded_at AS created_at
   FROM review.evidence_set s;

COMMENT ON VIEW review.evidence_set_read IS 'A research collection. It has no decision column.';

CREATE TABLE review.researcher_note (
    id bigint NOT NULL,
    candidate_id bigint NOT NULL,
    evidence_item_id bigint,
    note_text text NOT NULL,
    created_by text NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT researcher_note_created_by_check CHECK ((btrim(created_by) <> ''::text)),
    CONSTRAINT researcher_note_note_text_check CHECK ((btrim(note_text) <> ''::text))
);

COMMENT ON TABLE review.researcher_note IS 'Researcher interpretation. It is not source evidence and it does not change an excerpt.';

ALTER TABLE review.researcher_note ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME review.researcher_note_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE VIEW review.researcher_note_read AS
 SELECT id AS note_id,
    candidate_id,
    evidence_item_id,
    note_text,
    created_by,
    recorded_at AS created_at
   FROM review.researcher_note n;

COMMENT ON VIEW review.researcher_note_read IS 'Researcher interpretation. The note text is not an excerpt.';

ALTER TABLE validation.evidence_status_assertion ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME validation.evidence_status_assertion_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE validation.validation_result ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME validation.validation_result_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE ONLY access.grant_event
    ADD CONSTRAINT grant_event_pkey PRIMARY KEY (id);

ALTER TABLE ONLY derived.derived_value_input
    ADD CONSTRAINT derived_value_input_pkey PRIMARY KEY (id);

ALTER TABLE ONLY derived.derived_value
    ADD CONSTRAINT derived_value_pkey PRIMARY KEY (id);

ALTER TABLE ONLY derived.observation_event
    ADD CONSTRAINT observation_event_pkey PRIMARY KEY (id);

ALTER TABLE ONLY evidence.evidence
    ADD CONSTRAINT evidence_pkey PRIMARY KEY (id);

ALTER TABLE ONLY evidence.html_column_heading
    ADD CONSTRAINT html_column_heading_pkey PRIMARY KEY (evidence_id);

ALTER TABLE ONLY evidence.supplementary_evidence
    ADD CONSTRAINT supplementary_evidence_pkey PRIMARY KEY (id);

ALTER TABLE ONLY evidence.supplementary_evidence
    ADD CONSTRAINT supplementary_evidence_subject_table_subject_id_evidence_id_key UNIQUE (subject_table, subject_id, evidence_id, role);

ALTER TABLE ONLY identity.economic_group
    ADD CONSTRAINT economic_group_pkey PRIMARY KEY (id);

ALTER TABLE ONLY identity.instrument_attribute_assertion
    ADD CONSTRAINT instrument_attribute_assertion_pkey PRIMARY KEY (id);

ALTER TABLE ONLY identity.instrument
    ADD CONSTRAINT instrument_pkey PRIMARY KEY (id);

ALTER TABLE ONLY identity.legal_entity_alias
    ADD CONSTRAINT legal_entity_alias_pkey PRIMARY KEY (id);

ALTER TABLE ONLY identity.legal_entity
    ADD CONSTRAINT legal_entity_pkey PRIMARY KEY (id);

ALTER TABLE ONLY identity."position"
    ADD CONSTRAINT position_pkey PRIMARY KEY (id);

ALTER TABLE ONLY obs.borrower_name_observation
    ADD CONSTRAINT borrower_name_observation_pkey PRIMARY KEY (id);

ALTER TABLE ONLY obs.field_value_corroboration
    ADD CONSTRAINT field_value_corroboration_pkey PRIMARY KEY (id);

ALTER TABLE ONLY obs.maturity_inspection_candidate
    ADD CONSTRAINT maturity_inspection_candidate_pkey PRIMARY KEY (id);

ALTER TABLE ONLY obs.maturity_inspection
    ADD CONSTRAINT maturity_inspection_pkey PRIMARY KEY (id);

ALTER TABLE ONLY obs.num_fact_observation
    ADD CONSTRAINT num_fact_observation_pkey PRIMARY KEY (id);

ALTER TABLE ONLY obs.num_fact_observation
    ADD CONSTRAINT num_fact_observation_tabular_row_id_rule_version_id_key UNIQUE (tabular_row_id, rule_version_id);

ALTER TABLE ONLY obs.observation_equivalence
    ADD CONSTRAINT observation_equivalence_pkey PRIMARY KEY (id);

ALTER TABLE ONLY obs.observation_equivalence
    ADD CONSTRAINT observation_equivalence_tabular_row_id_equivalent_tabular_r_key UNIQUE (tabular_row_id, equivalent_tabular_row_id, rule_version_id);

ALTER TABLE ONLY obs.position_field_value
    ADD CONSTRAINT position_field_value_pkey PRIMARY KEY (id);

ALTER TABLE ONLY obs.position_observation_group_member
    ADD CONSTRAINT position_observation_group_me_group_id_position_observation_key UNIQUE (group_id, position_observation_id);

ALTER TABLE ONLY obs.position_observation_group_member
    ADD CONSTRAINT position_observation_group_member_pkey PRIMARY KEY (id);

ALTER TABLE ONLY obs.position_observation_group
    ADD CONSTRAINT position_observation_group_pkey PRIMARY KEY (id);

ALTER TABLE ONLY obs.position_observation
    ADD CONSTRAINT position_observation_origin_soi_row_observation_id_rule_ver_key UNIQUE (origin_soi_row_observation_id, rule_version_id);

ALTER TABLE ONLY obs.position_observation
    ADD CONSTRAINT position_observation_pkey PRIMARY KEY (id);

ALTER TABLE ONLY obs.position_observation_source
    ADD CONSTRAINT position_observation_source_pkey PRIMARY KEY (id);

ALTER TABLE ONLY obs.position_observation_source
    ADD CONSTRAINT position_observation_source_position_observation_id_soi_row_key UNIQUE (position_observation_id, soi_row_observation_id);

ALTER TABLE ONLY obs.soi_row_classification
    ADD CONSTRAINT soi_row_classification_pkey PRIMARY KEY (id);

ALTER TABLE ONLY obs.soi_row_observation
    ADD CONSTRAINT soi_row_observation_pkey PRIMARY KEY (id);

ALTER TABLE ONLY obs.soi_row_observation
    ADD CONSTRAINT soi_row_observation_tabular_row_id_rule_version_id_key UNIQUE (tabular_row_id, rule_version_id);

ALTER TABLE ONLY ops.artifact_processing
    ADD CONSTRAINT artifact_processing_artifact_id_rule_version_id_key UNIQUE (artifact_id, rule_version_id);

ALTER TABLE ONLY ops.artifact_processing
    ADD CONSTRAINT artifact_processing_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ops.audit_event
    ADD CONSTRAINT audit_event_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ops.coverage_assertion
    ADD CONSTRAINT coverage_assertion_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ops.projection_exception
    ADD CONSTRAINT projection_exception_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ops.rule_activation
    ADD CONSTRAINT rule_activation_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ops.rule_version
    ADD CONSTRAINT rule_version_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ops.rule_version
    ADD CONSTRAINT rule_version_rule_code_version_key UNIQUE (rule_code, version);

ALTER TABLE ONLY ops.run_outcome
    ADD CONSTRAINT run_outcome_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ops.run_outcome
    ADD CONSTRAINT run_outcome_run_id_key UNIQUE (run_id);

ALTER TABLE ONLY ops.run
    ADD CONSTRAINT run_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ops.run_rule_version
    ADD CONSTRAINT run_rule_version_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ops.run_rule_version
    ADD CONSTRAINT run_rule_version_run_id_rule_version_id_key UNIQUE (run_id, rule_version_id);

ALTER TABLE ONLY ops.schema_migration
    ADD CONSTRAINT schema_migration_pkey PRIMARY KEY (filename);

ALTER TABLE ONLY raw.artifact_lineage
    ADD CONSTRAINT artifact_lineage_artifact_id_key UNIQUE (artifact_id);

ALTER TABLE ONLY raw.artifact_lineage
    ADD CONSTRAINT artifact_lineage_pkey PRIMARY KEY (id);

ALTER TABLE ONLY raw.artifact_member
    ADD CONSTRAINT artifact_member_artifact_id_member_path_key UNIQUE (artifact_id, member_path);

ALTER TABLE ONLY raw.artifact_member
    ADD CONSTRAINT artifact_member_id_artifact_id_key UNIQUE (id, artifact_id);

ALTER TABLE ONLY raw.artifact_member
    ADD CONSTRAINT artifact_member_pkey PRIMARY KEY (id);

ALTER TABLE ONLY raw.artifact
    ADD CONSTRAINT artifact_pkey PRIMARY KEY (id);

ALTER TABLE ONLY raw.artifact
    ADD CONSTRAINT artifact_source_url_sha256_key UNIQUE (source_url, sha256);

ALTER TABLE ONLY raw.json_document
    ADD CONSTRAINT json_document_artifact_id_key UNIQUE (artifact_id);

ALTER TABLE ONLY raw.json_document
    ADD CONSTRAINT json_document_pkey PRIMARY KEY (id);

ALTER TABLE ONLY raw."json_value"
    ADD CONSTRAINT json_value_artifact_id_json_path_key UNIQUE (artifact_id, json_path);

ALTER TABLE ONLY raw."json_value"
    ADD CONSTRAINT json_value_pkey PRIMARY KEY (id);

ALTER TABLE ONLY raw.table_load
    ADD CONSTRAINT table_load_artifact_id_artifact_member_id_parser_rule_versi_key UNIQUE NULLS NOT DISTINCT (artifact_id, artifact_member_id, parser_rule_version_id);

ALTER TABLE ONLY raw.table_load
    ADD CONSTRAINT table_load_pkey PRIMARY KEY (id);

ALTER TABLE ONLY raw.tabular_row
    ADD CONSTRAINT tabular_row_pkey PRIMARY KEY (id);

ALTER TABLE ONLY raw.tabular_row
    ADD CONSTRAINT tabular_row_table_load_id_line_number_key UNIQUE (table_load_id, line_number);

ALTER TABLE ONLY ref.coverage_aspect
    ADD CONSTRAINT coverage_aspect_pkey PRIMARY KEY (code);

ALTER TABLE ONLY ref.dataset_table
    ADD CONSTRAINT dataset_table_pkey PRIMARY KEY (code);

ALTER TABLE ONLY ref.field_definition
    ADD CONSTRAINT field_definition_pkey PRIMARY KEY (field_code);

ALTER TABLE ONLY ref.filing_attribute
    ADD CONSTRAINT filing_attribute_pkey PRIMARY KEY (code);

ALTER TABLE ONLY ref.registrant_attribute
    ADD CONSTRAINT registrant_attribute_pkey PRIMARY KEY (code);

ALTER TABLE ONLY ref.registry_field_mapping
    ADD CONSTRAINT registry_field_mapping_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ref.registry_field_mapping
    ADD CONSTRAINT registry_field_mapping_source_type_code_source_field_target_key UNIQUE NULLS NOT DISTINCT (source_type_code, source_field, target_kind, target_code);

ALTER TABLE ONLY ref.source_column_mapping
    ADD CONSTRAINT source_column_mapping_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ref.source_type
    ADD CONSTRAINT source_type_pkey PRIMARY KEY (code);

ALTER TABLE ONLY registry.bdc_report_edition
    ADD CONSTRAINT bdc_report_edition_page_artifact_id_link_href_key UNIQUE (page_artifact_id, link_href);

ALTER TABLE ONLY registry.bdc_report_edition
    ADD CONSTRAINT bdc_report_edition_pkey PRIMARY KEY (id);

ALTER TABLE ONLY registry.dataset_release_artifact
    ADD CONSTRAINT dataset_release_artifact_dataset_release_id_artifact_id_key UNIQUE (dataset_release_id, artifact_id);

ALTER TABLE ONLY registry.dataset_release_artifact
    ADD CONSTRAINT dataset_release_artifact_pkey PRIMARY KEY (id);

ALTER TABLE ONLY registry.dataset_release
    ADD CONSTRAINT dataset_release_dataset_code_release_label_key UNIQUE (dataset_code, release_label);

ALTER TABLE ONLY registry.dataset_release_listing
    ADD CONSTRAINT dataset_release_listing_dataset_release_id_page_artifact_id_key UNIQUE (dataset_release_id, page_artifact_id);

ALTER TABLE ONLY registry.dataset_release_listing
    ADD CONSTRAINT dataset_release_listing_pkey PRIMARY KEY (id);

ALTER TABLE ONLY registry.dataset_release
    ADD CONSTRAINT dataset_release_pkey PRIMARY KEY (id);

ALTER TABLE ONLY registry.filing
    ADD CONSTRAINT filing_accession_number_key UNIQUE (accession_number);

ALTER TABLE ONLY registry.filing_attribute_observation
    ADD CONSTRAINT filing_attribute_observation_pkey PRIMARY KEY (id);

ALTER TABLE ONLY registry.filing_document_artifact
    ADD CONSTRAINT filing_document_artifact_filing_document_id_artifact_id_key UNIQUE (filing_document_id, artifact_id);

ALTER TABLE ONLY registry.filing_document_artifact
    ADD CONSTRAINT filing_document_artifact_pkey PRIMARY KEY (id);

ALTER TABLE ONLY registry.filing_document
    ADD CONSTRAINT filing_document_pkey PRIMARY KEY (id);

ALTER TABLE ONLY registry.filing
    ADD CONSTRAINT filing_pkey PRIMARY KEY (id);

ALTER TABLE ONLY registry.filing_registrant_link
    ADD CONSTRAINT filing_registrant_link_pkey PRIMARY KEY (id);

ALTER TABLE ONLY registry.filing_relationship_decision
    ADD CONSTRAINT filing_relationship_decision_pkey PRIMARY KEY (id);

ALTER TABLE ONLY registry.registrant_attribute_observation
    ADD CONSTRAINT registrant_attribute_observation_pkey PRIMARY KEY (id);

ALTER TABLE ONLY registry.registrant
    ADD CONSTRAINT registrant_cik_key UNIQUE (cik);

ALTER TABLE ONLY registry.registrant_name_history_observation
    ADD CONSTRAINT registrant_name_history_observation_pkey PRIMARY KEY (id);

ALTER TABLE ONLY registry.registrant
    ADD CONSTRAINT registrant_pkey PRIMARY KEY (id);

ALTER TABLE ONLY resolution.entity_resolution_decision
    ADD CONSTRAINT entity_resolution_decision_pkey PRIMARY KEY (id);

ALTER TABLE ONLY resolution.group_membership_decision
    ADD CONSTRAINT group_membership_decision_pkey PRIMARY KEY (id);

ALTER TABLE ONLY resolution.instrument_resolution_decision
    ADD CONSTRAINT instrument_resolution_decision_pkey PRIMARY KEY (id);

ALTER TABLE ONLY resolution.match_candidate_comparison
    ADD CONSTRAINT match_candidate_comparison_match_candidate_id_attribute_cod_key UNIQUE (match_candidate_id, attribute_code, rule_version_id);

ALTER TABLE ONLY resolution.match_candidate_comparison
    ADD CONSTRAINT match_candidate_comparison_pkey PRIMARY KEY (id);

ALTER TABLE ONLY resolution.match_candidate
    ADD CONSTRAINT match_candidate_pkey PRIMARY KEY (id);

ALTER TABLE ONLY resolution.position_continuity_decision
    ADD CONSTRAINT position_continuity_decision_pkey PRIMARY KEY (id);

ALTER TABLE ONLY review.candidate
    ADD CONSTRAINT candidate_case_key_key UNIQUE (case_key);

ALTER TABLE ONLY review.candidate_member
    ADD CONSTRAINT candidate_member_candidate_id_position_observation_id_key UNIQUE (candidate_id, position_observation_id);

ALTER TABLE ONLY review.candidate_member
    ADD CONSTRAINT candidate_member_pkey PRIMARY KEY (id);

ALTER TABLE ONLY review.candidate
    ADD CONSTRAINT candidate_pkey PRIMARY KEY (id);

ALTER TABLE ONLY review.candidate_status
    ADD CONSTRAINT candidate_status_pkey PRIMARY KEY (id);

ALTER TABLE ONLY review.evidence_item
    ADD CONSTRAINT evidence_item_pkey PRIMARY KEY (id);

ALTER TABLE ONLY review.evidence_set_member
    ADD CONSTRAINT evidence_set_member_evidence_set_id_evidence_item_id_key UNIQUE (evidence_set_id, evidence_item_id);

ALTER TABLE ONLY review.evidence_set_member
    ADD CONSTRAINT evidence_set_member_pkey PRIMARY KEY (id);

ALTER TABLE ONLY review.evidence_set
    ADD CONSTRAINT evidence_set_pkey PRIMARY KEY (id);

ALTER TABLE ONLY review.researcher_note
    ADD CONSTRAINT researcher_note_pkey PRIMARY KEY (id);

ALTER TABLE ONLY validation.evidence_status_assertion
    ADD CONSTRAINT evidence_status_assertion_pkey PRIMARY KEY (id);

ALTER TABLE ONLY validation.validation_result
    ADD CONSTRAINT validation_result_pkey PRIMARY KEY (id);

CREATE INDEX grant_event_lookup ON access.grant_event USING btree (user_id, grant_kind, created_at DESC, id DESC);

CREATE INDEX evidence_artifact_idx ON evidence.evidence USING btree (artifact_id);

CREATE UNIQUE INDEX evidence_html_column_heading_location ON evidence.evidence USING btree (artifact_id, html_row_ordinal, html_slot_ordinal) WHERE (locator_type = 'HTML_COLUMN_HEADING'::ref.locator_type);

CREATE INDEX supplementary_evidence_subject_idx ON evidence.supplementary_evidence USING btree (subject_table, subject_id);

CREATE UNIQUE INDEX instrument_attribute_assertion_supersedes_once ON identity.instrument_attribute_assertion USING btree (supersedes_id) WHERE (supersedes_id IS NOT NULL);

CREATE UNIQUE INDEX legal_entity_alias_supersedes_once ON identity.legal_entity_alias USING btree (supersedes_id) WHERE (supersedes_id IS NOT NULL);

CREATE UNIQUE INDEX borrower_name_observation_filing_cell_root_uidx ON obs.borrower_name_observation USING btree (position_observation_id, evidence_id) WHERE ((name_source = 'FILING_CELL'::text) AND (supersedes_id IS NULL));

COMMENT ON INDEX obs.borrower_name_observation_filing_cell_root_uidx IS 'One FILING_CELL root per position and evidence. A successor reuses that evidence and sets supersedes_id.';

CREATE INDEX borrower_name_observation_subject_idx ON obs.borrower_name_observation USING btree (position_observation_id, evidence_id, name_source, source_column_label, source_column_position);

CREATE UNIQUE INDEX borrower_name_observation_supersedes_once ON obs.borrower_name_observation USING btree (supersedes_id) WHERE (supersedes_id IS NOT NULL);

CREATE INDEX maturity_inspection_subject_idx ON obs.maturity_inspection USING btree (position_observation_id);

CREATE UNIQUE INDEX maturity_inspection_supersedes_once ON obs.maturity_inspection USING btree (supersedes_id) WHERE (supersedes_id IS NOT NULL);

CREATE INDEX num_fact_observation_filing_idx ON obs.num_fact_observation USING btree (filing_id);

CREATE INDEX position_field_value_subject_idx ON obs.position_field_value USING btree (position_observation_id, field_code, source_column_label);

CREATE UNIQUE INDEX position_field_value_supersedes_once ON obs.position_field_value USING btree (supersedes_id) WHERE (supersedes_id IS NOT NULL);

CREATE INDEX position_observation_filing_date_idx ON obs.position_observation USING btree (filing_id, reported_date, id);

CREATE UNIQUE INDEX position_observation_group_rule_key ON obs.position_observation_group USING btree (rule_version_id, grouping_key) WHERE (grouping_key IS NOT NULL);

CREATE UNIQUE INDEX position_observation_group_supersedes_once ON obs.position_observation_group USING btree (supersedes_id) WHERE (supersedes_id IS NOT NULL);

CREATE INDEX soi_row_classification_subject_idx ON obs.soi_row_classification USING btree (soi_row_observation_id);

CREATE UNIQUE INDEX soi_row_classification_supersedes_once ON obs.soi_row_classification USING btree (supersedes_id) WHERE (supersedes_id IS NOT NULL);

CREATE INDEX soi_row_observation_filing_idx ON obs.soi_row_observation USING btree (filing_id);

CREATE INDEX coverage_assertion_registrant_idx ON ops.coverage_assertion USING btree (registrant_id);

CREATE INDEX coverage_assertion_release_idx ON ops.coverage_assertion USING btree (dataset_release_id);

CREATE INDEX coverage_assertion_subject_idx ON ops.coverage_assertion USING btree (registrant_id, dataset_release_id, reporting_period_end, source_type_code, coverage_aspect);

CREATE UNIQUE INDEX coverage_assertion_supersedes_once ON ops.coverage_assertion USING btree (supersedes_id) WHERE (supersedes_id IS NOT NULL);

CREATE INDEX projection_exception_load_idx ON ops.projection_exception USING btree (table_load_id);

CREATE INDEX json_value_container_idx ON raw."json_value" USING btree (artifact_id, container_path, array_index);

CREATE INDEX tabular_row_sha_idx ON raw.tabular_row USING btree (raw_line_sha256);

CREATE INDEX source_column_mapping_subject_idx ON ref.source_column_mapping USING btree (source_table_code, column_label, field_code);

CREATE UNIQUE INDEX source_column_mapping_supersedes_once ON ref.source_column_mapping USING btree (supersedes_id) WHERE (supersedes_id IS NOT NULL);

CREATE INDEX filing_attribute_observation_subject_idx ON registry.filing_attribute_observation USING btree (filing_id, attribute_code);

CREATE UNIQUE INDEX filing_attribute_observation_supersedes_once ON registry.filing_attribute_observation USING btree (supersedes_id) WHERE (supersedes_id IS NOT NULL);

CREATE UNIQUE INDEX filing_document_named_once ON registry.filing_document USING btree (filing_id, document_name, named_by);

CREATE INDEX filing_registrant_link_filing_idx ON registry.filing_registrant_link USING btree (filing_id);

CREATE UNIQUE INDEX filing_registrant_link_supersedes_once ON registry.filing_registrant_link USING btree (supersedes_id) WHERE (supersedes_id IS NOT NULL);

CREATE INDEX filing_relationship_decision_filing_idx ON registry.filing_relationship_decision USING btree (filing_id, relationship_type);

CREATE UNIQUE INDEX filing_relationship_decision_supersedes_once ON registry.filing_relationship_decision USING btree (supersedes_id) WHERE (supersedes_id IS NOT NULL);

CREATE INDEX registrant_attribute_observation_subject_idx ON registry.registrant_attribute_observation USING btree (registrant_id, attribute_code);

CREATE UNIQUE INDEX registrant_attribute_observation_supersedes_once ON registry.registrant_attribute_observation USING btree (supersedes_id) WHERE (supersedes_id IS NOT NULL);

CREATE INDEX registrant_name_history_observation_subject_idx ON registry.registrant_name_history_observation USING btree (registrant_id);

CREATE UNIQUE INDEX registrant_name_history_observation_supersedes_once ON registry.registrant_name_history_observation USING btree (supersedes_id) WHERE (supersedes_id IS NOT NULL);

CREATE INDEX entity_resolution_decision_subject_idx ON resolution.entity_resolution_decision USING btree (borrower_name_observation_id);

CREATE UNIQUE INDEX entity_resolution_decision_supersedes_once ON resolution.entity_resolution_decision USING btree (supersedes_id) WHERE (supersedes_id IS NOT NULL);

CREATE INDEX group_membership_decision_subject_idx ON resolution.group_membership_decision USING btree (legal_entity_id, economic_group_id);

CREATE UNIQUE INDEX group_membership_decision_supersedes_once ON resolution.group_membership_decision USING btree (supersedes_id) WHERE (supersedes_id IS NOT NULL);

CREATE INDEX instrument_resolution_decision_subject_idx ON resolution.instrument_resolution_decision USING btree (position_observation_id, position_observation_group_id);

CREATE UNIQUE INDEX instrument_resolution_decision_supersedes_once ON resolution.instrument_resolution_decision USING btree (supersedes_id) WHERE (supersedes_id IS NOT NULL);

CREATE INDEX position_continuity_decision_subject_idx ON resolution.position_continuity_decision USING btree (position_observation_id);

CREATE UNIQUE INDEX position_continuity_decision_supersedes_once ON resolution.position_continuity_decision USING btree (supersedes_id) WHERE (supersedes_id IS NOT NULL);

CREATE INDEX candidate_status_subject_idx ON review.candidate_status USING btree (candidate_id);

CREATE UNIQUE INDEX candidate_status_supersedes_once ON review.candidate_status USING btree (supersedes_id) WHERE (supersedes_id IS NOT NULL);

CREATE INDEX evidence_status_assertion_subject_idx ON validation.evidence_status_assertion USING btree (field_value_id);

CREATE UNIQUE INDEX evidence_status_assertion_supersedes_once ON validation.evidence_status_assertion USING btree (supersedes_id) WHERE (supersedes_id IS NOT NULL);

CREATE INDEX validation_result_subject_idx ON validation.validation_result USING btree (subject_table, subject_id);

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON access.grant_event FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON access.grant_event FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON derived.derived_value FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON derived.derived_value_input FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON derived.observation_event FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON derived.derived_value FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON derived.derived_value_input FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON derived.observation_event FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER check_derived_value BEFORE INSERT ON derived.derived_value FOR EACH ROW EXECUTE FUNCTION derived.check_derived_value();

CREATE TRIGGER check_observation_event BEFORE INSERT ON derived.observation_event FOR EACH ROW EXECUTE FUNCTION derived.check_observation_event();

CREATE TRIGGER enforce_input_gate BEFORE INSERT ON derived.derived_value_input FOR EACH ROW EXECUTE FUNCTION derived.enforce_input_gate();

CREATE CONSTRAINT TRIGGER require_input AFTER INSERT ON derived.derived_value DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION derived.require_input();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON evidence.evidence FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON evidence.html_column_heading FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON evidence.supplementary_evidence FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON evidence.evidence FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON evidence.html_column_heading FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON evidence.supplementary_evidence FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER check_evidence BEFORE INSERT ON evidence.evidence FOR EACH ROW EXECUTE FUNCTION evidence.check_evidence();

CREATE TRIGGER check_html_column_heading BEFORE INSERT ON evidence.html_column_heading FOR EACH ROW EXECUTE FUNCTION evidence.check_html_column_heading();

CREATE TRIGGER check_supplementary_subject BEFORE INSERT ON evidence.supplementary_evidence FOR EACH ROW EXECUTE FUNCTION evidence.check_supplementary_subject();

CREATE CONSTRAINT TRIGGER require_html_column_heading AFTER INSERT ON evidence.evidence DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION evidence.require_html_column_heading();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON identity.economic_group FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON identity.instrument FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON identity.instrument_attribute_assertion FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON identity.legal_entity FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON identity.legal_entity_alias FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON identity."position" FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON identity.economic_group FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON identity.instrument FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON identity.instrument_attribute_assertion FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON identity.legal_entity FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON identity.legal_entity_alias FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON identity."position" FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER check_supersession BEFORE INSERT ON identity.instrument_attribute_assertion FOR EACH ROW EXECUTE FUNCTION ops.check_supersession('instrument_id,field_code', 'multi');

CREATE TRIGGER check_supersession BEFORE INSERT ON identity.legal_entity_alias FOR EACH ROW EXECUTE FUNCTION ops.check_supersession('legal_entity_id', 'multi');

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON obs.borrower_name_observation FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON obs.field_value_corroboration FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON obs.maturity_inspection FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON obs.maturity_inspection_candidate FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON obs.num_fact_observation FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON obs.observation_equivalence FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON obs.position_field_value FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON obs.position_observation FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON obs.position_observation_group FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON obs.position_observation_group_member FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON obs.position_observation_source FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON obs.soi_row_classification FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON obs.soi_row_observation FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON obs.borrower_name_observation FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON obs.field_value_corroboration FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON obs.maturity_inspection FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON obs.maturity_inspection_candidate FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON obs.num_fact_observation FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON obs.observation_equivalence FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON obs.position_field_value FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON obs.position_observation FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON obs.position_observation_group FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON obs.position_observation_group_member FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON obs.position_observation_source FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON obs.soi_row_classification FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON obs.soi_row_observation FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER check_borrower_name_observation BEFORE INSERT ON obs.borrower_name_observation FOR EACH ROW EXECUTE FUNCTION obs.check_borrower_name_observation();

CREATE TRIGGER check_borrower_name_successor BEFORE INSERT ON obs.borrower_name_observation FOR EACH ROW EXECUTE FUNCTION obs.check_borrower_name_successor();

CREATE TRIGGER check_fact_group_member_evidence BEFORE INSERT ON obs.position_observation_group_member FOR EACH ROW EXECUTE FUNCTION obs.check_fact_group_member_evidence();

CREATE TRIGGER check_field_value_corroboration BEFORE INSERT ON obs.field_value_corroboration FOR EACH ROW EXECUTE FUNCTION obs.check_field_value_corroboration();

CREATE TRIGGER check_group_member BEFORE INSERT ON obs.position_observation_group_member FOR EACH ROW EXECUTE FUNCTION obs.check_group_member();

CREATE TRIGGER check_maturity_inspection BEFORE INSERT ON obs.maturity_inspection FOR EACH ROW EXECUTE FUNCTION obs.check_maturity_inspection();

CREATE TRIGGER check_maturity_inspection_candidate BEFORE INSERT ON obs.maturity_inspection_candidate FOR EACH ROW EXECUTE FUNCTION obs.check_maturity_inspection_candidate();

CREATE TRIGGER check_num_fact_observation BEFORE INSERT ON obs.num_fact_observation FOR EACH ROW EXECUTE FUNCTION obs.check_num_fact_observation();

CREATE TRIGGER check_observation_equivalence BEFORE INSERT ON obs.observation_equivalence FOR EACH ROW EXECUTE FUNCTION obs.check_observation_equivalence();

CREATE TRIGGER check_position_field_value BEFORE INSERT ON obs.position_field_value FOR EACH ROW EXECUTE FUNCTION obs.check_position_field_value();

CREATE TRIGGER check_position_observation BEFORE INSERT ON obs.position_observation FOR EACH ROW EXECUTE FUNCTION obs.check_position_observation();

CREATE TRIGGER check_position_observation_source BEFORE INSERT ON obs.position_observation_source FOR EACH ROW EXECUTE FUNCTION obs.check_position_observation_source();

CREATE CONSTRAINT TRIGGER check_soi_fact_group_shape AFTER INSERT ON obs.position_observation_group DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION obs.check_soi_fact_group_shape();

CREATE TRIGGER check_soi_row_classification BEFORE INSERT ON obs.soi_row_classification FOR EACH ROW EXECUTE FUNCTION obs.check_soi_row_classification();

CREATE TRIGGER check_soi_row_observation BEFORE INSERT ON obs.soi_row_observation FOR EACH ROW EXECUTE FUNCTION obs.check_soi_row_observation();

CREATE TRIGGER check_supersession BEFORE INSERT ON obs.borrower_name_observation FOR EACH ROW EXECUTE FUNCTION ops.check_supersession('position_observation_id,evidence_id,name_source,source_column_label,source_column_position', 'single_chain');

CREATE TRIGGER check_supersession BEFORE INSERT ON obs.maturity_inspection FOR EACH ROW EXECUTE FUNCTION ops.check_supersession('position_observation_id', 'single_chain');

CREATE TRIGGER check_supersession BEFORE INSERT ON obs.position_field_value FOR EACH ROW EXECUTE FUNCTION ops.check_supersession('position_observation_id,field_code,source_column_label', 'single_chain');

CREATE TRIGGER check_supersession BEFORE INSERT ON obs.position_observation_group FOR EACH ROW EXECUTE FUNCTION ops.check_supersession('filing_id', 'multi');

CREATE TRIGGER check_supersession BEFORE INSERT ON obs.soi_row_classification FOR EACH ROW EXECUTE FUNCTION ops.check_supersession('soi_row_observation_id', 'single_chain');

CREATE CONSTRAINT TRIGGER require_group_member AFTER INSERT ON obs.position_observation_group DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION obs.require_group_member();

CREATE CONSTRAINT TRIGGER require_position_observation_source AFTER INSERT ON obs.position_observation DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION obs.require_position_observation_source();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON ops.artifact_processing FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON ops.audit_event FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON ops.coverage_assertion FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON ops.projection_exception FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON ops.rule_activation FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON ops.rule_version FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON ops.run FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON ops.run_outcome FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON ops.run_rule_version FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON ops.schema_migration FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON ops.artifact_processing FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON ops.audit_event FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON ops.coverage_assertion FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON ops.projection_exception FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON ops.rule_activation FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON ops.rule_version FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON ops.run FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON ops.run_outcome FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON ops.run_rule_version FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON ops.schema_migration FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER check_projection_exception BEFORE INSERT ON ops.projection_exception FOR EACH ROW EXECUTE FUNCTION ops.check_projection_exception();

CREATE TRIGGER check_supersession BEFORE INSERT ON ops.coverage_assertion FOR EACH ROW EXECUTE FUNCTION ops.check_supersession('registrant_id,dataset_release_id,reporting_period_end,source_type_code,coverage_aspect', 'single_chain');

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON raw.artifact FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON raw.artifact_lineage FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON raw.artifact_member FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON raw.json_document FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON raw."json_value" FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON raw.table_load FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON raw.tabular_row FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON raw.artifact FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON raw.artifact_lineage FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON raw.artifact_member FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON raw.json_document FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON raw."json_value" FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON raw.table_load FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON raw.tabular_row FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER check_artifact_lineage BEFORE INSERT ON raw.artifact_lineage FOR EACH ROW EXECUTE FUNCTION raw.check_artifact_lineage();

CREATE TRIGGER check_json_document BEFORE INSERT ON raw.json_document FOR EACH ROW EXECUTE FUNCTION raw.check_json_document();

CREATE TRIGGER check_json_value BEFORE INSERT ON raw."json_value" FOR EACH ROW EXECUTE FUNCTION raw.check_json_value();

CREATE TRIGGER check_table_load_header BEFORE INSERT ON raw.table_load FOR EACH ROW EXECUTE FUNCTION raw.check_table_load_header();

CREATE TRIGGER check_tabular_row BEFORE INSERT ON raw.tabular_row FOR EACH ROW EXECUTE FUNCTION raw.check_tabular_row();

CREATE TRIGGER flatten_json_document AFTER INSERT ON raw.json_document FOR EACH ROW EXECUTE FUNCTION raw.flatten_json_document();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON ref.coverage_aspect FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON ref.dataset_table FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON ref.field_definition FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON ref.filing_attribute FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON ref.registrant_attribute FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON ref.registry_field_mapping FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON ref.source_column_mapping FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON ref.source_type FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON ref.coverage_aspect FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON ref.dataset_table FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON ref.field_definition FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON ref.filing_attribute FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON ref.registrant_attribute FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON ref.registry_field_mapping FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON ref.source_column_mapping FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON ref.source_type FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER check_supersession BEFORE INSERT ON ref.source_column_mapping FOR EACH ROW EXECUTE FUNCTION ops.check_supersession('source_table_code,column_label,field_code', 'single_chain');

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON registry.bdc_report_edition FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON registry.dataset_release FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON registry.dataset_release_artifact FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON registry.dataset_release_listing FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON registry.filing FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON registry.filing_attribute_observation FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON registry.filing_document FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON registry.filing_document_artifact FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON registry.filing_registrant_link FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON registry.filing_relationship_decision FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON registry.registrant FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON registry.registrant_attribute_observation FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON registry.registrant_name_history_observation FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON registry.bdc_report_edition FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON registry.dataset_release FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON registry.dataset_release_artifact FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON registry.dataset_release_listing FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON registry.filing FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON registry.filing_attribute_observation FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON registry.filing_document FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON registry.filing_document_artifact FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON registry.filing_registrant_link FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON registry.filing_relationship_decision FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON registry.registrant FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON registry.registrant_attribute_observation FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON registry.registrant_name_history_observation FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER check_bdc_report_edition BEFORE INSERT ON registry.bdc_report_edition FOR EACH ROW EXECUTE FUNCTION registry.check_bdc_report_edition();

CREATE TRIGGER check_dataset_release BEFORE INSERT ON registry.dataset_release FOR EACH ROW EXECUTE FUNCTION registry.check_dataset_release();

CREATE TRIGGER check_dataset_release_listing BEFORE INSERT ON registry.dataset_release_listing FOR EACH ROW EXECUTE FUNCTION registry.check_dataset_release_listing();

CREATE TRIGGER check_filing_document BEFORE INSERT ON registry.filing_document FOR EACH ROW EXECUTE FUNCTION registry.check_filing_document();

CREATE TRIGGER check_filing_registrant_link BEFORE INSERT ON registry.filing_registrant_link FOR EACH ROW EXECUTE FUNCTION registry.check_filing_registrant_link();

CREATE TRIGGER check_located_value BEFORE INSERT ON registry.filing FOR EACH ROW EXECUTE FUNCTION registry.check_located_value('accession_number', 'exact');

CREATE TRIGGER check_located_value BEFORE INSERT ON registry.filing_attribute_observation FOR EACH ROW EXECUTE FUNCTION registry.check_located_value('raw_value', 'exact');

CREATE TRIGGER check_located_value BEFORE INSERT ON registry.registrant FOR EACH ROW EXECUTE FUNCTION registry.check_located_value('cik', 'cik');

CREATE TRIGGER check_located_value BEFORE INSERT ON registry.registrant_attribute_observation FOR EACH ROW EXECUTE FUNCTION registry.check_located_value('raw_value', 'exact');

CREATE TRIGGER check_located_value BEFORE INSERT ON registry.registrant_name_history_observation FOR EACH ROW EXECUTE FUNCTION registry.check_located_value('name_raw', 'exact');

CREATE TRIGGER check_name_history_siblings BEFORE INSERT ON registry.registrant_name_history_observation FOR EACH ROW EXECUTE FUNCTION registry.check_name_history_siblings();

CREATE TRIGGER check_supersession BEFORE INSERT ON registry.filing_attribute_observation FOR EACH ROW EXECUTE FUNCTION ops.check_supersession('filing_id,attribute_code', 'multi');

CREATE TRIGGER check_supersession BEFORE INSERT ON registry.filing_registrant_link FOR EACH ROW EXECUTE FUNCTION ops.check_supersession('filing_id', 'multi');

CREATE TRIGGER check_supersession BEFORE INSERT ON registry.filing_relationship_decision FOR EACH ROW EXECUTE FUNCTION ops.check_supersession('filing_id,relationship_type', 'single_chain');

CREATE TRIGGER check_supersession BEFORE INSERT ON registry.registrant_attribute_observation FOR EACH ROW EXECUTE FUNCTION ops.check_supersession('registrant_id,attribute_code', 'multi');

CREATE TRIGGER check_supersession BEFORE INSERT ON registry.registrant_name_history_observation FOR EACH ROW EXECUTE FUNCTION ops.check_supersession('registrant_id', 'multi');

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON resolution.entity_resolution_decision FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON resolution.group_membership_decision FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON resolution.instrument_resolution_decision FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON resolution.match_candidate FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON resolution.match_candidate_comparison FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON resolution.position_continuity_decision FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON resolution.entity_resolution_decision FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON resolution.group_membership_decision FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON resolution.instrument_resolution_decision FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON resolution.match_candidate FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON resolution.match_candidate_comparison FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON resolution.position_continuity_decision FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER check_position_continuity BEFORE INSERT ON resolution.position_continuity_decision FOR EACH ROW EXECUTE FUNCTION resolution.check_position_continuity();

CREATE TRIGGER check_supersession BEFORE INSERT ON resolution.entity_resolution_decision FOR EACH ROW EXECUTE FUNCTION ops.check_supersession('borrower_name_observation_id', 'single_chain');

CREATE TRIGGER check_supersession BEFORE INSERT ON resolution.group_membership_decision FOR EACH ROW EXECUTE FUNCTION ops.check_supersession('legal_entity_id,economic_group_id', 'single_chain');

CREATE TRIGGER check_supersession BEFORE INSERT ON resolution.instrument_resolution_decision FOR EACH ROW EXECUTE FUNCTION ops.check_supersession('position_observation_id,position_observation_group_id', 'single_chain');

CREATE TRIGGER check_supersession BEFORE INSERT ON resolution.position_continuity_decision FOR EACH ROW EXECUTE FUNCTION ops.check_supersession('position_observation_id', 'single_chain');

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON review.candidate FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON review.candidate_member FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON review.candidate_status FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON review.evidence_item FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON review.evidence_set FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON review.evidence_set_member FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON review.researcher_note FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON review.candidate FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON review.candidate_member FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON review.candidate_status FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON review.evidence_item FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON review.evidence_set FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON review.evidence_set_member FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON review.researcher_note FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER check_candidate_member BEFORE INSERT ON review.candidate_member FOR EACH ROW EXECUTE FUNCTION review.check_candidate_member();

CREATE TRIGGER check_candidate_status BEFORE INSERT ON review.candidate_status FOR EACH ROW EXECUTE FUNCTION review.check_candidate_status();

CREATE TRIGGER check_evidence_item BEFORE INSERT ON review.evidence_item FOR EACH ROW EXECUTE FUNCTION review.check_evidence_item();

CREATE TRIGGER check_evidence_set_member BEFORE INSERT ON review.evidence_set_member FOR EACH ROW EXECUTE FUNCTION review.check_evidence_set_member();

CREATE TRIGGER check_researcher_note BEFORE INSERT ON review.researcher_note FOR EACH ROW EXECUTE FUNCTION review.check_researcher_note();

CREATE TRIGGER check_supersession BEFORE INSERT ON review.candidate_status FOR EACH ROW EXECUTE FUNCTION ops.check_supersession('candidate_id', 'single_chain');

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON validation.evidence_status_assertion FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_row BEFORE DELETE OR UPDATE ON validation.validation_result FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON validation.evidence_status_assertion FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON validation.validation_result FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

CREATE TRIGGER check_evidence_status_assertion BEFORE INSERT ON validation.evidence_status_assertion FOR EACH ROW EXECUTE FUNCTION validation.check_evidence_status_assertion();

CREATE TRIGGER check_supersession BEFORE INSERT ON validation.evidence_status_assertion FOR EACH ROW EXECUTE FUNCTION ops.check_supersession('field_value_id', 'single_chain');

CREATE TRIGGER check_validation_subject BEFORE INSERT ON validation.validation_result FOR EACH ROW EXECUTE FUNCTION validation.check_validation_subject();

ALTER TABLE ONLY derived.derived_value_input
    ADD CONSTRAINT derived_value_input_derived_value_id_fkey FOREIGN KEY (derived_value_id) REFERENCES derived.derived_value(id);

ALTER TABLE ONLY derived.derived_value_input
    ADD CONSTRAINT derived_value_input_field_value_id_fkey FOREIGN KEY (field_value_id) REFERENCES obs.position_field_value(id);

ALTER TABLE ONLY derived.derived_value_input
    ADD CONSTRAINT derived_value_input_input_derived_value_id_fkey FOREIGN KEY (input_derived_value_id) REFERENCES derived.derived_value(id);

ALTER TABLE ONLY derived.derived_value_input
    ADD CONSTRAINT derived_value_input_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY derived.derived_value
    ADD CONSTRAINT derived_value_metric_rule_version_id_fkey FOREIGN KEY (metric_rule_version_id) REFERENCES ops.rule_version(id);

ALTER TABLE ONLY derived.derived_value
    ADD CONSTRAINT derived_value_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY derived.observation_event
    ADD CONSTRAINT observation_event_evidence_id_fkey FOREIGN KEY (evidence_id) REFERENCES evidence.evidence(id);

ALTER TABLE ONLY derived.observation_event
    ADD CONSTRAINT observation_event_position_observation_id_fkey FOREIGN KEY (position_observation_id) REFERENCES obs.position_observation(id);

ALTER TABLE ONLY derived.observation_event
    ADD CONSTRAINT observation_event_rule_version_id_fkey FOREIGN KEY (rule_version_id) REFERENCES ops.rule_version(id);

ALTER TABLE ONLY derived.observation_event
    ADD CONSTRAINT observation_event_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY evidence.evidence
    ADD CONSTRAINT evidence_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES raw.artifact(id);

ALTER TABLE ONLY evidence.evidence
    ADD CONSTRAINT evidence_artifact_member_fkey FOREIGN KEY (artifact_member_id, artifact_id) REFERENCES raw.artifact_member(id, artifact_id);

ALTER TABLE ONLY evidence.evidence
    ADD CONSTRAINT evidence_block_evidence_fkey FOREIGN KEY (block_evidence_id) REFERENCES evidence.evidence(id);

ALTER TABLE ONLY evidence.evidence
    ADD CONSTRAINT evidence_heading_evidence_fkey FOREIGN KEY (heading_evidence_id) REFERENCES evidence.evidence(id);

ALTER TABLE ONLY evidence.evidence
    ADD CONSTRAINT evidence_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY evidence.evidence
    ADD CONSTRAINT evidence_tabular_row_id_fkey FOREIGN KEY (tabular_row_id) REFERENCES raw.tabular_row(id);

ALTER TABLE ONLY evidence.html_column_heading
    ADD CONSTRAINT html_column_heading_evidence_id_fkey FOREIGN KEY (evidence_id) REFERENCES evidence.evidence(id);

ALTER TABLE ONLY evidence.html_column_heading
    ADD CONSTRAINT html_column_heading_stack_above_evidence_id_fkey FOREIGN KEY (stack_above_evidence_id) REFERENCES evidence.evidence(id);

ALTER TABLE ONLY evidence.supplementary_evidence
    ADD CONSTRAINT supplementary_evidence_evidence_id_fkey FOREIGN KEY (evidence_id) REFERENCES evidence.evidence(id);

ALTER TABLE ONLY evidence.supplementary_evidence
    ADD CONSTRAINT supplementary_evidence_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY identity.economic_group
    ADD CONSTRAINT economic_group_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY identity.instrument_attribute_assertion
    ADD CONSTRAINT instrument_attribute_assertion_evidence_id_fkey FOREIGN KEY (evidence_id) REFERENCES evidence.evidence(id);

ALTER TABLE ONLY identity.instrument_attribute_assertion
    ADD CONSTRAINT instrument_attribute_assertion_field_code_fkey FOREIGN KEY (field_code) REFERENCES ref.field_definition(field_code);

ALTER TABLE ONLY identity.instrument_attribute_assertion
    ADD CONSTRAINT instrument_attribute_assertion_instrument_id_fkey FOREIGN KEY (instrument_id) REFERENCES identity.instrument(id);

ALTER TABLE ONLY identity.instrument_attribute_assertion
    ADD CONSTRAINT instrument_attribute_assertion_rule_version_id_fkey FOREIGN KEY (rule_version_id) REFERENCES ops.rule_version(id);

ALTER TABLE ONLY identity.instrument_attribute_assertion
    ADD CONSTRAINT instrument_attribute_assertion_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY identity.instrument_attribute_assertion
    ADD CONSTRAINT instrument_attribute_assertion_supersedes_id_fkey FOREIGN KEY (supersedes_id) REFERENCES identity.instrument_attribute_assertion(id);

ALTER TABLE ONLY identity.instrument
    ADD CONSTRAINT instrument_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY identity.legal_entity_alias
    ADD CONSTRAINT legal_entity_alias_evidence_id_fkey FOREIGN KEY (evidence_id) REFERENCES evidence.evidence(id);

ALTER TABLE ONLY identity.legal_entity_alias
    ADD CONSTRAINT legal_entity_alias_legal_entity_id_fkey FOREIGN KEY (legal_entity_id) REFERENCES identity.legal_entity(id);

ALTER TABLE ONLY identity.legal_entity_alias
    ADD CONSTRAINT legal_entity_alias_rule_version_id_fkey FOREIGN KEY (rule_version_id) REFERENCES ops.rule_version(id);

ALTER TABLE ONLY identity.legal_entity_alias
    ADD CONSTRAINT legal_entity_alias_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY identity.legal_entity_alias
    ADD CONSTRAINT legal_entity_alias_supersedes_id_fkey FOREIGN KEY (supersedes_id) REFERENCES identity.legal_entity_alias(id);

ALTER TABLE ONLY identity.legal_entity
    ADD CONSTRAINT legal_entity_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY identity."position"
    ADD CONSTRAINT position_registrant_id_fkey FOREIGN KEY (registrant_id) REFERENCES registry.registrant(id);

ALTER TABLE ONLY identity."position"
    ADD CONSTRAINT position_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY obs.borrower_name_observation
    ADD CONSTRAINT borrower_name_observation_evidence_id_fkey FOREIGN KEY (evidence_id) REFERENCES evidence.evidence(id);

ALTER TABLE ONLY obs.borrower_name_observation
    ADD CONSTRAINT borrower_name_observation_position_observation_id_fkey FOREIGN KEY (position_observation_id) REFERENCES obs.position_observation(id);

ALTER TABLE ONLY obs.borrower_name_observation
    ADD CONSTRAINT borrower_name_observation_rule_version_id_fkey FOREIGN KEY (rule_version_id) REFERENCES ops.rule_version(id);

ALTER TABLE ONLY obs.borrower_name_observation
    ADD CONSTRAINT borrower_name_observation_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY obs.borrower_name_observation
    ADD CONSTRAINT borrower_name_observation_supersedes_id_fkey FOREIGN KEY (supersedes_id) REFERENCES obs.borrower_name_observation(id);

ALTER TABLE ONLY obs.field_value_corroboration
    ADD CONSTRAINT field_value_corroboration_field_value_id_fkey FOREIGN KEY (field_value_id) REFERENCES obs.position_field_value(id);

ALTER TABLE ONLY obs.field_value_corroboration
    ADD CONSTRAINT field_value_corroboration_num_fact_observation_id_fkey FOREIGN KEY (num_fact_observation_id) REFERENCES obs.num_fact_observation(id);

ALTER TABLE ONLY obs.field_value_corroboration
    ADD CONSTRAINT field_value_corroboration_rule_version_id_fkey FOREIGN KEY (rule_version_id) REFERENCES ops.rule_version(id);

ALTER TABLE ONLY obs.field_value_corroboration
    ADD CONSTRAINT field_value_corroboration_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY obs.maturity_inspection_candidate
    ADD CONSTRAINT maturity_inspection_candidate_evidence_id_fkey FOREIGN KEY (evidence_id) REFERENCES evidence.evidence(id);

ALTER TABLE ONLY obs.maturity_inspection_candidate
    ADD CONSTRAINT maturity_inspection_candidate_maturity_inspection_id_fkey FOREIGN KEY (maturity_inspection_id) REFERENCES obs.maturity_inspection(id);

ALTER TABLE ONLY obs.maturity_inspection_candidate
    ADD CONSTRAINT maturity_inspection_candidate_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY obs.maturity_inspection
    ADD CONSTRAINT maturity_inspection_evidence_id_fkey FOREIGN KEY (evidence_id) REFERENCES evidence.evidence(id);

ALTER TABLE ONLY obs.maturity_inspection
    ADD CONSTRAINT maturity_inspection_position_observation_id_fkey FOREIGN KEY (position_observation_id) REFERENCES obs.position_observation(id);

ALTER TABLE ONLY obs.maturity_inspection
    ADD CONSTRAINT maturity_inspection_rule_version_id_fkey FOREIGN KEY (rule_version_id) REFERENCES ops.rule_version(id);

ALTER TABLE ONLY obs.maturity_inspection
    ADD CONSTRAINT maturity_inspection_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY obs.maturity_inspection
    ADD CONSTRAINT maturity_inspection_soi_row_observation_id_fkey FOREIGN KEY (soi_row_observation_id) REFERENCES obs.soi_row_observation(id);

ALTER TABLE ONLY obs.maturity_inspection
    ADD CONSTRAINT maturity_inspection_supersedes_id_fkey FOREIGN KEY (supersedes_id) REFERENCES obs.maturity_inspection(id);

ALTER TABLE ONLY obs.num_fact_observation
    ADD CONSTRAINT num_fact_observation_evidence_id_fkey FOREIGN KEY (evidence_id) REFERENCES evidence.evidence(id);

ALTER TABLE ONLY obs.num_fact_observation
    ADD CONSTRAINT num_fact_observation_filing_id_fkey FOREIGN KEY (filing_id) REFERENCES registry.filing(id);

ALTER TABLE ONLY obs.num_fact_observation
    ADD CONSTRAINT num_fact_observation_rule_version_id_fkey FOREIGN KEY (rule_version_id) REFERENCES ops.rule_version(id);

ALTER TABLE ONLY obs.num_fact_observation
    ADD CONSTRAINT num_fact_observation_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY obs.num_fact_observation
    ADD CONSTRAINT num_fact_observation_tabular_row_id_fkey FOREIGN KEY (tabular_row_id) REFERENCES raw.tabular_row(id);

ALTER TABLE ONLY obs.observation_equivalence
    ADD CONSTRAINT observation_equivalence_equivalent_tabular_row_id_fkey FOREIGN KEY (equivalent_tabular_row_id) REFERENCES raw.tabular_row(id);

ALTER TABLE ONLY obs.observation_equivalence
    ADD CONSTRAINT observation_equivalence_rule_version_id_fkey FOREIGN KEY (rule_version_id) REFERENCES ops.rule_version(id);

ALTER TABLE ONLY obs.observation_equivalence
    ADD CONSTRAINT observation_equivalence_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY obs.observation_equivalence
    ADD CONSTRAINT observation_equivalence_tabular_row_id_fkey FOREIGN KEY (tabular_row_id) REFERENCES raw.tabular_row(id);

ALTER TABLE ONLY obs.position_field_value
    ADD CONSTRAINT position_field_value_column_mapping_id_fkey FOREIGN KEY (column_mapping_id) REFERENCES ref.source_column_mapping(id);

ALTER TABLE ONLY obs.position_field_value
    ADD CONSTRAINT position_field_value_evidence_id_fkey FOREIGN KEY (evidence_id) REFERENCES evidence.evidence(id);

ALTER TABLE ONLY obs.position_field_value
    ADD CONSTRAINT position_field_value_field_code_fkey FOREIGN KEY (field_code) REFERENCES ref.field_definition(field_code);

ALTER TABLE ONLY obs.position_field_value
    ADD CONSTRAINT position_field_value_normalization_rule_version_id_fkey FOREIGN KEY (normalization_rule_version_id) REFERENCES ops.rule_version(id);

ALTER TABLE ONLY obs.position_field_value
    ADD CONSTRAINT position_field_value_position_observation_id_fkey FOREIGN KEY (position_observation_id) REFERENCES obs.position_observation(id);

ALTER TABLE ONLY obs.position_field_value
    ADD CONSTRAINT position_field_value_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY obs.position_field_value
    ADD CONSTRAINT position_field_value_supersedes_id_fkey FOREIGN KEY (supersedes_id) REFERENCES obs.position_field_value(id);

ALTER TABLE ONLY obs.position_observation
    ADD CONSTRAINT position_observation_evidence_id_fkey FOREIGN KEY (evidence_id) REFERENCES evidence.evidence(id);

ALTER TABLE ONLY obs.position_observation
    ADD CONSTRAINT position_observation_filing_id_fkey FOREIGN KEY (filing_id) REFERENCES registry.filing(id);

ALTER TABLE ONLY obs.position_observation_group
    ADD CONSTRAINT position_observation_group_filing_id_fkey FOREIGN KEY (filing_id) REFERENCES registry.filing(id);

ALTER TABLE ONLY obs.position_observation_group_member
    ADD CONSTRAINT position_observation_group_member_evidence_id_fkey FOREIGN KEY (evidence_id) REFERENCES evidence.evidence(id);

ALTER TABLE ONLY obs.position_observation_group_member
    ADD CONSTRAINT position_observation_group_member_group_id_fkey FOREIGN KEY (group_id) REFERENCES obs.position_observation_group(id);

ALTER TABLE ONLY obs.position_observation_group_member
    ADD CONSTRAINT position_observation_group_member_position_observation_id_fkey FOREIGN KEY (position_observation_id) REFERENCES obs.position_observation(id);

ALTER TABLE ONLY obs.position_observation_group_member
    ADD CONSTRAINT position_observation_group_member_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY obs.position_observation_group
    ADD CONSTRAINT position_observation_group_rule_version_id_fkey FOREIGN KEY (rule_version_id) REFERENCES ops.rule_version(id);

ALTER TABLE ONLY obs.position_observation_group
    ADD CONSTRAINT position_observation_group_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY obs.position_observation_group
    ADD CONSTRAINT position_observation_group_supersedes_id_fkey FOREIGN KEY (supersedes_id) REFERENCES obs.position_observation_group(id);

ALTER TABLE ONLY obs.position_observation
    ADD CONSTRAINT position_observation_origin_soi_row_observation_id_fkey FOREIGN KEY (origin_soi_row_observation_id) REFERENCES obs.soi_row_observation(id);

ALTER TABLE ONLY obs.position_observation
    ADD CONSTRAINT position_observation_rule_version_id_fkey FOREIGN KEY (rule_version_id) REFERENCES ops.rule_version(id);

ALTER TABLE ONLY obs.position_observation
    ADD CONSTRAINT position_observation_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY obs.position_observation_source
    ADD CONSTRAINT position_observation_source_position_observation_id_fkey FOREIGN KEY (position_observation_id) REFERENCES obs.position_observation(id);

ALTER TABLE ONLY obs.position_observation_source
    ADD CONSTRAINT position_observation_source_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY obs.position_observation_source
    ADD CONSTRAINT position_observation_source_soi_row_observation_id_fkey FOREIGN KEY (soi_row_observation_id) REFERENCES obs.soi_row_observation(id);

ALTER TABLE ONLY obs.soi_row_classification
    ADD CONSTRAINT soi_row_classification_evidence_id_fkey FOREIGN KEY (evidence_id) REFERENCES evidence.evidence(id);

ALTER TABLE ONLY obs.soi_row_classification
    ADD CONSTRAINT soi_row_classification_rule_version_id_fkey FOREIGN KEY (rule_version_id) REFERENCES ops.rule_version(id);

ALTER TABLE ONLY obs.soi_row_classification
    ADD CONSTRAINT soi_row_classification_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY obs.soi_row_classification
    ADD CONSTRAINT soi_row_classification_soi_row_observation_id_fkey FOREIGN KEY (soi_row_observation_id) REFERENCES obs.soi_row_observation(id);

ALTER TABLE ONLY obs.soi_row_classification
    ADD CONSTRAINT soi_row_classification_supersedes_id_fkey FOREIGN KEY (supersedes_id) REFERENCES obs.soi_row_classification(id);

ALTER TABLE ONLY obs.soi_row_observation
    ADD CONSTRAINT soi_row_observation_evidence_id_fkey FOREIGN KEY (evidence_id) REFERENCES evidence.evidence(id);

ALTER TABLE ONLY obs.soi_row_observation
    ADD CONSTRAINT soi_row_observation_filing_id_fkey FOREIGN KEY (filing_id) REFERENCES registry.filing(id);

ALTER TABLE ONLY obs.soi_row_observation
    ADD CONSTRAINT soi_row_observation_rule_version_id_fkey FOREIGN KEY (rule_version_id) REFERENCES ops.rule_version(id);

ALTER TABLE ONLY obs.soi_row_observation
    ADD CONSTRAINT soi_row_observation_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY obs.soi_row_observation
    ADD CONSTRAINT soi_row_observation_tabular_row_id_fkey FOREIGN KEY (tabular_row_id) REFERENCES raw.tabular_row(id);

ALTER TABLE ONLY ops.artifact_processing
    ADD CONSTRAINT artifact_processing_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES raw.artifact(id);

ALTER TABLE ONLY ops.artifact_processing
    ADD CONSTRAINT artifact_processing_rule_version_id_fkey FOREIGN KEY (rule_version_id) REFERENCES ops.rule_version(id);

ALTER TABLE ONLY ops.artifact_processing
    ADD CONSTRAINT artifact_processing_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY ops.coverage_assertion
    ADD CONSTRAINT coverage_assertion_coverage_aspect_fkey FOREIGN KEY (coverage_aspect) REFERENCES ref.coverage_aspect(code);

ALTER TABLE ONLY ops.coverage_assertion
    ADD CONSTRAINT coverage_assertion_dataset_release_id_fkey FOREIGN KEY (dataset_release_id) REFERENCES registry.dataset_release(id);

ALTER TABLE ONLY ops.coverage_assertion
    ADD CONSTRAINT coverage_assertion_evidence_id_fkey FOREIGN KEY (evidence_id) REFERENCES evidence.evidence(id);

ALTER TABLE ONLY ops.coverage_assertion
    ADD CONSTRAINT coverage_assertion_registrant_id_fkey FOREIGN KEY (registrant_id) REFERENCES registry.registrant(id);

ALTER TABLE ONLY ops.coverage_assertion
    ADD CONSTRAINT coverage_assertion_rule_version_id_fkey FOREIGN KEY (rule_version_id) REFERENCES ops.rule_version(id);

ALTER TABLE ONLY ops.coverage_assertion
    ADD CONSTRAINT coverage_assertion_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY ops.coverage_assertion
    ADD CONSTRAINT coverage_assertion_source_type_code_fkey FOREIGN KEY (source_type_code) REFERENCES ref.source_type(code);

ALTER TABLE ONLY ops.coverage_assertion
    ADD CONSTRAINT coverage_assertion_supersedes_id_fkey FOREIGN KEY (supersedes_id) REFERENCES ops.coverage_assertion(id);

ALTER TABLE ONLY ops.projection_exception
    ADD CONSTRAINT projection_exception_evidence_id_fkey FOREIGN KEY (evidence_id) REFERENCES evidence.evidence(id);

ALTER TABLE ONLY ops.projection_exception
    ADD CONSTRAINT projection_exception_rule_version_id_fkey FOREIGN KEY (rule_version_id) REFERENCES ops.rule_version(id);

ALTER TABLE ONLY ops.projection_exception
    ADD CONSTRAINT projection_exception_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY ops.projection_exception
    ADD CONSTRAINT projection_exception_table_load_id_fkey FOREIGN KEY (table_load_id) REFERENCES raw.table_load(id);

ALTER TABLE ONLY ops.projection_exception
    ADD CONSTRAINT projection_exception_tabular_row_id_fkey FOREIGN KEY (tabular_row_id) REFERENCES raw.tabular_row(id);

ALTER TABLE ONLY ops.rule_activation
    ADD CONSTRAINT rule_activation_rule_version_id_fkey FOREIGN KEY (rule_version_id) REFERENCES ops.rule_version(id);

ALTER TABLE ONLY ops.run_outcome
    ADD CONSTRAINT run_outcome_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY ops.run_rule_version
    ADD CONSTRAINT run_rule_version_rule_version_id_fkey FOREIGN KEY (rule_version_id) REFERENCES ops.rule_version(id);

ALTER TABLE ONLY ops.run_rule_version
    ADD CONSTRAINT run_rule_version_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY raw.artifact_lineage
    ADD CONSTRAINT artifact_lineage_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES raw.artifact(id);

ALTER TABLE ONLY raw.artifact_lineage
    ADD CONSTRAINT artifact_lineage_previous_artifact_id_fkey FOREIGN KEY (previous_artifact_id) REFERENCES raw.artifact(id);

ALTER TABLE ONLY raw.artifact_lineage
    ADD CONSTRAINT artifact_lineage_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY raw.artifact_member
    ADD CONSTRAINT artifact_member_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES raw.artifact(id);

ALTER TABLE ONLY raw.artifact_member
    ADD CONSTRAINT artifact_member_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY raw.artifact
    ADD CONSTRAINT artifact_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY raw.artifact
    ADD CONSTRAINT artifact_source_type_code_fkey FOREIGN KEY (source_type_code) REFERENCES ref.source_type(code);

ALTER TABLE ONLY raw.json_document
    ADD CONSTRAINT json_document_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES raw.artifact(id);

ALTER TABLE ONLY raw.json_document
    ADD CONSTRAINT json_document_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY raw."json_value"
    ADD CONSTRAINT json_value_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES raw.artifact(id);

ALTER TABLE ONLY raw."json_value"
    ADD CONSTRAINT json_value_json_document_id_fkey FOREIGN KEY (json_document_id) REFERENCES raw.json_document(id);

ALTER TABLE ONLY raw."json_value"
    ADD CONSTRAINT json_value_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY raw.table_load
    ADD CONSTRAINT table_load_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES raw.artifact(id);

ALTER TABLE ONLY raw.table_load
    ADD CONSTRAINT table_load_artifact_member_id_artifact_id_fkey FOREIGN KEY (artifact_member_id, artifact_id) REFERENCES raw.artifact_member(id, artifact_id);

ALTER TABLE ONLY raw.table_load
    ADD CONSTRAINT table_load_parser_rule_version_id_fkey FOREIGN KEY (parser_rule_version_id) REFERENCES ops.rule_version(id);

ALTER TABLE ONLY raw.table_load
    ADD CONSTRAINT table_load_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY raw.table_load
    ADD CONSTRAINT table_load_table_code_fkey FOREIGN KEY (table_code) REFERENCES ref.dataset_table(code);

ALTER TABLE ONLY raw.tabular_row
    ADD CONSTRAINT tabular_row_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY raw.tabular_row
    ADD CONSTRAINT tabular_row_table_load_id_fkey FOREIGN KEY (table_load_id) REFERENCES raw.table_load(id);

ALTER TABLE ONLY ref.registry_field_mapping
    ADD CONSTRAINT registry_field_mapping_source_type_code_fkey FOREIGN KEY (source_type_code) REFERENCES ref.source_type(code);

ALTER TABLE ONLY ref.source_column_mapping
    ADD CONSTRAINT source_column_mapping_field_code_fkey FOREIGN KEY (field_code) REFERENCES ref.field_definition(field_code);

ALTER TABLE ONLY ref.source_column_mapping
    ADD CONSTRAINT source_column_mapping_rule_version_id_fkey FOREIGN KEY (rule_version_id) REFERENCES ops.rule_version(id);

ALTER TABLE ONLY ref.source_column_mapping
    ADD CONSTRAINT source_column_mapping_source_table_code_fkey FOREIGN KEY (source_table_code) REFERENCES ref.dataset_table(code);

ALTER TABLE ONLY ref.source_column_mapping
    ADD CONSTRAINT source_column_mapping_supersedes_id_fkey FOREIGN KEY (supersedes_id) REFERENCES ref.source_column_mapping(id);

ALTER TABLE ONLY registry.bdc_report_edition
    ADD CONSTRAINT bdc_report_edition_evidence_id_fkey FOREIGN KEY (evidence_id) REFERENCES evidence.evidence(id);

ALTER TABLE ONLY registry.bdc_report_edition
    ADD CONSTRAINT bdc_report_edition_page_artifact_id_fkey FOREIGN KEY (page_artifact_id) REFERENCES raw.artifact(id);

ALTER TABLE ONLY registry.bdc_report_edition
    ADD CONSTRAINT bdc_report_edition_rule_version_id_fkey FOREIGN KEY (rule_version_id) REFERENCES ops.rule_version(id);

ALTER TABLE ONLY registry.bdc_report_edition
    ADD CONSTRAINT bdc_report_edition_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY registry.dataset_release_artifact
    ADD CONSTRAINT dataset_release_artifact_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES raw.artifact(id);

ALTER TABLE ONLY registry.dataset_release_artifact
    ADD CONSTRAINT dataset_release_artifact_dataset_release_id_fkey FOREIGN KEY (dataset_release_id) REFERENCES registry.dataset_release(id);

ALTER TABLE ONLY registry.dataset_release_artifact
    ADD CONSTRAINT dataset_release_artifact_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY registry.dataset_release
    ADD CONSTRAINT dataset_release_evidence_id_fkey FOREIGN KEY (evidence_id) REFERENCES evidence.evidence(id);

ALTER TABLE ONLY registry.dataset_release_listing
    ADD CONSTRAINT dataset_release_listing_dataset_release_id_fkey FOREIGN KEY (dataset_release_id) REFERENCES registry.dataset_release(id);

ALTER TABLE ONLY registry.dataset_release_listing
    ADD CONSTRAINT dataset_release_listing_evidence_id_fkey FOREIGN KEY (evidence_id) REFERENCES evidence.evidence(id);

ALTER TABLE ONLY registry.dataset_release_listing
    ADD CONSTRAINT dataset_release_listing_page_artifact_id_fkey FOREIGN KEY (page_artifact_id) REFERENCES raw.artifact(id);

ALTER TABLE ONLY registry.dataset_release_listing
    ADD CONSTRAINT dataset_release_listing_rule_version_id_fkey FOREIGN KEY (rule_version_id) REFERENCES ops.rule_version(id);

ALTER TABLE ONLY registry.dataset_release_listing
    ADD CONSTRAINT dataset_release_listing_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY registry.dataset_release
    ADD CONSTRAINT dataset_release_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY registry.filing_attribute_observation
    ADD CONSTRAINT filing_attribute_observation_attribute_code_fkey FOREIGN KEY (attribute_code) REFERENCES ref.filing_attribute(code);

ALTER TABLE ONLY registry.filing_attribute_observation
    ADD CONSTRAINT filing_attribute_observation_evidence_id_fkey FOREIGN KEY (evidence_id) REFERENCES evidence.evidence(id);

ALTER TABLE ONLY registry.filing_attribute_observation
    ADD CONSTRAINT filing_attribute_observation_filing_id_fkey FOREIGN KEY (filing_id) REFERENCES registry.filing(id);

ALTER TABLE ONLY registry.filing_attribute_observation
    ADD CONSTRAINT filing_attribute_observation_rule_version_id_fkey FOREIGN KEY (rule_version_id) REFERENCES ops.rule_version(id);

ALTER TABLE ONLY registry.filing_attribute_observation
    ADD CONSTRAINT filing_attribute_observation_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY registry.filing_attribute_observation
    ADD CONSTRAINT filing_attribute_observation_supersedes_id_fkey FOREIGN KEY (supersedes_id) REFERENCES registry.filing_attribute_observation(id);

ALTER TABLE ONLY registry.filing_document_artifact
    ADD CONSTRAINT filing_document_artifact_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES raw.artifact(id);

ALTER TABLE ONLY registry.filing_document_artifact
    ADD CONSTRAINT filing_document_artifact_filing_document_id_fkey FOREIGN KEY (filing_document_id) REFERENCES registry.filing_document(id);

ALTER TABLE ONLY registry.filing_document_artifact
    ADD CONSTRAINT filing_document_artifact_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY registry.filing_document
    ADD CONSTRAINT filing_document_evidence_id_fkey FOREIGN KEY (evidence_id) REFERENCES evidence.evidence(id);

ALTER TABLE ONLY registry.filing_document
    ADD CONSTRAINT filing_document_filing_id_fkey FOREIGN KEY (filing_id) REFERENCES registry.filing(id);

ALTER TABLE ONLY registry.filing_document
    ADD CONSTRAINT filing_document_rule_version_id_fkey FOREIGN KEY (rule_version_id) REFERENCES ops.rule_version(id);

ALTER TABLE ONLY registry.filing_document
    ADD CONSTRAINT filing_document_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY registry.filing
    ADD CONSTRAINT filing_evidence_id_fkey FOREIGN KEY (evidence_id) REFERENCES evidence.evidence(id);

ALTER TABLE ONLY registry.filing_registrant_link
    ADD CONSTRAINT filing_registrant_link_evidence_id_fkey FOREIGN KEY (evidence_id) REFERENCES evidence.evidence(id);

ALTER TABLE ONLY registry.filing_registrant_link
    ADD CONSTRAINT filing_registrant_link_filing_id_fkey FOREIGN KEY (filing_id) REFERENCES registry.filing(id);

ALTER TABLE ONLY registry.filing_registrant_link
    ADD CONSTRAINT filing_registrant_link_registrant_id_fkey FOREIGN KEY (registrant_id) REFERENCES registry.registrant(id);

ALTER TABLE ONLY registry.filing_registrant_link
    ADD CONSTRAINT filing_registrant_link_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY registry.filing_registrant_link
    ADD CONSTRAINT filing_registrant_link_supersedes_id_fkey FOREIGN KEY (supersedes_id) REFERENCES registry.filing_registrant_link(id);

ALTER TABLE ONLY registry.filing_relationship_decision
    ADD CONSTRAINT filing_relationship_decision_evidence_id_fkey FOREIGN KEY (evidence_id) REFERENCES evidence.evidence(id);

ALTER TABLE ONLY registry.filing_relationship_decision
    ADD CONSTRAINT filing_relationship_decision_filing_id_fkey FOREIGN KEY (filing_id) REFERENCES registry.filing(id);

ALTER TABLE ONLY registry.filing_relationship_decision
    ADD CONSTRAINT filing_relationship_decision_related_filing_id_fkey FOREIGN KEY (related_filing_id) REFERENCES registry.filing(id);

ALTER TABLE ONLY registry.filing_relationship_decision
    ADD CONSTRAINT filing_relationship_decision_rule_version_id_fkey FOREIGN KEY (rule_version_id) REFERENCES ops.rule_version(id);

ALTER TABLE ONLY registry.filing_relationship_decision
    ADD CONSTRAINT filing_relationship_decision_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY registry.filing_relationship_decision
    ADD CONSTRAINT filing_relationship_decision_supersedes_id_fkey FOREIGN KEY (supersedes_id) REFERENCES registry.filing_relationship_decision(id);

ALTER TABLE ONLY registry.filing
    ADD CONSTRAINT filing_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY registry.registrant_attribute_observation
    ADD CONSTRAINT registrant_attribute_observation_attribute_code_fkey FOREIGN KEY (attribute_code) REFERENCES ref.registrant_attribute(code);

ALTER TABLE ONLY registry.registrant_attribute_observation
    ADD CONSTRAINT registrant_attribute_observation_evidence_id_fkey FOREIGN KEY (evidence_id) REFERENCES evidence.evidence(id);

ALTER TABLE ONLY registry.registrant_attribute_observation
    ADD CONSTRAINT registrant_attribute_observation_registrant_id_fkey FOREIGN KEY (registrant_id) REFERENCES registry.registrant(id);

ALTER TABLE ONLY registry.registrant_attribute_observation
    ADD CONSTRAINT registrant_attribute_observation_rule_version_id_fkey FOREIGN KEY (rule_version_id) REFERENCES ops.rule_version(id);

ALTER TABLE ONLY registry.registrant_attribute_observation
    ADD CONSTRAINT registrant_attribute_observation_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY registry.registrant_attribute_observation
    ADD CONSTRAINT registrant_attribute_observation_supersedes_id_fkey FOREIGN KEY (supersedes_id) REFERENCES registry.registrant_attribute_observation(id);

ALTER TABLE ONLY registry.registrant
    ADD CONSTRAINT registrant_evidence_id_fkey FOREIGN KEY (evidence_id) REFERENCES evidence.evidence(id);

ALTER TABLE ONLY registry.registrant_name_history_observation
    ADD CONSTRAINT registrant_name_history_observation_evidence_id_fkey FOREIGN KEY (evidence_id) REFERENCES evidence.evidence(id);

ALTER TABLE ONLY registry.registrant_name_history_observation
    ADD CONSTRAINT registrant_name_history_observation_registrant_id_fkey FOREIGN KEY (registrant_id) REFERENCES registry.registrant(id);

ALTER TABLE ONLY registry.registrant_name_history_observation
    ADD CONSTRAINT registrant_name_history_observation_rule_version_id_fkey FOREIGN KEY (rule_version_id) REFERENCES ops.rule_version(id);

ALTER TABLE ONLY registry.registrant_name_history_observation
    ADD CONSTRAINT registrant_name_history_observation_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY registry.registrant_name_history_observation
    ADD CONSTRAINT registrant_name_history_observation_supersedes_id_fkey FOREIGN KEY (supersedes_id) REFERENCES registry.registrant_name_history_observation(id);

ALTER TABLE ONLY registry.registrant
    ADD CONSTRAINT registrant_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY resolution.entity_resolution_decision
    ADD CONSTRAINT entity_resolution_decision_borrower_name_observation_id_fkey FOREIGN KEY (borrower_name_observation_id) REFERENCES obs.borrower_name_observation(id);

ALTER TABLE ONLY resolution.entity_resolution_decision
    ADD CONSTRAINT entity_resolution_decision_evidence_id_fkey FOREIGN KEY (evidence_id) REFERENCES evidence.evidence(id);

ALTER TABLE ONLY resolution.entity_resolution_decision
    ADD CONSTRAINT entity_resolution_decision_legal_entity_id_fkey FOREIGN KEY (legal_entity_id) REFERENCES identity.legal_entity(id);

ALTER TABLE ONLY resolution.entity_resolution_decision
    ADD CONSTRAINT entity_resolution_decision_match_candidate_id_fkey FOREIGN KEY (match_candidate_id) REFERENCES resolution.match_candidate(id);

ALTER TABLE ONLY resolution.entity_resolution_decision
    ADD CONSTRAINT entity_resolution_decision_rule_version_id_fkey FOREIGN KEY (rule_version_id) REFERENCES ops.rule_version(id);

ALTER TABLE ONLY resolution.entity_resolution_decision
    ADD CONSTRAINT entity_resolution_decision_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY resolution.entity_resolution_decision
    ADD CONSTRAINT entity_resolution_decision_supersedes_id_fkey FOREIGN KEY (supersedes_id) REFERENCES resolution.entity_resolution_decision(id);

ALTER TABLE ONLY resolution.group_membership_decision
    ADD CONSTRAINT group_membership_decision_economic_group_id_fkey FOREIGN KEY (economic_group_id) REFERENCES identity.economic_group(id);

ALTER TABLE ONLY resolution.group_membership_decision
    ADD CONSTRAINT group_membership_decision_evidence_id_fkey FOREIGN KEY (evidence_id) REFERENCES evidence.evidence(id);

ALTER TABLE ONLY resolution.group_membership_decision
    ADD CONSTRAINT group_membership_decision_legal_entity_id_fkey FOREIGN KEY (legal_entity_id) REFERENCES identity.legal_entity(id);

ALTER TABLE ONLY resolution.group_membership_decision
    ADD CONSTRAINT group_membership_decision_match_candidate_id_fkey FOREIGN KEY (match_candidate_id) REFERENCES resolution.match_candidate(id);

ALTER TABLE ONLY resolution.group_membership_decision
    ADD CONSTRAINT group_membership_decision_rule_version_id_fkey FOREIGN KEY (rule_version_id) REFERENCES ops.rule_version(id);

ALTER TABLE ONLY resolution.group_membership_decision
    ADD CONSTRAINT group_membership_decision_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY resolution.group_membership_decision
    ADD CONSTRAINT group_membership_decision_supersedes_id_fkey FOREIGN KEY (supersedes_id) REFERENCES resolution.group_membership_decision(id);

ALTER TABLE ONLY resolution.instrument_resolution_decision
    ADD CONSTRAINT instrument_resolution_decisio_position_observation_group_i_fkey FOREIGN KEY (position_observation_group_id) REFERENCES obs.position_observation_group(id);

ALTER TABLE ONLY resolution.instrument_resolution_decision
    ADD CONSTRAINT instrument_resolution_decision_evidence_id_fkey FOREIGN KEY (evidence_id) REFERENCES evidence.evidence(id);

ALTER TABLE ONLY resolution.instrument_resolution_decision
    ADD CONSTRAINT instrument_resolution_decision_instrument_id_fkey FOREIGN KEY (instrument_id) REFERENCES identity.instrument(id);

ALTER TABLE ONLY resolution.instrument_resolution_decision
    ADD CONSTRAINT instrument_resolution_decision_match_candidate_id_fkey FOREIGN KEY (match_candidate_id) REFERENCES resolution.match_candidate(id);

ALTER TABLE ONLY resolution.instrument_resolution_decision
    ADD CONSTRAINT instrument_resolution_decision_position_observation_id_fkey FOREIGN KEY (position_observation_id) REFERENCES obs.position_observation(id);

ALTER TABLE ONLY resolution.instrument_resolution_decision
    ADD CONSTRAINT instrument_resolution_decision_rule_version_id_fkey FOREIGN KEY (rule_version_id) REFERENCES ops.rule_version(id);

ALTER TABLE ONLY resolution.instrument_resolution_decision
    ADD CONSTRAINT instrument_resolution_decision_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY resolution.instrument_resolution_decision
    ADD CONSTRAINT instrument_resolution_decision_supersedes_id_fkey FOREIGN KEY (supersedes_id) REFERENCES resolution.instrument_resolution_decision(id);

ALTER TABLE ONLY resolution.match_candidate
    ADD CONSTRAINT match_candidate_borrower_name_observation_id_fkey FOREIGN KEY (borrower_name_observation_id) REFERENCES obs.borrower_name_observation(id);

ALTER TABLE ONLY resolution.match_candidate_comparison
    ADD CONSTRAINT match_candidate_comparison_left_evidence_id_fkey FOREIGN KEY (left_evidence_id) REFERENCES evidence.evidence(id);

ALTER TABLE ONLY resolution.match_candidate_comparison
    ADD CONSTRAINT match_candidate_comparison_match_candidate_id_fkey FOREIGN KEY (match_candidate_id) REFERENCES resolution.match_candidate(id);

ALTER TABLE ONLY resolution.match_candidate_comparison
    ADD CONSTRAINT match_candidate_comparison_right_evidence_id_fkey FOREIGN KEY (right_evidence_id) REFERENCES evidence.evidence(id);

ALTER TABLE ONLY resolution.match_candidate_comparison
    ADD CONSTRAINT match_candidate_comparison_rule_version_id_fkey FOREIGN KEY (rule_version_id) REFERENCES ops.rule_version(id);

ALTER TABLE ONLY resolution.match_candidate_comparison
    ADD CONSTRAINT match_candidate_comparison_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY resolution.match_candidate
    ADD CONSTRAINT match_candidate_economic_group_id_fkey FOREIGN KEY (economic_group_id) REFERENCES identity.economic_group(id);

ALTER TABLE ONLY resolution.match_candidate
    ADD CONSTRAINT match_candidate_instrument_id_fkey FOREIGN KEY (instrument_id) REFERENCES identity.instrument(id);

ALTER TABLE ONLY resolution.match_candidate
    ADD CONSTRAINT match_candidate_legal_entity_id_fkey FOREIGN KEY (legal_entity_id) REFERENCES identity.legal_entity(id);

ALTER TABLE ONLY resolution.match_candidate
    ADD CONSTRAINT match_candidate_position_id_fkey FOREIGN KEY (position_id) REFERENCES identity."position"(id);

ALTER TABLE ONLY resolution.match_candidate
    ADD CONSTRAINT match_candidate_position_observation_id_fkey FOREIGN KEY (position_observation_id) REFERENCES obs.position_observation(id);

ALTER TABLE ONLY resolution.match_candidate
    ADD CONSTRAINT match_candidate_rule_version_id_fkey FOREIGN KEY (rule_version_id) REFERENCES ops.rule_version(id);

ALTER TABLE ONLY resolution.match_candidate
    ADD CONSTRAINT match_candidate_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY resolution.position_continuity_decision
    ADD CONSTRAINT position_continuity_decision_evidence_id_fkey FOREIGN KEY (evidence_id) REFERENCES evidence.evidence(id);

ALTER TABLE ONLY resolution.position_continuity_decision
    ADD CONSTRAINT position_continuity_decision_match_candidate_id_fkey FOREIGN KEY (match_candidate_id) REFERENCES resolution.match_candidate(id);

ALTER TABLE ONLY resolution.position_continuity_decision
    ADD CONSTRAINT position_continuity_decision_position_id_fkey FOREIGN KEY (position_id) REFERENCES identity."position"(id);

ALTER TABLE ONLY resolution.position_continuity_decision
    ADD CONSTRAINT position_continuity_decision_position_observation_id_fkey FOREIGN KEY (position_observation_id) REFERENCES obs.position_observation(id);

ALTER TABLE ONLY resolution.position_continuity_decision
    ADD CONSTRAINT position_continuity_decision_rule_version_id_fkey FOREIGN KEY (rule_version_id) REFERENCES ops.rule_version(id);

ALTER TABLE ONLY resolution.position_continuity_decision
    ADD CONSTRAINT position_continuity_decision_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY resolution.position_continuity_decision
    ADD CONSTRAINT position_continuity_decision_supersedes_id_fkey FOREIGN KEY (supersedes_id) REFERENCES resolution.position_continuity_decision(id);

ALTER TABLE ONLY review.candidate_member
    ADD CONSTRAINT candidate_member_borrower_name_observation_id_fkey FOREIGN KEY (borrower_name_observation_id) REFERENCES obs.borrower_name_observation(id);

ALTER TABLE ONLY review.candidate_member
    ADD CONSTRAINT candidate_member_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES review.candidate(id);

ALTER TABLE ONLY review.candidate_member
    ADD CONSTRAINT candidate_member_position_observation_id_fkey FOREIGN KEY (position_observation_id) REFERENCES obs.position_observation(id);

ALTER TABLE ONLY review.candidate_status
    ADD CONSTRAINT candidate_status_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES review.candidate(id);

ALTER TABLE ONLY review.candidate_status
    ADD CONSTRAINT candidate_status_supersedes_id_fkey FOREIGN KEY (supersedes_id) REFERENCES review.candidate_status(id);

ALTER TABLE ONLY review.evidence_item
    ADD CONSTRAINT evidence_item_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES review.candidate(id);

ALTER TABLE ONLY review.evidence_item
    ADD CONSTRAINT evidence_item_evidence_id_fkey FOREIGN KEY (evidence_id) REFERENCES evidence.evidence(id);

ALTER TABLE ONLY review.evidence_item
    ADD CONSTRAINT evidence_item_filing_document_id_fkey FOREIGN KEY (filing_document_id) REFERENCES registry.filing_document(id);

ALTER TABLE ONLY review.evidence_item
    ADD CONSTRAINT evidence_item_position_observation_id_fkey FOREIGN KEY (position_observation_id) REFERENCES obs.position_observation(id);

ALTER TABLE ONLY review.evidence_set
    ADD CONSTRAINT evidence_set_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES review.candidate(id);

ALTER TABLE ONLY review.evidence_set_member
    ADD CONSTRAINT evidence_set_member_evidence_item_id_fkey FOREIGN KEY (evidence_item_id) REFERENCES review.evidence_item(id);

ALTER TABLE ONLY review.evidence_set_member
    ADD CONSTRAINT evidence_set_member_evidence_set_id_fkey FOREIGN KEY (evidence_set_id) REFERENCES review.evidence_set(id);

ALTER TABLE ONLY review.researcher_note
    ADD CONSTRAINT researcher_note_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES review.candidate(id);

ALTER TABLE ONLY review.researcher_note
    ADD CONSTRAINT researcher_note_evidence_item_id_fkey FOREIGN KEY (evidence_item_id) REFERENCES review.evidence_item(id);

ALTER TABLE ONLY validation.evidence_status_assertion
    ADD CONSTRAINT evidence_status_assertion_field_value_id_fkey FOREIGN KEY (field_value_id) REFERENCES obs.position_field_value(id);

ALTER TABLE ONLY validation.evidence_status_assertion
    ADD CONSTRAINT evidence_status_assertion_rule_version_id_fkey FOREIGN KEY (rule_version_id) REFERENCES ops.rule_version(id);

ALTER TABLE ONLY validation.evidence_status_assertion
    ADD CONSTRAINT evidence_status_assertion_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

ALTER TABLE ONLY validation.evidence_status_assertion
    ADD CONSTRAINT evidence_status_assertion_supersedes_id_fkey FOREIGN KEY (supersedes_id) REFERENCES validation.evidence_status_assertion(id);

ALTER TABLE ONLY validation.evidence_status_assertion
    ADD CONSTRAINT evidence_status_assertion_validation_result_id_fkey FOREIGN KEY (validation_result_id) REFERENCES validation.validation_result(id);

ALTER TABLE ONLY validation.validation_result
    ADD CONSTRAINT validation_result_evidence_id_fkey FOREIGN KEY (evidence_id) REFERENCES evidence.evidence(id);

ALTER TABLE ONLY validation.validation_result
    ADD CONSTRAINT validation_result_rule_version_id_fkey FOREIGN KEY (rule_version_id) REFERENCES ops.rule_version(id);

ALTER TABLE ONLY validation.validation_result
    ADD CONSTRAINT validation_result_run_id_fkey FOREIGN KEY (run_id) REFERENCES ops.run(id);

GRANT USAGE ON SCHEMA access TO access_reader;

GRANT USAGE ON SCHEMA admin TO admin_reader;

GRANT USAGE ON SCHEMA derived TO bdc_pipeline_writer;
GRANT USAGE ON SCHEMA derived TO bdc_reader;

GRANT USAGE ON SCHEMA evidence TO bdc_pipeline_writer;
GRANT USAGE ON SCHEMA evidence TO bdc_reader;

GRANT USAGE ON SCHEMA identity TO bdc_pipeline_writer;
GRANT USAGE ON SCHEMA identity TO bdc_reader;

GRANT USAGE ON SCHEMA obs TO bdc_pipeline_writer;
GRANT USAGE ON SCHEMA obs TO bdc_reader;

GRANT USAGE ON SCHEMA ops TO bdc_pipeline_writer;
GRANT USAGE ON SCHEMA ops TO bdc_reader;

GRANT USAGE ON SCHEMA raw TO bdc_pipeline_writer;
GRANT USAGE ON SCHEMA raw TO bdc_reader;

GRANT USAGE ON SCHEMA ref TO bdc_pipeline_writer;
GRANT USAGE ON SCHEMA ref TO bdc_reader;

GRANT USAGE ON SCHEMA registry TO bdc_pipeline_writer;
GRANT USAGE ON SCHEMA registry TO bdc_reader;

GRANT USAGE ON SCHEMA resolution TO bdc_pipeline_writer;
GRANT USAGE ON SCHEMA resolution TO bdc_reader;

GRANT USAGE ON SCHEMA review TO review_writer;
GRANT USAGE ON SCHEMA review TO bdc_reader;

GRANT USAGE ON SCHEMA validation TO bdc_pipeline_writer;
GRANT USAGE ON SCHEMA validation TO bdc_reader;

REVOKE ALL ON FUNCTION access.record_grant(p_user_id uuid, p_grant_kind access.grant_kind, p_action access.grant_action, p_source access.grant_source, p_reason text, p_actor_user_id uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION registry.bdc_portfolio_changes(p_cik text, p_reported_date date) FROM PUBLIC;
GRANT ALL ON FUNCTION registry.bdc_portfolio_changes(p_cik text, p_reported_date date) TO bdc_reader;

REVOKE ALL ON FUNCTION registry.bdc_portfolio_holdings(p_cik text, p_reported_date date, p_limit integer, p_offset integer) FROM PUBLIC;
GRANT ALL ON FUNCTION registry.bdc_portfolio_holdings(p_cik text, p_reported_date date, p_limit integer, p_offset integer) TO bdc_reader;

REVOKE ALL ON FUNCTION registry.bdc_portfolio_period_changes(p_cik text, p_earlier date, p_later date) FROM PUBLIC;
GRANT ALL ON FUNCTION registry.bdc_portfolio_period_changes(p_cik text, p_earlier date, p_later date) TO bdc_reader;

REVOKE ALL ON FUNCTION registry.bdc_portfolio_period_identity(p_cik text, p_reported_date date) FROM PUBLIC;
GRANT ALL ON FUNCTION registry.bdc_portfolio_period_identity(p_cik text, p_reported_date date) TO bdc_reader;

REVOKE ALL ON FUNCTION registry.bdc_portfolio_period_summary(p_cik text, p_earlier date, p_later date) FROM PUBLIC;
GRANT ALL ON FUNCTION registry.bdc_portfolio_period_summary(p_cik text, p_earlier date, p_later date) TO bdc_reader;

REVOKE ALL ON FUNCTION registry.bdc_portfolio_scope(p_cik text, p_reported_date date) FROM PUBLIC;
GRANT ALL ON FUNCTION registry.bdc_portfolio_scope(p_cik text, p_reported_date date) TO bdc_reader;

REVOKE ALL ON FUNCTION registry.bdc_portfolio_summary(p_cik text, p_reported_date date) FROM PUBLIC;
GRANT ALL ON FUNCTION registry.bdc_portfolio_summary(p_cik text, p_reported_date date) TO bdc_reader;

REVOKE ALL ON FUNCTION registry.borrower_maturity_observations(p_legal_entity_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION registry.borrower_maturity_observations(p_legal_entity_id uuid) TO bdc_reader;

REVOKE ALL ON FUNCTION registry.borrower_maturity_summary(p_legal_entity_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION registry.borrower_maturity_summary(p_legal_entity_id uuid) TO bdc_reader;

REVOKE ALL ON FUNCTION registry.borrower_maturity_years(p_legal_entity_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION registry.borrower_maturity_years(p_legal_entity_id uuid) TO bdc_reader;

REVOKE ALL ON FUNCTION registry.borrower_position_comparisons(p_legal_entity_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION registry.borrower_position_comparisons(p_legal_entity_id uuid) TO bdc_reader;

REVOKE ALL ON FUNCTION registry.borrower_position_observations(p_legal_entity_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION registry.borrower_position_observations(p_legal_entity_id uuid) TO bdc_reader;

REVOKE ALL ON FUNCTION registry.borrower_position_valuation(p_legal_entity_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION registry.borrower_position_valuation(p_legal_entity_id uuid) TO bdc_reader;

REVOKE ALL ON FUNCTION registry.borrower_refinancing_outcomes(p_legal_entity_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION registry.borrower_refinancing_outcomes(p_legal_entity_id uuid) TO bdc_reader;

REVOKE ALL ON FUNCTION registry.market_date_registrant(p_date date) FROM PUBLIC;
GRANT ALL ON FUNCTION registry.market_date_registrant(p_date date) TO bdc_reader;

REVOKE ALL ON FUNCTION registry.market_release_date(p_label text) FROM PUBLIC;
GRANT ALL ON FUNCTION registry.market_release_date(p_label text) TO bdc_reader;

REVOKE ALL ON FUNCTION registry.maturity_coverage(p_cik text) FROM PUBLIC;
GRANT ALL ON FUNCTION registry.maturity_coverage(p_cik text) TO bdc_reader;

REVOKE ALL ON FUNCTION registry.maturity_line_count(p_cik text, p_date date, p_kind text, p_year integer) FROM PUBLIC;
GRANT ALL ON FUNCTION registry.maturity_line_count(p_cik text, p_date date, p_kind text, p_year integer) TO bdc_reader;

REVOKE ALL ON FUNCTION registry.maturity_line_page(p_cik text, p_date date, p_kind text, p_year integer, p_limit integer, p_offset integer) FROM PUBLIC;
GRANT ALL ON FUNCTION registry.maturity_line_page(p_cik text, p_date date, p_kind text, p_year integer, p_limit integer, p_offset integer) TO bdc_reader;

REVOKE ALL ON FUNCTION registry.maturity_position_for_cik(p_cik text) FROM PUBLIC;

REVOKE ALL ON FUNCTION registry.maturity_years(p_cik text) FROM PUBLIC;
GRANT ALL ON FUNCTION registry.maturity_years(p_cik text) TO bdc_reader;

REVOKE ALL ON FUNCTION registry.portfolio_detail_dates(p_cik text) FROM PUBLIC;
GRANT ALL ON FUNCTION registry.portfolio_detail_dates(p_cik text) TO bdc_reader;

REVOKE ALL ON FUNCTION registry.portfolio_detail_filing(p_cik text) FROM PUBLIC;

REVOKE ALL ON FUNCTION registry.portfolio_detail_names(p_cik text) FROM PUBLIC;
GRANT ALL ON FUNCTION registry.portfolio_detail_names(p_cik text) TO bdc_reader;

REVOKE ALL ON FUNCTION registry.portfolio_detail_registrant(p_cik text) FROM PUBLIC;
GRANT ALL ON FUNCTION registry.portfolio_detail_registrant(p_cik text) TO bdc_reader;

REVOKE ALL ON FUNCTION registry.review_case_read(p_case_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION registry.review_case_read(p_case_key text) TO bdc_reader;

REVOKE ALL ON FUNCTION review.add_evidence_set(p_candidate_id bigint, p_title text, p_description text, p_created_by text) FROM PUBLIC;
GRANT ALL ON FUNCTION review.add_evidence_set(p_candidate_id bigint, p_title text, p_description text, p_created_by text) TO review_writer;

REVOKE ALL ON FUNCTION review.add_external_evidence(p_candidate_id bigint, p_source_type text, p_title text, p_source_url text, p_document_date date, p_relevant_excerpt text, p_position_observation_id bigint, p_created_by text) FROM PUBLIC;
GRANT ALL ON FUNCTION review.add_external_evidence(p_candidate_id bigint, p_source_type text, p_title text, p_source_url text, p_document_date date, p_relevant_excerpt text, p_position_observation_id bigint, p_created_by text) TO review_writer;

REVOKE ALL ON FUNCTION review.add_internal_evidence(p_candidate_id bigint, p_title text, p_position_observation_id bigint, p_filing_document_id bigint, p_evidence_id bigint, p_created_by text) FROM PUBLIC;
GRANT ALL ON FUNCTION review.add_internal_evidence(p_candidate_id bigint, p_title text, p_position_observation_id bigint, p_filing_document_id bigint, p_evidence_id bigint, p_created_by text) TO review_writer;

REVOKE ALL ON FUNCTION review.add_member(p_candidate_id bigint, p_position_observation_id bigint, p_borrower_name_observation_id bigint, p_created_by text) FROM PUBLIC;
GRANT ALL ON FUNCTION review.add_member(p_candidate_id bigint, p_position_observation_id bigint, p_borrower_name_observation_id bigint, p_created_by text) TO review_writer;

REVOKE ALL ON FUNCTION review.add_note(p_candidate_id bigint, p_evidence_item_id bigint, p_note_text text, p_created_by text) FROM PUBLIC;
GRANT ALL ON FUNCTION review.add_note(p_candidate_id bigint, p_evidence_item_id bigint, p_note_text text, p_created_by text) TO review_writer;

REVOKE ALL ON FUNCTION review.add_set_member(p_evidence_set_id bigint, p_evidence_item_id bigint, p_created_by text) FROM PUBLIC;
GRANT ALL ON FUNCTION review.add_set_member(p_evidence_set_id bigint, p_evidence_item_id bigint, p_created_by text) TO review_writer;

REVOKE ALL ON FUNCTION review.assert_writer() FROM PUBLIC;

REVOKE ALL ON FUNCTION review.open_candidate(p_case_key text, p_candidate_type text, p_source text, p_title text, p_created_by text) FROM PUBLIC;
GRANT ALL ON FUNCTION review.open_candidate(p_case_key text, p_candidate_type text, p_source text, p_title text, p_created_by text) TO review_writer;

REVOKE ALL ON FUNCTION review.set_candidate_status(p_candidate_id bigint, p_status text, p_reason text, p_created_by text) FROM PUBLIC;
GRANT ALL ON FUNCTION review.set_candidate_status(p_candidate_id bigint, p_status text, p_reason text, p_created_by text) TO review_writer;

GRANT SELECT ON TABLE access.current_access TO access_reader;

GRANT SELECT,INSERT ON TABLE raw.artifact TO bdc_pipeline_writer;

GRANT SELECT,INSERT ON TABLE registry.filing TO bdc_pipeline_writer;

GRANT SELECT,INSERT ON TABLE registry.filing_document TO bdc_pipeline_writer;

GRANT SELECT,INSERT ON TABLE registry.filing_document_artifact TO bdc_pipeline_writer;

GRANT SELECT ON TABLE admin.filing_artifact TO admin_reader;

GRANT SELECT,INSERT ON TABLE evidence.evidence TO bdc_pipeline_writer;

GRANT SELECT ON TABLE ref.registry_field_mapping TO bdc_pipeline_writer;

GRANT SELECT,INSERT ON TABLE registry.filing_attribute_observation TO bdc_pipeline_writer;

GRANT SELECT ON TABLE registry.current_filing_attribute TO bdc_pipeline_writer;
GRANT SELECT ON TABLE registry.current_filing_attribute TO bdc_reader;

GRANT SELECT ON TABLE admin.filing_attribute TO admin_reader;

GRANT SELECT ON TABLE admin.filing_document TO admin_reader;

GRANT SELECT,INSERT ON TABLE obs.num_fact_observation TO bdc_pipeline_writer;

GRANT SELECT,INSERT ON TABLE obs.position_observation TO bdc_pipeline_writer;

GRANT SELECT,INSERT ON TABLE obs.soi_row_observation TO bdc_pipeline_writer;

GRANT SELECT,INSERT ON TABLE ops.artifact_processing TO bdc_pipeline_writer;

GRANT SELECT ON TABLE ref.registrant_attribute TO bdc_pipeline_writer;

GRANT SELECT,INSERT ON TABLE registry.filing_registrant_link TO bdc_pipeline_writer;

GRANT SELECT,INSERT ON TABLE registry.registrant TO bdc_pipeline_writer;

GRANT SELECT ON TABLE registry.current_filing_registrant TO bdc_pipeline_writer;
GRANT SELECT ON TABLE registry.current_filing_registrant TO bdc_reader;

GRANT SELECT,INSERT ON TABLE registry.registrant_attribute_observation TO bdc_pipeline_writer;

GRANT SELECT ON TABLE registry.current_registrant_attribute TO bdc_pipeline_writer;
GRANT SELECT ON TABLE registry.current_registrant_attribute TO bdc_reader;

GRANT SELECT ON TABLE registry.registrant_attribute_status TO bdc_pipeline_writer;
GRANT SELECT ON TABLE registry.registrant_attribute_status TO bdc_reader;

GRANT SELECT ON TABLE admin.filing_inventory TO admin_reader;

GRANT SELECT,INSERT ON TABLE ops.run TO bdc_pipeline_writer;

GRANT SELECT,INSERT ON TABLE ops.run_outcome TO bdc_pipeline_writer;

GRANT SELECT ON TABLE ops.current_run_status TO bdc_pipeline_writer;
GRANT SELECT ON TABLE ops.current_run_status TO bdc_reader;

GRANT SELECT,INSERT ON TABLE ops.rule_version TO bdc_pipeline_writer;

GRANT SELECT ON TABLE admin.filing_processing TO admin_reader;

GRANT SELECT ON TABLE admin.filing_registrant TO admin_reader;

GRANT SELECT,INSERT ON TABLE derived.derived_value TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE derived.derived_value_id_seq TO bdc_pipeline_writer;

GRANT SELECT,INSERT ON TABLE derived.derived_value_input TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE derived.derived_value_input_id_seq TO bdc_pipeline_writer;

GRANT SELECT,INSERT ON TABLE derived.observation_event TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE derived.observation_event_id_seq TO bdc_pipeline_writer;

GRANT SELECT ON TABLE derived.observation_event_listing TO bdc_pipeline_writer;
GRANT SELECT ON TABLE derived.observation_event_listing TO bdc_reader;

GRANT USAGE ON SEQUENCE evidence.evidence_id_seq TO bdc_pipeline_writer;

GRANT SELECT,INSERT ON TABLE evidence.html_column_heading TO bdc_pipeline_writer;

GRANT SELECT,INSERT ON TABLE evidence.supplementary_evidence TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE evidence.supplementary_evidence_id_seq TO bdc_pipeline_writer;

GRANT SELECT,INSERT ON TABLE identity.economic_group TO bdc_pipeline_writer;

GRANT SELECT,INSERT ON TABLE identity.instrument TO bdc_pipeline_writer;

GRANT SELECT,INSERT ON TABLE identity.instrument_attribute_assertion TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE identity.instrument_attribute_assertion_id_seq TO bdc_pipeline_writer;

GRANT SELECT,INSERT ON TABLE identity.legal_entity TO bdc_pipeline_writer;

GRANT SELECT,INSERT ON TABLE identity.legal_entity_alias TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE identity.legal_entity_alias_id_seq TO bdc_pipeline_writer;

GRANT SELECT,INSERT ON TABLE identity."position" TO bdc_pipeline_writer;

GRANT SELECT,INSERT ON TABLE obs.borrower_name_observation TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE obs.borrower_name_observation_id_seq TO bdc_pipeline_writer;

GRANT SELECT ON TABLE obs.current_borrower_name_observation TO bdc_pipeline_writer;
GRANT SELECT ON TABLE obs.current_borrower_name_observation TO bdc_reader;

GRANT SELECT,INSERT ON TABLE obs.position_field_value TO bdc_pipeline_writer;

GRANT SELECT ON TABLE obs.current_position_field_value TO bdc_pipeline_writer;
GRANT SELECT ON TABLE obs.current_position_field_value TO bdc_reader;

GRANT SELECT ON TABLE obs.current_position_research_field TO bdc_pipeline_writer;
GRANT SELECT ON TABLE obs.current_position_research_field TO bdc_reader;

GRANT SELECT,INSERT ON TABLE ops.coverage_assertion TO bdc_pipeline_writer;

GRANT SELECT ON TABLE ops.current_coverage TO bdc_pipeline_writer;
GRANT SELECT ON TABLE ops.current_coverage TO bdc_reader;

GRANT SELECT ON TABLE obs.current_soi_coverage TO bdc_pipeline_writer;
GRANT SELECT ON TABLE obs.current_soi_coverage TO bdc_reader;

GRANT SELECT,INSERT ON TABLE obs.soi_row_classification TO bdc_pipeline_writer;

GRANT SELECT ON TABLE obs.current_soi_row_classification TO bdc_pipeline_writer;
GRANT SELECT ON TABLE obs.current_soi_row_classification TO bdc_reader;

GRANT SELECT ON TABLE ref.field_definition TO bdc_pipeline_writer;

GRANT SELECT,INSERT ON TABLE validation.evidence_status_assertion TO bdc_pipeline_writer;

GRANT SELECT ON TABLE validation.current_evidence_status TO bdc_pipeline_writer;
GRANT SELECT ON TABLE validation.current_evidence_status TO bdc_reader;

GRANT SELECT ON TABLE obs.field_value_authority TO bdc_pipeline_writer;
GRANT SELECT ON TABLE obs.field_value_authority TO bdc_reader;

GRANT SELECT,INSERT ON TABLE obs.field_value_corroboration TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE obs.field_value_corroboration_id_seq TO bdc_pipeline_writer;

GRANT SELECT,INSERT ON TABLE obs.maturity_inspection TO bdc_pipeline_writer;

GRANT SELECT,INSERT ON TABLE obs.maturity_inspection_candidate TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE obs.maturity_inspection_candidate_id_seq TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE obs.maturity_inspection_id_seq TO bdc_pipeline_writer;

GRANT SELECT ON TABLE obs.maturity_provenance TO bdc_pipeline_writer;
GRANT SELECT ON TABLE obs.maturity_provenance TO bdc_reader;

GRANT USAGE ON SEQUENCE obs.num_fact_observation_id_seq TO bdc_pipeline_writer;

GRANT SELECT,INSERT ON TABLE obs.observation_equivalence TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE obs.observation_equivalence_id_seq TO bdc_pipeline_writer;

GRANT SELECT ON TABLE obs.position_field_status TO bdc_pipeline_writer;
GRANT SELECT ON TABLE obs.position_field_status TO bdc_reader;

GRANT USAGE ON SEQUENCE obs.position_field_value_id_seq TO bdc_pipeline_writer;

GRANT SELECT,INSERT ON TABLE obs.position_observation_group TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE obs.position_observation_group_id_seq TO bdc_pipeline_writer;

GRANT SELECT,INSERT ON TABLE obs.position_observation_group_member TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE obs.position_observation_group_member_id_seq TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE obs.position_observation_id_seq TO bdc_pipeline_writer;

GRANT SELECT,INSERT ON TABLE obs.position_observation_source TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE obs.position_observation_source_id_seq TO bdc_pipeline_writer;

GRANT SELECT ON TABLE obs.soi_duplicate_key_groups TO bdc_pipeline_writer;
GRANT SELECT ON TABLE obs.soi_duplicate_key_groups TO bdc_reader;

GRANT SELECT,INSERT ON TABLE ops.projection_exception TO bdc_pipeline_writer;

GRANT SELECT,INSERT ON TABLE raw.artifact_member TO bdc_pipeline_writer;

GRANT SELECT,INSERT ON TABLE raw.table_load TO bdc_pipeline_writer;

GRANT SELECT,INSERT ON TABLE raw.tabular_row TO bdc_pipeline_writer;

GRANT SELECT ON TABLE obs.soi_load_reconciliation TO bdc_pipeline_writer;
GRANT SELECT ON TABLE obs.soi_load_reconciliation TO bdc_reader;

GRANT USAGE ON SEQUENCE obs.soi_row_classification_id_seq TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE obs.soi_row_observation_id_seq TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE ops.artifact_processing_id_seq TO bdc_pipeline_writer;

GRANT SELECT,INSERT ON TABLE ops.audit_event TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE ops.audit_event_id_seq TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE ops.coverage_assertion_id_seq TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE ops.projection_exception_id_seq TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE ops.rule_activation_id_seq TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE ops.rule_version_id_seq TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE ops.run_id_seq TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE ops.run_outcome_id_seq TO bdc_pipeline_writer;

GRANT SELECT,INSERT ON TABLE ops.run_rule_version TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE ops.run_rule_version_id_seq TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE raw.artifact_id_seq TO bdc_pipeline_writer;

GRANT SELECT,INSERT ON TABLE raw.artifact_lineage TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE raw.artifact_lineage_id_seq TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE raw.artifact_member_id_seq TO bdc_pipeline_writer;

GRANT SELECT,INSERT ON TABLE raw.json_document TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE raw.json_document_id_seq TO bdc_pipeline_writer;

GRANT SELECT,INSERT ON TABLE raw."json_value" TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE raw.json_value_id_seq TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE raw.table_load_id_seq TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE raw.tabular_row_id_seq TO bdc_pipeline_writer;

GRANT SELECT ON TABLE ref.coverage_aspect TO bdc_pipeline_writer;

GRANT SELECT ON TABLE ref.source_column_mapping TO bdc_pipeline_writer;

GRANT SELECT ON TABLE ref.current_column_mapping TO bdc_pipeline_writer;
GRANT SELECT ON TABLE ref.current_column_mapping TO bdc_reader;

GRANT SELECT ON TABLE ref.dataset_table TO bdc_pipeline_writer;

GRANT SELECT ON TABLE ref.filing_attribute TO bdc_pipeline_writer;

GRANT SELECT ON TABLE ref.source_type TO bdc_pipeline_writer;

GRANT SELECT,INSERT ON TABLE registry.bdc_report_edition TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE registry.bdc_report_edition_id_seq TO bdc_pipeline_writer;

GRANT SELECT ON TABLE registry.bdc_report_edition_status TO bdc_pipeline_writer;
GRANT SELECT ON TABLE registry.bdc_report_edition_status TO bdc_reader;

GRANT SELECT,INSERT ON TABLE registry.registrant_name_history_observation TO bdc_pipeline_writer;

GRANT SELECT ON TABLE registry.current_registrant_name_history TO bdc_pipeline_writer;
GRANT SELECT ON TABLE registry.current_registrant_name_history TO bdc_reader;

GRANT SELECT,INSERT ON TABLE resolution.entity_resolution_decision TO bdc_pipeline_writer;

GRANT SELECT ON TABLE resolution.current_entity_resolution TO bdc_pipeline_writer;
GRANT SELECT ON TABLE resolution.current_entity_resolution TO bdc_reader;

GRANT SELECT,INSERT ON TABLE resolution.instrument_resolution_decision TO bdc_pipeline_writer;

GRANT SELECT ON TABLE resolution.current_instrument_resolution TO bdc_pipeline_writer;
GRANT SELECT ON TABLE resolution.current_instrument_resolution TO bdc_reader;

GRANT SELECT,INSERT ON TABLE validation.validation_result TO bdc_pipeline_writer;

GRANT SELECT ON TABLE registry.borrower_observation_listing TO bdc_pipeline_writer;
GRANT SELECT ON TABLE registry.borrower_observation_listing TO bdc_reader;

GRANT SELECT,INSERT ON TABLE registry.filing_relationship_decision TO bdc_pipeline_writer;

GRANT SELECT ON TABLE registry.current_filing_relationship TO bdc_pipeline_writer;
GRANT SELECT ON TABLE registry.current_filing_relationship TO bdc_reader;

GRANT SELECT,INSERT ON TABLE registry.dataset_release TO bdc_pipeline_writer;

GRANT SELECT,INSERT ON TABLE registry.dataset_release_artifact TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE registry.dataset_release_artifact_id_seq TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE registry.dataset_release_id_seq TO bdc_pipeline_writer;

GRANT SELECT,INSERT ON TABLE registry.dataset_release_listing TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE registry.dataset_release_listing_id_seq TO bdc_pipeline_writer;

GRANT SELECT ON TABLE registry.dataset_release_status TO bdc_pipeline_writer;
GRANT SELECT ON TABLE registry.dataset_release_status TO bdc_reader;

GRANT USAGE ON SEQUENCE registry.filing_attribute_observation_id_seq TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE registry.filing_document_artifact_id_seq TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE registry.filing_document_id_seq TO bdc_pipeline_writer;

GRANT SELECT ON TABLE registry.filing_file_number TO bdc_pipeline_writer;
GRANT SELECT ON TABLE registry.filing_file_number TO bdc_reader;

GRANT SELECT ON TABLE registry.filing_history TO bdc_pipeline_writer;
GRANT SELECT ON TABLE registry.filing_history TO bdc_reader;

GRANT USAGE ON SEQUENCE registry.filing_id_seq TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE registry.filing_registrant_link_id_seq TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE registry.filing_relationship_decision_id_seq TO bdc_pipeline_writer;

GRANT SELECT ON TABLE registry.portfolio_filing_registrant TO bdc_pipeline_writer;
GRANT SELECT ON TABLE registry.portfolio_filing_registrant TO bdc_reader;

GRANT SELECT ON TABLE registry.market_registrant_coverage TO bdc_pipeline_writer;
GRANT SELECT ON TABLE registry.market_registrant_coverage TO bdc_reader;

GRANT SELECT ON TABLE registry.market_release_coverage TO bdc_pipeline_writer;
GRANT SELECT ON TABLE registry.market_release_coverage TO bdc_reader;

GRANT SELECT ON TABLE registry.market_reported_date TO bdc_pipeline_writer;
GRANT SELECT ON TABLE registry.market_reported_date TO bdc_reader;

GRANT SELECT ON TABLE registry.matched_entity_position TO bdc_pipeline_writer;
GRANT SELECT ON TABLE registry.matched_entity_position TO bdc_reader;

GRANT SELECT ON TABLE registry.maturity_read TO bdc_pipeline_writer;
GRANT SELECT ON TABLE registry.maturity_read TO bdc_reader;

GRANT SELECT ON TABLE registry.maturity_position TO bdc_pipeline_writer;
GRANT SELECT ON TABLE registry.maturity_position TO bdc_reader;

GRANT SELECT ON TABLE registry.portfolio_line TO bdc_pipeline_writer;
GRANT SELECT ON TABLE registry.portfolio_line TO bdc_reader;

GRANT SELECT ON TABLE registry.maturity_line TO bdc_pipeline_writer;
GRANT SELECT ON TABLE registry.maturity_line TO bdc_reader;

GRANT SELECT ON TABLE registry.maturity_reported_date TO bdc_pipeline_writer;
GRANT SELECT ON TABLE registry.maturity_reported_date TO bdc_reader;

GRANT SELECT ON TABLE registry.maturity_year TO bdc_pipeline_writer;
GRANT SELECT ON TABLE registry.maturity_year TO bdc_reader;

GRANT SELECT ON TABLE registry.portfolio_empty_period TO bdc_pipeline_writer;
GRANT SELECT ON TABLE registry.portfolio_empty_period TO bdc_reader;

GRANT SELECT ON TABLE registry.portfolio_registrant TO bdc_pipeline_writer;
GRANT SELECT ON TABLE registry.portfolio_registrant TO bdc_reader;

GRANT SELECT ON TABLE registry.portfolio_registrant_name TO bdc_pipeline_writer;
GRANT SELECT ON TABLE registry.portfolio_registrant_name TO bdc_reader;

GRANT SELECT ON TABLE registry.portfolio_reported_date TO bdc_pipeline_writer;
GRANT SELECT ON TABLE registry.portfolio_reported_date TO bdc_reader;

GRANT SELECT,INSERT ON TABLE resolution.group_membership_decision TO bdc_pipeline_writer;

GRANT SELECT ON TABLE resolution.current_group_membership TO bdc_pipeline_writer;
GRANT SELECT ON TABLE resolution.current_group_membership TO bdc_reader;

GRANT SELECT,INSERT ON TABLE resolution.position_continuity_decision TO bdc_pipeline_writer;

GRANT SELECT ON TABLE resolution.current_position_continuity TO bdc_pipeline_writer;
GRANT SELECT ON TABLE resolution.current_position_continuity TO bdc_reader;

GRANT SELECT ON TABLE registry.position_read TO bdc_pipeline_writer;
GRANT SELECT ON TABLE registry.position_read TO bdc_reader;

GRANT SELECT ON TABLE registry.position_period_comparison TO bdc_pipeline_writer;
GRANT SELECT ON TABLE registry.position_period_comparison TO bdc_reader;

GRANT USAGE ON SEQUENCE registry.registrant_attribute_observation_id_seq TO bdc_pipeline_writer;

GRANT SELECT ON TABLE registry.registrant_coverage TO bdc_pipeline_writer;
GRANT SELECT ON TABLE registry.registrant_coverage TO bdc_reader;

GRANT USAGE ON SEQUENCE registry.registrant_id_seq TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE registry.registrant_name_history_observation_id_seq TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE resolution.entity_resolution_decision_id_seq TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE resolution.group_membership_decision_id_seq TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE resolution.instrument_resolution_decision_id_seq TO bdc_pipeline_writer;

GRANT SELECT,INSERT ON TABLE resolution.match_candidate TO bdc_pipeline_writer;

GRANT SELECT,INSERT ON TABLE resolution.match_candidate_comparison TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE resolution.match_candidate_comparison_id_seq TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE resolution.match_candidate_id_seq TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE resolution.position_continuity_decision_id_seq TO bdc_pipeline_writer;

GRANT INSERT ON TABLE review.candidate TO review_writer;

GRANT USAGE ON SEQUENCE review.candidate_id_seq TO review_writer;

GRANT INSERT ON TABLE review.candidate_member TO review_writer;

GRANT USAGE ON SEQUENCE review.candidate_member_id_seq TO review_writer;

GRANT SELECT ON TABLE review.candidate_member_read TO bdc_reader;
GRANT SELECT ON TABLE review.candidate_member_read TO review_writer;

GRANT INSERT ON TABLE review.candidate_status TO review_writer;

GRANT USAGE ON SEQUENCE review.candidate_status_id_seq TO review_writer;

GRANT SELECT ON TABLE review.current_candidate TO bdc_reader;
GRANT SELECT ON TABLE review.current_candidate TO review_writer;

GRANT INSERT ON TABLE review.evidence_item TO review_writer;

GRANT USAGE ON SEQUENCE review.evidence_item_id_seq TO review_writer;

GRANT SELECT ON TABLE review.evidence_item_read TO bdc_reader;
GRANT SELECT ON TABLE review.evidence_item_read TO review_writer;

GRANT INSERT ON TABLE review.evidence_set TO review_writer;

GRANT USAGE ON SEQUENCE review.evidence_set_id_seq TO review_writer;

GRANT INSERT ON TABLE review.evidence_set_member TO review_writer;

GRANT USAGE ON SEQUENCE review.evidence_set_member_id_seq TO review_writer;

GRANT SELECT ON TABLE review.evidence_set_member_read TO bdc_reader;
GRANT SELECT ON TABLE review.evidence_set_member_read TO review_writer;

GRANT SELECT ON TABLE review.evidence_set_read TO bdc_reader;
GRANT SELECT ON TABLE review.evidence_set_read TO review_writer;

GRANT INSERT ON TABLE review.researcher_note TO review_writer;

GRANT USAGE ON SEQUENCE review.researcher_note_id_seq TO review_writer;

GRANT SELECT ON TABLE review.researcher_note_read TO bdc_reader;
GRANT SELECT ON TABLE review.researcher_note_read TO review_writer;

GRANT USAGE ON SEQUENCE validation.evidence_status_assertion_id_seq TO bdc_pipeline_writer;

GRANT USAGE ON SEQUENCE validation.validation_result_id_seq TO bdc_pipeline_writer;
