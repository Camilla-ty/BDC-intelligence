// Test-only, read-only canonical export of NUM currency-binding state, keyed by source
// location (artifact SHA-256, table code, line number) instead of surrogate ids, so two
// independently loaded databases can be compared line by line. Runs every query in a
// read-only transaction through docker exec on the local container.
// Output past the psql capture buffer can come back truncated with exit status 0, so every
// query ends with a sentinel row, large exports are paged by id, and line totals are checked
// against table counts.

import { createHash } from "node:crypto";
import { psql } from "../../scripts/db/pg.mjs";

const READ_ONLY = "SET default_transaction_read_only = on;\nSET max_parallel_workers_per_gather = 0;\n";
const SENTINEL = "__BDC_EXPORT_COMPLETE__";
const PAGE_IDS = 200000;

function query(database, sql) {
  const r = psql(database, `${sql.trim().replace(/;+\s*$/, "")};\nSELECT '${SENTINEL}';\n`, ["-At", "-F", "\t"]);
  if (r.status !== 0 || r.error) {
    throw new Error(r.stderr.trim() || r.error?.code || `psql exited with ${r.status}`);
  }
  const lines = r.stdout.split("\n").filter((l) => l !== "");
  if (lines.pop() !== SENTINEL) throw new Error("psql output is incomplete (no end-of-output sentinel)");
  return lines;
}

function pagedQuery(database, table, sqlForRange) {
  const [max, total] = query(database, `${READ_ONLY}SELECT coalesce(max(id), 0) || E'\\t' || count(*) FROM ${table};`)[0]
    .split("\t").map(Number);
  const lines = [];
  for (let lo = 0; lo < max; lo += PAGE_IDS) {
    for (const line of query(database, sqlForRange(lo, lo + PAGE_IDS))) lines.push(line);
  }
  if (lines.length !== total) throw new Error(`${table}: exported ${lines.length} lines for ${total} rows`);
  return lines;
}

const ROW_LOC = (alias) => `(
  SELECT a.sha256 || ':' || tl.table_code || ':' || tr.line_number
  FROM raw.tabular_row tr
  JOIN raw.table_load tl ON tl.id = tr.table_load_id
  JOIN raw.artifact a ON a.id = tl.artifact_id
  WHERE tr.id = ${alias})`;

// Depth 0 is a root; a successor is one more than the row it supersedes.
const FIELD_VALUE_KEYS = `
WITH RECURSIVE chain AS (
  SELECT f.id, 0 AS depth FROM obs.position_field_value f WHERE f.supersedes_id IS NULL
  UNION ALL
  SELECT s.id, c.depth + 1 FROM obs.position_field_value s JOIN chain c ON s.supersedes_id = c.id
),
fv_key AS (
  SELECT f.id,
         ${ROW_LOC("so.tabular_row_id")} || '|' || f.field_code || '|' ||
         coalesce(f.source_column_label, '<null>') || '|' || coalesce(f.source_column_position::text, '<null>') ||
         '|d' || c.depth AS k
  FROM obs.position_field_value f
  JOIN chain c ON c.id = f.id
  JOIN obs.position_observation p ON p.id = f.position_observation_id
  JOIN obs.soi_row_observation so ON so.id = p.origin_soi_row_observation_id
)`;

