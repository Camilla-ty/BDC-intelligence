-- 0043 borrower position read lookup.
-- registry.position_read stays one row per position observation with the same
-- field, resolution, and maturity rules. Field heads and maturity are read for
-- the position being assembled, so a borrower filter does not aggregate every
-- stored field first. Confirmed comparisons start from current MATCHED
-- continuity and then read those position_read rows.

CREATE VIEW registry.matched_entity_position AS
SELECT er.legal_entity_id,
       b.position_observation_id
FROM resolution.current_entity_resolution er
JOIN obs.current_borrower_name_observation b
  ON b.id = er.borrower_name_observation_id
JOIN LATERAL (
  SELECT count(*)::integer AS name_count
  FROM obs.current_borrower_name_observation other_name
  WHERE other_name.position_observation_id = b.position_observation_id
    AND other_name.source_column_label = 'Investment, Identifier Axis'
    AND other_name.extraction_state = 'EXTRACTED'
) names ON names.name_count = 1
WHERE er.state = 'MATCHED'
  AND er.legal_entity_id IS NOT NULL
  AND b.source_column_label = 'Investment, Identifier Axis'
  AND b.extraction_state = 'EXTRACTED';

COMMENT ON VIEW registry.matched_entity_position IS
  'Position observations whose single current Investment Identifier name has a current MATCHED entity resolution. This is the same legal-entity predicate as registry.position_read. It does not resolve a name and it does not add a row.';


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
           WHEN linked_n = 1 AND multiple_n = 0 THEN 'LINKED'
           WHEN multiple_n > 0 THEN 'MULTIPLE'
           ELSE 'UNKNOWN'
         END AS registrant_link_status,
         CASE
           WHEN linked_n = 1 AND multiple_n = 0 THEN registrant_id
         END AS registrant_id,
         CASE
           WHEN linked_n = 1 AND multiple_n = 0 THEN lpad(cik::text, 10, '0')
         END AS registrant_cik,
         CASE
           WHEN linked_n = 1 AND multiple_n = 0 THEN evidence_id
         END AS registrant_evidence_id
  FROM (
    SELECT count(*) FILTER (WHERE link_status = 'LINKED')::integer AS linked_n,
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
  'One row per position observation. Observed field heads stay REPORTED only when exactly one current raw value is stored. A missing head is UNKNOWN and null, never zero. Resolution columns repeat the current decision, or UNRESOLVED when there is no single current decision. Maturity columns are registry.maturity_read. Acquisition date is the stored ACQUISITION_DATE, not an origination date. No row is created for a period that was not observed, and absence is not an exit.';

COMMENT ON COLUMN registry.position_read.acquisition_date IS
  'Stored ACQUISITION_DATE calendar day. Null when the stored precision is MONTH, and null when acquisition was not observed. This is not an origination date.';

COMMENT ON COLUMN registry.position_read.acquisition_precision IS
  'MONTH when the stored acquisition date is a year and month. Null for a calendar day and when acquisition was not observed.';

COMMENT ON COLUMN registry.position_read.continuity_state IS
  'Current position_continuity_decision state, or UNRESOLVED when that observation has no single current decision. A later period with no observation is not represented.';

COMMENT ON COLUMN registry.position_read.first_observed_event_code IS
  'REGISTRANT_FIRST_OBSERVED_NAME when that stored event exists. Null otherwise. Not an exit, repayment, or instrument event.';

COMMENT ON COLUMN registry.position_read.maturity_date IS
  'Calendar maturity from registry.maturity_read. Null for month precision and when no maturity was selected.';

COMMENT ON COLUMN registry.position_read.economic_group_state IS
  'Current group-membership state when the legal entity has exactly one current membership. UNRESOLVED when there is no membership or more than one. Name similarity does not create a membership.';


-- 0041 confirmed position period comparison.
-- One row per consecutive pair of MATCHED observations of the same identity.position.
-- Continuity is the current position_continuity_decision. UNRESOLVED, REJECTED,
-- PROBABLE, and a missing decision are not pairs. A date with more than one
-- MATCHED observation is not an endpoint and blocks a pair across it.
-- Numeric delta is later minus earlier only when both sides have one stored
-- normalized number. A missing number stays null. Month maturity stays a month.
-- This view does not insert derived.observation_event rows.

CREATE OR REPLACE VIEW registry.position_period_comparison AS
WITH continuity_match AS MATERIALIZED (
  SELECT d.position_observation_id
  FROM resolution.current_position_continuity d
  WHERE d.state = 'MATCHED'
    AND d.position_id IS NOT NULL
),
confirmed AS (
  SELECT r.*
  FROM continuity_match d
  JOIN LATERAL (
    SELECT pr.*
    FROM registry.position_read pr
    WHERE pr.position_observation_id = d.position_observation_id
    OFFSET 0
  ) r ON true
  WHERE r.continuity_state = 'MATCHED'
    AND r.position_id IS NOT NULL
    AND r.reported_date IS NOT NULL
),
date_population AS (
  SELECT position_id, reported_date, count(*)::integer AS observation_count
  FROM confirmed
  GROUP BY position_id, reported_date
),
endpoints AS (
  SELECT c.*
  FROM confirmed c
  JOIN date_population d
    ON d.position_id = c.position_id
   AND d.reported_date = c.reported_date
   AND d.observation_count = 1
)
SELECT
  l.position_id,
  e.position_observation_id AS earlier_position_observation_id,
  l.position_observation_id AS later_position_observation_id,
  e.reported_date AS earlier_reported_date,
  l.reported_date AS later_reported_date,
  e.accession_number AS earlier_accession_number,
  l.accession_number AS later_accession_number,
  e.observation_evidence_id AS earlier_observation_evidence_id,
  l.observation_evidence_id AS later_observation_evidence_id,
  CASE
    WHEN e.principal_state = 'REPORTED' AND e.principal_numeric IS NOT NULL
     AND l.principal_state = 'REPORTED' AND l.principal_numeric IS NOT NULL
    THEN 'COMPARABLE'
    ELSE 'INSUFFICIENT_DATA'
  END AS principal_comparison_state,
  e.principal_raw AS earlier_principal_raw,
  l.principal_raw AS later_principal_raw,
  e.principal_numeric AS earlier_principal_numeric,
  l.principal_numeric AS later_principal_numeric,
  CASE
    WHEN e.principal_state = 'REPORTED' AND e.principal_numeric IS NOT NULL
     AND l.principal_state = 'REPORTED' AND l.principal_numeric IS NOT NULL
    THEN l.principal_numeric - e.principal_numeric
  END AS principal_delta,
  CASE
    WHEN e.principal_state = 'REPORTED' AND e.principal_numeric IS NOT NULL
     AND l.principal_state = 'REPORTED' AND l.principal_numeric IS NOT NULL
    THEN l.principal_numeric IS DISTINCT FROM e.principal_numeric
  END AS principal_changed,
  CASE
    WHEN e.cost_state = 'REPORTED' AND e.cost_numeric IS NOT NULL
     AND l.cost_state = 'REPORTED' AND l.cost_numeric IS NOT NULL
    THEN 'COMPARABLE'
    ELSE 'INSUFFICIENT_DATA'
  END AS cost_comparison_state,
  e.cost_raw AS earlier_cost_raw,
  l.cost_raw AS later_cost_raw,
  e.cost_numeric AS earlier_cost_numeric,
  l.cost_numeric AS later_cost_numeric,
  CASE
    WHEN e.cost_state = 'REPORTED' AND e.cost_numeric IS NOT NULL
     AND l.cost_state = 'REPORTED' AND l.cost_numeric IS NOT NULL
    THEN l.cost_numeric - e.cost_numeric
  END AS cost_delta,
  CASE
    WHEN e.cost_state = 'REPORTED' AND e.cost_numeric IS NOT NULL
     AND l.cost_state = 'REPORTED' AND l.cost_numeric IS NOT NULL
    THEN l.cost_numeric IS DISTINCT FROM e.cost_numeric
  END AS cost_changed,
  CASE
    WHEN e.fair_value_state = 'REPORTED' AND e.fair_value_numeric IS NOT NULL
     AND l.fair_value_state = 'REPORTED' AND l.fair_value_numeric IS NOT NULL
    THEN 'COMPARABLE'
    ELSE 'INSUFFICIENT_DATA'
  END AS fair_value_comparison_state,
  e.fair_value_raw AS earlier_fair_value_raw,
  l.fair_value_raw AS later_fair_value_raw,
  e.fair_value_numeric AS earlier_fair_value_numeric,
  l.fair_value_numeric AS later_fair_value_numeric,
  CASE
    WHEN e.fair_value_state = 'REPORTED' AND e.fair_value_numeric IS NOT NULL
     AND l.fair_value_state = 'REPORTED' AND l.fair_value_numeric IS NOT NULL
    THEN l.fair_value_numeric - e.fair_value_numeric
  END AS fair_value_delta,
  CASE
    WHEN e.fair_value_state = 'REPORTED' AND e.fair_value_numeric IS NOT NULL
     AND l.fair_value_state = 'REPORTED' AND l.fair_value_numeric IS NOT NULL
    THEN l.fair_value_numeric IS DISTINCT FROM e.fair_value_numeric
  END AS fair_value_changed,
  CASE
    WHEN e.maturity_date IS NOT NULL
     AND e.maturity_precision IS NULL
     AND e.maturity_source IN ('REPORTED_STRUCTURED', 'FILING_DISPLAYED')
     AND l.maturity_date IS NOT NULL
     AND l.maturity_precision IS NULL
     AND l.maturity_source IN ('REPORTED_STRUCTURED', 'FILING_DISPLAYED')
    THEN 'COMPARABLE'
    WHEN e.maturity_precision = 'MONTH'
     AND l.maturity_precision = 'MONTH'
     AND e.maturity_year IS NOT NULL
     AND e.maturity_month IS NOT NULL
     AND l.maturity_year IS NOT NULL
     AND l.maturity_month IS NOT NULL
     AND e.maturity_source IN ('REPORTED_MONTH', 'FILING_MONTH')
     AND l.maturity_source IN ('REPORTED_MONTH', 'FILING_MONTH')
    THEN 'COMPARABLE'
    ELSE 'INSUFFICIENT_DATA'
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
    WHEN e.maturity_date IS NOT NULL
     AND e.maturity_precision IS NULL
     AND e.maturity_source IN ('REPORTED_STRUCTURED', 'FILING_DISPLAYED')
     AND l.maturity_date IS NOT NULL
     AND l.maturity_precision IS NULL
     AND l.maturity_source IN ('REPORTED_STRUCTURED', 'FILING_DISPLAYED')
    THEN e.maturity_date IS DISTINCT FROM l.maturity_date
    WHEN e.maturity_precision = 'MONTH'
     AND l.maturity_precision = 'MONTH'
     AND e.maturity_year IS NOT NULL
     AND e.maturity_month IS NOT NULL
     AND l.maturity_year IS NOT NULL
     AND l.maturity_month IS NOT NULL
     AND e.maturity_source IN ('REPORTED_MONTH', 'FILING_MONTH')
     AND l.maturity_source IN ('REPORTED_MONTH', 'FILING_MONTH')
    THEN e.maturity_year IS DISTINCT FROM l.maturity_year
      OR e.maturity_month IS DISTINCT FROM l.maturity_month
  END AS maturity_changed,
  CASE
    WHEN e.acquisition_state = 'REPORTED'
     AND e.acquisition_date IS NOT NULL
     AND e.acquisition_precision IS NULL
     AND l.acquisition_state = 'REPORTED'
     AND l.acquisition_date IS NOT NULL
     AND l.acquisition_precision IS NULL
    THEN 'COMPARABLE'
    WHEN e.acquisition_state = 'REPORTED'
     AND e.acquisition_precision = 'MONTH'
     AND e.acquisition_year IS NOT NULL
     AND e.acquisition_month IS NOT NULL
     AND l.acquisition_state = 'REPORTED'
     AND l.acquisition_precision = 'MONTH'
     AND l.acquisition_year IS NOT NULL
     AND l.acquisition_month IS NOT NULL
    THEN 'COMPARABLE'
    ELSE 'INSUFFICIENT_DATA'
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
    WHEN e.interest_rate_state = 'REPORTED' AND e.interest_rate_numeric IS NOT NULL
     AND l.interest_rate_state = 'REPORTED' AND l.interest_rate_numeric IS NOT NULL
    THEN 'COMPARABLE'
    ELSE 'INSUFFICIENT_DATA'
  END AS interest_rate_comparison_state,
  e.interest_rate_raw AS earlier_interest_rate_raw,
  l.interest_rate_raw AS later_interest_rate_raw,
  e.interest_rate_numeric AS earlier_interest_rate_numeric,
  l.interest_rate_numeric AS later_interest_rate_numeric,
  CASE
    WHEN e.interest_rate_state = 'REPORTED' AND e.interest_rate_numeric IS NOT NULL
     AND l.interest_rate_state = 'REPORTED' AND l.interest_rate_numeric IS NOT NULL
    THEN l.interest_rate_numeric - e.interest_rate_numeric
  END AS interest_rate_delta,
  CASE
    WHEN e.interest_rate_state = 'REPORTED' AND e.interest_rate_numeric IS NOT NULL
     AND l.interest_rate_state = 'REPORTED' AND l.interest_rate_numeric IS NOT NULL
    THEN l.interest_rate_numeric IS DISTINCT FROM e.interest_rate_numeric
  END AS interest_rate_changed,
  CASE
    WHEN e.spread_state = 'REPORTED' AND e.spread_numeric IS NOT NULL
     AND l.spread_state = 'REPORTED' AND l.spread_numeric IS NOT NULL
    THEN 'COMPARABLE'
    ELSE 'INSUFFICIENT_DATA'
  END AS spread_comparison_state,
  e.spread_raw AS earlier_spread_raw,
  l.spread_raw AS later_spread_raw,
  e.spread_numeric AS earlier_spread_numeric,
  l.spread_numeric AS later_spread_numeric,
  CASE
    WHEN e.spread_state = 'REPORTED' AND e.spread_numeric IS NOT NULL
     AND l.spread_state = 'REPORTED' AND l.spread_numeric IS NOT NULL
    THEN l.spread_numeric - e.spread_numeric
  END AS spread_delta,
  CASE
    WHEN e.spread_state = 'REPORTED' AND e.spread_numeric IS NOT NULL
     AND l.spread_state = 'REPORTED' AND l.spread_numeric IS NOT NULL
    THEN l.spread_numeric IS DISTINCT FROM e.spread_numeric
  END AS spread_changed,
  CASE
    WHEN e.interest_rate_floor_state = 'REPORTED' AND e.interest_rate_floor_numeric IS NOT NULL
     AND l.interest_rate_floor_state = 'REPORTED' AND l.interest_rate_floor_numeric IS NOT NULL
    THEN 'COMPARABLE'
    ELSE 'INSUFFICIENT_DATA'
  END AS interest_rate_floor_comparison_state,
  e.interest_rate_floor_raw AS earlier_interest_rate_floor_raw,
  l.interest_rate_floor_raw AS later_interest_rate_floor_raw,
  e.interest_rate_floor_numeric AS earlier_interest_rate_floor_numeric,
  l.interest_rate_floor_numeric AS later_interest_rate_floor_numeric,
  CASE
    WHEN e.interest_rate_floor_state = 'REPORTED' AND e.interest_rate_floor_numeric IS NOT NULL
     AND l.interest_rate_floor_state = 'REPORTED' AND l.interest_rate_floor_numeric IS NOT NULL
    THEN l.interest_rate_floor_numeric - e.interest_rate_floor_numeric
  END AS interest_rate_floor_delta,
  CASE
    WHEN e.interest_rate_floor_state = 'REPORTED' AND e.interest_rate_floor_numeric IS NOT NULL
     AND l.interest_rate_floor_state = 'REPORTED' AND l.interest_rate_floor_numeric IS NOT NULL
    THEN l.interest_rate_floor_numeric IS DISTINCT FROM e.interest_rate_floor_numeric
  END AS interest_rate_floor_changed
FROM endpoints e
JOIN endpoints l
  ON l.position_id = e.position_id
 AND l.reported_date > e.reported_date
 AND l.position_observation_id <> e.position_observation_id
WHERE NOT EXISTS (
  SELECT 1
  FROM confirmed mid
  WHERE mid.position_id = e.position_id
    AND mid.reported_date > e.reported_date
    AND mid.reported_date < l.reported_date
);

COMMENT ON VIEW registry.position_period_comparison IS
  'One comparison for one identity.position and two consecutive MATCHED observations with strictly increasing reported dates. Both observations must be the only MATCHED observation of that position on their reporting date. Delta is later normalized value minus earlier normalized value when both are stored. A missing value is INSUFFICIENT_DATA and null. Observed field change is not itself a credit event. Absence of a later observation is not evidence of repayment or exit.';

COMMENT ON COLUMN registry.position_period_comparison.principal_delta IS
  'Later principal_numeric minus earlier principal_numeric when both are stored. Null when either side is missing. Unknown is not zero.';

COMMENT ON COLUMN registry.position_period_comparison.cost_delta IS
  'Later stored COST minus earlier stored COST when both normalized numbers are stored. Null when either side is missing.';

COMMENT ON COLUMN registry.position_period_comparison.fair_value_delta IS
  'Later fair_value_numeric minus earlier fair_value_numeric when both are stored. A decrease is a numeric delta, not a credit event.';

COMMENT ON COLUMN registry.position_period_comparison.maturity_changed IS
  'True when both maturities are comparable calendar days and the days differ, or both are month precision and the year or month differs. Null when the two precisions are not comparable. A month is not converted to a day.';

COMMENT ON COLUMN registry.position_period_comparison.acquisition_comparison_state IS
  'COMPARABLE when both stored acquisition values share calendar-day precision or both share month precision. A difference is not an origination.';

COMMENT ON COLUMN registry.position_period_comparison.interest_rate_delta IS
  'Later interest_rate_numeric minus earlier interest_rate_numeric when both are stored. A reported raw rate with no normalized number is not subtracted.';


-- 0040 borrower historical position observations.
-- One matched legal entity's rows from registry.position_read.
-- The function does not resolve names, merge instruments, or derive amounts.

CREATE OR REPLACE FUNCTION registry.borrower_position_observations(p_legal_entity_id uuid)
RETURNS TABLE (
  legal_entity_id text,
  position_observation_id text,
  reported_date text,
  accession_number text,
  registrant_cik text,
  registrant_link_status text,
  entity_resolution_state text,
  instrument_resolution_state text,
  continuity_state text,
  economic_group_state text,
  principal_state text,
  principal_raw text,
  principal_currency_state text,
  cost_state text,
  cost_raw text,
  cost_currency_state text,
  fair_value_state text,
  fair_value_raw text,
  fair_value_currency_state text,
  acquisition_state text,
  acquisition_raw text,
  acquisition_precision text,
  interest_rate_state text,
  interest_rate_raw text,
  spread_state text,
  spread_raw text,
  interest_rate_floor_state text,
  interest_rate_floor_raw text,
  maturity_source text,
  maturity_raw text,
  maturity_precision text,
  maturity_filing_verified boolean,
  maturity_document_url text,
  observation_evidence_level text
)
LANGUAGE sql
STABLE
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

COMMENT ON FUNCTION registry.borrower_position_observations(uuid) IS
  'Matched position observations for one legal entity, read from registry.position_read. Newest reported date first. A missing field stays the stored UNKNOWN state. Absence of a later period is not a row.';

REVOKE ALL ON FUNCTION registry.borrower_position_observations(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION registry.borrower_position_observations(uuid) TO bdc_reader;


-- 0042 borrower confirmed position comparisons.
-- Rows from registry.position_period_comparison whose earlier and later
-- observations are both MATCHED to the same legal entity on registry.position_read.
-- Deltas, comparison states, and maturity precision are copied. They are not recomputed.

CREATE OR REPLACE FUNCTION registry.borrower_position_comparisons(p_legal_entity_id uuid)
RETURNS TABLE (
  legal_entity_id text,
  position_id text,
  earlier_position_observation_id text,
  later_position_observation_id text,
  earlier_reported_date text,
  later_reported_date text,
  earlier_accession_number text,
  later_accession_number text,
  earlier_observation_evidence_id text,
  later_observation_evidence_id text,
  earlier_observation_evidence_level text,
  later_observation_evidence_level text,
  earlier_registrant_cik text,
  earlier_registrant_link_status text,
  later_registrant_cik text,
  later_registrant_link_status text,
  principal_comparison_state text,
  earlier_principal_raw text,
  later_principal_raw text,
  principal_delta text,
  earlier_principal_currency_state text,
  later_principal_currency_state text,
  cost_comparison_state text,
  earlier_cost_raw text,
  later_cost_raw text,
  cost_delta text,
  earlier_cost_currency_state text,
  later_cost_currency_state text,
  fair_value_comparison_state text,
  earlier_fair_value_raw text,
  later_fair_value_raw text,
  fair_value_delta text,
  earlier_fair_value_currency_state text,
  later_fair_value_currency_state text,
  maturity_comparison_state text,
  maturity_changed boolean,
  earlier_maturity_raw text,
  later_maturity_raw text,
  earlier_maturity_precision text,
  later_maturity_precision text,
  earlier_maturity_date text,
  later_maturity_date text,
  acquisition_comparison_state text,
  earlier_acquisition_raw text,
  later_acquisition_raw text,
  earlier_acquisition_precision text,
  later_acquisition_precision text,
  earlier_acquisition_date text,
  later_acquisition_date text,
  interest_rate_comparison_state text,
  earlier_interest_rate_raw text,
  later_interest_rate_raw text,
  interest_rate_delta text,
  spread_comparison_state text,
  earlier_spread_raw text,
  later_spread_raw text,
  spread_delta text,
  interest_rate_floor_comparison_state text,
  earlier_interest_rate_floor_raw text,
  later_interest_rate_floor_raw text,
  interest_rate_floor_delta text
)
LANGUAGE sql
STABLE
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

COMMENT ON FUNCTION registry.borrower_position_comparisons(uuid) IS
  'Confirmed position comparisons for one legal entity. Both observations must be MATCHED to that entity on registry.position_read. Values and deltas are copied from registry.position_period_comparison. A field change is not a credit event.';

REVOKE ALL ON FUNCTION registry.borrower_position_comparisons(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION registry.borrower_position_comparisons(uuid) TO bdc_reader;


SELECT ops.grant_layer_privileges();
