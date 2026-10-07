import test from "node:test";
import assert from "node:assert/strict";
import { RULES } from "../load/rules.mjs";
import { summarizePlan, supersessionSql } from "../load/continuity-supersession.mjs";
import {
  APPROVED_CONTINUITY_SUPERSESSIONS, PAIR_STATUS, PRIOR_CONTINUITY_METHOD, PROTECTED_OBSERVATION_IDS,
  SUPERSESSION_METHOD, SUPERSESSION_RULE_CODE, SUPERSESSION_RULE_VERSION,
  evaluatePair, supersessionDecision, validateAllowlist,
} from "../normalize/continuity-supersession.mjs";
import {
  SUPERSESSION_RULES, assertSupersessionDatabase, parseArgs, supersedeApprovedContinuity,
} from "../supersede-approved-continuity.mjs";

// Observation ids, identifiers, CIKs, dates, prior decision ids, and target positions below come from the
// approved allowlist. Every other value (registrant ids, evidence ids, instrument ids, decision ids of the
// superseding rows, footnote ids) is TEST ONLY.
const TEST_REGISTRANT = 900001;
const TEST_INSTRUMENT_EARLIER = "00000000-0000-4000-8000-000000000001";
const TEST_INSTRUMENT_LATER = "00000000-0000-4000-8000-000000000002";
const TEST_OTHER_POSITION = "00000000-0000-4000-8000-0000000000aa";

function verified(rawText, markers) {
  return {
    state: "VERIFIED", reason: "ALL_MARKERS_ROW_LINKED", rawText, normalizedText: "First Lien",
    removedMarkers: markers, footnoteIds: markers.map((m) => `fn-${m}`),
  };
}

function observation(entry, side, overrides = {}) {
  const later = side === "later";
  const id = later ? entry.laterObservationId : entry.earlierObservationId;
  const evidence = later ? 7000 : 6000;
  return {
    id,
    reported_date: later ? entry.laterReportedDate : entry.earlierReportedDate,
    holding_descriptor_raw: entry.identifier,
    evidence_id: evidence + 1,
    registrants: [{ registrant_id: TEST_REGISTRANT, cik: entry.cik }],
    names: [{ id: evidence + 2, raw_text: entry.identifier, normalized_text: entry.identifier, evidence_id: evidence + 3 }],
    types: [{ id: evidence + 4, value_state: "REPORTED", raw_value: later ? "First Lien(2)(6)(8)" : "First Lien(2)(5)", evidence_id: evidence + 5 }],
    type_ref: later ? verified("First Lien(2)(6)(8)", ["2", "6", "8"]) : verified("First Lien(2)(5)", ["2", "5"]),
    instruments: [{ id: evidence + 6, state: "MATCHED", instrument_id: later ? TEST_INSTRUMENT_LATER : TEST_INSTRUMENT_EARLIER }],
    continuity: [later
      ? { id: entry.priorDecisionId, state: "MATCHED", method: PRIOR_CONTINUITY_METHOD, position_id: TEST_OTHER_POSITION,
        position_registrant_id: TEST_REGISTRANT, run_id: entry.priorRunId, supersedes_id: null }
      : { id: entry.priorDecisionId + 1, state: "MATCHED", method: PRIOR_CONTINUITY_METHOD, position_id: entry.targetPositionId,
        position_registrant_id: TEST_REGISTRANT, run_id: entry.priorRunId, supersedes_id: null }],
    ...overrides,
  };
}

function factsFor(entry, { later = {}, earlier = {}, ...rest } = {}) {
  return {
    later: observation(entry, "later", later),
    earlier: observation(entry, "earlier", earlier),
    laterSeries: [{ position_observation_id: entry.laterObservationId, reported_date: entry.laterReportedDate }],
    targetSeries: [{ position_observation_id: entry.earlierObservationId, reported_date: entry.earlierReportedDate }],
    sameKey: [
      { id: entry.earlierObservationId, reported_date: entry.earlierReportedDate },
      { id: entry.laterObservationId, reported_date: entry.laterReportedDate },
    ],
    ...rest,
  };
}

