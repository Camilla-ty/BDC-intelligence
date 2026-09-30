// P9-min: insert REGISTRANT_FIRST_OBSERVED_NAME events for an explicit observation list.
// Does not scan the SOI universe. Does not write amounts, instruments, or Q14 inputs.

import { copyBlock, lit, num, queryRows, runScript } from "../lib/db.mjs";
import {
  FIRST_OBSERVED_CODE, registrantFirstObservedEvents,
} from "../normalize/observation-events.mjs";

function intIds(ids) {
  const out = [];
  const seen = new Set();
  for (const raw of ids ?? []) {
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

export function snapshotP9Min(database) {
  return parseJsonCell(queryRows(database, `
SELECT json_build_object(
  'soi_row_observation_count', (SELECT count(*) FROM obs.soi_row_observation),
  'position_observation_count', (SELECT count(*) FROM obs.position_observation),
  'position_field_value_count', (SELECT count(*) FROM obs.position_field_value),
  'observation_event_count', (SELECT count(*) FROM derived.observation_event),
  'derived_value_count', (SELECT count(*) FROM derived.derived_value),
  'derived_value_input_count', (SELECT count(*) FROM derived.derived_value_input),
  'instrument_count', (SELECT count(*) FROM identity.instrument),
  'economic_group_count', (SELECT count(*) FROM identity.economic_group),
  'max_soi_row_observation_id', (SELECT coalesce(max(id), 0) FROM obs.soi_row_observation),
  'max_position_observation_id', (SELECT coalesce(max(id), 0) FROM obs.position_observation),
  'max_position_field_value_id', (SELECT coalesce(max(id), 0) FROM obs.position_field_value)
);`));
}

export function loadEventFacts(database, positionObservationIds) {
  const ids = intIds(positionObservationIds);
  const list = ids.join(",");
  return parseJsonCell(queryRows(database, `
SELECT coalesce(json_agg(json_build_object(
  'position_observation_id', p.id,
  'reported_date', p.reported_date,
  'evidence_id', p.evidence_id,
  'registrant_id', CASE WHEN fr.registrant_link_status = 'LINKED' THEN fr.registrant_id ELSE NULL END,
  'registrant_link_status', fr.registrant_link_status
) ORDER BY p.id), '[]'::json)
FROM obs.position_observation p
JOIN unnest(ARRAY[${list}]) AS g(id) ON g.id = p.id
LEFT JOIN LATERAL (
  SELECT fr.registrant_id, fr.registrant_link_status
  FROM registry.current_filing_registrant fr
  WHERE fr.filing_id = p.filing_id
  ORDER BY CASE WHEN fr.registrant_link_status = 'LINKED' THEN 0 ELSE 1 END, fr.registrant_id
  LIMIT 1
) fr ON true;`)) ?? [];
}

const RATIONALE = "earliest reported_date among the supplied observations for this LINKED filing registrant; instrument identity is not an input; missing dates are not events; no amount is derived";

export function applyP9Min({ database, positionObservationIds, runId, rules }) {
  const ids = intIds(positionObservationIds);
  if (ids.length === 0) throw new Error("P9-min requires at least one position_observation_id");
  const ruleId = rules["event.registrant_first_observed_name"];
  if (!ruleId) throw new Error("P9-min: missing event.registrant_first_observed_name rule id");

  const facts = loadEventFacts(database, ids);
  if (facts.length !== ids.length) {
    throw new Error(`P9-min: expected ${ids.length} observation facts, got ${facts.length}`);
  }
  const derived = registrantFirstObservedEvents(facts);
  const again = registrantFirstObservedEvents(facts);
  if (JSON.stringify(derived) !== JSON.stringify(again)) {
    throw new Error("P9-min: event derivation is not reproducible");
  }

  const rows = derived.events.map((event) => [
    event.position_observation_id,
    event.reported_date,
    event.evidence_id,
  ]);
  const sql = `
BEGIN;
CREATE TEMP TABLE _p9_event (
  position_observation_id bigint PRIMARY KEY,
  reported_date date NOT NULL,
  evidence_id bigint NOT NULL
) ON COMMIT DROP;
${copyBlock("_p9_event", ["position_observation_id", "reported_date", "evidence_id"], rows)}
WITH ins AS (
  INSERT INTO derived.observation_event (
      event_code, position_observation_id, reported_date, evidence_id, rule_version_id, run_id, rationale)
  SELECT ${lit(FIRST_OBSERVED_CODE)}, e.position_observation_id, e.reported_date, e.evidence_id,
         ${num(ruleId)}, ${num(runId)}, ${lit(RATIONALE)}
  FROM _p9_event e
  WHERE NOT EXISTS (
    SELECT 1 FROM derived.observation_event x
    WHERE x.position_observation_id = e.position_observation_id
      AND x.event_code = ${lit(FIRST_OBSERVED_CODE)}
      AND x.rule_version_id = ${num(ruleId)})
  RETURNING id
)
SELECT json_build_object('inserted', (SELECT count(*) FROM ins));
COMMIT;`;
  const out = runScript(database, sql);
  const line = out.find((l) => l.startsWith("{"));
  const inserted = JSON.parse(line);
  return {
    inserted: Number(inserted.inserted ?? 0),
    event_count: derived.events.length,
    distinct_registrants: derived.distinct_registrants,
    skipped_unlinked: derived.skipped_unlinked,
    recomputation_identical: true,
  };
}
