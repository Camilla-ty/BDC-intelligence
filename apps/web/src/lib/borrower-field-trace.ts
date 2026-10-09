// Field-level provenance for amount comparisons (principal, cost, fair value).
// Values come from obs.current_position_field_value rows keyed by observation and field_code.
// This module does not infer raw-to-normalized lineage beyond what each stored row contains.

import type { ComparisonField, PositionComparison } from "@/lib/borrower-comparisons";
import { AMOUNT_REVIEW_LABELS } from "@/lib/borrower-comparisons";

export const FIELD_TRACE_NOTE =
  "Field trace shows the stored observed value, normalized value, currency, field evidence id, and normalization rule version for each amount when exactly one current field head exists. Observation-level evidence and accession appear above. Multiple current heads for one field stay unavailable at field level.";

export const TRACE_UNAVAILABLE = "Unavailable";
export const TRACE_MULTIPLE_HEADS = "Multiple current field values";

export type FieldValueTraceRow = {
  position_observation_id: string;
  field_code: string;
  raw_value: string | null;
  normalized_numeric: string | null;
  currency_code: string | null;
  currency_state: string | null;
  scale_state: string | null;
  evidence_id: string | null;
  normalization_rule_version_id: string | null;
};

export type AmountFieldTraceSide = {
  observedValue: string;
  normalizedValue: string;
  currencyCode: string;
  currencyState: string;
  scaleState: string;
  fieldEvidenceId: string;
  normalizationRuleVersionId: string;
  headNote: string | null;
};

const FIELD_CODE_BY_LABEL: Record<string, string> = {
  Principal: "PRINCIPAL_AMOUNT",
  "Amortized cost": "COST",
  "Fair value": "FAIR_VALUE",
};

function storedText(value: string | null | undefined): string {
  if (value == null || value.trim() === "") return "Unknown";
  return value;
}

function traceToken(value: string | null | undefined): string {
  if (value == null || value.trim() === "") return TRACE_UNAVAILABLE;
  return value;
}

function summarizeFieldRows(rows: FieldValueTraceRow[]): AmountFieldTraceSide {
  if (rows.length === 0) {
    return {
      observedValue: "Unknown",
      normalizedValue: TRACE_UNAVAILABLE,
      currencyCode: TRACE_UNAVAILABLE,
      currencyState: "Unknown",
      scaleState: TRACE_UNAVAILABLE,
      fieldEvidenceId: TRACE_UNAVAILABLE,
      normalizationRuleVersionId: TRACE_UNAVAILABLE,
      headNote: null,
    };
  }
  if (rows.length > 1) {
    return {
      observedValue: TRACE_UNAVAILABLE,
      normalizedValue: TRACE_UNAVAILABLE,
      currencyCode: TRACE_UNAVAILABLE,
      currencyState: TRACE_UNAVAILABLE,
      scaleState: TRACE_UNAVAILABLE,
      fieldEvidenceId: TRACE_UNAVAILABLE,
      normalizationRuleVersionId: TRACE_UNAVAILABLE,
      headNote: TRACE_MULTIPLE_HEADS,
    };
  }
  const row = rows[0];
  return {
    observedValue: storedText(row.raw_value),
    normalizedValue: traceToken(row.normalized_numeric),
    currencyCode: traceToken(row.currency_code),
    currencyState: storedText(row.currency_state),
    scaleState: traceToken(row.scale_state),
    fieldEvidenceId: traceToken(row.evidence_id),
    normalizationRuleVersionId: traceToken(row.normalization_rule_version_id),
    headNote: null,
  };
}

function traceKey(observationId: string, fieldCode: string): string {
  return `${observationId}:${fieldCode}`;
}

export function indexFieldTraceRows(rows: FieldValueTraceRow[]): Map<string, FieldValueTraceRow[]> {
  const index = new Map<string, FieldValueTraceRow[]>();
  for (const row of rows) {
    const key = traceKey(row.position_observation_id, row.field_code);
    const list = index.get(key);
    if (list) list.push(row);
    else index.set(key, [row]);
  }
  return index;
}

function sideTrace(
  index: Map<string, FieldValueTraceRow[]>,
  observationId: string,
  label: string,
): AmountFieldTraceSide {
  const fieldCode = FIELD_CODE_BY_LABEL[label];
  if (fieldCode == null) {
    return summarizeFieldRows([]);
  }
  return summarizeFieldRows(index.get(traceKey(observationId, fieldCode)) ?? []);
}

export function enrichComparisonsWithFieldTrace(
  comparisons: PositionComparison[],
  traceRows: FieldValueTraceRow[],
): PositionComparison[] {
  const index = indexFieldTraceRows(traceRows);
  return comparisons.map((comparison) => ({
    ...comparison,
    fields: comparison.fields.map((field) => {
      if (!(AMOUNT_REVIEW_LABELS as readonly string[]).includes(field.label)) return field;
      return {
        ...field,
        earlierTrace: sideTrace(index, comparison.earlier.observationId, field.label),
        laterTrace: sideTrace(index, comparison.later.observationId, field.label),
      };
    }),
  }));
}

export function amountFieldHasTrace(field: ComparisonField): field is ComparisonField & {
  earlierTrace: AmountFieldTraceSide;
  laterTrace: AmountFieldTraceSide;
} {
  return field.earlierTrace != null && field.laterTrace != null;
}
