#!/usr/bin/env node
// Test-only, local-only, read-only comparison of NUM currency-binding state.
// Every query runs in a read-only transaction through docker exec on the local container.
// Never targets Hosted. Never writes, drops, or modifies a database.
//
//   node scripts/validation/num-currency-bind-compare.mjs fingerprint DB OUT.json
//   node scripts/validation/num-currency-bind-compare.mjs compare REFERENCE_DB CANDIDATE_DB OUT_DIR
//   node scripts/validation/num-currency-bind-compare.mjs audit DB OUT.json
//
// fingerprint writes counts and export hashes. compare writes both sorted exports and any
// differing lines to OUT_DIR, prints a summary, and exits 1 when anything differs. audit
// recomputes each head's expected outcome in SQL and checks integrity; exits 1 on any
// disagreement or integrity failure.

import { closeSync, mkdirSync, openSync, writeFileSync, writeSync } from "node:fs";
import path from "node:path";

// Large exports exceed V8's maximum string length when joined, so write one line at a time.
function writeLines(file, lines) {
  const fd = openSync(file, "w");
  try {
    for (const line of lines) writeSync(fd, `${line}\n`);
  } finally {
    closeSync(fd);
  }
}

delete process.env.PIPELINE_DATABASE_URL;
delete process.env.DATABASE_URL;
delete process.env.BDC_PIPELINE_ALLOW_HOSTED;

const imp = (p) => import(new URL(`../../${p}`, import.meta.url));
const { CONTAINER, databaseExists } = await imp("scripts/db/pg.mjs");
const { auditBindState, exportBindState, diffLines } = await imp("pipeline/test/num-currency-bind-export.mjs");

if (CONTAINER !== "bdc-intelligence-pg") throw new Error(`unexpected container ${CONTAINER}`);
const [mode, ...args] = process.argv.slice(2);
const dbOk = (name) => {
  if (!/^bdc_[a-z0-9_]+$/.test(name ?? "")) throw new Error(`bad db name ${name}`);
  if (!databaseExists(name)) throw new Error(`${name} does not exist`);
  return name;
};
const summary = (s) => ({
  counts: s.counts,
  bindOutcomes: s.bindOutcomes,
  fieldValueLines: s.fieldValues.length,
  corroborationLines: s.corroborations.length,
  fieldValueKeyDuplicates: s.fieldValueKeyDuplicates,
  corroborationDuplicates: s.corroborationDuplicates,
  exclusionLines: s.exclusions.length,
  exclusionDuplicates: s.exclusionDuplicates,
  fieldValuesSha256: s.fieldValuesSha256,
  corroborationsSha256: s.corroborationsSha256,
  exclusionsSha256: s.exclusionsSha256,
});

if (mode === "fingerprint") {
  const [db, out] = args;
  const result = { database: dbOk(db), at: new Date().toISOString(), ...summary(exportBindState(db)) };
  writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} else if (mode === "compare") {
  const [refDb, candDb, outDir] = args;
  dbOk(refDb);
  dbOk(candDb);
  if (refDb === candDb) throw new Error("reference and candidate must differ");
  mkdirSync(outDir, { recursive: true });
  const ref = exportBindState(refDb);
  const cand = exportBindState(candDb);
  for (const [name, s] of [["reference", ref], ["candidate", cand]]) {
    writeLines(path.join(outDir, `${name}-field-values.tsv`), s.fieldValues);
    writeLines(path.join(outDir, `${name}-corroborations.tsv`), s.corroborations);
    writeLines(path.join(outDir, `${name}-exclusions.tsv`), s.exclusions);
  }
  const fv = diffLines(ref.fieldValues, cand.fieldValues);
  const co = diffLines(ref.corroborations, cand.corroborations);
  const ex = diffLines(ref.exclusions, cand.exclusions);
  const countDiffs = Object.keys({ ...ref.counts, ...cand.counts })
    .filter((k) => ref.counts[k] !== cand.counts[k])
    .map((k) => ({ table: k, reference: ref.counts[k], candidate: cand.counts[k] }));
  const result = {
    reference: { database: refDb, ...summary(ref) },
    candidate: { database: candDb, ...summary(cand) },
    countDiffs,
    fieldValueDiff: { onlyReference: fv.onlyLeft.length, onlyCandidate: fv.onlyRight.length },
    corroborationDiff: { onlyReference: co.onlyLeft.length, onlyCandidate: co.onlyRight.length },
    exclusionDiff: { onlyReference: ex.onlyLeft.length, onlyCandidate: ex.onlyRight.length },
    identical: countDiffs.length === 0
      && ref.fieldValueKeyDuplicates === 0 && cand.fieldValueKeyDuplicates === 0
      && ref.corroborationDuplicates === 0 && cand.corroborationDuplicates === 0
      && ref.exclusionDuplicates === 0 && cand.exclusionDuplicates === 0
      && ref.fieldValuesSha256 === cand.fieldValuesSha256
      && ref.corroborationsSha256 === cand.corroborationsSha256
      && ref.exclusionsSha256 === cand.exclusionsSha256,
  };
  writeFileSync(path.join(outDir, "diff-field-values.json"), JSON.stringify(fv, null, 2));
  writeFileSync(path.join(outDir, "diff-corroborations.json"), JSON.stringify(co, null, 2));
  writeFileSync(path.join(outDir, "diff-exclusions.json"), JSON.stringify(ex, null, 2));
  writeFileSync(path.join(outDir, "compare.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (!result.identical) process.exit(1);
} else if (mode === "audit") {
  const [db, out] = args;
  const result = { database: dbOk(db), at: new Date().toISOString(), ...auditBindState(db) };
  writeFileSync(out, JSON.stringify(result, null, 2));
  const { examples, disagreements, ...brief } = result;
  console.log(JSON.stringify({ ...brief, examples: examples.length, disagreementsShown: disagreements.length }, null, 2));
  const integrityFailures = Object.entries(result.integrity)
    .filter(([k, v]) => k !== "num_facts_bound_to_more_than_one_head" && v !== 0);
  if (result.disagreementCount > 0 || integrityFailures.length > 0) process.exit(1);
} else {
  throw new Error("usage: fingerprint DB OUT.json | compare REFERENCE_DB CANDIDATE_DB OUT_DIR | audit DB OUT.json");
}
