#!/usr/bin/env node
// Legal-entity decisions for the 340 two-date balance endpoints, one applyP6Min
// call per exact raw identifier. A name that already has a MATCHED entity is
// submitted together with those MATCHED observations so the existing entity is
// reused. Near-name controls are not passed. applyP6Min is not modified.
//
//   node pipeline/p6-balance-endpoints.mjs [--dry-run] [--db bdc_local]

import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DATABASE } from "./lib/config.mjs";
import { lit, num, pipelineConnectionTarget, queryRows } from "./lib/db.mjs";
import { applyP6Min } from "./load/p6-min.mjs";
import { pipelineCodeVersion } from "./load/run.mjs";
import { ensureAndLinkRuleForRun } from "./load/rules.mjs";
import { IDENTIFIER_COLUMN } from "./normalize/borrower-name.mjs";
import { EXACT_METHOD } from "./normalize/entity-name-match.mjs";
import { SOI_FACT_GROUP_RULE } from "./normalize/soi-observation-group.mjs";

export const EXPECTED_TARGETS = 340;
export const EXPECTED_NEW_BATCHES = 91;
export const EXPECTED_REUSE_BATCHES = 9;
export const EXPECTED_NEW_TARGET_OBSERVATIONS = 310;
export const EXPECTED_REUSE_TARGET_OBSERVATIONS = 30;
export const EXPECTED_REUSE_MATCHED_OBSERVATIONS = 18;
export const EXPECTED_EXCLUDED_UNRESOLVED = 15;
export const EXPECTED_COMPARISONS = 212;
export const EXPECTED_FACT_GROUPS = 418;
export const EXPECTED_POSITION_OBSERVATIONS = 1_442_423;
const P6_RULES = [
  "resolution.entity_exact_normalized_name",
  "resolution.entity_near_name_candidate",
];

