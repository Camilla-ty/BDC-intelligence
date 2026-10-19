// Display model for current legal-entity external identifier tips.
// These are not filing-registrant CIKs and are not a second borrower key.

export const NO_EXTERNAL_IDENTIFIERS = "No external identifiers recorded.";
export const AMBIGUOUS_IDENTIFIER_LABEL = "Ambiguous";
export const AMBIGUOUS_IDENTIFIER_NOTE =
  "More than one current verified OWN value exists for this scheme. No value is selected.";
export const IDENTIFIER_SCOPE_NOTE =
  "External identifiers are stored assertions about this legal entity. They are not the filing registrant CIK.";

export type LegalEntityIdentifierRow = {
  legal_entity_id: string;
  scheme: string;
  relationship_role: string;
  raw_value: string;
  verification_state: string;
  evidence_id: string | null;
  researcher_citation_url: string | null;
  researcher_citation_title: string | null;
  researcher_citation_excerpt: string | null;
  ambiguous_verified_own: boolean;
};

export type LegalEntityIdentifierDisplay = {
  scheme: string;
  rawValue: string;
  relationshipRole: string;
  verificationState: string;
  ambiguous: boolean;
  citationUrl: string | null;
  citationTitle: string | null;
  citationExcerpt: string | null;
  evidenceId: string | null;
};

function optionalText(value: unknown, field: string): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new Error(`${field} is not text`);
  return value;
}

export function assertIdentifierFields(row: object): LegalEntityIdentifierRow {
  const item = row as Record<string, unknown>;
  if (typeof item.legal_entity_id !== "string" || typeof item.scheme !== "string") {
    throw new Error("identifier row is missing legal_entity_id or scheme");
  }
  if (typeof item.relationship_role !== "string" || typeof item.raw_value !== "string") {
    throw new Error("identifier row is missing relationship_role or raw_value");
  }
  if (typeof item.verification_state !== "string" || typeof item.ambiguous_verified_own !== "boolean") {
    throw new Error("identifier row is missing verification_state or ambiguity flag");
  }
  return {
    legal_entity_id: item.legal_entity_id,
    scheme: item.scheme,
    relationship_role: item.relationship_role,
    raw_value: item.raw_value,
    verification_state: item.verification_state,
    evidence_id: optionalText(item.evidence_id, "evidence_id"),
    researcher_citation_url: optionalText(item.researcher_citation_url, "researcher_citation_url"),
    researcher_citation_title: optionalText(item.researcher_citation_title, "researcher_citation_title"),
    researcher_citation_excerpt: optionalText(item.researcher_citation_excerpt, "researcher_citation_excerpt"),
    ambiguous_verified_own: item.ambiguous_verified_own,
  };
}

function completeCitation(row: LegalEntityIdentifierRow): boolean {
  return Boolean(
    row.researcher_citation_url
    && row.researcher_citation_title
    && row.researcher_citation_excerpt,
  );
}

export function legalEntityIdentifierDisplays(
  rows: LegalEntityIdentifierRow[],
): LegalEntityIdentifierDisplay[] {
  return rows.map((row) => {
    const cited = completeCitation(row);
    return {
      scheme: row.scheme,
      rawValue: row.raw_value,
      relationshipRole: row.relationship_role,
      verificationState: row.verification_state,
      ambiguous: row.ambiguous_verified_own,
      citationUrl: cited ? row.researcher_citation_url : null,
      citationTitle: cited ? row.researcher_citation_title : null,
      citationExcerpt: cited ? row.researcher_citation_excerpt : null,
      evidenceId: cited ? null : row.evidence_id,
    };
  });
}
