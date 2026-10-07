import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RULES } from "../load/rules.mjs";
import {
  AMBIGUOUS_COMPANY_NAME_METHOD,
  COMPANY_CELL_METHOD,
  COMPANY_CELL_RULE_CODE,
  COMPANY_CELL_RULE_VERSION,
  CONFLICTING_COMPANY_NAMES_METHOD,
  NO_COMPANY_NAME_METHOD,
  companyNames,
  planCompanyCellEntities,
} from "../normalize/company-cell-entity.mjs";

const COMPANY = "TEST BORROWER A CORPORATION";

function cell(normalizedText, evidenceId = 11) {
  return { normalizedText, evidenceId };
}

function obs(id, { filingCells = [], issuerNames = [], identifierRaw = `${COMPANY}, TEST FIRST LIEN ${id}` } = {}) {
  return { id, identifierRaw, filingCells, issuerNames };
}

test("one company cell gives MATCHED and plans one legal entity named by the cell", () => {
  const plan = planCompanyCellEntities([obs(1, { filingCells: [cell(COMPANY, 7)] })]);
  assert.equal(plan.decisions.length, 1);
  assert.equal(plan.decisions[0].state, "MATCHED");
  assert.equal(plan.decisions[0].method, COMPANY_CELL_METHOD);
  assert.equal(plan.decisions[0].companyName, COMPANY);
  assert.equal(plan.decisions[0].newEntityAlias, COMPANY);
  assert.equal(plan.decisions[0].evidenceId, 7);
  assert.deepEqual(plan.newEntities, [{ aliasText: COMPANY, evidenceId: 7 }]);
});

test("several instruments with one company cell resolve to one planned legal entity", () => {
  const plan = planCompanyCellEntities([
    obs(1, { filingCells: [cell(COMPANY)], identifierRaw: `${COMPANY}, TEST FIRST LIEN 1` }),
    obs(2, { filingCells: [cell(COMPANY)], identifierRaw: COMPANY }),
  ]);
  assert.deepEqual(plan.decisions.map((decision) => decision.state), ["MATCHED", "MATCHED"]);
  assert.equal(plan.newEntities.length, 1);
  assert.deepEqual(plan.decisions.map((decision) => decision.newEntityAlias), [COMPANY, COMPANY]);
});

test("identifier text with instrument words is never an alias or a company name", () => {
  const identifiers = [`${COMPANY}, TEST FIRST LIEN 1`, `${COMPANY}, TEST FIRST LIEN 2`, `${COMPANY}, TEST FIRST LIEN`, COMPANY];
  const plan = planCompanyCellEntities([
    obs(1, { identifierRaw: identifiers[0] }),
    obs(2, { identifierRaw: identifiers[1] }),
    obs(3, { identifierRaw: identifiers[2], filingCells: [cell(COMPANY)] }),
    obs(4, { identifierRaw: identifiers[3] }),
  ]);
  const aliases = plan.newEntities.map((entity) => entity.aliasText);
  assert.deepEqual(aliases, [COMPANY]);
  for (const decision of plan.decisions) {
    assert.ok(decision.companyName == null || decision.companyName === COMPANY);
  }
  assert.equal(plan.decisions.find((decision) => decision.positionObservationId === 4).state, "UNRESOLVED");
});

test("no company cell or issuer name gives UNRESOLVED with NO_COMPANY_NAME_EVIDENCE", () => {
  const plan = planCompanyCellEntities([obs(1)]);
  assert.equal(plan.decisions[0].state, "UNRESOLVED");
  assert.equal(plan.decisions[0].method, NO_COMPANY_NAME_METHOD);
  assert.equal(plan.decisions[0].legalEntityId, null);
  assert.equal(plan.decisions[0].newEntityAlias, null);
  assert.equal(plan.decisions[0].evidenceId, null);
  assert.equal(plan.newEntities.length, 0);
});

test("conflicting company cells give UNRESOLVED with CONFLICTING_COMPANY_NAMES", () => {
  const plan = planCompanyCellEntities([obs(1, { filingCells: [cell(COMPANY), cell("TEST BORROWER B LLC")] })]);
  assert.equal(plan.decisions[0].state, "UNRESOLVED");
  assert.equal(plan.decisions[0].method, CONFLICTING_COMPANY_NAMES_METHOD);
  assert.equal(plan.newEntities.length, 0);
});

test("a company cell and an ISSUER_NAME that disagree give CONFLICTING_COMPANY_NAMES", () => {
  const plan = planCompanyCellEntities([
    obs(1, { filingCells: [cell(COMPANY)], issuerNames: [{ rawText: "TEST BORROWER B LLC", evidenceId: 12 }] }),
  ]);
  assert.equal(plan.decisions[0].state, "UNRESOLVED");
  assert.equal(plan.decisions[0].method, CONFLICTING_COMPANY_NAMES_METHOD);
});

