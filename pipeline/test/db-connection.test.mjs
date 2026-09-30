import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertPipelineUrl,
  copyBlock,
  pipelineConnectionTarget,
  pipelineScript,
  publicPipelineError,
  splitPsqlScript,
} from "../lib/db.mjs";

const SECRET = "s3cret-token";
const USER = "pipeline_writer";
const HOST = "db.example";

test("hosted URL is selected only from PIPELINE_DATABASE_URL", () => {
  const hosted = `postgresql://${USER}:${SECRET}@${HOST}:5432/postgres`;
  const web = `postgresql://web_login:${SECRET}@${HOST}:5432/postgres`;
  assert.deepEqual(pipelineConnectionTarget({}), { mode: "local" });
  assert.deepEqual(pipelineConnectionTarget({ PIPELINE_DATABASE_URL: "   " }), { mode: "local" });
  assert.deepEqual(pipelineConnectionTarget({ DATABASE_URL: web }), { mode: "local" });
  assert.deepEqual(
    pipelineConnectionTarget({ PIPELINE_DATABASE_URL: `  ${hosted}  `, DATABASE_URL: web }),
    { mode: "hosted", connectionString: hosted },
  );
});

test("pipeline database module does not read the web URL", () => {
  const src = readFileSync(new URL("../lib/db.mjs", import.meta.url), "utf8");
  assert.equal(src.replaceAll("PIPELINE_DATABASE_URL", "").includes("DATABASE_URL"), false);
});

test("hosted URL check refuses the transaction pooler without printing the URL", () => {
  const url = `postgresql://${USER}:${SECRET}@${HOST}:6543/postgres`;
  assert.throws(() => assertPipelineUrl(url), (error) => {
    assert.match(error.message, /port 6543/);
    assert.equal(error.message.includes(SECRET), false);
    assert.equal(error.message.includes(USER), false);
    assert.equal(error.message.includes(HOST), false);
    assert.equal(error.message.includes("postgresql://"), false);
    return true;
  });
  assert.doesNotThrow(() => assertPipelineUrl(`postgresql://${USER}:${SECRET}@${HOST}:5432/postgres`));
  assert.throws(() => assertPipelineUrl(""), /PIPELINE_DATABASE_URL is not set/);
  assert.throws(() => assertPipelineUrl("not a url"), (error) => {
    assert.match(error.message, /not a valid URL/);
    assert.equal(error.message.includes("not a url"), false);
    return true;
  });
});

test("hosted errors redact the URL, password, user, and host", () => {
  const url = `postgresql://${USER}:${SECRET}@${HOST}:5432/postgres`;
  const message = publicPipelineError(
    new Error(`connect ${url} failed for user ${USER} password ${SECRET} at ${HOST}`),
    url,
  );
  assert.match(message, /\[redacted-url\]/);
  assert.match(message, /\[redacted-user\]/);
  assert.match(message, /\[redacted\]/);
  assert.match(message, /\[redacted-host\]/);
  assert.equal(message.includes(SECRET), false);
  assert.equal(message.includes(USER), false);
  assert.equal(message.includes(HOST), false);
  assert.equal(message.includes("postgresql://"), false);
});

test("hosted script keeps SET ROLE and the same COPY payload", () => {
  const sql = pipelineScript(`SELECT 1;\n${copyBlock("_t", ["raw_line"], [["line\nwith\tstuff\\x"]])}\nSELECT 2;`);
  assert.match(sql, /^SET ROLE bdc_pipeline_writer;\n/);
  const parts = splitPsqlScript(sql);
  assert.equal(parts.length, 3);
  assert.equal(parts[0].kind, "sql");
  assert.match(parts[0].text, /^SET ROLE bdc_pipeline_writer;\nSELECT 1;/);
  assert.deepEqual(parts[1], {
    kind: "copy",
    text: "COPY _t (raw_line) FROM STDIN;",
    payload: "line\\nwith\\tstuff\\\\x\n",
  });
  assert.equal(parts[2].kind, "sql");
  assert.equal(parts[2].text, "SELECT 2;");
  assert.equal(pipelineScript("SELECT 1;", { asWriter: false }), "SELECT 1;");
});

test("a COPY block without a terminator fails closed", () => {
  assert.throws(() => splitPsqlScript("COPY _t (n) FROM STDIN;\n1\n"), /missing its terminator/);
});