function codes(result) {
  return result.blocking.map((b) => b.code);
}

const [PAIR1] = APPROVED_CONTINUITY_SUPERSESSIONS;

test("the approved allowlist is exactly the three audited pairs", () => {
  assert.deepEqual(APPROVED_CONTINUITY_SUPERSESSIONS.map((e) => [e.laterObservationId, e.earlierObservationId]), [
    [893583, 981407], [893584, 981408], [893587, 981411],
  ]);
  assert.deepEqual(APPROVED_CONTINUITY_SUPERSESSIONS.map((e) => e.identifier), [
    "Geo Parent Corporation, First Lien 1", "Geo Parent Corporation, First Lien 2", "Geo Parent Corporation, First Lien",
  ]);
  assert.deepEqual(APPROVED_CONTINUITY_SUPERSESSIONS.map((e) => [e.cik, e.priorDecisionId, e.priorRunId]), [
    [1925531, 1, 49], [1925531, 3, 49], [1766037, 5, 49],
  ]);
  assert.ok(Object.isFrozen(APPROVED_CONTINUITY_SUPERSESSIONS));
  for (const entry of APPROVED_CONTINUITY_SUPERSESSIONS) assert.ok(Object.isFrozen(entry));
  assert.doesNotThrow(() => validateAllowlist(APPROVED_CONTINUITY_SUPERSESSIONS));
});

test("each approved pair plans exactly one superseding MATCHED decision with full provenance", () => {
  for (const entry of APPROVED_CONTINUITY_SUPERSESSIONS) {
    const facts = factsFor(entry);
    const result = evaluatePair(entry, facts);
    assert.equal(result.status, PAIR_STATUS.PLANNED, JSON.stringify(result.blocking));
    const decision = supersessionDecision(entry, facts);
    assert.equal(decision.position_observation_id, entry.laterObservationId);
    assert.equal(decision.earlier_position_observation_id, entry.earlierObservationId);
    assert.equal(decision.prior_continuity_decision_id, entry.priorDecisionId);
    assert.equal(decision.prior_run_id, 49);
    assert.equal(decision.prior_position_id, TEST_OTHER_POSITION);
    assert.equal(decision.target_position_id, entry.targetPositionId);
    assert.equal(decision.state, "MATCHED");
    assert.equal(decision.method, SUPERSESSION_METHOD);
    assert.equal(decision.decision_evidence_id, 7001);
    assert.deepEqual(decision.supporting_evidence, [
      { attribute: "REGISTRANT_OBSERVATION", earlier_evidence_id: 6001, later_evidence_id: 7001 },
      { attribute: "IDENTIFIER", earlier_evidence_id: 6003, later_evidence_id: 7003 },
      { attribute: "FOOTNOTE_VERIFIED_TYPE", earlier_evidence_id: 6005, later_evidence_id: 7005 },
    ]);
    assert.match(decision.supersede_reason, new RegExp(`^Run 49 decision ${entry.priorDecisionId} \\(SAME_REGISTRANT_AND_INSTRUMENT\\)`));
    assert.match(decision.supersede_reason, /decision \d+ stays in history/);
    assert.match(decision.rationale, /resolution\.position_approved_continuity_supersession v1/);
    assert.match(decision.rationale, /removed \(2\)\(5\) footnotes fn-2,fn-5/);
    assert.match(decision.rationale, /removed \(2\)\(6\)\(8\) footnotes fn-2,fn-6,fn-8/);
    assert.match(decision.rationale, /Instrument decisions are unchanged/);
    assert.match(decision.rationale, /reference-rate reset frequency, are not compared/);
    assert.match(decision.rationale, /Evidence \(earlier\/later\): REGISTRANT_OBSERVATION 6001\/7001, IDENTIFIER 6003\/7003, FOOTNOTE_VERIFIED_TYPE 6005\/7005/);
    assert.equal(decision.later_instrument_id, TEST_INSTRUMENT_LATER);
    assert.equal(decision.earlier_instrument_id, TEST_INSTRUMENT_EARLIER);
  }
});

