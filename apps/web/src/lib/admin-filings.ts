// Display helpers for Admin Phase A. Values come from admin.* views only.
// NULL processing_outcomes means no linked processing row — not success or failure.

export const ACCESSION_PATTERN = /^[0-9]{10}-[0-9]{2}-[0-9]{6}$/;
export const FILING_ID_PATTERN = /^[0-9]+$/;

export type AdminFilingInventoryRow = {
  filing_id: number;
  accession_number: string;
  filing_run_id: number | null;
  filing_recorded_at: string | null;
  registrant_link_status: string;
  registrant_ids: number[] | null;
  registrant_ciks: number[] | null;
  registrant_name_state: string;
  registrant_name_raw: string | null;
  forms: string[] | null;
  form_raw_values: string[] | null;
  filed_dates: string[] | null;
  filed_date_raw_values: string[] | null;
  report_periods: string[] | null;
  report_period_raw_values: string[] | null;
  document_count: number;
  artifact_count: number;
  documents_available: boolean;
  artifacts_available: boolean;
  processing_outcomes: string[] | null;
  processing_row_count: number;
  soi_row_observation_count: number;
  position_observation_count: number;
  num_fact_observation_count: number;
};

export type AdminDashboardSummary = {
  total_filings: number;
  filings_with_documents: number;
  filings_with_artifacts: number;
  filings_with_processing: number;
  filings_with_observations: number;
  recent: AdminFilingInventoryRow[];
};

export type AdminFilingRegistrantRow = {
  filing_id: number;
  accession_number: string;
  registrant_id: number | null;
  cik: number | null;
  link_source: string | null;
  registrant_link_status: string;
  evidence_id: number | null;
  name_state: string | null;
  name_raw: string | null;
};

export type AdminFilingAttributeRow = {
  filing_id: number;
  accession_number: string;
  observation_id: number;
  attribute_code: string;
  raw_value: string;
  value_state: string;
  normalized_text: string | null;
  normalized_date: string | null;
  normalized_timestamp: string | null;
  source_type_code: string | null;
  source_stream: string | null;
  evidence_level: string | null;
  documentation_status: string | null;
  evidence_id: number | null;
  rule_version_id: number | null;
  run_id: number | null;
};

export type AdminFilingDocumentRow = {
  filing_id: number;
  accession_number: string;
  filing_document_id: number;
  document_name: string;
  document_url: string;
  named_by: string;
  rule_version_id: number | null;
  run_id: number | null;
  evidence_id: number | null;
  recorded_at: string | null;
  artifact_linked: boolean;
};

export type AdminFilingArtifactRow = {
  filing_id: number;
  accession_number: string;
  filing_document_id: number;
  document_name: string;
  document_url: string;
  filing_document_artifact_id: number;
  artifact_id: number;
  source_url: string;
  final_url: string;
  source_type_code: string;
  http_status: number;
  content_type: string | null;
  last_modified: string | null;
  etag: string | null;
  byte_size: number;
  sha256: string;
  retrieved_at: string;
  storage_key: string;
  artifact_run_id: number | null;
  artifact_recorded_at: string | null;
};

export type AdminFilingProcessingRow = {
  filing_id: number;
  accession_number: string;
  artifact_processing_id: number;
  artifact_id: number;
  rule_version_id: number;
  rule_code: string;
  rule_version: string;
  rule_kind: string;
  outcome: string;
  detail: string;
  counts: unknown;
  run_id: number;
  run_kind: string | null;
  run_status: string | null;
  run_started_at: string | null;
  run_finished_at: string | null;
  processing_recorded_at: string | null;
};

export type AdminFilingDetail = {
  inventory: AdminFilingInventoryRow;
  registrants: AdminFilingRegistrantRow[];
  attributes: AdminFilingAttributeRow[];
  documents: AdminFilingDocumentRow[];
  artifacts: AdminFilingArtifactRow[];
  processing: AdminFilingProcessingRow[];
};

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number" && Number.isFinite(item));
}

export function asCount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^[0-9]+$/.test(value)) return Number(value);
  return null;
}