function opt(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

export function assertLocal(database) {
  if (pipelineConnectionTarget().mode !== "local") {
    throw new Error("balance-endpoint P6 refuses a hosted database");
  }
  if (database !== DEFAULT_DATABASE) {
    throw new Error("balance-endpoint P6 refuses a database other than the local database");
  }
}

export function assertIsolationSnapshot(before) {
  if (before.economic_groups !== 0 || before.group_memberships !== 0) {
    throw new Error("balance-endpoint P6 refused because an economic group already exists");
  }
  if (before.comparisons !== EXPECTED_COMPARISONS
    || before.fact_groups !== EXPECTED_FACT_GROUPS
    || before.position_observations !== EXPECTED_POSITION_OBSERVATIONS) {
    throw new Error(`balance-endpoint P6 refused unexpected stored totals: ${JSON.stringify({
      comparisons: before.comparisons,
      fact_groups: before.fact_groups,
      position_observations: before.position_observations,
    })}`);
  }
}

function jsonRow(database, sql) {
  const rows = queryRows(database, sql);
  if (rows.length !== 1 || rows[0].length !== 1) throw new Error("expected one JSON row");
  return JSON.parse(rows[0][0]);
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function observationId(row, label) {
  const id = Number(row.id);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error(`invalid ${label} position_observation_id: ${row.id}`);
  return id;
}

function exactText(row, id) {
  if (typeof row.rawText !== "string" || row.rawText === "") {
    throw new Error(`position observation ${id} has no raw identifier`);
  }
  if (row.rawText !== row.normalizedText) {
    throw new Error(`position observation ${id} raw identifier differs from normalized text`);
  }
  return row.rawText;
}

// One batch per exact raw identifier. Reuse rows are MATCHED observations of
// that same raw text and are not taken from any other name.
export function planExactNameBatches(targets, reuse) {
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error("P6 endpoint batches require the target observations");
  }
  if (!Array.isArray(reuse)) throw new Error("P6 endpoint reuse rows must be an array");
  const seen = new Set();
  const groups = new Map();

  function groupFor(rawText) {
    if (!groups.has(rawText)) {
      groups.set(rawText, { rawText, targetIds: [], reuseIds: [], legalEntityIds: new Set() });
    }
    return groups.get(rawText);
  }

  for (const row of targets) {
    const id = observationId(row, "target");
    if (seen.has(id)) throw new Error(`duplicate position_observation_id: ${id}`);
    seen.add(id);
    groupFor(exactText(row, id)).targetIds.push(id);
  }
  for (const row of reuse) {
    const id = observationId(row, "reuse");
    if (seen.has(id)) throw new Error(`duplicate position_observation_id: ${id}`);
    seen.add(id);
    if (typeof row.legalEntityId !== "string" || row.legalEntityId === "") {
      throw new Error(`reuse observation ${id} has no legal entity`);
    }
    const group = groupFor(exactText(row, id));
    group.reuseIds.push(id);
    group.legalEntityIds.add(row.legalEntityId);
  }

  const batches = [];
  for (const group of groups.values()) {
    if (group.targetIds.length === 0) {
      throw new Error(`reuse observations for ${JSON.stringify(group.rawText)} are not a target name`);
    }
    if (group.legalEntityIds.size > 1) {
      throw new Error(`exact name ${JSON.stringify(group.rawText)} is MATCHED to more than one legal entity`);
    }
    const mode = group.reuseIds.length === 0 ? "new" : "reuse";
    if (mode === "reuse" && group.legalEntityIds.size !== 1) {
      throw new Error(`reuse batch ${JSON.stringify(group.rawText)} has no legal entity`);
    }
    const submittedIds = [...group.targetIds, ...group.reuseIds].sort((left, right) => left - right);
    batches.push({
      rawText: group.rawText,
      identifierSha256: sha256(group.rawText),
      mode,
      legalEntityId: mode === "reuse" ? [...group.legalEntityIds][0] : null,
      targetIds: [...group.targetIds].sort((left, right) => left - right),
      reuseIds: [...group.reuseIds].sort((left, right) => left - right),
      submittedIds,
    });
  }
  batches.sort((left, right) => (left.mode === right.mode ? left.rawText < right.rawText ? -1 : 1 : left.mode === "reuse" ? -1 : 1));
  return batches;
}

export function assessP6Batches(batches) {
  let entitiesToCreate = 0;
  let entitiesToReuse = 0;
  let decisionsToInsert = 0;
  let newTargetObservations = 0;
  let reuseTargetObservations = 0;
  let reuseMatchedObservations = 0;
  const names = new Set();
  for (const batch of batches) {
    if (names.has(batch.rawText)) throw new Error(`duplicate batch name ${JSON.stringify(batch.rawText)}`);
    names.add(batch.rawText);
    if (new Set(batch.submittedIds).size !== batch.submittedIds.length) {
      throw new Error(`batch ${JSON.stringify(batch.rawText)} repeats an observation`);
    }
    if (batch.mode === "new") {
      if (batch.reuseIds.length !== 0 || batch.legalEntityId !== null) {
        throw new Error(`new batch ${JSON.stringify(batch.rawText)} contains a reuse observation`);
      }
      entitiesToCreate += 1;
      newTargetObservations += batch.targetIds.length;
      decisionsToInsert += batch.targetIds.length;
    } else if (batch.mode === "reuse") {
      if (batch.reuseIds.length < 1 || batch.legalEntityId === null) {
        throw new Error(`reuse batch ${JSON.stringify(batch.rawText)} has no MATCHED observation`);
      }
      entitiesToReuse += 1;
      reuseTargetObservations += batch.targetIds.length;
      reuseMatchedObservations += batch.reuseIds.length;
      decisionsToInsert += batch.targetIds.length;
    } else {
      throw new Error(`unknown batch mode ${batch.mode}`);
    }
  }
  return {
    batches: batches.length,
    entitiesToCreate,
    entitiesToReuse,
    decisionsToInsert,
    newTargetObservations,
    reuseTargetObservations,
    reuseMatchedObservations,
    submittedObservations: newTargetObservations + reuseTargetObservations + reuseMatchedObservations,
  };
}

function loadEndpointRows(database) {
  const column = lit(IDENTIFIER_COLUMN);
  return jsonRow(database, `
WITH continuity AS (
  SELECT c.position_observation_id, c.position_id
  FROM resolution.position_continuity_decision c
  WHERE c.run_id = 32
    AND c.state = 'MATCHED'
    AND NOT EXISTS (
      SELECT 1 FROM resolution.position_continuity_decision s WHERE s.supersedes_id = c.id)
),
multi AS (
  SELECT position_id FROM continuity GROUP BY position_id HAVING count(*) = 2
),
target AS (
  SELECT c.position_observation_id
  FROM continuity c
  JOIN multi m ON m.position_id = c.position_id
),
target_name AS (
  SELECT t.position_observation_id AS id,
         b.raw_text,
         b.normalized_text,
         (SELECT count(*) FROM obs.borrower_name_observation n
           WHERE n.position_observation_id = t.position_observation_id
             AND n.source_column_label = ${column}) AS name_rows,
         (SELECT count(*) FROM resolution.entity_resolution_decision d
           JOIN obs.borrower_name_observation n ON n.id = d.borrower_name_observation_id
           WHERE n.position_observation_id = t.position_observation_id
             AND NOT EXISTS (
               SELECT 1 FROM resolution.entity_resolution_decision s WHERE s.supersedes_id = d.id)) AS decision_heads,
         d.state::text AS decision_state,
         d.method AS decision_method,
         d.legal_entity_id::text AS legal_entity_id
  FROM target t
  LEFT JOIN obs.borrower_name_observation b
    ON b.position_observation_id = t.position_observation_id
   AND b.source_column_label = ${column}
   AND b.extraction_state = 'EXTRACTED'
  LEFT JOIN resolution.current_entity_resolution d
    ON d.borrower_name_observation_id = b.id
),
reuse AS (
  SELECT n.position_observation_id AS id,
         n.raw_text,
         n.normalized_text,
         d.legal_entity_id::text AS legal_entity_id,
         d.state::text AS state,
         d.method
  FROM obs.borrower_name_observation n
  JOIN resolution.current_entity_resolution d ON d.borrower_name_observation_id = n.id
  WHERE n.source_column_label = ${column}
    AND n.extraction_state = 'EXTRACTED'
    AND n.raw_text IN (SELECT raw_text FROM target_name)
    AND n.position_observation_id NOT IN (SELECT id FROM target_name)
)
SELECT json_build_object(
  'targets', COALESCE((SELECT json_agg(json_build_object(
      'id', id, 'rawText', raw_text, 'normalizedText', normalized_text,
      'nameRows', name_rows, 'decisionHeads', decision_heads,
      'decisionState', decision_state, 'decisionMethod', decision_method,
      'legalEntityId', legal_entity_id)
      ORDER BY id) FROM target_name), '[]'::json),
  'reuse', COALESCE((SELECT json_agg(json_build_object(
      'id', id, 'rawText', raw_text, 'normalizedText', normalized_text,
      'legalEntityId', legal_entity_id, 'state', state, 'method', method)
      ORDER BY id) FROM reuse), '[]'::json),
  'unresolved_same_raw_outside', (
    SELECT count(*)
    FROM obs.borrower_name_observation n
    WHERE n.source_column_label = ${column}
      AND n.extraction_state = 'EXTRACTED'
      AND n.raw_text IN (SELECT raw_text FROM target_name)
      AND n.position_observation_id NOT IN (SELECT id FROM target_name)
      AND NOT EXISTS (
        SELECT 1 FROM resolution.current_entity_resolution d
        WHERE d.borrower_name_observation_id = n.id))
)::text;`);
}

export function assertPhaseA(loaded) {
  const failures = [];
  if (loaded.targets.length !== EXPECTED_TARGETS) failures.push(`targets=${loaded.targets.length}`);
  for (const row of loaded.targets) {
    if (Number(row.nameRows) !== 1) failures.push(`target ${row.id} name rows=${row.nameRows}`);
    if (Number(row.decisionHeads) !== 0) failures.push(`target ${row.id} already has an entity decision`);
  }
  for (const row of loaded.reuse) {
    if (row.state !== "MATCHED" || row.method !== EXACT_METHOD) {
      failures.push(`reuse ${row.id} is ${row.state}/${row.method}`);
    }
  }
  if (Number(loaded.unresolved_same_raw_outside) !== EXPECTED_EXCLUDED_UNRESOLVED) {
    failures.push(`unresolved observations outside the 340=${loaded.unresolved_same_raw_outside}`);
  }
  const batches = planExactNameBatches(loaded.targets, loaded.reuse);
  const assessment = assessP6Batches(batches);
  const expected = {
    batches: EXPECTED_NEW_BATCHES + EXPECTED_REUSE_BATCHES,
    entitiesToCreate: EXPECTED_NEW_BATCHES,
    entitiesToReuse: EXPECTED_REUSE_BATCHES,
    decisionsToInsert: EXPECTED_TARGETS,
    newTargetObservations: EXPECTED_NEW_TARGET_OBSERVATIONS,
    reuseTargetObservations: EXPECTED_REUSE_TARGET_OBSERVATIONS,
    reuseMatchedObservations: EXPECTED_REUSE_MATCHED_OBSERVATIONS,
    submittedObservations: EXPECTED_TARGETS + EXPECTED_REUSE_MATCHED_OBSERVATIONS,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (assessment[key] !== value) failures.push(`${key}=${assessment[key]} expected ${value}`);
  }
  if (failures.length > 0) {
    throw new Error(`balance-endpoint P6 Phase A failed: ${failures.join("; ")}`);
  }
  return { batches, assessment };
}

function isolationSnapshot(database) {
  return jsonRow(database, `
SELECT json_build_object(
  'legal_entities', (SELECT count(*) FROM identity.legal_entity),
  'aliases', (SELECT count(*) FROM identity.legal_entity_alias a
     WHERE NOT EXISTS (SELECT 1 FROM identity.legal_entity_alias s WHERE s.supersedes_id = a.id)),
  'entity_decisions', (SELECT count(*) FROM resolution.entity_resolution_decision),
  'entity_heads', (SELECT count(*) FROM resolution.entity_resolution_decision d
     WHERE NOT EXISTS (SELECT 1 FROM resolution.entity_resolution_decision s WHERE s.supersedes_id = d.id)),
  'match_candidates', (SELECT count(*) FROM resolution.match_candidate),
  'instrument_decisions', (SELECT count(*) FROM resolution.instrument_resolution_decision),
  'continuity_decisions', (SELECT count(*) FROM resolution.position_continuity_decision),
  'instruments', (SELECT count(*) FROM identity.instrument),
  'positions', (SELECT count(*) FROM identity.position),
  'position_observations', (SELECT count(*) FROM obs.position_observation),
  'fact_groups', (SELECT count(*) FROM obs.position_observation_group g
     JOIN ops.rule_version rv ON rv.id = g.rule_version_id
     WHERE rv.rule_code = ${lit(SOI_FACT_GROUP_RULE.code)} AND rv.version = ${lit(SOI_FACT_GROUP_RULE.version)}),
  'fact_group_members', (SELECT count(*) FROM obs.position_observation_group_member m
     JOIN obs.position_observation_group g ON g.id = m.group_id
     JOIN ops.rule_version rv ON rv.id = g.rule_version_id
     WHERE rv.rule_code = ${lit(SOI_FACT_GROUP_RULE.code)} AND rv.version = ${lit(SOI_FACT_GROUP_RULE.version)}),
  'comparisons', (SELECT count(*) FROM registry.position_period_comparison),
  'observation_events', (SELECT count(*) FROM derived.observation_event),
  'economic_groups', (SELECT count(*) FROM identity.economic_group),
  'group_memberships', (SELECT count(*) FROM resolution.group_membership_decision),
  'max_entity_decision_id', (SELECT COALESCE(max(id), 0) FROM resolution.entity_resolution_decision),
  'max_legal_entity_recorded', (SELECT count(*) FROM identity.legal_entity)
)::text;`);
}

function reuseEntityProof(database, batches) {
  const reuse = batches.filter((batch) => batch.mode === "reuse");
  if (reuse.length === 0) return [];
  const names = reuse.map((batch) => lit(batch.rawText)).join(",");
  return jsonRow(database, `
SELECT COALESCE(json_agg(json_build_object(
         'rawText', n.normalized_text,
         'entities', entities,
         'matched_observations', matched_observations)
       ORDER BY n.normalized_text), '[]'::json)
FROM (
  SELECT b.normalized_text,
         count(DISTINCT d.legal_entity_id) AS entities,
         count(*) AS matched_observations
  FROM obs.borrower_name_observation b
  JOIN resolution.current_entity_resolution d ON d.borrower_name_observation_id = b.id
  WHERE b.source_column_label = ${lit(IDENTIFIER_COLUMN)}
    AND b.extraction_state = 'EXTRACTED'
    AND b.normalized_text IN (${names})
    AND d.state = 'MATCHED'
  GROUP BY b.normalized_text
) n;`);
}

export function assertResolvedOnce(loaded, batches) {
  const failures = [];
  if (loaded.targets.length !== EXPECTED_TARGETS) failures.push(`targets=${loaded.targets.length}`);
  const entitiesByName = new Map();
  for (const row of loaded.targets) {
    if (Number(row.nameRows) !== 1) failures.push(`target ${row.id} name rows=${row.nameRows}`);
    if (Number(row.decisionHeads) !== 1 || row.decisionState !== "MATCHED" || row.decisionMethod !== EXACT_METHOD) {
      failures.push(`target ${row.id} decision=${row.decisionHeads}/${row.decisionState}/${row.decisionMethod}`);
    }
    if (!entitiesByName.has(row.rawText)) entitiesByName.set(row.rawText, new Set());
    entitiesByName.get(row.rawText).add(row.legalEntityId);
  }
  for (const batch of batches) {
    const entities = entitiesByName.get(batch.rawText);
    if (!entities || entities.size !== 1 || entities.has(null)) {
      failures.push(`name ${JSON.stringify(batch.rawText)} entities=${entities ? [...entities].join(",") : "none"}`);
      continue;
    }
    const entityId = [...entities][0];
    if (batch.mode === "reuse" && entityId !== batch.legalEntityId) {
      failures.push(`reuse name ${JSON.stringify(batch.rawText)} moved off ${batch.legalEntityId}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`balance-endpoint P6 idempotency check failed: ${failures.join("; ")}`);
  }
  return {
    additionalDecisionsIfExecuted: 0,
    additionalEntitiesIfExecuted: 0,
    distinctEntities: entitiesByName.size,
  };
}

export function applyP6ToBalanceEndpoints({ database = DEFAULT_DATABASE, dryRun = false, log = console.log } = {}) {
  assertLocal(database);
  const loaded = loadEndpointRows(database);
  const targetHeads = loaded.targets.reduce((sum, row) => sum + Number(row.decisionHeads), 0);
  const resolved = loaded.targets.length === EXPECTED_TARGETS && targetHeads === EXPECTED_TARGETS
    && loaded.targets.every((row) => Number(row.decisionHeads) === 1);
  const planned = resolved ? null : assertPhaseA(loaded);
  const batches = planned ? planned.batches : planExactNameBatches(loaded.targets, loaded.reuse);
  const assessment = planned ? planned.assessment : assessP6Batches(batches);
  const idempotent = resolved ? assertResolvedOnce(loaded, batches) : null;
  const summary = {
    dryRun,
    mode: idempotent ? "idempotent" : "insert",
    ...assessment,
    excludedUnresolvedOutsideTarget: Number(loaded.unresolved_same_raw_outside),
    nearNameControls: 0,
    additionalDecisionsIfExecuted: idempotent ? 0 : assessment.decisionsToInsert,
    additionalEntitiesIfExecuted: idempotent ? 0 : assessment.entitiesToCreate,
  };
  if (dryRun) {
    log(JSON.stringify(summary));
    return summary;
  }
  if (idempotent) {
    throw new Error("balance-endpoint P6 already resolved these observations; refusing a second write");
  }

  const before = isolationSnapshot(database);
  assertIsolationSnapshot(before);
  const runRows = queryRows(database, `INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES ('P6_BALANCE_ENDPOINTS', ${lit(pipelineCodeVersion())},
        jsonb_build_object('targets', ${num(EXPECTED_TARGETS)}, 'batches', ${num(batches.length)},
          'reuse_batches', ${num(EXPECTED_REUSE_BATCHES)}),
        now())
RETURNING id;`);
  const runId = Number(runRows[0][0]);
  try {
    const rules = {};
    for (const code of P6_RULES) {
      rules[code] = ensureAndLinkRuleForRun(database, runId, { code, version: "1" }).id;
    }
    let matchedInserted = 0;
    let nearInserted = 0;
    const seenEntities = new Set();
    for (const batch of batches) {
      const inserted = applyP6Min({
        database,
        positionObservationIds: batch.submittedIds,
        runId,
        rules,
        identifierSha256: batch.identifierSha256,
        nearNamePositionObservationIds: [],
      });
      matchedInserted += inserted.matched_inserted;
      nearInserted += inserted.near_name_unresolved_inserted + inserted.near_name_candidates_inserted;
      if (inserted.economic_group_rows !== 0 || inserted.group_membership_rows !== 0) {
        throw new Error("applyP6Min reported an economic group");
      }
      if (batch.mode === "reuse" && inserted.legal_entity_id !== batch.legalEntityId) {
        throw new Error(`reuse batch ${JSON.stringify(batch.rawText)} returned entity ${inserted.legal_entity_id}`);
      }
      if (batch.mode === "new" && (inserted.legal_entity_id === null || seenEntities.has(inserted.legal_entity_id))) {
        throw new Error(`new batch ${JSON.stringify(batch.rawText)} did not create a distinct entity`);
      }
      if (batch.mode === "reuse" && inserted.matched_inserted !== batch.targetIds.length) {
        throw new Error(`reuse batch ${JSON.stringify(batch.rawText)} inserted ${inserted.matched_inserted} decisions`);
      }
      if (batch.mode === "new" && inserted.matched_inserted !== batch.targetIds.length) {
        throw new Error(`new batch ${JSON.stringify(batch.rawText)} inserted ${inserted.matched_inserted} decisions`);
      }
      seenEntities.add(inserted.legal_entity_id);
    }
    if (matchedInserted !== EXPECTED_TARGETS || nearInserted !== 0 || seenEntities.size !== batches.length) {
      throw new Error(`inserted decisions=${matchedInserted} near=${nearInserted} entities=${seenEntities.size}`);
    }
    const after = isolationSnapshot(database);
    const preserved = [
      "instrument_decisions", "continuity_decisions", "instruments", "positions",
      "position_observations", "fact_groups", "fact_group_members", "comparisons",
      "observation_events", "economic_groups", "group_memberships", "match_candidates",
    ];
    const changed = preserved.filter((key) => before[key] !== after[key]);
    if (changed.length > 0) throw new Error(`balance-endpoint P6 changed ${changed.join(", ")}`);
    if (after.legal_entities !== before.legal_entities + EXPECTED_NEW_BATCHES) {
      throw new Error(`legal entities ${before.legal_entities} -> ${after.legal_entities}`);
    }
    if (after.aliases !== before.aliases + EXPECTED_NEW_BATCHES) {
      throw new Error(`aliases ${before.aliases} -> ${after.aliases}`);
    }
    if (after.entity_decisions !== before.entity_decisions + EXPECTED_TARGETS
      || after.entity_heads !== before.entity_heads + EXPECTED_TARGETS) {
      throw new Error(`entity decisions ${before.entity_decisions} -> ${after.entity_decisions}; heads ${before.entity_heads} -> ${after.entity_heads}`);
    }
    const superseded = jsonRow(database, `
SELECT json_build_object(
  'new_run_supersedes', (SELECT count(*) FROM resolution.entity_resolution_decision
     WHERE run_id = ${num(runId)} AND supersedes_id IS NOT NULL),
  'prior_heads_lost', (SELECT count(*) FROM resolution.entity_resolution_decision d
     WHERE d.id <= ${num(before.max_entity_decision_id)}
       AND EXISTS (SELECT 1 FROM resolution.entity_resolution_decision s WHERE s.supersedes_id = d.id))
)::text;`);
    if (Number(superseded.new_run_supersedes) !== 0 || Number(superseded.prior_heads_lost) !== 0) {
      throw new Error(`existing entity decisions were superseded: ${JSON.stringify(superseded)}`);
    }
    const reuseProof = reuseEntityProof(database, batches);
    if (reuseProof.length !== EXPECTED_REUSE_BATCHES) {
      throw new Error(`reuse names after write=${reuseProof.length}`);
    }
    for (const row of reuseProof) {
      const batch = batches.find((item) => item.rawText === row.rawText);
      if (!batch || Number(row.entities) !== 1) {
        throw new Error(`reuse name ${JSON.stringify(row.rawText)} maps to ${row.entities} entities`);
      }
    }
    const result = {
      ...summary,
      runId,
      decisionsInserted: matchedInserted,
      entitiesCreated: EXPECTED_NEW_BATCHES,
      entitiesReused: EXPECTED_REUSE_BATCHES,
      legalEntities: after.legal_entities,
      entityDecisions: after.entity_decisions,
      comparisons: after.comparisons,
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
  applyP6ToBalanceEndpoints({ database, dryRun: args.includes("--dry-run") });
}