test("the writer SQL only inserts candidates, comparisons, and superseding continuity decisions", () => {
  const decisions = APPROVED_CONTINUITY_SUPERSESSIONS.map((entry) => supersessionDecision(entry, factsFor(entry)));
  const sql = supersessionSql({ runId: 1, ruleVersionId: 2, decisions });
  assert.doesNotMatch(sql, /\bUPDATE\b|\bDELETE\b|\bTRUNCATE\b|\bALTER\b|\bDROP TABLE\b|ON CONFLICT/i);
  const targets = [...sql.matchAll(/INSERT INTO ([a-z_.]+)/g)].map((m) => m[1]);
  assert.deepEqual(targets, [
    "resolution.match_candidate", "resolution.match_candidate_comparison", "resolution.position_continuity_decision",
  ]);
  assert.doesNotMatch(sql, /instrument_resolution_decision|identity\.position|identity\.instrument/);
  assert.match(sql, /NOT EXISTS \(SELECT 1 FROM resolution\.position_continuity_decision s WHERE s\.supersedes_id = d\.id\)/);
  assert.match(sql, /supersedes_id, supersede_reason\)/);
  const copyRows = sql.split("COPY _cs (")[1].split("\\.")[0].trim().split("\n").slice(1);
  assert.equal(copyRows.length, 3);
  assert.deepEqual(copyRows.map((row) => row.split("\t").slice(0, 3)), APPROVED_CONTINUITY_SUPERSESSIONS.map((e) => [
    String(e.laterObservationId), String(e.priorDecisionId), e.targetPositionId,
  ]));
  const comparisonRows = sql.split("COPY _cs_cmp (")[1].split("\\.")[0].trim().split("\n").slice(1);
  assert.equal(comparisonRows.length, 9);
});

test("a pair already superseded by this rule is ALREADY_APPLIED and plans nothing", () => {
  const entry = PAIR1;
  const facts = factsFor(entry, {
    later: {
      continuity: [{ id: 99, state: "MATCHED", method: SUPERSESSION_METHOD, position_id: entry.targetPositionId,
        position_registrant_id: TEST_REGISTRANT, run_id: 50, supersedes_id: entry.priorDecisionId }],
    },
    laterSeries: [],
    targetSeries: [
      { position_observation_id: entry.earlierObservationId, reported_date: entry.earlierReportedDate },
      { position_observation_id: entry.laterObservationId, reported_date: entry.laterReportedDate },
    ],
  });
  const result = evaluatePair(entry, facts);
  assert.equal(result.status, PAIR_STATUS.ALREADY_APPLIED);
  const summary = summarizePlan([result]);
  assert.equal(summary.n_planned, 0);
  assert.deepEqual(summary.planned_supersessions, []);
  assert.deepEqual(summary.already_applied, [{ position_observation_id: 893583, current_decision_id: 99, supersedes_id: 1 }]);
});

test("protected observations and the earlier Guardian IV series cannot enter an allowlist", () => {
  assert.deepEqual([...PROTECTED_OBSERVATION_IDS].sort((a, b) => a - b),
    [893588, 981412, 1067071, 1067072, 1067074, 1146287, 1146289]);
  const approvedIds = APPROVED_CONTINUITY_SUPERSESSIONS.flatMap((e) => [e.laterObservationId, e.earlierObservationId]);
  for (const id of PROTECTED_OBSERVATION_IDS) {
    assert.equal(approvedIds.includes(id), false);
    assert.throws(() => validateAllowlist([{ ...PAIR1, laterObservationId: id }]), /protected/);
    assert.throws(() => validateAllowlist([{ ...PAIR1, earlierObservationId: id }]), /protected/);
  }
  // Guardian IV "Geo Parent Corporation, First Lien" ends 2024-03-31 at 1067072; it cannot target First Lien 1.
  assert.throws(() => validateAllowlist([{ ...PAIR1, earlierObservationId: 1067072, earlierReportedDate: "2024-03-31" }]), /protected/);
});

