import test from "node:test";
import assert from "node:assert/strict";
import { groupSoiFacts } from "../group-soi-facts.mjs";
import {
  classifyFactRole,
  groupsToInsert,
  planFactGroups,
  selectDuplicateDatePopulation,
} from "../normalize/soi-observation-group.mjs";

function fact(overrides) {
  const fields = overrides.fields ?? ["INSTRUMENT_TYPE", "PRINCIPAL_AMOUNT", "FAIR_VALUE"];
  const evidenceByField = {};
  fields.forEach((code, index) => {
    evidenceByField[code] = 7000 + (overrides.id ?? 1) * 10 + index;
  });
  return {
    id: 1,
    filingId: 20,
    registrantId: 10,
    reportedDate: "2099-03-31",
    identifierRaw: "TEST ISSUER A",
    instrumentType: "TEST FIRST LIEN",
    axes: { debt: "", stock: "", equity: "", range: "" },
    fieldCodes: fields,
    evidenceByField,
    ...overrides,
    fields: undefined,
  };
}

function pair(extra = {}) {
  return [
    fact({ id: 1, fields: ["INDUSTRY", "INSTRUMENT_TYPE", "PRINCIPAL_AMOUNT", "FAIR_VALUE", "MATURITY_DATE"], ...extra }),
    fact({ id: 2, fields: ["INDUSTRY", "INSTRUMENT_TYPE", "SPREAD"], ...extra }),
  ];
}

test("one balance fact and one spread fact are grouped", () => {
  const plan = planFactGroups(pair());
  assert.equal(plan.groups.length, 1);
  assert.equal(plan.groups[0].shape, "BALANCE_SPREAD");
  assert.equal(plan.groups[0].state, "UNRESOLVED");
  assert.deepEqual(plan.groups[0].members.map((member) => [member.positionObservationId, member.role]), [
    [1, "BALANCE"],
    [2, "SPREAD"],
  ]);
});

test("one balance fact, one spread fact, and one PIK-only fact are grouped", () => {
  const plan = planFactGroups([
    ...pair(),
    fact({ id: 3, fields: ["INSTRUMENT_TYPE", "PIK_RATE"] }),
  ]);
  assert.equal(plan.groups.length, 1);
  assert.equal(plan.groups[0].shape, "BALANCE_SPREAD_PIK");
  assert.deepEqual(plan.groups[0].members.map((member) => member.role), ["BALANCE", "SPREAD", "PIK"]);
});

test("a balance row that also discloses PIK stays the balance member", () => {
  assert.equal(classifyFactRole(["PRINCIPAL_AMOUNT", "FAIR_VALUE", "PIK_RATE", "INSTRUMENT_TYPE"]), "BALANCE");
  const plan = planFactGroups([
    fact({ id: 1, fields: ["PRINCIPAL_AMOUNT", "FAIR_VALUE", "PIK_RATE"] }),
    fact({ id: 2, fields: ["INSTRUMENT_TYPE", "SPREAD"] }),
  ]);
  assert.equal(plan.groups.length, 1);
  assert.equal(plan.groups[0].members[0].role, "BALANCE");
});

test("different Debt Instrument Axis members are not grouped", () => {
  const plan = planFactGroups([
    fact({ id: 1, axes: { debt: "TEST TERM LOAN MEMBER", stock: "", equity: "", range: "" } }),
    fact({ id: 2, fields: ["INSTRUMENT_TYPE", "SPREAD"], axes: { debt: "TEST REVOLVER MEMBER", stock: "", equity: "", range: "" } }),
  ]);
  assert.equal(plan.groups.length, 0);
});

test("different class, equity, and range axis members are not grouped", () => {
  for (const axis of ["stock", "equity", "range"]) {
    const balanceAxes = { debt: "", stock: "", equity: "", range: "", [axis]: "TEST MEMBER A" };
    const spreadAxes = { debt: "", stock: "", equity: "", range: "", [axis]: "TEST MEMBER B" };
    const plan = planFactGroups([
      fact({ id: 1, axes: balanceAxes }),
      fact({ id: 2, fields: ["INSTRUMENT_TYPE", "SPREAD"], axes: spreadAxes }),
    ]);
    assert.equal(plan.groups.length, 0, axis);
  }
});

test("a blank axis is not equivalent to a populated axis", () => {
  const plan = planFactGroups([
    fact({ id: 1, axes: { debt: "", stock: "", equity: "", range: "" } }),
    fact({ id: 2, fields: ["INSTRUMENT_TYPE", "SPREAD"], axes: { debt: "TEST REVOLVER MEMBER", stock: "", equity: "", range: "" } }),
  ]);
  assert.equal(plan.groups.length, 0);
  assert.equal(plan.blocked.axisOrFiling, 1);
});

