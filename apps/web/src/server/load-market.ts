import { spawnSync } from "node:child_process";
import {
  assertMarketFields,
  type DateCoverageRow,
  type DateRegistrantRow,
  type RegistrantCoverageRow,
  type ReleaseCoverageRow,
  type ReleaseDateRow,
} from "@/lib/market";

const CONTAINER = process.env.BDC_DB_CONTAINER ?? "bdc-intelligence-pg";
const DATABASE = process.env.BDC_DATABASE ?? "bdc_local";

const REPORTED_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const RELEASE_LABEL = /^[0-9]{4}(_[0-9]{2}|q[1-4])$/;

function query(sql: string): { json: unknown; error: string | null } {
  const result = spawnSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", DATABASE, "-At"],
    { input: sql, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.status !== 0) return { json: null, error: "The market coverage listing could not be read." };
  const line = (result.stdout ?? "").trim();
  try {
    return { json: JSON.parse(line === "" ? "null" : line), error: null };
  } catch {
    return { json: null, error: "The market coverage listing could not be read." };
  }
}

function readerSql(body: string, timeoutSeconds: number): string {
  return `SET ROLE bdc_reader;\nSET statement_timeout = '${timeoutSeconds}s';\n${body}\nRESET ROLE;\n`;
}

export type DirectoryResult = {
  registrants: RegistrantCoverageRow[];
  releases: ReleaseCoverageRow[];
  dates: DateCoverageRow[];
  error: string | null;
};

export function loadMarketDirectory(): DirectoryResult {
  const empty = { registrants: [], releases: [], dates: [], error: "The market coverage listing could not be read." };
  const { json, error } = query(readerSql(`
SELECT json_build_object(
  'registrants', (
    SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
    FROM (
      SELECT registrant_cik, name_state, name_raw, coverage_state
      FROM registry.market_registrant_coverage
    ) t),
  'releases', (
    SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
    FROM (
      SELECT release_label, coverage_state, registrants_observed, reported_dates_observed
      FROM registry.market_release_coverage
    ) t),
  'dates', (
    SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
    FROM (
      SELECT reported_date::text AS reported_date, registrants_observed
      FROM registry.market_reported_date
    ) t)
);`, 60));
  if (error || json == null || typeof json !== "object" || Array.isArray(json)) return empty;
  const payload = json as { registrants?: unknown; releases?: unknown; dates?: unknown };
  if (!Array.isArray(payload.registrants) || !payload.registrants.every(isRegistrant)) return empty;
  if (!Array.isArray(payload.releases) || !payload.releases.every(isRelease)) return empty;
  if (!Array.isArray(payload.dates) || !payload.dates.every(isDate)) return empty;
  return { registrants: payload.registrants, releases: payload.releases, dates: payload.dates, error: null };
}

export type ReleaseResult = {
  found: boolean;
  coverageState: string | null;
  rows: ReleaseDateRow[];
  error: string | null;
};

export function loadMarketRelease(label: string): ReleaseResult {
  if (!RELEASE_LABEL.test(label)) return { found: false, coverageState: null, rows: [], error: null };
  const { json, error } = query(readerSql(`
SELECT json_build_object(
  'coverage_state', (
    SELECT coverage_state FROM registry.market_release_coverage WHERE release_label = '${label}'
  ),
  'rows', (
    SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
    FROM (
      SELECT registrant_cik, name_state, name_raw, reported_date::text AS reported_date, disclosed_line_count
      FROM registry.market_release_date('${label}')
    ) t)
);`, 60));
  if (error || json == null || typeof json !== "object" || Array.isArray(json)) {
    return { found: false, coverageState: null, rows: [], error: "The market coverage listing could not be read." };
  }
  const payload = json as { coverage_state?: unknown; rows?: unknown };
  if (payload.coverage_state == null) return { found: false, coverageState: null, rows: [], error: null };
  if (typeof payload.coverage_state !== "string" || !Array.isArray(payload.rows) || !payload.rows.every(isReleaseDate)) {
    return { found: false, coverageState: null, rows: [], error: "The market coverage listing could not be read." };
  }
  return { found: true, coverageState: payload.coverage_state, rows: payload.rows, error: null };
}

export type DateResult = {
  found: boolean;
  rows: DateRegistrantRow[];
  error: string | null;
};

export function loadMarketDate(reportedDate: string): DateResult {
  if (!REPORTED_DATE.test(reportedDate)) return { found: false, rows: [], error: null };
  const { json, error } = query(readerSql(`
SELECT json_build_object(
  'found', EXISTS (
    SELECT 1 FROM registry.market_reported_date WHERE reported_date = '${reportedDate}'
  ),
  'rows', (
    SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
    FROM (
      SELECT registrant_cik, name_state, name_raw, disclosed_line_count,
             maturity_cell_line_count, maturity_unknown_line_count,
             principal_cell_line_count, principal_unknown_line_count,
             basis_cell_line_count, basis_unknown_line_count,
             initial_cell_line_count, initial_unknown_line_count
      FROM registry.market_date_registrant('${reportedDate}')
    ) t)
);`, 60));
  if (error || json == null || typeof json !== "object" || Array.isArray(json)) {
    return { found: false, rows: [], error: "The market coverage listing could not be read." };
  }
  const payload = json as { found?: unknown; rows?: unknown };
  if (typeof payload.found !== "boolean" || !Array.isArray(payload.rows) || !payload.rows.every(isDateRegistrant)) {
    return { found: false, rows: [], error: "The market coverage listing could not be read." };
  }
  return { found: payload.found, rows: payload.found ? payload.rows : [], error: null };
}

function isRegistrant(item: unknown): item is RegistrantCoverageRow {
  if (!record(item)) return false;
  const row = item as RegistrantCoverageRow;
  return typeof row.registrant_cik === "string" && typeof row.name_state === "string" && typeof row.coverage_state === "string";
}

function isRelease(item: unknown): item is ReleaseCoverageRow {
  if (!record(item)) return false;
  const row = item as ReleaseCoverageRow;
  return typeof row.release_label === "string"
    && typeof row.coverage_state === "string"
    && (row.registrants_observed === null || typeof row.registrants_observed === "number")
    && (row.reported_dates_observed === null || typeof row.reported_dates_observed === "number");
}

function isDate(item: unknown): item is DateCoverageRow {
  if (!record(item)) return false;
  const row = item as DateCoverageRow;
  return typeof row.reported_date === "string" && typeof row.registrants_observed === "number";
}

function isDateRegistrant(item: unknown): item is DateRegistrantRow {
  if (!record(item)) return false;
  try {
    assertMarketFields(item);
  } catch {
    return false;
  }
  const row = item as DateRegistrantRow;
  return typeof row.registrant_cik === "string" && typeof row.disclosed_line_count === "number";
}

function isReleaseDate(item: unknown): item is ReleaseDateRow {
  if (!record(item)) return false;
  try {
    assertMarketFields(item);
  } catch {
    return false;
  }
  const row = item as ReleaseDateRow;
  return typeof row.registrant_cik === "string" && typeof row.reported_date === "string" && typeof row.disclosed_line_count === "number";
}

function record(item: unknown): item is object {
  return item != null && typeof item === "object";
}
