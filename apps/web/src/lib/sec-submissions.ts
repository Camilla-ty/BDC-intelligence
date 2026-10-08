// Pure SEC submissions JSON parsing for Admin Phase 1-A.
// Columnar filings.recent / page arrays → row objects. No DB writes.
// Documented/observed field inventory: docs/SOURCE_SCHEMAS.md §7 / §8.

import {
  ACCESSION_PATTERN,
  ARCHIVES_PREFIX,
  SUBMISSIONS_FILING_KEYS,
  padCik,
} from "@/server/sec/config";

export type SecFilingRow = {
  accessionNumber: string;
  form: string;
  filingDate: string;
  reportDate: string | null;
  acceptanceDateTime: string | null;
  primaryDocument: string | null;
  primaryDocumentUrl: string | null;
  filingIndexUrl: string | null;
};

export type SecHistoryFile = {
  name: string;
  filingCount: number | null;
  filingFrom: string | null;
  filingTo: string | null;
};

export type SecSubmissionsCoverage = {
  cik: string;
  registrantName: string | null;
  sourceUrl: string;
  fetchedAt: string;
  recentCount: number;
  historyFiles: SecHistoryFile[];
  historyPagesFetched: number;
  historyPagesSkipped: number;
  /** Inclusive bounds from recent + fetched history page metadata when available. */
  coverageFrom: string | null;
  coverageTo: string | null;
  filings: SecFilingRow[];
  /** Explicit statement of what this list represents. */
  coverageNote: string;
};

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function checkFilingArrays(obj: Record<string, unknown>, where: string): { ok: true; length: number } | { ok: false; reason: string } {
  const missing = SUBMISSIONS_FILING_KEYS.filter((key) => !Array.isArray(obj[key]));
  if (missing.length) return { ok: false, reason: `${where} lacks arrays: ${missing.join(", ")}` };
  const lengths = new Set(SUBMISSIONS_FILING_KEYS.map((key) => (obj[key] as unknown[]).length));
  if (lengths.size !== 1) return { ok: false, reason: `${where} arrays have different lengths` };
  return { ok: true, length: (obj.accessionNumber as unknown[]).length };
}

/** Registrant CIK path segment without leading zeros (SOURCE_SCHEMAS §8 observed). */
export function archivesCikPath(cik: string): string {
  const padded = padCik(cik);
  const stripped = padded.replace(/^0+/, "");
  return stripped === "" ? "0" : stripped;
}

export function accessionNoDashes(accession: string): string | null {
  if (!ACCESSION_PATTERN.test(accession)) return null;
  return accession.replace(/-/g, "");
}

/**
 * Primary document URL from documented EDGAR folder + submissions primaryDocument.
 * Rejects path separators and ".." in the document name.
 */
export function primaryDocumentUrl(cik: string, accession: string, primaryDocument: string | null): string | null {
  const doc = asNonEmptyString(primaryDocument);
  if (doc == null) return null;
  if (/[/\\]/.test(doc) || doc.includes("..")) return null;
  const folder = accessionNoDashes(accession);
  if (folder == null) return null;
  return `${ARCHIVES_PREFIX}${archivesCikPath(cik)}/${folder}/${doc}`;
}

/** Filing index HTML from documented EDGAR folder layout (SOURCE_SCHEMAS §8). */
export function filingIndexUrl(cik: string, accession: string): string | null {
  const folder = accessionNoDashes(accession);
  if (folder == null) return null;
  return `${ARCHIVES_PREFIX}${archivesCikPath(cik)}/${folder}/${accession}-index.html`;
}

export function viewSecFilingUrl(row: Pick<SecFilingRow, "primaryDocumentUrl" | "filingIndexUrl">): string | null {
  return row.primaryDocumentUrl ?? row.filingIndexUrl;
}

export function rowsFromFilingArrays(
  arrays: Record<string, unknown>,
  registrantCik: string,
  where: string,
): { rows: SecFilingRow[]; error: string | null } {
  const check = checkFilingArrays(arrays, where);
  if (!check.ok) return { rows: [], error: check.reason };

  const accessionNumber = arrays.accessionNumber as unknown[];
  const filingDate = arrays.filingDate as unknown[];
  const reportDate = arrays.reportDate as unknown[];
  const acceptanceDateTime = arrays.acceptanceDateTime as unknown[];
  const form = arrays.form as unknown[];
  const primaryDocument = arrays.primaryDocument as unknown[];

  const rows: SecFilingRow[] = [];
  for (let i = 0; i < check.length; i += 1) {
    const accession = asNonEmptyString(accessionNumber[i]);
    if (accession == null || !ACCESSION_PATTERN.test(accession)) {
      // Malformed: do not invent a valid filing row.
      continue;
    }
    const formValue = asNonEmptyString(form[i]);
    const filed = asNonEmptyString(filingDate[i]);
    if (formValue == null || filed == null) continue;

    const primary = asNonEmptyString(primaryDocument[i]);
    rows.push({
      accessionNumber: accession,
      form: formValue,
      filingDate: filed,
      reportDate: asNonEmptyString(reportDate[i]),
      acceptanceDateTime: asNonEmptyString(acceptanceDateTime[i]),
      primaryDocument: primary,
      primaryDocumentUrl: primaryDocumentUrl(registrantCik, accession, primary),
      filingIndexUrl: filingIndexUrl(registrantCik, accession),
    });
  }
  return { rows, error: null };
}