export function isInventoryRow(value: unknown): value is AdminFilingInventoryRow {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const filingId = asCount(row.filing_id);
  if (filingId == null || typeof row.accession_number !== "string") return false;
  if (typeof row.registrant_link_status !== "string") return false;
  if (typeof row.registrant_name_state !== "string") return false;
  if (row.registrant_name_raw != null && typeof row.registrant_name_raw !== "string") return false;
  if (row.forms != null && !isStringArray(row.forms)) return false;
  if (row.filed_dates != null && !isStringArray(row.filed_dates)) return false;
  if (row.report_periods != null && !isStringArray(row.report_periods)) return false;
  if (row.processing_outcomes != null && !isStringArray(row.processing_outcomes)) return false;
  if (row.registrant_ciks != null && !isNumberArray(row.registrant_ciks) && !isStringArray(row.registrant_ciks)) {
    return false;
  }
  return (
    asCount(row.document_count) != null &&
    asCount(row.artifact_count) != null &&
    asCount(row.processing_row_count) != null &&
    asCount(row.soi_row_observation_count) != null &&
    asCount(row.position_observation_count) != null &&
    asCount(row.num_fact_observation_count) != null &&
    typeof row.documents_available === "boolean" &&
    typeof row.artifacts_available === "boolean"
  );
}

export function normalizeInventoryRow(value: AdminFilingInventoryRow): AdminFilingInventoryRow {
  const ciks = rowNumberArray(value.registrant_ciks);
  return {
    ...value,
    filing_id: asCount(value.filing_id) ?? value.filing_id,
    filing_run_id: asCount(value.filing_run_id),
    registrant_ids: rowNumberArray(value.registrant_ids),
    registrant_ciks: ciks,
    document_count: asCount(value.document_count) ?? 0,
    artifact_count: asCount(value.artifact_count) ?? 0,
    processing_row_count: asCount(value.processing_row_count) ?? 0,
    soi_row_observation_count: asCount(value.soi_row_observation_count) ?? 0,
    position_observation_count: asCount(value.position_observation_count) ?? 0,
    num_fact_observation_count: asCount(value.num_fact_observation_count) ?? 0,
  };
}

function rowNumberArray(value: unknown): number[] | null {
  if (value == null) return null;
  if (isNumberArray(value)) return value;
  if (isStringArray(value) && value.every((item) => /^[0-9]+$/.test(item))) {
    return value.map((item) => Number(item));
  }
  return null;
}

/** Join authoritative list values; null/empty stays Unknown. */
export function listText(values: string[] | null | undefined): string {
  if (values == null || values.length === 0) return "Unknown";
  return values.join(", ");
}

export function cikListText(values: number[] | null | undefined): string {
  if (values == null || values.length === 0) return "Unknown";
  return values.map((cik) => String(cik).padStart(10, "0")).join(", ");
}

export function registrantNameText(nameState: string, nameRaw: string | null): string {
  if (nameRaw != null && nameRaw !== "") return nameRaw;
  if (nameState === "UNKNOWN") return "Unknown";
  if (nameState === "MULTIPLE_REGISTRANTS") return "MULTIPLE_REGISTRANTS";
  if (nameState === "MULTIPLE_VALUES") return "MULTIPLE_VALUES";
  return nameState || "Unknown";
}

/** NULL processing_outcomes = no linked processing rows (not a fabricated status). */
export function processingOutcomesText(outcomes: string[] | null | undefined): string {
  if (outcomes == null) return "No linked processing rows";
  if (outcomes.length === 0) return "No linked processing rows";
  return outcomes.join(", ");
}

export function countText(value: number | null | undefined): string {
  if (value == null) return "Unknown";
  return String(value);
}

export function optionalText(value: string | number | null | undefined): string {
  if (value == null || value === "") return "Unknown";
  return String(value);
}

export function parseFilingRef(raw: string): { kind: "filing_id"; filingId: string } | { kind: "accession"; accession: string } | null {
  const value = raw.trim();
  if (ACCESSION_PATTERN.test(value)) return { kind: "accession", accession: value };
  if (FILING_ID_PATTERN.test(value)) return { kind: "filing_id", filingId: value };
  return null;
}
