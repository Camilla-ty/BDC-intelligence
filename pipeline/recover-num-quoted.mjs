#!/usr/bin/env node
// num:recover-quoted - one-time ADR 0021 NUM quoted-TSV recovery backfill for the pinned
// August 2026 artifact and its 23 locked lines. Offline. Never uses the network.
// Inserts a new NUM table_load; never changes stored rows. LOADED on any version skips.
//
//   npm run num:recover-quoted -- --source-table-load-id ID [--zip PATH] [--db NAME]
//
// --source-table-load-id is the id recorded by the read-only preflight. --zip is an optional
// byte-check of the stored lines against the ZIP; any disagreement stops the command.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DATABASE } from "./lib/config.mjs";
import { runNumQuotedRecoveryBackfill } from "./load/num-quoted-recovery-backfill.mjs";

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
  };
  const rawId = opt("--source-table-load-id");
  if (rawId == null || !/^[1-9][0-9]*$/.test(rawId)) {
    console.error("num:recover-quoted: --source-table-load-id ID is required (from the read-only preflight)");
    process.exit(1);
  }
  try {
    await runNumQuotedRecoveryBackfill({
      database: opt("--db") ?? DEFAULT_DATABASE,
      sourceTableLoadId: Number(rawId),
      zipPath: opt("--zip"),
    });
  } catch (error) {
    console.error(`num:recover-quoted stopped: ${error.message}`);
    process.exit(1);
  }
}
