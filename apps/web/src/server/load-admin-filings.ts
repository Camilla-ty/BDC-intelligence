import {
  isInventoryRow,
  normalizeInventoryRow,
  parseFilingRef,
  type AdminDashboardSummary,
  type AdminFilingArtifactRow,
  type AdminFilingAttributeRow,
  type AdminFilingDetail,
  type AdminFilingDocumentRow,
  type AdminFilingInventoryRow,
  type AdminFilingProcessingRow,
  type AdminFilingRegistrantRow,
} from "@/lib/admin-filings";
import { requireAdmin } from "@/server/auth/access";
import { executeSql } from "@/server/sql-text";

const READ_ERROR = "The admin filing read model could not be read.";

async function query(sql: string): Promise<{ json: unknown; error: string | null }> {
  const executed = await executeSql(sql);
  if (!executed.ok) return { json: null, error: READ_ERROR };
  try {
    return { json: JSON.parse(executed.text === "" ? "null" : executed.text), error: null };
  } catch {
    return { json: null, error: READ_ERROR };
  }
}

function adminSql(body: string): string {
  return `SET ROLE admin_reader;\nSET statement_timeout = '30s';\n${body}\nRESET ROLE;\n`;
}

function escapeLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

const INVENTORY_COLUMNS = `
  filing_id, accession_number, filing_run_id, filing_recorded_at,
  registrant_link_status, registrant_ids, registrant_ciks,
  registrant_name_state, registrant_name_raw,
  forms, form_raw_values, filed_dates, filed_date_raw_values,
  report_periods, report_period_raw_values,
  document_count, artifact_count, documents_available, artifacts_available,
  processing_outcomes, processing_row_count,
  soi_row_observation_count, position_observation_count, num_fact_observation_count
`;

const INVENTORY_ORDER = `
  ORDER BY (SELECT max(d) FROM unnest(filed_dates) AS d) DESC NULLS LAST,
           accession_number DESC,
           filing_id DESC
`;

function parseInventoryRows(json: unknown): AdminFilingInventoryRow[] | null {
  if (!Array.isArray(json)) return null;
  const rows: AdminFilingInventoryRow[] = [];
  for (const item of json) {
    if (!isInventoryRow(item)) return null;
    rows.push(normalizeInventoryRow(item));
  }
  return rows;
}

export async function loadAdminDashboard(): Promise<{
  summary: AdminDashboardSummary | null;
  error: string | null;
}> {
  await requireAdmin();
  const { json, error } = await query(adminSql(`
SELECT json_build_object(
  'total_filings', count(*)::bigint,
  'filings_with_documents', count(*) FILTER (WHERE documents_available)::bigint,
  'filings_with_artifacts', count(*) FILTER (WHERE artifacts_available)::bigint,
  'filings_with_processing', count(*) FILTER (WHERE processing_row_count > 0)::bigint,
  'filings_with_observations', count(*) FILTER (
    WHERE soi_row_observation_count > 0
       OR position_observation_count > 0
       OR num_fact_observation_count > 0
  )::bigint,
  'recent', (
    SELECT coalesce(json_agg(row_to_json(r)), '[]'::json)
    FROM (
      SELECT ${INVENTORY_COLUMNS}
      FROM admin.filing_inventory
      ${INVENTORY_ORDER}
      LIMIT 10
    ) r
  )
)
FROM admin.filing_inventory;`));
  if (error || json == null || typeof json !== "object" || Array.isArray(json)) {
    return { summary: null, error: error ?? READ_ERROR };
  }
  const row = json as Record<string, unknown>;
  const recent = parseInventoryRows(row.recent);
  if (recent == null) return { summary: null, error: READ_ERROR };
  const total = Number(row.total_filings);
  const withDocs = Number(row.filings_with_documents);
  const withArtifacts = Number(row.filings_with_artifacts);
  const withProcessing = Number(row.filings_with_processing);
  const withObservations = Number(row.filings_with_observations);
  if (![total, withDocs, withArtifacts, withProcessing, withObservations].every(Number.isFinite)) {
    return { summary: null, error: READ_ERROR };
  }
  return {
    summary: {
      total_filings: total,
      filings_with_documents: withDocs,
      filings_with_artifacts: withArtifacts,
      filings_with_processing: withProcessing,
      filings_with_observations: withObservations,
      recent,
    },
    error: null,
  };
}

