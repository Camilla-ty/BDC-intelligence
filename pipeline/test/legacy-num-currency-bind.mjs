// Test-only frozen reference: the row-at-a-time NUM currency binder (SHA-256
// 01de845f0e6b249b9fb7e883be8f3ef846f257ad15883944a0baa2a2bd477c38 before batching),
// kept so differential tests can compare it with pipeline/load/num-currency-bind.mjs.
// Not used by any pipeline command.

import { lit, num, queryRows } from "../lib/db.mjs";
import {
  BIND_JOIN_BASIS,
  FIELD_NUM_TAGS,
  MONETARY_FIELD_CODES,
  SUPERSEDE_REASON_UNIQUE_MATCH,
  planCurrencyBind,
} from "../normalize/num-currency-bind.mjs";
import { pipelineCodeVersion } from "../load/run.mjs";
import { registerRules } from "../load/rules.mjs";

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

function applyPromote(database, { head, plan, runId, ruleId }) {
  const mappingSql = head.columnMappingId == null ? "NULL" : num(head.columnMappingId);
  const labelSql = head.sourceColumnLabel == null ? "NULL" : lit(head.sourceColumnLabel);
  const posSql = head.sourceColumnPosition == null ? "NULL" : num(head.sourceColumnPosition);
  const rawSql = head.raw_value == null ? "NULL" : lit(head.raw_value);
  const rows = queryRows(database, `
WITH ins AS (
  INSERT INTO obs.position_field_value (
    position_observation_id, field_code, column_mapping_id, source_column_label, source_column_position,
    raw_value, normalized_numeric, currency_code, currency_state, scale_state, value_state,
    normalization_rule_version_id, evidence_id, run_id, supersedes_id, supersede_reason
  ) VALUES (
    ${num(head.positionObservationId)}, ${lit(head.field_code)}, ${mappingSql}, ${labelSql}, ${posSql},
    ${rawSql}, ${lit(head.normalized_numeric)}::numeric, ${lit(plan.currencyCode)},
    'FROM_NUM_UNIQUE_MATCH'::ref.currency_state, ${lit(head.scale_state)}::ref.scale_state, 'REPORTED',
    ${num(ruleId)}, ${num(head.evidenceId)}, ${num(runId)}, ${num(head.id)}, ${lit(SUPERSEDE_REASON_UNIQUE_MATCH)}
  )
  RETURNING id
)
SELECT id::text FROM ins;`);
  const newId = Number(rows[0][0]);
  queryRows(database, `
INSERT INTO obs.field_value_corroboration (
  field_value_id, num_fact_observation_id, outcome, join_basis, rule_version_id, run_id
) VALUES (
  ${num(newId)}, ${num(plan.numFactId)}, 'EQUAL'::ref.corroboration_outcome,
  ${lit(BIND_JOIN_BASIS)}, ${num(ruleId)}, ${num(runId)}
);`);
  return newId;
}

function applyCorroboration(database, {
  fieldValueId, numFactId, outcome, runId, ruleId, seen,
}) {
  const key = `${fieldValueId}\u0001${outcome}\u0001${numFactId ?? ""}`;
  if (seen.has(key)) return false;
  const numSql = numFactId == null ? "NULL" : num(numFactId);
  queryRows(database, `
INSERT INTO obs.field_value_corroboration (
  field_value_id, num_fact_observation_id, outcome, join_basis, rule_version_id, run_id
) VALUES (
  ${num(fieldValueId)}, ${numSql}, ${lit(outcome)}::ref.corroboration_outcome,
  ${lit(BIND_JOIN_BASIS)}, ${num(ruleId)}, ${num(runId)}
);`);
  seen.add(key);
  return true;
}

export function applyNumCurrencyBind(database, { runId, ruleId }) {
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

  for (const head of heads) {
    const key = `${head.filingId}\u0001${head.reportedDate}\u0001${head.holdingDescriptor}`;
    const plan = planCurrencyBind({
      fieldValue: head,
      numFacts: factsByKey.get(key) ?? [],
    });
    if (plan.action === "promote") {
      applyPromote(database, { head, plan, runId, ruleId });
      totals.promoted += 1;
      continue;
    }
    if (plan.action === "not_equal") {
      if (applyCorroboration(database, {
        fieldValueId: head.id, numFactId: plan.numFactId, outcome: "NOT_EQUAL", runId, ruleId, seen,
      })) totals.not_equal += 1;
      continue;
    }
    if (plan.action === "multiple") {
      if (applyCorroboration(database, {
        fieldValueId: head.id, numFactId: null, outcome: "MULTIPLE_CANDIDATES", runId, ruleId, seen,
      })) totals.multiple += 1;
      continue;
    }
    if (plan.reason === "zero_match") totals.skipped_zero_match += 1;
    else if (plan.reason === "non_currency_uom") totals.skipped_non_currency += 1;
    else totals.skipped_other += 1;
  }
  return totals;
}

export async function runNumCurrencyBind({ database, log: logFn = console.log }) {
  const codeVersion = pipelineCodeVersion();
  const runRows = queryRows(database, `INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES ('NUM_CURRENCY_BIND', '${codeVersion}', '{}'::jsonb, now())
RETURNING id;`);
  const runId = Number(runRows[0][0]);
  const rules = registerRules(database, runId);
  const ruleId = rules["obs.currency.from_num_unique_match"];
  const totals = applyNumCurrencyBind(database, { runId, ruleId });
  queryRows(database, `INSERT INTO ops.run_outcome (run_id, status, finished_at, counts)
VALUES (${runId}, 'SUCCEEDED', now(), '${JSON.stringify(totals).replace(/'/g, "''")}'::jsonb);`);
  logFn(`num:bind-currency: run ${runId} ${JSON.stringify(totals)}`);
  return { runId, totals, rules, codeVersion };
}