test("two balance rows that share a Revolver axis member are not grouped", () => {
  const axes = { debt: "TEST REVOLVER MEMBER", stock: "", equity: "", range: "" };
  const plan = planFactGroups([
    fact({ id: 1, axes }),
    fact({ id: 2, axes }),
  ]);
  assert.equal(plan.groups.length, 0);
});

test("a balance row and a spread row that share a Revolver axis member are grouped", () => {
  const axes = { debt: "TEST REVOLVER MEMBER", stock: "", equity: "", range: "" };
  const plan = planFactGroups([
    fact({ id: 1, axes }),
    fact({ id: 2, fields: ["INSTRUMENT_TYPE", "SPREAD"], axes }),
  ]);
  assert.equal(plan.groups.length, 1);
});

test("two reported investment types are not grouped together", () => {
  const plan = planFactGroups([
    fact({ id: 1, instrumentType: "TEST FIRST LIEN" }),
    fact({ id: 2, instrumentType: "TEST FIRST LIEN", fields: ["INSTRUMENT_TYPE", "SPREAD"] }),
    fact({ id: 3, instrumentType: "TEST SECOND LIEN" }),
    fact({ id: 4, instrumentType: "TEST SECOND LIEN", fields: ["INSTRUMENT_TYPE", "SPREAD"] }),
  ]);
  assert.equal(plan.groups.length, 2);
  assert.deepEqual(plan.groups.map((group) => group.members.map((member) => member.positionObservationId)), [
    [1, 2],
    [3, 4],
  ]);
});

test("a type-only row is not grouped", () => {
  const alone = planFactGroups([fact({ id: 1, fields: ["INSTRUMENT_TYPE"] })]);
  assert.equal(alone.groups.length, 0);
  const withPair = planFactGroups([
    ...pair(),
    fact({ id: 3, fields: ["INSTRUMENT_TYPE", "INDUSTRY"] }),
  ]);
  assert.equal(withPair.groups.length, 0);
});

test("multiple balance candidates are not grouped", () => {
  const plan = planFactGroups([
    fact({ id: 1 }),
    fact({ id: 2 }),
    fact({ id: 3, fields: ["INSTRUMENT_TYPE", "SPREAD"] }),
  ]);
  assert.equal(plan.groups.length, 0);
});

test("multiple spread candidates are not grouped", () => {
  const plan = planFactGroups([
    fact({ id: 1 }),
    fact({ id: 2, fields: ["INSTRUMENT_TYPE", "SPREAD"] }),
    fact({ id: 3, fields: ["INSTRUMENT_TYPE", "SPREAD"] }),
  ]);
  assert.equal(plan.groups.length, 0);
});

test("multiple PIK candidates are not grouped", () => {
  const plan = planFactGroups([
    ...pair(),
    fact({ id: 3, fields: ["PIK_RATE"] }),
    fact({ id: 4, fields: ["PIK_RATE"] }),
  ]);
  assert.equal(plan.groups.length, 0);
});

test("a PIK measure on both the balance row and a PIK row is not grouped", () => {
  const plan = planFactGroups([
    fact({ id: 1, fields: ["PRINCIPAL_AMOUNT", "FAIR_VALUE", "PIK_RATE"] }),
    fact({ id: 2, fields: ["SPREAD"] }),
    fact({ id: 3, fields: ["PIK_RATE"] }),
  ]);
  assert.equal(plan.groups.length, 0);
  assert.equal(plan.blocked.overlap, 1);
});

test("controlled-investments rows that share an identifier and type stay ungrouped", () => {
  const rows = [
    fact({ id: 11, identifierRaw: "TEST CONTROLLED ISSUER", instrumentType: "TEST CONTROLLED INVESTMENTS", fields: ["INSTRUMENT_TYPE"], axes: { debt: "TEST REVOLVER MEMBER", stock: "", equity: "", range: "" } }),
    fact({ id: 12, identifierRaw: "TEST CONTROLLED ISSUER", instrumentType: "TEST CONTROLLED INVESTMENTS", fields: ["INSTRUMENT_TYPE"], axes: { debt: "TEST REVOLVER MEMBER", stock: "", equity: "", range: "" } }),
    fact({ id: 13, identifierRaw: "TEST CONTROLLED ISSUER", instrumentType: "TEST CONTROLLED INVESTMENTS", fields: ["INSTRUMENT_TYPE"], axes: { debt: "TEST TERM LOAN MEMBER", stock: "", equity: "", range: "" } }),
    fact({ id: 14, identifierRaw: "TEST CONTROLLED ISSUER", instrumentType: "TEST CONTROLLED INVESTMENTS", fields: ["INSTRUMENT_TYPE"], axes: { debt: "", stock: "", equity: "", range: "" } }),
    fact({ id: 15, identifierRaw: "TEST CONTROLLED ISSUER", instrumentType: "TEST CONTROLLED INVESTMENTS", fields: ["INSTRUMENT_TYPE"], axes: { debt: "", stock: "TEST PREFERRED MEMBER", equity: "", range: "" } }),
  ];
  assert.equal(planFactGroups(rows).groups.length, 0);
});

