import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { factBelongsToContext, listIxContextRows, parseIxContextRow } from "../normalize/ix-context-row.mjs";

const STORED_HTML = "/tmp/cswc-20260630.htm";
const STORED_SHA256 = "26eb385fb0c5a5211b7cadb4fe857f1d68698fc1574d684b056b9a888edae05a";
const CONTEXT = "c-1596";
const FACTS = ["f-6023", "f-6024", "f-6025", "f-6026", "f-6027", "f-6028"];

const SYNTHETIC = `<table>
<tr><td><ix:nonFraction contextRef="c-a" id="f-1" name="example:One">1</ix:nonFraction>
<span>1/2/2099</span></td></tr>
<tr><td><ix:nonFraction contextRef="c-b" id="f-9" name="example:Other">9</ix:nonFraction>
<span>3/4/2099</span></td></tr>
</table>`;

test("a context row keeps its own facts and untagged date", () => {
  const parsed = parseIxContextRow(SYNTHETIC, "c-a");
  assert.equal(parsed.rowCount, 1);
  assert.deepEqual(parsed.facts.map((fact) => fact.id), ["f-1"]);
  assert.deepEqual(parsed.untaggedDates, ["1/2/2099"]);
  assert.deepEqual(parsed.taggedDates, []);
  assert.equal(factBelongsToContext(SYNTHETIC, "f-1", "c-a"), true);
  assert.equal(factBelongsToContext(SYNTHETIC, "f-9", "c-a"), false);
  assert.equal(factBelongsToContext(SYNTHETIC, "f-1", "c-b"), false);
});

test("listed rows keep the fact format and each context's period end", () => {
  const html = `<ix:header><ix:resources>
<xbrli:context id="c-i"><xbrli:entity></xbrli:entity><xbrli:period><xbrli:instant>2099-03-31</xbrli:instant></xbrli:period></xbrli:context>
<xbrli:context id="c-d"><xbrli:entity></xbrli:entity><xbrli:period><xbrli:startDate>2099-01-01</xbrli:startDate><xbrli:endDate>2099-06-30</xbrli:endDate></xbrli:period></xbrli:context>
<xbrli:context id="c-twice"><xbrli:period><xbrli:instant>2099-03-31</xbrli:instant></xbrli:period></xbrli:context>
<xbrli:context id="c-twice"><xbrli:period><xbrli:instant>2099-06-30</xbrli:instant></xbrli:period></xbrli:context>
<xbrli:context id="c-time"><xbrli:period><xbrli:instant>2099-03-31T00:00:00</xbrli:instant></xbrli:period></xbrli:context>
</ix:resources></ix:header><table>
<tr><td><ix:nonFraction contextRef="c-i" id="f-1" name="example:One" format="ixt:fixed-zero">&#8212;</ix:nonFraction></td></tr>
<tr><td><ix:nonFraction contextRef="c-d" id="f-2" name="example:Two" format="ixt:num-dot-decimal">2</ix:nonFraction></td></tr>
<tr><td><ix:nonFraction contextRef="c-twice" id="f-3" name="example:Three">3</ix:nonFraction></td></tr>
<tr><td><ix:nonFraction contextRef="c-time" id="f-4" name="example:Four">4</ix:nonFraction></td></tr>
<tr><td><ix:nonFraction contextRef="c-none" id="f-5" name="example:Five">5</ix:nonFraction></td></tr>
</table>`;
  const rows = listIxContextRows(html);
  assert.deepEqual(rows.map((row) => row.contextPeriodEnds), [["2099-03-31"], ["2099-06-30"], [null], [null], [null]]);
  assert.deepEqual(rows.map((row) => row.facts[0].format), ["ixt:fixed-zero", "ixt:num-dot-decimal", null, null, null]);
  assert.equal(rows[0].facts[0].text, "\u2014");
});

test("stored filing HTML locates c-1596, its six facts, and the untagged maturity text", (t) => {
  if (!existsSync(STORED_HTML)) {
    t.skip(`${STORED_HTML} is not present`);
    return;
  }
  const bytes = readFileSync(STORED_HTML);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  assert.equal(sha256, STORED_SHA256);
  const html = bytes.toString("utf8");

  const parsed = parseIxContextRow(html, CONTEXT);
  assert.equal(parsed.rowCount, 1);
  assert.deepEqual(parsed.facts.map((fact) => fact.id), FACTS);
  assert.deepEqual(parsed.facts.map((fact) => fact.contextRef), FACTS.map(() => CONTEXT));
  assert.deepEqual(parsed.untaggedDates, ["2/4/2030"]);
  assert.equal(parsed.taggedDates.includes("2/4/2030"), false);
  for (const factId of FACTS) {
    assert.equal(factBelongsToContext(html, factId, CONTEXT), true);
    assert.equal(parsed.facts.find((fact) => fact.id === factId).text.includes("2/4/2030"), false);
  }

  const otherContext = parseIxContextRow(html, "c-80");
  assert.equal(otherContext.rowCount, 1);
  assert.deepEqual(otherContext.facts.map((fact) => fact.id), ["f-507", "f-508", "f-509", "f-510", "f-511", "f-512"]);
  assert.equal(otherContext.facts.some((fact) => FACTS.includes(fact.id)), false);
  assert.equal(factBelongsToContext(html, "f-507", CONTEXT), false);
  assert.equal(factBelongsToContext(html, "f-6023", "c-80"), false);

  const subtotal = parseIxContextRow(html, "c-1597");
  assert.equal(subtotal.rowCount, 1);
  assert.deepEqual(subtotal.facts.map((fact) => fact.id), ["f-6029", "f-6030", "f-6031"]);
  assert.equal(subtotal.untaggedDates.includes("2/4/2030"), false);
  assert.equal(factBelongsToContext(html, "f-6029", CONTEXT), false);
  assert.equal(factBelongsToContext(html, "f-6023", "c-1597"), false);

  console.log([
    `context=${parsed.contextId}`,
    `facts=${parsed.facts.map((fact) => fact.id).join(",")}`,
    `names=${parsed.facts.map((fact) => fact.name).join(",")}`,
    `untagged=${parsed.untaggedDates.join(",")}`,
    `taggedDates=${parsed.taggedDates.join(",") || "none"}`,
    `c-80-facts=${otherContext.facts.map((fact) => fact.id).join(",")}`,
    `c-1597-facts=${subtotal.facts.map((fact) => fact.id).join(",")}`,
  ].join(" "));
});
