import { CIK_NOTE, CURRENCY_NOTE, maturityValue, secUrl } from "@/lib/portfolios";

// A review candidate asks a researcher to compare source observations.
// It is not an identity decision. resolution.match_candidate is not used:
// a LEGAL_ENTITY candidate requires an existing legal entity and a run.

export const REVIEW_PROTOTYPE_NOTE = "Review workflow prototype — no Production write";
export const CANDIDATE_NOTE =
  "These source observations may represent the same borrower. Similarity is not identity. Researcher review is required.";
export const NOT_RESOLVED_NOTE = "Not yet resolved. This candidate is not a canonical borrower.";
export const BORROWER_INSTRUMENT_NOTE =
  "Borrower identity and instrument identity are separate. A disclosed line is not a resolved borrower, and it is not a resolved instrument. Different investment descriptors stay separate.";
export const IMMUTABILITY_NOTE =
  "A future researcher decision would keep every source observation. Stored observations are not merged or deleted.";
export const FILING_CELL_NOTE =
  "Company-cell text and HTML row locators are not available to this read role. This page does not create or change that evidence.";
export const RATE_SCALE_NOTE = "A stored rate with unresolved scale is shown as stored. It is not a normalized percent.";
export const CIK_REVIEW_NOTE = CIK_NOTE;

export const REVIEW_WRITES_ENABLED = false;

export const REVIEW_ACTIONS = [
  { id: "RESOLVED_SAME", label: "Same company" },
  { id: "RESOLVED_DIFFERENT", label: "Different companies" },
  { id: "DEFERRED", label: "Defer / need more evidence" },
] as const;

export type ReviewStatus = "OPEN" | "RESOLVED_SAME" | "RESOLVED_DIFFERENT" | "DEFERRED";

export type ReviewScope = {
  registrantCik: string;
  reportedDate: string;
};

export type EntityReviewCandidate = {
  id: string;
  type: "BORROWER";
  status: ReviewStatus;
  source: "MANUAL_SEED";
  ruleVersion: null;
  label: string;
  descriptors: readonly string[];
  // Registrant and reported date only. The portfolio view cannot filter a
  // descriptor across every filing within the reader timeout.
  scopes: readonly ReviewScope[];
};

const GEO_PARENT: EntityReviewCandidate = {
  id: "geo-parent-corporation",
  type: "BORROWER",
  status: "OPEN",
  source: "MANUAL_SEED",
  ruleVersion: null,
  label: "Geo Parent Corporation",
  descriptors: [
    "Geo Parent Corporation",
    "Geo Parent Corporation, First Lien",
    "Geo Parent Corporation, First Lien 1",
    "Geo Parent Corporation, First Lien 2",
  ],
  scopes: [
    { registrantCik: "0000017313", reportedDate: "2022-03-31" },
    { registrantCik: "0000017313", reportedDate: "2022-09-30" },
    { registrantCik: "0000017313", reportedDate: "2022-12-31" },
    { registrantCik: "0000017313", reportedDate: "2023-03-31" },
    { registrantCik: "0001766037", reportedDate: "2022-12-31" },
    { registrantCik: "0001766037", reportedDate: "2023-12-31" },
    { registrantCik: "0001766037", reportedDate: "2024-03-31" },
    { registrantCik: "0001766037", reportedDate: "2024-06-30" },
    { registrantCik: "0001766037", reportedDate: "2024-09-30" },
    { registrantCik: "0001925531", reportedDate: "2023-12-31" },
    { registrantCik: "0001925531", reportedDate: "2024-03-31" },
    { registrantCik: "0001925531", reportedDate: "2024-06-30" },
    { registrantCik: "0001925531", reportedDate: "2024-09-30" },
    { registrantCik: "0001976719", reportedDate: "2023-12-31" },
    { registrantCik: "0001976719", reportedDate: "2024-03-31" },
    { registrantCik: "0001976719", reportedDate: "2024-06-30" },
    { registrantCik: "0001976719", reportedDate: "2024-09-30" },
  ],
};

export const ENTITY_REVIEW_CANDIDATES: readonly EntityReviewCandidate[] = [GEO_PARENT];

export function entityReviewCandidate(id: string): EntityReviewCandidate | null {
  return ENTITY_REVIEW_CANDIDATES.find((candidate) => candidate.id === id) ?? null;
}

const SAFE_DESCRIPTOR = /^[ -~]+$/;