const FIELD_VALUES_SQL = (lo, hi) => `${READ_ONLY}${FIELD_VALUE_KEYS}
SELECT concat_ws(E'\\t',
  k.k,
  coalesce(f.raw_value, '<null>'),
  coalesce(f.normalized_numeric::text, '<null>'),
  coalesce(f.normalized_date::text, '<null>'),
  coalesce(f.normalized_text, '<null>'),
  coalesce(f.unit_code, '<null>'),
  coalesce(f.currency_code, '<null>'),
  coalesce(f.currency_state::text, '<null>'),
  coalesce(f.scale_state::text, '<null>'),
  f.value_state::text,
  coalesce(f.unknown_reason, '<null>'),
  coalesce(f.not_applicable_reason, '<null>'),
  coalesce(rv.rule_code || '@' || rv.version, '<null>'),
  coalesce(m.source_table_code || ':' || m.column_label || ':' || coalesce(m.field_code, '<null>'), '<null>'),
  e.evidence_level::text || ':' || e.locator_type::text || ':' ||
    coalesce(${ROW_LOC("e.tabular_row_id")}, '<null>') || ':' ||
    coalesce(e.column_position::text, '<null>') || ':' || coalesce(e.column_label, '<null>'),
  coalesce(sk.k, '<root>'),
  coalesce(f.supersede_reason, '<null>'),
  r.run_kind::text)
FROM obs.position_field_value f
JOIN fv_key k ON k.id = f.id
LEFT JOIN fv_key sk ON sk.id = f.supersedes_id
LEFT JOIN ops.rule_version rv ON rv.id = f.normalization_rule_version_id
LEFT JOIN ref.source_column_mapping m ON m.id = f.column_mapping_id
JOIN evidence.evidence e ON e.id = f.evidence_id
JOIN ops.run r ON r.id = f.run_id
WHERE f.id > ${lo} AND f.id <= ${hi};`;

const CORROBORATIONS_SQL = (lo, hi) => `${READ_ONLY}${FIELD_VALUE_KEYS}
SELECT concat_ws(E'\\t',
  k.k,
  c.outcome::text,
  c.join_basis,
  coalesce(${ROW_LOC("n.tabular_row_id")}, '<null>'),
  coalesce(n.tag || ':' || n.uom_raw || ':' || n.value_numeric::text, '<null>'),
  rv.rule_code || '@' || rv.version,
  r.run_kind::text)
FROM obs.field_value_corroboration c
JOIN fv_key k ON k.id = c.field_value_id
LEFT JOIN obs.num_fact_observation n ON n.id = c.num_fact_observation_id
JOIN ops.rule_version rv ON rv.id = c.rule_version_id
JOIN ops.run r ON r.id = c.run_id
WHERE c.id > ${lo} AND c.id <= ${hi};`;

const COUNTS_SQL = `${READ_ONLY}
SELECT 'registrants', count(*) FROM registry.registrant UNION ALL
SELECT 'filings', count(*) FROM registry.filing UNION ALL
SELECT 'table_loads', count(*) FROM raw.table_load UNION ALL
SELECT 'tabular_rows', count(*) FROM raw.tabular_row UNION ALL
SELECT 'soi_rows', count(*) FROM obs.soi_row_observation UNION ALL
SELECT 'positions', count(*) FROM obs.position_observation UNION ALL
SELECT 'field_values', count(*) FROM obs.position_field_value UNION ALL
SELECT 'successors', count(*) FROM obs.position_field_value WHERE supersedes_id IS NOT NULL UNION ALL
SELECT 'num_facts', count(*) FROM obs.num_fact_observation UNION ALL
SELECT 'corroborations', count(*) FROM obs.field_value_corroboration UNION ALL
SELECT 'projection_exceptions', count(*) FROM ops.projection_exception UNION ALL
SELECT 'evidence', count(*) FROM evidence.evidence UNION ALL
SELECT 'artifact_processing', count(*) FROM ops.artifact_processing;`;

const BIND_OUTCOMES_SQL = `${READ_ONLY}
SELECT o.counts::text
FROM ops.run r JOIN ops.run_outcome o ON o.run_id = r.id
WHERE r.run_kind = 'NUM_CURRENCY_BIND'
ORDER BY r.id;`;

const sha = (lines) => createHash("sha256").update(lines.join("\n")).digest("hex");
const duplicates = (lines) => lines.length - new Set(lines).size;

