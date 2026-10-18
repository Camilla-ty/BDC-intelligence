// Shared guards for disposable local integration databases.
// Call assertIntegrationPipelineIsLocal() before migrate/create/queryRows work.

import {
  PIPELINE_ALLOW_HOSTED_ENV,
  PIPELINE_TEST_LOCAL_ENV,
  assertLocalPipelineTarget,
  envFlagEnabled,
  pipelineConnectionTarget,
} from "../lib/db.mjs";

/**
 * Ensure the resolved pipeline target is local before integration DB operations.
 * Verifies pipelineConnectionTarget(), not merely whether PIPELINE_DATABASE_URL is unset.
 * Safe if the file is launched without force-local-pipeline preload.
 */
export function assertIntegrationPipelineIsLocal() {
  process.env[PIPELINE_TEST_LOCAL_ENV] = "1";
  delete process.env[PIPELINE_ALLOW_HOSTED_ENV];
  const target = assertLocalPipelineTarget();
  if (target.mode !== "local") {
    throw new Error("integration tests require a local pipeline database target");
  }
  // Inherited Hosted URL must not change the resolved mode under TEST_LOCAL.
  if (String(process.env.PIPELINE_DATABASE_URL ?? "").trim() !== "") {
    const again = pipelineConnectionTarget();
    if (again.mode !== "local") {
      throw new Error("inherited PIPELINE_DATABASE_URL selected Hosted despite BDC_PIPELINE_TEST_LOCAL");
    }
  }
  return target;
}

/**
 * Temporarily enable Hosted target selection for unit tests that assert refusal paths.
 * Does not open a connection. Restores prior env flags afterward.
 */
export function withSimulatedHostedPipelineEnv(connectionString, fn) {
  const previous = {
    url: process.env.PIPELINE_DATABASE_URL,
    allow: process.env[PIPELINE_ALLOW_HOSTED_ENV],
    testLocal: process.env[PIPELINE_TEST_LOCAL_ENV],
  };
  delete process.env[PIPELINE_TEST_LOCAL_ENV];
  process.env[PIPELINE_ALLOW_HOSTED_ENV] = "1";
  process.env.PIPELINE_DATABASE_URL = connectionString;
  try {
    return fn();
  } finally {
    if (previous.url === undefined) delete process.env.PIPELINE_DATABASE_URL;
    else process.env.PIPELINE_DATABASE_URL = previous.url;
    if (previous.allow === undefined) delete process.env[PIPELINE_ALLOW_HOSTED_ENV];
    else process.env[PIPELINE_ALLOW_HOSTED_ENV] = previous.allow;
    if (previous.testLocal === undefined) delete process.env[PIPELINE_TEST_LOCAL_ENV];
    else process.env[PIPELINE_TEST_LOCAL_ENV] = previous.testLocal;
  }
}

export function hostedOptInEnabled(env = process.env) {
  return envFlagEnabled(env, PIPELINE_ALLOW_HOSTED_ENV);
}
