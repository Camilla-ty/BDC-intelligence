// P5-min: load fetched Golden filing documents and record exact-string filing checks.
// Inserts only. Never updates SOI, position, or field-value rows. No universe scan.
// Does not construct SEC URLs; uses registry.filing_document.document_url as stored.

import { artifactBlock } from "./sql.mjs";
import { copyBlock, lit, num, queryRows, runScript } from "../lib/db.mjs";
import { DEFAULT_DATA_DIR } from "../lib/config.mjs";
import { createStore } from "../lib/store.mjs";
import { needleInFiling } from "../normalize/filing-text.mjs";

export const GOLDEN_ECONOMIC_FIELDS = Object.freeze([
  "PRINCIPAL_AMOUNT",
  "COST",
  "FAIR_VALUE",
  "MATURITY_DATE",
  "INTEREST_RATE",
  "SPREAD",
  "PIK_RATE",
  "CASH_RATE",
  "INTEREST_RATE_FLOOR",
  "PERCENT_OF_NET_ASSETS",
  "ACQUISITION_DATE",
  "ISSUER_NAME",
  "INSTRUMENT_TYPE",
]);

function intIds(ids) {
  const out = [];
  const seen = new Set();
  for (const raw of ids) {
    const id = Number(raw);
    if (!Number.isSafeInteger(id) || id < 1) throw new Error(`invalid position_observation_id: ${raw}`);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function parseJsonCell(rows) {
  if (rows.length === 0) return null;
  return JSON.parse(rows[0][0]);
}

export function snapshotP5Min(database, positionObservationIds) {
  const ids = intIds(positionObservationIds);
  const list = ids.join(",");
  const fields = GOLDEN_ECONOMIC_FIELDS.map((c) => lit(c)).join(",");
  return parseJsonCell(queryRows(database, `
SELECT json_build_object(
  'soi_row_observation_count', (SELECT count(*) FROM obs.soi_row_observation),
  'position_observation_count', (SELECT count(*) FROM obs.position_observation),
  'position_field_value_count', (SELECT count(*) FROM obs.position_field_value),
  'borrower_name_observation_count', (SELECT count(*) FROM obs.borrower_name_observation),
  'max_soi_row_observation_id', (SELECT coalesce(max(id), 0) FROM obs.soi_row_observation),
  'max_position_observation_id', (SELECT coalesce(max(id), 0) FROM obs.position_observation),
  'max_position_field_value_id', (SELECT coalesce(max(id), 0) FROM obs.position_field_value),
  'derived_value_input_count', (SELECT count(*) FROM derived.derived_value_input),
  'l2_evidence_count', (SELECT count(*) FROM evidence.evidence WHERE evidence_level = 'L2_ORIGINAL_FILING'),
  'filing_document_artifact_count', (SELECT count(*) FROM registry.filing_document_artifact),
  'golden_borrower_name_count', (
    SELECT count(*) FROM obs.borrower_name_observation WHERE position_observation_id IN (${list})),
  'golden_l2_artifacts', (
    SELECT count(*) FROM registry.filing_document_artifact fda
    JOIN registry.filing_document d ON d.id = fda.filing_document_id
    JOIN obs.position_observation p ON p.filing_id = d.filing_id
    WHERE p.id IN (${list})),
  'golden_field_evidence_status', (
    SELECT coalesce(json_object_agg(status, n), '{}'::json)
    FROM (
      SELECT coalesce(es.evidence_status::text, 'NOT_CHECKED') AS status, count(*) AS n
      FROM obs.current_position_field_value fv
      LEFT JOIN validation.current_evidence_status es ON es.field_value_id = fv.id
      WHERE fv.position_observation_id IN (${list})
        AND fv.value_state = 'REPORTED'
        AND coalesce(fv.raw_value, '') <> ''
        AND fv.field_code IN (${fields})
      GROUP BY 1) s)
);`));
}

export function listGoldenFilingDocuments(database, positionObservationIds) {
  const ids = intIds(positionObservationIds);
  const list = ids.join(",");
  const parsed = parseJsonCell(queryRows(database, `
SELECT coalesce(json_agg(json_build_object(
         'filing_document_id', d.id,
         'filing_id', d.filing_id,
         'document_url', d.document_url,
         'named_by', d.named_by)
       ORDER BY d.id), '[]'::json)
FROM (
  SELECT DISTINCT d.id, d.filing_id, d.document_url, d.named_by
  FROM registry.filing_document d
  JOIN obs.position_observation p ON p.filing_id = d.filing_id
  WHERE p.id IN (${list})
) d;`));
  return parsed;
}

export function loadGoldenFilingDocuments({ database, runId, rules, documents, fetchEntriesByUrl }) {
  const loaderRuleId = rules["pipeline.p5_golden"];
  if (!loaderRuleId) throw new Error("missing rule id for pipeline.p5_golden");
  const counts = { artifacts_inserted: 0, document_links: 0, l2_evidence: 0, unavailable: 0, loaded: 0 };

  for (const doc of documents) {
    const entry = fetchEntriesByUrl[doc.document_url];
    if (!entry) {
      throw new Error("P5-min: a Golden document_url has no fetch-log entry");
    }
    if (entry.http_status !== 200 || !entry.sha256 || !entry.storage_key) {
      counts.unavailable += 1;
      continue;
    }
    const sql = `
BEGIN;
CREATE TEMP TABLE _ctx (k text PRIMARY KEY, v bigint) ON COMMIT DROP;
CREATE TEMP TABLE _p5c (k text PRIMARY KEY, n bigint NOT NULL) ON COMMIT DROP;
CREATE FUNCTION pg_temp.ctx(key text) RETURNS bigint LANGUAGE sql STABLE AS $f$ SELECT v FROM _ctx WHERE k = key $f$;
${artifactBlock("artifact", { ...entry, source_type: "SEC_FILING_DOCUMENT" }, runId)}

INSERT INTO registry.filing_document_artifact (filing_document_id, artifact_id, run_id)
SELECT ${num(doc.filing_document_id)}, pg_temp.ctx('artifact'), ${num(runId)}
WHERE NOT EXISTS (
  SELECT 1 FROM registry.filing_document_artifact x
  WHERE x.filing_document_id = ${num(doc.filing_document_id)} AND x.artifact_id = pg_temp.ctx('artifact'));
INSERT INTO _p5c SELECT 'document_links', (SELECT count(*) FROM registry.filing_document_artifact
  WHERE filing_document_id = ${num(doc.filing_document_id)} AND artifact_id = pg_temp.ctx('artifact')
    AND run_id = ${num(runId)});

INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, join_note, run_id)
SELECT 'L2_ORIGINAL_FILING'::ref.evidence_level, pg_temp.ctx('artifact'), 'DOCUMENT'::ref.locator_type,
       'P5-min whole-document exact string search; not an iXBRL fact or HTML anchor', ${num(runId)}
WHERE NOT EXISTS (
  SELECT 1 FROM evidence.evidence e
  WHERE e.artifact_id = pg_temp.ctx('artifact')
    AND e.evidence_level = 'L2_ORIGINAL_FILING'
    AND e.locator_type = 'DOCUMENT');
INSERT INTO _p5c SELECT 'l2_evidence', (SELECT count(*) FROM evidence.evidence e
  WHERE e.artifact_id = pg_temp.ctx('artifact') AND e.evidence_level = 'L2_ORIGINAL_FILING'
    AND e.locator_type = 'DOCUMENT' AND e.run_id = ${num(runId)});

INSERT INTO ops.artifact_processing (artifact_id, rule_version_id, outcome, detail, counts, run_id)
SELECT pg_temp.ctx('artifact'), ${num(loaderRuleId)}, 'LOADED',
       'P5-min Golden filing document', '{}'::jsonb, ${num(runId)}
WHERE NOT EXISTS (
  SELECT 1 FROM ops.artifact_processing p
  WHERE p.artifact_id = pg_temp.ctx('artifact') AND p.rule_version_id = ${num(loaderRuleId)});

SELECT json_build_object(
  'artifact_id', pg_temp.ctx('artifact'),
  'document_links', (SELECT n FROM _p5c WHERE k = 'document_links'),
  'l2_evidence', (SELECT n FROM _p5c WHERE k = 'l2_evidence'));
COMMIT;`;
    const out = runScript(database, sql);
    const line = out.find((l) => l.startsWith("{"));
    const row = JSON.parse(line);
    counts.loaded += 1;
    if (row.document_links > 0) counts.document_links += 1;
    if (row.l2_evidence > 0) counts.l2_evidence += 1;
    counts.artifacts_inserted += 1;
  }
  return counts;
}

function l2EvidenceByDocument(database, documents) {
  if (documents.length === 0) return new Map();
  const ids = documents.map((d) => d.filing_document_id).join(",");
  const parsed = parseJsonCell(queryRows(database, `
SELECT coalesce(json_object_agg(filing_document_id::text, evidence_id), '{}'::json)
FROM (
  SELECT fda.filing_document_id, min(e.id) AS evidence_id
  FROM registry.filing_document_artifact fda
  JOIN evidence.evidence e ON e.artifact_id = fda.artifact_id
  WHERE fda.filing_document_id IN (${ids})
    AND e.evidence_level = 'L2_ORIGINAL_FILING'
    AND e.locator_type = 'DOCUMENT'
  GROUP BY fda.filing_document_id
) x;`));
  const map = new Map();
  for (const [k, v] of Object.entries(parsed)) map.set(Number(k), Number(v));
  return map;
}

function storageByDocument(database, documents) {
  if (documents.length === 0) return new Map();
  const ids = documents.map((d) => d.filing_document_id).join(",");
  const parsed = parseJsonCell(queryRows(database, `
SELECT coalesce(json_agg(json_build_object(
         'filing_document_id', fda.filing_document_id,
         'storage_key', a.storage_key,
         'sha256', a.sha256)
       ORDER BY fda.filing_document_id), '[]'::json)
FROM registry.filing_document_artifact fda
JOIN raw.artifact a ON a.id = fda.artifact_id
WHERE fda.filing_document_id IN (${ids});`));
  const map = new Map();
  for (const row of parsed) map.set(Number(row.filing_document_id), row);
  return map;
}

export function applyP5Verifications({
  database, positionObservationIds, runId, rules, dataDir = DEFAULT_DATA_DIR, documents,
}) {
  const ids = intIds(positionObservationIds);
  const ruleId = rules["validation.golden_filing_string"];
  if (!ruleId) throw new Error("missing rule id for validation.golden_filing_string");
  const list = ids.join(",");
  const fields = GOLDEN_ECONOMIC_FIELDS.map((c) => lit(c)).join(",");

  const namesMissing = Number(queryRows(database, `
SELECT count(*) FROM obs.position_observation p
WHERE p.id IN (${list})
  AND NOT EXISTS (
    SELECT 1 FROM obs.borrower_name_observation b
    WHERE b.position_observation_id = p.id);`)[0][0]);
  if (namesMissing !== 0) {
    throw new Error("P5-min requires P4-min borrower-name observations for every Golden locator");
  }

  const store = createStore(dataDir);
  const evidenceByDoc = l2EvidenceByDocument(database, documents);
  const storageByDoc = storageByDocument(database, documents);
  const haystackCache = new Map();

  function haystacksFor(docId) {
    const meta = storageByDoc.get(docId);
    if (!meta) return null;
    if (haystackCache.has(meta.sha256)) return haystackCache.get(meta.sha256);
    const buffer = store.read(meta.storage_key, meta.sha256);
    const foundFn = (needle) => needleInFiling(buffer, needle);
    haystackCache.set(meta.sha256, foundFn);
    return foundFn;
  }

  const nameRows = JSON.parse(queryRows(database, `
SELECT coalesce(json_agg(json_build_object(
         'id', b.id,
         'raw_text', b.raw_text,
         'filing_document_id', d.id)
       ORDER BY b.id), '[]'::json)
FROM obs.borrower_name_observation b
JOIN obs.position_observation p ON p.id = b.position_observation_id
JOIN registry.filing_document d ON d.filing_id = p.filing_id
WHERE b.position_observation_id IN (${list})
  AND coalesce(b.raw_text, '') <> '';`)[0][0]);

  const fieldRows = JSON.parse(queryRows(database, `
SELECT coalesce(json_agg(json_build_object(
         'id', fv.id,
         'field_code', fv.field_code,
         'raw_value', fv.raw_value,
         'filing_document_id', d.id)
       ORDER BY fv.id), '[]'::json)
FROM obs.current_position_field_value fv
JOIN obs.position_observation p ON p.id = fv.position_observation_id
JOIN registry.filing_document d ON d.filing_id = p.filing_id
WHERE fv.position_observation_id IN (${list})
  AND fv.value_state = 'REPORTED'
  AND coalesce(fv.raw_value, '') <> ''
  AND fv.field_code IN (${fields});`)[0][0]);

  const nameChecks = [];
  for (const row of nameRows) {
    const evidenceId = evidenceByDoc.get(Number(row.filing_document_id)) ?? null;
    const search = haystacksFor(Number(row.filing_document_id));
    let outcome;
    if (!search || evidenceId === null) outcome = "NOT_EVALUATED";
    else outcome = search(row.raw_text) ? "PASS" : "FAIL";
    nameChecks.push([row.id, evidenceId, outcome]);
  }

  const fieldChecks = [];
  for (const row of fieldRows) {
    const evidenceId = evidenceByDoc.get(Number(row.filing_document_id)) ?? null;
    const search = haystacksFor(Number(row.filing_document_id));
    let outcome;
    let status;
    if (!search || evidenceId === null) {
      outcome = "NOT_EVALUATED";
      status = "UNVERIFIABLE";
    } else if (search(row.raw_value)) {
      outcome = "PASS";
      status = "FILING_VERIFIED";
    } else {
      outcome = "FAIL";
      status = "UNVERIFIABLE";
    }
    fieldChecks.push([row.id, evidenceId, outcome, status]);
  }

  const sql = `
BEGIN;
CREATE TEMP TABLE _p5_name (
  subject_id bigint PRIMARY KEY,
  evidence_id bigint,
  outcome ref.validation_outcome NOT NULL
) ON COMMIT DROP;
CREATE TEMP TABLE _p5_fv (
  field_value_id bigint PRIMARY KEY,
  evidence_id bigint,
  outcome ref.validation_outcome NOT NULL,
  evidence_status ref.evidence_status NOT NULL
) ON COMMIT DROP;
${copyBlock("_p5_name", ["subject_id", "evidence_id", "outcome"], nameChecks)}
${copyBlock("_p5_fv", ["field_value_id", "evidence_id", "outcome", "evidence_status"], fieldChecks)}

WITH ins AS (
  INSERT INTO validation.validation_result (subject_table, subject_id, rule_version_id, outcome, detail, evidence_id, run_id)
  SELECT 'obs.borrower_name_observation', n.subject_id, ${num(ruleId)}, n.outcome,
         CASE n.outcome
           WHEN 'PASS' THEN 'exact_string_present'
           WHEN 'FAIL' THEN 'exact_string_absent'
           ELSE 'document_unavailable'
         END,
         n.evidence_id, ${num(runId)}
  FROM _p5_name n
  WHERE NOT EXISTS (
    SELECT 1 FROM validation.validation_result v
    WHERE v.subject_table = 'obs.borrower_name_observation'
      AND v.subject_id = n.subject_id
      AND v.rule_version_id = ${num(ruleId)})
  RETURNING id
)
SELECT count(*) FROM ins;

WITH ins AS (
  INSERT INTO validation.validation_result (subject_table, subject_id, rule_version_id, outcome, detail, evidence_id, run_id)
  SELECT 'obs.position_field_value', f.field_value_id, ${num(ruleId)}, f.outcome,
         CASE f.outcome
           WHEN 'PASS' THEN 'exact_string_present'
           WHEN 'FAIL' THEN 'exact_string_absent'
           ELSE 'document_unavailable'
         END,
         f.evidence_id, ${num(runId)}
  FROM _p5_fv f
  WHERE NOT EXISTS (
    SELECT 1 FROM validation.validation_result v
    WHERE v.subject_table = 'obs.position_field_value'
      AND v.subject_id = f.field_value_id
      AND v.rule_version_id = ${num(ruleId)})
  RETURNING id, subject_id
),
linked AS (
  INSERT INTO validation.evidence_status_assertion (field_value_id, evidence_status, validation_result_id, rule_version_id, run_id)
  SELECT f.field_value_id, f.evidence_status, ins.id, ${num(ruleId)}, ${num(runId)}
  FROM _p5_fv f
  JOIN ins ON ins.subject_id = f.field_value_id
  WHERE NOT EXISTS (
    SELECT 1 FROM validation.evidence_status_assertion a
    WHERE a.field_value_id = f.field_value_id
      AND NOT EXISTS (SELECT 1 FROM validation.evidence_status_assertion s WHERE s.supersedes_id = a.id))
  RETURNING id
),
supp AS (
  INSERT INTO evidence.supplementary_evidence (subject_table, subject_id, evidence_id, role, note, run_id)
  SELECT 'obs.position_field_value', f.field_value_id, f.evidence_id, 'CORROBORATES'::ref.evidence_role,
         'P5-min exact string present in fetched filing document', ${num(runId)}
  FROM _p5_fv f
  WHERE f.outcome = 'PASS' AND f.evidence_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM evidence.supplementary_evidence s
      WHERE s.subject_table = 'obs.position_field_value'
        AND s.subject_id = f.field_value_id
        AND s.evidence_id = f.evidence_id
        AND s.role = 'CORROBORATES')
  RETURNING id
)
SELECT json_build_object(
  'name_validations', (SELECT count(*) FROM _p5_name),
  'field_validations', (SELECT count(*) FROM _p5_fv),
  'status_assertions', (SELECT count(*) FROM linked),
  'corroborations', (SELECT count(*) FROM supp));
COMMIT;`;

  const out = runScript(database, sql);
  const line = out.find((l) => l.startsWith("{"));
  return JSON.parse(line);
}

export function goldenEvidenceReport(database, positionObservationIds) {
  const ids = intIds(positionObservationIds);
  const list = ids.join(",");
  const fields = GOLDEN_ECONOMIC_FIELDS.map((c) => lit(c)).join(",");
  return parseJsonCell(queryRows(database, `
SELECT json_build_object(
  'n_golden_position_observations', (SELECT count(*) FROM (SELECT unnest(ARRAY[${list}]) AS id) x),
  'n_accessions', (
    SELECT count(DISTINCT f.accession_number)
    FROM obs.position_observation p
    JOIN registry.filing f ON f.id = p.filing_id
    WHERE p.id IN (${list})),
  'n_filing_documents', (
    SELECT count(DISTINCT d.id)
    FROM registry.filing_document d
    JOIN obs.position_observation p ON p.filing_id = d.filing_id
    WHERE p.id IN (${list})),
  'documents_loaded', (
    SELECT count(DISTINCT d.id)
    FROM registry.filing_document d
    JOIN registry.filing_document_artifact fda ON fda.filing_document_id = d.id
    JOIN obs.position_observation p ON p.filing_id = d.filing_id
    WHERE p.id IN (${list})),
  'l2_artifacts', (
    SELECT count(*) FROM evidence.evidence e
    JOIN registry.filing_document_artifact fda ON fda.artifact_id = e.artifact_id
    JOIN registry.filing_document d ON d.id = fda.filing_document_id
    JOIN obs.position_observation p ON p.filing_id = d.filing_id
    WHERE p.id IN (${list})
      AND e.evidence_level = 'L2_ORIGINAL_FILING' AND e.locator_type = 'DOCUMENT'),
  'identifier_name', (
    SELECT json_build_object(
      'n', count(*),
      'pass', count(*) FILTER (WHERE v.outcome = 'PASS'),
      'fail', count(*) FILTER (WHERE v.outcome = 'FAIL'),
      'not_evaluated', count(*) FILTER (WHERE v.outcome = 'NOT_EVALUATED'),
      'unchecked', count(*) FILTER (WHERE v.id IS NULL)
    )
    FROM obs.borrower_name_observation b
    LEFT JOIN LATERAL (
      SELECT r.id, r.outcome
      FROM validation.validation_result r
      JOIN ops.rule_version rv ON rv.id = r.rule_version_id
      WHERE r.subject_table = 'obs.borrower_name_observation'
        AND r.subject_id = b.id
        AND rv.rule_code = 'validation.golden_filing_string'
      ORDER BY r.id DESC LIMIT 1
    ) v ON true
    WHERE b.position_observation_id IN (${list})),
  'economic_fields', (
    SELECT json_build_object(
      'n', count(*),
      'FILING_VERIFIED', count(*) FILTER (WHERE coalesce(es.evidence_status::text, 'NOT_CHECKED') = 'FILING_VERIFIED'),
      'FILING_MISMATCH', count(*) FILTER (WHERE coalesce(es.evidence_status::text, 'NOT_CHECKED') = 'FILING_MISMATCH'),
      'UNVERIFIABLE', count(*) FILTER (WHERE coalesce(es.evidence_status::text, 'NOT_CHECKED') = 'UNVERIFIABLE'),
      'NOT_CHECKED', count(*) FILTER (WHERE coalesce(es.evidence_status::text, 'NOT_CHECKED') = 'NOT_CHECKED'),
      'DATASET_ONLY', count(*) FILTER (WHERE coalesce(es.evidence_status::text, 'NOT_CHECKED') = 'DATASET_ONLY'),
      'by_field', coalesce((
        SELECT json_object_agg(field_code, rec)
        FROM (
          SELECT fv.field_code, json_build_object(
            'n', count(*),
            'FILING_VERIFIED', count(*) FILTER (WHERE coalesce(es2.evidence_status::text, 'NOT_CHECKED') = 'FILING_VERIFIED'),
            'UNVERIFIABLE', count(*) FILTER (WHERE coalesce(es2.evidence_status::text, 'NOT_CHECKED') = 'UNVERIFIABLE'),
            'FILING_MISMATCH', count(*) FILTER (WHERE coalesce(es2.evidence_status::text, 'NOT_CHECKED') = 'FILING_MISMATCH'),
            'NOT_CHECKED', count(*) FILTER (WHERE coalesce(es2.evidence_status::text, 'NOT_CHECKED') = 'NOT_CHECKED')
          ) AS rec
          FROM obs.current_position_field_value fv
          LEFT JOIN validation.current_evidence_status es2 ON es2.field_value_id = fv.id
          WHERE fv.position_observation_id IN (${list})
            AND fv.value_state = 'REPORTED'
            AND coalesce(fv.raw_value, '') <> ''
            AND fv.field_code IN (${fields})
          GROUP BY fv.field_code
        ) y), '{}'::json)
    )
    FROM obs.current_position_field_value fv
    LEFT JOIN validation.current_evidence_status es ON es.field_value_id = fv.id
    WHERE fv.position_observation_id IN (${list})
      AND fv.value_state = 'REPORTED'
      AND coalesce(fv.raw_value, '') <> ''
      AND fv.field_code IN (${fields})),
  'absent_reported_fields', (
    SELECT coalesce(json_agg(code ORDER BY code), '[]'::json)
    FROM unnest(ARRAY[${fields}]) AS code
    WHERE NOT EXISTS (
      SELECT 1 FROM obs.current_position_field_value fv
      WHERE fv.position_observation_id IN (${list})
        AND fv.field_code = code
        AND fv.value_state = 'REPORTED'
        AND coalesce(fv.raw_value, '') <> '')),
  'q14', (
    SELECT json_build_object(
      'open_question_cost_fv', count(*) FILTER (WHERE m.mapping_status = 'OPEN_QUESTION'),
      'provisional_authority', count(*) FILTER (WHERE a.authority = 'PROVISIONAL'),
      'authoritative_cost_fv', count(*) FILTER (WHERE a.authority = 'AUTHORITATIVE'),
      'derived_inputs', (SELECT count(*) FROM derived.derived_value_input)
    )
    FROM obs.current_position_field_value fv
    LEFT JOIN ref.current_column_mapping m ON m.mapping_id = fv.column_mapping_id
    LEFT JOIN obs.field_value_authority a ON a.field_value_id = fv.id
    WHERE fv.position_observation_id IN (${list})
      AND fv.field_code IN ('COST', 'FAIR_VALUE')
      AND fv.value_state = 'REPORTED'
      AND coalesce(fv.raw_value, '') <> '')
);`));
}
