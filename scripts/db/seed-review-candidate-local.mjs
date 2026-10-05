#!/usr/bin/env node
// Attaches an existing local review candidate to source observations already in bdc_local.
// Refuses a hosted URL. Does not create observations, evidence, artifacts, or identity rows.
// If the local database does not already contain the source rows, it writes nothing.

import { databaseExists, dockerAvailable, containerRunning, psql, query } from "./pg.mjs";

const DATABASE = "bdc_local";
const CASE_KEY = "geo-parent-corporation";
const TITLE = "Geo Parent Corporation";
const CREATED_BY = "local-seed";
const DESCRIPTORS = [
  "Geo Parent Corporation",
  "Geo Parent Corporation, First Lien",
  "Geo Parent Corporation, First Lien 1",
  "Geo Parent Corporation, First Lien 2",
];

function stop(message) {
  console.log(`seed-review-candidate-local: ${message}`);
  process.exit(0);
}

if (process.env.DATABASE_URL?.trim() || process.env.PIPELINE_DATABASE_URL?.trim()) {
  stop("refusing to run while a hosted database URL is set");
}
if (!dockerAvailable() || !containerRunning()) stop("local Docker database is not running; nothing was written");
if (!databaseExists(DATABASE)) stop("bdc_local does not exist; nothing was written");
const migrated = query(DATABASE, "SELECT to_regclass('review.current_candidate') IS NOT NULL");
if (migrated[0] !== "t") stop("local review schema is not migrated; nothing was written");

const descriptorList = DESCRIPTORS.map((value) => `'${value.replaceAll("'", "''")}'`).join(", ");
const ids = query(DATABASE, `
  SELECT id::text
  FROM obs.position_observation
  WHERE holding_descriptor_raw IN (${descriptorList})
  ORDER BY id
`);
if (ids.length !== 32) {
  stop(`found ${ids.length} matching source observations; expected 32. Nothing was written`);
}

const existing = query(DATABASE, `
  SELECT candidate_id::text FROM review.current_candidate WHERE case_key = '${CASE_KEY}'
`);
if (existing.length > 0) stop(`case ${CASE_KEY} is already stored; nothing was written`);

const before = query(DATABASE, `
  SELECT
    (SELECT count(*) FROM identity.legal_entity)::text,
    (SELECT count(*) FROM resolution.entity_resolution_decision)::text,
    (SELECT count(*) FROM resolution.match_candidate)::text,
    (SELECT count(*) FROM obs.position_observation)::text,
    (SELECT count(*) FROM evidence.evidence)::text,
    (SELECT count(*) FROM raw.artifact)::text,
    (SELECT max(id) FROM ops.rule_version)::text,
    (SELECT max(id) FROM ops.run)::text
`)[0];

const members = ids.map((id) =>
  `SELECT review.add_member((SELECT candidate_id FROM review.current_candidate WHERE case_key = '${CASE_KEY}'), ${id}, NULL, '${CREATED_BY}');`).join("\n");
const sql = `
BEGIN;
SET ROLE review_writer;
SELECT review.open_candidate('${CASE_KEY}', 'BORROWER', 'MANUAL_SEED', '${TITLE}', '${CREATED_BY}');
${members}
COMMIT;
`;
const result = psql(DATABASE, sql);
if (result.status !== 0) {
  console.error(result.stderr.trim());
  process.exit(1);
}

const after = query(DATABASE, `
  SELECT
    (SELECT count(*) FROM identity.legal_entity)::text,
    (SELECT count(*) FROM resolution.entity_resolution_decision)::text,
    (SELECT count(*) FROM resolution.match_candidate)::text,
    (SELECT count(*) FROM obs.position_observation)::text,
    (SELECT count(*) FROM evidence.evidence)::text,
    (SELECT count(*) FROM raw.artifact)::text,
    (SELECT max(id) FROM ops.rule_version)::text,
    (SELECT max(id) FROM ops.run)::text,
    (SELECT count(*) FROM review.candidate_member m
       JOIN review.current_candidate c ON c.candidate_id = m.candidate_id
      WHERE c.case_key = '${CASE_KEY}')::text
`)[0];
const beforeParts = before.split("\t");
const afterParts = after.split("\t");
if (beforeParts.join("\t") !== afterParts.slice(0, beforeParts.length).join("\t") || afterParts.at(-1) !== "32") {
  console.error("seed-review-candidate-local: source counts changed or membership is not 32");
  process.exit(1);
}
console.log(`seed-review-candidate-local: stored case ${CASE_KEY} with 32 source observations`);
