import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  containerRunning, createDatabase, dockerAvailable, dropDatabase, query, startContainer, stopContainer,
} from "../../scripts/db/pg.mjs";
import { migrate } from "../../scripts/db/migrate.mjs";
import { applyP4Min } from "../load/p4-min.mjs";
import { applyP6CompanyCell, planP6CompanyCell } from "../load/p6-company-cell.mjs";
import { registerRules } from "../load/rules.mjs";
import { pipelineCodeVersion, runLoad } from "../load/run.mjs";
import { runSoiLoad } from "../load/soi-run.mjs";
import { queryRows } from "../lib/db.mjs";
import { FAKE, p7Sources, writeSyntheticTree } from "./synthetic.mjs";

const dbName = `bdc_p6cc_${process.pid}`;
const COMPANY = "TEST BORROWER A";

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
    const dataDir = mkdtempSync(path.join(tmpdir(), "bdc-p6cc-"));
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

function identIds(identifier) {
  return rows(`SELECT p.id FROM obs.position_observation p
    JOIN obs.soi_row_observation s ON s.id = p.origin_soi_row_observation_id
    WHERE s.identifier_raw = '${identifier}'
    ORDER BY p.id`).map(Number);
}

function insertCompanyCell(po, tag, runId, rules) {
  const url = `https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000001/test-only-${tag}.htm`;
  queryRows(dbName, `
WITH art AS (
  INSERT INTO raw.artifact (source_url, final_url, source_type_code, http_status, byte_size, sha256,
      retrieved_at, storage_key, run_id)
  VALUES ('${url}', '${url}', 'SEC_FILING_DOCUMENT', 200, 1, '${createHash("sha256").update(tag).digest("hex")}',
          '2099-01-02T00:00:00Z', 'test-only/${tag}', ${runId})
  RETURNING id
), ev AS (
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_anchor, run_id)
  SELECT 'L2_ORIGINAL_FILING'::ref.evidence_level, art.id, 'HTML_ANCHOR'::ref.locator_type,
         'ix-context-row:TEST-ONLY-${tag}', ${runId}
  FROM art
  RETURNING id, artifact_id
), doc AS (
  INSERT INTO registry.filing_document (filing_id, document_name, document_url, named_by,
      rule_version_id, run_id, evidence_id)
  SELECT p.filing_id, 'test-only-${tag}.htm', '${url}', 'FILING_INDEX_JSON', ${rules["norm.borrower_name"]}, ${runId}, ev.id
  FROM obs.position_observation p
  CROSS JOIN ev
  WHERE p.id = ${po}
  RETURNING id
), link AS (
  INSERT INTO registry.filing_document_artifact (filing_document_id, artifact_id, run_id)
  SELECT doc.id, ev.artifact_id, ${runId}
  FROM doc
  CROSS JOIN ev
  RETURNING id
)
INSERT INTO obs.borrower_name_observation (
    position_observation_id, name_source, raw_text, normalized_text, extraction_state,
    rule_version_id, evidence_id, run_id)
SELECT ${po}, 'FILING_CELL', '${COMPANY}', '${COMPANY}', 'EXTRACTED',
       ${rules["norm.borrower_name"]}, ev.id, ${runId}
FROM ev
CROSS JOIN link;`);
}

function decisionRows() {
  return rows(`SELECT d.id, d.borrower_name_observation_id, coalesce(d.legal_entity_id::text, ''), d.state, d.method,
      d.rationale, d.evidence_id, d.rule_version_id, d.run_id, coalesce(d.supersedes_id::text, ''), d.decided_at
    FROM resolution.entity_resolution_decision d ORDER BY d.id`);
}

