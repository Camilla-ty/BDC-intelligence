-- 0048 Admin Filing read layer (Phase A).
-- Read-only views for the SEC filing → document/artifact → processing → observations chain.
-- admin_reader may SELECT these views only. Not granted to bdc_reader, access_reader,
-- bdc_pipeline_writer, or review_writer. No base-table SELECT. No grant_event exposure.
-- ops.grant_layer_privileges does not cover the admin schema and must not be taught to.

CREATE SCHEMA admin;
COMMENT ON SCHEMA admin IS
  'Admin Filing read models. Views only. SELECT granted to admin_reader alone.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_reader') THEN
    CREATE ROLE admin_reader NOLOGIN;
  END IF;
END
$$;
COMMENT ON ROLE admin_reader IS
  'SELECT on admin Filing read views only. Not granted to a login role by this migration. Never granted to bdc_reader.';

-- Supporting index for filing-scoped SOI observation counts (inventory + detail).
CREATE INDEX soi_row_observation_filing_idx
  ON obs.soi_row_observation (filing_id);

CREATE INDEX num_fact_observation_filing_idx
  ON obs.num_fact_observation (filing_id);

-- ---------------------------------------------------------------------------
-- Inventory: exactly one row per registry.filing (no join fan-out).
-- Attribute arrays preserve disagreements. processing_outcomes lists every
-- distinct artifact_processing.outcome for artifacts linked to the filing;
-- NULL means no linked processing row (not an invented status).
-- ops.projection_exception has no filing_id. ORPHAN_ADSH means no filing row
-- exists. This layer does not invent a filing association from raw adsh cells.
-- ---------------------------------------------------------------------------

