import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  containerRunning, createDatabase, dockerAvailable, dropDatabase, query, startContainer, stopContainer,
} from "../../scripts/db/pg.mjs";
import { migrate } from "../../scripts/db/migrate.mjs";
import { DEFAULT_DATA_DIR } from "../lib/config.mjs";
import { LOG_FILE, createFetchLog, readFetchLog } from "../lib/fetch-log.mjs";
import { VERIFIED_NUM_HEADER } from "../lib/num-schema.mjs";
import { createStore } from "../lib/store.mjs";
import { runLoad } from "../load/run.mjs";
import { runSoiLoad } from "../load/soi-run.mjs";
import { runNumLoad } from "../load/num-run.mjs";
import { runNumCurrencyBind } from "../load/num-currency-bind.mjs";
import { FIELD_NUM_TAGS, MONETARY_FIELD_CODES } from "../normalize/num-currency-bind.mjs";
import { parseIdentifierMemberFromSegments } from "../normalize/num-segments.mjs";
import { readMember } from "../parse/zip.mjs";
import { assertIntegrationPipelineIsLocal } from "./local-pipeline-db.mjs";
import { buildStoredZip } from "./zip-store.mjs";

// Real SEC bytes are read from the git-ignored .data/sec store at runtime and never copied into
// the repository. The holding is pinned by the SHA-256 of its identifier text, and expected
// amounts are the stored source cells themselves.
const STORED_ZIP_SHA256 = "dded644dc58773ea5b9c332621ba394c11d49a18a83869d50e073b8d724fdeca";
const ACCESSION = "0001628280-26-050307";
const IDENTIFIER_SHA256 = "6495da6de7b9d7499f8ee9adfb424bb1b587ac5088b54fea8905904ee6dbeb0a";

const SOI_LABEL = Object.freeze({
  PRINCIPAL_AMOUNT: "Investment Owned, Balance, Principal Amount",
  COST: "Adjusted cost basis",
  FAIR_VALUE: "Initial fair value of Investment",
});
const EMPTY_PRESET_LABELS = Object.freeze(["Investment Owned, Cost", "Investment Owned, Fair Value"]);

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const sqlText = (value) => `'${String(value).replaceAll("'", "''")}'`;

function storedSources() {
  if (!existsSync(path.join(DEFAULT_DATA_DIR, LOG_FILE))) return null;
  const { entries } = readFetchLog(DEFAULT_DATA_DIR);
  const zipEntry = entries.find((e) => e.source_type === "SEC_BDC_DATASET_ZIP" && e.sha256 === STORED_ZIP_SHA256);
  if (!zipEntry) return null;
  const pageEntry = entries.find((e) => e.seq === Number(zipEntry.context?.page_seq));
  if (!pageEntry || pageEntry.source_type !== "SEC_BDC_DATASETS_PAGE") return null;
  const store = createStore(DEFAULT_DATA_DIR);
  if (!existsSync(store.pathFor(zipEntry.storage_key)) || !existsSync(store.pathFor(pageEntry.storage_key))) return null;
  store.read(zipEntry.storage_key, zipEntry.sha256);
  return {
    zipEntry,
    zipPath: store.pathFor(zipEntry.storage_key),
    pageEntry,
    pageBody: store.read(pageEntry.storage_key, pageEntry.sha256),
  };
}

function lines(buffer) {
  const all = buffer.toString("utf8").split("\n");
  if (all[all.length - 1] === "") all.pop();
  assert.ok(all.every((l) => !l.includes("\r")), "stored member has carriage returns");
  return all;
}

// Byte-exact header and data lines for one filing and one holding of the stored release.
function extractFixture(zipPath) {
  const [subHeader, ...subRows] = lines(readMember(zipPath, "datasets/sub.tsv"));
  const subLines = subRows.filter((l) => l.split("\t")[subHeader.split("\t").indexOf("adsh")] === ACCESSION);
  assert.equal(subLines.length, 1, "expected one SUB row for the accession");

  const [soiHeaderLine, ...soiRows] = lines(readMember(zipPath, "soi.tsv"));
  const soiHeader = soiHeaderLine.split("\t");
  const at = (label) => {
    const i = soiHeader.indexOf(label);
    assert.ok(i >= 0, `SOI header has no ${label}`);
    return i;
  };
  const soiLines = soiRows.filter((l) => {
    const cells = l.split("\t");
    return cells.length === soiHeader.length
      && cells[at("adsh")] === ACCESSION
      && sha256(cells[at("Investment, Identifier Axis")]) === IDENTIFIER_SHA256;
  });
  assert.equal(soiLines.length, 1, "expected one SOI row for the pinned holding");
  const soiCells = soiLines[0].split("\t");
  const soi = Object.fromEntries(soiHeader.map((label, i) => [label, soiCells[i]]));
  const identifier = soi["Investment, Identifier Axis"];

  const [numHeader, ...numRows] = lines(readMember(zipPath, "datasets/num.tsv"));
  assert.equal(numHeader, VERIFIED_NUM_HEADER.join("\t"));
  const col = (label) => VERIFIED_NUM_HEADER.indexOf(label);
  const numLines = numRows.filter((l) => {
    const cells = l.split("\t");
    return cells.length === VERIFIED_NUM_HEADER.length
      && cells[col("adsh")] === ACCESSION
      && parseIdentifierMemberFromSegments(cells[col("segments")]) === identifier;
  });
  assert.ok(numLines.length >= MONETARY_FIELD_CODES.length, "expected NUM facts for the pinned holding");

  return { subHeader, subLines, soiHeaderLine, soiLines, numHeader, numLines, soi, identifier, col };
}

