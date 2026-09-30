-- 0005 evidence: where inside a source artifact each fact is supported (G-01, G-12).
-- Every material row carries a NOT NULL evidence_id (its primary source). Additional
-- corroborating or contradicting evidence is linked through evidence.supplementary_evidence.

CREATE TABLE evidence.evidence (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  evidence_level   ref.evidence_level NOT NULL,
  artifact_id      bigint NOT NULL REFERENCES raw.artifact (id),
  locator_type     ref.locator_type NOT NULL,
  tabular_row_id   bigint REFERENCES raw.tabular_row (id),
  column_position  integer CHECK (column_position >= 1),
  column_label     text,
  json_path        text CHECK (json_path ~ '^\$'),
  ixbrl_fact_id    text,
  html_anchor      text,
  join_note        text,
  run_id           bigint NOT NULL REFERENCES ops.run (id),
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evidence_locator_fields CHECK (
    CASE locator_type
      WHEN 'TSV_ROW' THEN tabular_row_id IS NOT NULL
        AND num_nonnulls(column_position, column_label, json_path, ixbrl_fact_id, html_anchor) = 0
      WHEN 'TSV_CELL' THEN tabular_row_id IS NOT NULL AND column_position IS NOT NULL AND column_label IS NOT NULL
        AND num_nonnulls(json_path, ixbrl_fact_id, html_anchor) = 0
      WHEN 'JSON_PATH' THEN json_path IS NOT NULL
        AND num_nonnulls(tabular_row_id, column_position, column_label, ixbrl_fact_id, html_anchor) = 0
      WHEN 'IXBRL_FACT' THEN ixbrl_fact_id IS NOT NULL
        AND num_nonnulls(tabular_row_id, column_position, column_label, json_path, html_anchor) = 0
      WHEN 'HTML_ANCHOR' THEN html_anchor IS NOT NULL
        AND num_nonnulls(tabular_row_id, column_position, column_label, json_path, ixbrl_fact_id) = 0
      WHEN 'DOCUMENT' THEN
        num_nonnulls(tabular_row_id, column_position, column_label, json_path, ixbrl_fact_id, html_anchor) = 0
    END),
  CONSTRAINT evidence_level_locator CHECK (
    CASE evidence_level
      WHEN 'L1_STRUCTURED_DATASET' THEN locator_type IN ('TSV_ROW', 'TSV_CELL')
      WHEN 'L2_ORIGINAL_FILING' THEN locator_type IN ('IXBRL_FACT', 'HTML_ANCHOR', 'DOCUMENT')
      WHEN 'REGISTRY' THEN locator_type IN ('TSV_ROW', 'TSV_CELL', 'JSON_PATH', 'DOCUMENT')
      WHEN 'DISCOVERY' THEN locator_type IN ('JSON_PATH', 'DOCUMENT')
    END)
);
COMMENT ON TABLE evidence.evidence IS 'A location inside a source artifact. Retrieval time and checksum come from raw.artifact.';
COMMENT ON COLUMN evidence.evidence.join_note IS 'Set when the fact depends on a join that SEC does not document (for example SOI to NUM).';

CREATE FUNCTION evidence.check_evidence() RETURNS trigger
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
  RETURN NEW;
END
$$;

CREATE TRIGGER check_evidence BEFORE INSERT ON evidence.evidence
  FOR EACH ROW EXECUTE FUNCTION evidence.check_evidence();

CREATE TABLE evidence.supplementary_evidence (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject_table  text NOT NULL CHECK (subject_table ~ '^(registry|obs|resolution|validation|derived)\.[a-z_]+$'),
  subject_id     bigint NOT NULL,
  evidence_id    bigint NOT NULL REFERENCES evidence.evidence (id),
  role           ref.evidence_role NOT NULL,
  note           text,
  run_id         bigint NOT NULL REFERENCES ops.run (id),
  recorded_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject_table, subject_id, evidence_id, role)
);

CREATE FUNCTION evidence.check_supplementary_subject() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ops.assert_subject_exists(NEW.subject_table, NEW.subject_id);
  RETURN NEW;
END
$$;

CREATE TRIGGER check_supplementary_subject BEFORE INSERT ON evidence.supplementary_evidence
  FOR EACH ROW EXECUTE FUNCTION evidence.check_supplementary_subject();

-- Registry facts need their primary evidence. The tables are empty when this runs.
ALTER TABLE registry.registrant ADD COLUMN evidence_id bigint NOT NULL REFERENCES evidence.evidence (id);
ALTER TABLE registry.registrant_attribute_observation ADD COLUMN evidence_id bigint NOT NULL REFERENCES evidence.evidence (id);
ALTER TABLE registry.dataset_release ADD COLUMN evidence_id bigint NOT NULL REFERENCES evidence.evidence (id);
ALTER TABLE registry.filing ADD COLUMN evidence_id bigint NOT NULL REFERENCES evidence.evidence (id);
ALTER TABLE registry.filing_registrant_link ADD COLUMN evidence_id bigint NOT NULL REFERENCES evidence.evidence (id);
ALTER TABLE registry.filing_attribute_observation ADD COLUMN evidence_id bigint NOT NULL REFERENCES evidence.evidence (id);
ALTER TABLE registry.filing_document ADD COLUMN evidence_id bigint NOT NULL REFERENCES evidence.evidence (id);
ALTER TABLE registry.filing_relationship_decision ADD COLUMN evidence_id bigint NOT NULL REFERENCES evidence.evidence (id);

SELECT ops.apply_append_only_to_all();
