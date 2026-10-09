// resolution.entity_exact_company_cell_name v2 (G-13, G-14, G-08).
// A legal entity is keyed only on a company name: the primary-filing company cell
// (FILING_CELL) or the SOI ISSUER_NAME field. The Investment Identifier Axis text
// combines company and instrument (Q5) and is never a legal-entity name or alias.
// No identifier splitting, near-name, suffix, fuzzy, or LLM match.
// v2 adds append-only supersession of NO_COMPANY_NAME_EVIDENCE when company-cell
// evidence arrives later and matches an existing VERIFIED alias (same match rules).

import { normalizeBorrowerName } from "./borrower-name.mjs";

export const COMPANY_CELL_RULE_CODE = "resolution.entity_exact_company_cell_name";
export const COMPANY_CELL_RULE_VERSION = "2";
export const COMPANY_CELL_METHOD = "EXACT_COMPANY_CELL_NAME";
export const NO_COMPANY_NAME_METHOD = "NO_COMPANY_NAME_EVIDENCE";
export const CONFLICTING_COMPANY_NAMES_METHOD = "CONFLICTING_COMPANY_NAMES";
export const AMBIGUOUS_COMPANY_NAME_METHOD = "AMBIGUOUS_COMPANY_NAME";
export const COMPANY_CELL_NAME_SOURCE = "FILING_CELL";

export const RATIONALE = Object.freeze({
  [COMPANY_CELL_METHOD]:
    "The primary-filing company cell or SOI ISSUER_NAME equals the legal-entity alias exactly after norm.borrower_name v1. The Identifier Axis text is not used as a legal-entity key (Q5).",
  [NO_COMPANY_NAME_METHOD]:
    "No primary-filing company cell or SOI ISSUER_NAME is stored for this observation. The Identifier Axis combines company and instrument text (Q5) and is not used as a legal-entity name.",
  [CONFLICTING_COMPANY_NAMES_METHOD]:
    "The company-name sources for this observation disagree after norm.borrower_name v1. No legal entity is chosen.",
  [AMBIGUOUS_COMPANY_NAME_METHOD]:
    "The company name equals the alias of more than one legal entity. No legal entity is chosen.",
});

// Company names for one observation, filing cells first. ISSUER_NAME raw text is
// normalized with norm.borrower_name v1, the same rule the filing-cell names carry.
export function companyNames(observation) {
  const names = [];
  for (const cell of observation.filingCells ?? []) {
    if (typeof cell.normalizedText === "string" && cell.normalizedText !== "") {
      names.push({ source: COMPANY_CELL_NAME_SOURCE, normalizedText: cell.normalizedText, evidenceId: cell.evidenceId });
    }
  }
  for (const issuer of observation.issuerNames ?? []) {
    if (typeof issuer.rawText !== "string") continue;
    const { extractionState, normalizedText } = normalizeBorrowerName(issuer.rawText);
    if (extractionState === "EXTRACTED") {
      names.push({ source: "ISSUER_NAME", normalizedText, evidenceId: issuer.evidenceId });
    }
  }
  return names;
}

function unresolved(observation, method, evidenceId) {
  return {
    positionObservationId: observation.id,
    state: "UNRESOLVED",
    method,
    companyName: null,
    legalEntityId: null,
    newEntityAlias: null,
    evidenceId,
    rationale: RATIONALE[method],
  };
}

// observations: [{ id, filingCells: [{ normalizedText, evidenceId }], issuerNames: [{ rawText, evidenceId }] }]
// existingAliases: [{ aliasText, legalEntityId }] written by this rule.
// A NO_COMPANY_NAME_EVIDENCE decision has evidenceId null; the writer cites the identifier name row.
export function planCompanyCellEntities(observations, existingAliases = []) {
  const entitiesByAlias = new Map();
  for (const alias of existingAliases) {
    if (!entitiesByAlias.has(alias.aliasText)) entitiesByAlias.set(alias.aliasText, new Set());
    entitiesByAlias.get(alias.aliasText).add(alias.legalEntityId);
  }
  const decisions = [];
  const newEntities = new Map();
  for (const observation of [...observations].sort((left, right) => left.id - right.id)) {
    const names = companyNames(observation);
    const distinct = [...new Set(names.map((name) => name.normalizedText))];
    if (distinct.length === 0) {
      decisions.push(unresolved(observation, NO_COMPANY_NAME_METHOD, null));
      continue;
    }
    if (distinct.length > 1) {
      decisions.push(unresolved(observation, CONFLICTING_COMPANY_NAMES_METHOD, names[0].evidenceId));
      continue;
    }
    const companyName = distinct[0];
    const evidenceId = names[0].evidenceId;
    const existing = [...(entitiesByAlias.get(companyName) ?? [])];
    if (existing.length > 1) {
      decisions.push(unresolved(observation, AMBIGUOUS_COMPANY_NAME_METHOD, evidenceId));
      continue;
    }
    if (existing.length === 0 && !newEntities.has(companyName)) {
      newEntities.set(companyName, { aliasText: companyName, evidenceId });
    }
    decisions.push({
      positionObservationId: observation.id,
      state: "MATCHED",
      method: COMPANY_CELL_METHOD,
      companyName,
      legalEntityId: existing.length === 1 ? existing[0] : null,
      newEntityAlias: existing.length === 1 ? null : companyName,
      evidenceId,
      rationale: RATIONALE[COMPANY_CELL_METHOD],
    });
  }
  return { decisions, newEntities: [...newEntities.values()] };
}
