#!/usr/bin/env node
// P4 identifier-name observations for accepted SOI fact-group BALANCE members.
// Calls applyP4Min once per exact identifier hash. Does not call P6 or P7.
// Does not change the unique-date runner or the P4 extractor.
//
//   node pipeline/p4-balance-candidates.mjs [--dry-run] [--db bdc_local]

import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DATABASE } from "./lib/config.mjs";
import { lit, num, pipelineConnectionTarget, queryRows } from "./lib/db.mjs";
import { applyP4Min } from "./load/p4-min.mjs";
import { pipelineCodeVersion } from "./load/run.mjs";
import { ensureAndLinkRuleForRun } from "./load/rules.mjs";
import { IDENTIFIER_COLUMN } from "./normalize/borrower-name.mjs";
import { SOI_FACT_GROUP_RULE } from "./normalize/soi-observation-group.mjs";

export const BALANCE_P4_EXPECTED_CANDIDATES = 418;
export const BALANCE_P4_EXPECTED_BATCHES = 137;

function opt(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

export function assertLocalBalanceP4Database(database) {
  if (pipelineConnectionTarget().mode !== "local") {
    throw new Error("balance-candidate P4 refuses a hosted database");
  }
  if (database !== DEFAULT_DATABASE) {
    throw new Error("balance-candidate P4 refuses a database other than the local database");
  }
}

export function batchesByIdentifierHash(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("P4 balance candidates require at least one observation");
  }
  const seen = new Set();
  const groups = new Map();
  for (const row of rows) {
    const id = Number(row.id);
    if (!Number.isSafeInteger(id) || id < 1) throw new Error(`invalid position_observation_id: ${row.id}`);
    if (seen.has(id)) throw new Error(`duplicate position_observation_id: ${id}`);
    seen.add(id);
    if (typeof row.identifierRaw !== "string" || row.identifierRaw === "") {
      throw new Error(`position observation ${id} has no identifier text`);
    }
    const identifierSha256 = createHash("sha256").update(row.identifierRaw, "utf8").digest("hex");
    if (!groups.has(identifierSha256)) {
      groups.set(identifierSha256, { identifierRaw: row.identifierRaw, identifierSha256, ids: [] });
    }
    const group = groups.get(identifierSha256);
    if (group.identifierRaw !== row.identifierRaw) {
      throw new Error(`identifier hash ${identifierSha256} maps to two identifier texts`);
    }
    group.ids.push(id);
  }
  return [...groups.values()]
    .map((group) => ({ ...group, ids: [...group.ids].sort((left, right) => left - right) }))
    .sort((left, right) => left.ids[0] - right.ids[0] || left.identifierRaw.localeCompare(right.identifierRaw));
}

function jsonRow(database, sql) {
  const rows = queryRows(database, sql);
  if (rows.length !== 1 || rows[0].length !== 1) throw new Error("expected one JSON row");
  return JSON.parse(rows[0][0]);
}

export function loadBalanceFactGroupCandidates(database) {
  const rows = queryRows(database, `
SELECT m.position_observation_id::text, s.identifier_raw
FROM obs.position_observation_group g
JOIN ops.rule_version rv ON rv.id = g.rule_version_id
  AND rv.rule_code = ${lit(SOI_FACT_GROUP_RULE.code)}
  AND rv.version = ${lit(SOI_FACT_GROUP_RULE.version)}
JOIN obs.position_observation_group_member m
  ON m.group_id = g.id AND m.member_role = 'BALANCE'
JOIN obs.position_observation p ON p.id = m.position_observation_id
JOIN obs.soi_row_observation s ON s.id = p.origin_soi_row_observation_id
ORDER BY m.position_observation_id;`);
  return rows.map((row) => ({ id: Number(row[0]), identifierRaw: row[1] }));
}

