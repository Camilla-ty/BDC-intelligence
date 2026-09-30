-- 0016 P14 portfolio listing.
-- Read-only views for bdc_reader. One row is a disclosed SOI line or a count of those lines.
-- No cost, fair value, rate, spread, borrower identity, or instrument identity.
-- A missing field is absent from the line attributes and displayed as UNKNOWN. It is not zero.

CREATE INDEX position_observation_filing_date_idx
  ON obs.position_observation (filing_id, reported_date, id);

-- One CIK per filing. Two links that name the same CIK stay LINKED.
-- Disagreeing CIKs stay UNRESOLVED and the CIK is omitted. No link is chosen.
CREATE VIEW registry.portfolio_filing_registrant AS
SELECT filing_id,
       CASE WHEN count(DISTINCT registrant_id) = 1 THEN min(registrant_id) END AS registrant_id,
       CASE WHEN count(DISTINCT cik) = 1 THEN lpad(min(cik)::text, 10, '0') END AS registrant_cik,
       CASE WHEN count(DISTINCT cik) = 1 THEN 'LINKED' ELSE 'UNRESOLVED' END AS registrant_link_status
FROM registry.current_filing_registrant
WHERE registrant_link_status = 'LINKED'
GROUP BY filing_id;
COMMENT ON VIEW registry.portfolio_filing_registrant IS
  'Filing registrant for portfolio reads. LINKED only when every current linked row names one CIK.';

CREATE VIEW registry.portfolio_registrant AS
SELECT fr.registrant_id,
       fr.registrant_cik,
       ns.attribute_state AS name_state,
       CASE WHEN ns.attribute_state = 'REPORTED' THEN nm.raw_value END AS name_raw,
       ts.attribute_state AS ticker_state,
       CASE WHEN ts.attribute_state = 'REPORTED' THEN tm.raw_value END AS ticker_raw,
       fs.attribute_state AS file_number_state,
       CASE WHEN fs.attribute_state = 'REPORTED' THEN fm.raw_value END AS file_number_raw,
       count(DISTINCT p.reported_date)::integer AS reported_date_count
FROM obs.position_observation p
JOIN registry.portfolio_filing_registrant fr
  ON fr.filing_id = p.filing_id AND fr.registrant_link_status = 'LINKED'
JOIN registry.registrant_attribute_status ns
  ON ns.registrant_id = fr.registrant_id AND ns.attribute_code = 'NAME'
JOIN registry.registrant_attribute_status ts
  ON ts.registrant_id = fr.registrant_id AND ts.attribute_code = 'TICKER'
JOIN registry.registrant_attribute_status fs
  ON fs.registrant_id = fr.registrant_id AND fs.attribute_code = 'FILE_NUMBER'
LEFT JOIN LATERAL (
  SELECT min(a.raw_value) AS raw_value
  FROM registry.current_registrant_attribute a
  WHERE a.registrant_id = fr.registrant_id AND a.attribute_code = 'NAME'
) nm ON ns.attribute_state = 'REPORTED'
LEFT JOIN LATERAL (
  SELECT min(a.raw_value) AS raw_value
  FROM registry.current_registrant_attribute a
  WHERE a.registrant_id = fr.registrant_id AND a.attribute_code = 'TICKER'
) tm ON ts.attribute_state = 'REPORTED'
LEFT JOIN LATERAL (
  SELECT min(a.raw_value) AS raw_value
  FROM registry.current_registrant_attribute a
  WHERE a.registrant_id = fr.registrant_id AND a.attribute_code = 'FILE_NUMBER'
) fm ON fs.attribute_state = 'REPORTED'
GROUP BY fr.registrant_id, fr.registrant_cik, ns.attribute_state, nm.raw_value,
         ts.attribute_state, tm.raw_value, fs.attribute_state, fm.raw_value;
COMMENT ON VIEW registry.portfolio_registrant IS
  'Registrants that have position observations. reported_date_count is a count of disclosed dates, not holdings or exposure. A name is present only when current sources agree.';

CREATE VIEW registry.portfolio_registrant_name AS
SELECT r.registrant_cik,
       a.source_type_code,
       a.raw_value,
       a.documentation_status::text AS documentation_status
FROM registry.portfolio_registrant r
JOIN registry.current_registrant_attribute a
  ON a.registrant_id = r.registrant_id AND a.attribute_code = 'NAME';
COMMENT ON VIEW registry.portfolio_registrant_name IS
  'Each current registrant-name source, unmerged. Disagreeing values stay on separate rows.';

CREATE VIEW registry.portfolio_reported_date AS
SELECT fr.registrant_cik,
       p.reported_date,
       count(*)::integer AS disclosed_line_count,
       count(*) FILTER (WHERE p.duration_kind = 'POINT_IN_TIME')::integer AS point_in_time_line_count,
       count(*) FILTER (WHERE p.duration_kind = 'DURATION')::integer AS duration_line_count
FROM obs.position_observation p
JOIN registry.portfolio_filing_registrant fr
  ON fr.filing_id = p.filing_id AND fr.registrant_link_status = 'LINKED'
