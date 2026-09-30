#!/usr/bin/env node
// Fails if any local-only file is tracked by git (staged or committed). These files must
// never reach the public repository.

import { execFileSync } from "node:child_process";

const LOCAL_ONLY_PATHS = ["reference", "docs/IMPLEMENTATION_PLAN.md"];

let tracked;
try {
  tracked = execFileSync("git", ["ls-files", "--", ...LOCAL_ONLY_PATHS], {
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
} catch (error) {
  console.error("verify:no-reference-tracked failed: could not run `git ls-files`");
  console.error(error.message);
  process.exit(1);
}

if (tracked.length > 0) {
  console.error("verify:no-reference-tracked failed: local-only files are tracked by git:");
  for (const file of tracked) console.error(`  ${file}`);
  console.error("Remove them from the index with `git rm --cached <path>`.");
  process.exit(1);
}

console.log(
  `verify:no-reference-tracked passed: none of [${LOCAL_ONLY_PATHS.join(", ")}] are tracked`,
);
