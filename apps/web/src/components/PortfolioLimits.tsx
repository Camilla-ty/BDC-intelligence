import {
  BLOCKED_NOTE,
  DATE_NOTE,
  EMPTY_PERIOD_NOTE,
  IDENTITY_NOTE,
  LINE_COUNT_NOTE,
  RATE_NOTE,
  VALUATION_NOTE,
} from "@/lib/portfolios";

export function PortfolioLimits({ emptyPeriods }: { emptyPeriods?: string[] }) {
  return (
    <div className="mt-3 max-w-3xl space-y-1 text-sm text-muted">
      <p>{BLOCKED_NOTE}</p>
      <p>{IDENTITY_NOTE}</p>
      <p>{VALUATION_NOTE}</p>
      <p>{RATE_NOTE}</p>
      <p>{LINE_COUNT_NOTE}</p>
      <p>{DATE_NOTE}</p>
      {emptyPeriods && emptyPeriods.length > 0 ? (
        <p>
          {EMPTY_PERIOD_NOTE} Releases: {emptyPeriods.join(", ")}.
        </p>
      ) : null}
    </div>
  );
}
