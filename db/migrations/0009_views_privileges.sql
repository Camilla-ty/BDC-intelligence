-- 0009 views and privileges.
-- "Current" is always computed by a view, never stored as a mutable flag. For single-chain
-- tables the head (the row no other row supersedes) is unique per subject. For multi tables
-- every head is current and all are returned; nothing chooses among them silently.
-- These are integrity views, not product read models.

CREATE VIEW ops.current_run_status AS
SELECT r.id AS run_id, r.run_kind, r.started_at,
       coalesce(o.status, 'STARTED'::ops.run_status) AS status,
       o.finished_at
FROM ops.run r
LEFT JOIN ops.run_outcome o ON o.run_id = r.id;

CREATE VIEW ops.current_coverage AS
SELECT c.id AS coverage_assertion_id, c.registrant_id, c.dataset_release_id, c.reporting_period_end,
       c.source_type_code, c.coverage_state, c.evidence_id, c.rule_version_id, c.recorded_at,
       (c.coverage_state = 'COVERED') AS is_covered
FROM ops.coverage_assertion c
WHERE NOT EXISTS (SELECT 1 FROM ops.coverage_assertion s WHERE s.supersedes_id = c.id);
COMMENT ON VIEW ops.current_coverage IS 'A scope with no row here has UNKNOWN coverage. Only is_covered = true allows "not reported" conclusions.';

CREATE VIEW ref.current_column_mapping AS
SELECT m.id AS mapping_id, m.source_table_code, m.column_label, m.mapping_target, m.field_code,
       m.mapping_basis, m.mapping_status, m.open_question_ref, m.source_schema_reference, m.rule_version_id,
       (m.mapping_status IN ('DOCUMENTED', 'DOCUMENTED_AND_OBSERVED')) AS may_feed_derived_values
FROM ref.source_column_mapping m
WHERE NOT EXISTS (SELECT 1 FROM ref.source_column_mapping s WHERE s.supersedes_id = m.id);

CREATE VIEW registry.current_filing_registrant AS
WITH heads AS (
  SELECT l.*
  FROM registry.filing_registrant_link l
  WHERE NOT EXISTS (SELECT 1 FROM registry.filing_registrant_link s WHERE s.supersedes_id = l.id)
),
per_filing AS (
  SELECT filing_id, count(DISTINCT registrant_id) AS registrant_count FROM heads GROUP BY filing_id
)
SELECT f.id AS filing_id, f.accession_number, h.registrant_id, r.cik, h.link_source, h.evidence_id,
       CASE WHEN h.id IS NULL THEN 'UNKNOWN'
            WHEN p.registrant_count > 1 THEN 'MULTIPLE'
            ELSE 'LINKED' END AS registrant_link_status
FROM registry.filing f
LEFT JOIN heads h ON h.filing_id = f.id
LEFT JOIN per_filing p ON p.filing_id = f.id
LEFT JOIN registry.registrant r ON r.id = h.registrant_id;
COMMENT ON VIEW registry.current_filing_registrant IS 'Registrant per filing from explicit metadata only. UNKNOWN when no link exists; MULTIPLE when links name more than one registrant.';

CREATE VIEW registry.current_filing_relationship AS
SELECT d.* FROM registry.filing_relationship_decision d
WHERE NOT EXISTS (SELECT 1 FROM registry.filing_relationship_decision s WHERE s.supersedes_id = d.id);

CREATE VIEW obs.current_soi_row_classification AS
SELECT c.* FROM obs.soi_row_classification c
WHERE NOT EXISTS (SELECT 1 FROM obs.soi_row_classification s WHERE s.supersedes_id = c.id);

CREATE VIEW obs.current_position_field_value AS
SELECT f.* FROM obs.position_field_value f
WHERE NOT EXISTS (SELECT 1 FROM obs.position_field_value s WHERE s.supersedes_id = f.id);

CREATE VIEW validation.current_evidence_status AS
SELECT f.id AS field_value_id,
       coalesce(a.evidence_status, 'NOT_CHECKED'::ref.evidence_status) AS evidence_status,
       a.validation_result_id
FROM obs.current_position_field_value f
LEFT JOIN validation.evidence_status_assertion a
  ON a.field_value_id = f.id
 AND NOT EXISTS (SELECT 1 FROM validation.evidence_status_assertion s WHERE s.supersedes_id = a.id);

