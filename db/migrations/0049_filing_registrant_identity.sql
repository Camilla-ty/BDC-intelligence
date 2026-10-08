-- 0049 filing registrant identity on position_read.
-- Two current filing links that name the same registrant are one CIK.
-- Links that name different registrants stay MULTIPLE and the CIK stays null.
-- This does not change entity, instrument, or position resolution.

CREATE OR REPLACE VIEW registry.position_read AS
SELECT p.id AS position_observation_id,
       p.reported_date,
       p.filing_id,
       f.accession_number,
       reg.registrant_id,
       reg.registrant_cik,
       reg.registrant_link_status,
       reg.registrant_evidence_id,
       CASE WHEN names.name_count = 1 THEN names.borrower_name_observation_id END AS borrower_name_observation_id,
       CASE WHEN names.name_count = 1 THEN names.borrower_name_raw END AS borrower_name_raw,
       CASE WHEN names.name_count = 1 THEN names.borrower_name_evidence_id END AS borrower_name_evidence_id,
       CASE WHEN names.name_count = 1 THEN er.legal_entity_id END AS legal_entity_id,
       CASE
         WHEN names.name_count IS DISTINCT FROM 1 THEN 'UNRESOLVED'
         WHEN er.id IS NULL THEN 'UNRESOLVED'
         ELSE er.state::text
       END AS entity_resolution_state,
       CASE WHEN names.name_count = 1 THEN er.method END AS entity_resolution_method,
       CASE WHEN names.name_count = 1 THEN er.evidence_id END AS entity_resolution_evidence_id,
       CASE WHEN grp.n = 1 THEN grp.economic_group_id END AS economic_group_id,
       CASE WHEN grp.n = 1 THEN grp.state ELSE 'UNRESOLVED' END AS economic_group_state,
       CASE WHEN grp.n = 1 THEN grp.evidence_id END AS economic_group_evidence_id,
       CASE WHEN inst.n = 1 THEN inst.instrument_id END AS instrument_id,
       CASE WHEN inst.n = 1 THEN inst.state ELSE 'UNRESOLVED' END AS instrument_resolution_state,
       CASE WHEN inst.n = 1 THEN inst.method END AS instrument_resolution_method,
       CASE WHEN inst.n = 1 THEN inst.evidence_id END AS instrument_resolution_evidence_id,
       CASE WHEN cont.n = 1 THEN cont.position_id END AS position_id,
       CASE WHEN cont.n = 1 THEN cont.state ELSE 'UNRESOLVED' END AS continuity_state,
       CASE WHEN cont.n = 1 THEN cont.method END AS continuity_method,
       CASE WHEN cont.n = 1 THEN cont.evidence_id END AS continuity_evidence_id,
       first_observed.event_code AS first_observed_event_code,
       p.origin_soi_row_observation_id,
       p.holding_descriptor_raw,
       p.evidence_id AS observation_evidence_id,
       oe.evidence_level::text AS observation_evidence_level,
       CASE
         WHEN principal.n IS NULL THEN 'UNKNOWN'
         WHEN principal.n = 1 AND principal.reported_n = 1 AND principal.distinct_raw = 1 THEN 'REPORTED'
         WHEN principal.n = 1 AND principal.only_state = 'UNKNOWN' THEN 'UNKNOWN'
         WHEN principal.n = 1 AND principal.only_state = 'NOT_APPLICABLE' THEN 'NOT_APPLICABLE'
         ELSE 'MULTIPLE_VALUES'
       END AS principal_state,
       CASE WHEN principal.n = 1 AND principal.reported_n = 1 AND principal.distinct_raw = 1 THEN principal.raw_value END AS principal_raw,
       CASE WHEN principal.n = 1 AND principal.reported_n = 1 AND principal.distinct_raw = 1 THEN principal.normalized_numeric END AS principal_numeric,
       CASE WHEN principal.n = 1 THEN principal.evidence_id END AS principal_evidence_id,
       CASE WHEN principal.n = 1 AND principal.reported_n = 1 AND principal.distinct_raw = 1 THEN principal.currency_state END AS principal_currency_state,
       CASE WHEN principal.n = 1 AND principal.reported_n = 1 AND principal.distinct_raw = 1 THEN principal.scale_state END AS principal_scale_state,
       CASE
         WHEN cost.n IS NULL THEN 'UNKNOWN'
         WHEN cost.n = 1 AND cost.reported_n = 1 AND cost.distinct_raw = 1 THEN 'REPORTED'
         WHEN cost.n = 1 AND cost.only_state = 'UNKNOWN' THEN 'UNKNOWN'
         WHEN cost.n = 1 AND cost.only_state = 'NOT_APPLICABLE' THEN 'NOT_APPLICABLE'
         ELSE 'MULTIPLE_VALUES'
       END AS cost_state,
       CASE WHEN cost.n = 1 AND cost.reported_n = 1 AND cost.distinct_raw = 1 THEN cost.raw_value END AS cost_raw,
       CASE WHEN cost.n = 1 AND cost.reported_n = 1 AND cost.distinct_raw = 1 THEN cost.normalized_numeric END AS cost_numeric,
       CASE WHEN cost.n = 1 THEN cost.evidence_id END AS cost_evidence_id,
       CASE WHEN cost.n = 1 AND cost.reported_n = 1 AND cost.distinct_raw = 1 THEN cost.currency_state END AS cost_currency_state,
       CASE WHEN cost.n = 1 AND cost.reported_n = 1 AND cost.distinct_raw = 1 THEN cost.scale_state END AS cost_scale_state,
       CASE
         WHEN fair_value.n IS NULL THEN 'UNKNOWN'
         WHEN fair_value.n = 1 AND fair_value.reported_n = 1 AND fair_value.distinct_raw = 1 THEN 'REPORTED'
         WHEN fair_value.n = 1 AND fair_value.only_state = 'UNKNOWN' THEN 'UNKNOWN'
         WHEN fair_value.n = 1 AND fair_value.only_state = 'NOT_APPLICABLE' THEN 'NOT_APPLICABLE'
         ELSE 'MULTIPLE_VALUES'
       END AS fair_value_state,
       CASE WHEN fair_value.n = 1 AND fair_value.reported_n = 1 AND fair_value.distinct_raw = 1 THEN fair_value.raw_value END AS fair_value_raw,
       CASE WHEN fair_value.n = 1 AND fair_value.reported_n = 1 AND fair_value.distinct_raw = 1 THEN fair_value.normalized_numeric END AS fair_value_numeric,
       CASE WHEN fair_value.n = 1 THEN fair_value.evidence_id END AS fair_value_evidence_id,
       CASE WHEN fair_value.n = 1 AND fair_value.reported_n = 1 AND fair_value.distinct_raw = 1 THEN fair_value.currency_state END AS fair_value_currency_state,
       CASE WHEN fair_value.n = 1 AND fair_value.reported_n = 1 AND fair_value.distinct_raw = 1 THEN fair_value.scale_state END AS fair_value_scale_state,
       CASE
         WHEN acquisition.n IS NULL THEN 'UNKNOWN'
         WHEN acquisition.n = 1 AND acquisition.reported_n = 1 AND acquisition.distinct_raw = 1 THEN 'REPORTED'
         WHEN acquisition.n = 1 AND acquisition.only_state = 'UNKNOWN' THEN 'UNKNOWN'
         WHEN acquisition.n = 1 AND acquisition.only_state = 'NOT_APPLICABLE' THEN 'NOT_APPLICABLE'
         ELSE 'MULTIPLE_VALUES'
       END AS acquisition_state,
       CASE WHEN acquisition.n = 1 AND acquisition.reported_n = 1 AND acquisition.distinct_raw = 1 THEN acquisition.raw_value END AS acquisition_raw,
       CASE WHEN acquisition.n = 1 AND acquisition.reported_n = 1 AND acquisition.distinct_raw = 1 THEN acquisition.normalized_date END AS acquisition_date,
       CASE WHEN acquisition.n = 1 AND acquisition.reported_n = 1 AND acquisition.distinct_raw = 1 THEN acquisition.date_precision END AS acquisition_precision,
       CASE WHEN acquisition.n = 1 AND acquisition.reported_n = 1 AND acquisition.distinct_raw = 1 THEN acquisition.normalized_year END AS acquisition_year,
       CASE WHEN acquisition.n = 1 AND acquisition.reported_n = 1 AND acquisition.distinct_raw = 1 THEN acquisition.normalized_month END AS acquisition_month,
       CASE WHEN acquisition.n = 1 THEN acquisition.evidence_id END AS acquisition_evidence_id,
       CASE
         WHEN interest_rate.n IS NULL THEN 'UNKNOWN'
         WHEN interest_rate.n = 1 AND interest_rate.reported_n = 1 AND interest_rate.distinct_raw = 1 THEN 'REPORTED'
         WHEN interest_rate.n = 1 AND interest_rate.only_state = 'UNKNOWN' THEN 'UNKNOWN'
         WHEN interest_rate.n = 1 AND interest_rate.only_state = 'NOT_APPLICABLE' THEN 'NOT_APPLICABLE'
         ELSE 'MULTIPLE_VALUES'
       END AS interest_rate_state,
       CASE WHEN interest_rate.n = 1 AND interest_rate.reported_n = 1 AND interest_rate.distinct_raw = 1 THEN interest_rate.raw_value END AS interest_rate_raw,
       CASE WHEN interest_rate.n = 1 AND interest_rate.reported_n = 1 AND interest_rate.distinct_raw = 1 THEN interest_rate.normalized_numeric END AS interest_rate_numeric,
       CASE WHEN interest_rate.n = 1 THEN interest_rate.evidence_id END AS interest_rate_evidence_id,
       CASE WHEN interest_rate.n = 1 AND interest_rate.reported_n = 1 AND interest_rate.distinct_raw = 1 THEN interest_rate.scale_state END AS interest_rate_scale_state,
       CASE
         WHEN spread.n IS NULL THEN 'UNKNOWN'
         WHEN spread.n = 1 AND spread.reported_n = 1 AND spread.distinct_raw = 1 THEN 'REPORTED'
         WHEN spread.n = 1 AND spread.only_state = 'UNKNOWN' THEN 'UNKNOWN'
         WHEN spread.n = 1 AND spread.only_state = 'NOT_APPLICABLE' THEN 'NOT_APPLICABLE'
         ELSE 'MULTIPLE_VALUES'
       END AS spread_state,
       CASE WHEN spread.n = 1 AND spread.reported_n = 1 AND spread.distinct_raw = 1 THEN spread.raw_value END AS spread_raw,
       CASE WHEN spread.n = 1 AND spread.reported_n = 1 AND spread.distinct_raw = 1 THEN spread.normalized_numeric END AS spread_numeric,
       CASE WHEN spread.n = 1 THEN spread.evidence_id END AS spread_evidence_id,
       CASE WHEN spread.n = 1 AND spread.reported_n = 1 AND spread.distinct_raw = 1 THEN spread.scale_state END AS spread_scale_state,
       CASE
         WHEN floor_rate.n IS NULL THEN 'UNKNOWN'
         WHEN floor_rate.n = 1 AND floor_rate.reported_n = 1 AND floor_rate.distinct_raw = 1 THEN 'REPORTED'
         WHEN floor_rate.n = 1 AND floor_rate.only_state = 'UNKNOWN' THEN 'UNKNOWN'
         WHEN floor_rate.n = 1 AND floor_rate.only_state = 'NOT_APPLICABLE' THEN 'NOT_APPLICABLE'
         ELSE 'MULTIPLE_VALUES'
       END AS interest_rate_floor_state,
       CASE WHEN floor_rate.n = 1 AND floor_rate.reported_n = 1 AND floor_rate.distinct_raw = 1 THEN floor_rate.raw_value END AS interest_rate_floor_raw,
       CASE WHEN floor_rate.n = 1 AND floor_rate.reported_n = 1 AND floor_rate.distinct_raw = 1 THEN floor_rate.normalized_numeric END AS interest_rate_floor_numeric,
       CASE WHEN floor_rate.n = 1 THEN floor_rate.evidence_id END AS interest_rate_floor_evidence_id,
       CASE WHEN floor_rate.n = 1 AND floor_rate.reported_n = 1 AND floor_rate.distinct_raw = 1 THEN floor_rate.scale_state END AS interest_rate_floor_scale_state,
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
FROM obs.position_observation p
JOIN registry.filing f ON f.id = p.filing_id
JOIN evidence.evidence oe ON oe.id = p.evidence_id
JOIN LATERAL (
  SELECT mr_row.*
  FROM registry.maturity_read mr_row
  WHERE mr_row.position_observation_id = p.id
) mr ON true
JOIN LATERAL (
  SELECT mp_row.*
  FROM obs.maturity_provenance mp_row
  WHERE mp_row.position_observation_id = p.id
) mp ON true
LEFT JOIN LATERAL (
  SELECT NULLIF(count(*), 0)::integer AS name_count,
         CASE WHEN count(*) = 1 THEN min(b.id) END AS borrower_name_observation_id,
         CASE WHEN count(*) = 1 THEN min(b.raw_text) END AS borrower_name_raw,
         CASE WHEN count(*) = 1 THEN min(b.evidence_id) END AS borrower_name_evidence_id
  FROM obs.current_borrower_name_observation b
  WHERE b.position_observation_id = p.id
    AND b.source_column_label = 'Investment, Identifier Axis'
    AND b.extraction_state = 'EXTRACTED'
) names ON true
LEFT JOIN resolution.current_entity_resolution er
  ON names.name_count = 1
 AND er.borrower_name_observation_id = names.borrower_name_observation_id
