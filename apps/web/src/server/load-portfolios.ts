import { spawnSync } from "node:child_process";
import {
  assertPortfolioFields,
  type DateRow,
  type LineRow,
  type NameSourceRow,
  type RegistrantRow,
} from "@/lib/portfolios";

const CONTAINER = process.env.BDC_DB_CONTAINER ?? "bdc-intelligence-pg";
const DATABASE = process.env.BDC_DATABASE ?? "bdc_local";

const CIK = /^[0-9]{10}$/;
const REPORTED_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

function query(sql: string): { json: unknown; error: string | null } {
  const result = spawnSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", DATABASE, "-At"],
    { input: sql, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.status !== 0) return { json: null, error: "The portfolio listing could not be read." };
  const line = (result.stdout ?? "").trim();
  try {
    return { json: JSON.parse(line === "" ? "null" : line), error: null };
  } catch {
    return { json: null, error: "The portfolio listing could not be read." };
  }
}

function readerSql(body: string): string {
  return `SET ROLE bdc_reader;\nSET statement_timeout = '30s';\n${body}\nRESET ROLE;\n`;
}

export function loadEmptyPeriods(): { labels: string[]; error: string | null } {
  const { json, error } = query(readerSql(`
SELECT coalesce(json_agg(release_label ORDER BY release_label), '[]'::json)
FROM registry.portfolio_empty_period;`));
  if (error || !Array.isArray(json) || !json.every((item) => typeof item === "string")) {
    return { labels: [], error: error ?? "The portfolio listing could not be read." };
  }
  return { labels: json, error: null };
}

export type DirectoryResult = { rows: RegistrantRow[]; error: string | null };

export function loadPortfolioDirectory(): DirectoryResult {
  const { json, error } = query(readerSql(`
SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
FROM (
  SELECT registrant_cik, name_state, name_raw, ticker_state, ticker_raw,
         file_number_state, file_number_raw, reported_date_count
  FROM registry.portfolio_registrant
  ORDER BY registrant_cik
) t;`));
  if (error || !Array.isArray(json)) return { rows: [], error: error ?? "The portfolio listing could not be read." };
  const rows: RegistrantRow[] = [];
  for (const item of json) {
    if (!isRegistrant(item)) return { rows: [], error: "The portfolio listing could not be read." };
    rows.push(item);
  }
  return { rows, error: null };
}

export type DetailResult = {
  registrant: RegistrantRow | null;
  names: NameSourceRow[];
  dates: DateRow[];
  emptyPeriods: string[];
  error: string | null;
};

export function loadPortfolioDetail(cik: string): DetailResult {
  if (!CIK.test(cik)) {
    return { registrant: null, names: [], dates: [], emptyPeriods: [], error: null };
  }
  const { json, error } = query(readerSql(`
SELECT json_build_object(
  'registrant', (
    SELECT row_to_json(r) FROM (
      SELECT registrant_cik, name_state, name_raw, ticker_state, ticker_raw,
             file_number_state, file_number_raw, reported_date_count
      FROM registry.portfolio_registrant
      WHERE registrant_cik = '${cik}'
    ) r),
  'names', (
    SELECT coalesce(json_agg(row_to_json(n) ORDER BY n.source_type_code, n.raw_value), '[]'::json)
    FROM (
      SELECT source_type_code, raw_value, documentation_status
      FROM registry.portfolio_registrant_name
      WHERE registrant_cik = '${cik}'
    ) n),
  'dates', (
    SELECT coalesce(json_agg(row_to_json(d) ORDER BY d.reported_date), '[]'::json)
    FROM (
      SELECT reported_date::text AS reported_date, disclosed_line_count,
             point_in_time_line_count, duration_line_count
      FROM registry.portfolio_reported_date
      WHERE registrant_cik = '${cik}'
    ) d),
  'empty_periods', (
    SELECT coalesce(json_agg(release_label ORDER BY release_label), '[]'::json)
    FROM registry.portfolio_empty_period)
);`));
  if (error || json == null || typeof json !== "object" || Array.isArray(json)) {
    return { registrant: null, names: [], dates: [], emptyPeriods: [], error: "The portfolio listing could not be read." };
  }
  const payload = json as { registrant?: unknown; names?: unknown; dates?: unknown; empty_periods?: unknown };
  if (payload.registrant != null && !isRegistrant(payload.registrant)) {
    return { registrant: null, names: [], dates: [], emptyPeriods: [], error: "The portfolio listing could not be read." };
  }
  if (!Array.isArray(payload.names) || !payload.names.every(isName) || !Array.isArray(payload.dates) || !payload.dates.every(isDate)) {
    return { registrant: null, names: [], dates: [], emptyPeriods: [], error: "The portfolio listing could not be read." };
  }
  if (!Array.isArray(payload.empty_periods) || !payload.empty_periods.every((item) => typeof item === "string")) {
    return { registrant: null, names: [], dates: [], emptyPeriods: [], error: "The portfolio listing could not be read." };
  }
  return {
    registrant: payload.registrant == null ? null : payload.registrant,
    names: payload.names,
    dates: payload.dates,
    emptyPeriods: payload.empty_periods,
    error: null,
  };
}

