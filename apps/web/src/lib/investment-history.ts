import type { ReviewObservation } from "@/lib/entity-review";

// Presentation of stored observations. It does not decide that two rows are the same investment.

export const HISTORY_EXPLANATION =
  "Historical observations are shown exactly as stored. Different disclosed names are kept separate; no identity or instrument resolution has been applied.";

export const FILING_LINK_MISSING = "SEC filing link not stored";

const COMPARED_FIELDS = ["principal", "cost", "fairValue", "interestRate", "spread"] as const;

export type HistoryField = (typeof COMPARED_FIELDS)[number];

export type HistoryChange = {
  field: HistoryField;
  previous: string;
  current: string;
};

export type HistoryRow = {
  id: string;
  reportedDate: string;
  registrantName: string;
  registrantCik: string;
  disclosedName: string;
  principal: string;
  cost: string;
  fairValue: string;
  interestRate: string;
  spread: string;
  percentOfNetAssets: string;
  filedDate: string;
  documentName: string;
  accessionNumber: string;
  documentUrl: string | null;
  maturity: string;
  acquisitionDate: string;
  instrumentResolution: string;
  changes: HistoryChange[];
};

export type InvestmentHistory = {
  rows: HistoryRow[];
  observationCount: number;
  disclosedNameVariants: number;
  registrantContexts: number;
  reportingPeriods: number;
  unmatchedMemberCount: number;
};

const ABSENT = new Set(["Not stored", "Unknown"]);

export function registrantLabel(observation: ReviewObservation): string {
  const names = observation.registrantNames.filter((name) => name.trim() !== "" && name !== "Not stored");
  return names.length === 0 ? "Not stored" : names.join("; ");
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en", { numeric: true, sensitivity: "variant" });
}

function contextKey(row: Pick<HistoryRow, "registrantCik" | "id">): string {
  if (row.registrantCik.trim() === "" || row.registrantCik === "Not stored") return `observation:${row.id}`;
  return row.registrantCik;
}

function comparisonKey(row: HistoryRow): string | null {
  if (row.registrantCik.trim() === "" || row.registrantCik === "Not stored") return null;
  if (row.disclosedName.trim() === "") return null;
  return `${row.registrantCik}\0${row.disclosedName}`;
}

function changesFrom(previous: HistoryRow, current: HistoryRow): HistoryChange[] {
  const changes: HistoryChange[] = [];
  for (const field of COMPARED_FIELDS) {
    if (previous[field] === current[field]) continue;
    changes.push({ field, previous: previous[field], current: current[field] });
  }
  return changes;
}

function baseRow(observation: ReviewObservation): HistoryRow {
  return {
    id: observation.id,
    reportedDate: observation.reportedDate,
    registrantName: registrantLabel(observation),
    registrantCik: observation.registrantCik,
    disclosedName: observation.sourceName,
    principal: observation.principal,
    cost: observation.cost,
    fairValue: observation.fairValue,
    interestRate: observation.interestRate,
    spread: observation.spread,
    percentOfNetAssets: observation.percentOfNetAssets,
    filedDate: observation.filedDate,
    documentName: observation.documentName,
    accessionNumber: observation.accessionNumber,
    documentUrl: observation.documentUrl,
    maturity: observation.maturity,
    acquisitionDate: observation.acquisitionDate,
    instrumentResolution: observation.instrumentResolution,
    changes: [],
  };
}

export function investmentHistory(
  observations: readonly ReviewObservation[],
  memberIds?: readonly string[],
): InvestmentHistory {
  const byId = new Map<string, ReviewObservation>();
  for (const observation of observations) {
    if (!byId.has(observation.id)) byId.set(observation.id, observation);
  }
  const allowed = memberIds == null ? null : new Set(memberIds);
  const selected = [...byId.values()].filter((observation) => allowed == null || allowed.has(observation.id));
  const sorted = selected.map(baseRow).sort((left, right) =>
    compareText(left.reportedDate, right.reportedDate)
    || compareText(left.registrantName, right.registrantName)
    || compareText(left.id, right.id),
  );
  const previousByKey = new Map<string, HistoryRow>();
  const rows: HistoryRow[] = [];
  for (const row of sorted) {
    const key = comparisonKey(row);
    const previous = key == null ? undefined : previousByKey.get(key);
    const next = previous == null ? row : { ...row, changes: changesFrom(previous, row) };
    rows.push(next);
    if (key != null) previousByKey.set(key, next);
  }
  const unmatchedMemberCount = allowed == null
    ? 0
    : [...allowed].filter((id) => !byId.has(id)).length;
  return {
    rows,
    observationCount: rows.length,
    disclosedNameVariants: new Set(rows.map((row) => row.disclosedName)).size,
    registrantContexts: new Set(rows.map(contextKey)).size,
    reportingPeriods: new Set(rows.map((row) => row.reportedDate)).size,
    unmatchedMemberCount,
  };
}

function absenceNote(label: string, values: readonly string[]): string | null {
  if (values.length === 0) return null;
  const distinct = new Set(values);
  if (distinct.size === 1 && distinct.has("Not stored")) return `${label} is not stored for these observations.`;
  if (distinct.size === 1 && distinct.has("Unknown")) return `${label} is Unknown for these observations.`;
  if ([...distinct].every((value) => ABSENT.has(value))) return `${label} is Unknown or not stored for these observations.`;
  return null;
}

function identityNote(label: string, value: string): string {
  if (value === "Not yet resolved" || value === "Unresolved") return `${label} is unresolved.`;
  return `${label}: ${value}.`;
}

export function historyCoverageNotes(
  history: InvestmentHistory,
  identity: { legalEntity: string; economicGroup: string },
): string[] {
  const notes = [
    "Principal, cost, fair value, interest rate, spread, and percent of net assets are shown only where stored.",
  ];
  const maturity = absenceNote("Maturity", history.rows.map((row) => row.maturity));
  const acquisition = absenceNote("Acquisition date", history.rows.map((row) => row.acquisitionDate));
  if (maturity) notes.push(maturity);
  if (acquisition) notes.push(acquisition);
  notes.push(identityNote("Legal entity", identity.legalEntity));
  notes.push(identityNote("Economic group", identity.economicGroup));
  const instrumentStates = new Set(history.rows.map((row) => row.instrumentResolution));
  const instrumentUnresolved = history.rows.length === 0 || [...instrumentStates].every((state) =>
    state === "Not yet resolved" || state === "Unresolved" || state === "Not stored",
  );
  notes.push(instrumentUnresolved ? "Instrument identity is unresolved." : "Instrument identity is not decided by this history.");
  return notes;
}

export function historyChange(row: HistoryRow, field: HistoryField): HistoryChange | undefined {
  return row.changes.find((change) => change.field === field);
}
