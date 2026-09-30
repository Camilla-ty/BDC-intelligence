// Shared SQL for load units. Every unit runs in one transaction as bdc_pipeline_writer.
//
// Source facts are staged in temporary tables with their location (artifact, row and column, or
// JSON path), then written with fresh evidence rows. Observations follow P2-D15 within one source
// stream (raw.source_stream): an unchanged value is skipped, a single changed value supersedes the
// previous one with a reason, and values that disappeared are counted and audited, never deleted.

import { lit, num } from "../lib/db.mjs";

export const LOCATION_COLUMNS = "artifact_id bigint, evidence_level ref.evidence_level, tabular_row_id bigint, column_position integer, column_label text, json_path text, ord bigint";

export function prelude() {
  return `
BEGIN;
CREATE TEMP TABLE _ctx (k text PRIMARY KEY, v bigint) ON COMMIT DROP;
CREATE TEMP TABLE _counts (k text, n bigint) ON COMMIT DROP;
CREATE FUNCTION pg_temp.ctx(key text) RETURNS bigint LANGUAGE sql STABLE AS $f$ SELECT v FROM _ctx WHERE k = key $f$;
CREATE FUNCTION pg_temp.fail(msg text) RETURNS text LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION '%', msg; END $f$;
CREATE FUNCTION pg_temp.strict_date(raw text, fmt text, pattern text) RETURNS date LANGUAGE plpgsql AS $f$
BEGIN
  IF raw = '' THEN RETURN NULL; END IF;
  IF raw !~ pattern OR to_char(to_date(raw, fmt), fmt) <> raw THEN
    RAISE EXCEPTION 'unexpected date format (expected %)', fmt;
  END IF;
  RETURN to_date(raw, fmt);
END $f$;
`;
}

export function artifactBlock(key, entry, runId) {
  return `
INSERT INTO raw.artifact (source_url, final_url, source_type_code, http_status, content_type, last_modified, etag,
                          byte_size, sha256, retrieved_at, storage_key, run_id)
VALUES (${lit(entry.url)}, ${lit(entry.final_url ?? entry.url)}, ${lit(entry.source_type)}, ${num(entry.http_status)},
        ${lit(entry.content_type)}, ${lit(entry.last_modified)}, ${lit(entry.etag)}, ${num(entry.byte_size)},
        ${lit(entry.sha256)}, ${lit(entry.requested_at)}, ${lit(entry.storage_key)}, ${num(runId)})
ON CONFLICT (source_url, sha256) DO NOTHING;
INSERT INTO _ctx SELECT ${lit(key)}, id FROM raw.artifact WHERE source_url = ${lit(entry.url)} AND sha256 = ${lit(entry.sha256)};
INSERT INTO raw.artifact_lineage (artifact_id, previous_artifact_id, basis, run_id)
SELECT a.id, p.id, 'SAME_SOURCE_URL', ${num(runId)}
FROM raw.artifact a
CROSS JOIN LATERAL (
  SELECT q.id FROM raw.artifact q
  WHERE q.source_url = a.source_url AND q.id <> a.id AND q.sha256 <> a.sha256 AND q.retrieved_at <= a.retrieved_at
  ORDER BY q.retrieved_at DESC, q.id DESC LIMIT 1) p
WHERE a.id = pg_temp.ctx(${lit(key)})
  AND NOT EXISTS (SELECT 1 FROM raw.artifact_lineage l WHERE l.artifact_id = a.id);
`;
}

// Artifacts of the same source stream as the unit's artifact (earlier retrievals included).
export function streamBlock(key) {
  return `
CREATE TEMP TABLE _stream ON COMMIT DROP AS
SELECT a.id FROM raw.artifact a WHERE raw.source_stream(a.id) = raw.source_stream(pg_temp.ctx(${lit(key)}));
`;
}

export function locatorTypeSql(alias = "") {
  const p = alias ? `${alias}.` : "";
  return `(CASE WHEN ${p}json_path IS NOT NULL THEN 'JSON_PATH' WHEN ${p}column_position IS NOT NULL THEN 'TSV_CELL' ELSE 'TSV_ROW' END)::ref.locator_type`;
}

