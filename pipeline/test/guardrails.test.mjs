import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { REPO_ROOT } from "../lib/config.mjs";

const MARKERS = /TEST BDC|TEST-ONLY|TEST ONLY|999999990|2099/;

function walk(dir, files = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, files);
    else files.push(p);
  }
  return files;
}

test("every committed synthetic fixture is obviously fake", () => {
  const dir = path.join(REPO_ROOT, "fixtures/pipeline/synthetic");
  const files = walk(dir);
  assert.ok(files.length >= 4, "expected committed synthetic fixtures");
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    assert.match(text, MARKERS, `${path.relative(REPO_ROOT, file)} has no fake marker`);
    assert.doesNotMatch(text, /Ares Capital|Blackstone|Owl Rock/i);
  }
});

test("pipeline code never takes a registrant CIK from an accession-number prefix", () => {
  const dir = path.join(REPO_ROOT, "pipeline");
  const files = walk(dir).filter((f) => f.endsWith(".mjs") && !f.includes(`${path.sep}test${path.sep}`));
  const forbidden = [
    /accession(?:Number|_number)?\.slice\(\s*0\s*,\s*10\s*\)/,
    /adsh\.slice\(\s*0\s*,\s*10\s*\)/,
    /split\(\s*['"]-['"]\s*\)\[0\].{0,40}cik/i,
  ];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const re of forbidden) {
      assert.equal(re.test(text), false, `${path.relative(REPO_ROOT, file)} matches ${re}`);
    }
  }
});
