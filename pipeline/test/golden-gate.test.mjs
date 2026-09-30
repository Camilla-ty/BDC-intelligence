import test from "node:test";
import assert from "node:assert/strict";
import {
  GOLDEN_IDENTIFIER_SHA256, EXPECTED_UNIVERSE, evaluateCriteria, evaluateNegativeControls,
  overallGateStatus, outcomesShaPayload, renderGoldenGateReport, INTERPRETATION,
} from "../load/golden-gate.mjs";
import { GOLDEN_OBSERVATION_COUNT_CODE, GOLDEN_OBSERVATION_COUNT_VERSION } from "../normalize/golden-observation-count.mjs";

function liveEvidence(overrides = {}) {
  return {
    universe: {
      soi_row_observation_count: 1_955_396,
      position_observation_count: 1_442_423,
      position_field_value_count: 6_538_911,
      derived_value_count: 0,
      derived_value_input_count: 0,
    },
    chain: {
      locators_n: 181,
      position_observations_found: 181,
      locator_location_matches: 181,
      locator_registrant_matches: 181,
      distinct_registrant_ciks: 24,
      distinct_reported_dates: 16,
      distinct_accessions: 105,
      observed_registrant_date_pairs: 107,
      positions_with_evidence: 181,
      golden_field_values: 614,
    },
    names: {
      n: 181,
      raw_equals_soi_identifier: true,
      raw_equals_tabular_cell: true,
      sha256_matches_selection: true,
      distinct_raw_texts: 1,
      nfc_btrim_matches_normalized: true,
      extracted: 181,
      rule_code_ok: true,
      pass_validations: 181,
    },
    instrument_type: { reported: 0, unknown: 181 },
    entity: {
      legal_entity_count: 1,
      matched: 181,
      matched_other_method: 0,
      unresolved: 0,
      near_name_unresolved: 0,
      near_name_candidates: 0,
      provenance_incomplete: 0,
      fuzzy_or_llm_matched: 0,
    },
    instrument: {
      identity_instrument_count: 0,
      identity_position_count: 0,
      matched: 0,
      unresolved: 181,
      matched_without_type: 0,
      continuity_matched: 0,
      continuity_unresolved: 181,
      distinct_continuity_series: 0,
      cross_bdc_series_merge: 0,
      fuzzy_or_llm_matched: 0,
      instrument_provenance_incomplete: 0,
      continuity_provenance_incomplete: 0,
    },
    identity_cik_columns: 0,
    economic_group_count: 0,
    group_membership_count: 0,
    coverage: { holes: 277, zero_principal_cost_fv_on_unobserved_dates: 0 },
    append_only: {
      tables_missing_triggers: 0,
      writer_update_rejected: true,
      writer_update_sqlstate: "42501",
    },
    edgar: { accessions_with_l2_artifact: 105, accessions_missing_l2_artifact: 0 },
    economic_fields: {
      n: 433, unverifiable: 433, filing_verified: 0, filing_mismatch: 0, not_checked: 0, status_missing: 0,
    },
    q14: {
      open_question_cost_fv: 276,
      authoritative_cost_fv: 0,
      provisional_cost_fv: 276,
      derived_inputs_cost_fv: 0,
      open_question_mapping_rows: 2,
    },
    metric: {
      code: GOLDEN_OBSERVATION_COUNT_CODE,
      version: GOLDEN_OBSERVATION_COUNT_VERSION,
      from_locators: 181,
      from_db_positions: 181,
      from_db_names: 181,
      persisted_to_derived_value: false,
    },
    selection: {
      identifier_sha256: GOLDEN_IDENTIFIER_SHA256,
      n_registrants: 24,
      n_reported_dates: 16,
      n_observations: 181,
      n_accessions: 105,
    },
    ...overrides,
  };
}

test("expected live evidence yields PASS with no FAIL and no forced instrument MATCHED", () => {
  const evidence = liveEvidence();
  const criteria = evaluateCriteria(evidence);
  assert.equal(overallGateStatus(criteria), "PASS");
  assert.equal(criteria.some((c) => c.status === "FAIL"), false);
  assert.equal(criteria.find((c) => c.id === "instrument_not_falsely_resolved").status, "PASS");
  assert.equal(criteria.find((c) => c.id === "matched_instrument_and_position_identity").status, "BLOCKED");
  assert.equal(criteria.find((c) => c.id === "q14_blocked").status, "PASS");
  assert.equal(criteria.find((c) => c.id === "economic_field_evidence_explicit").status, "PASS");
  assert.equal(criteria.find((c) => c.id === "derived_metric_recomputable").status, "PASS");
  assert.equal(EXPECTED_UNIVERSE.p7_instrument_matched, 0);
});

