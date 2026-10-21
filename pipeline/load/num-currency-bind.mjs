// Applies versioned NUM currency binding to current SOI monetary field-value heads.
// Append-only: prior heads stay; successors set supersedes_id. Fail closed. Idempotent.
// Decisions come only from planCurrencyBind; writes go out in batches, one transaction each.
// Every batch transaction also writes its ops.num_currency_bind_batch checkpoint (ADR 0022).

import { lit, num, openPipelineSession, queryRows, runScript } from "../lib/db.mjs";
import {
  BIND_JOIN_BASIS,
  EXCLUSION_REASONS,
  FIELD_NUM_TAGS,
  MONETARY_FIELD_CODES,
  SOI_RANGE_AXIS_LABEL,
  SOI_SUBSIDIARY_AXIS_LABEL,
  SUPERSEDE_REASON_UNIQUE_MATCH,
  UNIQUENESS_POLICY,
  planCurrencyBind,
} from "../normalize/num-currency-bind.mjs";
import { pipelineCodeVersion } from "./run.mjs";
import { RULES, registerRules, ruleDefinitionSha } from "./rules.mjs";

export const BIND_RULE_CODE = "obs.currency.from_num_unique_match";
export const BIND_RUN_KIND = "NUM_CURRENCY_BIND";

const SOI_LABEL_FOR_REASON = Object.freeze({
  [EXCLUSION_REASONS.SOI_SUBSIDIARY]: SOI_SUBSIDIARY_AXIS_LABEL,
  [EXCLUSION_REASONS.SOI_RANGE]: SOI_RANGE_AXIS_LABEL,
});

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
       p.filing_id::text, p.reported_date::text, p.holding_descriptor_raw,
       coalesce(r.cells[array_position(tl.header, ${lit(SOI_SUBSIDIARY_AXIS_LABEL)})], ''),
       coalesce(r.cells[array_position(tl.header, ${lit(SOI_RANGE_AXIS_LABEL)})], '')
FROM obs.current_position_field_value fv
JOIN obs.position_observation p ON p.id = fv.position_observation_id
LEFT JOIN obs.soi_row_observation s ON s.id = p.origin_soi_row_observation_id
LEFT JOIN raw.tabular_row r ON r.id = s.tabular_row_id
LEFT JOIN raw.table_load tl ON tl.id = r.table_load_id
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
    soi_subsidiary_axis: r[15] === "" ? null : r[15],
    soi_range_axis: r[16] === "" ? null : r[16],
  }));
}

