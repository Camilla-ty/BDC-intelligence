import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { VERIFIED_NUM_HEADER } from "../lib/num-schema.mjs";
import { collectNumTsv, parseNumTsv } from "../parse/num.mjs";
import { listMembers, readMember, streamMemberChunks } from "../parse/zip.mjs";
import { numFactRow, numTsv } from "./synthetic.mjs";
import { buildStoredZip } from "./zip-store.mjs";

async function collectChunks(zipPath, member) {
  const parts = [];
  for await (const chunk of streamMemberChunks(zipPath, member)) parts.push(chunk);
  return Buffer.concat(parts);
}

function withZip(members, fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "bdc-zip-stream-"));
  const zipPath = path.join(dir, "test-only.zip");
  writeFileSync(zipPath, buildStoredZip(members));
  return fn(zipPath).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test("streamMemberChunks returns the same bytes as readMember", async () => {
  const body = numTsv([numFactRow({ tag: "InvestmentOwnedBalancePrincipalAmount", value: "100" })]);
  await withZip({ "datasets/num.tsv": body, "readme.htm": "<html>TEST ONLY</html>" }, async (zipPath) => {
    const streamed = await collectChunks(zipPath, "datasets/num.tsv");
    const buffered = readMember(zipPath, "datasets/num.tsv");
    assert.equal(Buffer.isBuffer(buffered), true);
    assert.equal(Buffer.compare(streamed, buffered), 0);
    assert.deepEqual(listMembers(zipPath), ["datasets/num.tsv", "readme.htm"]);
  });
});

test("a synthetic member larger than maxBuffer fails readMember and streams completely", async () => {
  const header = `${VERIFIED_NUM_HEADER.join("\t")}\n`;
  const row = `${numTsv([numFactRow({ tag: "InvestmentOwnedAtCost", value: "1" })]).split("\n")[1]}\n`;
  const repeats = 4000;
  const body = Buffer.concat([Buffer.from(header, "utf8"), ...Array.from({ length: repeats }, () => Buffer.from(row, "utf8"))]);
  assert.ok(body.length > 8 * 1024);
  await withZip({ "datasets/num.tsv": body }, async (zipPath) => {
    assert.throws(
      () => readMember(zipPath, "datasets/num.tsv", { maxBuffer: 1024 }),
      /ENOBUFS|unzip failed/,
    );
    const streamed = await collectChunks(zipPath, "datasets/num.tsv");
    assert.equal(Buffer.compare(streamed, body), 0);
    assert.deepEqual(parseNumTsv(body), await collectNumTsv((async function* () {
      for await (const chunk of streamMemberChunks(zipPath, "datasets/num.tsv")) yield chunk;
    })()));
    assert.equal(parseNumTsv(body).rows.length, repeats);
  });
});

test("a missing member or a missing archive is a failure, not an empty success", async () => {
  await withZip({ "readme.htm": "<html>TEST ONLY</html>" }, async (zipPath) => {
    await assert.rejects(collectChunks(zipPath, "datasets/num.tsv"), /unzip failed/);
  });
  assert.throws(() => listMembers(path.join(tmpdir(), "bdc-missing-test-only.zip")), /unzip failed/);
});

function largeNumMember(minBytes) {
  const header = `${VERIFIED_NUM_HEADER.join("\t")}\n`;
  const row = `${numTsv([numFactRow({ tag: "InvestmentOwnedAtCost", value: "1" })]).split("\n")[1]}\n`;
  const rowBuf = Buffer.from(row, "utf8");
  const parts = [Buffer.from(header, "utf8")];
  let n = parts[0].length;
  while (n < minBytes) {
    parts.push(rowBuf);
    n += rowBuf.length;
  }
  return Buffer.concat(parts);
}

function childAlive(child) {
  return child.exitCode === null && child.signalCode === null;
}

async function waitUntil(predicate, label, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${label}`);
}

test("return() after the first chunk kills the unzip child", async () => {
  const body = largeNumMember(2 * 1024 * 1024);
  await withZip({ "datasets/num.tsv": body }, async (zipPath) => {
    let child;
    const gen = streamMemberChunks(zipPath, "datasets/num.tsv", { onSpawn: (spawned) => { child = spawned; } });
    const first = await gen.next();
    assert.equal(first.done, false);
    assert.ok(Buffer.isBuffer(first.value));
    assert.ok(child?.pid);
    assert.equal(childAlive(child), true);
    const done = await gen.return();
    assert.equal(done.done, true);
    await waitUntil(() => !childAlive(child), "unzip to exit after return()");
    assert.throws(() => process.kill(child.pid, 0), { code: "ESRCH" });
  });
});

test("a mid-stream consumer throw kills the unzip child", async () => {
  const body = largeNumMember(2 * 1024 * 1024);
  await withZip({ "datasets/num.tsv": body }, async (zipPath) => {
    let child;
    await assert.rejects(async () => {
      for await (const chunk of streamMemberChunks(zipPath, "datasets/num.tsv", {
        onSpawn: (spawned) => { child = spawned; },
      })) {
        assert.ok(Buffer.isBuffer(chunk));
        throw new Error("downstream COPY failed");
      }
    }, /downstream COPY failed/);
    await waitUntil(() => child && !childAlive(child), "unzip to exit after consumer throw");
    assert.throws(() => process.kill(child.pid, 0), { code: "ESRCH" });
  });
});
