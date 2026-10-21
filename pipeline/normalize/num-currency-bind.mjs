// Fail-closed currency binding for SOI monetary field values from NUM facts.
// Join basis is OBSERVED_UNDOCUMENTED (SOURCE_SCHEMAS 5.4): accession/filing, reported
// date, identifier member, expected tag, and numeric value. Currency is never inferred
// from issuer identity, amount size, or filing-level defaults. No FX conversion.
// Uniqueness is unique-fact (ADR 0022): exactly one eligible equal-value fact binds.

export const MONETARY_FIELD_CODES = Object.freeze(["PRINCIPAL_AMOUNT", "COST", "FAIR_VALUE"]);

export const FIELD_NUM_TAGS = Object.freeze({
  PRINCIPAL_AMOUNT: Object.freeze(["InvestmentOwnedBalancePrincipalAmount"]),
  COST: Object.freeze(["InvestmentOwnedAtCost"]),
  FAIR_VALUE: Object.freeze(["InvestmentOwnedAtFairValue"]),
});

export const BIND_JOIN_BASIS = "OBSERVED_UNDOCUMENTED";

export const SUPERSEDE_REASON_UNIQUE_MATCH =
  "NUM unique-fact currency match on filing, reported date, identifier member, expected tag, and equal value; no range or nonconsolidated-subsidiary dimension (SOURCE_SCHEMAS 5.4; OBSERVED_UNDOCUMENTED; ADR 0022)";

export const UNIQUENESS_POLICY = "unique-fact";

// SOI column labels (SOURCE_SCHEMAS 5.1). A non-empty cell excludes every monetary head of the row.
export const SOI_SUBSIDIARY_AXIS_LABEL = "Investment Company, Nonconsolidated Subsidiary Axis";
export const SOI_RANGE_AXIS_LABEL = "Range Axis";

export const EXCLUSION_REASONS = Object.freeze({
  SOI_SUBSIDIARY: "SOI_NONCONSOLIDATED_SUBSIDIARY_AXIS",
  SOI_RANGE: "SOI_RANGE_AXIS",
  NUM_DIMENSION: "NUM_PROHIBITED_DIMENSION",
});

// NUM segments are `;`-delimited `Axis=member` pairs; typed members are `Axis(version)=text`.
export const PROHIBITED_NUM_AXES = Object.freeze([
  "InvestmentCompanyNonconsolidatedSubsidiaryAxis",
  "RangeAxis",
]);

const AXIS_PATTERNS = PROHIBITED_NUM_AXES.map((axis) => [axis, new RegExp(`(?:^|;)${axis}[(=]`)]);

/** ISO 4217 alphabetic codes are three uppercase letters. Reject non-currency uom. */
export function isoCurrencyCode(uom) {
  if (typeof uom !== "string" || !/^[A-Z]{3}$/.test(uom)) return null;
  return uom;
}

export function expectedTagsForField(fieldCode) {
  return FIELD_NUM_TAGS[fieldCode] ?? [];
}

/** Prohibited axes named in a NUM segments string. Matches on any pair boundary, so it fails closed. */
export function prohibitedNumAxes(segments) {
  if (typeof segments !== "string" || segments === "") return [];
  return AXIS_PATTERNS.filter(([, re]) => re.test(segments)).map(([axis]) => axis);
}

function nonEmptyCell(value) {
  return typeof value === "string" && value !== "";
}

/**
 * Decide the currency action for one current field-value head.
 *
 * @param {object} args
 * @param {{ id: number|string, field_code: string, normalized_numeric: string|number, currency_state: string,
 *   soi_subsidiary_axis?: string|null, soi_range_axis?: string|null }} args.fieldValue
 *   The two SOI cells are the head's origin-row values for the subsidiary and range columns.
 * @param {Array<{ id: number|string, tag: string, value_numeric: string|number, uom_raw: string, segments_raw?: string|null }>} args.numFacts
 *   Candidates already restricted to the same filing, reported date, and identifier member.
 * @returns {{ action: "promote"|"not_equal"|"multiple"|"exclude"|"skip", reason: string,
 *   currencyCode?: string, numFactId?: number|string,
 *   soiExclusions?: string[], numExclusions: Array<{ numFactId: number|string, axis: string }> }}
 */
export function planCurrencyBind({ fieldValue, numFacts }) {
  if (!fieldValue || fieldValue.currency_state !== "UNKNOWN") {
    return { action: "skip", reason: "head_not_unknown", numExclusions: [] };
  }
  const tags = new Set(expectedTagsForField(fieldValue.field_code));
  if (tags.size === 0) return { action: "skip", reason: "field_not_in_scope", numExclusions: [] };

  const soiExclusions = [];
  if (nonEmptyCell(fieldValue.soi_subsidiary_axis)) soiExclusions.push(EXCLUSION_REASONS.SOI_SUBSIDIARY);
  if (nonEmptyCell(fieldValue.soi_range_axis)) soiExclusions.push(EXCLUSION_REASONS.SOI_RANGE);
  if (soiExclusions.length > 0) {
    return { action: "exclude", reason: "soi_dimension", soiExclusions, numExclusions: [] };
  }

  const target = Number(fieldValue.normalized_numeric);
  if (!Number.isFinite(target)) return { action: "skip", reason: "non_numeric_field", numExclusions: [] };

  const eligible = [];
  const numExclusions = [];
  for (const fact of numFacts ?? []) {
    if (!tags.has(fact.tag)) continue;
    const axes = prohibitedNumAxes(fact.segments_raw);
    if (axes.length === 0) eligible.push(fact);
    for (const axis of axes) numExclusions.push({ numFactId: fact.id, axis });
  }

  if (eligible.length === 0) {
    if (numExclusions.length > 0) return { action: "exclude", reason: "num_dimension", numExclusions };
    return { action: "skip", reason: "zero_match", numExclusions };
  }

  const valueMatches = eligible.filter((n) => Number(n.value_numeric) === target);
  if (valueMatches.length === 0) {
    if (eligible.length === 1) {
      return { action: "not_equal", numFactId: eligible[0].id, reason: "value_mismatch", numExclusions };
    }
    return { action: "multiple", reason: "ambiguous_value_mismatch", numExclusions };
  }
  if (valueMatches.length > 1) {
    const units = new Set(valueMatches.map((n) => n.uom_raw));
    const reason = units.size === 1 ? "multiple_equal_facts" : "multiple_units";
    return { action: "multiple", reason, numExclusions };
  }

  const [fact] = valueMatches;
  const currencyCode = isoCurrencyCode(fact.uom_raw);
  if (currencyCode == null) return { action: "skip", reason: "non_currency_uom", numExclusions };
  return { action: "promote", currencyCode, numFactId: fact.id, reason: "unique_fact", numExclusions };
}