function loadNumFacts(database) {
  const tags = [...new Set(Object.values(FIELD_NUM_TAGS).flat())].map((t) => lit(t)).join(", ");
  return queryRows(database, `
SELECT n.id::text, n.filing_id::text, n.reported_date::text, n.identifier_member_raw,
       n.tag, n.value_numeric::text, n.uom_raw, coalesce(n.segments_raw, '')
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
    segments_raw: r[7] === "" ? null : r[7],
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

function existingExclusionKeys(database, ruleId) {
  const rows = queryRows(database, `
SELECT field_value_id::text, reason, coalesce(num_fact_observation_id::text, ''), coalesce(num_axis, '')
FROM obs.field_value_currency_exclusion
WHERE rule_version_id = ${num(ruleId)};`);
  return new Set(rows.map((r) => r.join("\u0001")));
}

export const BIND_BATCH_SIZE = 1000;

// Transaction-level lock taken by every batch, so concurrent binders write one batch at a
// time and each batch's existence checks see the other binder's committed rows. Abandon
// takes it too, so a batch's liveness check and an abandon never overlap (migration 0069).
// Distinct from MATURITY_WORKER_LOCK_KEY.
export const NUM_CURRENCY_BIND_LOCK_KEY = 8120261018;

/**
 * One atomic DO statement for a batch of planned writes and its checkpoint.
 * Successors copy the stored head row. A head that already has a successor is left alone.
 * Each new successor gets exactly one EQUAL corroboration, or the whole batch rolls back;
 * a successor with no EQUAL row can only be one this statement just inserted.
 * NOT_EQUAL, MULTIPLE_CANDIDATES, and exclusion rows are written once per head, fact, and rule.
 * SOI exclusion cells are read from the origin row inside the statement.
 *
 * @param {{ promotes: Array<{ headId: number, currencyCode: string, numFactId: number }>,
 *   corroborations: Array<{ fieldValueId: number, numFactId: number|null, outcome: string }>,
 *   soiExclusions?: Array<{ fieldValueId: number, reason: string }>,
 *   numExclusions?: Array<{ fieldValueId: number, numFactId: number, axis: string }>,
 *   checkpoint: { batchIndex: number, firstHeadId: number, lastHeadId: number, heads: number },
 *   runId: number, ruleId: number }} batch
 */
export function bindBatchSql({
  promotes, corroborations, soiExclusions = [], numExclusions = [], checkpoint, runId, ruleId,
}) {
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
  WITH ins AS (
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
    ORDER BY v.field_value_id
    RETURNING outcome
  )
  SELECT count(*) FILTER (WHERE outcome = 'NOT_EQUAL'), count(*) FILTER (WHERE outcome = 'MULTIPLE_CANDIDATES')
    INTO not_equal_rows, multiple_rows FROM ins;`);
  }
  if (soiExclusions.length > 0) {
    const values = soiExclusions.map((e) => {
      const label = SOI_LABEL_FOR_REASON[e.reason];
      if (!label) throw new Error(`unexpected SOI exclusion reason: ${e.reason}`);
      return `(${num(e.fieldValueId)}::bigint, ${lit(e.reason)}::text, ${lit(label)}::text)`;
    }).join(",\n    ");
    body.push(`
  INSERT INTO obs.field_value_currency_exclusion (
    field_value_id, reason, soi_column_label, soi_cell_raw, rule_version_id, run_id
  )
  SELECT v.field_value_id, v.reason, v.label, obs.cell_by_label(s.tabular_row_id, v.label), ${rule}, ${run}
  FROM (VALUES
    ${values}) AS v(field_value_id, reason, label)
  JOIN obs.position_field_value f ON f.id = v.field_value_id
  JOIN obs.position_observation p ON p.id = f.position_observation_id
  JOIN obs.soi_row_observation s ON s.id = p.origin_soi_row_observation_id
  WHERE NOT EXISTS (
    SELECT 1 FROM obs.field_value_currency_exclusion x
    WHERE x.field_value_id = v.field_value_id AND x.reason = v.reason AND x.rule_version_id = ${rule}
  )
  ORDER BY v.field_value_id, v.reason;
  GET DIAGNOSTICS step_rows = ROW_COUNT;
  exclusion_rows := exclusion_rows + step_rows;`);
  }
  if (numExclusions.length > 0) {
    const values = numExclusions.map((e) =>
      `(${num(e.fieldValueId)}::bigint, ${num(e.numFactId)}::bigint, ${lit(e.axis)}::text)`).join(",\n    ");
    body.push(`
  INSERT INTO obs.field_value_currency_exclusion (
    field_value_id, reason, num_fact_observation_id, num_axis, rule_version_id, run_id
  )
  SELECT v.field_value_id, ${lit(EXCLUSION_REASONS.NUM_DIMENSION)}, v.num_fact_id, v.axis, ${rule}, ${run}
  FROM (VALUES
    ${values}) AS v(field_value_id, num_fact_id, axis)
  WHERE NOT EXISTS (
    SELECT 1 FROM obs.field_value_currency_exclusion x
    WHERE x.field_value_id = v.field_value_id AND x.num_fact_observation_id = v.num_fact_id
      AND x.num_axis = v.axis AND x.rule_version_id = ${rule}
  )
  ORDER BY v.field_value_id, v.num_fact_id, v.axis;
  GET DIAGNOSTICS step_rows = ROW_COUNT;
  exclusion_rows := exclusion_rows + step_rows;`);
  }
  const cp = checkpoint;
  body.push(`
  INSERT INTO ops.num_currency_bind_batch (
    run_id, rule_version_id, batch_index, first_field_value_id, last_field_value_id, heads_in_batch,
    successors_written, equal_written, not_equal_written, multiple_written, exclusions_written
  ) VALUES (${run}, ${rule}, ${num(cp.batchIndex)}, ${num(cp.firstHeadId)}, ${num(cp.lastHeadId)}, ${num(cp.heads)},
    successors, equal_rows, not_equal_rows, multiple_rows, exclusion_rows);`);
  return `DO $bind$
DECLARE
  successors bigint := 0;
  equal_rows bigint := 0;
  not_equal_rows bigint := 0;
  multiple_rows bigint := 0;
  exclusion_rows bigint := 0;
  step_rows bigint := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(${NUM_CURRENCY_BIND_LOCK_KEY});
  PERFORM ops.assert_num_currency_bind_live(${run});
${body.join("\n")}
END
$bind$;`;
}

