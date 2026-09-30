// norm.instrument_type v1. The only documented instrument-type vocabulary is the disclosed
// Investment Type Axis member itself (SOURCE_SCHEMAS 5.1). Missing or empty members are
// UNKNOWN. This does not invent Debt/Equity/loan buckets, seniority, or other attributes.

export const INSTRUMENT_TYPE_RULE_CODE = "norm.instrument_type";
export const INSTRUMENT_TYPE_RULE_VERSION = "1";
export const INSTRUMENT_TYPE_COLUMN = "Investment Type Axis";

export function mapInstrumentType(disclosedMember) {
  if (disclosedMember == null) {
    return {
      valueState: "UNKNOWN",
      mappedText: null,
      reason: "no disclosed Investment Type Axis member",
    };
  }
  if (typeof disclosedMember !== "string") {
    throw new Error("instrument type disclosed member must be a string or null");
  }
  if (disclosedMember === "") {
    return {
      valueState: "UNKNOWN",
      mappedText: null,
      reason: "no disclosed Investment Type Axis member",
    };
  }
  return { valueState: "REPORTED", mappedText: disclosedMember, reason: null };
}