export function exportBindState(database) {
  const fieldValues = pagedQuery(database, "obs.position_field_value", FIELD_VALUES_SQL).sort();
  const corroborations = pagedQuery(database, "obs.field_value_corroboration", CORROBORATIONS_SQL).sort();
  const counts = Object.fromEntries(query(database, COUNTS_SQL).map((l) => l.split("\t")).map(([k, v]) => [k, Number(v)]));
  const bindOutcomes = query(database, BIND_OUTCOMES_SQL).map((l) => JSON.parse(l));
  return {
    counts,
    bindOutcomes,
    fieldValues,
    corroborations,
    fieldValueKeyDuplicates: duplicates(fieldValues.map((l) => l.split("\t")[0])),
    corroborationDuplicates: duplicates(corroborations),
    fieldValuesSha256: sha(fieldValues),
    corroborationsSha256: sha(corroborations),
  };
}

// Independent SQL restatement of the binding rule (SOURCE_SCHEMAS 5.4), used only to audit
// what the binder wrote. Equality here is SQL numeric equality; the binder uses JavaScript
// Number equality, so values beyond 15 significant digits are counted separately.
const AUDIT_SESSION = `${READ_ONLY}SET enable_nestloop = off;\nSET work_mem = '256MB';\n`;

const AUDIT_HEADS = `
WITH heads AS MATERIALIZED (
  SELECT h.id, h.field_code, h.normalized_numeric, p.id AS position_id, p.filing_id, p.reported_date,
         p.holding_descriptor_raw,
         CASE h.field_code
           WHEN 'PRINCIPAL_AMOUNT' THEN 'InvestmentOwnedBalancePrincipalAmount'
           WHEN 'COST' THEN 'InvestmentOwnedAtCost'
           WHEN 'FAIR_VALUE' THEN 'InvestmentOwnedAtFairValue' END AS tag
  FROM obs.position_field_value h
  JOIN obs.position_observation p ON p.id = h.position_observation_id
  WHERE h.field_code IN ('PRINCIPAL_AMOUNT', 'COST', 'FAIR_VALUE')
    AND h.value_state = 'REPORTED' AND h.normalized_numeric IS NOT NULL AND h.currency_state = 'UNKNOWN'
    AND NOT EXISTS (
      SELECT 1 FROM obs.position_field_value s JOIN ops.run r ON r.id = s.run_id
      WHERE s.supersedes_id = h.id AND r.run_kind <> 'NUM_CURRENCY_BIND')
),
facts AS MATERIALIZED (
  SELECT n.id, n.filing_id, n.reported_date, n.identifier_member_raw, n.tag, n.value_numeric, n.uom_raw
  FROM obs.num_fact_observation n
  WHERE n.value_state = 'REPORTED' AND n.value_numeric IS NOT NULL AND n.identifier_member_raw IS NOT NULL
    AND n.tag IN ('InvestmentOwnedBalancePrincipalAmount', 'InvestmentOwnedAtCost', 'InvestmentOwnedAtFairValue')
),
tagged AS (
  SELECT h.id AS head_id, n.id AS fact_id, n.uom_raw, (n.value_numeric = h.normalized_numeric) AS eq
  FROM heads h
  JOIN facts n
    ON n.filing_id = h.filing_id AND n.reported_date = h.reported_date
   AND n.identifier_member_raw = h.holding_descriptor_raw AND n.tag = h.tag
),
agg AS (
  SELECT h.id,
         count(t.fact_id) AS n_tagged,
         count(*) FILTER (WHERE t.eq) AS n_eq,
         count(DISTINCT t.uom_raw) FILTER (WHERE t.eq AND t.uom_raw ~ '^[A-Z]{3}$') AS n_ccy,
         min(t.uom_raw) FILTER (WHERE t.eq AND t.uom_raw ~ '^[A-Z]{3}$') AS ccy,
         min(t.fact_id) FILTER (WHERE t.eq AND t.uom_raw ~ '^[A-Z]{3}$') AS promote_fact,
         min(t.fact_id) AS only_fact
  FROM heads h LEFT JOIN tagged t ON t.head_id = h.id
  GROUP BY h.id
),
expected AS (
  SELECT id, n_tagged, n_eq, n_ccy, CASE
    WHEN n_tagged = 0 THEN 'NONE'
    WHEN n_eq = 0 AND n_tagged = 1 THEN 'NOT_EQUAL:' || only_fact
    WHEN n_eq = 0 THEN 'MULTIPLE_CANDIDATES'
    WHEN n_ccy = 0 THEN 'NONE'
    WHEN n_ccy > 1 THEN 'MULTIPLE_CANDIDATES'
    ELSE 'PROMOTE:' || ccy || ':' || promote_fact END AS e,
    CASE
      WHEN n_tagged = 0 THEN 'zero_match'
      WHEN n_eq = 0 AND n_tagged = 1 THEN 'value_mismatch'
      WHEN n_eq = 0 THEN 'ambiguous_value_mismatch'
      WHEN n_ccy = 0 THEN 'non_currency_uom'
      WHEN n_ccy > 1 THEN 'multiple_currencies'
      ELSE 'unique_match' END AS reason
  FROM agg
),
succ AS MATERIALIZED (
  SELECT s.supersedes_id AS head_id,
         string_agg('PROMOTE:' || s.currency_code || ':' || c.num_fact_observation_id, ',' ORDER BY c.id) AS a
  FROM obs.position_field_value s
  JOIN obs.field_value_corroboration c ON c.field_value_id = s.id AND c.outcome = 'EQUAL'
  WHERE s.supersedes_id IS NOT NULL
  GROUP BY s.supersedes_id
),
fail AS MATERIALIZED (
  SELECT c.field_value_id AS head_id,
         string_agg(CASE c.outcome WHEN 'NOT_EQUAL' THEN 'NOT_EQUAL:' || c.num_fact_observation_id
                                   ELSE c.outcome::text END, ',' ORDER BY c.id) AS a
  FROM obs.field_value_corroboration c
  WHERE c.outcome IN ('NOT_EQUAL', 'MULTIPLE_CANDIDATES')
  GROUP BY c.field_value_id
),
idents AS MATERIALIZED (
  SELECT DISTINCT filing_id, identifier_member_raw FROM facts
),
tag_any_date AS MATERIALIZED (
  SELECT DISTINCT filing_id, identifier_member_raw, tag FROM facts
)`;

