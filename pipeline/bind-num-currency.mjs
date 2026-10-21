#!/usr/bin/env node
// num:bind-currency - bind SOI monetary currency from loaded NUM facts (fail-closed).
// Offline: never uses the network. Writes the local database named by --db unless the
// pipeline connection target is Hosted (PIPELINE_DATABASE_URL with BDC_PIPELINE_ALLOW_HOSTED=1).
// A failed run records FAILED with committed batch counts; --resume links a new run to it.
// A run left STARTED by a killed process is marked ABORTED with --abandon, which is refused
// while the run's session still holds its liveness lock. A binder that loses that lock
// cannot write another batch (ADR 0022).
//
//   npm run num:bind-currency [-- --db NAME] [-- --resume RUN_ID]
//   npm run num:bind-currency -- [--db NAME] --abandon RUN_ID --actor NAME --reason TEXT

import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DATABASE } from "./lib/config.mjs";
import { abandonNumCurrencyBind, runNumCurrencyBind } from "./load/num-currency-bind.mjs";

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
  };
  const runIdOpt = (name) => {
    const value = opt(name);
    if (!args.includes(name)) return null;
    if (!/^[1-9][0-9]*$/.test(value ?? "")) throw new Error(`${name} needs a run id`);
    return Number(value);
  };
  try {
    const database = opt("--db") ?? DEFAULT_DATABASE;
    const resume = runIdOpt("--resume");
    const abandon = runIdOpt("--abandon");
    if (abandon != null) {
      if (resume != null) throw new Error("--abandon and --resume cannot be combined");
      abandonNumCurrencyBind({ database, runId: abandon, actor: opt("--actor"), reason: opt("--reason") });
    } else {
      await runNumCurrencyBind({ database, resumeRunId: resume });
    }
  } catch (error) {
    console.error(`num:bind-currency stopped: ${error.message}`);
    process.exit(1);
  }
}
