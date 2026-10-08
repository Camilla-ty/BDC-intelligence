import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PortfolioPeriodChanges } from "@/components/PortfolioPeriodChanges";
import {
  AMBIGUOUS_PERIOD_NOTE,
  BOTH_PERIOD_NOTE,
  EMPTY_CHANGED,
  EMPTY_EXIT,
  EMPTY_NEW,
  EXIT_NOTE,
  NEW_NOTE,
  SELECT_EARLIER,
  SELECT_LATER,
  UNRESOLVED_PERIOD_NOTE,
  absentPosition,
  confirmedChange,
  newPosition,
  periodSummary,
  type PeriodChangeRow,
  type PeriodSummaryRow,
} from "@/lib/portfolio-changes";

const SUMMARY: PeriodSummaryRow = {
  earlier_observation_count: "2",
  later_observation_count: "2",
  unresolved_count: "1",
  observed_in_both_count: "1",
  changed_count: "1",
  new_count: "1",
  no_longer_count: "1",
  ambiguous_position_count: "0",
  changes_definition: "portfolio.period_changes.v1",
};

const CHANGED: PeriodChangeRow = {
  change_type: "EXISTING_POSITION_CHANGED",
  registrant_cik: "0000000001",
  earlier_reported_date: "2099-03-31",
  later_reported_date: "2099-06-30",
  position_id: "41",
  instrument_id: "42",
  legal_entity_id: null,
  borrower_name_raw: "TEST PERIOD ENTITY",
  holding_descriptor_raw: "TEST PERIOD ENTITY | LATE",
  instrument_resolution_state: "MATCHED",
  continuity_state: "MATCHED",
  instrument_type_state: "UNKNOWN",
  instrument_type_raw: null,
  principal_comparison_state: "INSUFFICIENT_DATA",
  principal_delta: null,
  earlier_principal_raw: null,
  later_principal_raw: "STORED-LATER-PRINCIPAL",
  earlier_principal_currency_state: null,
  later_principal_currency_state: "UNKNOWN",
  fair_value_comparison_state: "COMPARABLE",
  fair_value_delta: "-7",
  earlier_fair_value_raw: "STORED-EARLIER-VALUE",
  later_fair_value_raw: "STORED-LATER-VALUE",
  earlier_fair_value_currency_state: "UNKNOWN",
  later_fair_value_currency_state: "UNKNOWN",
  cost_comparison_state: "INSUFFICIENT_DATA",
  cost_delta: null,
  earlier_cost_raw: null,
  later_cost_raw: null,
  maturity_comparison_state: "INSUFFICIENT_DATA",
  maturity_changed: null,
  earlier_maturity_raw: null,
  later_maturity_raw: null,
  earlier_accession_number: "0000000000-00-000001",
  later_accession_number: "0000000000-00-000002",
  earlier_document_url: null,
  later_document_url: "https://www.sec.gov/Archives/edgar/data/1/0001/test.htm",
  earlier_position_observation_id: "11",
  later_position_observation_id: "12",
  changes_definition: "portfolio.period_changes.v1",
};

const NEW_ROW: PeriodChangeRow = {
  ...CHANGED,
  change_type: "NEW_POSITION_OBSERVED",
  position_id: "77",
  borrower_name_raw: "TEST NEW ENTITY",
  holding_descriptor_raw: "TEST NEW ENTITY | LOAN",
  principal_comparison_state: null,
  principal_delta: null,
  later_principal_raw: "STORED-NEW-PRINCIPAL",
  later_principal_currency_state: "UNKNOWN",
  fair_value_comparison_state: null,
  fair_value_delta: null,
  later_fair_value_raw: "STORED-NEW-VALUE",
  later_fair_value_currency_state: "UNKNOWN",
  maturity_comparison_state: null,
  maturity_changed: null,
  later_maturity_raw: null,
  earlier_accession_number: null,
  later_accession_number: "0000000000-00-000003",
  later_document_url: "https://www.sec.gov/Archives/edgar/data/1/0001/new.htm",
  earlier_position_observation_id: null,
  later_position_observation_id: "30",
};

const ABSENT_ROW: PeriodChangeRow = {
  ...CHANGED,
  change_type: "POSITION_NO_LONGER_OBSERVED",
  position_id: "88",
  borrower_name_raw: "TEST ABSENT ENTITY",
  holding_descriptor_raw: "TEST ABSENT ENTITY | LOAN",
  principal_comparison_state: null,
  principal_delta: null,
  earlier_principal_raw: "STORED-LAST-PRINCIPAL",
  earlier_principal_currency_state: "UNKNOWN",
  fair_value_comparison_state: null,
  fair_value_delta: null,
  earlier_fair_value_raw: "STORED-LAST-VALUE",
  earlier_fair_value_currency_state: "UNKNOWN",
  maturity_comparison_state: null,
  maturity_changed: null,
  earlier_maturity_raw: "12/19/2099",
  later_accession_number: null,
  earlier_accession_number: "0000000000-00-000004",
  earlier_document_url: "https://www.sec.gov/Archives/edgar/data/1/0001/absent.htm",
  later_document_url: null,
  earlier_position_observation_id: "40",
  later_position_observation_id: null,
};

