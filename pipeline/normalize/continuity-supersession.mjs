// resolution.position_approved_continuity_supersession v1. An explicit historical correction for an
// approved, audited allowlist of same-BDC continuity pairs. It is not P7 resolution: it never runs
// from the P7 writer, never chooses pairs, and never changes instrument decisions or positions.
// Every pinned fact must equal the stored fact, or the pair is BLOCKED (fail closed).

export const SUPERSESSION_RULE_CODE = "resolution.position_approved_continuity_supersession";
export const SUPERSESSION_RULE_VERSION = "1";
export const SUPERSESSION_METHOD = "APPROVED_SUPERSESSION_SAME_REGISTRANT_IDENTIFIER_AND_FOOTNOTE_VERIFIED_TYPE";
export const PRIOR_CONTINUITY_METHOD = "SAME_REGISTRANT_AND_INSTRUMENT";
export const SUPERSESSION_DECIDED_BY = "pipeline continuity-supersession";
export const SUPERSESSION_RUN_KIND = "APPROVED_CONTINUITY_SUPERSESSION";

export const PAIR_STATUS = Object.freeze({
  PLANNED: "PLANNED",
  ALREADY_APPLIED: "ALREADY_APPLIED",
  BLOCKED: "BLOCKED",
});

// The three pairs approved after the read-only evidence audit of 2026-10-07 (docs/METHODOLOGY.md 7.8).
// Run 49 decided each later observation into its own position because the raw types differ only in
// verified trailing footnote markers.
export const APPROVED_CONTINUITY_SUPERSESSIONS = Object.freeze([
  Object.freeze({
    laterObservationId: 893583,
    earlierObservationId: 981407,
    identifier: "Geo Parent Corporation, First Lien 1",
    cik: 1925531,
    laterReportedDate: "2024-09-30",
    earlierReportedDate: "2024-06-30",
    priorDecisionId: 1,
    priorRunId: 49,
    targetPositionId: "4800a33c-eef6-47dc-a139-a038680ad3f5",
  }),
  Object.freeze({
    laterObservationId: 893584,
    earlierObservationId: 981408,
    identifier: "Geo Parent Corporation, First Lien 2",
    cik: 1925531,
    laterReportedDate: "2024-09-30",
    earlierReportedDate: "2024-06-30",
    priorDecisionId: 3,
    priorRunId: 49,
    targetPositionId: "f852d4f5-73b2-4082-8b23-78ee2ba5f443",
  }),
  Object.freeze({
    laterObservationId: 893587,
    earlierObservationId: 981411,
    identifier: "Geo Parent Corporation, First Lien",
    cik: 1766037,
    laterReportedDate: "2024-09-30",
    earlierReportedDate: "2024-06-30",
    priorDecisionId: 5,
    priorRunId: 49,
    targetPositionId: "d4b6ef3b-c03b-4615-8178-3ed688b0eb2d",
  }),
]);

