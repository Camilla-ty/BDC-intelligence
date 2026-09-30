#!/usr/bin/env node
// Verifies that local-only reference files are unchanged. Read-only: never writes to the
// reference directory. The directory is gitignored, so on CI or a fresh clone it is absent
// and the check is skipped rather than failed.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const referenceDir = resolve(repoRoot, process.env.REFERENCE_DIR ?? "reference");
const manifestPath = join(scriptDir, "reference.sha256");

if (!existsSync(referenceDir)) {
  console.log(`verify:reference skipped: reference files not present (${referenceDir})`);
  process.exit(0);
}

const expected = readFileSync(manifestPath, "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const match = line.match(/^([a-f0-9]{64})\s+(.+)$/);
    if (!match) throw new Error(`Malformed line in ${manifestPath}: ${line}`);
    return { hash: match[1], file: match[2] };
  });

let failures = 0;
for (const { hash, file } of expected) {
  const filePath = join(referenceDir, file);
  if (!existsSync(filePath)) {
    console.error(`MISSING   ${file}`);
    failures++;
    continue;
  }
  const actual = createHash("sha256").update(readFileSync(filePath)).digest("hex");
  if (actual === hash) {
    console.log(`OK        ${file}`);
  } else {
    console.error(`CHANGED   ${file}\n  expected ${hash}\n  actual   ${actual}`);
    failures++;
  }
}

if (failures > 0) {
  console.error(`verify:reference failed: ${failures} file(s) missing or changed`);
  process.exit(1);
}
console.log(`verify:reference passed: ${expected.length} file(s) unchanged`);