function quoteLiteral(value: string): string {
  if (!SAFE_DESCRIPTOR.test(value) || value.includes(";")) {
    throw new Error("Review descriptor cannot be queried.");
  }
  return `'${value.replaceAll("'", "''")}'`;
}

const LINE_COLUMNS = `position_observation_id,
         registrant_cik,
         reported_date,
         disclosed_line_text,
         accession_number,
         evidence_level,
         form_state,
         form_raw,
         filed_date_state,
         filed_date_raw,
         inline_url_state,
         inline_url,
         document_name,
         document_url`;

function scopeClause(scope: ReviewScope): string {
  if (!/^[0-9]{10}$/.test(scope.registrantCik) || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(scope.reportedDate)) {
    throw new Error("Review scope cannot be queried.");
  }
  return `registrant_cik = '${scope.registrantCik}' AND reported_date = '${scope.reportedDate}'`;
}

export function entityReviewSql(candidate: EntityReviewCandidate): string {
  if (candidate.scopes.length === 0) throw new Error("Review scope cannot be queried.");
  const list = candidate.descriptors.map(quoteLiteral).join(", ");
  const branches = candidate.scopes
    .map((scope) => `SELECT ${LINE_COLUMNS}
  FROM registry.portfolio_line
  WHERE ${scopeClause(scope)}
    AND disclosed_line_text IN (${list})`)
    .join("\nUNION ALL\n");
  return `
SET ROLE bdc_reader;
SET statement_timeout = '120s';
WITH matched AS MATERIALIZED (
  ${branches}
)
SELECT json_build_object(
  'lines', COALESCE((SELECT json_agg(row_to_json(line)) FROM (
    SELECT position_observation_id::text,
           registrant_cik,
           reported_date::text,
           disclosed_line_text,
           accession_number,
           evidence_level,
           form_state,
           form_raw,
           filed_date_state,
           filed_date_raw,
           inline_url_state,
           inline_url,
           document_name,
           document_url
    FROM matched
    ORDER BY disclosed_line_text, reported_date, accession_number, position_observation_id
  ) line), '[]'::json),
  'fields', COALESCE((SELECT json_agg(row_to_json(field)) FROM (
    SELECT position_observation_id::text,
           field_code,
           raw_value,
           value_state::text,
           scale_state::text,
           source_column_label
    FROM obs.current_position_field_value
    WHERE position_observation_id IN (SELECT position_observation_id FROM matched)
      AND field_code IN (
        'PRINCIPAL_AMOUNT', 'COST', 'FAIR_VALUE', 'INTEREST_RATE', 'SPREAD',
        'INSTRUMENT_TYPE', 'INDUSTRY', 'GEOGRAPHY', 'ACQUISITION_DATE', 'ISSUER_AFFILIATION', 'MATURITY_DATE'
      )
  ) field), '[]'::json),
  'names', COALESCE((SELECT json_agg(row_to_json(name)) FROM (
    SELECT DISTINCT lpad(cik::text, 10, '0') AS registrant_cik, name_raw
    FROM registry.current_registrant_name_history
    WHERE cik IN (SELECT DISTINCT registrant_cik::bigint FROM matched)
  ) name), '[]'::json),
  'instruments', COALESCE((SELECT json_agg(row_to_json(instrument)) FROM (
    SELECT position_observation_id::text, state::text
    FROM resolution.current_instrument_resolution
    WHERE position_observation_id IN (SELECT position_observation_id FROM matched)
  ) instrument), '[]'::json),
  'maturity', COALESCE((SELECT json_agg(row_to_json(maturity)) FROM (
    SELECT position_observation_id::text, maturity_source, maturity_raw
    FROM registry.maturity_read
    WHERE position_observation_id IN (SELECT position_observation_id FROM matched)
  ) maturity), '[]'::json),
  'entity_resolution_count', (SELECT count(*)::int FROM resolution.current_entity_resolution),
  'group_membership_count', (SELECT count(*)::int FROM resolution.current_group_membership)
);
RESET ROLE;
`;
}

export type ReviewLine = {
  position_observation_id: string;
  registrant_cik: string;
  reported_date: string;
  disclosed_line_text: string;
  accession_number: string;
  evidence_level: string;
  form_state: string;
  form_raw: string | null;
  filed_date_state: string;
  filed_date_raw: string | null;
  inline_url_state: string;
  inline_url: string | null;
  document_name: string | null;
  document_url: string | null;
};

export type ReviewField = {
  position_observation_id: string;
  field_code: string;
  raw_value: string | null;
  value_state: string;
  scale_state: string;
  source_column_label: string | null;
};