// Observations this correction must never supersede or use as a target. 1146287, 1146289, and
// 1067074 are excluded by the approval. 893588, 981412, 1067071, 1146287, and 1067072 are the
// earlier Guardian IV "Geo Parent Corporation, First Lien" series ending 2024-03-31, which has no
// evidence linking it to First Lien 1 or First Lien 2.
export const PROTECTED_OBSERVATION_IDS = Object.freeze([
  1146287, 1146289, 1067074, 893588, 981412, 1067071, 1067072,
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function positiveInt(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
}

// Structural checks only. Stored facts are checked by evaluatePair.
export function validateAllowlist(allowlist) {
  if (!Array.isArray(allowlist) || allowlist.length === 0) throw new Error("allowlist must be a non-empty array");
  const seen = new Set();
  for (const entry of allowlist) {
    positiveInt(entry?.laterObservationId, "laterObservationId");
    positiveInt(entry.earlierObservationId, "earlierObservationId");
    positiveInt(entry.cik, "cik");
    positiveInt(entry.priorDecisionId, "priorDecisionId");
    positiveInt(entry.priorRunId, "priorRunId");
    if (typeof entry.identifier !== "string" || entry.identifier === "") throw new Error("identifier must be non-empty text");
    if (!DATE.test(entry.laterReportedDate ?? "") || !DATE.test(entry.earlierReportedDate ?? "")) {
      throw new Error("reported dates must be YYYY-MM-DD");
    }
    if (!(entry.earlierReportedDate < entry.laterReportedDate)) throw new Error("earlier date must precede later date");
    if (!UUID.test(entry.targetPositionId ?? "")) throw new Error("targetPositionId must be a uuid");
    for (const id of [entry.laterObservationId, entry.earlierObservationId]) {
      if (PROTECTED_OBSERVATION_IDS.includes(id)) throw new Error(`observation ${id} is protected and cannot be superseded or linked`);
      if (seen.has(id)) throw new Error(`observation ${id} appears in more than one allowlist entry`);
      seen.add(id);
    }
  }
  return allowlist;
}

function single(rows) {
  return Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
}

function sameText(rows, text) {
  return Array.isArray(rows) && rows.length > 0 && rows.every((row) => row.raw_text === text && row.normalized_text === text);
}

// facts: { later, earlier, laterSeries, targetSeries, sameKey } loaded read-only from the database.
//   later / earlier: { id, reported_date, holding_descriptor_raw, evidence_id, registrants: [{registrant_id, cik}],
//     names: [{id, raw_text, normalized_text, evidence_id}], types: [{id, value_state, raw_value, evidence_id}],
//     type_ref, instruments: [{id, state, instrument_id}], continuity: [{id, state, method, position_id,
//     position_registrant_id, run_id, supersedes_id}] }
//   laterSeries / targetSeries: current MATCHED members [{position_observation_id, reported_date}]
//   sameKey: observations of the same registrant and exact identifier [{id, reported_date}]
export function evaluatePair(entry, facts) {
  const blocking = [];
  const block = (code, detail) => blocking.push({ code, detail });
  const { later, earlier } = facts;
  const result = { entry, status: PAIR_STATUS.BLOCKED, blocking };
  if (!later || !earlier) {
    block("OBSERVATION_MISSING", "both observations must exist");
    return result;
  }

  for (const [side, row, date] of [["later", later, entry.laterReportedDate], ["earlier", earlier, entry.earlierReportedDate]]) {
    if (row.reported_date !== date) block("REPORTED_DATE_MISMATCH", `${side} reported_date ${row.reported_date} is not ${date}`);
    if (row.holding_descriptor_raw !== entry.identifier || !sameText(row.names, entry.identifier)) {
      block("IDENTIFIER_MISMATCH", `${side} identifier is not exactly ${JSON.stringify(entry.identifier)}`);
    }
    const reg = single(row.registrants);
    if (!reg) block("REGISTRANT_NOT_SINGLE_LINKED", `${side} filing does not have exactly one LINKED registrant`);
    else if (Number(reg.cik) !== entry.cik) block("CIK_MISMATCH", `${side} registrant CIK ${reg.cik} is not ${entry.cik}`);
    const type = single(row.types);
    if (!type || type.value_state !== "REPORTED") block("TYPE_NOT_SINGLE_REPORTED", `${side} has no single REPORTED INSTRUMENT_TYPE`);
    if (row.type_ref?.state !== "VERIFIED") {
      block("TYPE_NOT_FOOTNOTE_VERIFIED", `${side} type is ${row.type_ref?.state ?? "missing"} (${row.type_ref?.reason ?? "no reason"})`);
    }
    const instrument = single(row.instruments);
    if (!instrument || instrument.state !== "MATCHED" || !instrument.instrument_id) {
      block("INSTRUMENT_NOT_MATCHED", `${side} has no single current MATCHED instrument decision`);
    }
  }
  const laterReg = single(later.registrants);
  const earlierReg = single(earlier.registrants);
  if (laterReg && earlierReg && Number(laterReg.registrant_id) !== Number(earlierReg.registrant_id)) {
    block("REGISTRANT_MISMATCH", "observations are filed by different registrants");
  }
  if (later.type_ref?.state === "VERIFIED" && earlier.type_ref?.state === "VERIFIED"
    && later.type_ref.normalizedText !== earlier.type_ref.normalizedText) {
    block("CONTINUITY_TYPE_MISMATCH", "footnote-verified type texts differ");
  }

  const target = single(earlier.continuity);
  if (!target || target.state !== "MATCHED" || target.position_id !== entry.targetPositionId) {
    block("TARGET_SERIES_MISMATCH", `earlier observation is not currently MATCHED to position ${entry.targetPositionId}`);
  } else if (earlierReg && Number(target.position_registrant_id) !== Number(earlierReg.registrant_id)) {
    block("TARGET_REGISTRANT_MISMATCH", "target position belongs to another registrant");
  }

  const current = single(later.continuity);
  if (!current) {
    block("PRIOR_DECISION_MISMATCH", "later observation has no single current continuity decision");
    return result;
  }
  if (current.method === SUPERSESSION_METHOD && current.state === "MATCHED"
    && Number(current.supersedes_id) === entry.priorDecisionId && current.position_id === entry.targetPositionId) {
    if (blocking.length === 0) result.status = PAIR_STATUS.ALREADY_APPLIED;
    result.currentDecisionId = Number(current.id);
    return result;
  }
  if (Number(current.id) !== entry.priorDecisionId) {
    block("PRIOR_DECISION_MISMATCH", `current continuity decision ${current.id} is not ${entry.priorDecisionId}`);
  }
  if (current.state !== "MATCHED" || current.method !== PRIOR_CONTINUITY_METHOD) {
    block("PRIOR_DECISION_MISMATCH", `current continuity decision is ${current.state} ${current.method}`);
  }
  if (Number(current.run_id) !== entry.priorRunId) block("PRIOR_RUN_MISMATCH", `current continuity decision is from run ${current.run_id}`);
  if (current.position_id === entry.targetPositionId) block("ALREADY_IN_TARGET_SERIES", "later observation is already in the target position");

  const laterMembers = facts.laterSeries ?? [];
  if (laterMembers.length !== 1 || Number(laterMembers[0].position_observation_id) !== later.id) {
    block("PRIOR_SERIES_HAS_OTHER_MEMBERS", "the prior position of the later observation has other MATCHED members");
  }
  const targetMembers = facts.targetSeries ?? [];
  if (!targetMembers.some((row) => Number(row.position_observation_id) === earlier.id)) {
    block("TARGET_SERIES_MISMATCH", "earlier observation is not a member of the target position");
  }
  for (const row of targetMembers) {
    if (Number(row.position_observation_id) === earlier.id) continue;
    if (row.reported_date >= entry.earlierReportedDate) {
      block("TARGET_SERIES_NOT_ENDING_AT_EARLIER", `target position member ${row.position_observation_id} is dated ${row.reported_date}`);
    }
  }
  for (const row of facts.sameKey ?? []) {
    const id = Number(row.id);
    if (id === later.id || id === earlier.id) continue;
    if (row.reported_date > entry.earlierReportedDate && row.reported_date < entry.laterReportedDate) {
      block("INTERVENING_OBSERVATION", `observation ${id} is dated ${row.reported_date}`);
    } else if (row.reported_date === entry.earlierReportedDate || row.reported_date === entry.laterReportedDate) {
      block("SAME_DATE_DUPLICATE", `observation ${id} shares date ${row.reported_date}`);
    }
  }

  if (blocking.length === 0) result.status = PAIR_STATUS.PLANNED;
  return result;
}

function markers(ref) {
  return ref.removedMarkers.map((m) => `(${m})`).join("");
}

// Evidence pairs recorded as match_candidate_comparison rows: [attribute, earlier evidence, later evidence].
export function supportingEvidence(facts) {
  const { later, earlier } = facts;
  return [
    ["REGISTRANT_OBSERVATION", Number(earlier.evidence_id), Number(later.evidence_id)],
    ["IDENTIFIER", Number(earlier.names[0].evidence_id), Number(later.names[0].evidence_id)],
    ["FOOTNOTE_VERIFIED_TYPE", Number(earlier.types[0].evidence_id), Number(later.types[0].evidence_id)],
  ];
}

export function supersessionDecision(entry, facts) {
  const { later, earlier } = facts;
  const prior = later.continuity[0];
  const reg = later.registrants[0];
  const evidence = supportingEvidence(facts);
  const laterInstrument = later.instruments[0].instrument_id;
  const earlierInstrument = earlier.instruments[0].instrument_id;
  const rationale = `Approved historical continuity correction (${SUPERSESSION_RULE_CODE} v${SUPERSESSION_RULE_VERSION}, docs/METHODOLOGY.md 7.8). `
    + `Observation ${later.id} (${entry.laterReportedDate}) joins the series of observation ${earlier.id} (${entry.earlierReportedDate}): `
    + `same LINKED registrant ${reg.registrant_id} (CIK ${entry.cik}), exact identifier ${JSON.stringify(entry.identifier)}, `
    + `and norm.instrument_type_footnote_ref v1 VERIFIED continuity type ${JSON.stringify(later.type_ref.normalizedText)} on both sides `
    + `(earlier raw ${JSON.stringify(earlier.type_ref.rawText)} removed ${markers(earlier.type_ref)} footnotes ${earlier.type_ref.footnoteIds.join(",")}; `
    + `later raw ${JSON.stringify(later.type_ref.rawText)} removed ${markers(later.type_ref)} footnotes ${later.type_ref.footnoteIds.join(",")}). `
    + `No other observation of this registrant and identifier is dated between or on the two dates. `
    + `Instrument decisions are unchanged; instruments ${earlierInstrument} and ${laterInstrument} stay as decided. `
    + `Terms outside the identity key, such as reference-rate reset frequency, are not compared. `
    + `Evidence (earlier/later): ${evidence.map(([code, left, right]) => `${code} ${left}/${right}`).join(", ")}.`;
  const reason = `Run ${prior.run_id} decision ${prior.id} (${PRIOR_CONTINUITY_METHOD}) keyed continuity on the raw instrument type and `
    + `placed observation ${later.id} in position ${prior.position_id}. The footnote-verified type equals that of observation ${earlier.id}, `
    + `so it joins position ${entry.targetPositionId}. Approved after a read-only evidence audit; decision ${prior.id} stays in history.`;
  return {
    position_observation_id: later.id,
    earlier_position_observation_id: earlier.id,
    prior_continuity_decision_id: Number(prior.id),
    prior_run_id: Number(prior.run_id),
    prior_method: prior.method,
    prior_position_id: prior.position_id,
    target_position_id: entry.targetPositionId,
    state: "MATCHED",
    method: SUPERSESSION_METHOD,
    registrant_id: Number(reg.registrant_id),
    cik: entry.cik,
    identifier: entry.identifier,
    later_reported_date: entry.laterReportedDate,
    earlier_reported_date: entry.earlierReportedDate,
    continuity_type: later.type_ref.normalizedText,
    later_raw_type: later.type_ref.rawText,
    earlier_raw_type: earlier.type_ref.rawText,
    later_footnote_ids: later.type_ref.footnoteIds,
    earlier_footnote_ids: earlier.type_ref.footnoteIds,
    later_instrument_id: laterInstrument,
    earlier_instrument_id: earlierInstrument,
    decision_evidence_id: Number(later.evidence_id),
    supporting_evidence: evidence.map(([attribute, left, right]) => ({
      attribute, earlier_evidence_id: left, later_evidence_id: right,
    })),
    supersede_reason: reason,
    rationale,
  };
}
