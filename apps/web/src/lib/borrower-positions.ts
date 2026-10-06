// Display rows for one legal entity's position observations.
// Values come from registry.borrower_position_observations. No totals and no ratios.

import { displayState, type ObservationRow } from "@/lib/borrowers";
import { CURRENCY_NOTE, maturitySourceLabel, maturityValue, secUrl } from "@/lib/portfolios";

export const POSITION_HISTORY_NOTE =
  "Each row is one stored position observation for this legal entity. A reporting period that is not listed was not observed.";
export const POSITION_VALUE_NOTE =
  "Principal, amortized cost, and fair value are shown only when stored. Cost is not derived from principal. Fair value is not derived from cost.";
export const RESEARCH_FIELD_NOTE =
  "Instrument type and industry are the stored values for that observation. A missing stored value stays Unknown.";
export const TIMELINE_NOTE =
  "Observations are listed by registrant and reporting period. A row stays separate when instrument identity or position continuity is unresolved.";
export const EVIDENCE_SCOPE_NOTE =
  "Instrument type and industry show field evidence when one stored head exists. The other fields on the row use the observation evidence and accession.";
export const EMPTY_POSITIONS = "No stored position observation is linked to this legal entity.";
export const ACQUISITION_LABEL = "Acquisition date";

const FORBIDDEN_KEY = /origination|fvr|ratio|exit|repay|score|rank|similarity|total|qoq|event_code/i;

export type PositionObservationRow = {
  legal_entity_id: string;
  position_observation_id: string;
  reported_date: string;
  accession_number: string;
  registrant_cik: string | null;
  registrant_link_status: string | null;
  entity_resolution_state: string;
  instrument_resolution_state: string;
  continuity_state: string;
  economic_group_state: string;
  principal_state: string;
  principal_raw: string | null;
  principal_currency_state: string | null;
  cost_state: string;
  cost_raw: string | null;
  cost_currency_state: string | null;
  fair_value_state: string;
  fair_value_raw: string | null;
  fair_value_currency_state: string | null;
  acquisition_state: string;
  acquisition_raw: string | null;
  acquisition_precision: string | null;
  interest_rate_state: string;
  interest_rate_raw: string | null;
  spread_state: string;
  spread_raw: string | null;
  interest_rate_floor_state: string;
  interest_rate_floor_raw: string | null;
  maturity_source: string;
  maturity_raw: string | null;
  maturity_precision: string | null;
  maturity_filing_verified: boolean;
  maturity_document_url: string | null;
  observation_evidence_level: string;
};

export type ResearchFieldRow = {
  position_observation_id: string;
  field_code: string;
  raw_value: string | null;
  value_state: string;
  evidence_level: string;
};

export type StoredField = {
  text: string;
  evidenceLabel: string | null;
};

export type HistoricalPosition = {
  id: string;
  reportedDate: string;
  registrantCik: string;
  entityState: string;
  economicGroupState: string;
  instrumentState: string;
  continuityState: string;
  instrumentType: StoredField;
  industry: StoredField;
  principal: string;
  principalCurrency: string | null;
  cost: string;
  costCurrency: string | null;
  fairValue: string;
  fairValueCurrency: string | null;
  acquisition: string;
  maturity: string;
  maturitySource: string | null;
  maturityDocumentUrl: string | null;
  interestRate: string;
  spread: string;
  interestRateFloor: string;
  accessionNumber: string;
  documentUrl: string | null;
  evidenceLabel: string;
};

export type PositionGroup = {
  key: string;
  registrantCik: string;
  positions: HistoricalPosition[];
};

export function assertPositionFields(row: object) {
  for (const key of Object.keys(row)) {
    if (FORBIDDEN_KEY.test(key)) throw new Error(`position observation field is not displayable: ${key}`);
  }
}

function observedValue(state: string, raw: string | null): string {
  if (state === "REPORTED" && raw != null && raw.trim() !== "") return raw;
  if (state === "MULTIPLE_VALUES") return "Multiple values";
  if (state === "NOT_APPLICABLE") return "Not applicable";
  return "Unknown";
}

function currencyNote(state: string, raw: string | null, currencyState: string | null): string | null {
  if (observedValue(state, raw) === "Unknown" || observedValue(state, raw) === "Not applicable") return null;
  if (observedValue(state, raw) === "Multiple values") return null;
  if (currencyState == null || currencyState === "UNKNOWN" || currencyState.trim() === "") return CURRENCY_NOTE;
  return null;
}

function evidenceLabel(level: string): string {
  if (level === "L2_ORIGINAL_FILING") return "Original EDGAR filing";
  if (level === "L1_STRUCTURED_DATASET") return "Structured SEC data set";
  return "Unknown";
}