function candidateScope(database) {
  const column = lit(IDENTIFIER_COLUMN);
  return jsonRow(database, `
WITH cand AS (
  SELECT m.position_observation_id,
         m.evidence_id AS balance_evidence_id,
         s.identifier_raw,
         s.tabular_row_id,
         tv.raw_value AS type_text,
         array_position(tl.header, ${column}) AS identifier_column_position,
         r.cells[array_position(tl.header, ${column})] AS identifier_cell
  FROM obs.position_observation_group g
  JOIN ops.rule_version rv ON rv.id = g.rule_version_id
    AND rv.rule_code = ${lit(SOI_FACT_GROUP_RULE.code)}
    AND rv.version = ${lit(SOI_FACT_GROUP_RULE.version)}
  JOIN obs.position_observation_group_member m
    ON m.group_id = g.id AND m.member_role = 'BALANCE'
  JOIN obs.position_observation p ON p.id = m.position_observation_id
  JOIN obs.soi_row_observation s ON s.id = p.origin_soi_row_observation_id
  JOIN raw.tabular_row r ON r.id = s.tabular_row_id
  JOIN raw.table_load tl ON tl.id = r.table_load_id
  LEFT JOIN obs.current_position_field_value tv
    ON tv.position_observation_id = p.id AND tv.field_code = 'INSTRUMENT_TYPE'
),
ends AS (
  SELECT earlier_position_observation_id AS position_observation_id
  FROM registry.position_period_comparison
  UNION
  SELECT later_position_observation_id FROM registry.position_period_comparison
),
other_members AS (
  SELECT m.position_observation_id
  FROM obs.position_observation_group g
  JOIN ops.rule_version rv ON rv.id = g.rule_version_id
    AND rv.rule_code = ${lit(SOI_FACT_GROUP_RULE.code)}
    AND rv.version = ${lit(SOI_FACT_GROUP_RULE.version)}
  JOIN obs.position_observation_group_member m
    ON m.group_id = g.id AND m.member_role <> 'BALANCE'
)
SELECT json_build_object(
  'candidates', (SELECT count(*) FROM cand),
  'distinct_candidates', (SELECT count(DISTINCT position_observation_id) FROM cand),
  'missing_identifier_header', (SELECT count(*) FROM cand WHERE identifier_column_position IS NULL),
  'raw_differs_from_cell', (SELECT count(*) FROM cand WHERE identifier_raw IS DISTINCT FROM identifier_cell),
  'blank_raw', (SELECT count(*) FROM cand WHERE identifier_raw IS NULL OR identifier_raw = ''),
  'blank_after_normalize', (SELECT count(*) FROM cand WHERE nullif(btrim(normalize(identifier_raw, NFC)), '') IS NULL),
  'normalized_differs_from_raw', (SELECT count(*) FROM cand WHERE nullif(btrim(normalize(identifier_raw, NFC)), '') IS DISTINCT FROM identifier_raw),
  'existing_identifier_names', (
    SELECT count(*) FROM obs.borrower_name_observation b
    JOIN cand c ON c.position_observation_id = b.position_observation_id
    WHERE b.source_column_label = ${column}),
  'existing_name_rows', (
    SELECT count(*) FROM obs.borrower_name_observation b
    JOIN cand c ON c.position_observation_id = b.position_observation_id),
  'issuer_names_p4_would_insert', (
    SELECT count(*) FROM cand c
    JOIN obs.current_position_field_value fv ON fv.position_observation_id = c.position_observation_id
    WHERE fv.field_code = 'ISSUER_NAME'
      AND fv.value_state = 'REPORTED'
      AND fv.raw_value IS NOT NULL AND fv.raw_value <> ''
      AND fv.source_column_label IS NOT NULL
      AND fv.source_column_position IS NOT NULL),
  'spread_or_pik_overlap', (
    SELECT count(*) FROM other_members o
    JOIN cand c ON c.position_observation_id = o.position_observation_id),
  'comparison_endpoint_overlap', (
    SELECT count(*) FROM ends e
    JOIN cand c ON c.position_observation_id = e.position_observation_id),
  'instrument_decision_overlap', (
    SELECT count(*) FROM resolution.instrument_resolution_decision d
    JOIN cand c ON c.position_observation_id = d.position_observation_id),
  'continuity_decision_overlap', (
    SELECT count(*) FROM resolution.position_continuity_decision d
    JOIN cand c ON c.position_observation_id = d.position_observation_id),
  'controlled_investments', (
    SELECT count(*) FROM cand
    WHERE identifier_raw = 'ChyronHego Corporation' AND type_text = 'Controlled Investments [Member]'),
  'first_lien_one', (
    SELECT count(*) FROM cand
    WHERE identifier_raw = 'ChyronHego Corporation' AND type_text = 'First Lien Secured Debt One [Member]'),
  'preferred_equity', (
    SELECT count(*) FROM cand
    WHERE identifier_raw = 'ChyronHego Corporation' AND type_text = 'Preferred Equity [Member]'),
  'preferred_stock', (
    SELECT count(*) FROM cand
    WHERE identifier_raw = 'ChyronHego Corporation' AND type_text = 'Preferred Stock'),
  'identifier_cell_evidence', (
    SELECT count(*) FROM cand c
    JOIN evidence.evidence e
      ON e.tabular_row_id = c.tabular_row_id
     AND e.column_position = c.identifier_column_position
     AND e.locator_type = 'TSV_CELL'),
  'identifier_cell_evidence_rows', (
    SELECT count(*) FROM evidence.evidence e
    JOIN cand c
      ON e.tabular_row_id = c.tabular_row_id
     AND e.column_position = c.identifier_column_position
     AND e.locator_type = 'TSV_CELL')
)::text;`);
}

