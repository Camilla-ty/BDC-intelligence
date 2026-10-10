import test from "node:test";
import assert from "node:assert/strict";
import {
  assertResolutionDatabase,
  resolveUniqueDateEligibleInstruments,
} from "../resolve-eligible-instruments.mjs";

const HOSTED = "postgres://example.invalid/bdc";

function withHostedUrl(fn) {
  const previous = process.env.PIPELINE_DATABASE_URL;
  process.env.PIPELINE_DATABASE_URL = HOSTED;
  try {
    fn();
  } finally {
    if (previous == null) delete process.env.PIPELINE_DATABASE_URL;
    else process.env.PIPELINE_DATABASE_URL = previous;
  }
}

function withLocalTarget(fn) {
  const previous = process.env.PIPELINE_DATABASE_URL;
  delete process.env.PIPELINE_DATABASE_URL;
  try {
    fn();
  } finally {
    if (previous != null) process.env.PIPELINE_DATABASE_URL = previous;
  }
}

test("unique-date resolution refuses a hosted database", () => {
  withHostedUrl(() => {
    assert.throws(
      () => resolveUniqueDateEligibleInstruments({ database: "bdc_local", dryRun: true, log() {} }),
      /refuses a hosted database/,
    );
  });
});

test("unique-date resolution refuses a database other than the local database", () => {
  withLocalTarget(() => {
    assert.throws(
      () => resolveUniqueDateEligibleInstruments({ database: "other_db", dryRun: true, log() {} }),
      /refuses a database other than the local database/,
    );
    assert.throws(
      () => assertResolutionDatabase("other_db"),
      /refuses a database other than the local database/,
    );
  });
});

test("unique-date resolution may use a non-default local database only when opted in", () => {
  withLocalTarget(() => {
    assert.doesNotThrow(() => assertResolutionDatabase("bdc_unique_test", { allowNonDefaultLocalDatabase: true }));
    assert.throws(
      () => assertResolutionDatabase("bdc_unique_test"),
      /refuses a database other than the local database/,
    );
  });
});

test("unique-date non-default local opt-in does not bypass the hosted refuse", () => {
  withHostedUrl(() => {
    assert.throws(
      () => assertResolutionDatabase("bdc_local", { allowNonDefaultLocalDatabase: true }),
      /refuses a hosted database/,
    );
  });
});