export function storedField(rows: ResearchFieldRow[]): StoredField {
  if (rows.length === 0) return { text: "Unknown", evidenceLabel: null };
  if (rows.length !== 1) return { text: "Multiple values", evidenceLabel: null };
  const row = rows[0];
  if (row.value_state === "REPORTED" && row.raw_value != null && row.raw_value.trim() !== "") {
    return { text: row.raw_value, evidenceLabel: evidenceLabel(row.evidence_level) };
  }
  if (row.value_state === "NOT_APPLICABLE") return { text: "Not applicable", evidenceLabel: null };
  return { text: "Unknown", evidenceLabel: null };
}

function fieldsFor(research: ResearchFieldRow[], positionId: string, fieldCode: string): ResearchFieldRow[] {
  return research.filter((row) => row.position_observation_id === positionId && row.field_code === fieldCode);
}

function documentByAccession(listings: ObservationRow[], legalEntityId: string): Map<string, string | null> {
  const docs = new Map<string, string | null>();
  for (const listing of listings) {
    if (listing.legal_entity_id !== legalEntityId) continue;
    const url = secUrl(listing.document_url);
    const current = docs.get(listing.accession_number);
    if (current === undefined) docs.set(listing.accession_number, url);
    else if (current !== url) docs.set(listing.accession_number, null);
  }
  return docs;
}

function cikSort(cik: string): string {
  return cik === "Unknown" ? "\uffff" : cik;
}

export function historicalPositions(
  rows: PositionObservationRow[],
  listings: ObservationRow[],
  legalEntityId: string,
  research: ResearchFieldRow[] = [],
): HistoricalPosition[] {
  for (const field of research) {
    if (FORBIDDEN_KEY.test(field.field_code)) throw new Error(`position observation field is not displayable: ${field.field_code}`);
  }
  const documents = documentByAccession(listings, legalEntityId);
  const positions: HistoricalPosition[] = [];
  for (const row of rows) {
    assertPositionFields(row);
    if (row.legal_entity_id !== legalEntityId || row.entity_resolution_state !== "MATCHED") continue;
    const linked = row.registrant_link_status === "LINKED" && Boolean(row.registrant_cik);
    positions.push({
      id: row.position_observation_id,
      reportedDate: row.reported_date,
      registrantCik: linked && row.registrant_cik ? row.registrant_cik : "Unknown",
      entityState: displayState(row.entity_resolution_state),
      economicGroupState: displayState(row.economic_group_state),
      instrumentState: displayState(row.instrument_resolution_state),
      continuityState: displayState(row.continuity_state),
      instrumentType: storedField(fieldsFor(research, row.position_observation_id, "INSTRUMENT_TYPE")),
      industry: storedField(fieldsFor(research, row.position_observation_id, "INDUSTRY")),
      principal: observedValue(row.principal_state, row.principal_raw),
      principalCurrency: currencyNote(row.principal_state, row.principal_raw, row.principal_currency_state),
      cost: observedValue(row.cost_state, row.cost_raw),
      costCurrency: currencyNote(row.cost_state, row.cost_raw, row.cost_currency_state),
      fairValue: observedValue(row.fair_value_state, row.fair_value_raw),
      fairValueCurrency: currencyNote(row.fair_value_state, row.fair_value_raw, row.fair_value_currency_state),
      acquisition: observedValue(row.acquisition_state, row.acquisition_raw),
      maturity: maturityValue(row.maturity_source, row.maturity_raw),
      maturitySource: maturitySourceLabel(row.maturity_source, row.maturity_filing_verified),
      maturityDocumentUrl: secUrl(row.maturity_document_url),
      interestRate: observedValue(row.interest_rate_state, row.interest_rate_raw),
      spread: observedValue(row.spread_state, row.spread_raw),
      interestRateFloor: observedValue(row.interest_rate_floor_state, row.interest_rate_floor_raw),
      accessionNumber: row.accession_number,
      documentUrl: documents.get(row.accession_number) ?? null,
      evidenceLabel: evidenceLabel(row.observation_evidence_level),
    });
  }
  positions.sort((a, b) =>
    b.reportedDate.localeCompare(a.reportedDate)
    || cikSort(a.registrantCik).localeCompare(cikSort(b.registrantCik))
    || a.accessionNumber.localeCompare(b.accessionNumber)
    || a.id.localeCompare(b.id));
  return positions;
}

export function periodBands(positions: HistoricalPosition[]): { reportedDate: string; positions: HistoricalPosition[] }[] {
  const bands: { reportedDate: string; positions: HistoricalPosition[] }[] = [];
  for (const row of positions) {
    const last = bands[bands.length - 1];
    if (last && last.reportedDate === row.reportedDate) last.positions.push(row);
    else bands.push({ reportedDate: row.reportedDate, positions: [row] });
  }
  return bands;
}

export function positionGroups(positions: HistoricalPosition[]): PositionGroup[] {
  const groups = new Map<string, HistoricalPosition[]>();
  for (const row of positions) {
    const list = groups.get(row.registrantCik) ?? [];
    list.push(row);
    groups.set(row.registrantCik, list);
  }
  return [...groups.entries()].map(([registrantCik, grouped]) => ({
    key: registrantCik,
    registrantCik,
    positions: grouped,
  }));
}
