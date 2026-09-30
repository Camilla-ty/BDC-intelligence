// P9-min events (G-05, G-07, G-08, G-14, G-15).
// The only emitted event is the earliest reported_date observation for a LINKED
// filing registrant inside the supplied list. Instrument identity, amounts, COST,
// fair value, and coverage gaps are not inputs.

export const FIRST_OBSERVED_CODE = "REGISTRANT_FIRST_OBSERVED_NAME";
export const FIRST_OBSERVED_VERSION = "1";

const ALLOWED_KEYS = new Set([
  "position_observation_id",
  "reported_date",
  "evidence_id",
  "registrant_id",
  "registrant_link_status",
]);

export const EVENT_CATALOG = Object.freeze([
  {
    code: FIRST_OBSERVED_CODE,
    status: "SUPPORTED",
    reason: "Earliest reported_date among supplied observations for one LINKED filing registrant. Subject is the position observation. Instrument identity is not used.",
  },
  {
    code: "NEW_POSITION",
    status: "BLOCKED",
    reason: "Requires MATCHED instrument continuity. Golden instrument identity is UNRESOLVED because Investment Type Axis is not a disclosed member.",
  },
  {
    code: "EXPOSURE_INCREASE",
    status: "BLOCKED",
    reason: "Requires the same MATCHED instrument across dates and a documented comparable amount. Instrument identity is UNRESOLVED. COST and fair value are Q14 and are not inputs.",
  },
  {
    code: "EXPOSURE_DECREASE",
    status: "BLOCKED",
    reason: "Requires the same MATCHED instrument across dates and a documented comparable amount. Instrument identity is UNRESOLVED. COST and fair value are Q14 and are not inputs.",
  },
  {
    code: "MATURITY_CHANGE",
    status: "BLOCKED",
    reason: "MATURITY_DATE is not a REPORTED value on the Golden observations.",
  },
  {
    code: "VALUATION_MOVEMENT",
    status: "BLOCKED",
    reason: "Q14 COST and fair value stay OPEN_QUESTION and must not feed a derived event.",
  },
  {
    code: "NON_ACCRUAL",
    status: "BLOCKED",
    reason: "No REPORTED non-accrual value is stored for the Golden observations. The column mapping is OBSERVED_UNCONFIRMED.",
  },
  {
    code: "PIK",
    status: "BLOCKED",
    reason: "PIK_RATE is not REPORTED on the Golden observations. The column mapping is OBSERVED_UNCONFIRMED.",
  },
  {
    code: "NO_LONGER_REPORTED",
    status: "BLOCKED",
    reason: "A date with no observation is not observed. It is not an exit and not zero exposure.",
  },
  {
    code: "MATURITY_PROXIMITY",
    status: "BLOCKED",
    reason: "MATURITY_DATE is not a REPORTED value on the Golden observations.",
  },
  {
    code: "VALUATION_DISPERSION",
    status: "BLOCKED",
    reason: "Q14 fair value stays OPEN_QUESTION and must not feed a derived event.",
  },
  {
    code: "ECONOMIC_GROUP_MEMBERSHIP",
    status: "BLOCKED",
    reason: "Economic-group membership is not inferred from a shared name.",
  },
]);

function assertFact(fact) {
  if (fact == null || typeof fact !== "object" || Array.isArray(fact)) {
    throw new Error("observation event fact must be an object");
  }
  for (const key of Object.keys(fact)) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new Error(`observation event input is not allowed: ${key}`);
    }
  }
  const id = Number(fact.position_observation_id);
  const evidenceId = Number(fact.evidence_id);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("observation event requires a position_observation_id");
  if (!Number.isSafeInteger(evidenceId) || evidenceId < 1) throw new Error("observation event requires an evidence_id");
  if (typeof fact.reported_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fact.reported_date)) {
    throw new Error("observation event requires a reported_date");
  }
}

export function registrantFirstObservedEvents(facts) {
  if (!Array.isArray(facts)) throw new Error("observation events require an array of observations");
  const linked = [];
  let skippedUnlinked = 0;
  for (const fact of facts) {
    assertFact(fact);
    if (fact.registrant_link_status !== "LINKED" || fact.registrant_id == null) {
      skippedUnlinked += 1;
      continue;
    }
    const registrantId = Number(fact.registrant_id);
    if (!Number.isSafeInteger(registrantId) || registrantId < 1) {
      throw new Error("observation event registrant_id must be an integer when LINKED");
    }
    linked.push({
      position_observation_id: Number(fact.position_observation_id),
      reported_date: fact.reported_date,
      evidence_id: Number(fact.evidence_id),
      registrant_id: registrantId,
    });
  }

  const earliest = new Map();
  for (const fact of linked) {
    const prev = earliest.get(fact.registrant_id);
    if (prev == null || fact.reported_date < prev) earliest.set(fact.registrant_id, fact.reported_date);
  }

  const events = linked
    .filter((fact) => fact.reported_date === earliest.get(fact.registrant_id))
    .map((fact) => ({
      event_code: FIRST_OBSERVED_CODE,
      position_observation_id: fact.position_observation_id,
      reported_date: fact.reported_date,
      evidence_id: fact.evidence_id,
      registrant_id: fact.registrant_id,
    }))
    .sort((a, b) => a.position_observation_id - b.position_observation_id);

  return {
    events,
    skipped_unlinked: skippedUnlinked,
    distinct_registrants: earliest.size,
  };
}

export function supportedEventCodes() {
  return EVENT_CATALOG.filter((item) => item.status === "SUPPORTED").map((item) => item.code);
}

export function blockedEventCodes() {
  return EVENT_CATALOG.filter((item) => item.status === "BLOCKED").map((item) => item.code);
}