function evidenceInsert(source, evTable, runId) {
  return `
CREATE TEMP TABLE ${evTable} (id bigint, artifact_id bigint, tabular_row_id bigint, column_position integer, json_path text) ON COMMIT DROP;
WITH ins AS (
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, tabular_row_id, column_position, column_label, json_path, run_id)
  SELECT s.evidence_level, s.artifact_id, ${locatorTypeSql("s")}, s.tabular_row_id, s.column_position, s.column_label, s.json_path, ${num(runId)}
  FROM ${source} s ORDER BY s.ord
  RETURNING id, artifact_id, tabular_row_id, column_position, json_path)
INSERT INTO ${evTable} SELECT * FROM ins;
`;
}

// Joins staged facts to their new evidence rows on a hashable location key.
const locationKey = (a) => `coalesce(${a}.json_path, ${a}.tabular_row_id::text || ':' || coalesce(${a}.column_position, 0)::text)`;

function evidenceJoin(alias, evAlias) {
  return `${evAlias}.artifact_id = ${alias}.artifact_id AND ${locationKey(evAlias)} = ${locationKey(alias)}`;
}

// Subject columns are never NULL (equality joins); compared values may be (null-safe).
const eqSubject = (cols, a, b) => cols.map((c) => `${a}.${c} = ${b}.${c}`).join(" AND ");
const eqValues = (cols, a, b) => cols.map((c) => `${a}.${c} IS NOT DISTINCT FROM ${b}.${c}`).join(" AND ");
const same = (subject, values, a, b) => [eqSubject(subject, a, b), eqValues(values, a, b)].filter(Boolean).join(" AND ");

// Registrants: insert when the CIK is new. Source table: LOCATION_COLUMNS + cik bigint.
export function insertRegistrants(source, runId) {
  return `
CREATE TEMP TABLE _reg_new ON COMMIT DROP AS
SELECT DISTINCT ON (s.cik) s.* FROM ${source} s
WHERE NOT EXISTS (SELECT 1 FROM registry.registrant r WHERE r.cik = s.cik)
ORDER BY s.cik, s.ord;
${evidenceInsert("_reg_new", "_reg_ev", runId)}
INSERT INTO registry.registrant (cik, run_id, evidence_id)
SELECT n.cik, ${num(runId)}, e.id FROM _reg_new n JOIN _reg_ev e ON ${evidenceJoin("n", "e")} ORDER BY n.ord;
INSERT INTO _counts SELECT 'registrants_added', count(*) FROM _reg_new;
`;
}

// Filings: insert when the accession is new. Source table: LOCATION_COLUMNS + accession text.
export function insertFilings(source, runId) {
  return `
CREATE TEMP TABLE _fil_new ON COMMIT DROP AS
SELECT DISTINCT ON (s.accession) s.* FROM ${source} s
WHERE NOT EXISTS (SELECT 1 FROM registry.filing f WHERE f.accession_number = s.accession)
ORDER BY s.accession, s.ord;
${evidenceInsert("_fil_new", "_fil_ev", runId)}
INSERT INTO registry.filing (accession_number, run_id, evidence_id)
SELECT n.accession, ${num(runId)}, e.id FROM _fil_new n JOIN _fil_ev e ON ${evidenceJoin("n", "e")} ORDER BY n.ord;
INSERT INTO _counts SELECT 'filings_added', count(*) FROM _fil_new;
`;
}

// Explicit filing-to-registrant links (never from the accession prefix).
// Source table: LOCATION_COLUMNS + accession text, cik bigint, link_source ref.filing_link_source.
export function insertLinks(source, runId) {
  return `
CREATE TEMP TABLE _link_new ON COMMIT DROP AS
SELECT DISTINCT ON (f.id, r.id, s.link_source) s.*, f.id AS filing_id, r.id AS registrant_id
FROM ${source} s
JOIN registry.filing f ON f.accession_number = s.accession
JOIN registry.registrant r ON r.cik = s.cik
WHERE NOT EXISTS (
  SELECT 1 FROM registry.filing_registrant_link l
  WHERE l.filing_id = f.id AND l.registrant_id = r.id AND l.link_source = s.link_source
    AND NOT EXISTS (SELECT 1 FROM registry.filing_registrant_link x WHERE x.supersedes_id = l.id))
ORDER BY f.id, r.id, s.link_source, s.ord;
${evidenceInsert("_link_new", "_link_ev", runId)}
INSERT INTO registry.filing_registrant_link (filing_id, registrant_id, link_source, run_id, evidence_id)
SELECT n.filing_id, n.registrant_id, n.link_source, ${num(runId)}, e.id
FROM _link_new n JOIN _link_ev e ON ${evidenceJoin("n", "e")} ORDER BY n.ord;
INSERT INTO _counts SELECT 'registrant_links_added', count(*) FROM _link_new;
`;
}