CREATE VIEW admin.filing_inventory AS
SELECT
  f.id AS filing_id,
  f.accession_number,
  f.run_id AS filing_run_id,
  f.recorded_at AS filing_recorded_at,
  (
    SELECT CASE
      WHEN count(*) FILTER (WHERE fr.registrant_id IS NOT NULL) = 0 THEN 'UNKNOWN'
      WHEN count(DISTINCT fr.registrant_id) > 1 THEN 'MULTIPLE'
      ELSE 'LINKED'
    END
    FROM registry.current_filing_registrant fr
    WHERE fr.filing_id = f.id
  ) AS registrant_link_status,
  (
    SELECT array_agg(DISTINCT fr.registrant_id ORDER BY fr.registrant_id)
    FROM registry.current_filing_registrant fr
    WHERE fr.filing_id = f.id AND fr.registrant_id IS NOT NULL
  ) AS registrant_ids,
  (
    SELECT array_agg(DISTINCT fr.cik ORDER BY fr.cik)
    FROM registry.current_filing_registrant fr
    WHERE fr.filing_id = f.id AND fr.cik IS NOT NULL
  ) AS registrant_ciks,
  (
    SELECT CASE
      WHEN count(DISTINCT fr.registrant_id) FILTER (WHERE fr.registrant_id IS NOT NULL) = 0 THEN 'UNKNOWN'
      WHEN count(DISTINCT fr.registrant_id) FILTER (WHERE fr.registrant_id IS NOT NULL) > 1 THEN 'MULTIPLE_REGISTRANTS'
      ELSE min(ns.attribute_state)
    END
    FROM registry.current_filing_registrant fr
    LEFT JOIN registry.registrant_attribute_status ns
      ON ns.registrant_id = fr.registrant_id AND ns.attribute_code = 'NAME'
    WHERE fr.filing_id = f.id
  ) AS registrant_name_state,
  (
    SELECT CASE
      WHEN count(DISTINCT fr.registrant_id) FILTER (WHERE fr.registrant_id IS NOT NULL) = 1
           AND min(ns.attribute_state) = 'REPORTED'
           AND count(DISTINCT cra.raw_value) = 1
        THEN min(cra.raw_value)
      ELSE NULL
    END
    FROM registry.current_filing_registrant fr
    LEFT JOIN registry.registrant_attribute_status ns
      ON ns.registrant_id = fr.registrant_id AND ns.attribute_code = 'NAME'
    LEFT JOIN registry.current_registrant_attribute cra
      ON cra.registrant_id = fr.registrant_id AND cra.attribute_code = 'NAME'
    WHERE fr.filing_id = f.id AND fr.registrant_id IS NOT NULL
  ) AS registrant_name_raw,
  (
    SELECT array_agg(DISTINCT c.normalized_text ORDER BY c.normalized_text)
    FROM registry.current_filing_attribute c
    WHERE c.filing_id = f.id
      AND c.attribute_code = 'FORM'
      AND c.normalized_text IS NOT NULL
  ) AS forms,
  (
    SELECT array_agg(DISTINCT c.raw_value ORDER BY c.raw_value)
    FROM registry.current_filing_attribute c
    WHERE c.filing_id = f.id AND c.attribute_code = 'FORM'
  ) AS form_raw_values,
  (
    SELECT array_agg(DISTINCT c.normalized_date ORDER BY c.normalized_date)
    FROM registry.current_filing_attribute c
    WHERE c.filing_id = f.id
      AND c.attribute_code = 'FILED_DATE'
      AND c.normalized_date IS NOT NULL
  ) AS filed_dates,
  (
    SELECT array_agg(DISTINCT c.raw_value ORDER BY c.raw_value)
    FROM registry.current_filing_attribute c
    WHERE c.filing_id = f.id AND c.attribute_code = 'FILED_DATE'
  ) AS filed_date_raw_values,
  (
    SELECT array_agg(DISTINCT c.normalized_date ORDER BY c.normalized_date)
    FROM registry.current_filing_attribute c
    WHERE c.filing_id = f.id
      AND c.attribute_code = 'PERIOD'
      AND c.normalized_date IS NOT NULL
  ) AS report_periods,
  (
    SELECT array_agg(DISTINCT c.raw_value ORDER BY c.raw_value)
    FROM registry.current_filing_attribute c
    WHERE c.filing_id = f.id AND c.attribute_code = 'PERIOD'
  ) AS report_period_raw_values,
  (
    SELECT count(*)::bigint
    FROM registry.filing_document d
    WHERE d.filing_id = f.id
  ) AS document_count,
  (
    SELECT count(DISTINCT fda.artifact_id)::bigint
    FROM registry.filing_document d
    JOIN registry.filing_document_artifact fda ON fda.filing_document_id = d.id
    WHERE d.filing_id = f.id
  ) AS artifact_count,
  EXISTS (
    SELECT 1 FROM registry.filing_document d WHERE d.filing_id = f.id
  ) AS documents_available,
  EXISTS (
    SELECT 1
    FROM registry.filing_document d
    JOIN registry.filing_document_artifact fda ON fda.filing_document_id = d.id
    WHERE d.filing_id = f.id
  ) AS artifacts_available,
  (
    SELECT array_agg(DISTINCT p.outcome ORDER BY p.outcome)
    FROM registry.filing_document d
    JOIN registry.filing_document_artifact fda ON fda.filing_document_id = d.id
    JOIN ops.artifact_processing p ON p.artifact_id = fda.artifact_id
    WHERE d.filing_id = f.id
  ) AS processing_outcomes,
  (
    SELECT count(*)::bigint
    FROM (
      SELECT DISTINCT p.id
      FROM registry.filing_document d
      JOIN registry.filing_document_artifact fda ON fda.filing_document_id = d.id
      JOIN ops.artifact_processing p ON p.artifact_id = fda.artifact_id
      WHERE d.filing_id = f.id
    ) proc
  ) AS processing_row_count,
  (
    SELECT count(*)::bigint
    FROM obs.soi_row_observation o
    WHERE o.filing_id = f.id
  ) AS soi_row_observation_count,
  (
    SELECT count(*)::bigint
    FROM obs.position_observation o
    WHERE o.filing_id = f.id
  ) AS position_observation_count,
  (
    SELECT count(*)::bigint
    FROM obs.num_fact_observation o
    WHERE o.filing_id = f.id
  ) AS num_fact_observation_count
FROM registry.filing f;

COMMENT ON VIEW admin.filing_inventory IS
  'One row per SEC filing. Attribute arrays preserve source disagreement. processing_outcomes lists distinct linked outcomes; NULL means none linked, not a fabricated status. Projection exceptions are omitted: they are not filing-keyed.';

-- ---------------------------------------------------------------------------
-- Detail child surfaces: filter by filing_id or accession_number in the caller.
-- ---------------------------------------------------------------------------

