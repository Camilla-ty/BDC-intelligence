-- 0056 filing-scoped registrant lookup on borrower_observation_listing.
-- Replaces the LEFT JOIN LATERAL that read registry.current_filing_registrant
-- (which builds a global heads CTE over all filing_registrant_link rows) with
-- the same heads / per-filing count / LINKED|MULTIPLE|UNKNOWN semantics scoped
-- to the outer filing_id so filing_registrant_link_filing_idx can be used.
-- registry.current_filing_registrant is intentionally unchanged.

CREATE OR REPLACE VIEW registry.borrower_observation_listing AS
SELECT
  d.legal_entity_id,
  a.alias_text,
  a.verification_state,
  d.state::text AS entity_resolution_state,
  d.method AS entity_resolution_method,
  p.reported_date,
  f.accession_number,
  fd.document_name,
  fd.document_url,
  fr.registrant_link_status,
  CASE WHEN fr.cik IS NULL THEN NULL ELSE lpad(fr.cik::text, 10, '0') END AS registrant_cik,
  nh.registrant_name,
  coalesce(ir.state::text, 'UNRESOLVED') AS instrument_resolution_state,
  ir.method AS instrument_resolution_method,
  CASE
    WHEN fv.value_state = 'REPORTED' AND coalesce(fv.raw_value, '') <> '' THEN 'REPORTED'
    ELSE 'UNKNOWN'
  END AS instrument_type_state,
  ev.event_code,
  e.evidence_level::text AS observation_evidence_level,
  nv.outcome::text AS name_validation_outcome
FROM resolution.current_entity_resolution d
JOIN obs.borrower_name_observation b ON b.id = d.borrower_name_observation_id
JOIN obs.position_observation p ON p.id = b.position_observation_id
JOIN registry.filing f ON f.id = p.filing_id
JOIN evidence.evidence e ON e.id = p.evidence_id
JOIN LATERAL (
  SELECT al.alias_text, al.verification_state
  FROM identity.legal_entity_alias al
  WHERE al.legal_entity_id = d.legal_entity_id
    AND al.verification_state = 'VERIFIED'
    AND NOT EXISTS (
      SELECT 1 FROM identity.legal_entity_alias s WHERE s.supersedes_id = al.id)
  ORDER BY al.id
  LIMIT 1
) a ON true
LEFT JOIN LATERAL (
  SELECT doc.document_name, doc.document_url
  FROM registry.filing_document doc
  WHERE doc.filing_id = f.id
  ORDER BY CASE WHEN doc.named_by = 'SUBMISSIONS_PRIMARY_DOCUMENT' THEN 0 ELSE 1 END, doc.id
  LIMIT 1
) fd ON true
LEFT JOIN LATERAL (
  -- Filing-scoped equivalent of registry.current_filing_registrant for one filing,
  -- then the same ORDER BY / LIMIT 1 pick the listing always applied.
  SELECT x.registrant_id, x.cik, x.registrant_link_status
  FROM (
    SELECT h.registrant_id,
           r.cik,
           CASE
             WHEN h.id IS NULL THEN 'UNKNOWN'
             WHEN pf.registrant_count > 1 THEN 'MULTIPLE'
             ELSE 'LINKED'
           END AS registrant_link_status
    FROM (SELECT p.filing_id AS filing_id) AS scoped
    LEFT JOIN LATERAL (
      SELECT l.id, l.registrant_id
      FROM registry.filing_registrant_link l
      WHERE l.filing_id = scoped.filing_id
        AND NOT EXISTS (
          SELECT 1 FROM registry.filing_registrant_link s WHERE s.supersedes_id = l.id)
    ) h ON true
    LEFT JOIN LATERAL (
      SELECT count(DISTINCT l.registrant_id) AS registrant_count
      FROM registry.filing_registrant_link l
      WHERE l.filing_id = scoped.filing_id
        AND NOT EXISTS (
          SELECT 1 FROM registry.filing_registrant_link s WHERE s.supersedes_id = l.id)
    ) pf ON true
    LEFT JOIN registry.registrant r ON r.id = h.registrant_id
  ) x
  ORDER BY CASE WHEN x.registrant_link_status = 'LINKED' THEN 0 ELSE 1 END, x.registrant_id
  LIMIT 1
) fr ON true
LEFT JOIN LATERAL (
  SELECT string_agg(DISTINCT h.name_raw, ' · ' ORDER BY h.name_raw) AS registrant_name
  FROM registry.current_registrant_name_history h
  WHERE h.registrant_id = fr.registrant_id
) nh ON true
LEFT JOIN LATERAL (
  SELECT cir.state, cir.method
  FROM resolution.current_instrument_resolution cir
  WHERE cir.position_observation_id = p.id
  LIMIT 1
) ir ON true
LEFT JOIN LATERAL (
  SELECT cfv.value_state, cfv.raw_value
  FROM obs.current_position_field_value cfv
  WHERE cfv.position_observation_id = p.id AND cfv.field_code = 'INSTRUMENT_TYPE'
  LIMIT 1
) fv ON true
LEFT JOIN LATERAL (
  SELECT oe.event_code
  FROM derived.observation_event oe
  WHERE oe.position_observation_id = p.id
    AND oe.event_code = 'REGISTRANT_FIRST_OBSERVED_NAME'
  ORDER BY oe.id
  LIMIT 1
) ev ON true
LEFT JOIN LATERAL (
  SELECT v.outcome
  FROM validation.validation_result v
  WHERE v.subject_table = 'obs.borrower_name_observation' AND v.subject_id = b.id
  ORDER BY v.id
  LIMIT 1
) nv ON true
WHERE d.state = 'MATCHED'
  AND d.legal_entity_id IS NOT NULL
  AND b.source_column_label = 'Investment, Identifier Axis'
  AND b.extraction_state = 'EXTRACTED';

COMMENT ON VIEW registry.borrower_observation_listing IS
  'Phase 10-min borrower observations. One row per MATCHED name observation. No cost, fair value, or invented instrument attributes. A missing date is absent, not zero. Filing registrant status is resolved per filing_id (LINKED/MULTIPLE/UNKNOWN) without scanning all filing_registrant_link heads.';

SELECT ops.grant_layer_privileges();
