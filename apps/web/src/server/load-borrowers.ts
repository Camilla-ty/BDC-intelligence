import { assertComparisonFields, type PositionComparisonRow } from "@/lib/borrower-comparisons";
import type { FieldValueTraceRow } from "@/lib/borrower-field-trace";
import { assertMaturityFields, type MaturityObservationRow, type MaturitySummaryRow, type MaturityYearRow } from "@/lib/borrower-maturity";
import { assertRefinancingFields, type RefinancingOutcomeRow } from "@/lib/borrower-refinancing";
import { assertValuationFields, type ValuationRow } from "@/lib/borrower-valuation";
import { assertPositionFields, type PositionObservationRow, type ResearchFieldRow } from "@/lib/borrower-positions";
import { assertListingFields, type ObservationRow } from "@/lib/borrowers";
import { executeSql } from "@/server/sql-text";

// Reads registry.borrower_observation_listing as bdc_reader.
// The full listing stays for directory/search pages. Detail pages filter by legal_entity_id
// so PostgreSQL can push the predicate into the view instead of shipping the universe.
// DATABASE_URL selects the hosted client; otherwise the local container is used.

const ENTITY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LISTING_SELECT = `
  SELECT legal_entity_id::text,
         alias_text,
         verification_state,
         entity_resolution_state,
         entity_resolution_method,
         reported_date::text,
         accession_number,
         document_name,
         document_url,
         registrant_link_status,
         registrant_cik,
         registrant_name,
         instrument_resolution_state,
         instrument_resolution_method,
         instrument_type_state,
         event_code,
         observation_evidence_level,
         name_validation_outcome
`;

const LISTING_SQL = `
SET ROLE bdc_reader;
SET statement_timeout = '30s';
SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
FROM (
${LISTING_SELECT}
  FROM registry.borrower_observation_listing
  ORDER BY alias_text, reported_date, accession_number
) t;
RESET ROLE;
`;

function listingForEntitySql(legalEntityId: string): string {
  return `
SET ROLE bdc_reader;
SET statement_timeout = '30s';
SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
FROM (
${LISTING_SELECT}
  FROM registry.borrower_observation_listing
  WHERE legal_entity_id = '${legalEntityId}'
  ORDER BY alias_text, reported_date, accession_number
) t;
RESET ROLE;
`;
}

export type ListingResult = { rows: ObservationRow[]; error: string | null };

async function readListingRows(sql: string): Promise<ListingResult> {
  const executed = await executeSql(sql);
  if (!executed.ok) {
    return { rows: [], error: "The borrower listing could not be read." };
  }
  const line = executed.text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line === "" ? "[]" : line);
  } catch {
    return { rows: [], error: "The borrower listing could not be read." };
  }
  if (!Array.isArray(parsed)) return { rows: [], error: "The borrower listing could not be read." };
  const rows: ObservationRow[] = [];
  for (const item of parsed) {
    if (item == null || typeof item !== "object") {
      return { rows: [], error: "The borrower listing could not be read." };
    }
    try {
      assertListingFields(item);
    } catch {
      return { rows: [], error: "The borrower listing could not be read." };
    }
    const row = item as ObservationRow;
    if (typeof row.legal_entity_id !== "string" || typeof row.alias_text !== "string") {
      return { rows: [], error: "The borrower listing could not be read." };
    }
    rows.push(row);
  }
  return { rows, error: null };
}

export async function loadBorrowerObservations(): Promise<ListingResult> {
  return readListingRows(LISTING_SQL);
}

/** Same listing columns as loadBorrowerObservations, restricted to one legal entity. */
export async function loadBorrowerObservationsForEntity(legalEntityId: string): Promise<ListingResult> {
  // Invalid ids are unobserved, not a read failure (matches filtering an empty group).
  if (!ENTITY_ID.test(legalEntityId)) return { rows: [], error: null };
  return readListingRows(listingForEntitySql(legalEntityId));
}

const POSITION_SQL = (legalEntityId: string) => `
SET ROLE bdc_reader;
SET statement_timeout = '30s';
SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
FROM (
  SELECT legal_entity_id,
         position_observation_id,
         reported_date,
         accession_number,
         registrant_cik,
         registrant_link_status,
         entity_resolution_state,
         instrument_resolution_state,
         continuity_state,
         economic_group_state,
         principal_state,
         principal_raw,
         principal_currency_state,
         cost_state,
         cost_raw,
         cost_currency_state,
         fair_value_state,
         fair_value_raw,
         fair_value_currency_state,
         acquisition_state,
         acquisition_raw,
         acquisition_precision,
         interest_rate_state,
         interest_rate_raw,
         spread_state,
         spread_raw,
         interest_rate_floor_state,
         interest_rate_floor_raw,
         maturity_source,
         maturity_raw,
         maturity_precision,
         maturity_filing_verified,
         maturity_document_url,
         observation_evidence_level
  FROM registry.borrower_position_observations('${legalEntityId}')
  ORDER BY reported_date DESC, registrant_cik ASC NULLS LAST, accession_number ASC, position_observation_id ASC
) t;
RESET ROLE;
`;