export type ReviewPayload = {
  lines: ReviewLine[];
  fields: ReviewField[];
  names: { registrant_cik: string; name_raw: string }[];
  instruments: { position_observation_id: string; state: string }[];
  maturity: { position_observation_id: string; maturity_source: string; maturity_raw: string | null }[];
  entityResolutionCount: number;
  groupMembershipCount: number;
};

export type ReviewObservation = {
  id: string;
  sourceName: string;
  registrantCik: string;
  registrantNames: string[];
  reportedDate: string;
  filedDate: string;
  form: string;
  accessionNumber: string;
  documentName: string;
  documentUrl: string | null;
  inlineUrl: string | null;
  evidence: string;
  principal: string;
  cost: string;
  fairValue: string;
  interestRate: string;
  spread: string;
  maturity: string;
  acquisitionDate: string;
  industry: string;
  geography: string;
  instrumentType: string;
  issuerAffiliation: string;
  instrumentResolution: string;
};

export type ReviewGroup = {
  sourceName: string;
  observations: ReviewObservation[];
};

export type ReviewModel = {
  candidate: EntityReviewCandidate;
  groups: ReviewGroup[];
  legalEntity: string;
  economicGroup: string;
  normalizedName: "Not stored";
  legalName: "Not stored";
  address: "Not stored";
  city: "Not stored";
  state: "Not stored";
  country: "Not stored";
  issuerCik: "Not stored";
  lei: "Not stored";
  website: "Not stored";
  businessDescription: "Not stored";
  companyDescription: "Not stored";
  writesEnabled: false;
};

export type ComparisonRow = {
  section: "Identity" | "Business" | "Investment" | "Source";
  label: string;
  values: string[];
};

const LINE_STRINGS = [
  "position_observation_id",
  "registrant_cik",
  "reported_date",
  "disclosed_line_text",
  "accession_number",
  "evidence_level",
  "form_state",
  "filed_date_state",
  "inline_url_state",
] as const;

const LINE_NULLS = [
  "form_raw",
  "filed_date_raw",
  "inline_url",
  "document_name",
  "document_url",
] as const;

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(label);
  }
  return value as Record<string, unknown>;
}

function requiredString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(key);
  return value;
}

function optionalString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value == null) return null;
  if (typeof value !== "string") throw new Error(key);
  return value;
}

function count(value: unknown, key: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(key);
  return value;
}

function parseLine(value: unknown): ReviewLine {
  const row = asRecord(value, "line");
  const line: Record<string, string | null> = {};
  for (const key of LINE_STRINGS) line[key] = requiredString(row, key);
  for (const key of LINE_NULLS) line[key] = optionalString(row, key);
  return line as ReviewLine;
}

function parseField(value: unknown): ReviewField {
  const row = asRecord(value, "field");
  return {
    position_observation_id: requiredString(row, "position_observation_id"),
    field_code: requiredString(row, "field_code"),
    raw_value: optionalString(row, "raw_value"),
    value_state: requiredString(row, "value_state"),
    scale_state: requiredString(row, "scale_state"),
    source_column_label: optionalString(row, "source_column_label"),
  };
}

export function parseEntityReviewPayload(value: unknown): ReviewPayload {
  const row = asRecord(value, "payload");
  if (!Array.isArray(row.lines) || !Array.isArray(row.fields) || !Array.isArray(row.names) || !Array.isArray(row.instruments) || !Array.isArray(row.maturity)) {
    throw new Error("payload");
  }
  return {
    lines: row.lines.map(parseLine),
    fields: row.fields.map(parseField),
    names: row.names.map((item) => {
      const name = asRecord(item, "name");
      return { registrant_cik: requiredString(name, "registrant_cik"), name_raw: requiredString(name, "name_raw") };
    }),
    instruments: row.instruments.map((item) => {
      const instrument = asRecord(item, "instrument");
      return { position_observation_id: requiredString(instrument, "position_observation_id"), state: requiredString(instrument, "state") };
    }),
    maturity: row.maturity.map((item) => {
      const maturity = asRecord(item, "maturity");
      return {
        position_observation_id: requiredString(maturity, "position_observation_id"),
        maturity_source: requiredString(maturity, "maturity_source"),
        maturity_raw: optionalString(maturity, "maturity_raw"),
      };
    }),
    entityResolutionCount: count(row.entity_resolution_count, "entity_resolution_count"),
    groupMembershipCount: count(row.group_membership_count, "group_membership_count"),
  };
}

