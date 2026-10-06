// Bind one position to a single iXBRL context row.
// A context matches only when its period end equals the position's reported date and
// every comparable stored field equals a tagged fact on that context. Identifier text is
// not used. A displayed maturity date is read after the context is bound. A two-digit
// year is kept as raw text and is not normalized.

import { normalizeDisclosedDate } from "./date-heading.mjs";
import { listIxContextRows } from "./ix-context-row.mjs";

const CONCEPT_FIELD = {
  InvestmentInterestRate: "INTEREST_RATE",
  InvestmentBasisSpreadVariableRate: "SPREAD",
  InvestmentInterestRateFloor: "INTEREST_RATE_FLOOR",
  InvestmentOwnedBalancePrincipalAmount: "PRINCIPAL_AMOUNT",
  InvestmentOwnedAtCost: "COST",
  InvestmentOwnedAtFairValue: "FAIR_VALUE",
  InvestmentOwnedPercentOfNetAssets: "PERCENT_OF_NET_ASSETS",
  InvestmentAcquisitionDate: "ACQUISITION_DATE",
};

const MONETARY = new Set(["PRINCIPAL_AMOUNT", "COST", "FAIR_VALUE"]);
const MATURITY_CONCEPT = "InvestmentMaturityDate";
const FOUR_DIGIT_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// Transformation Registry 4 fixed-zero. Only the em dash display is read as zero here.
const FIXED_ZERO = "ixt:fixed-zero";
const EM_DASH = "\u2014";

function localName(name) {
  if (typeof name !== "string" || name === "") return null;
  const cut = name.lastIndexOf(":");
  return cut >= 0 ? name.slice(cut + 1) : name;
}

function parseDecimal(text) {
  if (typeof text !== "string") return null;
  let source = text.trim().replace(/,/g, "").replace(/\s/g, "");
  let sign = 1n;
  if (source.startsWith("(") && source.endsWith(")")) {
    sign = -1n;
    source = source.slice(1, -1);
  }
  if (source.startsWith("-")) {
    sign = -1n;
    source = source.slice(1);
  }
  if (!/^\d+(\.\d+)?$/.test(source)) return null;
  const [whole, fraction = ""] = source.split(".");
  return { mantissa: BigInt(whole + fraction) * sign, exponent: -fraction.length };
}

function withScale(parsed, scale, signAttr) {
  const extra = Number(scale ?? "0");
  if (!Number.isInteger(extra)) return null;
  let mantissa = parsed.mantissa;
  if (signAttr === "-") mantissa = -mantissa;
  return { mantissa, exponent: parsed.exponent + extra };
}

function sameDecimal(left, right) {
  let leftMantissa = left.mantissa;
  let rightMantissa = right.mantissa;
  const shift = left.exponent - right.exponent;
  if (shift > 0) leftMantissa *= 10n ** BigInt(shift);
  if (shift < 0) rightMantissa *= 10n ** BigInt(-shift);
  return leftMantissa === rightMantissa;
}

function fieldAmount(field) {
  if (field.field_code === "ACQUISITION_DATE") return null;
  const source = MONETARY.has(field.field_code) ? field.normalized_numeric : field.raw_value;
  return parseDecimal(source == null ? "" : String(source));
}

function factAmount(fact) {
  if (fact.format === FIXED_ZERO) {
    return fact.text === EM_DASH ? { mantissa: 0n, exponent: 0 } : null;
  }
  const parsed = parseDecimal(fact.text);
  if (!parsed) return null;
  return withScale(parsed, fact.scale, fact.sign);
}