function isolationSnapshot(database) {
  return jsonRow(database, `
SELECT json_build_object(
  'instrument_decisions', (SELECT count(*) FROM resolution.instrument_resolution_decision),
  'instrument_decision_max_id', (SELECT coalesce(max(id), 0) FROM resolution.instrument_resolution_decision),
  'continuity_decisions', (SELECT count(*) FROM resolution.position_continuity_decision),
  'continuity_decision_max_id', (SELECT coalesce(max(id), 0) FROM resolution.position_continuity_decision),
  'comparisons', (SELECT count(*) FROM registry.position_period_comparison),
  'comparison_positions', (SELECT count(DISTINCT position_id) FROM registry.position_period_comparison),
  'comparisons_changed', (
    SELECT count(*) FROM registry.position_period_comparison c
    WHERE c.fair_value_changed OR c.principal_changed OR c.cost_changed OR c.maturity_changed),
  'comparison_endpoints', (
    SELECT count(*) FROM (
      SELECT earlier_position_observation_id AS id FROM registry.position_period_comparison
      UNION
      SELECT later_position_observation_id FROM registry.position_period_comparison
    ) e),
  'fact_groups', (
    SELECT count(*) FROM obs.position_observation_group g
    JOIN ops.rule_version rv ON rv.id = g.rule_version_id
    WHERE rv.rule_code = ${lit(SOI_FACT_GROUP_RULE.code)} AND rv.version = ${lit(SOI_FACT_GROUP_RULE.version)}),
  'fact_group_members', (
    SELECT count(*) FROM obs.position_observation_group_member m
    JOIN obs.position_observation_group g ON g.id = m.group_id
    JOIN ops.rule_version rv ON rv.id = g.rule_version_id
    WHERE rv.rule_code = ${lit(SOI_FACT_GROUP_RULE.code)} AND rv.version = ${lit(SOI_FACT_GROUP_RULE.version)}),
  'position_observations', (SELECT count(*) FROM obs.position_observation),
  'position_observation_max_id', (SELECT coalesce(max(id), 0) FROM obs.position_observation),
  'names_outside_candidates', (
    SELECT count(*) FROM obs.borrower_name_observation b
    WHERE NOT EXISTS (
      SELECT 1
      FROM obs.position_observation_group g
      JOIN ops.rule_version rv ON rv.id = g.rule_version_id
        AND rv.rule_code = ${lit(SOI_FACT_GROUP_RULE.code)}
        AND rv.version = ${lit(SOI_FACT_GROUP_RULE.version)}
      JOIN obs.position_observation_group_member m
        ON m.group_id = g.id AND m.member_role = 'BALANCE'
       AND m.position_observation_id = b.position_observation_id))
)::text;`);
}

