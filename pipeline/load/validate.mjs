// Cross-source checks (P2-D18). SUB and submissions values stay side by side; a disagreement
// is a FAIL validation result plus supplementary evidence for the other source. No winner.

import { num, queryRows } from "../lib/db.mjs";

export function insertCrossSourceValidations({ database, runId, ruleId }) {
  const sql = `
BEGIN;
CREATE TEMP TABLE _pairs ON COMMIT DROP AS
SELECT f.id AS filing_id, f.accession_number,
       sub.normalized_text AS sub_form, sub.normalized_date AS sub_filed, sub.evidence_id AS sub_evidence_id,
       sj.normalized_text AS sj_form, sj.normalized_date AS sj_filed, sj.evidence_id AS sj_evidence_id
FROM registry.filing f
JOIN registry.current_filing_attribute sub
  ON sub.filing_id = f.id AND sub.attribute_code = 'FORM' AND sub.source_type_code = 'SEC_BDC_DATASET_ZIP'
JOIN registry.current_filing_attribute sj
  ON sj.filing_id = f.id AND sj.attribute_code = 'FORM'
 AND sj.source_type_code IN ('SEC_SUBMISSIONS_JSON', 'SEC_SUBMISSIONS_PAGE_JSON');

CREATE TEMP TABLE _form_fail ON COMMIT DROP AS
SELECT p.*, 'FORM differs between SUB (' || coalesce(p.sub_form, '') || ') and submissions (' || coalesce(p.sj_form, '') || ')' AS detail
FROM _pairs p
WHERE p.sub_form IS DISTINCT FROM p.sj_form
  AND NOT EXISTS (
    SELECT 1 FROM validation.validation_result v
    WHERE v.subject_table = 'registry.filing' AND v.subject_id = p.filing_id
      AND v.rule_version_id = ${num(ruleId)} AND v.outcome = 'FAIL' AND v.detail LIKE 'FORM differs%');

CREATE TEMP TABLE _date_pairs ON COMMIT DROP AS
SELECT f.id AS filing_id,
       sub.normalized_date AS sub_filed, sub.evidence_id AS sub_evidence_id,
       sj.normalized_date AS sj_filed, sj.evidence_id AS sj_evidence_id
FROM registry.filing f
JOIN registry.current_filing_attribute sub
  ON sub.filing_id = f.id AND sub.attribute_code = 'FILED_DATE' AND sub.source_type_code = 'SEC_BDC_DATASET_ZIP'
JOIN registry.current_filing_attribute sj
  ON sj.filing_id = f.id AND sj.attribute_code = 'FILED_DATE'
 AND sj.source_type_code IN ('SEC_SUBMISSIONS_JSON', 'SEC_SUBMISSIONS_PAGE_JSON');

CREATE TEMP TABLE _date_fail ON COMMIT DROP AS
SELECT d.*, 'FILED_DATE differs between SUB (' || coalesce(d.sub_filed::text, '') || ') and submissions (' || coalesce(d.sj_filed::text, '') || ')' AS detail
FROM _date_pairs d
WHERE d.sub_filed IS DISTINCT FROM d.sj_filed
  AND NOT EXISTS (
    SELECT 1 FROM validation.validation_result v
    WHERE v.subject_table = 'registry.filing' AND v.subject_id = d.filing_id
      AND v.rule_version_id = ${num(ruleId)} AND v.outcome = 'FAIL' AND v.detail LIKE 'FILED_DATE differs%');

CREATE TEMP TABLE _cik_fail ON COMMIT DROP AS
SELECT f.id AS filing_id, sl.evidence_id AS sub_evidence_id, jl.evidence_id AS sj_evidence_id,
       'registrant CIK differs between SUB and submissions; both links are kept' AS detail
FROM registry.filing f
JOIN registry.current_filing_registrant sl ON sl.filing_id = f.id AND sl.link_source = 'SUB_TABLE'
JOIN registry.current_filing_registrant jl ON jl.filing_id = f.id AND jl.link_source = 'SUBMISSIONS_JSON'
WHERE sl.registrant_id IS DISTINCT FROM jl.registrant_id
  AND NOT EXISTS (
    SELECT 1 FROM validation.validation_result v
    WHERE v.subject_table = 'registry.filing' AND v.subject_id = f.id
      AND v.rule_version_id = ${num(ruleId)} AND v.outcome = 'FAIL' AND v.detail LIKE 'registrant CIK differs%');

WITH ins AS (
  INSERT INTO validation.validation_result (subject_table, subject_id, rule_version_id, outcome, detail, evidence_id, run_id)
  SELECT 'registry.filing', filing_id, ${num(ruleId)}, 'FAIL', detail, sub_evidence_id, ${num(runId)}
  FROM (
    SELECT filing_id, detail, sub_evidence_id, sj_evidence_id FROM (
      SELECT DISTINCT ON (filing_id, detail) filing_id, detail, sub_evidence_id, sj_evidence_id
      FROM _form_fail ORDER BY filing_id, detail) form_fail
    UNION ALL
    SELECT filing_id, detail, sub_evidence_id, sj_evidence_id FROM (
      SELECT DISTINCT ON (filing_id, detail) filing_id, detail, sub_evidence_id, sj_evidence_id
      FROM _date_fail ORDER BY filing_id, detail) date_fail
    UNION ALL
    SELECT filing_id, detail, sub_evidence_id, sj_evidence_id FROM (
      SELECT DISTINCT ON (filing_id, detail) filing_id, detail, sub_evidence_id, sj_evidence_id
      FROM _cik_fail ORDER BY filing_id, detail) cik_fail
  ) x
  RETURNING id, subject_id, detail)
INSERT INTO evidence.supplementary_evidence (subject_table, subject_id, evidence_id, role, note, run_id)
SELECT 'validation.validation_result', ins.id, x.sj_evidence_id, 'CONTRADICTS', 'other source of the same filing fact', ${num(runId)}
FROM ins
JOIN (
  SELECT filing_id, detail, sj_evidence_id FROM _form_fail
  UNION ALL SELECT filing_id, detail, sj_evidence_id FROM _date_fail
  UNION ALL SELECT filing_id, detail, sj_evidence_id FROM _cik_fail
) x ON x.filing_id = ins.subject_id AND x.detail = ins.detail;

SELECT 'counts', jsonb_build_object(
  'cross_source_form_fail', (SELECT count(*) FROM _form_fail),
  'cross_source_filed_date_fail', (SELECT count(*) FROM _date_fail),
  'cross_source_cik_fail', (SELECT count(*) FROM _cik_fail)
)::text;
COMMIT;`;
  const lines = queryRows(database, sql);
  const row = lines.find((l) => (Array.isArray(l) ? l[0] : String(l).split("\t")[0]) === "counts");
  return row ? JSON.parse(Array.isArray(row) ? row.slice(1).join("\t") : String(row).slice("counts\t".length)) : {};
}