WHERE p.reported_date IS NOT NULL
GROUP BY fr.registrant_cik, p.reported_date;
COMMENT ON VIEW registry.portfolio_reported_date IS
  'Disclosed-line counts by registrant and reported date. A date that is absent was not observed. Counts are rows, not amounts.';

CREATE VIEW registry.portfolio_empty_period AS
SELECT dr.release_label
FROM obs.current_soi_coverage c
JOIN registry.dataset_release dr ON dr.id = c.dataset_release_id
WHERE c.registrant_id IS NULL
  AND c.source_type_code = 'SEC_BDC_DATASET_ZIP'
  AND c.coverage_state = 'EMPTY_PERIOD';
COMMENT ON VIEW registry.portfolio_empty_period IS
  'Dataset releases with no SOI rows. Empty means unavailable, not a zero portfolio.';

CREATE VIEW registry.portfolio_line AS
SELECT p.id AS position_observation_id,
       fr.registrant_cik,
       p.reported_date,
       p.duration_kind::text AS duration_kind,
       o.qtrs,
       coalesce(cl.period_role::text, 'UNKNOWN') AS period_role,
       p.holding_descriptor_raw AS disclosed_line_text,
       f.accession_number,
       e.evidence_level::text AS evidence_level,
       attrs.principal_state,
       attrs.principal_raw,
       'UNKNOWN'::text AS principal_currency_state,
       attrs.maturity_state,
       attrs.maturity_raw,
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
FROM obs.position_observation p
JOIN obs.soi_row_observation o ON o.id = p.origin_soi_row_observation_id
JOIN registry.filing f ON f.id = p.filing_id
JOIN evidence.evidence e ON e.id = p.evidence_id
JOIN registry.portfolio_filing_registrant fr
  ON fr.filing_id = p.filing_id AND fr.registrant_link_status = 'LINKED'
