// Counts and stored-difference labels for one borrower page.
// A count is a number of stored rows. It is not exposure and not a credit assessment.
// Direction words read the sign of a delta the comparison read model already stored.

import type { PositionComparison } from "@/lib/borrower-comparisons";
import type { HistoricalPosition } from "@/lib/borrower-positions";

export const ACTIVITY_NOTE =
  "Counts are stored observations and resolution states. They are not a credit assessment.";
export const DIFFERENCE_NOTE =
  "A listed difference repeats a comparable stored delta or a stored maturity comparison. It is not a credit event.";
export const NO_COMPARABLE_DIFFERENCE =
  "No comparable principal, fair value, or maturity difference is stored on the confirmed pairs.";

export type ActivityFact = {
  label: string;
  value: string;
};

export type ObservedActivity = {
  facts: ActivityFact[];
  earliest: string;
  latest: string;
};

export type StoredDifference = {
  key: string;
  text: string;
};

function storedSign(delta: string): "higher" | "lower" | "same" | null {
  if (!/^-?\d+(\.\d+)?$/.test(delta)) return null;
  const digits = delta.replace("-", "").replace(".", "");
  if ([...digits].every((digit) => digit === "0")) return "same";
  if (delta.startsWith("-")) return "lower";
  return "higher";
}

export function observedActivity(
  positions: HistoricalPosition[],
  comparisons: PositionComparison[],
): ObservedActivity {
  const identifiedBdcs = new Set(
    positions.map((position) => position.registrantCik).filter((cik) => cik !== "Unknown"),
  );
  const unresolved = positions.filter(
    (position) => position.instrumentState === "Unresolved" || position.continuityState === "Unresolved",
  ).length;
  const matchedContinuity = positions.filter((position) => position.continuityState === "Matched").length;
  const matchedInstruments = positions.filter((position) => position.instrumentState === "Matched").length;
  const dates = positions.map((position) => position.reportedDate).filter((date) => date.trim() !== "").sort();
  return {
    earliest: dates[0] ?? "Unknown",
    latest: dates.length === 0 ? "Unknown" : dates[dates.length - 1],
    facts: [
      { label: "Historical observations", value: String(positions.length) },
      { label: "Identified BDCs", value: String(identifiedBdcs.size) },
      { label: "Observations with matched instrument identity", value: String(matchedInstruments) },
      { label: "Observations with matched position continuity", value: String(matchedContinuity) },
      { label: "Confirmed position changes", value: String(comparisons.length) },
      {
        label: "Observations with unresolved instrument identity or position continuity",
        value: String(unresolved),
      },
    ],
  };
}

export function storedDifferences(comparisons: PositionComparison[]): StoredDifference[] {
  const differences: StoredDifference[] = [];
  for (const comparison of comparisons) {
    const period = `${comparison.earlierDate} to ${comparison.laterDate}`;
    for (const field of comparison.fields) {
      if (field.state !== "Comparable") continue;
      if (field.label === "Maturity") {
        if (field.change !== "Yes" && field.change !== "No") continue;
        const relation = field.change === "Yes" ? "differ" : "are the same";
        differences.push({
          key: `${comparison.key}:maturity`,
          text: `${period}: maturity stored values ${relation}.`,
        });
        continue;
      }
      if (field.label !== "Principal" && field.label !== "Fair value") continue;
      const sign = storedSign(field.change);
      if (sign == null) continue;
      const relation = sign === "higher" ? "higher" : sign === "lower" ? "lower" : "the same";
      differences.push({
        key: `${comparison.key}:${field.label}`,
        text: `${period}: ${field.label} later stored value is ${relation}. Stored delta ${field.change}.`,
      });
    }
  }
  return differences;
}