LEFT JOIN LATERAL (
  SELECT count(*)::integer AS n,
         count(*) FILTER (WHERE fv.value_state = 'REPORTED')::integer AS reported_n,
         count(DISTINCT fv.raw_value)::integer AS distinct_raw,
         min(fv.value_state::text) AS only_state,
         min(fv.raw_value) AS raw_value,
         min(fv.normalized_numeric) AS normalized_numeric,
         min(fv.normalized_date) AS normalized_date,
         min(fv.date_precision) AS date_precision,
         min(fv.normalized_year) AS normalized_year,
         min(fv.normalized_month) AS normalized_month,
         min(fv.evidence_id) AS evidence_id,
         min(fv.currency_state::text) AS currency_state,
         min(fv.scale_state::text) AS scale_state
  FROM obs.position_field_value fv
  WHERE fv.position_observation_id = p.id
    AND fv.field_code = 'PRINCIPAL_AMOUNT'
    AND NOT EXISTS (
      SELECT 1 FROM obs.position_field_value newer WHERE newer.supersedes_id = fv.id)
  HAVING count(*) > 0
) principal ON true
LEFT JOIN LATERAL (
  SELECT count(*)::integer AS n,
         count(*) FILTER (WHERE fv.value_state = 'REPORTED')::integer AS reported_n,
         count(DISTINCT fv.raw_value)::integer AS distinct_raw,
         min(fv.value_state::text) AS only_state,
         min(fv.raw_value) AS raw_value,
         min(fv.normalized_numeric) AS normalized_numeric,
         min(fv.normalized_date) AS normalized_date,
         min(fv.date_precision) AS date_precision,
         min(fv.normalized_year) AS normalized_year,
         min(fv.normalized_month) AS normalized_month,
         min(fv.evidence_id) AS evidence_id,
         min(fv.currency_state::text) AS currency_state,
         min(fv.scale_state::text) AS scale_state
  FROM obs.position_field_value fv
  WHERE fv.position_observation_id = p.id
    AND fv.field_code = 'COST'
    AND NOT EXISTS (
      SELECT 1 FROM obs.position_field_value newer WHERE newer.supersedes_id = fv.id)
  HAVING count(*) > 0
) cost ON true
LEFT JOIN LATERAL (
  SELECT count(*)::integer AS n,
         count(*) FILTER (WHERE fv.value_state = 'REPORTED')::integer AS reported_n,
         count(DISTINCT fv.raw_value)::integer AS distinct_raw,
         min(fv.value_state::text) AS only_state,
         min(fv.raw_value) AS raw_value,
         min(fv.normalized_numeric) AS normalized_numeric,
         min(fv.normalized_date) AS normalized_date,
         min(fv.date_precision) AS date_precision,
         min(fv.normalized_year) AS normalized_year,
         min(fv.normalized_month) AS normalized_month,
         min(fv.evidence_id) AS evidence_id,
         min(fv.currency_state::text) AS currency_state,
         min(fv.scale_state::text) AS scale_state
  FROM obs.position_field_value fv
  WHERE fv.position_observation_id = p.id
    AND fv.field_code = 'FAIR_VALUE'
    AND NOT EXISTS (
      SELECT 1 FROM obs.position_field_value newer WHERE newer.supersedes_id = fv.id)
  HAVING count(*) > 0
) fair_value ON true
LEFT JOIN LATERAL (
  SELECT count(*)::integer AS n,
         count(*) FILTER (WHERE fv.value_state = 'REPORTED')::integer AS reported_n,
         count(DISTINCT fv.raw_value)::integer AS distinct_raw,
         min(fv.value_state::text) AS only_state,
         min(fv.raw_value) AS raw_value,
         min(fv.normalized_numeric) AS normalized_numeric,
         min(fv.normalized_date) AS normalized_date,
         min(fv.date_precision) AS date_precision,
         min(fv.normalized_year) AS normalized_year,
         min(fv.normalized_month) AS normalized_month,
         min(fv.evidence_id) AS evidence_id,
         min(fv.currency_state::text) AS currency_state,
         min(fv.scale_state::text) AS scale_state
  FROM obs.position_field_value fv
  WHERE fv.position_observation_id = p.id
    AND fv.field_code = 'ACQUISITION_DATE'
    AND NOT EXISTS (
      SELECT 1 FROM obs.position_field_value newer WHERE newer.supersedes_id = fv.id)
  HAVING count(*) > 0
) acquisition ON true
LEFT JOIN LATERAL (
  SELECT count(*)::integer AS n,
         count(*) FILTER (WHERE fv.value_state = 'REPORTED')::integer AS reported_n,
         count(DISTINCT fv.raw_value)::integer AS distinct_raw,
         min(fv.value_state::text) AS only_state,
         min(fv.raw_value) AS raw_value,
         min(fv.normalized_numeric) AS normalized_numeric,
         min(fv.normalized_date) AS normalized_date,
         min(fv.date_precision) AS date_precision,
         min(fv.normalized_year) AS normalized_year,
         min(fv.normalized_month) AS normalized_month,
         min(fv.evidence_id) AS evidence_id,
         min(fv.currency_state::text) AS currency_state,
         min(fv.scale_state::text) AS scale_state
  FROM obs.position_field_value fv
  WHERE fv.position_observation_id = p.id
    AND fv.field_code = 'INTEREST_RATE'
    AND NOT EXISTS (
      SELECT 1 FROM obs.position_field_value newer WHERE newer.supersedes_id = fv.id)
  HAVING count(*) > 0
) interest_rate ON true
LEFT JOIN LATERAL (
  SELECT count(*)::integer AS n,
         count(*) FILTER (WHERE fv.value_state = 'REPORTED')::integer AS reported_n,
         count(DISTINCT fv.raw_value)::integer AS distinct_raw,
         min(fv.value_state::text) AS only_state,
         min(fv.raw_value) AS raw_value,
         min(fv.normalized_numeric) AS normalized_numeric,
         min(fv.normalized_date) AS normalized_date,
         min(fv.date_precision) AS date_precision,
         min(fv.normalized_year) AS normalized_year,
         min(fv.normalized_month) AS normalized_month,
         min(fv.evidence_id) AS evidence_id,
         min(fv.currency_state::text) AS currency_state,
         min(fv.scale_state::text) AS scale_state
  FROM obs.position_field_value fv
  WHERE fv.position_observation_id = p.id
    AND fv.field_code = 'SPREAD'
    AND NOT EXISTS (
      SELECT 1 FROM obs.position_field_value newer WHERE newer.supersedes_id = fv.id)
  HAVING count(*) > 0
) spread ON true
LEFT JOIN LATERAL (
  SELECT count(*)::integer AS n,
         count(*) FILTER (WHERE fv.value_state = 'REPORTED')::integer AS reported_n,
         count(DISTINCT fv.raw_value)::integer AS distinct_raw,
         min(fv.value_state::text) AS only_state,
         min(fv.raw_value) AS raw_value,
         min(fv.normalized_numeric) AS normalized_numeric,
         min(fv.normalized_date) AS normalized_date,
         min(fv.date_precision) AS date_precision,
         min(fv.normalized_year) AS normalized_year,
         min(fv.normalized_month) AS normalized_month,
         min(fv.evidence_id) AS evidence_id,
         min(fv.currency_state::text) AS currency_state,
         min(fv.scale_state::text) AS scale_state
  FROM obs.position_field_value fv
  WHERE fv.position_observation_id = p.id
    AND fv.field_code = 'INTEREST_RATE_FLOOR'
    AND NOT EXISTS (
      SELECT 1 FROM obs.position_field_value newer WHERE newer.supersedes_id = fv.id)
  HAVING count(*) > 0
) floor_rate ON true
LEFT JOIN LATERAL (
  SELECT count(*)::integer AS n,
         CASE WHEN count(*) = 1 THEN (array_agg(g.economic_group_id))[1] END AS economic_group_id,
         CASE WHEN count(*) = 1 THEN min(g.state::text) END AS state,
         CASE WHEN count(*) = 1 THEN min(g.evidence_id) END AS evidence_id
  FROM resolution.current_group_membership g
  WHERE names.name_count = 1
    AND er.legal_entity_id IS NOT NULL
    AND g.legal_entity_id = er.legal_entity_id
) grp ON true
LEFT JOIN LATERAL (
  SELECT count(*)::integer AS n,
         CASE WHEN count(*) = 1 THEN (array_agg(d.instrument_id))[1] END AS instrument_id,
         CASE WHEN count(*) = 1 THEN min(d.state::text) END AS state,
         CASE WHEN count(*) = 1 THEN min(d.method) END AS method,
         CASE WHEN count(*) = 1 THEN min(d.evidence_id) END AS evidence_id
  FROM resolution.current_instrument_resolution d
  WHERE d.position_observation_id = p.id
) inst ON true
LEFT JOIN LATERAL (
  SELECT count(*)::integer AS n,
         CASE WHEN count(*) = 1 THEN (array_agg(d.position_id))[1] END AS position_id,
         CASE WHEN count(*) = 1 THEN min(d.state::text) END AS state,
         CASE WHEN count(*) = 1 THEN min(d.method) END AS method,
         CASE WHEN count(*) = 1 THEN min(d.evidence_id) END AS evidence_id
  FROM resolution.current_position_continuity d
  WHERE d.position_observation_id = p.id
) cont ON true
LEFT JOIN LATERAL (
  SELECT min(e.event_code) AS event_code
  FROM derived.observation_event e
  WHERE e.position_observation_id = p.id
    AND e.event_code = 'REGISTRANT_FIRST_OBSERVED_NAME'
) first_observed ON true
LEFT JOIN LATERAL (
  SELECT CASE
           WHEN multiple_n > 0 OR linked_registrants > 1 THEN 'MULTIPLE'
           WHEN linked_registrants = 1 THEN 'LINKED'
           ELSE 'UNKNOWN'
         END AS registrant_link_status,
         CASE
           WHEN multiple_n = 0 AND linked_registrants = 1 THEN registrant_id
         END AS registrant_id,
         CASE
           WHEN multiple_n = 0 AND linked_registrants = 1 THEN lpad(cik::text, 10, '0')
         END AS registrant_cik,
         CASE
           WHEN multiple_n = 0 AND linked_registrants = 1 AND linked_evidence_n = 1 THEN evidence_id
         END AS registrant_evidence_id
  FROM (
    SELECT count(DISTINCT registrant_id) FILTER (WHERE link_status = 'LINKED')::integer AS linked_registrants,
           count(DISTINCT evidence_id) FILTER (WHERE link_status = 'LINKED')::integer AS linked_evidence_n,
           count(*) FILTER (WHERE link_status = 'MULTIPLE')::integer AS multiple_n,
           min(registrant_id) FILTER (WHERE link_status = 'LINKED') AS registrant_id,
           min(cik) FILTER (WHERE link_status = 'LINKED') AS cik,
           min(evidence_id) FILTER (WHERE link_status = 'LINKED') AS evidence_id
    FROM (
      SELECT h.registrant_id,
             h.evidence_id,
             registrant.cik,
             CASE
               WHEN h.id IS NULL THEN 'UNKNOWN'
               WHEN counts.registrant_count > 1 THEN 'MULTIPLE'
               ELSE 'LINKED'
             END AS link_status
      FROM (SELECT 1) AS filing_anchor
      LEFT JOIN (
        SELECT l.id, l.registrant_id, l.evidence_id
        FROM registry.filing_registrant_link l
        WHERE l.filing_id = p.filing_id
          AND NOT EXISTS (
            SELECT 1
            FROM registry.filing_registrant_link superseded
            WHERE superseded.supersedes_id = l.id)
      ) h ON true
      LEFT JOIN LATERAL (
        SELECT count(DISTINCT l2.registrant_id)::integer AS registrant_count
        FROM registry.filing_registrant_link l2
        WHERE l2.filing_id = p.filing_id
          AND NOT EXISTS (
            SELECT 1
            FROM registry.filing_registrant_link superseded
            WHERE superseded.supersedes_id = l2.id)
      ) counts ON true
      LEFT JOIN registry.registrant registrant ON registrant.id = h.registrant_id
    ) filing_registrant
  ) filing_link
) reg ON true;


COMMENT ON VIEW registry.position_read IS
  'One row per position observation. Observed field heads stay REPORTED only when exactly one current raw value is stored. A missing head is UNKNOWN and null, never zero. Resolution columns repeat the current decision, or UNRESOLVED when there is no single current decision. Maturity columns are registry.maturity_read. Acquisition date is the stored ACQUISITION_DATE, not an origination date. No row is created for a period that was not observed, and absence is not an exit. Registrant CIK is present when every current filing link names one registrant. More than one registrant leaves the CIK null.';

SELECT ops.grant_layer_privileges();