function nameProof(database) {
  const column = lit(IDENTIFIER_COLUMN);
  return jsonRow(database, `
WITH cand AS (
  SELECT g.id AS group_id,
         m.id AS member_id,
         m.position_observation_id,
         m.evidence_id AS balance_evidence_id,
         s.identifier_raw,
         s.tabular_row_id,
         nullif(btrim(normalize(s.identifier_raw, NFC)), '') AS p4_normalized,
         array_position(tl.header, ${column}) AS identifier_column_position,
         r.cells[array_position(tl.header, ${column})] AS identifier_cell
  FROM obs.position_observation_group g
  JOIN ops.rule_version rv ON rv.id = g.rule_version_id
    AND rv.rule_code = ${lit(SOI_FACT_GROUP_RULE.code)}
    AND rv.version = ${lit(SOI_FACT_GROUP_RULE.version)}
  JOIN obs.position_observation_group_member m
    ON m.group_id = g.id AND m.member_role = 'BALANCE'
  JOIN obs.position_observation p ON p.id = m.position_observation_id
  JOIN obs.soi_row_observation s ON s.id = p.origin_soi_row_observation_id
  JOIN raw.tabular_row r ON r.id = s.tabular_row_id
  JOIN raw.table_load tl ON tl.id = r.table_load_id
),
named AS (
  SELECT c.position_observation_id, count(*) AS name_rows
  FROM cand c
  JOIN obs.borrower_name_observation b ON b.position_observation_id = c.position_observation_id
  GROUP BY c.position_observation_id
)
SELECT json_build_object(
  'name_rows', (SELECT coalesce(sum(name_rows), 0) FROM named),
  'candidates_with_a_name', (SELECT count(*) FROM named),
  'candidates_with_duplicate_names', (SELECT count(*) FROM named WHERE name_rows > 1),
  'extracted_identifier_names', (
    SELECT count(*)
    FROM cand c
    JOIN obs.borrower_name_observation b ON b.position_observation_id = c.position_observation_id
    JOIN ops.rule_version rv ON rv.id = b.rule_version_id
    JOIN evidence.evidence e ON e.id = b.evidence_id
    WHERE b.source_column_label = ${column}
      AND b.raw_text = c.identifier_raw
      AND b.normalized_text = c.p4_normalized
      AND b.extraction_state = 'EXTRACTED'
      AND rv.rule_code = 'norm.borrower_name'
      AND rv.version = '1'
      AND e.locator_type = 'TSV_CELL'
      AND e.column_label = ${column}
      AND e.tabular_row_id = c.tabular_row_id
      AND e.column_position = c.identifier_column_position
      AND c.identifier_cell = b.raw_text
      AND b.evidence_id IS DISTINCT FROM c.balance_evidence_id)
)::text;`);
}

function assertScope(scope, batches, candidates) {
  const failures = [];
  const expectZero = [
    "missing_identifier_header",
    "raw_differs_from_cell",
    "blank_raw",
    "blank_after_normalize",
    "normalized_differs_from_raw",
    "issuer_names_p4_would_insert",
    "spread_or_pik_overlap",
    "comparison_endpoint_overlap",
    "instrument_decision_overlap",
    "continuity_decision_overlap",
    "controlled_investments",
    "first_lien_one",
    "preferred_equity",
    "preferred_stock",
  ];
  for (const key of expectZero) {
    if (Number(scope[key]) !== 0) failures.push(`${key}=${scope[key]}`);
  }
  if (Number(scope.candidates) !== candidates.length) failures.push("candidate query count mismatch");
  if (Number(scope.distinct_candidates) !== candidates.length) failures.push("candidate ids are not distinct");
  if (candidates.length !== BALANCE_P4_EXPECTED_CANDIDATES) {
    failures.push(`candidates=${candidates.length}`);
  }
  if (batches.length !== BALANCE_P4_EXPECTED_BATCHES) failures.push(`batches=${batches.length}`);
  if (batches.reduce((sum, batch) => sum + batch.ids.length, 0) !== candidates.length) {
    failures.push("batch sizes do not sum to the candidate count");
  }
  const names = Number(scope.existing_identifier_names);
  const evidence = Number(scope.identifier_cell_evidence);
  const evidenceRows = Number(scope.identifier_cell_evidence_rows);
  if (names !== Number(scope.existing_name_rows)) failures.push("a candidate has a borrower-name row outside the identifier column");
  if (!((names === 0 && evidence === 0 && evidenceRows === 0) || (names === candidates.length && evidence === candidates.length && evidenceRows === candidates.length))) {
    failures.push(`names=${names} identifier_cell_evidence=${evidence} evidence_rows=${evidenceRows}`);
  }
  if (failures.length > 0) {
    throw new Error(`balance-candidate P4 refused to write: ${failures.join("; ")}`);
  }
  return { existingNames: names, existingIdentifierCellEvidence: evidenceRows };
}

function assertIsolation(before, after) {
  const changed = Object.keys(before).filter((key) => before[key] !== after[key]);
  if (changed.length > 0) {
    throw new Error(`balance-candidate P4 changed ${changed.join(", ")}`);
  }
}