LEFT JOIN obs.current_soi_row_classification cl ON cl.soi_row_observation_id = o.id
LEFT JOIN LATERAL (
  SELECT
    CASE WHEN count(DISTINCT fv.raw_value) FILTER (WHERE fv.field_code = 'PRINCIPAL_AMOUNT') = 1 THEN 'REPORTED'
         WHEN count(*) FILTER (WHERE fv.field_code = 'PRINCIPAL_AMOUNT') = 0 THEN 'UNKNOWN'
         ELSE 'MULTIPLE_VALUES' END AS principal_state,
    CASE WHEN count(DISTINCT fv.raw_value) FILTER (WHERE fv.field_code = 'PRINCIPAL_AMOUNT') = 1
         THEN min(fv.raw_value) FILTER (WHERE fv.field_code = 'PRINCIPAL_AMOUNT') END AS principal_raw,
    CASE WHEN count(DISTINCT fv.raw_value) FILTER (WHERE fv.field_code = 'MATURITY_DATE') = 1 THEN 'REPORTED'
         WHEN count(*) FILTER (WHERE fv.field_code = 'MATURITY_DATE') = 0 THEN 'UNKNOWN'
         ELSE 'MULTIPLE_VALUES' END AS maturity_state,
    CASE WHEN count(DISTINCT fv.raw_value) FILTER (WHERE fv.field_code = 'MATURITY_DATE') = 1
         THEN min(fv.raw_value) FILTER (WHERE fv.field_code = 'MATURITY_DATE') END AS maturity_raw,
    CASE WHEN count(DISTINCT fv.raw_value) FILTER (WHERE fv.field_code = 'INSTRUMENT_TYPE') = 1 THEN 'REPORTED'
         WHEN count(*) FILTER (WHERE fv.field_code = 'INSTRUMENT_TYPE') = 0 THEN 'UNKNOWN'
         ELSE 'MULTIPLE_VALUES' END AS instrument_type_state,
    CASE WHEN count(DISTINCT fv.raw_value) FILTER (WHERE fv.field_code = 'INSTRUMENT_TYPE') = 1
         THEN min(fv.raw_value) FILTER (WHERE fv.field_code = 'INSTRUMENT_TYPE') END AS instrument_type_raw,
    CASE WHEN count(DISTINCT fv.raw_value) FILTER (WHERE fv.field_code = 'INDUSTRY') = 1 THEN 'REPORTED'
         WHEN count(*) FILTER (WHERE fv.field_code = 'INDUSTRY') = 0 THEN 'UNKNOWN'
         ELSE 'MULTIPLE_VALUES' END AS industry_state,
    CASE WHEN count(DISTINCT fv.raw_value) FILTER (WHERE fv.field_code = 'INDUSTRY') = 1
         THEN min(fv.raw_value) FILTER (WHERE fv.field_code = 'INDUSTRY') END AS industry_raw,
    CASE WHEN count(DISTINCT fv.raw_value) FILTER (WHERE fv.field_code = 'ISSUER_AFFILIATION') = 1 THEN 'REPORTED'
         WHEN count(*) FILTER (WHERE fv.field_code = 'ISSUER_AFFILIATION') = 0 THEN 'UNKNOWN'
         ELSE 'MULTIPLE_VALUES' END AS affiliation_state,
    CASE WHEN count(DISTINCT fv.raw_value) FILTER (WHERE fv.field_code = 'ISSUER_AFFILIATION') = 1
         THEN min(fv.raw_value) FILTER (WHERE fv.field_code = 'ISSUER_AFFILIATION') END AS affiliation_raw,
    CASE WHEN count(DISTINCT fv.raw_value) FILTER (WHERE fv.field_code = 'GEOGRAPHY') = 1 THEN 'REPORTED'
         WHEN count(*) FILTER (WHERE fv.field_code = 'GEOGRAPHY') = 0 THEN 'UNKNOWN'
         ELSE 'MULTIPLE_VALUES' END AS geography_state,
    CASE WHEN count(DISTINCT fv.raw_value) FILTER (WHERE fv.field_code = 'GEOGRAPHY') = 1
         THEN min(fv.raw_value) FILTER (WHERE fv.field_code = 'GEOGRAPHY') END AS geography_raw,
    CASE WHEN count(DISTINCT fv.raw_value) FILTER (WHERE fv.field_code = 'ACQUISITION_DATE') = 1 THEN 'REPORTED'
         WHEN count(*) FILTER (WHERE fv.field_code = 'ACQUISITION_DATE') = 0 THEN 'UNKNOWN'
         ELSE 'MULTIPLE_VALUES' END AS acquisition_date_state,
    CASE WHEN count(DISTINCT fv.raw_value) FILTER (WHERE fv.field_code = 'ACQUISITION_DATE') = 1
         THEN min(fv.raw_value) FILTER (WHERE fv.field_code = 'ACQUISITION_DATE') END AS acquisition_date_raw,
    CASE WHEN count(DISTINCT fv.raw_value) FILTER (WHERE fv.field_code = 'RESTRICTED') = 1 THEN 'REPORTED'
         WHEN count(*) FILTER (WHERE fv.field_code = 'RESTRICTED') = 0 THEN 'UNKNOWN'
         ELSE 'MULTIPLE_VALUES' END AS restricted_state,
    CASE WHEN count(DISTINCT fv.raw_value) FILTER (WHERE fv.field_code = 'RESTRICTED') = 1
         THEN min(fv.raw_value) FILTER (WHERE fv.field_code = 'RESTRICTED') END AS restricted_raw,
    CASE WHEN count(DISTINCT fv.raw_value) FILTER (WHERE fv.field_code = 'REFERENCE_RATE') = 1 THEN 'REPORTED'
         WHEN count(*) FILTER (WHERE fv.field_code = 'REFERENCE_RATE') = 0 THEN 'UNKNOWN'
         ELSE 'MULTIPLE_VALUES' END AS reference_uri_state,
    CASE WHEN count(DISTINCT fv.raw_value) FILTER (WHERE fv.field_code = 'REFERENCE_RATE') = 1
         THEN min(fv.raw_value) FILTER (WHERE fv.field_code = 'REFERENCE_RATE') END AS reference_uri_raw
  FROM obs.current_position_field_value fv
  WHERE fv.position_observation_id = p.id
    AND fv.field_code IN (
      'PRINCIPAL_AMOUNT', 'MATURITY_DATE', 'INSTRUMENT_TYPE', 'INDUSTRY',
      'ISSUER_AFFILIATION', 'GEOGRAPHY', 'ACQUISITION_DATE', 'RESTRICTED', 'REFERENCE_RATE')
) attrs ON true
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
  SELECT doc.document_name, doc.document_url
  FROM registry.filing_document doc
  WHERE doc.filing_id = p.filing_id
    AND doc.document_url ~ '^https://www\.sec\.gov/Archives/edgar/data/'
  ORDER BY CASE WHEN doc.named_by = 'SUBMISSIONS_PRIMARY_DOCUMENT' THEN 0 ELSE 1 END, doc.id
  LIMIT 1
) doc ON true
LEFT JOIN LATERAL (
  SELECT
    CASE WHEN count(DISTINCT dr.release_label) = 1 THEN 'REPORTED'
         WHEN count(*) = 0 THEN 'UNKNOWN'
         ELSE 'MULTIPLE_VALUES' END AS release_state,
    CASE WHEN count(DISTINCT dr.release_label) = 1 THEN min(dr.release_label) END AS release_label
  FROM raw.tabular_row tr
  JOIN raw.table_load tl ON tl.id = tr.table_load_id
  JOIN registry.dataset_release_artifact dra ON dra.artifact_id = tl.artifact_id
  JOIN registry.dataset_release dr ON dr.id = dra.dataset_release_id
  WHERE tr.id = o.tabular_row_id
) rel ON true;
COMMENT ON VIEW registry.portfolio_line IS
  'One disclosed SOI position line. Principal currency is UNKNOWN. Cost, fair value, rates, and spreads are omitted. period_role stays the stored classification.';

SELECT ops.grant_layer_privileges();