export async function loadAdminFilingInventory(queryText = ""): Promise<{
  rows: AdminFilingInventoryRow[];
  error: string | null;
}> {
  await requireAdmin();
  const q = queryText.trim().slice(0, 80);
  const filter =
    q === ""
      ? ""
      : `WHERE accession_number ILIKE '%${escapeLiteral(q)}%'
          OR coalesce(registrant_name_raw, '') ILIKE '%${escapeLiteral(q)}%'
          OR registrant_name_state ILIKE '%${escapeLiteral(q)}%'
          OR EXISTS (
               SELECT 1 FROM unnest(coalesce(forms, ARRAY[]::text[])) AS form
               WHERE form ILIKE '%${escapeLiteral(q)}%'
             )
          OR EXISTS (
               SELECT 1 FROM unnest(coalesce(form_raw_values, ARRAY[]::text[])) AS form_raw
               WHERE form_raw ILIKE '%${escapeLiteral(q)}%'
             )
          OR EXISTS (
               SELECT 1 FROM unnest(coalesce(registrant_ciks, ARRAY[]::bigint[])) AS cik
               WHERE lpad(cik::text, 10, '0') ILIKE '%${escapeLiteral(q)}%'
             )`;
  const { json, error } = await query(adminSql(`
SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
FROM (
  SELECT ${INVENTORY_COLUMNS}
  FROM admin.filing_inventory
  ${filter}
  ${INVENTORY_ORDER}
) t;`));
  if (error) return { rows: [], error };
  const rows = parseInventoryRows(json);
  if (rows == null) return { rows: [], error: READ_ERROR };
  return { rows, error: null };
}

export async function loadAdminFilingDetail(ref: string): Promise<{
  detail: AdminFilingDetail | null;
  error: string | null;
  notFound: boolean;
}> {
  await requireAdmin();
  const parsed = parseFilingRef(ref);
  if (parsed == null) return { detail: null, error: null, notFound: true };
  const predicate =
    parsed.kind === "accession"
      ? `accession_number = '${escapeLiteral(parsed.accession)}'`
      : `filing_id = ${parsed.filingId}::bigint`;

  const { json, error } = await query(adminSql(`
SELECT json_build_object(
  'inventory', (
    SELECT row_to_json(i) FROM (
      SELECT ${INVENTORY_COLUMNS}
      FROM admin.filing_inventory
      WHERE ${predicate}
    ) i),
  'registrants', (
    SELECT coalesce(json_agg(row_to_json(r) ORDER BY r.registrant_id NULLS LAST, r.cik NULLS LAST), '[]'::json)
    FROM (
      SELECT filing_id, accession_number, registrant_id, cik, link_source,
             registrant_link_status, evidence_id, name_state, name_raw
      FROM admin.filing_registrant
      WHERE ${predicate}
    ) r),
  'attributes', (
    SELECT coalesce(json_agg(row_to_json(a) ORDER BY a.attribute_code, a.observation_id), '[]'::json)
    FROM (
      SELECT filing_id, accession_number, observation_id, attribute_code, raw_value, value_state,
             normalized_text, normalized_date, normalized_timestamp, source_type_code, source_stream,
             evidence_level, documentation_status, evidence_id, rule_version_id, run_id
      FROM admin.filing_attribute
      WHERE ${predicate}
    ) a),
  'documents', (
    SELECT coalesce(json_agg(row_to_json(d) ORDER BY d.filing_document_id), '[]'::json)
    FROM (
      SELECT filing_id, accession_number, filing_document_id, document_name, document_url, named_by,
             rule_version_id, run_id, evidence_id, recorded_at, artifact_linked
      FROM admin.filing_document
      WHERE ${predicate}
    ) d),
  'artifacts', (
    SELECT coalesce(json_agg(row_to_json(a) ORDER BY a.artifact_id, a.filing_document_id), '[]'::json)
    FROM (
      SELECT filing_id, accession_number, filing_document_id, document_name, document_url,
             filing_document_artifact_id, artifact_id, source_url, final_url, source_type_code,
             http_status, content_type, last_modified, etag, byte_size, sha256, retrieved_at,
             storage_key, artifact_run_id, artifact_recorded_at
      FROM admin.filing_artifact
      WHERE ${predicate}
    ) a),
  'processing', (
    SELECT coalesce(json_agg(row_to_json(p) ORDER BY p.artifact_processing_id), '[]'::json)
    FROM (
      SELECT filing_id, accession_number, artifact_processing_id, artifact_id, rule_version_id,
             rule_code, rule_version, rule_kind, outcome, detail, counts, run_id,
             run_kind, run_status, run_started_at, run_finished_at, processing_recorded_at
      FROM admin.filing_processing
      WHERE ${predicate}
    ) p)
);`));

  if (error) return { detail: null, error, notFound: false };
  if (json == null || typeof json !== "object" || Array.isArray(json)) {
    return { detail: null, error: READ_ERROR, notFound: false };
  }
  const payload = json as Record<string, unknown>;
  if (payload.inventory == null) return { detail: null, error: null, notFound: true };
  if (!isInventoryRow(payload.inventory)) return { detail: null, error: READ_ERROR, notFound: false };
  if (!Array.isArray(payload.registrants) || !Array.isArray(payload.attributes)
      || !Array.isArray(payload.documents) || !Array.isArray(payload.artifacts)
      || !Array.isArray(payload.processing)) {
    return { detail: null, error: READ_ERROR, notFound: false };
  }

  return {
    detail: {
      inventory: normalizeInventoryRow(payload.inventory),
      registrants: payload.registrants as AdminFilingRegistrantRow[],
      attributes: payload.attributes as AdminFilingAttributeRow[],
      documents: payload.documents as AdminFilingDocumentRow[],
      artifacts: payload.artifacts as AdminFilingArtifactRow[],
      processing: payload.processing as AdminFilingProcessingRow[],
    },
    error: null,
    notFound: false,
  };
}
