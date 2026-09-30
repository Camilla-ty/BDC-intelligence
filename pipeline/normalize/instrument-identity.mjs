// P7-min instrument identity and per-registrant continuity (G-13, G-14, G-15).
// MATCHED requires exact identifier text plus a disclosed Investment Type Axis member.
// Missing type is UNKNOWN/UNRESOLVED. Continuity is registrant × MATCHED instrument only.
// Gaps are dates with no observation, never a zero amount.

export const INSTRUMENT_MATCH_METHOD = "EXACT_IDENTIFIER_AND_TYPE";
export const INSTRUMENT_UNRESOLVED_METHOD = "UNKNOWN_INSTRUMENT_ATTRIBUTES";
export const CONTINUITY_MATCH_METHOD = "SAME_REGISTRANT_AND_INSTRUMENT";
export const CONTINUITY_UNRESOLVED_INSTRUMENT_METHOD = "UNRESOLVED_INSTRUMENT";
export const CONTINUITY_UNRESOLVED_REGISTRANT_METHOD = "UNRESOLVED_REGISTRANT";

export function canMatchInstrument({ identifierNorm, typeState, typeText }) {
  return typeof identifierNorm === "string" && identifierNorm !== ""
    && typeState === "REPORTED"
    && typeof typeText === "string" && typeText !== "";
}

export function instrumentKey(identifierNorm, typeText) {
  if (!canMatchInstrument({ identifierNorm, typeState: "REPORTED", typeText })) {
    throw new Error("instrumentKey requires a MATCHED identifier and disclosed type");
  }
  return `${identifierNorm}\u0000${typeText}`;
}

export function lastDayOfMonth(year, monthIndex0) {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

export function addMonthsMonthEnd(isoDate, months) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) throw new Error(`not an ISO date: ${isoDate}`);
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const total = year * 12 + (month - 1) + months;
  const y = Math.floor(total / 12);
  const m0 = total % 12;
  const day = lastDayOfMonth(y, m0);
  return `${String(y).padStart(4, "0")}-${String(m0 + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function expectedQuarterEnds(minIso, maxIso) {
  if (minIso > maxIso) throw new Error("expectedQuarterEnds requires min <= max");
  const out = [];
  let cur = minIso;
  while (cur <= maxIso) {
    out.push(cur);
    const next = addMonthsMonthEnd(cur, 3);
    if (next <= cur) throw new Error("quarter step did not advance");
    cur = next;
  }
  return out;
}

export function continuityGaps(observedIsoDates) {
  const observed = [...new Set((observedIsoDates ?? []).filter((d) => d != null && d !== ""))].sort();
  if (observed.length === 0) return { observed: [], expected: [], missing: [] };
  const expected = expectedQuarterEnds(observed[0], observed[observed.length - 1]);
  const have = new Set(observed);
  return { observed, expected, missing: expected.filter((d) => !have.has(d)) };
}

export function observationCount(n) {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error("observationCount requires a non-negative integer");
  return n;
}