function writeDataDir(dataDir, sources, fixture, extraNumLines = []) {
  const store = createStore(dataDir);
  const log = createFetchLog(dataDir);
  const append = (entry, body, context) => {
    const stored = store.put(body);
    return log.append({
      session_id: "TEST-ONLY-SESSION",
      requested_at: entry.requested_at,
      url: entry.url,
      final_url: entry.final_url,
      http_status: 200,
      content_type: entry.content_type,
      byte_size: stored.byteSize,
      sha256: stored.sha256,
      storage_key: stored.storageKey,
      source_type: entry.source_type,
      context,
    });
  };
  const tsv = (header, rows) => `${[header, ...rows].join("\n")}\n`;
  const page = append(sources.pageEntry, sources.pageBody, sources.pageEntry.context);
  append(sources.zipEntry, buildStoredZip({
    "datasets/sub.tsv": tsv(fixture.subHeader, fixture.subLines),
    "soi.tsv": tsv(fixture.soiHeaderLine, fixture.soiLines),
    "datasets/num.tsv": tsv(fixture.numHeader, [...fixture.numLines, ...extraNumLines]),
  }), { ...sources.zipEntry.context, page_seq: page.seq });
}

function withStoredDb(dbName, fn) {
  return async (t) => {
    const sources = storedSources();
    if (!sources) {
      t.skip("stored data-set ZIP is not present in .data/sec");
      return;
    }
    if (!dockerAvailable()) {
      if (process.env.CI) throw new Error("Docker is required in CI for pipeline integration tests");
      t.skip("Docker is not available; pipeline database tests skipped");
      return;
    }
    assertIntegrationPipelineIsLocal();
    let startedHere = false;
    if (!containerRunning()) {
      startedHere = startContainer();
      if (!containerRunning()) throw new Error("PostgreSQL container is not running");
    }
    const dataDir = mkdtempSync(path.join(tmpdir(), "bdc-num-stored-"));
    try {
      dropDatabase(dbName);
      createDatabase(dbName);
      migrate(dbName);
      await fn({ t, dataDir, sources, fixture: extractFixture(sources.zipPath) });
    } finally {
      try { dropDatabase(dbName); } catch { /* still clean the temp dir */ }
      rmSync(dataDir, { recursive: true, force: true });
      if (startedHere) {
        try { stopContainer(); } catch { /* container may already be gone */ }
      }
    }
  };
}

function loader(dbName) {
  const rows = (sql) => query(dbName, sql).map((line) => line.split("\t"));
  const scalar = (sql) => {
    const found = query(dbName, sql);
    assert.equal(found.length, 1, `expected one row from: ${sql}`);
    return found[0];
  };
  return { rows, scalar };
}

async function loadAll(dataDir, database) {
  await runLoad({ dataDir, database, log: () => {} });
  await runSoiLoad({ dataDir, database, log: () => {} });
  return runNumLoad({ dataDir, database, log: () => {} });
}

function positionId(scalar, identifier) {
  return scalar(`
SELECT p.id FROM obs.position_observation p
JOIN registry.filing f ON f.id = p.filing_id
WHERE f.accession_number = ${sqlText(ACCESSION)} AND p.holding_descriptor_raw = ${sqlText(identifier)}`);
}

function monetaryRows(rows, posId) {
  return rows(`
SELECT fv.id, fv.field_code, coalesce(fv.source_column_label, ''), coalesce(fv.raw_value, ''),
       fv.normalized_numeric::text, fv.currency_state::text, coalesce(fv.currency_code, ''),
       fv.evidence_id, coalesce(fv.supersedes_id::text, '')
FROM obs.position_field_value fv
WHERE fv.position_observation_id = ${posId}
  AND fv.field_code IN (${MONETARY_FIELD_CODES.map(sqlText).join(", ")})
ORDER BY fv.id`).map(([id, field, label, raw, normalized, state, code, evidence, supersedes]) => ({
    id, field, label, raw, normalized, state, code, evidence, supersedes,
  }));
}