export type LinesResult = { total: number | null; rows: LineRow[]; error: string | null };

export function loadPortfolioLines(cik: string, reportedDate: string, offset: number): LinesResult {
  if (!CIK.test(cik) || !REPORTED_DATE.test(reportedDate) || !Number.isSafeInteger(offset) || offset < 0) {
    return { total: null, rows: [], error: null };
  }
  const { json, error } = query(readerSql(`
SELECT json_build_object(
  'total', (
    SELECT count(*)::integer
    FROM registry.portfolio_line
    WHERE registrant_cik = '${cik}' AND reported_date = '${reportedDate}'
  ),
  'lines', (
    SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
    FROM (
      SELECT position_observation_id::text,
             reported_date::text,
             duration_kind,
             period_role,
             disclosed_line_text,
             accession_number,
             evidence_level,
             principal_state, principal_raw, principal_currency_state,
             maturity_state, maturity_raw,
             instrument_type_state, instrument_type_raw,
             industry_state, industry_raw,
             affiliation_state, affiliation_raw,
             geography_state, geography_raw,
             acquisition_date_state, acquisition_date_raw,
             restricted_state, restricted_raw,
             reference_uri_state, reference_uri_raw,
             form_state, form_raw,
             filed_date_state, filed_date_raw,
             inline_url_state, inline_url,
             document_name, document_url,
             release_state, release_label
      FROM registry.portfolio_line
      WHERE registrant_cik = '${cik}' AND reported_date = '${reportedDate}'
      ORDER BY position_observation_id
      LIMIT 50 OFFSET ${offset}
    ) t)
);`));
  if (error || json == null || typeof json !== "object" || Array.isArray(json)) {
    return { total: null, rows: [], error: "The portfolio listing could not be read." };
  }
  const payload = json as { total?: unknown; lines?: unknown };
  if (typeof payload.total !== "number" || !Array.isArray(payload.lines) || !payload.lines.every(isLine)) {
    return { total: null, rows: [], error: "The portfolio listing could not be read." };
  }
  return { total: payload.total, rows: payload.lines, error: null };
}

function isRegistrant(item: unknown): item is RegistrantRow {
  if (item == null || typeof item !== "object") return false;
  try {
    assertPortfolioFields(item);
  } catch {
    return false;
  }
  const row = item as RegistrantRow;
  return typeof row.registrant_cik === "string" && typeof row.name_state === "string" && typeof row.reported_date_count === "number";
}

function isName(item: unknown): item is NameSourceRow {
  if (item == null || typeof item !== "object") return false;
  const row = item as NameSourceRow;
  return typeof row.source_type_code === "string" && typeof row.raw_value === "string";
}

function isDate(item: unknown): item is DateRow {
  if (item == null || typeof item !== "object") return false;
  const row = item as DateRow;
  return typeof row.reported_date === "string" && typeof row.disclosed_line_count === "number";
}

function isLine(item: unknown): item is LineRow {
  if (item == null || typeof item !== "object") return false;
  try {
    assertPortfolioFields(item);
  } catch {
    return false;
  }
  const row = item as LineRow;
  return typeof row.position_observation_id === "string"
    && typeof row.disclosed_line_text === "string"
    && typeof row.principal_state === "string"
    && row.principal_currency_state === "UNKNOWN";
}