test("source observation ids and member roles are preserved", () => {
  const source = pair();
  const plan = planFactGroups(source);
  assert.deepEqual(source.map((row) => row.id), [1, 2]);
  assert.deepEqual(plan.groups[0].members.map((member) => member.positionObservationId), [1, 2]);
  assert.equal(plan.groups[0].members[0].evidenceId, source[0].evidenceByField.PRINCIPAL_AMOUNT);
  assert.equal(plan.groups[0].members[1].evidenceId, source[1].evidenceByField.SPREAD);
});

test("the same facts plan the same group on a second execution", () => {
  const first = planFactGroups(pair());
  const second = planFactGroups(pair());
  assert.deepEqual(second, first);
  assert.deepEqual(groupsToInsert(second.groups, [first.groups[0].groupingKey]), []);
});

test("grouping keys do not depend on input order", () => {
  const rows = [
    ...pair(),
    fact({ id: 3, instrumentType: "TEST SECOND LIEN" }),
    fact({ id: 4, instrumentType: "TEST SECOND LIEN", fields: ["INSTRUMENT_TYPE", "SPREAD"] }),
  ];
  const forward = planFactGroups(rows).groups.map((group) => group.groupingKey);
  const reversed = planFactGroups([...rows].reverse()).groups.map((group) => group.groupingKey);
  const interleaved = planFactGroups([rows[0], rows[2], rows[1], rows[3]]).groups.map((group) => group.groupingKey);
  assert.deepEqual(reversed, forward);
  assert.deepEqual(interleaved, forward);
  assert.deepEqual(forward, ["v1:1,2", "v1:3,4"]);
});

test("planned groups do not share a source observation", () => {
  const plan = planFactGroups([
    ...pair(),
    fact({ id: 3, instrumentType: "TEST SECOND LIEN" }),
    fact({ id: 4, instrumentType: "TEST SECOND LIEN", fields: ["INSTRUMENT_TYPE", "SPREAD"] }),
  ]);
  const ids = plan.groups.flatMap((group) => group.members.map((member) => member.positionObservationId));
  assert.equal(new Set(ids).size, ids.length);
});

test("a one-row-per-date series is outside the fact-group population", () => {
  const resolved = [
    { id: 42, registrantId: 10, registrantLinkStatus: "LINKED", identifierRaw: "TEST RESOLVED ISSUER", instrumentType: "TEST COMMON STOCK", reportedDate: "2099-03-31" },
    { id: 43, registrantId: 10, registrantLinkStatus: "LINKED", identifierRaw: "TEST RESOLVED ISSUER", instrumentType: "TEST COMMON STOCK", reportedDate: "2099-12-31" },
  ];
  const duplicated = [
    { id: 1, registrantId: 10, registrantLinkStatus: "LINKED", identifierRaw: "TEST ISSUER A", instrumentType: "TEST FIRST LIEN", reportedDate: "2099-03-31" },
    { id: 2, registrantId: 10, registrantLinkStatus: "LINKED", identifierRaw: "TEST ISSUER A", instrumentType: "TEST FIRST LIEN", reportedDate: "2099-03-31" },
  ];
  assert.deepEqual(selectDuplicateDatePopulation([...resolved, ...duplicated]).map((row) => row.id), [1, 2]);
  assert.equal(planFactGroups([fact({ id: 42, fields: ["FAIR_VALUE", "INSTRUMENT_TYPE"] })]).groups.length, 0);
});

test("a row that is both balance and spread is not grouped", () => {
  const plan = planFactGroups([
    fact({ id: 1, fields: ["PRINCIPAL_AMOUNT", "FAIR_VALUE", "SPREAD"] }),
    fact({ id: 2, fields: ["SPREAD"] }),
  ]);
  assert.equal(plan.groups.length, 0);
  assert.equal(classifyFactRole(["PRINCIPAL_AMOUNT", "FAIR_VALUE", "SPREAD"]), null);
});

test("SOI fact grouping refuses a hosted database", () => {
  const previous = process.env.PIPELINE_DATABASE_URL;
  process.env.PIPELINE_DATABASE_URL = "postgres://example.invalid/bdc";
  try {
    assert.throws(
      () => groupSoiFacts({ database: "bdc_local", dryRun: true, log() {} }),
      /refuses a hosted database/,
    );
  } finally {
    if (previous == null) delete process.env.PIPELINE_DATABASE_URL;
    else process.env.PIPELINE_DATABASE_URL = previous;
  }
});

test("SOI fact grouping refuses a database other than the local database", () => {
  assert.throws(
    () => groupSoiFacts({ database: "other_db", dryRun: true, log() {} }),
    /refuses a database other than the local database/,
  );
});