// Stream-scoped observation upsert (P2-D15). See the module comment.
export function upsertObservations({ source, target, subject, values, extra = [], ruleId, runId, label }) {
  const subj = subject.join(", ");
  const h = `_${label}_head`;
  const d = `_${label}_dedup`;
  const n = `_${label}_new`;
  const ev = `_${label}_ev`;
  const cols = [...subject, ...values, ...extra];
  return `
CREATE TEMP TABLE ${d} ON COMMIT DROP AS
SELECT DISTINCT ON (${[...subject, ...values].join(", ")}) s.* FROM ${source} s ORDER BY ${[...subject, ...values].join(", ")}, s.ord;
CREATE TEMP TABLE ${h} ON COMMIT DROP AS
SELECT o.id, ${[...subject, ...values].map((c) => `o.${c}`).join(", ")}
FROM ${target} o JOIN evidence.evidence e ON e.id = o.evidence_id
WHERE e.artifact_id IN (SELECT id FROM _stream)
  AND NOT EXISTS (SELECT 1 FROM ${target} x WHERE x.supersedes_id = o.id);
CREATE TEMP TABLE ${n} ON COMMIT DROP AS
WITH hc AS (SELECT ${subj}, count(*) AS n, min(id) AS hid FROM ${h} GROUP BY ${subj}),
     fc AS (SELECT ${subj}, count(*) AS n FROM ${d} GROUP BY ${subj})
SELECT f.*, CASE WHEN hc.n = 1 AND fc.n = 1 THEN hc.hid END AS supersedes_id
FROM ${d} f
JOIN fc ON ${eqSubject(subject, "fc", "f")}
LEFT JOIN hc ON ${eqSubject(subject, "hc", "f")}
WHERE NOT EXISTS (SELECT 1 FROM ${h} x WHERE ${same(subject, values, "x", "f")});
${evidenceInsert(n, ev, runId)}
INSERT INTO ${target} (${cols.join(", ")}, rule_version_id, run_id, supersedes_id, supersede_reason, evidence_id)
SELECT ${cols.map((c) => `n.${c}`).join(", ")}, ${num(ruleId)}, ${num(runId)}, n.supersedes_id,
       CASE WHEN n.supersedes_id IS NOT NULL THEN 'value changed in a newer retrieval of the same source' END, e.id
FROM ${n} n JOIN ${ev} e ON ${evidenceJoin("n", "e")} ORDER BY n.ord;
INSERT INTO _counts
SELECT '${label}_added', count(*) FILTER (WHERE supersedes_id IS NULL) FROM ${n}
UNION ALL SELECT '${label}_superseded', count(*) FILTER (WHERE supersedes_id IS NOT NULL) FROM ${n}
UNION ALL SELECT '${label}_unchanged', count(*) FROM ${d} f WHERE EXISTS (SELECT 1 FROM ${h} x WHERE ${same(subject, values, "x", "f")})
UNION ALL SELECT '${label}_absent_from_newer_source', count(*) FROM ${h} x
  WHERE NOT EXISTS (SELECT 1 FROM ${d} f WHERE ${same(subject, values, "x", "f")})
    AND NOT EXISTS (SELECT 1 FROM ${n} y WHERE y.supersedes_id = x.id);
`;
}

// UNRESOLVED AMENDS decisions for /A filings (P2-D13). Source: LOCATION_COLUMNS + accession, decided_at.
export function insertAmendmentDecisions(source, ruleId, runId) {
  return `
CREATE TEMP TABLE _amend_new ON COMMIT DROP AS
SELECT DISTINCT ON (f.id) s.*, f.id AS filing_id FROM ${source} s
JOIN registry.filing f ON f.accession_number = s.accession
WHERE NOT EXISTS (SELECT 1 FROM registry.filing_relationship_decision d WHERE d.filing_id = f.id AND d.relationship_type = 'AMENDS')
ORDER BY f.id, s.ord;
${evidenceInsert("_amend_new", "_amend_ev", runId)}
INSERT INTO registry.filing_relationship_decision (filing_id, relationship_type, related_filing_id, state, method, rationale,
    actor_kind, decided_by, decided_at, rule_version_id, run_id, evidence_id)
SELECT n.filing_id, 'AMENDS', NULL, 'UNRESOLVED', 'NO_AMENDMENT_MATCHING',
       'The form type is an amendment; the amended filing is not identified. Amendment matching is not performed in Phase 2 (OPEN QUESTION Q17); PREVRPT is kept raw only.',
       'SYSTEM_RULE', 'resolution.amends_unresolved', n.decided_at, ${num(ruleId)}, ${num(runId)}, e.id
FROM _amend_new n JOIN _amend_ev e ON ${evidenceJoin("n", "e")} ORDER BY n.ord;
INSERT INTO _counts SELECT 'amends_unresolved_added', count(*) FROM _amend_new;
`;
}