export function normalizeDisplayedDate(raw) {
  if (typeof raw !== "string" || !FOUR_DIGIT_DATE.test(raw)) return null;
  const match = FOUR_DIGIT_DATE.exec(raw);
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function contextMatches(facts, fields) {
  for (const field of fields) {
    const conceptFacts = facts.filter((fact) => CONCEPT_FIELD[localName(fact.name)] === field.field_code);
    if (conceptFacts.length === 0) return false;
    if (field.field_code === "ACQUISITION_DATE") {
      if (!conceptFacts.every((fact) => fact.text === String(field.raw_value).trim())) return false;
      continue;
    }
    const expected = fieldAmount(field);
    if (!expected) return false;
    const amounts = conceptFacts.map(factAmount);
    if (amounts.some((amount) => amount == null || !sameDecimal(amount, expected))) return false;
  }
  return true;
}

function placedCandidates(placements) {
  return placements.map((placement) => ({
    raw: placement.raw,
    normalized: normalizeDisplayedDate(placement.raw),
    factId: null,
  }));
}

function textCandidates(raws, normalizedFor) {
  return raws.map((raw) => ({
    raw,
    normalized: normalizedFor(raw),
    factId: null,
  }));
}

// An Acquisition Date is not a maturity. This applies only when the table has no
// Maturity column. A date that also sits outside that column is kept. When
// acquisitionColumn is null, the full-row fallback is unchanged.
function withoutAcquisitionColumn(row, raws) {
  if (typeof row.acquisitionColumn !== "number") return raws;
  const atAcquisition = new Set();
  const elsewhere = new Set();
  for (const placement of row.datePlacements ?? []) {
    if (placement.startColumn === row.acquisitionColumn) atAcquisition.add(placement.raw);
    else elsewhere.add(placement.raw);
  }
  return raws.filter((raw) => !atAcquisition.has(raw) || elsewhere.has(raw));
}

function maturityCandidates(row) {
  const tagged = row.facts.filter((fact) => localName(fact.name) === MATURITY_CONCEPT);
  if (tagged.length > 0) {
    const byText = new Map();
    for (const fact of tagged) {
      if (!byText.has(fact.text)) byText.set(fact.text, fact.id);
    }
    return {
      monthSelectable: true,
      candidates: [...byText.entries()].map(([raw, factId]) => ({
        raw,
        normalized: normalizeDisplayedDate(raw),
        factId,
      })),
    };
  }
  if (typeof row.maturityColumn === "number") {
    const inColumn = (row.datePlacements ?? []).filter((placement) => placement.startColumn === row.maturityColumn);
    const fullDates = inColumn.filter((placement) => FOUR_DIGIT_DATE.test(placement.raw));
    return {
      monthSelectable: true,
      candidates: placedCandidates(fullDates.length > 0 ? fullDates : inColumn),
    };
  }
  if (row.untaggedDates.length > 0) {
    return {
      monthSelectable: false,
      candidates: textCandidates(withoutAcquisitionColumn(row, row.untaggedDates), normalizeDisplayedDate),
    };
  }
  return {
    monthSelectable: false,
    candidates: textCandidates(withoutAcquisitionColumn(row, row.untaggedMonthYears ?? []), () => null),
  };
}

// A month/year is selected only from a maturity column or a tagged maturity fact.
// An untagged month with no maturity header stays an unresolved candidate.
function outcomeFromCandidates(candidates, monthSelectable) {
  if (candidates.length === 0) {
    return { outcome: "UNAVAILABLE", rawValue: null, normalizedDate: null, displayedYear: null, displayedMonth: null, candidates: [] };
  }
  if (candidates.length === 1 && candidates[0].normalized) {
    return {
      outcome: "FILING_DISPLAYED",
      rawValue: candidates[0].raw,
      normalizedDate: candidates[0].normalized,
      displayedYear: null,
      displayedMonth: null,
      candidates: [],
    };
  }
  if (candidates.length === 1 && monthSelectable) {
    const month = normalizeDisclosedDate(candidates[0].raw);
    if (month.accepted && month.precision === "MONTH" && month.year >= 1000 && month.year <= 9999) {
      return {
        outcome: "FILING_MONTH",
        rawValue: candidates[0].raw,
        normalizedDate: null,
        displayedYear: month.year,
        displayedMonth: month.month,
        candidates: [],
      };
    }
  }
  return { outcome: "UNRESOLVED", rawValue: null, normalizedDate: null, displayedYear: null, displayedMonth: null, candidates };
}

// The SOI reported date (ddate) is documented as rounded to month end; the context period
// end is the filing's exact date. They are compared as equal yyyy-mm-dd strings with no
// rounding, so a filing whose period does not end on a month end binds nothing.
function periodMatches(row, reportedDate) {
  return row.contextPeriodEnds?.[0] === reportedDate;
}

// Stable codes for an UNKNOWN bind; the loader stores them as ref.maturity_no_bind_reason.
export const NO_BIND_REASON = Object.freeze({
  NO_REPORTED_DATE: "NO_REPORTED_DATE",
  NO_COMPARABLE_FIELD: "NO_COMPARABLE_FIELD",
  NO_MATCH: "NO_MATCH",
  MULTIPLE_ROWS: "MULTIPLE_ROWS",
  CONTEXT_NOT_SINGLE_ROW: "CONTEXT_NOT_SINGLE_ROW",
  SHARED_ROW: "SHARED_ROW",
});

function noBind(noBindReason, reason, extra = {}) {
  return { outcome: "UNKNOWN", contextId: null, facts: [], reason, noBindReason, ...extra };
}

export function bindMaturityContextRows(rows, fields, reportedDate) {
  if (typeof reportedDate !== "string" || !ISO_DATE.test(reportedDate)) {
    return noBind(NO_BIND_REASON.NO_REPORTED_DATE, "position has no reported date");
  }
  const comparable = fields.filter((field) => Object.values(CONCEPT_FIELD).includes(field.field_code));
  if (comparable.length === 0) {
    return noBind(NO_BIND_REASON.NO_COMPARABLE_FIELD, "no comparable tagged field");
  }
  const matches = rows.filter((row) => row.contextIds.length === 1
    && periodMatches(row, reportedDate)
    && contextMatches(row.facts, comparable));
  if (matches.length !== 1) {
    const contextIds = matches.map((row) => row.contextIds[0]);
    return matches.length === 0
      ? noBind(NO_BIND_REASON.NO_MATCH, "no context matched every comparable field", { contextIds })
      : noBind(NO_BIND_REASON.MULTIPLE_ROWS, "more than one context matched", { contextIds });
  }
  const contextId = matches[0].contextIds[0];
  const sameContext = rows.filter((row) => row.facts.some((fact) => fact.contextRef === contextId));
  if (sameContext.length !== 1) {
    return noBind(NO_BIND_REASON.CONTEXT_NOT_SINGLE_ROW, "context is not a single rendered row");
  }
  const facts = matches[0].facts.filter((fact) => fact.contextRef === contextId);
  const evidenceFacts = facts.filter((fact) => {
    const name = localName(fact.name);
    return CONCEPT_FIELD[name] || name === MATURITY_CONCEPT;
  });
  const selected = maturityCandidates(matches[0]);
  const dated = outcomeFromCandidates(selected.candidates, selected.monthSelectable);
  return {
    outcome: dated.outcome,
    contextId,
    facts: evidenceFacts,
    rawValue: dated.rawValue,
    normalizedDate: dated.normalizedDate,
    displayedYear: dated.displayedYear,
    displayedMonth: dated.displayedMonth,
    candidates: dated.candidates,
    reason: null,
  };
}

export function bindMaturityContext(html, fields, reportedDate) {
  return bindMaturityContextRows(listIxContextRows(html), fields, reportedDate);
}

// One rendered context cannot be assigned to two positions. Each of those
// positions stays UNKNOWN and no date from that row is selected.
export function rejectSharedContextBinds(binds) {
  const counts = new Map();
  for (const bind of binds) {
    if (!bind.contextId || bind.outcome === "UNKNOWN") continue;
    counts.set(bind.contextId, (counts.get(bind.contextId) ?? 0) + 1);
  }
  return binds.map((bind) => {
    if (!bind.contextId || (counts.get(bind.contextId) ?? 0) < 2) return bind;
    return noBind(NO_BIND_REASON.SHARED_ROW, "context matched more than one position", {
      rawValue: null,
      normalizedDate: null,
      candidates: [],
    });
  });
}