export function parseSubmissionsMain(
  json: unknown,
  expectedCik: string,
): {
  cik: string;
  registrantName: string | null;
  recent: Record<string, unknown> | null;
  files: SecHistoryFile[];
  error: string | null;
} {
  if (json == null || typeof json !== "object" || Array.isArray(json)) {
    return { cik: padCik(expectedCik), registrantName: null, recent: null, files: [], error: "submissions JSON is not an object" };
  }
  const body = json as Record<string, unknown>;
  const cik = padCik(expectedCik);
  if (asNonEmptyString(body.cik) !== cik) {
    return { cik, registrantName: null, recent: null, files: [], error: "cik does not equal the CIK in the URL" };
  }
  const filings = body.filings;
  if (filings == null || typeof filings !== "object" || Array.isArray(filings)) {
    return { cik, registrantName: asNonEmptyString(body.name), recent: null, files: [], error: "filings object is missing" };
  }
  const filingsObj = filings as Record<string, unknown>;
  const recent = filingsObj.recent;
  if (recent == null || typeof recent !== "object" || Array.isArray(recent)) {
    return { cik, registrantName: asNonEmptyString(body.name), recent: null, files: [], error: "no filings.recent" };
  }
  const filesRaw = Array.isArray(filingsObj.files) ? filingsObj.files : null;
  if (filesRaw == null) {
    return { cik, registrantName: asNonEmptyString(body.name), recent: null, files: [], error: "filings.files is not an array" };
  }
  const files: SecHistoryFile[] = filesRaw.map((entry) => {
    if (entry == null || typeof entry !== "object" || Array.isArray(entry)) {
      return { name: "", filingCount: null, filingFrom: null, filingTo: null };
    }
    const row = entry as Record<string, unknown>;
    return {
      name: asNonEmptyString(row.name) ?? "",
      filingCount: typeof row.filingCount === "number" && Number.isFinite(row.filingCount) ? row.filingCount : null,
      filingFrom: asNonEmptyString(row.filingFrom),
      filingTo: asNonEmptyString(row.filingTo),
    };
  });
  return {
    cik,
    registrantName: asNonEmptyString(body.name),
    recent: recent as Record<string, unknown>,
    files,
    error: null,
  };
}

export function parseSubmissionsPage(json: unknown): { arrays: Record<string, unknown> | null; error: string | null } {
  if (json == null || typeof json !== "object" || Array.isArray(json)) {
    return { arrays: null, error: "history page JSON is not an object" };
  }
  return { arrays: json as Record<string, unknown>, error: null };
}

function minDate(values: Array<string | null | undefined>): string | null {
  const dates = values.filter((v): v is string => typeof v === "string" && v !== "");
  if (dates.length === 0) return null;
  return dates.reduce((a, b) => (a < b ? a : b));
}

function maxDate(values: Array<string | null | undefined>): string | null {
  const dates = values.filter((v): v is string => typeof v === "string" && v !== "");
  if (dates.length === 0) return null;
  return dates.reduce((a, b) => (a > b ? a : b));
}

export function buildCoverageNote(args: {
  recentCount: number;
  historyFiles: SecHistoryFile[];
  historyPagesFetched: number;
  historyPagesSkipped: number;
  coverageFrom: string | null;
  coverageTo: string | null;
}): string {
  const parts = [
    `SEC submissions recent window: ${args.recentCount} filing(s)`,
    `history file entries listed by SEC: ${args.historyFiles.length}`,
    `history pages fetched: ${args.historyPagesFetched}`,
  ];
  if (args.historyPagesSkipped > 0) {
    parts.push(`history pages skipped (name outside observed pattern): ${args.historyPagesSkipped}`);
  }
  if (args.coverageFrom && args.coverageTo) {
    parts.push(`filing-date span in this list: ${args.coverageFrom} to ${args.coverageTo}`);
  }
  if (args.historyFiles.length > 0 && args.historyPagesFetched < args.historyFiles.length - args.historyPagesSkipped) {
    parts.push("This list is incomplete relative to filings.files[].");
  } else if (args.historyFiles.length === 0) {
    parts.push(
      "Only filings.recent was available (SEC documents this as at least one year or 1,000 filings, whichever is more). Older history files were not listed.",
    );
  } else if (args.historyPagesSkipped > 0) {
    parts.push("Some history file names were not fetched because they are outside the observed CIK##########-submissions-###.json pattern.");
  } else {
    parts.push("This list includes filings.recent plus every fetched filings.files[] history page.");
  }
  parts.push(
    "BDC Flow reconciliation, when available, matches this SEC list to inventory by exact accession number only.",
  );
  return parts.join(" ");
}

export function assembleCoverage(args: {
  cik: string;
  registrantName: string | null;
  sourceUrl: string;
  fetchedAt: string;
  recentRows: SecFilingRow[];
  historyFiles: SecHistoryFile[];
  historyPageRows: SecFilingRow[][];
  historyPagesFetched: number;
  historyPagesSkipped: number;
}): SecSubmissionsCoverage {
  const filings = [...args.recentRows, ...args.historyPageRows.flat()];
  const coverageFrom = minDate([
    ...filings.map((f) => f.filingDate),
    ...args.historyFiles.map((f) => f.filingFrom),
  ]);
  const coverageTo = maxDate([
    ...filings.map((f) => f.filingDate),
    ...args.historyFiles.map((f) => f.filingTo),
  ]);
  return {
    cik: args.cik,
    registrantName: args.registrantName,
    sourceUrl: args.sourceUrl,
    fetchedAt: args.fetchedAt,
    recentCount: args.recentRows.length,
    historyFiles: args.historyFiles,
    historyPagesFetched: args.historyPagesFetched,
    historyPagesSkipped: args.historyPagesSkipped,
    coverageFrom,
    coverageTo,
    filings,
    coverageNote: buildCoverageNote({
      recentCount: args.recentRows.length,
      historyFiles: args.historyFiles,
      historyPagesFetched: args.historyPagesFetched,
      historyPagesSkipped: args.historyPagesSkipped,
      coverageFrom,
      coverageTo,
    }),
  };
}