export type PositionResult = { rows: PositionObservationRow[]; error: string | null };

function textOrNull(value: unknown): string | null | undefined {
  if (value == null) return null;
  if (typeof value === "string") return value;
  return undefined;
}

function requiredText(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

export async function loadBorrowerPositionObservations(legalEntityId: string): Promise<PositionResult> {
  if (!ENTITY_ID.test(legalEntityId)) return { rows: [], error: "The position observations could not be read." };
  const executed = await executeSql(POSITION_SQL(legalEntityId));
  if (!executed.ok) return { rows: [], error: "The position observations could not be read." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(executed.text === "" ? "[]" : executed.text);
  } catch {
    return { rows: [], error: "The position observations could not be read." };
  }
  if (!Array.isArray(parsed)) return { rows: [], error: "The position observations could not be read." };
  const rows: PositionObservationRow[] = [];
  for (const item of parsed) {
    if (item == null || typeof item !== "object") return { rows: [], error: "The position observations could not be read." };
    try {
      assertPositionFields(item);
    } catch {
      return { rows: [], error: "The position observations could not be read." };
    }
    const record = item as Record<string, unknown>;
    const legalEntity = requiredText(record, "legal_entity_id");
    const positionId = requiredText(record, "position_observation_id");
    const reportedDate = requiredText(record, "reported_date");
    const accession = requiredText(record, "accession_number");
    const entityState = requiredText(record, "entity_resolution_state");
    const instrumentState = requiredText(record, "instrument_resolution_state");
    const continuityState = requiredText(record, "continuity_state");
    const groupState = requiredText(record, "economic_group_state");
    const principalState = requiredText(record, "principal_state");
    const costState = requiredText(record, "cost_state");
    const fairValueState = requiredText(record, "fair_value_state");
    const acquisitionState = requiredText(record, "acquisition_state");
    const interestState = requiredText(record, "interest_rate_state");
    const spreadState = requiredText(record, "spread_state");
    const floorState = requiredText(record, "interest_rate_floor_state");
    const maturitySource = requiredText(record, "maturity_source");
    const evidenceLevel = requiredText(record, "observation_evidence_level");
    if (
      legalEntity == null || positionId == null || reportedDate == null || accession == null
      || entityState == null || instrumentState == null || continuityState == null || groupState == null
      || principalState == null || costState == null || fairValueState == null || acquisitionState == null
      || interestState == null || spreadState == null || floorState == null
      || maturitySource == null || evidenceLevel == null
      || typeof record.maturity_filing_verified !== "boolean"
    ) {
      return { rows: [], error: "The position observations could not be read." };
    }
    const optionalKeys = [
      "registrant_cik", "registrant_link_status", "principal_raw", "principal_currency_state",
      "cost_raw", "cost_currency_state", "fair_value_raw", "fair_value_currency_state",
      "acquisition_raw", "acquisition_precision", "interest_rate_raw", "spread_raw",
      "interest_rate_floor_raw", "maturity_raw", "maturity_precision", "maturity_document_url",
    ] as const;
    const optional: Record<string, string | null> = {};
    for (const key of optionalKeys) {
      const value = textOrNull(record[key]);
      if (value === undefined) return { rows: [], error: "The position observations could not be read." };
      optional[key] = value;
    }
    rows.push({
      legal_entity_id: legalEntity,
      position_observation_id: positionId,
      reported_date: reportedDate,
      accession_number: accession,
      registrant_cik: optional.registrant_cik ?? null,
      registrant_link_status: optional.registrant_link_status ?? null,
      entity_resolution_state: entityState,
      instrument_resolution_state: instrumentState,
      continuity_state: continuityState,
      economic_group_state: groupState,
      principal_state: principalState,
      principal_raw: optional.principal_raw ?? null,
      principal_currency_state: optional.principal_currency_state ?? null,
      cost_state: costState,
      cost_raw: optional.cost_raw ?? null,
      cost_currency_state: optional.cost_currency_state ?? null,
      fair_value_state: fairValueState,
      fair_value_raw: optional.fair_value_raw ?? null,
      fair_value_currency_state: optional.fair_value_currency_state ?? null,
      acquisition_state: acquisitionState,
      acquisition_raw: optional.acquisition_raw ?? null,
      acquisition_precision: optional.acquisition_precision ?? null,
      interest_rate_state: interestState,
      interest_rate_raw: optional.interest_rate_raw ?? null,
      spread_state: spreadState,
      spread_raw: optional.spread_raw ?? null,
      interest_rate_floor_state: floorState,
      interest_rate_floor_raw: optional.interest_rate_floor_raw ?? null,
      maturity_source: maturitySource,
      maturity_raw: optional.maturity_raw ?? null,
      maturity_precision: optional.maturity_precision ?? null,
      maturity_filing_verified: record.maturity_filing_verified,
      maturity_document_url: optional.maturity_document_url ?? null,
      observation_evidence_level: evidenceLevel,
    });
  }
  return { rows, error: null };
}

const POSITION_ID = /^\d+$/;

export type ResearchResult = { rows: ResearchFieldRow[]; error: string | null };

export async function loadPositionResearchFields(positionIds: string[]): Promise<ResearchResult> {
  if (positionIds.length === 0) return { rows: [], error: null };
  if (positionIds.some((id) => !POSITION_ID.test(id))) {
    return { rows: [], error: "Industry and instrument type could not be read." };
  }
  const executed = await executeSql(`
SET ROLE bdc_reader;
SET statement_timeout = '30s';
SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
FROM (
  SELECT fv.position_observation_id::text,
         fv.field_code,
         fv.raw_value,
         fv.value_state::text,
         fv.evidence_level::text
  FROM obs.current_position_research_field fv
  WHERE fv.position_observation_id IN (${positionIds.join(",")})
    AND fv.field_code IN ('INDUSTRY', 'INSTRUMENT_TYPE')
) t;
RESET ROLE;
`);
  if (!executed.ok) return { rows: [], error: "Industry and instrument type could not be read." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(executed.text === "" ? "[]" : executed.text);
  } catch {
    return { rows: [], error: "Industry and instrument type could not be read." };
  }
  if (!Array.isArray(parsed)) return { rows: [], error: "Industry and instrument type could not be read." };
  const rows: ResearchFieldRow[] = [];
  for (const item of parsed) {
    if (item == null || typeof item !== "object") return { rows: [], error: "Industry and instrument type could not be read." };
    const record = item as Record<string, unknown>;
    const positionId = requiredText(record, "position_observation_id");
    const fieldCode = requiredText(record, "field_code");
    const valueState = requiredText(record, "value_state");
    const evidenceLevel = requiredText(record, "evidence_level");
    const rawValue = textOrNull(record.raw_value);
    if (
      positionId == null || fieldCode == null || valueState == null || evidenceLevel == null
      || rawValue === undefined
      || (fieldCode !== "INDUSTRY" && fieldCode !== "INSTRUMENT_TYPE")
    ) {
      return { rows: [], error: "Industry and instrument type could not be read." };
    }
    rows.push({
      position_observation_id: positionId,
      field_code: fieldCode,
      raw_value: rawValue,
      value_state: valueState,
      evidence_level: evidenceLevel,
    });
  }
  return { rows, error: null };
}

// One DB round-trip: MATERIALIZED comparisons feed both JSON arrays (migration 0055).
// json_build_object keeps a single cell for executeSql's first-column contract.
const COMPARISONS_AND_REFINANCING_SQL = (legalEntityId: string) => `
SET ROLE bdc_reader;
SET statement_timeout = '30s';
SELECT json_build_object(
  'comparisons', comparisons,
  'refinancing', refinancing
)
FROM registry.borrower_comparisons_and_refinancing('${legalEntityId}');
RESET ROLE;
`;

export type ComparisonResult = { rows: PositionComparisonRow[]; error: string | null };
export type RefinancingOutcomeResult = { rows: RefinancingOutcomeRow[]; error: string | null };
export type ComparisonsAndRefinancingResult = {
  comparisons: ComparisonResult;
  refinancing: RefinancingOutcomeResult;
};

const COMPARISON_TEXT = [
  "legal_entity_id",
  "position_id",
  "earlier_position_observation_id",
  "later_position_observation_id",
  "earlier_reported_date",
  "later_reported_date",
  "earlier_accession_number",
  "later_accession_number",
  "principal_comparison_state",
  "cost_comparison_state",
  "fair_value_comparison_state",
  "maturity_comparison_state",
  "acquisition_comparison_state",
  "interest_rate_comparison_state",
  "spread_comparison_state",
  "interest_rate_floor_comparison_state",
] as const;

const COMPARISON_NULLABLE = [
  "earlier_observation_evidence_id",
  "later_observation_evidence_id",
  "earlier_observation_evidence_level",
  "later_observation_evidence_level",
  "earlier_registrant_cik",
  "earlier_registrant_link_status",
  "later_registrant_cik",
  "later_registrant_link_status",
  "earlier_principal_raw",
  "later_principal_raw",
  "principal_delta",
  "earlier_principal_currency_state",
  "later_principal_currency_state",
  "earlier_cost_raw",
  "later_cost_raw",
  "cost_delta",
  "earlier_cost_currency_state",
  "later_cost_currency_state",
  "earlier_fair_value_raw",
  "later_fair_value_raw",
  "fair_value_delta",
  "earlier_fair_value_currency_state",
  "later_fair_value_currency_state",
  "earlier_maturity_raw",
  "later_maturity_raw",
  "earlier_maturity_precision",
  "later_maturity_precision",
  "earlier_maturity_date",
  "later_maturity_date",
  "earlier_acquisition_raw",
  "later_acquisition_raw",
  "earlier_acquisition_precision",
  "later_acquisition_precision",
  "earlier_acquisition_date",
  "later_acquisition_date",
  "earlier_interest_rate_raw",
  "later_interest_rate_raw",
  "interest_rate_delta",
  "earlier_spread_raw",
  "later_spread_raw",
  "spread_delta",
  "earlier_interest_rate_floor_raw",
  "later_interest_rate_floor_raw",
  "interest_rate_floor_delta",
] as const;

function parseComparisonRows(parsed: unknown[]): ComparisonResult {
  const error = "The position comparisons could not be read.";
  const rows: PositionComparisonRow[] = [];
  for (const item of parsed) {
    if (item == null || typeof item !== "object") return { rows: [], error };
    try {
      assertComparisonFields(item);
    } catch {
      return { rows: [], error };
    }
    const record = item as Record<string, unknown>;
    const text: Record<string, string> = {};
    for (const key of COMPARISON_TEXT) {
      const value = requiredText(record, key);
      if (value == null) return { rows: [], error };
      text[key] = value;
    }
    const optional: Record<string, string | null> = {};
    for (const key of COMPARISON_NULLABLE) {
      const value = textOrNull(record[key]);
      if (value === undefined) return { rows: [], error };
      optional[key] = value;
    }
    const maturityChanged = record.maturity_changed;
    if (maturityChanged != null && typeof maturityChanged !== "boolean") {
      return { rows: [], error };
    }
    rows.push({
      legal_entity_id: text.legal_entity_id,
      position_id: text.position_id,
      earlier_position_observation_id: text.earlier_position_observation_id,
      later_position_observation_id: text.later_position_observation_id,
      earlier_reported_date: text.earlier_reported_date,
      later_reported_date: text.later_reported_date,
      earlier_accession_number: text.earlier_accession_number,
      later_accession_number: text.later_accession_number,
      earlier_observation_evidence_id: optional.earlier_observation_evidence_id ?? null,
      later_observation_evidence_id: optional.later_observation_evidence_id ?? null,
      earlier_observation_evidence_level: optional.earlier_observation_evidence_level ?? null,
      later_observation_evidence_level: optional.later_observation_evidence_level ?? null,
      earlier_registrant_cik: optional.earlier_registrant_cik ?? null,
      earlier_registrant_link_status: optional.earlier_registrant_link_status ?? null,
      later_registrant_cik: optional.later_registrant_cik ?? null,
      later_registrant_link_status: optional.later_registrant_link_status ?? null,
      principal_comparison_state: text.principal_comparison_state,
      earlier_principal_raw: optional.earlier_principal_raw ?? null,
      later_principal_raw: optional.later_principal_raw ?? null,
      principal_delta: optional.principal_delta ?? null,
      earlier_principal_currency_state: optional.earlier_principal_currency_state ?? null,
      later_principal_currency_state: optional.later_principal_currency_state ?? null,
      cost_comparison_state: text.cost_comparison_state,
      earlier_cost_raw: optional.earlier_cost_raw ?? null,
      later_cost_raw: optional.later_cost_raw ?? null,
      cost_delta: optional.cost_delta ?? null,
      earlier_cost_currency_state: optional.earlier_cost_currency_state ?? null,
      later_cost_currency_state: optional.later_cost_currency_state ?? null,
      fair_value_comparison_state: text.fair_value_comparison_state,
      earlier_fair_value_raw: optional.earlier_fair_value_raw ?? null,
      later_fair_value_raw: optional.later_fair_value_raw ?? null,
      fair_value_delta: optional.fair_value_delta ?? null,
      earlier_fair_value_currency_state: optional.earlier_fair_value_currency_state ?? null,
      later_fair_value_currency_state: optional.later_fair_value_currency_state ?? null,
      maturity_comparison_state: text.maturity_comparison_state,
      maturity_changed: maturityChanged ?? null,
      earlier_maturity_raw: optional.earlier_maturity_raw ?? null,
      later_maturity_raw: optional.later_maturity_raw ?? null,
      earlier_maturity_precision: optional.earlier_maturity_precision ?? null,
      later_maturity_precision: optional.later_maturity_precision ?? null,
      earlier_maturity_date: optional.earlier_maturity_date ?? null,
      later_maturity_date: optional.later_maturity_date ?? null,
      acquisition_comparison_state: text.acquisition_comparison_state,
      earlier_acquisition_raw: optional.earlier_acquisition_raw ?? null,
      later_acquisition_raw: optional.later_acquisition_raw ?? null,
      earlier_acquisition_precision: optional.earlier_acquisition_precision ?? null,
      later_acquisition_precision: optional.later_acquisition_precision ?? null,
      earlier_acquisition_date: optional.earlier_acquisition_date ?? null,
      later_acquisition_date: optional.later_acquisition_date ?? null,
      interest_rate_comparison_state: text.interest_rate_comparison_state,
      earlier_interest_rate_raw: optional.earlier_interest_rate_raw ?? null,
      later_interest_rate_raw: optional.later_interest_rate_raw ?? null,
      interest_rate_delta: optional.interest_rate_delta ?? null,
      spread_comparison_state: text.spread_comparison_state,
      earlier_spread_raw: optional.earlier_spread_raw ?? null,
      later_spread_raw: optional.later_spread_raw ?? null,
      spread_delta: optional.spread_delta ?? null,
      interest_rate_floor_comparison_state: text.interest_rate_floor_comparison_state,
      earlier_interest_rate_floor_raw: optional.earlier_interest_rate_floor_raw ?? null,
      later_interest_rate_floor_raw: optional.later_interest_rate_floor_raw ?? null,
      interest_rate_floor_delta: optional.interest_rate_floor_delta ?? null,
    });
  }
  return { rows, error: null };
}

export async function loadBorrowerComparisonsAndRefinancing(
  legalEntityId: string,
): Promise<ComparisonsAndRefinancingResult> {
  const failBoth = (): ComparisonsAndRefinancingResult => ({
    comparisons: { rows: [], error: "The position comparisons could not be read." },
    refinancing: { rows: [], error: "The refinancing outcomes could not be read." },
  });
  if (!ENTITY_ID.test(legalEntityId)) return failBoth();
  const executed = await executeSql(COMPARISONS_AND_REFINANCING_SQL(legalEntityId));
  if (!executed.ok) return failBoth();
  let parsed: unknown;
  try {
    parsed = JSON.parse(executed.text === "" ? "null" : executed.text);
  } catch {
    return failBoth();
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) return failBoth();
  const record = parsed as Record<string, unknown>;
  if (!Array.isArray(record.comparisons) || !Array.isArray(record.refinancing)) return failBoth();
  return {
    comparisons: parseComparisonRows(record.comparisons),
    refinancing: parseRefinancingRows(record.refinancing),
  };
}

/** Prefer loadBorrowerComparisonsAndRefinancing on the borrower detail path. */
export async function loadBorrowerPositionComparisons(legalEntityId: string): Promise<ComparisonResult> {
  return (await loadBorrowerComparisonsAndRefinancing(legalEntityId)).comparisons;
}

function uniqueObservationIds(comparisons: PositionComparisonRow[]): string[] {
  const ids = new Set<string>();
  for (const row of comparisons) {
    ids.add(row.earlier_position_observation_id);
    ids.add(row.later_position_observation_id);
  }
  return [...ids].sort();
}

const FIELD_TRACE_SQL = (observationIds: string[]) => `
SET ROLE bdc_reader;
SET statement_timeout = '30s';
SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
FROM (
  SELECT fv.position_observation_id::text,
         fv.field_code,
         fv.raw_value,
         fv.normalized_numeric::text AS normalized_numeric,
         fv.currency_code,
         fv.currency_state::text AS currency_state,
         fv.scale_state::text AS scale_state,
         fv.evidence_id::text AS evidence_id,
         fv.normalization_rule_version_id::text AS normalization_rule_version_id
  FROM obs.current_position_field_value fv
  WHERE fv.position_observation_id IN (${observationIds.join(",")})
    AND fv.field_code IN ('PRINCIPAL_AMOUNT', 'COST', 'FAIR_VALUE')
) t;
RESET ROLE;
`;

export type FieldTraceResult = { rows: FieldValueTraceRow[]; error: string | null };

export async function loadComparisonFieldTrace(
  comparisons: PositionComparisonRow[],
): Promise<FieldTraceResult> {
  const observationIds = uniqueObservationIds(comparisons);
  if (observationIds.length === 0) return { rows: [], error: null };
  for (const id of observationIds) {
    if (!/^\d+$/.test(id)) return { rows: [], error: "Field trace could not be read." };
  }
  const executed = await executeSql(FIELD_TRACE_SQL(observationIds));
  if (!executed.ok) return { rows: [], error: "Field trace could not be read." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(executed.text === "" ? "[]" : executed.text);
  } catch {
    return { rows: [], error: "Field trace could not be read." };
  }
  if (!Array.isArray(parsed)) return { rows: [], error: "Field trace could not be read." };
  const rows: FieldValueTraceRow[] = [];
  for (const item of parsed) {
    if (item == null || typeof item !== "object") return { rows: [], error: "Field trace could not be read." };
    const record = item as Record<string, unknown>;
    const positionObservationId = requiredText(record, "position_observation_id");
    const fieldCode = requiredText(record, "field_code");
    if (
      positionObservationId == null || fieldCode == null
      || (fieldCode !== "PRINCIPAL_AMOUNT" && fieldCode !== "COST" && fieldCode !== "FAIR_VALUE")
    ) {
      return { rows: [], error: "Field trace could not be read." };
    }
    const rawValue = textOrNull(record.raw_value);
    const normalizedNumeric = textOrNull(record.normalized_numeric);
    const currencyCode = textOrNull(record.currency_code);
    const currencyState = textOrNull(record.currency_state);
    const scaleState = textOrNull(record.scale_state);
    const evidenceId = textOrNull(record.evidence_id);
    const normalizationRuleVersionId = textOrNull(record.normalization_rule_version_id);
    if (
      rawValue === undefined || normalizedNumeric === undefined || currencyCode === undefined
      || currencyState === undefined || scaleState === undefined || evidenceId === undefined
      || normalizationRuleVersionId === undefined
    ) {
      return { rows: [], error: "Field trace could not be read." };
    }
    rows.push({
      position_observation_id: positionObservationId,
      field_code: fieldCode,
      raw_value: rawValue,
      normalized_numeric: normalizedNumeric,
      currency_code: currencyCode,
      currency_state: currencyState,
      scale_state: scaleState,
      evidence_id: evidenceId,
      normalization_rule_version_id: normalizationRuleVersionId,
    });
  }
  return { rows, error: null };
}

const VALUATION_SQL = (legalEntityId: string) => `
SET ROLE bdc_reader;
SET statement_timeout = '30s';
SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
FROM (
  SELECT *
  FROM registry.borrower_position_valuation('${legalEntityId}')
) t;
RESET ROLE;
`;

export type ValuationResult = { rows: ValuationRow[]; error: string | null };

const VALUATION_TEXT = [
  "legal_entity_id",
  "position_observation_id",
  "reported_date",
  "accession_number",
  "entity_resolution_state",
  "instrument_resolution_state",
  "continuity_state",
  "instrument_type_state",
  "fair_value_state",
  "principal_state",
  "cost_state",
  "fair_value_change_state",
  "fair_value_percentage_state",
  "fair_value_to_principal_state",
  "fair_value_to_cost_state",
  "cross_bdc_comparison_state",
  "valuation_definition",
] as const;

const VALUATION_NULLABLE = [
  "position_id",
  "instrument_id",
  "borrower_name_raw",
  "registrant_cik",
  "registrant_link_status",
  "instrument_type_raw",
  "instrument_type_evidence_level",
  "fair_value_raw",
  "fair_value_numeric",
  "fair_value_currency_state",
  "fair_value_currency_code",
  "principal_raw",
  "principal_numeric",
  "principal_currency_state",
  "principal_currency_code",
  "cost_raw",
  "cost_numeric",
  "cost_currency_state",
  "cost_currency_code",
  "observation_evidence_id",
  "observation_evidence_level",
  "earlier_reported_date",
  "fair_value_delta",
  "fair_value_percentage",
  "fair_value_to_principal",
  "fair_value_to_cost",
] as const;

export async function loadBorrowerPositionValuation(legalEntityId: string): Promise<ValuationResult> {
  if (!ENTITY_ID.test(legalEntityId)) return { rows: [], error: "The valuation history could not be read." };
  const executed = await executeSql(VALUATION_SQL(legalEntityId));
  if (!executed.ok) return { rows: [], error: "The valuation history could not be read." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(executed.text === "" ? "[]" : executed.text);
  } catch {
    return { rows: [], error: "The valuation history could not be read." };
  }
  if (!Array.isArray(parsed)) return { rows: [], error: "The valuation history could not be read." };
  const rows: ValuationRow[] = [];
  for (const item of parsed) {
    if (item == null || typeof item !== "object") return { rows: [], error: "The valuation history could not be read." };
    try {
      assertValuationFields(item);
    } catch {
      return { rows: [], error: "The valuation history could not be read." };
    }
    const record = item as Record<string, unknown>;
    const text: Record<string, string> = {};
    for (const key of VALUATION_TEXT) {
      const value = requiredText(record, key);
      if (value == null) return { rows: [], error: "The valuation history could not be read." };
      text[key] = value;
    }
    const optional: Record<string, string | null> = {};
    for (const key of VALUATION_NULLABLE) {
      const value = textOrNull(record[key]);
      if (value === undefined) return { rows: [], error: "The valuation history could not be read." };
      optional[key] = value;
    }
    rows.push({
      legal_entity_id: text.legal_entity_id,
      position_observation_id: text.position_observation_id,
      position_id: optional.position_id ?? null,
      instrument_id: optional.instrument_id ?? null,
      borrower_name_raw: optional.borrower_name_raw ?? null,
      reported_date: text.reported_date,
      accession_number: text.accession_number,
      registrant_cik: optional.registrant_cik ?? null,
      registrant_link_status: optional.registrant_link_status ?? null,
      entity_resolution_state: text.entity_resolution_state,
      instrument_resolution_state: text.instrument_resolution_state,
      continuity_state: text.continuity_state,
      instrument_type_state: text.instrument_type_state,
      instrument_type_raw: optional.instrument_type_raw ?? null,
      instrument_type_evidence_level: optional.instrument_type_evidence_level ?? null,
      fair_value_state: text.fair_value_state,
      fair_value_raw: optional.fair_value_raw ?? null,
      fair_value_numeric: optional.fair_value_numeric ?? null,
      fair_value_currency_state: optional.fair_value_currency_state ?? null,
      fair_value_currency_code: optional.fair_value_currency_code ?? null,
      principal_state: text.principal_state,
      principal_raw: optional.principal_raw ?? null,
      principal_numeric: optional.principal_numeric ?? null,
      principal_currency_state: optional.principal_currency_state ?? null,
      principal_currency_code: optional.principal_currency_code ?? null,
      cost_state: text.cost_state,
      cost_raw: optional.cost_raw ?? null,
      cost_numeric: optional.cost_numeric ?? null,
      cost_currency_state: optional.cost_currency_state ?? null,
      cost_currency_code: optional.cost_currency_code ?? null,
      observation_evidence_id: optional.observation_evidence_id ?? null,
      observation_evidence_level: optional.observation_evidence_level ?? null,
      earlier_reported_date: optional.earlier_reported_date ?? null,
      fair_value_change_state: text.fair_value_change_state,
      fair_value_delta: optional.fair_value_delta ?? null,
      fair_value_percentage_state: text.fair_value_percentage_state,
      fair_value_percentage: optional.fair_value_percentage ?? null,
      fair_value_to_principal_state: text.fair_value_to_principal_state,
      fair_value_to_principal: optional.fair_value_to_principal ?? null,
      fair_value_to_cost_state: text.fair_value_to_cost_state,
      fair_value_to_cost: optional.fair_value_to_cost ?? null,
      cross_bdc_comparison_state: text.cross_bdc_comparison_state,
      valuation_definition: text.valuation_definition,
    });
  }
  return { rows, error: null };
}

function readerJson(legalEntityId: string, source: string): string {
  return `
SET ROLE bdc_reader;
SET statement_timeout = '30s';
SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
FROM (
  SELECT *
  FROM ${source}('${legalEntityId}')
) t;
RESET ROLE;
`;
}

const MATURITY_TEXT = [
  "legal_entity_id",
  "position_observation_id",
  "reported_date",
  "accession_number",
  "entity_resolution_state",
  "instrument_resolution_state",
  "continuity_state",
  "instrument_type_state",
  "maturity_source",
  "maturity_precision_class",
  "maturity_observation_state",
  "principal_state",
  "fair_value_state",
  "refinancing_outcome_state",
  "maturity_definition",
] as const;

const MATURITY_NULLABLE = [
  "position_id",
  "instrument_id",
  "borrower_name_raw",
  "registrant_cik",
  "registrant_link_status",
  "instrument_type_raw",
  "maturity_raw",
  "maturity_date",
  "maturity_precision",
  "maturity_year",
  "maturity_month",
  "maturity_bucket_year",
  "maturity_evidence_id",
  "maturity_document_url",
  "observation_evidence_level",
  "principal_raw",
  "principal_numeric",
  "principal_currency_state",
  "principal_currency_code",
  "fair_value_raw",
  "fair_value_numeric",
  "fair_value_currency_state",
  "fair_value_currency_code",
] as const;

export type MaturityObservationResult = { rows: MaturityObservationRow[]; error: string | null };

export async function loadBorrowerMaturityObservations(legalEntityId: string): Promise<MaturityObservationResult> {
  if (!ENTITY_ID.test(legalEntityId)) return { rows: [], error: "The maturity wall could not be read." };
  const parsed = await readJsonRows(readerJson(legalEntityId, "registry.borrower_maturity_observations"));
  if (!parsed.ok) return { rows: [], error: "The maturity wall could not be read." };
  const rows: MaturityObservationRow[] = [];
  for (const item of parsed.rows) {
    try {
      assertMaturityFields(item);
    } catch {
      return { rows: [], error: "The maturity wall could not be read." };
    }
    const record = item as Record<string, unknown>;
    const text = readText(record, MATURITY_TEXT);
    const optional = readNullable(record, MATURITY_NULLABLE);
    if (!text || !optional || typeof record.maturity_filing_verified !== "boolean") {
      return { rows: [], error: "The maturity wall could not be read." };
    }
    rows.push({
      ...text,
      ...optional,
      maturity_filing_verified: record.maturity_filing_verified,
    } as MaturityObservationRow);
  }
  return { rows, error: null };
}

const SUMMARY_TEXT = [
  "resolved_observation_count",
  "known_maturity_count",
  "unknown_maturity_count",
  "unresolved_count",
  "refinancing_outcome_state",
  "maturity_definition",
] as const;

const SUMMARY_NULLABLE = ["earliest_calendar_maturity", "earliest_month_maturity"] as const;

export type MaturitySummaryResult = { row: MaturitySummaryRow | null; error: string | null };

export async function loadBorrowerMaturitySummary(legalEntityId: string): Promise<MaturitySummaryResult> {
  if (!ENTITY_ID.test(legalEntityId)) return { row: null, error: "The maturity summary could not be read." };
  const parsed = await readJsonRows(readerJson(legalEntityId, "registry.borrower_maturity_summary"));
  if (!parsed.ok || parsed.rows.length !== 1) return { row: null, error: "The maturity summary could not be read." };
  const record = parsed.rows[0] as Record<string, unknown>;
  try {
    assertMaturityFields(record);
  } catch {
    return { row: null, error: "The maturity summary could not be read." };
  }
  const text = readText(record, SUMMARY_TEXT);
  const optional = readNullable(record, SUMMARY_NULLABLE);
  if (!text || !optional) return { row: null, error: "The maturity summary could not be read." };
  return { row: { ...text, ...optional } as MaturitySummaryRow, error: null };
}

const YEAR_TEXT = [
  "maturity_year",
  "maturity_precision_class",
  "observation_count",
  "principal_aggregation_state",
  "fair_value_aggregation_state",
  "maturity_definition",
] as const;

const YEAR_NULLABLE = [
  "principal_total",
  "principal_currency_code",
  "fair_value_total",
  "fair_value_currency_code",
] as const;

export type MaturityYearResult = { rows: MaturityYearRow[]; error: string | null };

export async function loadBorrowerMaturityYears(legalEntityId: string): Promise<MaturityYearResult> {
  if (!ENTITY_ID.test(legalEntityId)) return { rows: [], error: "The maturity years could not be read." };
  const parsed = await readJsonRows(readerJson(legalEntityId, "registry.borrower_maturity_years"));
  if (!parsed.ok) return { rows: [], error: "The maturity years could not be read." };
  const rows: MaturityYearRow[] = [];
  for (const item of parsed.rows) {
    const record = item as Record<string, unknown>;
    try {
      assertMaturityFields(record);
    } catch {
      return { rows: [], error: "The maturity years could not be read." };
    }
    const text = readText(record, YEAR_TEXT);
    const optional = readNullable(record, YEAR_NULLABLE);
    if (!text || !optional) return { rows: [], error: "The maturity years could not be read." };
    rows.push({ ...text, ...optional } as MaturityYearRow);
  }
  return { rows, error: null };
}

const OUTCOME_TEXT = [
  "legal_entity_id",
  "position_id",
  "instrument_resolution_state",
  "continuity_state",
  "instrument_type_state",
  "earlier_position_observation_id",
  "later_position_observation_id",
  "earlier_reported_date",
  "later_reported_date",
  "event_type",
  "refinancing_outcome_state",
  "earlier_principal_state",
  "later_principal_state",
  "earlier_accession_number",
  "later_accession_number",
  "outcome_definition",
] as const;

const OUTCOME_NULLABLE = [
  "instrument_id",
  "instrument_type_raw",
  "event_date",
  "earlier_maturity_raw",
  "later_maturity_raw",
  "earlier_maturity_precision",
  "later_maturity_precision",
  "earlier_principal_raw",
  "earlier_principal_currency_state",
  "earlier_principal_currency_code",
  "later_principal_raw",
  "later_principal_currency_state",
  "later_principal_currency_code",
  "earlier_observation_evidence_id",
  "later_observation_evidence_id",
  "earlier_observation_evidence_level",
  "later_observation_evidence_level",
  "registrant_cik",
  "registrant_link_status",
] as const;

function parseRefinancingRows(parsed: unknown[]): RefinancingOutcomeResult {
  const error = "The refinancing outcomes could not be read.";
  const rows: RefinancingOutcomeRow[] = [];
  for (const item of parsed) {
    if (item == null || typeof item !== "object") return { rows: [], error };
    try {
      assertRefinancingFields(item);
    } catch {
      return { rows: [], error };
    }
    const record = item as Record<string, unknown>;
    const text = readText(record, OUTCOME_TEXT);
    const optional = readNullable(record, OUTCOME_NULLABLE);
    if (!text || !optional) return { rows: [], error };
    rows.push({ ...text, ...optional } as RefinancingOutcomeRow);
  }
  return { rows, error: null };
}

/** Prefer loadBorrowerComparisonsAndRefinancing on the borrower detail path. */
export async function loadBorrowerRefinancingOutcomes(legalEntityId: string): Promise<RefinancingOutcomeResult> {
  return (await loadBorrowerComparisonsAndRefinancing(legalEntityId)).refinancing;
}

async function readJsonRows(sql: string): Promise<{ ok: true; rows: unknown[] } | { ok: false }> {
  const executed = await executeSql(sql);
  if (!executed.ok) return { ok: false };
  try {
    const parsed = JSON.parse(executed.text === "" ? "[]" : executed.text);
    if (!Array.isArray(parsed)) return { ok: false };
    if (parsed.some((item) => item == null || typeof item !== "object")) return { ok: false };
    return { ok: true, rows: parsed };
  } catch {
    return { ok: false };
  }
}

function readText(record: Record<string, unknown>, keys: readonly string[]): Record<string, string> | null {
  const text: Record<string, string> = {};
  for (const key of keys) {
    const value = requiredText(record, key);
    if (value == null) return null;
    text[key] = value;
  }
  return text;
}

function readNullable(record: Record<string, unknown>, keys: readonly string[]): Record<string, string | null> | null {
  const optional: Record<string, string | null> = {};
  for (const key of keys) {
    const value = textOrNull(record[key]);
    if (value === undefined) return null;
    optional[key] = value;
  }
  return optional;
}
