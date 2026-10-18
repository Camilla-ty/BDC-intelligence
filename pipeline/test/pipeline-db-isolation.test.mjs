import assert from "node:assert/strict";
import test from "node:test";
import {
  PIPELINE_ALLOW_HOSTED_ENV,
  PIPELINE_TEST_LOCAL_ENV,
  assertLocalPipelineTarget,
  pipelineConnectionTarget,
} from "../lib/db.mjs";
import {
  assertIntegrationPipelineIsLocal,
  withSimulatedHostedPipelineEnv,
} from "./local-pipeline-db.mjs";

const SENTINEL = "postgresql://pipeline_writer:sentinel-isolation@db.example.invalid:5432/postgres";

test("inherited Hosted URL cannot redirect ordinary tests when TEST_LOCAL is set", () => {
  const previous = {
    url: process.env.PIPELINE_DATABASE_URL,
    allow: process.env[PIPELINE_ALLOW_HOSTED_ENV],
    testLocal: process.env[PIPELINE_TEST_LOCAL_ENV],
  };
  process.env.PIPELINE_DATABASE_URL = SENTINEL;
  process.env[PIPELINE_ALLOW_HOSTED_ENV] = "1";
  process.env[PIPELINE_TEST_LOCAL_ENV] = "1";
  try {
    assert.deepEqual(pipelineConnectionTarget(), { mode: "local" });
    assert.deepEqual(assertLocalPipelineTarget(), { mode: "local" });
    assert.deepEqual(assertIntegrationPipelineIsLocal(), { mode: "local" });
  } finally {
    if (previous.url === undefined) delete process.env.PIPELINE_DATABASE_URL;
    else process.env.PIPELINE_DATABASE_URL = previous.url;
    if (previous.allow === undefined) delete process.env[PIPELINE_ALLOW_HOSTED_ENV];
    else process.env[PIPELINE_ALLOW_HOSTED_ENV] = previous.allow;
    if (previous.testLocal === undefined) delete process.env[PIPELINE_TEST_LOCAL_ENV];
    else process.env[PIPELINE_TEST_LOCAL_ENV] = previous.testLocal;
  }
});

test("URL without opt-in fails closed outside TEST_LOCAL", () => {
  withSimulatedHostedPipelineEnv(SENTINEL, () => {
    delete process.env[PIPELINE_ALLOW_HOSTED_ENV];
    assert.throws(() => pipelineConnectionTarget(), /BDC_PIPELINE_ALLOW_HOSTED/);
  });
});

test("simulated Hosted env yields hosted mode for refusal-path unit tests", () => {
  withSimulatedHostedPipelineEnv(SENTINEL, () => {
    assert.deepEqual(pipelineConnectionTarget(), {
      mode: "hosted",
      connectionString: SENTINEL,
    });
  });
});