function storedText(state: string, raw: string | null): string {
  if (state === "REPORTED" && raw != null && raw.trim() !== "") return raw;
  if (state === "MULTIPLE_VALUES") return "Multiple stored values";
  return "Unknown";
}

function evidenceLabel(level: string): string {
  if (level === "L1_STRUCTURED_DATASET") return "Structured SEC data set";
  if (level.trim() === "" || level === "UNKNOWN") return "Unknown";
  return level;
}

function resolutionGap(count: number): string {
  return count === 0 ? "Not yet resolved" : "Not available to this read model";
}

function fieldText(fields: ReviewField[], code: string): string {
  const rows = fields.filter((field) => field.field_code === code);
  if (rows.length === 0) return "Not stored";
  const reported = rows.filter((field) => field.value_state === "REPORTED" && field.raw_value != null && field.raw_value.trim() !== "");
  if (reported.length === 0) return "Unknown";
  const distinct = [...new Set(reported.map((field) => field.raw_value))];
  if (distinct.length !== 1) return "Multiple stored values";
  const field = reported[0];
  if (field == null || field.raw_value == null) return "Unknown";
  const parts = [field.raw_value];
  if (field.scale_state === "UNRESOLVED") parts.push("Scale Unresolved");
  if (field.source_column_label != null && field.source_column_label.trim() !== "") parts.push(field.source_column_label);
  return parts.join(" · ");
}

function moneyText(fields: ReviewField[], code: string): string {
  const text = fieldText(fields, code);
  if (text === "Not stored" || text === "Unknown" || text === "Multiple stored values") return text;
  return `${text} · ${CURRENCY_NOTE}`;
}

function instrumentResolution(instruments: ReviewPayload["instruments"], id: string): string {
  const states = [...new Set(instruments.filter((instrument) => instrument.position_observation_id === id).map((instrument) => instrument.state))];
  if (states.length === 0) return "Not yet resolved";
  if (states.length > 1) return "Multiple stored values";
  if (states[0] === "UNRESOLVED") return "Unresolved";
  if (states[0] === "MATCHED" || states[0] === "PROBABLE" || states[0] === "REJECTED") return states[0];
  return "Unknown";
}

function observation(line: ReviewLine, payload: ReviewPayload): ReviewObservation {
  const fields = payload.fields.filter((field) => field.position_observation_id === line.position_observation_id);
  const names = [...new Set(
    payload.names
      .filter((name) => name.registrant_cik === line.registrant_cik && name.name_raw.trim() !== "")
      .map((name) => name.name_raw),
  )].sort((a, b) => a.localeCompare(b));
  const maturity = payload.maturity.filter((item) => item.position_observation_id === line.position_observation_id);
  const maturityText = maturity.length === 0
    ? "Not stored"
    : maturity.length === 1
      ? maturityValue(maturity[0]?.maturity_source ?? "UNKNOWN", maturity[0]?.maturity_raw ?? null)
      : "Multiple stored values";
  return {
    id: line.position_observation_id,
    sourceName: line.disclosed_line_text,
    registrantCik: line.registrant_cik,
    registrantNames: names.length === 0 ? ["Not stored"] : names,
    reportedDate: line.reported_date,
    filedDate: storedText(line.filed_date_state, line.filed_date_raw),
    form: storedText(line.form_state, line.form_raw),
    accessionNumber: line.accession_number,
    documentName: line.document_name != null && line.document_name.trim() !== "" ? line.document_name : "Not stored",
    documentUrl: secUrl(line.document_url),
    inlineUrl: line.inline_url_state === "REPORTED" ? secUrl(line.inline_url) : null,
    evidence: evidenceLabel(line.evidence_level),
    principal: moneyText(fields, "PRINCIPAL_AMOUNT"),
    cost: moneyText(fields, "COST"),
    fairValue: moneyText(fields, "FAIR_VALUE"),
    interestRate: fieldText(fields, "INTEREST_RATE"),
    spread: fieldText(fields, "SPREAD"),
    maturity: maturityText,
    acquisitionDate: fieldText(fields, "ACQUISITION_DATE"),
    industry: fieldText(fields, "INDUSTRY"),
    geography: fieldText(fields, "GEOGRAPHY"),
    instrumentType: fieldText(fields, "INSTRUMENT_TYPE"),
    issuerAffiliation: fieldText(fields, "ISSUER_AFFILIATION"),
    instrumentResolution: instrumentResolution(payload.instruments, line.position_observation_id),
  };
}