test("an ISSUER_NAME alone is an equal company-name source", () => {
  const plan = planCompanyCellEntities([obs(1, { issuerNames: [{ rawText: `  ${COMPANY}  `, evidenceId: 12 }] })]);
  assert.equal(plan.decisions[0].state, "MATCHED");
  assert.equal(plan.decisions[0].companyName, COMPANY);
  assert.equal(plan.decisions[0].evidenceId, 12);
});

test("an agreeing company cell and ISSUER_NAME match and cite the company cell", () => {
  const plan = planCompanyCellEntities([
    obs(1, { filingCells: [cell(COMPANY, 7)], issuerNames: [{ rawText: COMPANY, evidenceId: 12 }] }),
  ]);
  assert.equal(plan.decisions[0].state, "MATCHED");
  assert.equal(plan.decisions[0].evidenceId, 7);
});

test("a blank ISSUER_NAME is not company-name evidence", () => {
  assert.deepEqual(companyNames(obs(1, { issuerNames: [{ rawText: "   ", evidenceId: 12 }] })), []);
  assert.equal(planCompanyCellEntities([obs(1, { issuerNames: [{ rawText: "   ", evidenceId: 12 }] })]).decisions[0].method, NO_COMPANY_NAME_METHOD);
});

test("an existing alias of this rule is reused; two entities with that alias give AMBIGUOUS", () => {
  const reuse = planCompanyCellEntities([obs(1, { filingCells: [cell(COMPANY)] })], [{ aliasText: COMPANY, legalEntityId: "entity-1" }]);
  assert.equal(reuse.decisions[0].state, "MATCHED");
  assert.equal(reuse.decisions[0].legalEntityId, "entity-1");
  assert.equal(reuse.decisions[0].newEntityAlias, null);
  assert.equal(reuse.newEntities.length, 0);

  const ambiguous = planCompanyCellEntities([obs(1, { filingCells: [cell(COMPANY)] })], [
    { aliasText: COMPANY, legalEntityId: "entity-1" },
    { aliasText: COMPANY, legalEntityId: "entity-2" },
  ]);
  assert.equal(ambiguous.decisions[0].state, "UNRESOLVED");
  assert.equal(ambiguous.decisions[0].method, AMBIGUOUS_COMPANY_NAME_METHOD);
  assert.equal(ambiguous.newEntities.length, 0);
});

test("near names and suffix differences are never MATCHED to one entity", () => {
  const plan = planCompanyCellEntities(
    [
      obs(1, { filingCells: [cell("TEST BORROWER A CORP")] }),
      obs(2, { filingCells: [cell("TEST BORROWER A HOLDINGS")] }),
      obs(3, { filingCells: [cell("test borrower a corporation")] }),
    ],
    [{ aliasText: COMPANY, legalEntityId: "entity-1" }],
  );
  for (const decision of plan.decisions) assert.notEqual(decision.legalEntityId, "entity-1");
  assert.deepEqual(
    plan.newEntities.map((entity) => entity.aliasText).sort(),
    ["TEST BORROWER A CORP", "TEST BORROWER A HOLDINGS", "test borrower a corporation"],
  );
});

test("an identical identifier across registrants without company evidence is never MATCHED", () => {
  const identifierRaw = `${COMPANY}, TEST FIRST LIEN`;
  const plan = planCompanyCellEntities(
    [obs(1, { identifierRaw }), obs(2, { identifierRaw }), obs(3, { identifierRaw })],
    [{ aliasText: identifierRaw, legalEntityId: "entity-1" }],
  );
  assert.deepEqual(plan.decisions.map((decision) => decision.state), ["UNRESOLVED", "UNRESOLVED", "UNRESOLVED"]);
  assert.deepEqual(plan.decisions.map((decision) => decision.method), [NO_COMPANY_NAME_METHOD, NO_COMPANY_NAME_METHOD, NO_COMPANY_NAME_METHOD]);
  assert.equal(plan.newEntities.length, 0);
});

test("the rule is in the catalog and its files do not include P6-min or the near-name matcher", () => {
  const rule = RULES.find((item) => item.code === COMPANY_CELL_RULE_CODE && item.version === COMPANY_CELL_RULE_VERSION);
  assert.ok(rule);
  assert.equal(rule.kind, "RESOLUTION");
  assert.equal(rule.files.includes("pipeline/load/p6-min.mjs"), false);
  assert.equal(rule.files.includes("pipeline/normalize/entity-name-match.mjs"), false);
});

test("the company-cell planner does not split identifiers or use near-name matching", () => {
  const src = readFileSync(new URL("../normalize/company-cell-entity.mjs", import.meta.url), "utf8");
  assert.equal(src.includes("identifierRaw"), false);
  assert.equal(src.includes("entity-name-match"), false);
  assert.equal(/\.split\(/.test(src), false);
});