-- Authority is computed, not stored, so later verification never mutates a row.
CREATE VIEW obs.field_value_authority AS
SELECT f.id AS field_value_id, f.position_observation_id, f.field_code, f.source_column_label,
       f.value_state, f.currency_state, f.scale_state, e.evidence_level, es.evidence_status,
       CASE WHEN f.column_mapping_id IS NULL THEN NULL ELSE ref.current_mapping_status(f.column_mapping_id) END
         AS mapping_status,
       CASE
         WHEN f.value_state = 'UNKNOWN' THEN 'UNKNOWN'
         WHEN f.value_state = 'NOT_APPLICABLE' THEN 'NOT_APPLICABLE'
         WHEN f.column_mapping_id IS NOT NULL
              AND ref.current_mapping_status(f.column_mapping_id) = 'REJECTED' THEN 'UNRESOLVED'
         WHEN fd.level2_required AND e.evidence_level <> 'L2_ORIGINAL_FILING'
              AND es.evidence_status <> 'FILING_VERIFIED' THEN 'UNKNOWN'
         WHEN es.evidence_status = 'FILING_MISMATCH' THEN 'UNRESOLVED'
         WHEN f.column_mapping_id IS NOT NULL
              AND ref.current_mapping_status(f.column_mapping_id) IN ('OPEN_QUESTION', 'OBSERVED_UNCONFIRMED') THEN 'PROVISIONAL'
         WHEN f.currency_state = 'FROM_NUM_UNIQUE_MATCH' THEN 'PROVISIONAL'
         WHEN f.scale_state = 'UNRESOLVED' THEN 'UNRESOLVED'
         WHEN es.evidence_status = 'FILING_VERIFIED' OR e.evidence_level = 'L2_ORIGINAL_FILING' THEN 'AUTHORITATIVE'
         ELSE 'REPORTED_STRUCTURED'
       END AS authority
FROM obs.current_position_field_value f
JOIN ref.field_definition fd ON fd.field_code = f.field_code
JOIN evidence.evidence e ON e.id = f.evidence_id
JOIN validation.current_evidence_status es ON es.field_value_id = f.id;
COMMENT ON VIEW obs.field_value_authority IS 'AUTHORITATIVE, REPORTED_STRUCTURED, PROVISIONAL, UNRESOLVED, UNKNOWN, or NOT_APPLICABLE per current field value. Derived values carry DERIVED in derived.derived_value.';

-- Every field for every position observation; a field with no value row is UNKNOWN, never zero.
CREATE VIEW obs.position_field_status AS
SELECT p.id AS position_observation_id, fd.field_code, a.field_value_id, a.source_column_label,
       coalesce(a.value_state, 'UNKNOWN'::ref.value_state) AS value_state,
       coalesce(a.authority, 'UNKNOWN') AS authority
FROM obs.position_observation p
CROSS JOIN ref.field_definition fd
LEFT JOIN obs.field_value_authority a
  ON a.position_observation_id = p.id AND a.field_code = fd.field_code;

CREATE VIEW resolution.current_entity_resolution AS
SELECT d.* FROM resolution.entity_resolution_decision d
WHERE NOT EXISTS (SELECT 1 FROM resolution.entity_resolution_decision s WHERE s.supersedes_id = d.id);

CREATE VIEW resolution.current_group_membership AS
SELECT d.* FROM resolution.group_membership_decision d
WHERE NOT EXISTS (SELECT 1 FROM resolution.group_membership_decision s WHERE s.supersedes_id = d.id);

CREATE VIEW resolution.current_instrument_resolution AS
SELECT d.* FROM resolution.instrument_resolution_decision d
WHERE NOT EXISTS (SELECT 1 FROM resolution.instrument_resolution_decision s WHERE s.supersedes_id = d.id);

CREATE VIEW resolution.current_position_continuity AS
SELECT d.* FROM resolution.position_continuity_decision d
WHERE NOT EXISTS (SELECT 1 FROM resolution.position_continuity_decision s WHERE s.supersedes_id = d.id);

-- ---------------------------------------------------------------------------
-- Privileges (P1-D15): pipeline writer = INSERT and SELECT on history tables only;
-- reader = SELECT on views only. The migration owner owns every object. No web role yet.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  s text;
  t record;
BEGIN
  FOREACH s IN ARRAY ARRAY['ops', 'raw', 'registry', 'evidence', 'obs', 'identity',
                           'resolution', 'validation', 'derived', 'ref'] LOOP
    EXECUTE format('REVOKE ALL ON SCHEMA %I FROM PUBLIC', s);
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO bdc_pipeline_writer, bdc_reader', s);
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM PUBLIC', s);
  END LOOP;

  FOR t IN
    SELECT n.nspname, c.relname, c.relkind
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('ops', 'raw', 'registry', 'evidence', 'obs', 'identity',
                        'resolution', 'validation', 'derived', 'ref')
      AND c.relkind IN ('r', 'v')
  LOOP
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

SELECT ops.apply_append_only_to_all();