// Single-chain coverage: a new assertion only when the state changes; it supersedes the head.
export function assertCoverage({ registrantSql, releaseSql, sourceType, aspect, stateSql, evidenceSql, rationaleSql, ruleId, runId, label }) {
  return `
CREATE TEMP TABLE _cov_${label} ON COMMIT DROP AS
SELECT x.registrant_id, x.dataset_release_id, x.state, x.evidence_id, x.rationale,
       (SELECT c.id FROM ops.coverage_assertion c
        WHERE c.registrant_id IS NOT DISTINCT FROM x.registrant_id AND c.dataset_release_id IS NOT DISTINCT FROM x.dataset_release_id
          AND c.reporting_period_end IS NULL AND c.source_type_code = ${lit(sourceType)} AND c.coverage_aspect = ${lit(aspect)}
          AND NOT EXISTS (SELECT 1 FROM ops.coverage_assertion s WHERE s.supersedes_id = c.id)) AS head_id
FROM (SELECT ${registrantSql} AS registrant_id, ${releaseSql} AS dataset_release_id, (${stateSql})::ref.coverage_state AS state,
             ${evidenceSql} AS evidence_id, ${rationaleSql} AS rationale) x;
INSERT INTO ops.coverage_assertion (registrant_id, dataset_release_id, source_type_code, coverage_aspect, coverage_state, evidence_id,
    rationale, rule_version_id, run_id, supersedes_id, supersede_reason)
SELECT c.registrant_id, c.dataset_release_id, ${lit(sourceType)}, ${lit(aspect)}, c.state, c.evidence_id, c.rationale,
       ${num(ruleId)}, ${num(runId)}, c.head_id, CASE WHEN c.head_id IS NOT NULL THEN 'coverage state changed in a newer retrieval' END
FROM _cov_${label} c
WHERE (c.registrant_id IS NOT NULL OR ${lit(aspect)} <> 'FILING_HISTORY')
  AND (c.head_id IS NULL OR (SELECT h.coverage_state FROM ops.coverage_assertion h WHERE h.id = c.head_id) <> c.state)
ORDER BY c.registrant_id NULLS FIRST;
INSERT INTO _counts SELECT 'coverage_${label}_asserted', count(*) FROM _cov_${label} c
WHERE (c.registrant_id IS NOT NULL OR ${lit(aspect)} <> 'FILING_HISTORY')
  AND (c.head_id IS NULL OR (SELECT h.coverage_state FROM ops.coverage_assertion h WHERE h.id = c.head_id) <> c.state);
`;
}

export function finishBlock({ keys, ruleId, runId, outcome = "LOADED", detail, actor = "pipeline registry:load" }) {
  return `
INSERT INTO ops.audit_event (event_kind, subject_table, subject_id, actor, reason, details)
SELECT 'FACTS_ABSENT_FROM_NEWER_SOURCE', 'raw.artifact', pg_temp.ctx(${lit(keys[0])})::text, ${lit(actor)},
       'Facts from an earlier retrieval of this source stream are absent from this retrieval; they are kept, not deleted',
       jsonb_object_agg(k, n)
FROM _counts WHERE k LIKE '%absent%' AND n > 0 HAVING count(*) > 0;
${keys.map((k, i) => `INSERT INTO ops.artifact_processing (artifact_id, rule_version_id, outcome, detail, counts, run_id)
SELECT pg_temp.ctx(${lit(k)}), ${num(ruleId)}, ${lit(outcome)}, ${lit(i === 0 ? detail : `${detail} (processed with the unit of artifact key ${keys[0]})`)},
       ${i === 0 ? "coalesce((SELECT jsonb_object_agg(k, n ORDER BY k) FROM _counts), '{}'::jsonb)" : "'{}'::jsonb"}, ${num(runId)};`).join("\n")}
SELECT 'counts', coalesce((SELECT jsonb_object_agg(k, n ORDER BY k) FROM _counts), '{}'::jsonb)::text;
COMMIT;
`;
}
