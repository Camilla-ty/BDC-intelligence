import test from "node:test";
import assert from "node:assert/strict";
import { BOUND_SPREAD_CODE, BOUND_SPREAD_VERSION } from "../load/bound-spread.mjs";
import { RULES, ruleDefinitionSha } from "../load/rules.mjs";
import { SOI_FACT_GROUP_RULE } from "../normalize/soi-observation-group.mjs";

// Current catalog versions after the Hosted SHA-mismatch recovery bumps.
// Historical Hosted rows stay stored and are not listed here.
const CURRENT = [
  { code: "obs.projection.num", version: "3", sha: "440728df5b37d1c2af41546367d3c9aa9ec6a002877e269d0bbb0727d2b42f9b" },
  { code: "obs.soi_fact_group", version: "2", sha: "33d31f936241c2b75e17f790d012e6e68ad5eef2e8f54a38ff87ac472f3bf1a1" },
  { code: "parser.sec_num_tsv", version: "3", sha: "e2db4a2bf0655429b8d71ef885cc80d963c7f5c08575eb787114be91d6162f85" },
  { code: "obs.spread.bound_ixbrl_fact", version: "2", sha: "e69457d154fb57554bdae392e21ad670972391d3f83fcf69faa1a934e4f76cc4" },
  { code: "parser.sec_soi_tsv", version: "2", sha: "905aecec3bc1d38830006d55b2e2b937ac080727191c3f160bd1bbbb9a215c45" },
  { code: "parser.sec_sub_tsv", version: "2", sha: "3d88365a040f4cf4ceb3e8b627d72a86db65e83373abfbd5891ddb0186b6b07b" },
  { code: "pipeline.num_load", version: "3", sha: "9aef99f23b422d9bdf75300c45c57b61e91c0ca38bf2b0300bd79955ea4c51c0" },
  { code: "pipeline.registry_load", version: "6", sha: "3f8b75e1ff4dea6435252301c278757f331845d09e7eb6dbd3d8f4a13723e7e9" },
  { code: "pipeline.soi_load", version: "6", sha: "c00e933ff71d63d68ca7bfd29fc65dc29295f8a19be84bdac5485b2b1045f585" },
  { code: "resolution.instrument_exact_identifier_and_type", version: "3", sha: "c44cfef407389c043d0c4ff8f8946ed0d0a6fe9dc8c915b2eb2757813c2f4048" },
  { code: "resolution.instrument_unknown_attributes", version: "3", sha: "a39cbae4ae8c80b6fcbb9f6df5c286e692ea24a49ee19892793ecd0d628436d0" },
  { code: "resolution.position_same_registrant_and_instrument", version: "3", sha: "f9af6a22e74f8be87378810268e0a9a63503789d26f4170d9f4b91aa1ac8ef4d" },
  { code: "resolution.position_unresolved_without_instrument", version: "3", sha: "7d73fbb6fe426240ca106f2aa9ebbb0314db6ba1bb9b48113f9a95521059e59c" },
];

test("the catalog current versions for the Hosted SHA-mismatch set are unique and locked", () => {
  assert.equal(SOI_FACT_GROUP_RULE.version, "2");
  assert.equal(BOUND_SPREAD_VERSION, "2");
  for (const expected of CURRENT) {
    const found = RULES.filter((rule) => rule.code === expected.code);
    assert.deepEqual(found.map((rule) => rule.version), [expected.version], expected.code);
    assert.equal(ruleDefinitionSha(found[0]), expected.sha, expected.code);
  }
  const spread = RULES.find((rule) => rule.code === BOUND_SPREAD_CODE && rule.version === BOUND_SPREAD_VERSION);
  assert.ok(spread);
  assert.equal(spread.version, "2");
});