function runCounts(database, runId) {
  const [row] = queryRows(database, `
SELECT
  (SELECT count(*) FROM obs.position_field_value WHERE run_id = ${num(runId)} AND supersedes_id IS NOT NULL)::text,
  (SELECT count(*) FROM obs.field_value_corroboration WHERE run_id = ${num(runId)} AND outcome = 'NOT_EQUAL')::text,
  (SELECT count(*) FROM obs.field_value_corroboration WHERE run_id = ${num(runId)} AND outcome = 'MULTIPLE_CANDIDATES')::text,
  (SELECT count(*) FROM obs.field_value_currency_exclusion WHERE run_id = ${num(runId)})::text;`);
  return {
    promoted: Number(row[0]),
    not_equal: Number(row[1]),
    multiple: Number(row[2]),
    exclusion_rows: Number(row[3]),
  };
}

/** Committed progress of a run, from its checkpoints only. */
export function committedProgress(database, runId) {
  const [row] = queryRows(database, `
SELECT count(*)::text, coalesce(max(batch_index), 0)::text, coalesce(max(last_field_value_id)::text, ''),
       coalesce(sum(heads_in_batch), 0)::text, coalesce(sum(successors_written), 0)::text,
       coalesce(sum(not_equal_written), 0)::text, coalesce(sum(multiple_written), 0)::text,
       coalesce(sum(exclusions_written), 0)::text
FROM ops.num_currency_bind_batch WHERE run_id = ${num(runId)};`);
  return {
    batches_committed: Number(row[0]),
    last_committed_batch_index: Number(row[1]),
    last_committed_field_value_id: row[2] === "" ? null : Number(row[2]),
    heads_committed: Number(row[3]),
    successors_committed: Number(row[4]),
    not_equal_committed: Number(row[5]),
    multiple_committed: Number(row[6]),
    exclusions_committed: Number(row[7]),
  };
}

/**
 * @param {object} [opts.hooks] Test-only failure injection: beforeBatch(info), batchSql(sql, info) => sql,
 *   afterBatch(info). Not reachable from the CLI.
 * @param {object} [opts.progress] Mutated with the phase and the batch in flight, for failure accounting.
 */