test("a different identifier text is never linked, even for an unprotected observation", () => {
  const entry = PAIR1;
  const facts = factsFor(entry, {
    earlier: {
      holding_descriptor_raw: "Geo Parent Corporation, First Lien",
      names: [{ id: 1, raw_text: "Geo Parent Corporation, First Lien", normalized_text: "Geo Parent Corporation, First Lien", evidence_id: 2 }],
    },
  });
  const result = evaluatePair(entry, facts);
  assert.equal(result.status, PAIR_STATUS.BLOCKED);
  assert.ok(codes(result).includes("IDENTIFIER_MISMATCH"));
});

test("an observation outside the allowlist cannot be superseded", () => {
  // The command takes no pair arguments.
  for (const args of [["--pair", "1", "2"], ["--observation", "893585"], ["893585"], ["--later", "1146287"]]) {
    assert.throws(() => parseArgs(args), /unknown argument/);
  }
  assert.deepEqual(parseArgs(["--dry-run", "--allow-hosted", "--data-dir", "/tmp/x"]), {
    database: "bdc_local", dataDir: "/tmp/x", dryRun: true, allowHosted: true,
  });
  // Stored facts for another observation never satisfy an approved entry.
  const entry = PAIR1;
  const other = factsFor(entry, { later: { id: 893585 } });
  const result = evaluatePair(entry, other);
  assert.equal(result.status, PAIR_STATUS.BLOCKED);
  assert.ok(codes(result).includes("PRIOR_SERIES_HAS_OTHER_MEMBERS"));
});

test("intervening and same-date observations block a pair", () => {
  const entry = PAIR1;
  const between = evaluatePair(entry, factsFor(entry, {
    sameKey: [
      { id: entry.earlierObservationId, reported_date: entry.earlierReportedDate },
      { id: 555, reported_date: "2024-08-31" },
      { id: entry.laterObservationId, reported_date: entry.laterReportedDate },
    ],
  }));
  assert.deepEqual(codes(between), ["INTERVENING_OBSERVATION"]);
  const duplicate = evaluatePair(entry, factsFor(entry, {
    sameKey: [
      { id: entry.earlierObservationId, reported_date: entry.earlierReportedDate },
      { id: 556, reported_date: entry.laterReportedDate },
      { id: entry.laterObservationId, reported_date: entry.laterReportedDate },
    ],
  }));
  assert.deepEqual(codes(duplicate), ["SAME_DATE_DUPLICATE"]);
  const targetLater = evaluatePair(entry, factsFor(entry, {
    targetSeries: [
      { position_observation_id: entry.earlierObservationId, reported_date: entry.earlierReportedDate },
      { position_observation_id: 557, reported_date: "2024-12-31" },
    ],
  }));
  assert.deepEqual(codes(targetLater), ["TARGET_SERIES_NOT_ENDING_AT_EARLIER"]);
});