test("P6 company cell: one legal entity from the company cell, the rest UNRESOLVED, append-only rerun", withDb(async (dataDir) => {
  writeSyntheticTree(dataDir, p7Sources());
  await runLoad({ dataDir, database: dbName, log: () => {} });
  await runSoiLoad({ dataDir, database: dbName, log: () => {} });

  const groupA = identIds(FAKE.ident);
  const group2 = identIds(FAKE.ident2);
  assert.ok(groupA.length >= 3);
  assert.equal(group2.length, 1);
  const all = [...groupA, ...group2].sort((left, right) => left - right);

  const runId = Number(queryRows(dbName, `INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES ('ELIGIBLE_INSTRUMENT_RESOLUTION', '${pipelineCodeVersion()}', '{"test":true}'::jsonb, now()) RETURNING id;`)[0][0]);
  const rules = registerRules(dbName, runId);
  assert.ok(rules["resolution.entity_exact_company_cell_name"]);
  for (const [identifier, ids] of [[FAKE.ident, groupA], [FAKE.ident2, group2]]) {
    applyP4Min({
      database: dbName,
      positionObservationIds: ids,
      runId,
      rules,
      identifierSha256: createHash("sha256").update(identifier, "utf8").digest("hex"),
    });
  }

  // The company cell is on one cik2 observation of identifier A and on the identifier 2 observation (cik1).
  const cik2A = Number(scalar(`SELECT p.id FROM obs.position_observation p
    JOIN registry.current_filing_registrant fr ON fr.filing_id = p.filing_id
    JOIN registry.registrant r ON r.id = fr.registrant_id
    WHERE p.id IN (${groupA.join(",")}) AND r.cik = ${FAKE.cik2}
    ORDER BY p.id LIMIT 1`));
  const withCell = [cik2A, group2[0]].sort((left, right) => left - right);
  const withoutCell = all.filter((id) => !withCell.includes(id));
  insertCompanyCell(cik2A, "cc-a", runId, rules);
  insertCompanyCell(group2[0], "cc-2", runId, rules);

  const plan = planP6CompanyCell(dbName, all);
  assert.deepEqual(plan.newEntities.map((entity) => entity.aliasText), [COMPANY]);
  assert.equal(plan.alreadyDecided, 0);

  const counts = applyP6CompanyCell({ database: dbName, positionObservationIds: all, runId, rules });
  assert.deepEqual(counts, {
    legal_entities_created: 1,
    matched_inserted: 2,
    unresolved_inserted: withoutCell.length,
    already_decided: 0,
  });

  assert.equal(scalar("SELECT count(*) FROM identity.legal_entity"), "1");
  assert.deepEqual(rows("SELECT alias_text FROM identity.legal_entity_alias"), [COMPANY]);
  assert.equal(scalar(`SELECT count(*) FROM identity.legal_entity_alias
    WHERE alias_text LIKE '%|%' OR alias_text LIKE '%TEST LOAN%'`), "0");
  assert.equal(scalar("SELECT count(*) FROM identity.economic_group"), "0");

  assert.deepEqual(rows(`SELECT b.position_observation_id FROM resolution.current_entity_resolution d
    JOIN obs.borrower_name_observation b ON b.id = d.borrower_name_observation_id
    WHERE d.state = 'MATCHED' AND d.method = 'EXACT_COMPANY_CELL_NAME'
      AND b.source_column_label = 'Investment, Identifier Axis'
    ORDER BY 1`).map(Number), withCell);
  assert.equal(scalar(`SELECT count(DISTINCT d.legal_entity_id) FROM resolution.current_entity_resolution d
    WHERE d.state = 'MATCHED'`), "1");
  assert.equal(scalar(`SELECT count(*) FROM resolution.current_entity_resolution d
    JOIN obs.borrower_name_observation f ON f.evidence_id = d.evidence_id AND f.name_source = 'FILING_CELL'
    WHERE d.state = 'MATCHED'`), "2");
  assert.deepEqual(rows(`SELECT b.position_observation_id FROM resolution.current_entity_resolution d
    JOIN obs.borrower_name_observation b ON b.id = d.borrower_name_observation_id
    WHERE d.state = 'UNRESOLVED' AND d.method = 'NO_COMPANY_NAME_EVIDENCE' AND d.legal_entity_id IS NULL
      AND d.evidence_id = b.evidence_id
    ORDER BY 1`).map(Number), withoutCell);

  assert.deepEqual(rows("SELECT position_observation_id FROM registry.matched_entity_position ORDER BY 1").map(Number), withCell);

  const before = decisionRows();
  const aliasesBefore = rows("SELECT id, legal_entity_id, alias_text FROM identity.legal_entity_alias ORDER BY id");
  const rerun = applyP6CompanyCell({ database: dbName, positionObservationIds: all, runId, rules });
  assert.deepEqual(rerun, {
    legal_entities_created: 0, matched_inserted: 0, unresolved_inserted: 0, already_decided: all.length,
  });
  assert.deepEqual(decisionRows(), before);
  assert.deepEqual(rows("SELECT id, legal_entity_id, alias_text FROM identity.legal_entity_alias ORDER BY id"), aliasesBefore);

  // Company evidence that arrives later does not update an existing UNRESOLVED decision.
  insertCompanyCell(withoutCell[0], "cc-late", runId, rules);
  const late = applyP6CompanyCell({ database: dbName, positionObservationIds: all, runId, rules });
  assert.equal(late.matched_inserted, 0);
  assert.equal(late.unresolved_inserted, 0);
  assert.deepEqual(decisionRows(), before);
  assert.deepEqual(rows("SELECT position_observation_id FROM registry.matched_entity_position ORDER BY 1").map(Number), withCell);
}));