// One line per head: expected and actual outcome, natural location, a precision flag for
// values beyond 15 significant digits, and for zero-match heads where the nearest NUM
// evidence stops (no identifier in the filing, identifier but not this tag, or tag on
// another date).
const AUDIT_ROWS_SQL = `${AUDIT_SESSION}${AUDIT_HEADS}
SELECT concat_ws(E'\\t', h.id::text, h.field_code, x.reason, x.e,
  coalesce(s.a, fl.a, 'NONE'),
  f.accession_number, h.reported_date::text, h.position_id::text, h.normalized_numeric::text,
  (length(trim(leading '0' from replace(rtrim(rtrim(h.normalized_numeric::text, '0'), '.'), '.', ''))) > 15)::text,
  CASE WHEN x.reason <> 'zero_match' THEN ''
       WHEN i.filing_id IS NULL THEN 'identifier_absent_from_filing_num'
       WHEN ta.filing_id IS NULL THEN 'identifier_present_without_this_tag'
       ELSE 'tag_present_on_other_date' END)
FROM heads h
JOIN expected x ON x.id = h.id
JOIN registry.filing f ON f.id = h.filing_id
LEFT JOIN succ s ON s.head_id = h.id
LEFT JOIN fail fl ON fl.head_id = h.id
LEFT JOIN idents i ON i.filing_id = h.filing_id AND i.identifier_member_raw = h.holding_descriptor_raw
LEFT JOIN tag_any_date ta ON ta.filing_id = h.filing_id AND ta.identifier_member_raw = h.holding_descriptor_raw
  AND ta.tag = h.tag;`;