test("every pinned fact must equal the stored fact", () => {
  const entry = PAIR1;
  const cases = [
    [{ later: { type_ref: { ...verified("First Lien(2)(6)(8)", ["2"]), state: "UNVERIFIED", reason: "MARKER_NOT_LINKED" } } }, "TYPE_NOT_FOOTNOTE_VERIFIED"],
    [{ earlier: { type_ref: { ...verified("Second Lien(2)", ["2"]), normalizedText: "Second Lien" } } }, "CONTINUITY_TYPE_MISMATCH"],
    [{ earlier: { registrants: [{ registrant_id: TEST_REGISTRANT + 1, cik: entry.cik }] } }, "REGISTRANT_MISMATCH"],
    [{ later: { registrants: [{ registrant_id: TEST_REGISTRANT, cik: 1 }] } }, "CIK_MISMATCH"],
    [{ later: { registrants: [] } }, "REGISTRANT_NOT_SINGLE_LINKED"],
    [{ later: { reported_date: "2024-12-31" } }, "REPORTED_DATE_MISMATCH"],
    [{ later: { instruments: [{ id: 1, state: "UNRESOLVED", instrument_id: null }] } }, "INSTRUMENT_NOT_MATCHED"],
    [{ later: { types: [] } }, "TYPE_NOT_SINGLE_REPORTED"],
    [{ earlier: { continuity: [{ id: 2, state: "MATCHED", method: PRIOR_CONTINUITY_METHOD, position_id: TEST_OTHER_POSITION,
      position_registrant_id: TEST_REGISTRANT, run_id: 49, supersedes_id: null }] } }, "TARGET_SERIES_MISMATCH"],
    [{ later: { continuity: [{ id: 2, state: "MATCHED", method: PRIOR_CONTINUITY_METHOD, position_id: TEST_OTHER_POSITION,
      position_registrant_id: TEST_REGISTRANT, run_id: 49, supersedes_id: null }] } }, "PRIOR_DECISION_MISMATCH"],
    [{ later: { continuity: [{ id: 1, state: "MATCHED", method: PRIOR_CONTINUITY_METHOD, position_id: TEST_OTHER_POSITION,
      position_registrant_id: TEST_REGISTRANT, run_id: 48, supersedes_id: null }] } }, "PRIOR_RUN_MISMATCH"],
    [{ laterSeries: [
      { position_observation_id: entry.laterObservationId, reported_date: entry.laterReportedDate },
      { position_observation_id: 558, reported_date: "2024-12-31" },
    ] }, "PRIOR_SERIES_HAS_OTHER_MEMBERS"],
    [{ later: null }, "OBSERVATION_MISSING"],
  ];
  for (const [override, code] of cases) {
    const facts = override.later === null ? { ...factsFor(entry), later: null } : factsFor(entry, override);
    const result = evaluatePair(entry, facts);
    assert.equal(result.status, PAIR_STATUS.BLOCKED, code);
    assert.ok(codes(result).includes(code), `${code}: ${codes(result)}`);
  }
});

test("the command refuses a hosted database unless --allow-hosted is given", () => {
  const previous = process.env.PIPELINE_DATABASE_URL;
  process.env.PIPELINE_DATABASE_URL = "postgres://example.invalid/bdc";
  try {
    assert.throws(() => supersedeApprovedContinuity({ database: "bdc_local", dryRun: true, log() {} }), /refuses a hosted database/);
    assert.throws(() => supersedeApprovedContinuity({ database: "bdc_local", log() {} }), /refuses a hosted database/);
    assert.doesNotThrow(() => assertSupersessionDatabase("bdc_local", { allowHosted: true }));
  } finally {
    if (previous == null) delete process.env.PIPELINE_DATABASE_URL;
    else process.env.PIPELINE_DATABASE_URL = previous;
  }
  const saved = process.env.PIPELINE_DATABASE_URL;
  delete process.env.PIPELINE_DATABASE_URL;
  try {
    assert.throws(() => assertSupersessionDatabase("other_db"), /refuses a database other than the local database/);
  } finally {
    if (saved != null) process.env.PIPELINE_DATABASE_URL = saved;
  }
});

test("the rule is catalogued and the P7 rule versions are unchanged", () => {
  const rule = RULES.find((r) => r.code === SUPERSESSION_RULE_CODE && r.version === SUPERSESSION_RULE_VERSION);
  assert.ok(rule);
  assert.equal(rule.kind, "RESOLUTION");
  assert.match(rule.spec, /METHODOLOGY\.md 7\.8/);
  for (const r of SUPERSESSION_RULES) assert.ok(RULES.some((x) => x.code === r.code && x.version === r.version));
  assert.equal(RULES.find((r) => r.code === "norm.instrument_type_footnote_ref").version, "1");
  assert.equal(RULES.find((r) => r.code === "resolution.position_same_registrant_and_instrument").version, "2");
  for (const r of RULES.filter((x) => x.code.startsWith("resolution.instrument_") || x.code.startsWith("resolution.position_same")
    || x.code.startsWith("resolution.position_unresolved") || x.code === "norm.instrument_type_footnote_ref")) {
    assert.equal(r.files.some((f) => f.includes("continuity-supersession") || f.includes("supersede-approved")), false);
  }
});
