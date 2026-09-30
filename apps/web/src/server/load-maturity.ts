import type { CoverageRow, MaturityLineRow, YearRow } from "@/lib/maturity";
import {
  assertPortfolioFields,
  type NameSourceRow,
  type RegistrantRow,
} from "@/lib/portfolios";
import { executeSql } from "@/server/sql-text";

const CIK = /^[0-9]{10}$/;
const REPORTED_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const YEAR = /^(?:unknown|multiple|[0-9]{4})$/;

async function query(sql: string): Promise<{ json: unknown; error: string | null }> {
  const executed = await executeSql(sql);
  if (!executed.ok) return { json: null, error: "The maturity listing could not be read." };
  const line = executed.text;
  try {
    return { json: JSON.parse(line === "" ? "null" : line), error: null };
  } catch {
    return { json: null, error: "The maturity listing could not be read." };
  }
}

function readerSql(body: string): string {
  return `SET ROLE bdc_reader;\nSET statement_timeout = '30s';\n${body}\nRESET ROLE;\n`;
}

export type MaturityDetail = {
  registrant: RegistrantRow | null;
  names: NameSourceRow[];
  dates: CoverageRow[];
  years: YearRow[];
  emptyPeriods: string[];
  error: string | null;
};

export async function loadMaturityDetail(cik: string): Promise<MaturityDetail> {
  if (!CIK.test(cik)) {
    return { registrant: null, names: [], dates: [], years: [], emptyPeriods: [], error: null };
  }
  const { json, error } = await query(readerSql(`
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
             maturity_reported_count, maturity_unknown_count, maturity_multiple_count
      FROM registry.maturity_coverage('${cik}')
    ) d),
  'years', (
    SELECT coalesce(json_agg(row_to_json(y) ORDER BY y.reported_date, y.maturity_year), '[]'::json)
    FROM (
      SELECT reported_date::text AS reported_date, maturity_year, disclosed_line_count
      FROM registry.maturity_years('${cik}')
    ) y),
  'empty_periods', (
    SELECT coalesce(json_agg(release_label ORDER BY release_label), '[]'::json)
    FROM registry.portfolio_empty_period)
);`));
  if (error || json == null || typeof json !== "object" || Array.isArray(json)) {
    return { registrant: null, names: [], dates: [], years: [], emptyPeriods: [], error: "The maturity listing could not be read." };
  }
  const payload = json as {
    registrant?: unknown;
    names?: unknown;
    dates?: unknown;
    years?: unknown;
    empty_periods?: unknown;
  };
  if (payload.registrant != null && !isRegistrant(payload.registrant)) {
    return { registrant: null, names: [], dates: [], years: [], emptyPeriods: [], error: "The maturity listing could not be read." };
  }
  if (!Array.isArray(payload.names) || !payload.names.every(isName)
    || !Array.isArray(payload.dates) || !payload.dates.every(isCoverage)
    || !Array.isArray(payload.years) || !payload.years.every(isYear)
    || !Array.isArray(payload.empty_periods) || !payload.empty_periods.every((item) => typeof item === "string")) {
    return { registrant: null, names: [], dates: [], years: [], emptyPeriods: [], error: "The maturity listing could not be read." };
  }
  return {
    registrant: payload.registrant == null ? null : payload.registrant,
    names: payload.names,
    dates: payload.dates,
    years: payload.years,
    emptyPeriods: payload.empty_periods,
    error: null,
  };
}

export type MaturityLinesResult = {
  total: number | null;
  dateFound: boolean;
  rows: MaturityLineRow[];
  error: string | null;
};

export async function loadMaturityLines(cik: string, reportedDate: string, year: string, offset: number): Promise<MaturityLinesResult> {
  if (!CIK.test(cik) || !REPORTED_DATE.test(reportedDate) || (year !== "" && !YEAR.test(year))
    || !Number.isSafeInteger(offset) || offset < 0) {
    return { total: null, dateFound: false, rows: [], error: null };
  }
  const kind = year === "" ? "all" : year === "unknown" ? "unknown" : year === "multiple" ? "multiple" : "year";
  const yearNumber = kind === "year" ? String(Number(year)) : "NULL";
  const { json, error } = await query(readerSql(`
SELECT json_build_object(
  'date_found', EXISTS (
    SELECT 1 FROM registry.maturity_coverage('${cik}') c
    WHERE c.reported_date = '${reportedDate}'
  ),
  'total', registry.maturity_line_count('${cik}', '${reportedDate}', '${kind}', ${yearNumber}),
  'lines', (
    SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
    FROM (
      SELECT position_observation_id::text,
             disclosed_line_text,
             principal_state, principal_raw, principal_currency_state,
             maturity_state, maturity_raw, maturity_year,
             accession_number, evidence_level,
             form_state, form_raw,
             filed_date_state, filed_date_raw,
             inline_url_state, inline_url,
             document_url,
             release_state, release_label
      FROM registry.maturity_line_page('${cik}', '${reportedDate}', '${kind}', ${yearNumber}, 50, ${offset})
    ) t)
);`));
  if (error || json == null || typeof json !== "object" || Array.isArray(json)) {
    return { total: null, dateFound: false, rows: [], error: "The maturity listing could not be read." };
  }
  const payload = json as { date_found?: unknown; total?: unknown; lines?: unknown };
  if (typeof payload.date_found !== "boolean" || !Array.isArray(payload.lines) || !payload.lines.every(isLine)) {
    return { total: null, dateFound: false, rows: [], error: "The maturity listing could not be read." };
  }
  if (payload.total != null && typeof payload.total !== "number") {
    return { total: null, dateFound: false, rows: [], error: "The maturity listing could not be read." };
  }
  return {
    total: payload.total == null ? null : payload.total,
    dateFound: payload.date_found,
    rows: payload.lines,
    error: null,
  };
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

function isCoverage(item: unknown): item is CoverageRow {
  if (item == null || typeof item !== "object") return false;
  const row = item as CoverageRow;
  return typeof row.reported_date === "string"
    && typeof row.disclosed_line_count === "number"
    && typeof row.maturity_reported_count === "number"
    && typeof row.maturity_unknown_count === "number"
    && typeof row.maturity_multiple_count === "number";
}

function isYear(item: unknown): item is YearRow {
  if (item == null || typeof item !== "object") return false;
  const row = item as YearRow;
  return typeof row.reported_date === "string"
    && typeof row.maturity_year === "number"
    && typeof row.disclosed_line_count === "number";
}

function isLine(item: unknown): item is MaturityLineRow {
  if (item == null || typeof item !== "object") return false;
  try {
    assertPortfolioFields(item);
  } catch {
    return false;
  }
  const row = item as MaturityLineRow;
  return typeof row.position_observation_id === "string"
    && typeof row.disclosed_line_text === "string"
    && typeof row.principal_state === "string"
    && row.principal_currency_state === "UNKNOWN"
    && typeof row.maturity_state === "string";
}
