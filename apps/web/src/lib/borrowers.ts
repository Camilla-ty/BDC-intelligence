// Maps borrower-listing rows into display models. No financial arithmetic.
// Unknown stays the word Unknown. A missing date is omitted, not shown as zero.

import { EDGAR_ARCHIVES_PREFIX, secUrl } from "@/lib/portfolios";

export const FIRST_OBSERVED_EVENT = "REGISTRANT_FIRST_OBSERVED_NAME";
export const EDGAR_DOCUMENT_PREFIX = EDGAR_ARCHIVES_PREFIX;
export const ABSENT_EVENT_LABEL = "Not a first-observed event";
export const VALUATION_NOTE =
  "Cost and fair value in the historical observations are stored disclosures. They are not derived, and currency authority remains open.";
export const COVERAGE_NOTE = "A date that is not listed was not observed. It is not zero exposure.";
export const EVENT_SCOPE_NOTE =
  "Registrant first observed applies only to stored observations in this slice. It does not establish an instrument.";
export const ENTITY_NOTE = "A matched legal entity is not a matched instrument.";
export const COUNT_NOTE =
  "The stored-observation count is the number of stored name rows. Linked registrants and observed dates are counted inside those rows. They are not exposure, coverage, or active holdings.";
export const SEARCH_NOTE =
  "Results are stored names that contain this text. A partial name is not a resolved entity match.";
export const EMPTY_SEARCH = "No stored borrower name contains this text.";
export const EMPTY_LIST = "No stored borrowers are available.";
export const CIK_NOTE = "CIK identifies the filing registrant, not the borrower.";
export const DOCUMENT_URL_UNKNOWN = "Document URL Unknown";

const FORBIDDEN_FIELD = /cost|fair|principal|amount|ebitda|leverage|rating|sponsor|ownership/i;

export type ObservationRow = {
  legal_entity_id: string;
  alias_text: string;
  verification_state: string;
  entity_resolution_state: string;
  entity_resolution_method: string;
  reported_date: string;
  accession_number: string;
  document_name: string | null;
  document_url: string | null;
  registrant_link_status: string | null;
  registrant_cik: string | null;
  registrant_name: string | null;
  instrument_resolution_state: string;
  instrument_resolution_method: string | null;
  instrument_type_state: string;
  event_code: string | null;
  observation_evidence_level: string;
  name_validation_outcome: string | null;
};

export type BorrowerSummary = {
  id: string;
  name: string;
  entityState: string;
  entityMethod: string;
  instrumentState: string;
  instrumentMethod: string;
  linkedRegistrants: string;
  observedDates: string;
  storedObservations: string;
};

export type HistoryRow = {
  key: string;
  reportedDate: string;
  accessionNumber: string;
  documentUrl: string | null;
  registrantName: string;
  registrantCik: string;
  linkStatus: string;
  eventLabel: string | null;
};

export type RegistrantGroup = {
  name: string;
  cik: string;
  linkStatus: string;
  history: HistoryRow[];
};

export type BorrowerDetail = {
  id: string;
  name: string;
  entityState: string;
  entityMethod: string;
  instrumentState: string;
  instrumentMethod: string;
  instrumentType: string;
  registrants: RegistrantGroup[];
  history: HistoryRow[];
  events: HistoryRow[];
};

export type SourceRow = {
  key: string;
  reportedDate: string;
  accessionNumber: string;
  documentName: string;
  documentUrl: string | null;
  evidenceLabel: string;
  nameCheck: string;
};

export function assertListingFields(row: object) {
  for (const key of Object.keys(row)) {
    if (FORBIDDEN_FIELD.test(key)) {
      throw new Error(`borrower listing field is not displayable: ${key}`);
    }
  }
}

export function displayState(value: string | null | undefined): string {
  if (value == null || value.trim() === "") return "Unknown";
  if (value === "UNRESOLVED") return "Unresolved";
  if (value === "UNKNOWN") return "Unknown";
  if (value === "MATCHED") return "Matched";
  if (value === "REPORTED") return "Reported";
  return value;
}

function countLabel(n: number): string {
  if (n === 0) return "Unknown";
  return String(n);
}

function edgarUrl(url: string | null): string | null {
  return secUrl(url);
}

function oneValue(values: Array<string | null | undefined>): string | null {
  const set = new Set(values.map((value) => value ?? ""));
  if (set.size !== 1) return null;
  const only = [...set][0];
  return only.trim() === "" ? null : only;
}

function linkLabel(status: string | null): string {
  if (status === "LINKED") return "Linked";
  if (status === "MULTIPLE") return "Multiple";
  return displayState(status);
}

function historyFrom(row: ObservationRow, index: number): HistoryRow {
  const linked = row.registrant_link_status === "LINKED" && Boolean(row.registrant_cik);
  return {
    key: `${row.reported_date}|${row.accession_number}|${index}`,
    reportedDate: row.reported_date,
    accessionNumber: row.accession_number,
    documentUrl: edgarUrl(row.document_url),
    registrantName: linked && row.registrant_name && row.registrant_name.trim() !== "" ? row.registrant_name : "Unknown",
    registrantCik: linked && row.registrant_cik ? row.registrant_cik : "Unknown",
    linkStatus: linkLabel(row.registrant_link_status),
    eventLabel: row.event_code === FIRST_OBSERVED_EVENT ? "Registrant first observed" : null,
  };
}