describe("historical portfolio changes", () => {
  it("asks for both reporting periods before comparing", () => {
    render(
      <PortfolioPeriodChanges
        cik="0000000001"
        name="TEST REGISTRANT A"
        dates={["2099-03-31", "2099-06-30"]}
        earlier={null}
        later={null}
        summary={null}
        confirmed={[]}
        observed={[]}
        absent={[]}
      />,
    );
    expect(screen.getByRole("heading", { name: "Historical Portfolio Changes" })).toBeInTheDocument();
    expect(screen.getByText("TEST REGISTRANT A")).toBeInTheDocument();
    expect(screen.getAllByText("0000000001").length).toBeGreaterThan(0);
    expect(screen.getByText(SELECT_EARLIER)).toBeInTheDocument();
    expect(screen.getByText(SELECT_LATER)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "2099-03-31" })).toHaveAttribute(
      "href",
      "/portfolios/0000000001/changes?earlier=2099-03-31",
    );
    expect(screen.queryByRole("heading", { name: "Confirmed Position Changes" })).not.toBeInTheDocument();
  });

  it("shows stored changes, a new observation, and a neutral absence", () => {
    const confirmed = confirmedChange(CHANGED);
    expect(confirmed.fairValue).toBe("stored change -7");
    expect(confirmed.principal).toBe("Insufficient data");
    expect(confirmed.maturity).toBe("Insufficient data");
    const observed = newPosition(NEW_ROW);
    expect(observed.principal).toBe("STORED-NEW-PRINCIPAL · Currency Unknown");
    expect(observed.reportDate).toBe("2099-06-30");
    const absent = absentPosition(ABSENT_ROW);
    expect(absent.principal).toBe("STORED-LAST-PRINCIPAL · Currency Unknown");
    expect(absent.reportDate).toBe("2099-03-31");
    render(
      <PortfolioPeriodChanges
        cik="0000000001"
        name="TEST REGISTRANT A"
        dates={["2099-03-31", "2099-06-30", "2099-09-30"]}
        earlier="2099-03-31"
        later="2099-06-30"
        summary={periodSummary(SUMMARY)}
        confirmed={[confirmed]}
        observed={[observed]}
        absent={[absent]}
      />,
    );
    expect(screen.getAllByRole("link", { name: "2099-09-30" }).some((link) =>
      link.getAttribute("href") === "/portfolios/0000000001/changes?earlier=2099-03-31&later=2099-09-30",
    )).toBe(true);
    expect(screen.getByRole("heading", { name: "Confirmed Position Changes" })).toBeInTheDocument();
    expect(screen.getByText("stored change -7")).toBeInTheDocument();
    expect(screen.getAllByText("Insufficient data").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "New Positions Observed" })).toBeInTheDocument();
    expect(screen.getByText(NEW_NOTE)).toBeInTheDocument();
    expect(screen.getAllByText((_, element) => element?.textContent === "STORED-NEW-PRINCIPAL · Currency Unknown").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "0000000000-00-000003" })).toHaveAttribute(
      "href",
      "https://www.sec.gov/Archives/edgar/data/1/0001/new.htm",
    );
    expect(screen.getByRole("heading", { name: "Positions No Longer Observed" })).toBeInTheDocument();
    expect(screen.getByText(EXIT_NOTE)).toBeInTheDocument();
    expect(screen.getAllByText((_, element) => element?.textContent === "STORED-LAST-PRINCIPAL · Currency Unknown").length).toBeGreaterThan(0);
    expect(screen.getByText("12/19/2099")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "0000000000-00-000004" })).toHaveAttribute(
      "href",
      "https://www.sec.gov/Archives/edgar/data/1/0001/absent.htm",
    );
    expect(screen.getAllByText("1 stored").length).toBeGreaterThan(0);
    expect(screen.getByText(UNRESOLVED_PERIOD_NOTE)).toBeInTheDocument();
    expect(screen.getByText(BOTH_PERIOD_NOTE)).toBeInTheDocument();
    expect(screen.getByText(AMBIGUOUS_PERIOD_NOTE)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /repaid|refinanced|new investment/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/score|rank|probability/i)).not.toBeInTheDocument();
  });

  it("shows empty comparison sections without a zero amount", () => {
    render(
      <PortfolioPeriodChanges
        cik="0000000001"
        name="Unknown"
        dates={["2099-03-31", "2099-06-30"]}
        earlier="2099-03-31"
        later="2099-06-30"
        summary={periodSummary({
          ...SUMMARY,
          earlier_observation_count: "0",
          later_observation_count: "0",
          unresolved_count: "0",
          observed_in_both_count: "0",
          changed_count: "0",
          new_count: "0",
          no_longer_count: "0",
          ambiguous_position_count: "0",
        })}
        confirmed={[]}
        observed={[]}
        absent={[]}
      />,
    );
    expect(screen.getByText(EMPTY_CHANGED)).toBeInTheDocument();
    expect(screen.getByText(EMPTY_NEW)).toBeInTheDocument();
    expect(screen.getByText(EMPTY_EXIT)).toBeInTheDocument();
    expect(screen.getAllByText("0 stored").length).toBeGreaterThan(0);
    expect(screen.queryByText(/^0$/)).not.toBeInTheDocument();
  });
});