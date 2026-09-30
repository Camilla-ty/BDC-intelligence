// norm.borrower_name v1 (G-11). Deterministic presentation normalize only.
// Raw disclosed text is stored unchanged. Normalized text is NFC + btrim of ASCII space.
// No case-folding, internal-whitespace collapse, punctuation rewrite, legal-suffix list,
// name/descriptor split (Q5), fuzzy match, or LLM.

export const BORROWER_NAME_RULE_CODE = "norm.borrower_name";
export const BORROWER_NAME_RULE_VERSION = "1";
export const IDENTIFIER_COLUMN = "Investment, Identifier Axis";

export function normalizeBorrowerName(raw) {
  if (typeof raw !== "string") throw new Error("borrower name raw text must be a string");
  const normalized = raw.normalize("NFC").replace(/^ +| +$/g, "");
  if (normalized === "") {
    return { extractionState: "UNRESOLVED", normalizedText: null };
  }
  return { extractionState: "EXTRACTED", normalizedText: normalized };
}
