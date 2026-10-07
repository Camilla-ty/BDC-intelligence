// Borrower-scoped What Changed lines.
// Each line repeats a stored principal delta, fair value delta, or maturity comparison
// from registry.borrower_position_comparisons. This module does not subtract amounts,
// does not read portfolio new or absent labels, and does not classify credit quality.

import { storedDeltaSign } from "@/lib/borrower-activity";
import type { PositionComparison } from "@/lib/borrower-comparisons";
import type { HistoricalPosition } from "@/lib/borrower-positions";

export const WHAT_CHANGED_NOTE =
  "A listed change repeats a stored principal delta, a stored fair value delta, or a stored maturity comparison. It is not a credit assessment.";
export const EMPTY_WHAT_CHANGED =
  "No stored principal increase, principal decrease, fair value increase, fair value decrease, or maturity change is recorded for this legal entity.";

const AMOUNT_SIGNALS = {
  Principal: {
    higher: { signal: "principal-increased", verb: "Principal increased" },
    lower: { signal: "principal-decreased", verb: "Principal decreased" },
  },
  "Fair value": {
    higher: { signal: "fair-value-increased", verb: "Fair value increased" },
    lower: { signal: "fair-value-decreased", verb: "Fair value decreased" },
  },
} as const;

export type WhatChangedSignal =
  | "principal-increased"
  | "principal-decreased"
  | "fair-value-increased"
  | "fair-value-decreased"
  | "maturity-changed";

export type WhatChangedItem = {
  key: string;
  signal: WhatChangedSignal;
  statement: string;
  legalEntityName: string;
  instrument: string;
  positionId: string;
  earlierDate: string;
  laterDate: string;
  storedDelta: string | null;
  earlierAccession: string;
  laterAccession: string;
  earlierUrl: string | null;
  laterUrl: string | null;
  earlierEvidence: string;
  laterEvidence: string;
  earlierEvidenceId: string;
  laterEvidenceId: string;
};

function storedMagnitude(delta: string): string | null {
  const sign = storedDeltaSign(delta);
  if (sign == null || sign === "same") return null;
  return delta.startsWith("-") ? delta.slice(1) : delta;
}

function instrumentText(positions: HistoricalPosition[], earlierId: string, laterId: string): string {
  const textFor = (observationId: string) => {
    const matches = positions.filter((position) => position.id === observationId);
    if (matches.length !== 1) return "Unknown";
    const text = matches[0].instrumentType.text.trim();
    return text === "" ? "Unknown" : text;
  };
  const earlier = textFor(earlierId);
  const later = textFor(laterId);
  if (earlier === later) return earlier;
  return `Earlier ${earlier}. Later ${later}.`;
}

function observationSource(comparison: PositionComparison) {
  return {
    earlierDate: comparison.earlierDate,
    laterDate: comparison.laterDate,
    earlierAccession: comparison.earlier.accessionNumber,
    laterAccession: comparison.later.accessionNumber,
    earlierUrl: comparison.earlier.documentUrl,
    laterUrl: comparison.later.documentUrl,
    earlierEvidence: comparison.earlier.evidenceLabel,
    laterEvidence: comparison.later.evidenceLabel,
    earlierEvidenceId: comparison.earlier.evidenceId,
    laterEvidenceId: comparison.later.evidenceId,
  };
}

function currencySuffix(earlier: string | null, later: string | null): string {
  const notes = [earlier, later].filter((note): note is string => note != null && note.trim() !== "");
  const unique = [...new Set(notes)];
  if (unique.length === 0) return "";
  return ` · ${unique.join(" · ")}`;
}

export function whatChanged(
  comparisons: PositionComparison[],
  positions: HistoricalPosition[],
  legalEntityName: string,
): WhatChangedItem[] {
  const items: WhatChangedItem[] = [];
  for (const comparison of comparisons) {
    const instrument = instrumentText(positions, comparison.earlier.observationId, comparison.later.observationId);
    for (const field of comparison.fields) {
      const amount = AMOUNT_SIGNALS[field.label as keyof typeof AMOUNT_SIGNALS];
      if (field.state !== "Comparable" || amount == null) continue;
      const sign = storedDeltaSign(field.change);
      if (sign !== "higher" && sign !== "lower") continue;
      const magnitude = storedMagnitude(field.change);
      if (magnitude == null) continue;
      const chosen = amount[sign];
      items.push({
        key: `${comparison.key}:${chosen.signal}`,
        signal: chosen.signal,
        statement: `${chosen.verb} by ${magnitude}${currencySuffix(field.earlierCurrency, field.laterCurrency)}.`,
        legalEntityName,
        instrument,
        positionId: comparison.positionId,
        storedDelta: field.change,
        ...observationSource(comparison),
      });
    }
    const maturity = comparison.fields.find((field) => field.label === "Maturity");
    if (maturity?.state === "Comparable" && maturity.change === "Yes") {
      items.push({
        key: `${comparison.key}:maturity-changed`,
        signal: "maturity-changed",
        statement: `Maturity changed from ${maturity.earlier} to ${maturity.later}.`,
        legalEntityName,
        instrument,
        positionId: comparison.positionId,
        storedDelta: null,
        ...observationSource(comparison),
      });
    }
  }
  return items;
}