// Every NUM fact for the same filing and identifier member, any date and monetary tag, for a
// handful of example heads.
const AUDIT_CANDIDATES_SQL = (headIds) => `${READ_ONLY}
SELECT concat_ws(E'\\t', h.id::text, n.tag, n.reported_date::text, n.uom_raw, coalesce(n.value_numeric::text, '<empty>'))
FROM obs.position_field_value h
JOIN obs.position_observation p ON p.id = h.position_observation_id
JOIN obs.num_fact_observation n ON n.filing_id = p.filing_id AND n.identifier_member_raw = p.holding_descriptor_raw
WHERE h.id IN (${headIds.map(Number).join(", ")})
  AND n.tag IN ('InvestmentOwnedBalancePrincipalAmount', 'InvestmentOwnedAtCost', 'InvestmentOwnedAtFairValue')
ORDER BY h.id, n.id;`;

const AUDIT_INTEGRITY_SQL = `${AUDIT_SESSION}
SELECT 'successor_without_exactly_one_equal', count(*) FROM obs.position_field_value s
  LEFT JOIN (
    SELECT c.field_value_id, count(*) AS n FROM obs.field_value_corroboration c WHERE c.outcome = 'EQUAL'
    GROUP BY c.field_value_id) e ON e.field_value_id = s.id
  WHERE s.currency_state = 'FROM_NUM_UNIQUE_MATCH' AND coalesce(e.n, 0) <> 1
UNION ALL
SELECT 'successor_non_equal_corroboration', count(*) FROM obs.field_value_corroboration c
  JOIN obs.position_field_value s ON s.id = c.field_value_id
  WHERE s.currency_state = 'FROM_NUM_UNIQUE_MATCH' AND c.outcome <> 'EQUAL'
UNION ALL
SELECT 'successor_drift_from_original', count(*) FROM obs.position_field_value s
  JOIN obs.position_field_value h ON h.id = s.supersedes_id
  WHERE s.currency_state = 'FROM_NUM_UNIQUE_MATCH' AND (
    s.position_observation_id <> h.position_observation_id OR s.field_code <> h.field_code
    OR s.raw_value IS DISTINCT FROM h.raw_value OR s.normalized_numeric IS DISTINCT FROM h.normalized_numeric
    OR s.evidence_id <> h.evidence_id OR s.source_column_label IS DISTINCT FROM h.source_column_label
    OR s.source_column_position IS DISTINCT FROM h.source_column_position
    OR s.column_mapping_id IS DISTINCT FROM h.column_mapping_id OR s.scale_state IS DISTINCT FROM h.scale_state
    OR h.currency_state <> 'UNKNOWN' OR h.currency_code IS NOT NULL)
UNION ALL
SELECT 'equal_key_value_or_currency_mismatch', count(*) FROM obs.field_value_corroboration c
  JOIN obs.position_field_value s ON s.id = c.field_value_id
  JOIN obs.position_observation p ON p.id = s.position_observation_id
  JOIN obs.num_fact_observation n ON n.id = c.num_fact_observation_id
  WHERE c.outcome = 'EQUAL' AND (
    n.filing_id <> p.filing_id OR n.reported_date IS DISTINCT FROM p.reported_date
    OR n.identifier_member_raw IS DISTINCT FROM p.holding_descriptor_raw
    OR n.value_numeric <> s.normalized_numeric OR n.uom_raw <> s.currency_code
    OR n.tag <> CASE s.field_code WHEN 'PRINCIPAL_AMOUNT' THEN 'InvestmentOwnedBalancePrincipalAmount'
                                  WHEN 'COST' THEN 'InvestmentOwnedAtCost'
                                  WHEN 'FAIR_VALUE' THEN 'InvestmentOwnedAtFairValue' END)
UNION ALL
SELECT 'duplicate_not_equal_or_multiple', count(*) FROM (
  SELECT 1 FROM obs.field_value_corroboration c WHERE c.outcome IN ('NOT_EQUAL', 'MULTIPLE_CANDIDATES')
  GROUP BY c.field_value_id, c.outcome, c.num_fact_observation_id, c.rule_version_id HAVING count(*) > 1) d
UNION ALL
SELECT 'head_with_successor_and_failure_row', count(*) FROM obs.field_value_corroboration c
  WHERE c.outcome IN ('NOT_EQUAL', 'MULTIPLE_CANDIDATES')
    AND EXISTS (SELECT 1 FROM obs.position_field_value s WHERE s.supersedes_id = c.field_value_id)
UNION ALL
SELECT 'num_facts_bound_to_more_than_one_head', count(*) FROM (
  SELECT 1 FROM obs.field_value_corroboration c WHERE c.outcome = 'EQUAL'
  GROUP BY c.num_fact_observation_id HAVING count(*) > 1) d;`;

