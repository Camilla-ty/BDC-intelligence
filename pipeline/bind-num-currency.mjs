#!/usr/bin/env node
// num:bind-currency - bind SOI monetary currency from loaded NUM facts (fail-closed).
// Offline. Never uses the network. Does not write Hosted databases.
//
//   npm run num:bind-currency [-- --db NAME]

import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DATABASE } from "./lib/config.mjs";
import { runNumCurrencyBind } from "./load/num-currency-bind.mjs";

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
  };
  try {
    await runNumCurrencyBind({ database: opt("--db") ?? DEFAULT_DATABASE });
  } catch (error) {
    console.error(`num:bind-currency stopped: ${error.message}`);
    process.exit(1);
  }
}