test("stored NUM facts bind USD to one stored SOI holding; originals stay UNKNOWN; reruns add nothing", withStoredDb(
  `bdc_numarcc_${process.pid}`,
  async ({ t, dataDir, sources, fixture }) => {
    const dbName = `bdc_numarcc_${process.pid}`;
    const { rows, scalar } = loader(dbName);
    writeDataDir(dataDir, sources, fixture);
    const firstNum = await loadAll(dataDir, dbName);
    assert.equal(Number(firstNum.totals.num_fact_observations), fixture.numLines.length);

    for (const label of Object.values(SOI_LABEL)) assert.notEqual(fixture.soi[label], "", `${label} is empty in the source`);
    for (const label of EMPTY_PRESET_LABELS) assert.equal(fixture.soi[label], "", `${label} is not empty in the source`);

    const posId = positionId(scalar, fixture.identifier);
    assert.equal(scalar(`
SELECT count(*) FROM obs.position_field_value
WHERE position_observation_id = ${posId}
  AND source_column_label IN (${EMPTY_PRESET_LABELS.map(sqlText).join(", ")})`), "0");

    const originals = monetaryRows(rows, posId);
    assert.equal(originals.length, MONETARY_FIELD_CODES.length);
    for (const field of MONETARY_FIELD_CODES) {
      const head = originals.find((r) => r.field === field);
      assert.ok(head, `no ${field} head`);
      assert.equal(head.label, SOI_LABEL[field]);
      assert.equal(head.raw, fixture.soi[SOI_LABEL[field]]);
      assert.equal(head.state, "UNKNOWN");
      assert.equal(head.code, "");
      assert.equal(head.supersedes, "");
    }

    const factIds = {};
    for (const field of MONETARY_FIELD_CODES) {
      const [tag] = FIELD_NUM_TAGS[field];
      const head = originals.find((r) => r.field === field);
      const facts = rows(`
SELECT n.id, n.uom_raw, n.value_raw, n.value_numeric::text, n.qtrs::text, n.duration_kind::text,
       n.reported_date::text, (n.value_numeric = ${head.normalized}::numeric)::text
FROM obs.num_fact_observation n
JOIN registry.filing f ON f.id = n.filing_id
WHERE f.accession_number = ${sqlText(ACCESSION)}
  AND n.identifier_member_raw = ${sqlText(fixture.identifier)}
  AND n.tag = ${sqlText(tag)}
  AND n.reported_date = ${sqlText(fixture.soi.ddate)}::date`);
      assert.equal(facts.length, 1, `expected one ${tag} fact`);
      const [id, uom, valueRaw, valueNumeric, qtrs, duration, reportedDate, equalsHead] = facts[0];
      assert.equal(uom, "USD");
      assert.equal(valueRaw, fixture.soi[SOI_LABEL[field]]);
      assert.equal(equalsHead, "true");
      assert.equal(qtrs, "0");
      assert.equal(duration, "POINT_IN_TIME");
      factIds[field] = id;
      t.diagnostic(`${tag} uom=${uom} value_numeric=${valueNumeric} reported_date=${reportedDate}`);
    }

    const bind1 = await runNumCurrencyBind({ database: dbName, log: () => {} });
    assert.equal(bind1.totals.promoted, MONETARY_FIELD_CODES.length);
    assert.equal(bind1.totals.not_equal, 0);
    assert.equal(bind1.totals.multiple, 0);

    const after = monetaryRows(rows, posId);
    assert.equal(after.length, 2 * MONETARY_FIELD_CODES.length);
    for (const field of MONETARY_FIELD_CODES) {
      const original = originals.find((r) => r.field === field);
      assert.deepEqual(after.find((r) => r.id === original.id), original, `${field} original changed`);

      const successors = after.filter((r) => r.supersedes === original.id);
      assert.equal(successors.length, 1, `${field} has ${successors.length} successors`);
      const [successor] = successors;
      assert.equal(successor.field, field);
      assert.equal(successor.state, "FROM_NUM_UNIQUE_MATCH");
      assert.equal(successor.code, "USD");
      assert.equal(successor.raw, original.raw);
      assert.equal(successor.normalized, original.normalized);
      assert.equal(successor.label, original.label);
      assert.equal(successor.evidence, original.evidence);

      assert.equal(scalar(`
SELECT fv.id FROM obs.current_position_field_value fv
WHERE fv.position_observation_id = ${posId} AND fv.field_code = ${sqlText(field)}`), successor.id);

      const corroborations = rows(`
SELECT outcome::text, coalesce(num_fact_observation_id::text, ''), join_basis
FROM obs.field_value_corroboration WHERE field_value_id = ${successor.id}`);
      assert.deepEqual(corroborations, [["EQUAL", factIds[field], "OBSERVED_UNDOCUMENTED"]]);
      t.diagnostic(`${field} successor currency_state=${successor.state} currency_code=${successor.code} raw=${successor.raw}`);
    }
    assert.equal(scalar(`
SELECT count(*) FROM obs.field_value_corroboration c
JOIN obs.position_field_value fv ON fv.id = c.field_value_id
WHERE fv.position_observation_id = ${posId}`), String(MONETARY_FIELD_CODES.length));

    const counts = () => scalar(`
SELECT (SELECT count(*) FROM obs.num_fact_observation) || '|' ||
       (SELECT count(*) FROM obs.position_field_value) || '|' ||
       (SELECT count(*) FROM obs.position_field_value WHERE supersedes_id IS NOT NULL) || '|' ||
       (SELECT count(*) FROM obs.field_value_corroboration) || '|' ||
       (SELECT count(*) FROM raw.table_load WHERE table_code = 'NUM')`);
    const before = counts();
    const numSecond = await runNumLoad({ dataDir, database: dbName, log: () => {} });
    assert.equal(numSecond.totals.units, 0);
    assert.equal(numSecond.totals.skipped, 1);
    const bind2 = await runNumCurrencyBind({ database: dbName, log: () => {} });
    assert.equal(bind2.totals.promoted, 0);
    assert.equal(counts(), before);
    assert.deepEqual(monetaryRows(rows, posId), after);
    t.diagnostic(`counts facts|field_values|successors|corroborations|num_loads = ${before}`);
  },
));