function instrumentFields(group: ObservationRow[]) {
  const state = oneValue(group.map((row) => row.instrument_resolution_state));
  const method = oneValue(group.map((row) => row.instrument_resolution_method));
  const typeState = oneValue(group.map((row) => row.instrument_type_state));
  return {
    instrumentState: displayState(state ?? "UNRESOLVED"),
    instrumentMethod: method ?? "Unknown",
    instrumentType: typeState === "REPORTED" ? "Reported" : "Unknown",
  };
}

export function listBorrowers(rows: ObservationRow[], query: string): BorrowerSummary[] {
  for (const row of rows) assertListingFields(row);
  const needle = query.trim().toLowerCase();
  const byId = new Map<string, ObservationRow[]>();
  for (const row of rows) {
    if (needle !== "" && !row.alias_text.toLowerCase().includes(needle)) continue;
    const group = byId.get(row.legal_entity_id) ?? [];
    group.push(row);
    byId.set(row.legal_entity_id, group);
  }
  const summaries: BorrowerSummary[] = [];
  for (const [id, group] of byId) {
    const ciks = new Set(
      group
        .filter((row) => row.registrant_link_status === "LINKED" && row.registrant_cik)
        .map((row) => row.registrant_cik as string),
    );
    const dates = new Set(group.map((row) => row.reported_date).filter((date) => date !== ""));
    const entityState = oneValue(group.map((row) => row.entity_resolution_state));
    const entityMethod = oneValue(group.map((row) => row.entity_resolution_method));
    summaries.push({
      id,
      name: group[0].alias_text,
      entityState: displayState(entityState ?? "UNRESOLVED"),
      entityMethod: entityMethod ?? "Unknown",
      ...instrumentFields(group),
      linkedRegistrants: countLabel(ciks.size),
      observedDates: countLabel(dates.size),
      storedObservations: countLabel(group.length),
    });
  }
  summaries.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return summaries;
}

export function borrowerDetail(rows: ObservationRow[], id: string): BorrowerDetail | null {
  const group = rows.filter((row) => row.legal_entity_id === id);
  if (group.length === 0) return null;
  for (const row of group) assertListingFields(row);
  const history = group
    .map((row, index) => historyFrom(row, index))
    .sort((a, b) => a.reportedDate.localeCompare(b.reportedDate) || a.accessionNumber.localeCompare(b.accessionNumber) || a.key.localeCompare(b.key));
  const registrants = new Map<string, RegistrantGroup>();
  for (const row of history) {
    const key = row.registrantCik === "Unknown" ? `unknown:${row.key}` : row.registrantCik;
    const existing = registrants.get(key);
    if (!existing) {
      registrants.set(key, {
        name: row.registrantName,
        cik: row.registrantCik,
        linkStatus: row.linkStatus,
        history: [row],
      });
      continue;
    }
    if (existing.name !== row.registrantName) existing.name = "Unknown";
    if (existing.linkStatus !== row.linkStatus) existing.linkStatus = "Unknown";
    existing.history.push(row);
  }
  const entityState = oneValue(group.map((row) => row.entity_resolution_state));
  const entityMethod = oneValue(group.map((row) => row.entity_resolution_method));
  return {
    id,
    name: group[0].alias_text,
    entityState: displayState(entityState ?? "UNRESOLVED"),
    entityMethod: entityMethod ?? "Unknown",
    ...instrumentFields(group),
    registrants: [...registrants.values()].sort((a, b) => a.name.localeCompare(b.name) || a.cik.localeCompare(b.cik)),
    history,
    events: history.filter((row) => row.eventLabel != null),
  };
}

export function sourceRows(rows: ObservationRow[], id: string): SourceRow[] {
  return rows
    .filter((row) => row.legal_entity_id === id)
    .map((row, index) => {
      assertListingFields(row);
      return {
        key: `${row.reported_date}|${row.accession_number}|${index}`,
        reportedDate: row.reported_date,
        accessionNumber: row.accession_number,
        documentName: row.document_name && row.document_name.trim() !== "" ? row.document_name : "Unknown",
        documentUrl: edgarUrl(row.document_url),
        evidenceLabel: evidenceLabel(row.observation_evidence_level),
        nameCheck: nameCheckLabel(row.name_validation_outcome),
      };
    })
    .sort((a, b) => a.reportedDate.localeCompare(b.reportedDate) || a.accessionNumber.localeCompare(b.accessionNumber) || a.key.localeCompare(b.key));
}

function evidenceLabel(level: string): string {
  if (level === "L2_ORIGINAL_FILING") return "Original EDGAR filing";
  if (level === "L1_STRUCTURED_DATASET") return "Structured SEC data set";
  return "Unknown";
}

function nameCheckLabel(outcome: string | null): string {
  if (outcome === "PASS") return "Identifier text found in the filing document";
  if (outcome === "FAIL") return "Identifier text was not found in the filing document";
  if (outcome === "NOT_EVALUATED" || outcome == null || outcome.trim() === "") return "Not checked";
  if (outcome === "NOT_APPLICABLE") return "Not applicable";
  return "Unknown";
}