test("UNVERIFIABLE economic fields reinterpreted as verified is FAIL", () => {
  const evidence = liveEvidence({
    economic_fields: {
      n: 433, unverifiable: 0, filing_verified: 433, filing_mismatch: 0, not_checked: 0, status_missing: 0,
    },
  });
  const got = evaluateCriteria(evidence).find((c) => c.id === "economic_field_evidence_explicit");
  assert.equal(got.status, "FAIL");
  assert.equal(overallGateStatus(evaluateCriteria(evidence)), "FAIL");
});

test("authoritative Q14 COST/FV is FAIL", () => {
  const evidence = liveEvidence({
    q14: {
      open_question_cost_fv: 276,
      authoritative_cost_fv: 1,
      provisional_cost_fv: 275,
      derived_inputs_cost_fv: 0,
      open_question_mapping_rows: 2,
    },
  });
  assert.equal(evaluateCriteria(evidence).find((c) => c.id === "q14_blocked").status, "FAIL");
});

test("MATCHED instrument without a disclosed type is FAIL", () => {
  const evidence = liveEvidence({
    instrument: {
      identity_instrument_count: 1,
      identity_position_count: 0,
      matched: 1,
      unresolved: 180,
      matched_without_type: 1,
      continuity_matched: 0,
      continuity_unresolved: 181,
      distinct_continuity_series: 0,
      cross_bdc_series_merge: 0,
      fuzzy_or_llm_matched: 0,
      instrument_provenance_incomplete: 0,
      continuity_provenance_incomplete: 0,
    },
    instrument_type: { reported: 0, unknown: 181 },
  });
  assert.equal(evaluateCriteria(evidence).find((c) => c.id === "instrument_not_falsely_resolved").status, "FAIL");
});

test("two evaluations of the same evidence have identical outcome payloads", () => {
  const evidence = liveEvidence();
  const a = outcomesShaPayload(evaluateCriteria(evidence));
  const b = outcomesShaPayload(evaluateCriteria(evidence));
  assert.deepEqual(a, b);
});

test("live negative controls keep same-borrower/different-instrument BLOCKED", () => {
  const controls = evaluateNegativeControls(liveEvidence());
  const sameBorrower = controls.find((c) => c.id === "same_borrower_different_instrument_separate");
  assert.equal(sameBorrower.live_status, "BLOCKED");
  assert.notEqual(sameBorrower.live_status, "PASS");
  const crossBdc = controls.find((c) => c.id === "same_instrument_different_bdc_separate_positions");
  assert.equal(crossBdc.live_status, "NOT APPLICABLE");
  const insufficient = controls.find((c) => c.id === "insufficient_instrument_attributes_unresolved");
  assert.equal(insufficient.live_status, "PASS");
});

test("report separates PASS, BLOCKED, FAIL, and NOT APPLICABLE headings", () => {
  const criteria = evaluateCriteria(liveEvidence());
  const md = renderGoldenGateReport({
    queriedAt: "2099-01-01T00:00:00.000Z",
    database: "bdc_test",
    runId: 1,
    identifierSha256: GOLDEN_IDENTIFIER_SHA256,
    overall: "PASS",
    criteria,
    negativeControls: evaluateNegativeControls(liveEvidence()),
    reproducibility: { runs: 2, identical: true, sha1: "aa", sha2: "aa" },
    chainNotes: "chain",
    metric: liveEvidence().metric,
    universe: liveEvidence().universe,
    interpretation: INTERPRETATION,
  });
  assert.match(md, /## PASS — criterion demonstrated/);
  assert.match(md, /## BLOCKED — intentionally unresolved because source data\/evidence is insufficient/);
  assert.match(md, /matched_instrument_and_position_identity/);
  assert.match(md, /## FAIL — implementation violates a guardrail/);
  assert.match(md, /Q14 remains OPEN_QUESTION/);
  assert.equal(md.includes("identifier_raw"), false);
});
