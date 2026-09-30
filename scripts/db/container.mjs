#!/usr/bin/env node
// Starts or stops the disposable local PostgreSQL container used for schema work.
//   node scripts/db/container.mjs up | down | status
// Local development and tests only; never a production database.

import { CONTAINER, DEFAULT_CONTAINER, IMAGE, containerRunning, dockerAvailable, startContainer, stopContainer } from "./pg.mjs";

const action = process.argv[2];

try {
  if (!["up", "down", "status"].includes(action)) throw new Error("usage: container.mjs up | down | status");
  if (!dockerAvailable()) throw new Error("Docker is not available. Start Docker Desktop (or another Docker engine) first.");
  if (CONTAINER !== DEFAULT_CONTAINER && action !== "status") {
    throw new Error(`BDC_DB_CONTAINER points at ${CONTAINER}; it is managed externally (for example by CI).`);
  }

  if (action === "up") {
    const started = startContainer();
    console.log(started ? `db:up: started ${DEFAULT_CONTAINER} (${IMAGE}, no published ports)` : `db:up: ${DEFAULT_CONTAINER} is already running`);
  } else if (action === "down") {
    const stopped = stopContainer();
    console.log(stopped ? `db:down: stopped and removed ${DEFAULT_CONTAINER}` : `db:down: ${DEFAULT_CONTAINER} is not running`);
  } else {
    console.log(`${CONTAINER}: ${containerRunning() ? "running" : "not running"}`);
  }
} catch (error) {
  console.error(`db:${action ?? "container"} failed: ${error.message}`);
  process.exit(1);
}
