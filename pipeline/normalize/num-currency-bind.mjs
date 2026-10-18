// Fail-closed currency binding for SOI monetary field values from NUM facts.
// Join basis is OBSERVED_UNDOCUMENTED (SOURCE_SCHEMAS 5.4): accession/filing, reported
// date, identifier member, expected tag, and numeric value. Currency is never inferred
// from issuer identity, amount size, or filing-level defaults. No FX conversion.

export const MONETARY_FIELD_CODES = Object.freeze(["PRINCIPAL_AMOUNT", "COST", "FAIR_VALUE"]);

export const FIELD_NUM_TAGS = Object.freeze({
  PRINCIPAL_AMOUNT: Object.freeze(["InvestmentOwnedBalancePrincipalAmount"]),
  COST: Object.freeze(["InvestmentOwnedAtCost"]),
  FAIR_VALUE: Object.freeze(["InvestmentOwnedAtFairValue"]),
});

export const BIND_JOIN_BASIS = "OBSERVED_UNDOCUMENTED";

export const SUPERSEDE_REASON_UNIQUE_MATCH =
  "NUM unique currency match on filing, reported date, identifier member, expected tag, and equal value (SOURCE_SCHEMAS 5.4; OBSERVED_UNDOCUMENTED)";

/** ISO 4217 alphabetic codes are three uppercase letters. Reject non-currency uom. */
export function isoCurrencyCode(uom) {
  if (typeof uom !== "string" || !/^[A-Z]{3}$/.test(uom)) return null;
  return uom;
}

export function expectedTagsForField(fieldCode) {
  return FIELD_NUM_TAGS[fieldCode] ?? [];
}

/**
 * Decide whether to promote currency for one current field-value head.
 *
 * @param {object} args
 * @param {{ id: number|string, field_code: string, normalized_numeric: string|number, currency_state: string }} args.fieldValue
 * @param {Array<{ id: number|string, tag: string, value_numeric: string|number, uom_raw: string }>} args.numFacts
 *   Candidates already restricted to the same filing, reported date, and identifier member.
 */
export function planCurrencyBind({ fieldValue, numFacts }) {
  if (!fieldValue || fieldValue.currency_state !== "UNKNOWN") {
    return { action: "skip", reason: "head_not_unknown" };
  }
  const tags = new Set(expectedTagsForField(fieldValue.field_code));
  if (tags.size === 0) return { action: "skip", reason: "field_not_in_scope" };

  const tagged = (numFacts ?? []).filter((n) => tags.has(n.tag));
  if (tagged.length === 0) return { action: "skip", reason: "zero_match" };

  const target = Number(fieldValue.normalized_numeric);
  if (!Number.isFinite(target)) return { action: "skip", reason: "non_numeric_field" };

  const valueMatches = tagged.filter((n) => Number(n.value_numeric) === target);
  if (valueMatches.length === 0) {
    if (tagged.length === 1) {
      return {
        action: "not_equal",
        numFactId: tagged[0].id,
        reason: "value_mismatch",
      };
    }
    return { action: "multiple", reason: "ambiguous_value_mismatch" };
  }

  const currencies = new Set();
  const byCurrency = new Map();
  for (const fact of valueMatches) {
    const code = isoCurrencyCode(fact.uom_raw);
    if (code == null) continue;
    currencies.add(code);
    if (!byCurrency.has(code)) byCurrency.set(code, fact);
  }

  if (currencies.size === 0) {
    return { action: "skip", reason: "non_currency_uom" };
  }
  if (currencies.size > 1) {
    return { action: "multiple", reason: "multiple_currencies" };
  }

  const currencyCode = [...currencies][0];
  const numFact = byCurrency.get(currencyCode);
  return {
    action: "promote",
    currencyCode,
    numFactId: numFact.id,
    reason: "unique_match",
  };
}