export function applyNumCurrencyBind(database, {
  runId, ruleId, batchSize = BIND_BATCH_SIZE, hooks = {}, progress = {},
}) {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) throw new Error(`invalid batch size: ${batchSize}`);
  progress.phase = "load";
  const heads = loadUnknownMonetaryHeads(database);
  const factsByKey = groupFacts(loadNumFacts(database));
  const seen = existingCorroborationKeys(database, ruleId);
  const seenExclusions = existingExclusionKeys(database, ruleId);
  progress.phase = "plan";
  progress.heads_considered = heads.length;
  const totals = {
    heads_considered: heads.length,
    promoted: 0,
    not_equal: 0,
    multiple: 0,
    multiple_equal_facts: 0,
    multiple_units: 0,
    multiple_value_mismatch: 0,
    excluded_soi_heads: 0,
    excluded_num_heads: 0,
    skipped_zero_match: 0,
    skipped_non_currency: 0,
    skipped_other: 0,
    batches_committed: 0,
  };

  let promotes = [];
  let corroborations = [];
  let soiExclusions = [];
  let numExclusions = [];
  let batchHeads = [];
  let batchIndex = 0;
  const writes = () => promotes.length + corroborations.length + soiExclusions.length + numExclusions.length;
  const flush = () => {
    if (batchHeads.length === 0) return;
    batchIndex += 1;
    const info = {
      batchIndex,
      firstHeadId: batchHeads[0],
      lastHeadId: batchHeads[batchHeads.length - 1],
      heads: batchHeads.length,
    };
    progress.phase = "batch";
    progress.batch = info;
    hooks.beforeBatch?.(info);
    let sql = bindBatchSql({ promotes, corroborations, soiExclusions, numExclusions, checkpoint: info, runId, ruleId });
    if (hooks.batchSql) sql = hooks.batchSql(sql, info);
    runScript(database, sql);
    totals.batches_committed = batchIndex;
    progress.phase = "plan";
    progress.batch = null;
    hooks.afterBatch?.(info);
    promotes = [];
    corroborations = [];
    soiExclusions = [];
    numExclusions = [];
    batchHeads = [];
  };
  const record = (fieldValueId, numFactId, outcome) => {
    const key = `${fieldValueId}\u0001${outcome}\u0001${numFactId ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    corroborations.push({ fieldValueId, numFactId, outcome });
  };
  const exclude = (fieldValueId, reason, numFactId, axis) => {
    const key = `${fieldValueId}\u0001${reason}\u0001${numFactId ?? ""}\u0001${axis ?? ""}`;
    if (seenExclusions.has(key)) return;
    seenExclusions.add(key);
    if (numFactId == null) soiExclusions.push({ fieldValueId, reason });
    else numExclusions.push({ fieldValueId, numFactId, axis });
  };

  for (const head of heads) {
    batchHeads.push(head.id);
    const key = `${head.filingId}\u0001${head.reportedDate}\u0001${head.holdingDescriptor}`;
    const plan = planCurrencyBind({
      fieldValue: head,
      numFacts: factsByKey.get(key) ?? [],
    });
    for (const reason of plan.soiExclusions ?? []) exclude(head.id, reason, null, null);
    for (const e of plan.numExclusions) exclude(head.id, EXCLUSION_REASONS.NUM_DIMENSION, e.numFactId, e.axis);
    if (plan.action === "promote") {
      promotes.push({ headId: head.id, currencyCode: plan.currencyCode, numFactId: plan.numFactId });
    } else if (plan.action === "not_equal") {
      record(head.id, plan.numFactId, "NOT_EQUAL");
    } else if (plan.action === "multiple") {
      record(head.id, null, "MULTIPLE_CANDIDATES");
      if (plan.reason === "multiple_equal_facts") totals.multiple_equal_facts += 1;
      else if (plan.reason === "multiple_units") totals.multiple_units += 1;
      else totals.multiple_value_mismatch += 1;
    } else if (plan.action === "exclude") {
      if (plan.reason === "soi_dimension") totals.excluded_soi_heads += 1;
      else totals.excluded_num_heads += 1;
    } else if (plan.reason === "zero_match") totals.skipped_zero_match += 1;
    else if (plan.reason === "non_currency_uom") totals.skipped_non_currency += 1;
    else totals.skipped_other += 1;
    if (writes() >= batchSize) flush();
  }
  flush();
  progress.phase = "done";
  return { ...totals, ...runCounts(database, runId) };
}

function bindRule() {
  const rule = RULES.find((r) => r.code === BIND_RULE_CODE);
  if (!rule) throw new Error(`rule ${BIND_RULE_CODE} is not in the catalog`);
  return rule;
}

// Session-level advisory lock class (two-int key: class, run id) held by a live binder run
// for its whole life, so an ended process is provable. Must match migration 0068.
export const NUM_CURRENCY_BIND_LIVENESS_LOCK_CLASS = 81202610;

function redact(message) {
  return String(message).replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted-url]").slice(0, 2000);
}

// Keeps only the refusal sentence raised by migration 0068 (drops psql ERROR/CONTEXT lines).
function refusal(error) {
  const match = /(?:resume|abandon) refused:[^\n]*/.exec(String(error?.message ?? error));
  return match ? new Error(match[0]) : error;
}

function assertRunId(value, flag) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`invalid ${flag} run id: ${value}`);
}

/**
 * Inserts the run (and its resume claim) through ops.start_num_currency_bind_run on a
 * dedicated session that then holds the run's liveness lock. The prior run's state, claim,
 * and rule identity are checked atomically in SQL. A refused start inserts nothing.
 */
async function startBindRun(database, { codeVersion, parameters, resumeRunId }) {
  const rule = bindRule();
  const session = await openPipelineSession(database);
  try {
    const out = await session.query(`SELECT ops.start_num_currency_bind_run(
  ${lit(codeVersion)}, ${lit(JSON.stringify(parameters))}::jsonb,
  ${resumeRunId == null ? "NULL" : num(resumeRunId)}::bigint, ${lit(rule.version)}, ${lit(ruleDefinitionSha(rule))})`);
    const runId = Number(String(out).trim());
    if (!Number.isSafeInteger(runId) || runId < 1) throw new Error(`run start returned no id: ${redact(out)}`);
    return { runId, session };
  } catch (error) {
    await session.close();
    throw refusal(error);
  }
}

/**
 * Starts a NUM_CURRENCY_BIND run. A resume links the new run to one prior FAILED or ABORTED
 * binder run under the same rule version; a run can be resumed once. On any failure after
 * the run row exists, writes a FAILED outcome with committed checkpoint counts and the batch
 * in flight, then rethrows. The liveness session closes when the run ends.
 * @param {object} [opts.hooks] Test-only: afterStart(runId) plus the applyNumCurrencyBind hooks.
 */
export async function runNumCurrencyBind({
  database, log: logFn = console.log, batchSize = BIND_BATCH_SIZE, resumeRunId = null, hooks = {},
}) {
  if (resumeRunId != null) assertRunId(resumeRunId, "--resume");
  const codeVersion = pipelineCodeVersion();
  const parameters = { uniqueness: UNIQUENESS_POLICY, batch_size: batchSize };
  const { runId, session } = await startBindRun(database, { codeVersion, parameters, resumeRunId });
  try {
    return finishBindRun(database, { runId, codeVersion, batchSize, hooks, logFn });
  } finally {
    await session.close();
  }
}

// Reads the run's stored status after its FAILED row could not be written. An outcome may
// already exist (for example ABORTED by --abandon after this run's session ended), or the
// database may be unreachable; say which, never assume.
function recordedStatus(database, runId) {
  try {
    const [row] = queryRows(database, `
SELECT s.status::text FROM ops.current_run_status s WHERE s.run_id = ${num(runId)};`);
    return row ? `its stored status is ${row[0]}` : "the run row could not be found";
  } catch (readError) {
    return `its stored status is unknown (${redact(readError.message)})`;
  }
}

function finishBindRun(database, { runId, codeVersion, batchSize, hooks, logFn }) {
  const progress = { phase: "rules" };
  let rules;
  let totals;
  try {
    hooks.afterStart?.(runId);
    rules = registerRules(database, runId);
    const ruleId = rules[BIND_RULE_CODE];
    totals = applyNumCurrencyBind(database, { runId, ruleId, batchSize, hooks, progress });
    progress.phase = "finish";
    runScript(database, `DO $finish$
BEGIN
  PERFORM pg_advisory_xact_lock(${NUM_CURRENCY_BIND_LOCK_KEY});
  PERFORM ops.assert_num_currency_bind_live(${num(runId)});
  INSERT INTO ops.run_outcome (run_id, status, finished_at, counts)
  VALUES (${num(runId)}, 'SUCCEEDED', now(), ${lit(JSON.stringify(totals))}::jsonb);
END
$finish$;`);
  } catch (error) {
    const counts = {
      failed_phase: progress.phase,
      failed_batch_index: progress.batch?.batchIndex ?? null,
      failed_first_field_value_id: progress.batch?.firstHeadId ?? null,
      failed_last_field_value_id: progress.batch?.lastHeadId ?? null,
      heads_considered: progress.heads_considered ?? null,
    };
    try {
      Object.assign(counts, committedProgress(database, runId));
      queryRows(database, `INSERT INTO ops.run_outcome (run_id, status, finished_at, counts, error_summary)
VALUES (${runId}, 'FAILED', now(), ${lit(JSON.stringify(counts))}::jsonb, ${lit(redact(error.message))});`);
    } catch (recordError) {
      const unrecorded = new Error(`run ${runId} failed (${redact(error.message)}) and its FAILED outcome could not be recorded (${redact(recordError.message)}); ${recordedStatus(database, runId)}`);
      unrecorded.runId = runId;
      throw unrecorded;
    }
    logFn(`num:bind-currency: run ${runId} FAILED ${JSON.stringify(counts)}`);
    error.runId = runId;
    error.failedCounts = counts;
    throw error;
  }
  logFn(`num:bind-currency: run ${runId} ${JSON.stringify(totals)}`);
  return { runId, totals, rules, codeVersion };
}

/**
 * Marks a STARTED binder run ABORTED through ops.abandon_num_currency_bind_run. Refused
 * unless the run's liveness lock is free (its database session has ended), the run has no
 * outcome, and the run recorded the liveness protocol. Counts come from committed
 * checkpoints. A free lock also means no later write of the run can commit (migration 0069).
 */
export function abandonNumCurrencyBind({ database, runId, actor, reason, log: logFn = console.log }) {
  assertRunId(runId, "--abandon");
  if (!actor?.trim()) throw new Error("abandon refused: --actor is required");
  if (!reason?.trim()) throw new Error("abandon refused: --reason is required");
  let rows;
  try {
    rows = queryRows(database, `SELECT ops.abandon_num_currency_bind_run(${num(runId)}, ${lit(actor)}, ${lit(reason)})::text;`);
  } catch (error) {
    throw refusal(error);
  }
  const counts = JSON.parse(rows[0][0]);
  logFn(`num:bind-currency: run ${runId} ABORTED ${JSON.stringify(counts)}`);
  return counts;
}
