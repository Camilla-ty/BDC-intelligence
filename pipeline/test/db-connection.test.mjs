import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  HOSTED_STATEMENT_TIMEOUT,
  PIPELINE_ALLOW_HOSTED_ENV,
  PIPELINE_TEST_LOCAL_ENV,
  appendResultLines,
  assertLocalPipelineTarget,
  assertPipelineUrl,
  copyBlock,
  copyInFromIterable,
  hostedPipelineScript,
  hostedSessionFromClient,
  pipelineConnectionTarget,
  pipelineScript,
  publicPipelineError,
  rowsToLines,
  splitPsqlScript,
} from "../lib/db.mjs";

const SECRET = "s3cret-token";
const USER = "pipeline_writer";
const HOST = "db.example";
const SENTINEL = "postgresql://pipeline_writer:sentinel@db.example.invalid:5432/postgres";

test("hosted URL requires PIPELINE_DATABASE_URL and BDC_PIPELINE_ALLOW_HOSTED", () => {
  const hosted = `postgresql://${USER}:${SECRET}@${HOST}:5432/postgres`;
  const web = `postgresql://web_login:${SECRET}@${HOST}:5432/postgres`;
  assert.deepEqual(pipelineConnectionTarget({}), { mode: "local" });
  assert.deepEqual(pipelineConnectionTarget({ PIPELINE_DATABASE_URL: "   " }), { mode: "local" });
  assert.deepEqual(pipelineConnectionTarget({ DATABASE_URL: web }), { mode: "local" });
  assert.throws(
    () => pipelineConnectionTarget({ PIPELINE_DATABASE_URL: hosted }),
    /BDC_PIPELINE_ALLOW_HOSTED/,
  );
  assert.deepEqual(
    pipelineConnectionTarget({
      PIPELINE_DATABASE_URL: `  ${hosted}  `,
      DATABASE_URL: web,
      [PIPELINE_ALLOW_HOSTED_ENV]: "1",
    }),
    { mode: "hosted", connectionString: hosted },
  );
});

test("BDC_PIPELINE_TEST_LOCAL forces local even when Hosted URL and opt-in are set", () => {
  assert.deepEqual(
    pipelineConnectionTarget({
      PIPELINE_DATABASE_URL: SENTINEL,
      [PIPELINE_ALLOW_HOSTED_ENV]: "1",
      [PIPELINE_TEST_LOCAL_ENV]: "1",
    }),
    { mode: "local" },
  );
  assert.deepEqual(
    assertLocalPipelineTarget({
      PIPELINE_DATABASE_URL: SENTINEL,
      [PIPELINE_ALLOW_HOSTED_ENV]: "1",
      [PIPELINE_TEST_LOCAL_ENV]: "1",
    }),
    { mode: "local" },
  );
});