function assertNames(proof, candidates) {
  if (Number(proof.name_rows) !== candidates) throw new Error(`name rows=${proof.name_rows}`);
  if (Number(proof.candidates_with_a_name) !== candidates) {
    throw new Error(`candidates with a name=${proof.candidates_with_a_name}`);
  }
  if (Number(proof.candidates_with_duplicate_names) !== 0) {
    throw new Error(`duplicate names=${proof.candidates_with_duplicate_names}`);
  }
  if (Number(proof.extracted_identifier_names) !== candidates) {
    throw new Error(`extracted identifier names with identifier-cell evidence=${proof.extracted_identifier_names}`);
  }
}

export function applyP4ToBalanceCandidates({ database = DEFAULT_DATABASE, dryRun = false, log = console.log } = {}) {
  assertLocalBalanceP4Database(database);
  const candidates = loadBalanceFactGroupCandidates(database);
  const batches = batchesByIdentifierHash(candidates);
  const scope = candidateScope(database);
  const ready = assertScope(scope, batches, candidates);
  const summary = {
    candidates: candidates.length,
    batches: batches.length,
    existingIdentifierNames: ready.existingNames,
    existingIdentifierCellEvidence: ready.existingIdentifierCellEvidence,
    dryRun,
  };
  if (dryRun) {
    log(JSON.stringify(summary));
    return summary;
  }
  const before = isolationSnapshot(database);
  const runRows = queryRows(database, `INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES ('P4_BALANCE_FACT_GROUP', ${lit(pipelineCodeVersion())},
        jsonb_build_object('candidates', ${num(candidates.length)}, 'batches', ${num(batches.length)},
          'existing_identifier_names', ${num(ready.existingNames)}),
        now())
RETURNING id;`);
  const runId = Number(runRows[0][0]);
  try {
    const rule = ensureAndLinkRuleForRun(database, runId, { code: "norm.borrower_name", version: "1" });
    let identifierNameInserted = 0;
    let issuerNameInserted = 0;
    for (const batch of batches) {
      const inserted = applyP4Min({
        database,
        positionObservationIds: batch.ids,
        runId,
        rules: { "norm.borrower_name": rule.id },
        identifierSha256: batch.identifierSha256,
      });
      identifierNameInserted += inserted.identifier_name_inserted;
      issuerNameInserted += inserted.issuer_name_inserted;
    }
    const proof = nameProof(database);
    const afterScope = candidateScope(database);
    const after = isolationSnapshot(database);
    assertNames(proof, candidates.length);
    assertIsolation(before, after);
    if (issuerNameInserted !== 0) throw new Error(`issuer names inserted=${issuerNameInserted}`);
    const expectedInserted = ready.existingNames === 0 ? candidates.length : 0;
    if (identifierNameInserted !== expectedInserted) {
      throw new Error(`identifier names inserted=${identifierNameInserted}, expected ${expectedInserted}`);
    }
    if (Number(afterScope.identifier_cell_evidence_rows) !== candidates.length) {
      throw new Error(`identifier-cell evidence rows=${afterScope.identifier_cell_evidence_rows}`);
    }
    const evidenceInserted = Number(afterScope.identifier_cell_evidence_rows) - ready.existingIdentifierCellEvidence;
    if (evidenceInserted !== expectedInserted) {
      throw new Error(`identifier-cell evidence inserted=${evidenceInserted}, expected ${expectedInserted}`);
    }
    const result = {
      ...summary,
      runId,
      ruleVersionId: rule.id,
      identifierNameInserted,
      issuerNameInserted,
      identifierCellEvidenceInserted: evidenceInserted,
      nameRows: Number(proof.name_rows),
      duplicateNameRows: Number(proof.candidates_with_duplicate_names),
      isolationUnchanged: true,
    };
    queryRows(database, `INSERT INTO ops.run_outcome (run_id, status, finished_at, counts)
VALUES (${num(runId)}, 'SUCCEEDED', now(), ${lit(JSON.stringify(result))}::jsonb);`);
    log(JSON.stringify(result));
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    queryRows(database, `INSERT INTO ops.run_outcome (run_id, status, finished_at, counts, error_summary)
VALUES (${num(runId)}, 'FAILED', now(), '{}'::jsonb, ${lit(message)});`);
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const database = opt(args, "--db") ?? DEFAULT_DATABASE;
  applyP4ToBalanceCandidates({ database, dryRun: args.includes("--dry-run") });
}
