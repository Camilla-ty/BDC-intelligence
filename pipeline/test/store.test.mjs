import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { createStore, sha256Hex } from "../lib/store.mjs";
import { createFetchLog, readFetchLog } from "../lib/fetch-log.mjs";

test("store writes once and verifies the checksum on read", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bdc-store-"));
  try {
    const store = createStore(dir);
    const body = Buffer.from("TEST ONLY bytes");
    const a = store.put(body);
    const b = store.put(body);
    assert.equal(a.sha256, sha256Hex(body));
    assert.equal(a.existed, false);
    assert.equal(b.existed, true);
    assert.equal(a.storageKey, b.storageKey);
    assert.equal(store.read(a.storageKey, a.sha256).toString(), "TEST ONLY bytes");
    assert.throws(() => store.read("raw/sha256/aa/not-a-hash"), /invalid storage key/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a corrupted stored file is refused on read", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bdc-store-"));
  try {
    const store = createStore(dir);
    const put = store.put(Buffer.from("TEST ONLY"));
    writeFileSync(store.pathFor(put.storageKey), "tampered TEST ONLY");
    assert.throws(() => store.read(put.storageKey, put.sha256), /does not match/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the fetch log is append-only and hash-chained; request headers are not recorded", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bdc-log-"));
  try {
    const log = createFetchLog(dir);
    log.append({
      session_id: "TEST", requested_at: "2099-01-01T00:00:00.000Z",
      url: "https://www.sec.gov/files/TEST-ONLY/a", http_status: 200,
      sha256: "a".repeat(64), storage_key: "raw/sha256/aa/" + "a".repeat(64),
      source_type: "SEC_BDC_REPORT_CSV", context: { kind: "test" },
    });
    const second = createFetchLog(dir);
    second.append({
      session_id: "TEST", requested_at: "2099-01-01T00:00:01.000Z",
      url: "https://www.sec.gov/files/TEST-ONLY/b", http_status: 200,
      source_type: "SEC_BDC_REPORT_CSV",
    });
    const { entries } = readFetchLog(dir);
    assert.equal(entries.length, 2);
    assert.equal(entries[1].seq, 2);
    assert.equal(entries[1].prev_sha256.length, 64);
    const text = readFileSync(path.join(dir, "fetch-log.jsonl"), "utf8");
    assert.doesNotMatch(text, /User-Agent/i);
    assert.doesNotMatch(text, /@/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