export function assembleReview(candidate: EntityReviewCandidate, payload: ReviewPayload): ReviewModel {
  const allowed = new Set(candidate.descriptors);
  const groups: ReviewGroup[] = candidate.descriptors.map((sourceName) => ({ sourceName, observations: [] }));
  const byName = new Map(groups.map((group) => [group.sourceName, group]));
  const lines = [...payload.lines].sort((a, b) =>
    a.disclosed_line_text.localeCompare(b.disclosed_line_text)
    || a.reported_date.localeCompare(b.reported_date)
    || a.accession_number.localeCompare(b.accession_number)
    || a.position_observation_id.localeCompare(b.position_observation_id),
  );
  for (const line of lines) {
    if (!allowed.has(line.disclosed_line_text)) continue;
    byName.get(line.disclosed_line_text)?.observations.push(observation(line, payload));
  }
  return {
    candidate,
    groups,
    legalEntity: resolutionGap(payload.entityResolutionCount),
    economicGroup: resolutionGap(payload.groupMembershipCount),
    normalizedName: "Not stored",
    legalName: "Not stored",
    address: "Not stored",
    city: "Not stored",
    state: "Not stored",
    country: "Not stored",
    issuerCik: "Not stored",
    lei: "Not stored",
    website: "Not stored",
    businessDescription: "Not stored",
    companyDescription: "Not stored",
    writesEnabled: false,
  };
}

export function comparisonValue(values: readonly string[]): string {
  const distinct = [...new Set(values)];
  if (distinct.length === 0) return "No stored observation";
  if (distinct.length === 1) return distinct[0] ?? "Unknown";
  return "Multiple stored values";
}

export function comparisonRows(model: ReviewModel): ComparisonRow[] {
  const pick = (read: (item: ReviewObservation) => string) =>
    model.groups.map((group) => comparisonValue(group.observations.map(read)));
  const fixed = (text: string) => model.groups.map(() => text);
  return [
    { section: "Identity", label: "Source name", values: model.groups.map((group) => group.sourceName) },
    { section: "Identity", label: "Normalized name", values: fixed(model.normalizedName) },
    { section: "Identity", label: "Legal name", values: fixed(model.legalName) },
    { section: "Identity", label: "Address", values: fixed(model.address) },
    { section: "Identity", label: "City", values: fixed(model.city) },
    { section: "Identity", label: "State", values: fixed(model.state) },
    { section: "Identity", label: "Country", values: fixed(model.country) },
    { section: "Identity", label: "Issuer CIK", values: fixed(model.issuerCik) },
    { section: "Identity", label: "LEI", values: fixed(model.lei) },
    { section: "Identity", label: "Legal entity", values: fixed(model.legalEntity) },
    { section: "Identity", label: "Economic group", values: fixed(model.economicGroup) },
    { section: "Business", label: "Industry", values: pick((item) => item.industry) },
    { section: "Business", label: "Geography", values: pick((item) => item.geography) },
    { section: "Business", label: "Business description", values: fixed(model.businessDescription) },
    { section: "Business", label: "Company description", values: fixed(model.companyDescription) },
    { section: "Business", label: "Website", values: fixed(model.website) },
    { section: "Investment", label: "Disclosed line", values: model.groups.map((group) => group.sourceName) },
    { section: "Investment", label: "Instrument type", values: pick((item) => item.instrumentType) },
    { section: "Investment", label: "Instrument resolution", values: pick((item) => item.instrumentResolution) },
    { section: "Investment", label: "Spread", values: pick((item) => item.spread) },
    { section: "Investment", label: "Interest rate", values: pick((item) => item.interestRate) },
    { section: "Investment", label: "Maturity", values: pick((item) => item.maturity) },
    { section: "Investment", label: "Acquisition date", values: pick((item) => item.acquisitionDate) },
    { section: "Investment", label: "Principal", values: pick((item) => item.principal) },
    { section: "Investment", label: "Cost", values: pick((item) => item.cost) },
    { section: "Investment", label: "Fair value", values: pick((item) => item.fairValue) },
    { section: "Source", label: "Registrant CIK", values: pick((item) => item.registrantCik) },
    { section: "Source", label: "Reported date", values: pick((item) => item.reportedDate) },
    { section: "Source", label: "Filed date", values: pick((item) => item.filedDate) },
    { section: "Source", label: "Form", values: pick((item) => item.form) },
    { section: "Source", label: "Accession number", values: pick((item) => item.accessionNumber) },
    { section: "Source", label: "Filing document", values: pick((item) => item.documentName) },
    { section: "Source", label: "Evidence", values: pick((item) => item.evidence) },
  ];
}