test("a second stored-key fact in another currency leaves that head UNKNOWN", withStoredDb(
  `bdc_numarcc_ccy_${process.pid}`,
  async ({ t, dataDir, sources, fixture }) => {
    const dbName = `bdc_numarcc_ccy_${process.pid}`;
    const { rows, scalar } = loader(dbName);
    const { col } = fixture;
    const [principalTag] = FIELD_NUM_TAGS.PRINCIPAL_AMOUNT;
    const principalLines = fixture.numLines.filter((l) => l.split("\t")[col("tag")] === principalTag
      && l.split("\t")[col("ddate")] === fixture.soi.ddate.replaceAll("-", ""));
    assert.equal(principalLines.length, 1);
    const cells = principalLines[0].split("\t");
    assert.equal(cells[col("uom")], "USD");
    cells[col("uom")] = "EUR";
    writeDataDir(dataDir, sources, fixture, [cells.join("\t")]);
    await loadAll(dataDir, dbName);

    const posId = positionId(scalar, fixture.identifier);
    assert.equal(scalar(`
SELECT count(DISTINCT n.uom_raw) FROM obs.num_fact_observation n
WHERE n.identifier_member_raw = ${sqlText(fixture.identifier)} AND n.tag = ${sqlText(principalTag)}`), "2");

    const bind1 = await runNumCurrencyBind({ database: dbName, log: () => {} });
    assert.equal(bind1.totals.multiple, 1);
    assert.equal(bind1.totals.promoted, MONETARY_FIELD_CODES.length - 1);

    const principal = monetaryRows(rows, posId).filter((r) => r.field === "PRINCIPAL_AMOUNT");
    assert.equal(principal.length, 1, "principal gained a successor");
    assert.equal(principal[0].state, "UNKNOWN");
    assert.equal(principal[0].code, "");
    assert.equal(principal[0].raw, fixture.soi[SOI_LABEL.PRINCIPAL_AMOUNT]);
    assert.deepEqual(rows(`
SELECT outcome::text, coalesce(num_fact_observation_id::text, '')
FROM obs.field_value_corroboration WHERE field_value_id = ${principal[0].id}`), [["MULTIPLE_CANDIDATES", ""]]);
    for (const field of ["COST", "FAIR_VALUE"]) {
      assert.equal(scalar(`
SELECT currency_state::text || '|' || coalesce(currency_code, '') FROM obs.current_position_field_value
WHERE position_observation_id = ${posId} AND field_code = ${sqlText(field)}`), "FROM_NUM_UNIQUE_MATCH|USD");
    }

    const corrBefore = scalar("SELECT count(*) FROM obs.field_value_corroboration");
    const bind2 = await runNumCurrencyBind({ database: dbName, log: () => {} });
    assert.equal(bind2.totals.promoted, 0);
    assert.equal(bind2.totals.multiple, 0);
    assert.equal(scalar("SELECT count(*) FROM obs.field_value_corroboration"), corrBefore);
    assert.equal(scalar(`
SELECT currency_state::text || '|' || coalesce(currency_code, '') FROM obs.current_position_field_value
WHERE position_observation_id = ${posId} AND field_code = 'PRINCIPAL_AMOUNT'`), "UNKNOWN|");
    t.diagnostic(`principal stays UNKNOWN with MULTIPLE_CANDIDATES; cost and fair value promote USD; corroborations=${corrBefore}`);
  },
));
