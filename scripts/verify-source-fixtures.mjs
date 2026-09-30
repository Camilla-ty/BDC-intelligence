#!/usr/bin/env node
// Local check of the SEC fixture cache: recomputes SHA-256 values in .cache/sec/ against
// fixtures/sec/manifest.json, then scans public (non-ignored) files for registrant and holding
// names taken from the cached SEC files and for the SEC_USER_AGENT value. Matches are reported by
// file and line only; the matched text is never printed. Skips when the cache is absent.
// Node built-ins plus the system `unzip` and `git`. --strict fails on uncached fixtures.

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = ".cache/sec";
const strict = process.argv.includes("--strict");

if (!existsSync(path.join(repoRoot, CACHE_DIR))) {
  console.log(`verify:source-fixtures skipped: ${CACHE_DIR}/ not present (run npm run sec:fetch locally)`);
  process.exit(0);
}

const manifest = JSON.parse(readFileSync(path.join(repoRoot, "fixtures/sec/manifest.json"), "utf8"));
const errors = [];
const cachePath = (f) => path.join(repoRoot, f.cache_path);

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("data", (d) => hash.update(d))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });
}

// 1. Checksums
let verified = 0;
let uncached = 0;
for (const f of manifest.fixtures) {
  if (!existsSync(cachePath(f))) {
    uncached += 1;
    if (strict) errors.push(`${f.id}: not cached at ${f.cache_path}`);
    continue;
  }
  const actual = await sha256File(cachePath(f));
  if (actual !== f.retrieval?.sha256) errors.push(`${f.id}: cached file checksum does not match the manifest`);
  else verified += 1;
}

// 2. Sensitive strings from the cache. Strings made only of standard-taxonomy words (for example
// "Cash and Cash Equivalents") are generic labels, not names, and are skipped.
const NAME_MIN_LENGTH = 10;
const sensitive = new Set();
const taxonomyWords = new Set();
const normalize = (s) => s.replace(/\s+/g, " ").trim();
const wordsOf = (s) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const isGeneric = (s) => wordsOf(s).every((w) => taxonomyWords.has(w) || /^\d+$/.test(w));
const pendingNames = [];
function addName(value) {
  const v = normalize(value ?? "");
  if (v.length >= NAME_MIN_LENGTH && /[A-Za-z]/.test(v)) pendingNames.push(v);
}

function streamLines(zip, member, onLine) {
  return new Promise((resolve, reject) => {
    const child = spawn("unzip", ["-p", zip, member]);
    const decoder = new StringDecoder("utf8");
    let rest = "";
    child.stdout.on("data", (d) => {
      const parts = (rest + decoder.write(d)).split("\n");
      rest = parts.pop();
      for (const part of parts) onLine(part);
    });
    child.on("error", reject);
    child.on("close", () => {
      rest += decoder.end();
      if (rest) onLine(rest);
      resolve();
    });
  });
}

const SOI_NAME_COLUMNS = ["name", "Investment, Identifier Axis", "Investment, Issuer Name Axis", "Legal Entity Axis"];
for (const f of manifest.fixtures) {
  if (!existsSync(cachePath(f))) continue;
  if (f.source_type === "bdc_dataset_zip") {
    let tagCols = null;
    await streamLines(cachePath(f), "datasets/tag.tsv", (line) => {
      const cells = line.split("\t");
      if (!tagCols) {
        tagCols = { tag: cells.indexOf("tag"), custom: cells.indexOf("custom"), tlabel: cells.indexOf("tlabel") };
        return;
      }
      if (cells[tagCols.custom] !== "0") return;
      for (const w of wordsOf(cells[tagCols.tlabel] ?? "")) taxonomyWords.add(w);
      taxonomyWords.add((cells[tagCols.tag] ?? "").toLowerCase());
    });
    for (const member of ["soi.tsv", "datasets/sub.tsv", "datasets/non.tsv"]) {
      let cols = null;
      await streamLines(cachePath(f), member, (line) => {
        const cells = line.split("\t");
        if (!cols) {
          cols = SOI_NAME_COLUMNS.map((c) => cells.indexOf(c)).filter((i) => i >= 0);
          return;
        }
        for (const i of cols) {
          const v = cells[i] ?? "";
          addName(v);
          for (const part of v.split("|")) addName(part);
        }
      });
    }
  } else if (f.source_type === "bdc_report_csv") {
    const lines = readFileSync(cachePath(f), "utf8").split(/\r?\n/);
    for (const line of lines.slice(1)) {
      const m = line.match(/^(?:"[^"]*"|[^,]*),(?:"[^"]*"|[^,]*),("([^"]*)"|[^,]*)/);
      if (m) addName(m[2] ?? m[1]);
    }
  }
}

let genericSkipped = 0;
for (const v of pendingNames) {
  if (isGeneric(v)) genericSkipped += 1;
  else sensitive.add(v);
}

const userAgent = process.env.SEC_USER_AGENT?.trim();
const secrets = [];
if (userAgent) {
  secrets.push(userAgent);
  const email = userAgent.match(/\S+@\S+/)?.[0];
  if (email) secrets.push(email);
}

// 3. Scan public files: tracked plus untracked-but-not-ignored
let publicFiles;
try {
  publicFiles = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
} catch {
  console.error("verify:source-fixtures failed: git is required to list public files");
  process.exit(1);
}

let maxWords = 1;
for (const s of sensitive) maxWords = Math.max(maxWords, s.split(" ").length);
let scanned = 0;
const leaks = [];
for (const rel of publicFiles) {
  const abs = path.join(repoRoot, rel);
  if (!existsSync(abs)) continue;
  const buf = readFileSync(abs);
  if (buf.includes(0)) continue;
  scanned += 1;
  const lines = buf.toString("utf8").split(/\r?\n/);
  lines.forEach((line, idx) => {
    for (const s of secrets) {
      if (line.includes(s)) leaks.push(`${rel}:${idx + 1}: contains the SEC_USER_AGENT value`);
    }
    // Compare every run of whole words (split on spaces and common separators) with the name set.
    for (const segment of line.split(/[|"`\t]|\\n/)) {
      const words = normalize(segment).split(" ").filter(Boolean);
      for (let i = 0; i < words.length; i += 1) {
        let candidate = "";
        for (let n = 1; n <= maxWords && i + n <= words.length; n += 1) {
          candidate = n === 1 ? words[i] : `${candidate} ${words[i + n - 1]}`;
          const trimmed = candidate.replace(/^[(\[{'",;:]+|[)\]}'",;:.]+$/g, "");
          if (trimmed.length >= NAME_MIN_LENGTH && sensitive.has(trimmed)) {
            leaks.push(`${rel}:${idx + 1}: contains a name found in the cached SEC data`);
          }
        }
      }
    }
  });
}

for (const leak of [...new Set(leaks)]) errors.push(leak);

if (errors.length > 0) {
  console.error("verify:source-fixtures failed:");
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(
  `verify:source-fixtures passed: ${verified} checksum(s) verified, ${uncached} uncached, ${sensitive.size} cached name string(s) checked against ${scanned} public file(s) (${genericSkipped} generic taxonomy-word string(s) skipped), User-Agent scan ${userAgent ? "on" : "off (SEC_USER_AGENT not set)"}`,
);
