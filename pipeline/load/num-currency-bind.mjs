// Applies versioned NUM currency binding to current SOI monetary field-value heads.
// Append-only: prior heads stay; successors set supersedes_id. Fail closed. Idempotent.
// Decisions come only from planCurrencyBind; writes go out in batches, one transaction each.

import { lit, num, queryRows, runScript } from "../lib/db.mjs";
import {
  BIND_JOIN_BASIS,
  FIELD_NUM_TAGS,
  MONETARY_FIELD_CODES,
  SUPERSEDE_REASON_UNIQUE_MATCH,
  planCurrencyBind,
} from "../normalize/num-currency-bind.mjs";
import { pipelineCodeVersion } from "./run.mjs";
import { registerRules } from "./rules.mjs";

function dateKey(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const s = String(value);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function loadUnknownMonetaryHeads(database) {
  const codes = MONETARY_FIELD_CODES.map((c) => lit(c)).join(", ");
  return queryRows(database, `
SELECT fv.id::text, fv.position_observation_id::text, fv.field_code,
       coalesce(fv.column_mapping_id::text, ''), coalesce(fv.source_column_label, ''),
       coalesce(fv.source_column_position::text, ''), coalesce(fv.raw_value, ''),
       fv.normalized_numeric::text, fv.scale_state::text, fv.currency_state::text,
       coalesce(fv.currency_code, ''), fv.evidence_id::text,
       p.filing_id::text, p.reported_date::text, p.holding_descriptor_raw
FROM obs.current_position_field_value fv
JOIN obs.position_observation p ON p.id = fv.position_observation_id
WHERE fv.field_code IN (${codes})
  AND fv.value_state = 'REPORTED'
  AND fv.normalized_numeric IS NOT NULL
  AND fv.currency_state = 'UNKNOWN'
ORDER BY fv.id;`).map((r) => ({
    id: Number(r[0]),
    positionObservationId: Number(r[1]),
    field_code: r[2],
    columnMappingId: r[3] === "" ? null : Number(r[3]),
    sourceColumnLabel: r[4] === "" ? null : r[4],
    sourceColumnPosition: r[5] === "" ? null : Number(r[5]),
    raw_value: r[6] === "" ? null : r[6],
    normalized_numeric: r[7],
    scale_state: r[8],
    currency_state: r[9],
    currency_code: r[10] === "" ? null : r[10],
    evidenceId: Number(r[11]),
    filingId: Number(r[12]),
    reportedDate: dateKey(r[13]),
    holdingDescriptor: r[14],
  }));
}

function loadNumFacts(database) {
  const tags = [...new Set(Object.values(FIELD_NUM_TAGS).flat())].map((t) => lit(t)).join(", ");
  return queryRows(database, `
SELECT n.id::text, n.filing_id::text, n.reported_date::text, n.identifier_member_raw,
       n.tag, n.value_numeric::text, n.uom_raw
FROM obs.num_fact_observation n
WHERE n.value_state = 'REPORTED'
  AND n.value_numeric IS NOT NULL
  AND n.identifier_member_raw IS NOT NULL
  AND n.tag IN (${tags})
ORDER BY n.id;`).map((r) => ({
    id: Number(r[0]),
    filingId: Number(r[1]),
    reportedDate: dateKey(r[2]),
    identifier: r[3],
    tag: r[4],
    value_numeric: r[5],
    uom_raw: r[6],
  }));
}

function groupFacts(facts) {
  const map = new Map();
  for (const fact of facts) {
    const key = `${fact.filingId}\u0001${fact.reportedDate}\u0001${fact.identifier}`;
    let list = map.get(key);
    if (!list) {
      list = [];
      map.set(key, list);
    }
    list.push(fact);
  }
  return map;
}

function existingCorroborationKeys(database, ruleId) {
  const rows = queryRows(database, `
SELECT field_value_id::text, outcome::text, coalesce(num_fact_observation_id::text, '')
FROM obs.field_value_corroboration
WHERE rule_version_id = ${num(ruleId)};`);
  return new Set(rows.map((r) => `${r[0]}\u0001${r[1]}\u0001${r[2]}`));
}

export const BIND_BATCH_SIZE = 1000;

// Transaction-level lock taken by every batch, so concurrent binders write one batch at a
// time and each batch's existence checks see the other binder's committed rows.
// Distinct from MATURITY_WORKER_LOCK_KEY.
export const NUM_CURRENCY_BIND_LOCK_KEY = 8120261018;

/**
 * One atomic DO statement for a batch of planned writes.
 * Successors copy the stored head row. A head that already has a successor is left alone.
 * Each new successor gets exactly one EQUAL corroboration, or the whole batch rolls back;
 * a successor with no EQUAL row can only be one this statement just inserted.
 * NOT_EQUAL and MULTIPLE_CANDIDATES rows are written once per head, outcome, fact, and rule.
 *
 * @param {{ promotes: Array<{ headId: number, currencyCode: string, numFactId: number }>,
 *   corroborations: Array<{ fieldValueId: number, numFactId: number|null, outcome: string }>,
 *   runId: number, ruleId: number }} batch
 */
export function bindBatchSql({ promotes, corroborations, runId, ruleId }) {
  const run = num(runId);
  const rule = num(ruleId);
  const basis = lit(BIND_JOIN_BASIS);
  const body = [];
  if (promotes.length > 0) {
    const values = promotes.map((p) => {
      if (!/^[A-Z]{3}$/.test(p.currencyCode)) throw new Error(`not a currency code: ${p.currencyCode}`);
      return `(${num(p.headId)}::bigint, '${p.currencyCode}'::text, ${num(p.numFactId)}::bigint)`;
    }).join(",\n    ");
    body.push(`
  INSERT INTO obs.position_field_value (
    position_observation_id, field_code, column_mapping_id, source_column_label, source_column_position,
    raw_value, normalized_numeric, currency_code, currency_state, scale_state, value_state,
    normalization_rule_version_id, evidence_id, run_id, supersedes_id, supersede_reason
  )
  SELECT h.position_observation_id, h.field_code, h.column_mapping_id, h.source_column_label,
         h.source_column_position, h.raw_value, h.normalized_numeric, v.currency_code,
         'FROM_NUM_UNIQUE_MATCH'::ref.currency_state, h.scale_state, 'REPORTED',
         ${rule}, h.evidence_id, ${run}, h.id, ${lit(SUPERSEDE_REASON_UNIQUE_MATCH)}
  FROM (VALUES
    ${values}) AS v(head_id, currency_code, num_fact_id)
  JOIN obs.position_field_value h ON h.id = v.head_id
  WHERE NOT EXISTS (SELECT 1 FROM obs.position_field_value s WHERE s.supersedes_id = h.id)
  ORDER BY v.head_id;
  GET DIAGNOSTICS successors = ROW_COUNT;

  INSERT INTO obs.field_value_corroboration (
    field_value_id, num_fact_observation_id, outcome, join_basis, rule_version_id, run_id
  )
  SELECT s.id, v.num_fact_id, 'EQUAL'::ref.corroboration_outcome, ${basis}, ${rule}, ${run}
  FROM (VALUES
    ${values}) AS v(head_id, currency_code, num_fact_id)
  JOIN obs.position_field_value s ON s.supersedes_id = v.head_id AND s.run_id = ${run}
  WHERE NOT EXISTS (
    SELECT 1 FROM obs.field_value_corroboration c WHERE c.field_value_id = s.id AND c.outcome = 'EQUAL'
  )
  ORDER BY v.head_id;
  GET DIAGNOSTICS equal_rows = ROW_COUNT;

  IF equal_rows <> successors THEN
    RAISE EXCEPTION 'num:bind-currency: % successors but % EQUAL corroborations', successors, equal_rows;
  END IF;`);
  }
  if (corroborations.length > 0) {
    const values = corroborations.map((c) => {
      if (c.outcome !== "NOT_EQUAL" && c.outcome !== "MULTIPLE_CANDIDATES") {
        throw new Error(`unexpected corroboration outcome: ${c.outcome}`);
      }
      const fact = c.numFactId == null ? "NULL" : num(c.numFactId);
      return `(${num(c.fieldValueId)}::bigint, ${fact}::bigint, '${c.outcome}'::ref.corroboration_outcome)`;
    }).join(",\n    ");
    body.push(`
  INSERT INTO obs.field_value_corroboration (
    field_value_id, num_fact_observation_id, outcome, join_basis, rule_version_id, run_id
  )
  SELECT v.field_value_id, v.num_fact_id, v.outcome, ${basis}, ${rule}, ${run}
  FROM (VALUES
    ${values}) AS v(field_value_id, num_fact_id, outcome)
  WHERE NOT EXISTS (
    SELECT 1 FROM obs.field_value_corroboration c
    WHERE c.field_value_id = v.field_value_id
      AND c.outcome = v.outcome
      AND c.num_fact_observation_id IS NOT DISTINCT FROM v.num_fact_id
      AND c.rule_version_id = ${rule}
  )
  ORDER BY v.field_value_id;`);
  }
  if (body.length === 0) return "";
  return `DO $bind$
DECLARE
  successors bigint := 0;
  equal_rows bigint := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(${NUM_CURRENCY_BIND_LOCK_KEY});
${body.join("\n")}
END
$bind$;`;
}

function runCounts(database, runId) {
  const [row] = queryRows(database, `
SELECT
  (SELECT count(*) FROM obs.position_field_value WHERE run_id = ${num(runId)} AND supersedes_id IS NOT NULL)::text,
  (SELECT count(*) FROM obs.field_value_corroboration WHERE run_id = ${num(runId)} AND outcome = 'NOT_EQUAL')::text,
  (SELECT count(*) FROM obs.field_value_corroboration WHERE run_id = ${num(runId)} AND outcome = 'MULTIPLE_CANDIDATES')::text;`);
  return { promoted: Number(row[0]), not_equal: Number(row[1]), multiple: Number(row[2]) };
}

export function applyNumCurrencyBind(database, { runId, ruleId, batchSize = BIND_BATCH_SIZE }) {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) throw new Error(`invalid batch size: ${batchSize}`);
  const heads = loadUnknownMonetaryHeads(database);
  const factsByKey = groupFacts(loadNumFacts(database));
  const seen = existingCorroborationKeys(database, ruleId);
  const totals = {
    heads_considered: heads.length,
    promoted: 0,
    not_equal: 0,
    multiple: 0,
    skipped_zero_match: 0,
    skipped_non_currency: 0,
    skipped_other: 0,
  };

  let promotes = [];
  let corroborations = [];
  const flush = () => {
    const sql = bindBatchSql({ promotes, corroborations, runId, ruleId });
    if (sql) runScript(database, sql);
    promotes = [];
    corroborations = [];
  };
  const record = (fieldValueId, numFactId, outcome) => {
    const key = `${fieldValueId}\u0001${outcome}\u0001${numFactId ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    corroborations.push({ fieldValueId, numFactId, outcome });
  };

  for (const head of heads) {
    const key = `${head.filingId}\u0001${head.reportedDate}\u0001${head.holdingDescriptor}`;
    const plan = planCurrencyBind({
      fieldValue: head,
      numFacts: factsByKey.get(key) ?? [],
    });
    if (plan.action === "promote") {
      promotes.push({ headId: head.id, currencyCode: plan.currencyCode, numFactId: plan.numFactId });
    } else if (plan.action === "not_equal") {
      record(head.id, plan.numFactId, "NOT_EQUAL");
    } else if (plan.action === "multiple") {
      record(head.id, null, "MULTIPLE_CANDIDATES");
    } else if (plan.reason === "zero_match") totals.skipped_zero_match += 1;
    else if (plan.reason === "non_currency_uom") totals.skipped_non_currency += 1;
    else totals.skipped_other += 1;
    if (promotes.length + corroborations.length >= batchSize) flush();
  }
  flush();
  return { ...totals, ...runCounts(database, runId) };
}

export async function runNumCurrencyBind({ database, log: logFn = console.log, batchSize }) {
  const codeVersion = pipelineCodeVersion();
  const runRows = queryRows(database, `INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES ('NUM_CURRENCY_BIND', '${codeVersion}', '{}'::jsonb, now())
RETURNING id;`);
  const runId = Number(runRows[0][0]);
  const rules = registerRules(database, runId);
  const ruleId = rules["obs.currency.from_num_unique_match"];
  const totals = applyNumCurrencyBind(database, { runId, ruleId, batchSize });
  queryRows(database, `INSERT INTO ops.run_outcome (run_id, status, finished_at, counts)
VALUES (${runId}, 'SUCCEEDED', now(), '${JSON.stringify(totals).replace(/'/g, "''")}'::jsonb);`);
  logFn(`num:bind-currency: run ${runId} ${JSON.stringify(totals)}`);
  return { runId, totals, rules, codeVersion };
}
