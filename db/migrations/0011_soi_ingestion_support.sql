-- 0011 SOI ingestion support (Phase 3).
-- Lands soi.tsv into the existing raw/obs model. No natural key is added. Coverage for
-- SOI holdings is a separate aspect from FILING_METADATA. An empty SOI header is allowed
-- only for a 0-byte member with row_count = 0 (P3-D11a).

INSERT INTO ref.coverage_aspect (code, description) VALUES
  ('SOI_HOLDINGS', 'Schedule of Investments (soi.tsv) of a data set release, release-wide or per registrant');

ALTER TABLE ops.coverage_assertion DROP CONSTRAINT coverage_assertion_scope;
ALTER TABLE ops.coverage_assertion ADD CONSTRAINT coverage_assertion_scope CHECK (
  (num_nonnulls(dataset_release_id, reporting_period_end) >= 1
   OR (coverage_aspect = 'FILING_HISTORY' AND registrant_id IS NOT NULL))
  AND (coverage_aspect <> 'SOI_HOLDINGS'
       OR (dataset_release_id IS NOT NULL AND source_type_code = 'SEC_BDC_DATASET_ZIP')));

-- P3-D11a: empty header only when table_code is SOI, row_count is 0, and the member is 0 bytes.
ALTER TABLE raw.table_load DROP CONSTRAINT table_load_header_check;

CREATE FUNCTION raw.check_table_load_header() RETURNS trigger
LANGUAGE plpgsql AS $$
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

CREATE TRIGGER check_table_load_header BEFORE INSERT ON raw.table_load
  FOR EACH ROW EXECUTE FUNCTION raw.check_table_load_header();

-- Rows that landed in raw.tabular_row but were not projected (never silently dropped).
CREATE TABLE ops.projection_exception (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_load_id     bigint NOT NULL REFERENCES raw.table_load (id),
  tabular_row_id    bigint REFERENCES raw.tabular_row (id),
  kind              text NOT NULL CHECK (kind IN ('FIELD_COUNT_MISMATCH', 'ORPHAN_ADSH')),
  detail            text NOT NULL CHECK (btrim(detail) <> ''),
  evidence_id       bigint NOT NULL REFERENCES evidence.evidence (id),
  rule_version_id   bigint NOT NULL REFERENCES ops.rule_version (id),
  run_id            bigint NOT NULL REFERENCES ops.run (id),
  recorded_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (tabular_row_id IS NOT NULL)
);
COMMENT ON TABLE ops.projection_exception IS 'Raw SOI lines that were kept losslessly but not projected: field-count mismatches and accession values with no registry.filing row.';

CREATE FUNCTION ops.check_projection_exception() RETURNS trigger
LANGUAGE plpgsql AS $$
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

CREATE TRIGGER check_projection_exception BEFORE INSERT ON ops.projection_exception
  FOR EACH ROW EXECUTE FUNCTION ops.check_projection_exception();

CREATE INDEX projection_exception_load_idx ON ops.projection_exception (table_load_id);

CREATE VIEW obs.current_soi_coverage AS
SELECT c.coverage_assertion_id, c.registrant_id, c.dataset_release_id, c.reporting_period_end,
       c.source_type_code, c.coverage_state, c.evidence_id, c.rule_version_id, c.recorded_at,
       c.is_covered, c.coverage_aspect
FROM ops.current_coverage c
WHERE c.coverage_aspect = 'SOI_HOLDINGS';
COMMENT ON VIEW obs.current_soi_coverage IS 'Current SOI_HOLDINGS coverage. Independent of FILING_METADATA. A scope with no row has UNKNOWN coverage, never zero holdings.';

CREATE VIEW obs.soi_load_reconciliation AS
SELECT tl.id AS table_load_id,
       tl.artifact_id,
       m.member_path,
       m.byte_size AS member_byte_size,
       cardinality(tl.header) AS header_width,
       tl.row_count,
       tl.field_count_mismatch_count,
       tl.parse_status,
       (SELECT count(*) FROM raw.tabular_row r WHERE r.table_load_id = tl.id AND r.parse_status = 'OK') AS ok_row_count,
       (SELECT count(*) FROM obs.soi_row_observation o
          JOIN raw.tabular_row r ON r.id = o.tabular_row_id
         WHERE r.table_load_id = tl.id) AS soi_row_observation_count,
       (SELECT count(*) FROM obs.position_observation p
          JOIN obs.soi_row_observation o ON o.id = p.origin_soi_row_observation_id
          JOIN raw.tabular_row r ON r.id = o.tabular_row_id
         WHERE r.table_load_id = tl.id) AS position_observation_count,
       (SELECT count(*) FROM obs.soi_row_observation o
          JOIN raw.tabular_row r ON r.id = o.tabular_row_id
         WHERE r.table_load_id = tl.id AND o.identifier_raw IS NOT NULL) AS identifier_row_count,
       (SELECT count(*) FROM obs.soi_row_observation o
          JOIN raw.tabular_row r ON r.id = o.tabular_row_id
         WHERE r.table_load_id = tl.id AND o.identifier_raw IS NULL) AS no_identifier_row_count,
       (SELECT count(*) FROM ops.projection_exception e
         WHERE e.table_load_id = tl.id AND e.kind = 'ORPHAN_ADSH') AS orphan_adsh_count,
       (SELECT count(*) FROM ops.projection_exception e
         WHERE e.table_load_id = tl.id AND e.kind = 'FIELD_COUNT_MISMATCH') AS quarantined_mismatch_count
FROM raw.table_load tl
LEFT JOIN raw.artifact_member m ON m.id = tl.artifact_member_id
WHERE tl.table_code = 'SOI';
COMMENT ON VIEW obs.soi_load_reconciliation IS 'Per SOI table load: landed rows vs projected observations. Duplicate business keys are not collapsed.';

CREATE VIEW obs.soi_duplicate_key_groups AS
SELECT o.filing_id,
       f.accession_number,
       o.identifier_raw,
       o.reported_date,
       o.qtrs,
       count(*) AS observation_count
FROM obs.soi_row_observation o
JOIN registry.filing f ON f.id = o.filing_id
WHERE o.identifier_raw IS NOT NULL
GROUP BY o.filing_id, f.accession_number, o.identifier_raw, o.reported_date, o.qtrs
HAVING count(*) > 1;
COMMENT ON VIEW obs.soi_duplicate_key_groups IS 'Metric only: groups sharing accession, identifier, ddate, and qtrs. Not an identity key and not a merge.';

SELECT ops.grant_layer_privileges();
SELECT ops.apply_append_only_to_all();