test("assertLocalPipelineTarget refuses an active Hosted selection", () => {
  assert.throws(
    () => assertLocalPipelineTarget({
      PIPELINE_DATABASE_URL: SENTINEL,
      [PIPELINE_ALLOW_HOSTED_ENV]: "1",
    }),
    /expected local pipeline database target/,
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

test("hosted script sets a bounded session statement_timeout before SET ROLE", () => {
  assert.equal(HOSTED_STATEMENT_TIMEOUT, "60min");
  const sql = hostedPipelineScript(`SELECT 1;\n${copyBlock("_t", ["n"], [["1"]])}\nSELECT 2;`);
  assert.match(sql, /^SET statement_timeout = '60min';\nSET ROLE bdc_pipeline_writer;\nSELECT 1;/);
  const parts = splitPsqlScript(sql);
  assert.equal(parts.length, 3);
  assert.match(parts[0].text, /^SET statement_timeout = '60min';\nSET ROLE bdc_pipeline_writer;\nSELECT 1;$/);
  assert.equal(parts[1].kind, "copy");
  assert.equal(
    hostedPipelineScript("SELECT 1;", { asWriter: false }),
    "SET statement_timeout = '60min';\nSELECT 1;",
  );
});

test("local script is unchanged and carries no statement_timeout", () => {
  assert.equal(pipelineScript("SELECT 1;"), "SET ROLE bdc_pipeline_writer;\nSELECT 1;");
  assert.equal(pipelineScript("SELECT 1;", { asWriter: false }), "SELECT 1;");
  assert.equal(pipelineScript("SELECT 1;").includes("statement_timeout"), false);
  const src = readFileSync(new URL("../lib/db.mjs", import.meta.url), "utf8");
  const runScript = src.slice(src.indexOf("export function runScript"), src.indexOf("export function queryRows"));
  assert.match(runScript, /mode === "hosted"\) return runHosted\(target\.connectionString, hostedPipelineScript\(/);
  assert.match(runScript, /psql\(database, pipelineScript\(sql, \{ asWriter \}\)/);
});

test("pipeline database module changes no database, role, or server configuration", () => {
  const src = readFileSync(new URL("../lib/db.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /ALTER\s+(ROLE|USER|DATABASE|SYSTEM)/i);
  assert.doesNotMatch(src, /set_config\s*\(/i);
  assert.doesNotMatch(src, /SET\s+LOCAL\s+statement_timeout/i);
  assert.equal(src.match(/SET statement_timeout/g)?.length, 1);
});

test("a COPY block without a terminator fails closed", () => {
  assert.throws(() => splitPsqlScript("COPY _t (n) FROM STDIN;\n1\n"), /missing its terminator/);
});

test("copyInFromIterable sends CopyFail when the row iterator throws", async () => {
  const events = [];
  const connection = {
    sendCopyFromChunk(chunk) { events.push(["chunk", chunk.toString("utf8")]); },
    endCopyFrom() { events.push(["end"]); },
    sendCopyFail(message) { events.push(["fail", message]); },
  };
  async function* rows() {
    yield ["1", "ok"];
    throw new Error("row iterator failed");
  }
  const query = copyInFromIterable("COPY t (a, b) FROM STDIN;", rows());
  let callbacks = 0;
  let settled;
  const done = new Promise((resolve, reject) => {
    query.callback = (err) => {
      callbacks += 1;
      if (err) reject(err);
      else resolve();
    };
  });
  query.handleCopyInResponse(connection);
  await assert.rejects(done, /row iterator failed/);
  settled = events.slice();
  assert.equal(settled.some((event) => event[0] === "end"), false);
  assert.deepEqual(settled.filter((event) => event[0] === "fail"), [["fail", "row iterator failed"]]);
  assert.match(settled.find((event) => event[0] === "chunk")[1], /^1\tok\n$/);
  query.handleError({ message: "COPY from stdin failed" });
  query.handleReadyForQuery();
  assert.equal(callbacks, 1);
});

test("appendResultLines keeps empty, small, and multi-result order", () => {
  assert.deepEqual(appendResultLines([], { rows: [] }), []);
  assert.deepEqual(appendResultLines([], {}), []);
  assert.deepEqual(appendResultLines([], []), []);
  assert.deepEqual(appendResultLines(["keep"], { rows: [["a"], ["b", "c"]] }), ["keep", "a", "b\tc"]);
  assert.deepEqual(
    appendResultLines([], [{ rows: [["1"], ["2"]] }, { rows: [] }, { rows: [["3", "x"]] }]),
    ["1", "2", "3\tx"],
  );
  assert.deepEqual(rowsToLines({ rows: [[null], [1], [true], [{ k: "v" }]] }), ["", "1", "true", '{"k":"v"}']);
});

test("appendResultLines does not overflow at the production soi_ok_rows boundary", () => {
  const n = 181_903;
  const result = { rows: Array.from({ length: n }, (_, i) => [String(i), "2099-12-31"]) };
  const lines = [];
  appendResultLines(lines, result);
  assert.equal(lines.length, n);
  assert.equal(lines[0], "0\t2099-12-31");
  assert.equal(lines[100], "100\t2099-12-31");
  assert.equal(lines[n - 1], `${n - 1}\t2099-12-31`);
  assert.throws(
    () => {
      const exploded = [];
      exploded.push(...rowsToLines(result));
    },
    (error) => {
      assert.equal(error.name, "RangeError");
      assert.match(error.message, /Maximum call stack size exceeded/);
      return true;
    },
  );
});

test("hosted client collects SQL result rows without an argument spread", () => {
  const src = readFileSync(new URL("../lib/db.mjs", import.meta.url), "utf8");
  const hosted = src.slice(
    src.indexOf("export async function executeHostedScript"),
    src.indexOf("function runHosted"),
  );
  assert.match(hosted, /appendResultLines\(lines, result\)/);
  assert.doesNotMatch(hosted, /\.push\(\.\.\./);
  assert.doesNotMatch(hosted, /\.apply\s*\(/);
  assert.doesNotMatch(src, /lines\.push\(\.\.\.\s*rowsToLines/);
});

test("SOI date checks validate every row on the server without a client result set", () => {
  const src = readFileSync(new URL("../load/units/dataset-soi.mjs", import.meta.url), "utf8");
  assert.match(src, /PERFORM pg_temp\.strict_date\(cells\[\$\{DDATE\}\]/);
  assert.match(src, /PERFORM pg_temp\.strict_date\(r\.cells\[m\.pos\]/);
  assert.match(src, /DO \$soi_date\$ BEGIN/);
  assert.match(src, /DO \$soi_field_date\$ BEGIN/);
  assert.doesNotMatch(src, /SELECT pg_temp\.strict_date\(cells\[\$\{DDATE\}\][\s\S]*?FROM _ok;/);
  assert.doesNotMatch(src, /SELECT pg_temp\.strict_date\(r\.cells\[m\.pos\][\s\S]*?FROM _ok r JOIN _maps m/);
});

const SESSION_SECRET = "s3cret-token";
const SESSION_USER = "pipeline_writer";
const SESSION_HOST = "db.example";
const SESSION_URL = `postgresql://${SESSION_USER}:${SESSION_SECRET}@${SESSION_HOST}:5432/postgres`;

function mockSessionClient() {
  const client = new EventEmitter();
  client.ended = 0;
  client.query = async () => ({ rows: [["ok"]] });
  client.end = async () => {
    client.ended += 1;
  };
  return client;
}

function withExitGuard(fn) {
  const original = process.exit;
  let exitCode = null;
  process.exit = (code) => {
    exitCode = code;
  };
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      process.exit = original;
    })
    .then((value) => {
      assert.equal(exitCode, null, "hosted session error must not call process.exit");
      return value;
    });
}

function assertRedacted(message) {
  assert.equal(message.includes(SESSION_SECRET), false);
  assert.equal(message.includes(SESSION_USER), false);
  assert.equal(message.includes(SESSION_HOST), false);
  assert.equal(message.includes("postgresql://"), false);
  assert.equal(message.includes(SESSION_URL), false);
}

test("a Hosted session client error rejects the in-flight query without process.exit", async () => {
  await withExitGuard(async () => {
    const client = mockSessionClient();
    const logs = [];
    client.query = () => new Promise(() => {});
    const session = hostedSessionFromClient(client, SESSION_URL, { log: (line) => logs.push(line) });
    const pending = session.query("SELECT 1");
    client.emit(
      "error",
      new Error(`the database system is not accepting connections ${SESSION_URL} user ${SESSION_USER} password ${SESSION_SECRET} at ${SESSION_HOST}`),
    );
    await assert.rejects(pending, (error) => {
      assert.match(error.message, /not accepting connections/);
      assertRedacted(error.message);
      return true;
    });
    assert.equal(logs.length, 1);
    assert.match(logs[0], /^hosted pipeline session error: /);
    assertRedacted(logs[0]);
    assert.equal(client.ended, 1);
    await assert.rejects(session.query("SELECT 1"), /pipeline session is closed/);
    await session.close();
    assert.equal(client.ended, 1);
    assert.equal(logs.length, 1);
  });
});

test("a Hosted session client error rejects streaming COPY without process.exit", async () => {
  await withExitGuard(async () => {
    const client = mockSessionClient();
    const logs = [];
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    client.query = (query) => {
      if (query && typeof query.handleCopyInResponse === "function") {
        query.handleCopyInResponse({
          sendCopyFromChunk() {},
          endCopyFrom() {},
          sendCopyFail() {},
        });
      }
    };
    const session = hostedSessionFromClient(client, SESSION_URL, { log: (line) => logs.push(line) });
    async function* rows() {
      yield ["1", "ok"];
      await gate;
    }
    const pending = session.copyFrom("_tsv", ["line_number", "raw_line"], rows());
    await new Promise((resolve) => setImmediate(resolve));
    client.emit("error", new Error(`COPY failed ${SESSION_URL}`));
    try {
      await assert.rejects(pending, (error) => {
        assert.match(error.message, /COPY failed/);
        assert.match(error.message, /\[redacted-url\]/);
        assertRedacted(error.message);
        return true;
      });
    } finally {
      release();
    }
    assert.equal(logs.length, 1);
    assert.match(logs[0], /^hosted pipeline session error: /);
    assertRedacted(logs[0]);
    assert.equal(client.ended, 1);
    await assert.rejects(session.copyFrom("_tsv", ["n"], [["1"]]), /pipeline session is closed/);
  });
});

test("normal Hosted session close is not a client-error failure", async () => {
  await withExitGuard(async () => {
    const client = mockSessionClient();
    const logs = [];
    const session = hostedSessionFromClient(client, SESSION_URL, { log: (line) => logs.push(line) });
    assert.equal(await session.query("SELECT 1"), "ok");
    await session.close();
    assert.equal(client.ended, 1);
    client.emit("error", new Error(`late error ${SESSION_URL}`));
    assert.deepEqual(logs, []);
    await session.close();
    assert.equal(client.ended, 1);
    await assert.rejects(session.query("SELECT 1"), /pipeline session is closed/);
  });
});

test("Hosted session helpers do not call process.exit", () => {
  const src = readFileSync(new URL("../lib/db.mjs", import.meta.url), "utf8");
  const hosted = src.slice(
    src.indexOf("export function hostedSessionFromClient"),
    src.indexOf("async function openLocalPipelineSession"),
  );
  assert.match(hosted, /hosted pipeline session error:/);
  assert.doesNotMatch(hosted, /process\.exit/);
});