CREATE VIEW admin.filing_registrant AS
SELECT
  fr.filing_id,
  fr.accession_number,
  fr.registrant_id,
  fr.cik,
  fr.link_source,
  fr.registrant_link_status,
  fr.evidence_id,
  ns.attribute_state AS name_state,
  CASE
    WHEN ns.attribute_state = 'REPORTED'
         AND (
           SELECT count(DISTINCT cra.raw_value)
           FROM registry.current_registrant_attribute cra
           WHERE cra.registrant_id = fr.registrant_id AND cra.attribute_code = 'NAME'
         ) = 1
      THEN (
        SELECT min(cra.raw_value)
        FROM registry.current_registrant_attribute cra
        WHERE cra.registrant_id = fr.registrant_id AND cra.attribute_code = 'NAME'
      )
    ELSE NULL
  END AS name_raw
FROM registry.current_filing_registrant fr
LEFT JOIN registry.registrant_attribute_status ns
  ON ns.registrant_id = fr.registrant_id AND ns.attribute_code = 'NAME';

COMMENT ON VIEW admin.filing_registrant IS
  'Current filing–registrant links. UNKNOWN/MULTIPLE link status and name_state stay visible; name_raw is set only for a single REPORTED name.';

CREATE VIEW admin.filing_attribute AS
SELECT
  c.filing_id,
  c.accession_number,
  c.observation_id,
  c.attribute_code,
  c.raw_value,
  c.value_state,
  c.normalized_text,
  c.normalized_date,
  c.normalized_timestamp,
  c.source_type_code,
  c.source_stream,
  c.evidence_level,
  c.documentation_status,
  c.evidence_id,
  c.rule_version_id,
  c.run_id
FROM registry.current_filing_attribute c;

COMMENT ON VIEW admin.filing_attribute IS
  'Current filing attributes per source. Multiple rows for the same attribute_code mean sources disagree.';

CREATE VIEW admin.filing_document AS
SELECT
  d.filing_id,
  f.accession_number,
  d.id AS filing_document_id,
  d.document_name,
  d.document_url,
  d.named_by,
  d.rule_version_id,
  d.run_id,
  d.evidence_id,
  d.recorded_at,
  EXISTS (
    SELECT 1
    FROM registry.filing_document_artifact fda
    WHERE fda.filing_document_id = d.id
  ) AS artifact_linked
FROM registry.filing_document d
JOIN registry.filing f ON f.id = d.filing_id;

COMMENT ON VIEW admin.filing_document IS
  'Named SEC filing documents with stored document_url locators only. No URL is constructed here.';

CREATE VIEW admin.filing_artifact AS
SELECT
  d.filing_id,
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
FROM registry.filing_document d
JOIN registry.filing f ON f.id = d.filing_id
JOIN registry.filing_document_artifact fda ON fda.filing_document_id = d.id
JOIN raw.artifact a ON a.id = fda.artifact_id;

COMMENT ON VIEW admin.filing_artifact IS
  'Artifacts linked through filing_document_artifact. Checksums and retrieval metadata are raw.artifact values.';

CREATE VIEW admin.filing_processing AS
SELECT DISTINCT
  link.filing_id,
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
FROM (
  SELECT DISTINCT d.filing_id, fda.artifact_id
  FROM registry.filing_document d
  JOIN registry.filing_document_artifact fda ON fda.filing_document_id = d.id
) link
JOIN registry.filing f ON f.id = link.filing_id
JOIN ops.artifact_processing p ON p.artifact_id = link.artifact_id
JOIN ops.rule_version rv ON rv.id = p.rule_version_id
LEFT JOIN ops.current_run_status rs ON rs.run_id = p.run_id;

COMMENT ON VIEW admin.filing_processing IS
  'artifact_processing rows for artifacts linked to the filing. Multiple outcomes stay as multiple rows; none are collapsed into a health status.';

-- Privileges: admin schema is outside ops.grant_layer_privileges on purpose.
REVOKE ALL ON SCHEMA admin FROM PUBLIC;
GRANT USAGE ON SCHEMA admin TO admin_reader;
REVOKE ALL ON ALL TABLES IN SCHEMA admin FROM PUBLIC;
GRANT SELECT ON
  admin.filing_inventory,
  admin.filing_registrant,
  admin.filing_attribute,
  admin.filing_document,
  admin.filing_artifact,
  admin.filing_processing
TO admin_reader;

REVOKE ALL ON
  admin.filing_inventory,
  admin.filing_registrant,
  admin.filing_attribute,
  admin.filing_document,
  admin.filing_artifact,
  admin.filing_processing
FROM bdc_reader, access_reader, bdc_pipeline_writer, review_writer;
