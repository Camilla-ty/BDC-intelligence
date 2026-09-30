// P6-min legal-entity name match (G-13, G-14, G-08).
// MATCHED uses exact equality of norm.borrower_name v1 text only.
// Near-name is a candidate generator: corporate-suffix / Holdco token difference
// after NFC, never MATCHED, never an LLM or similarity score.

export const EXACT_METHOD = "EXACT_NORMALIZED_NAME";
export const NEAR_NAME_METHOD = "NEAR_NAME_CANDIDATE";

export const NEAR_NAME_SUFFIX_TOKENS = Object.freeze([
  "INC", "INCORPORATED", "LLC", "LTD", "CORP", "CORPORATION",
  "HOLDINGS", "HOLDCO", "LP", "LLP", "CO", "COMPANY",
]);

const SUFFIX = new Set(NEAR_NAME_SUFFIX_TOKENS);

export function nameTokens(text) {
  if (typeof text !== "string") throw new Error("nameTokens requires a string");
  return text
    .normalize("NFC")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

export function coreTokens(text) {
  return nameTokens(text).filter((t) => !SUFFIX.has(t));
}

export function isExactNormalizedName(left, right) {
  return typeof left === "string" && typeof right === "string" && left !== "" && left === right;
}

export function isNearNameCandidate(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  if (left === "" || right === "" || left === right) return false;
  const coreLeft = coreTokens(left);
  const coreRight = coreTokens(right);
  if (coreLeft.length === 0 || coreRight.length === 0) return false;
  if (coreLeft.join(" ") !== coreRight.join(" ")) return false;
  const suffixLeft = nameTokens(left).filter((t) => SUFFIX.has(t)).join(" ");
  const suffixRight = nameTokens(right).filter((t) => SUFFIX.has(t)).join(" ");
  return suffixLeft !== suffixRight;
}
