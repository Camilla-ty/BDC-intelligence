import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  containerRunning, createDatabase, dockerAvailable, dropDatabase, query, startContainer, stopContainer,
} from "../../scripts/db/pg.mjs";
import { migrate } from "../../scripts/db/migrate.mjs";
import { applyP4Min } from "../load/p4-min.mjs";
import { registerRules } from "../load/rules.mjs";
import { pipelineCodeVersion } from "../load/run.mjs";
import { runLoad } from "../load/run.mjs";
import { runSoiLoad } from "../load/soi-run.mjs";
import { queryRows } from "../lib/db.mjs";
import { runP5Golden } from "../p5-golden.mjs";
import { FAKE, writeSyntheticTree } from "./synthetic.mjs";

const dbName = `bdc_p5_${process.pid}`;

function rows(sql) {
  return query(dbName, sql);
}

function scalar(sql) {
  const found = rows(sql);
  assert.equal(found.length, 1, `expected one row from: ${sql}`);
  return found[0];
}

function withDb(fn) {
  return async (t) => {
    if (!dockerAvailable()) {
      if (process.env.CI) throw new Error("Docker is required in CI for pipeline database tests");
      t.skip("Docker is not available; pipeline database tests skipped");
      return;
    }
    let startedHere = false;
    if (!containerRunning()) {
      startedHere = startContainer();
      if (!containerRunning()) throw new Error("PostgreSQL container is not running");
    }
    const dataDir = mkdtempSync(path.join(tmpdir(), "bdc-p5-"));
    try {
      dropDatabase(dbName);
      createDatabase(dbName);
      migrate(dbName);
      await fn(dataDir);
    } finally {
      try { dropDatabase(dbName); } catch { /* still clean the temp dir */ }
      rmSync(dataDir, { recursive: true, force: true });
      if (startedHere) {
        try { stopContainer(); } catch { /* container may already be gone */ }
      }
    }
  };
}

test("P5-min fetches stored document URLs only and records string checks without rewriting SOI", withDb(async (dataDir) => {
  writeSyntheticTree(dataDir);
  await runLoad({ dataDir, database: dbName, log: () => {} });
  await runSoiLoad({ dataDir, database: dbName, log: () => {} });

  const identIds = rows(`SELECT p.id FROM obs.position_observation p
    JOIN obs.soi_row_observation s ON s.id = p.origin_soi_row_observation_id
    WHERE s.identifier_raw = '${FAKE.ident}'
    ORDER BY p.id`).map(Number);
  assert.ok(identIds.length >= 1);
  const sha = createHash("sha256").update(FAKE.ident, "utf8").digest("hex");
  const p4Run = Number(queryRows(dbName, `INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES ('P4_GOLDEN', '${pipelineCodeVersion()}', '{"test":true}'::jsonb, now()) RETURNING id;`)[0][0]);
  applyP4Min({
    database: dbName, positionObservationIds: identIds, runId: p4Run,
    rules: registerRules(dbName, p4Run), identifierSha256: sha,
  });

  const urls = rows(`SELECT DISTINCT d.document_url FROM registry.filing_document d
    JOIN obs.position_observation p ON p.filing_id = d.filing_id
    WHERE p.id IN (${identIds.join(",")})
    ORDER BY 1`);
  assert.ok(urls.length >= 1);
  assert.ok(urls.every((u) => u.startsWith("https://www.sec.gov/Archives/edgar/data/")));

  const html = Buffer.from(`<html><body>
    ${FAKE.ident}
    <ix:nonFraction>100</ix:nonFraction>
    90 80 0.05 0.01
    </body></html>`);
  const seen = [];
  const client = {
    get: async (url) => {
      seen.push(url);
      assert.ok(urls.includes(url), "P5-min must not invent a document URL");
      return {
        status: 200, finalUrl: url, body: html,
        contentType: "text/html", lastModified: null, etag: null,
      };
    },
  };

  const locatorsPath = path.join(dataDir, "locators.jsonl");
  const selectionPath = path.join(dataDir, "selection.json");
  const reportPath = path.join(dataDir, "p5_report.json");
  writeFileSync(locatorsPath, identIds.map((id) => JSON.stringify({ position_observation_id: id })).join("\n") + "\n");
  writeFileSync(selectionPath, JSON.stringify({ selected: { identifier_sha256: sha } }));

  const soiBefore = scalar("SELECT count(*) FROM obs.soi_row_observation");
  const fieldBefore = scalar("SELECT count(*) FROM obs.position_field_value");
  const derivedBefore = scalar("SELECT count(*) FROM derived.derived_value_input");

  const report = await runP5Golden({
    database: dbName, locatorsPath, selectionPath, reportPath, dataDir, client,
    sessionId: "TEST-ONLY-P5", log: () => {},
  });
  assert.equal(report.non_golden_soi_unchanged, true);
  assert.equal(scalar("SELECT count(*) FROM obs.soi_row_observation"), soiBefore);
  assert.equal(scalar("SELECT count(*) FROM obs.position_field_value"), fieldBefore);
  assert.equal(scalar("SELECT count(*) FROM derived.derived_value_input"), derivedBefore);
  assert.deepEqual(seen.sort(), [...urls].sort());
  assert.equal(report.documents_successfully_fetched, urls.length);
  assert.equal(report.documents_unavailable, 0);
  assert.ok(report.l2_artifacts >= urls.length);
  assert.equal(report.identifier_name.pass, identIds.length);
  assert.equal(report.identifier_name.fail, 0);
  assert.ok(report.field_values.FILING_VERIFIED >= 1);
  assert.ok(report.field_values.UNVERIFIABLE >= 1);
  assert.equal(report.field_values.FILING_MISMATCH, 0);
  assert.equal(report.field_values.NOT_CHECKED, 0);
  assert.equal(report.q14.derived_inputs, 0);
  assert.equal(report.q14.authoritative_cost_fv, 0);
  assert.equal(report.q14_remains_blocked, true);

  assert.equal(scalar(`SELECT count(*) FROM obs.field_value_authority a
    JOIN obs.current_position_field_value fv ON fv.id = a.field_value_id
    WHERE fv.position_observation_id IN (${identIds.join(",")})
      AND fv.field_code IN ('COST','FAIR_VALUE')
      AND fv.value_state = 'REPORTED'
      AND a.authority = 'PROVISIONAL'`), scalar(`SELECT count(*) FROM obs.current_position_field_value fv
    WHERE fv.position_observation_id IN (${identIds.join(",")})
      AND fv.field_code IN ('COST','FAIR_VALUE')
      AND fv.value_state = 'REPORTED' AND coalesce(fv.raw_value,'') <> ''`));

  const again = await runP5Golden({
    database: dbName, locatorsPath, selectionPath, reportPath, dataDir, client,
    sessionId: "TEST-ONLY-P5", log: () => {},
  });
  assert.equal(again.fetch.requests, 0);
  assert.equal(again.verified.status_assertions, 0);
  assert.equal(scalar("SELECT count(*) FROM obs.position_field_value"), fieldBefore);
}));
