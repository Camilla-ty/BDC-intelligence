import test from "node:test";
import assert from "node:assert/strict";
import { createSecClient, FairAccessStop, isAllowedUrl, requireUserAgent } from "../lib/http.mjs";

test("refuses to run without a User-Agent that includes a contact email", () => {
  assert.throws(() => requireUserAgent({}), /SEC_USER_AGENT/);
  assert.throws(() => requireUserAgent({ SEC_USER_AGENT: "not-an-email" }), /SEC_USER_AGENT/);
});

test("requireUserAgent never returns a value that is logged by the client errors", () => {
  const ua = requireUserAgent({ SEC_USER_AGENT: "TEST PROJECT test@example.test" });
  assert.match(ua, /test@example\.test/);
});

test("only https URLs on allowed SEC hosts are accepted", () => {
  assert.equal(isAllowedUrl("https://www.sec.gov/files/x"), true);
  assert.equal(isAllowedUrl("https://data.sec.gov/submissions/CIK0000000000.json"), true);
  assert.equal(isAllowedUrl("http://www.sec.gov/files/x"), false);
  assert.equal(isAllowedUrl("https://example.com/"), false);
});

test("enforces spacing between requests using the supplied clock", async () => {
  const sleeps = [];
  let now = 1_000_000;
  const fetchImpl = async () => ({
    status: 200, url: "https://www.sec.gov/files/TEST-ONLY", headers: new Headers(),
    arrayBuffer: async () => new ArrayBuffer(0),
  });
  const client = createSecClient({
    userAgent: "TEST PROJECT test@example.test",
    fetchImpl,
    sleep: async (ms) => { sleeps.push(ms); now += ms; },
    now: () => now,
    minIntervalMs: 1100,
    maxRetries: 0,
  });
  await client.get("https://www.sec.gov/files/TEST-ONLY/a");
  now += 100;
  await client.get("https://www.sec.gov/files/TEST-ONLY/b");
  assert.equal(sleeps.length, 1);
  assert.equal(sleeps[0], 1000);
});

test("stops on HTTP 403 without saving, and on 429", async () => {
  const client = createSecClient({
    userAgent: "TEST PROJECT test@example.test",
    fetchImpl: async () => ({ status: 403, url: "https://www.sec.gov/files/TEST-ONLY", headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) }),
    sleep: async () => {},
    maxRetries: 0,
  });
  await assert.rejects(() => client.get("https://www.sec.gov/files/TEST-ONLY"), (e) => e instanceof FairAccessStop && e.status === 403);
});

test("retries 5xx a bounded number of times then fails", async () => {
  let attempts = 0;
  const client = createSecClient({
    userAgent: "TEST PROJECT test@example.test",
    fetchImpl: async () => {
      attempts += 1;
      return { status: 503, url: "https://www.sec.gov/files/TEST-ONLY", headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) };
    },
    sleep: async () => {},
    maxRetries: 3,
    backoffMs: [0, 0, 0],
  });
  await assert.rejects(() => client.get("https://www.sec.gov/files/TEST-ONLY"), /HTTP 503/);
  assert.equal(attempts, 4);
});

test("returns 404 to the caller", async () => {
  const client = createSecClient({
    userAgent: "TEST PROJECT test@example.test",
    fetchImpl: async () => ({ status: 404, url: "https://data.sec.gov/submissions/CIK9999999901.json", headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) }),
    sleep: async () => {},
    maxRetries: 0,
  });
  const r = await client.get("https://data.sec.gov/submissions/CIK9999999901.json");
  assert.equal(r.status, 404);
});

test("refuses a redirect off allowed hosts", async () => {
  const client = createSecClient({
    userAgent: "TEST PROJECT test@example.test",
    fetchImpl: async () => ({ status: 200, url: "https://example.com/x", headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) }),
    sleep: async () => {},
    maxRetries: 0,
  });
  await assert.rejects(() => client.get("https://www.sec.gov/files/TEST-ONLY"), /redirected/);
});

test("error messages do not include the User-Agent value", async () => {
  const ua = "SECRET-AGENT secret@example.test";
  const client = createSecClient({
    userAgent: ua,
    fetchImpl: async () => { throw new Error("network down"); },
    sleep: async () => {},
    maxRetries: 0,
  });
  await assert.rejects(() => client.get("https://www.sec.gov/files/TEST-ONLY"), (e) => !String(e.message).includes(ua) && !String(e.stack).includes(ua));
});