const AUDIT_CURRENCY_SQL = `${READ_ONLY}
SELECT concat_ws(E'\\t', s.field_code, s.currency_code, count(*)::text)
FROM obs.position_field_value s WHERE s.currency_state = 'FROM_NUM_UNIQUE_MATCH'
GROUP BY s.field_code, s.currency_code ORDER BY s.field_code, count(*) DESC;`;

const EXAMPLES_PER_REASON = 4;

export function auditBindState(database) {
  const rows = query(database, AUDIT_ROWS_SQL).map((l) => {
    const [headId, field, reason, expected, actual, accession, reportedDate, positionId, value, beyond15, zeroKind] =
      l.split("\t");
    return {
      headId: Number(headId), field, reason, expected, actual, accession, reportedDate,
      positionId: Number(positionId), value, beyond15: beyond15 === "true", zeroKind,
    };
  });

  const tally = new Map();
  const zeroKinds = {};
  const picked = new Map();
  for (const r of rows) {
    const key = `${r.reason}\u0001${r.field}\u0001${r.expected.split(":")[0]}\u0001${r.expected === r.actual}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
    if (r.zeroKind) zeroKinds[r.zeroKind] = (zeroKinds[r.zeroKind] ?? 0) + 1;
    if (r.reason !== "unique_match") {
      const list = picked.get(r.reason) ?? [];
      if (list.length < EXAMPLES_PER_REASON) list.push(r);
      picked.set(r.reason, list);
    }
  }
  const summary = [...tally.entries()].sort().map(([key, n]) => {
    const [reason, field, expected, agrees] = key.split("\u0001");
    return { reason, field, expected, agrees: agrees === "true", n };
  });

  const examples = [...picked.values()].flat();
  const candidates = new Map();
  if (examples.length > 0) {
    for (const line of query(database, AUDIT_CANDIDATES_SQL(examples.map((e) => e.headId)))) {
      const [headId, ...fact] = line.split("\t");
      const list = candidates.get(Number(headId)) ?? [];
      list.push(fact.join(" "));
      candidates.set(Number(headId), list);
    }
  }

  return {
    headsAudited: rows.length,
    summary,
    disagreements: rows.filter((r) => r.expected !== r.actual).slice(0, 200),
    disagreementCount: rows.filter((r) => r.expected !== r.actual).length,
    headsBeyond15SignificantDigits: rows.filter((r) => r.beyond15).length,
    zeroMatchKinds: zeroKinds,
    examples: examples.map((e) => ({ ...e, numFactsForIdentifier: candidates.get(e.headId) ?? [] })),
    integrity: Object.fromEntries(query(database, AUDIT_INTEGRITY_SQL).map((l) => l.split("\t")).map(([k, v]) => [k, Number(v)])),
    successorsByCurrency: query(database, AUDIT_CURRENCY_SQL),
  };
}

/** Lines present in one sorted export and not the other. */
export function diffLines(left, right) {
  const r = new Set(right);
  const l = new Set(left);
  return {
    onlyLeft: left.filter((x) => !r.has(x)),
    onlyRight: right.filter((x) => !l.has(x)),
  };
}
