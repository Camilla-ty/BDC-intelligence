import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/borrowers",
}));
import {
  ACQUISITION_LABEL as COMPARISON_ACQUISITION_LABEL,
  CHANGE_NOT_ESTABLISHED,
  CHANGE_NOT_ESTABLISHED_CURRENCY_UNKNOWN,
  CHANGE_NOT_ESTABLISHED_MISSING_AMOUNT,
  COMPARABLE_CHANGE_NOTE,
  COMPARISON_NOTE,
  CONTINUITY_SCOPE_NOTE,
  EMPTY_COMPARISONS,
  EVIDENCE_REVIEW_NOTE,
  positionComparisons,
  type PositionComparisonRow,
} from "@/lib/borrower-comparisons";
import {
  enrichComparisonsWithFieldTrace,
  FIELD_TRACE_NOTE,
  TRACE_UNAVAILABLE,
  type FieldValueTraceRow,
} from "@/lib/borrower-field-trace";
import { CURRENCY_NOTE } from "@/lib/portfolios";
import { observedActivity, storedDifferences } from "@/lib/borrower-activity";
import { EMPTY_WHAT_CHANGED, WHAT_CHANGED_NOTE, whatChanged } from "@/lib/borrower-what-changed";
import {
  EMPTY_REFINANCING,
  MATURITY_CHANGED_NOTE,
  OUTCOME_STATE_NOTE,
  refinancingOutcomes,
  type RefinancingOutcomeRow,
} from "@/lib/borrower-refinancing";
import {
  EMPTY_MATURITY,
  EMPTY_MATURITY_CHANGE,
  MATURITY_CHANGE_NOTE,
  REFINANCING_OUTCOME_NOTE,
  maturityChangeLines,
  maturityWall,
  maturityYears,
  type MaturityObservationRow,
  type MaturityYearRow,
} from "@/lib/borrower-maturity";
import {
  CROSS_BDC_UNAVAILABLE,
  EMPTY_DERIVED,
  EMPTY_VALUATION,
  OMITTED_UNRESOLVED,
  valuationHistory,
  type ValuationRow,
} from "@/lib/borrower-valuation";
import { BorrowerIntelligence } from "@/components/BorrowerIntelligence";
import {
  ACQUISITION_LABEL,
  EMPTY_POSITIONS,
  TIMELINE_NOTE,
  historicalPositions,
  periodBands,
  type PositionObservationRow,
  type ResearchFieldRow,
} from "@/lib/borrower-positions";
import { BorrowerList } from "@/components/BorrowerList";
import { BorrowerSources } from "@/components/BorrowerSources";
import { AppShell } from "@/components/AppShell";
import {
  COUNT_NOTE,
  EDGAR_DOCUMENT_PREFIX,
  EMPTY_SEARCH,
  ENTITY_NOTE,
  SEARCH_NOTE,
  VALUATION_NOTE,
  borrowerDetail,
  listBorrowers,
  sourceRows,
  type BorrowerSummary,
  type ObservationRow,
} from "@/lib/borrowers";

const ID = "00000000-0000-4000-8000-000000000001";

function row(overrides: Partial<ObservationRow> = {}): ObservationRow {
  return {
    legal_entity_id: ID,
    alias_text: "TEST BORROWER A",
    verification_state: "VERIFIED",
    entity_resolution_state: "MATCHED",
    entity_resolution_method: "EXACT_NORMALIZED_NAME",
    reported_date: "2099-03-31",
    accession_number: "0000000000-99-000001",
    document_name: "test-filing.htm",
    document_url: `${EDGAR_DOCUMENT_PREFIX}0000000000/000000000099000001/test-filing.htm`,
    registrant_link_status: "LINKED",
    registrant_cik: "0000000001",
    registrant_name: "TEST BDC ONE",
    instrument_resolution_state: "UNRESOLVED",
    instrument_resolution_method: "UNKNOWN_INSTRUMENT_ATTRIBUTES",
    instrument_type_state: "UNKNOWN",
    event_code: null,
    observation_evidence_level: "L2_ORIGINAL_FILING",
    name_validation_outcome: "PASS",
    ...overrides,
  };
}

describe("borrower retrieval", () => {
  it("lists only supplied entities and filters by the stored name", () => {
    const rows = [
      row(),
      row({
        legal_entity_id: "00000000-0000-4000-8000-000000000002",
        alias_text: "TEST BORROWER B",
        accession_number: "0000000000-99-000002",
      }),
    ];
    expect(listBorrowers(rows, "").map((item) => item.name)).toEqual([
      "TEST BORROWER A",
      "TEST BORROWER B",
    ]);
    expect(listBorrowers(rows, "borrower b").map((item) => item.name)).toEqual(["TEST BORROWER B"]);
    expect(listBorrowers([row({ alias_text: "TEST HOLDINGS" })], "holdco")).toEqual([]);
    expect(listBorrowers([], "").length).toBe(0);
  });

  it("does not render a borrower that was not retrieved", () => {
    render(<BorrowerList borrowers={[]} query="missing" error={null} />);
    expect(screen.getByText(EMPTY_SEARCH)).toBeInTheDocument();
    expect(screen.queryByText(/TEST BORROWER/)).not.toBeInTheDocument();
    expect(screen.queryByText(/fuzzy|probable match/i)).not.toBeInTheDocument();
  });

  it("labels a partial stored-name result as text containment", () => {
    render(<BorrowerList borrowers={[summary("181")]} query="borrow" error={null} />);
    expect(screen.getByText(SEARCH_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(/fuzzy/i)).not.toBeInTheDocument();
  });
});

describe("historical observations", () => {
  it("keeps every reported date and does not show a missing quarter as zero", () => {
    const detail = borrowerDetail(
      [
        row({ reported_date: "2099-09-30", accession_number: "0000000000-99-000003" }),
        row({ reported_date: "2099-03-31" }),
      ],
      ID,
    );
    expect(detail?.history.map((item) => item.reportedDate)).toEqual(["2099-03-31", "2099-09-30"]);
    render(<BorrowerIntelligence borrower={detail!} />);
    expect(screen.getByText("2099-03-31")).toBeInTheDocument();
    expect(screen.getByText("2099-09-30")).toBeInTheDocument();
    expect(screen.queryByText("2099-06-30")).not.toBeInTheDocument();
    expect(screen.getByText(/not zero exposure/i)).toBeInTheDocument();
    expect(screen.queryByText(/^0$/)).not.toBeInTheDocument();
  });
});

describe("unknown and unresolved states", () => {
  it("shows unresolved instrument identity and unknown type and registrant", () => {
    const detail = borrowerDetail(
      [row({
        registrant_link_status: "UNKNOWN",
        registrant_cik: null,
        registrant_name: null,
        instrument_type_state: "UNKNOWN",
        instrument_resolution_state: "UNRESOLVED",
      })],
      ID,
    );
    expect(detail?.instrumentState).toBe("Unresolved");
    expect(detail?.instrumentType).toBe("Unknown");
    render(<BorrowerIntelligence borrower={detail!} />);
    const instrument = screen.getByText("Instrument identity").closest("div")?.querySelector("dd");
    expect(instrument).toHaveTextContent("Unresolved · UNKNOWN_INSTRUMENT_ATTRIBUTES");
    expect(screen.getAllByText("Unknown").length).toBeGreaterThan(0);
    expect(screen.getByText(/Registrant CIK/)).toHaveTextContent("Unknown");
    expect(screen.getByText(/Registrant CIK/).parentElement).toHaveTextContent("Unknown");
    expect(screen.getByText(/CIK identifies the filing registrant, not the borrower/)).toBeInTheDocument();
    expect(document.querySelector(".state-unknown")).toBeTruthy();
    expect(document.querySelector(".state-unresolved")).toBeTruthy();
  });

  it("keeps an unknown registrant link distinct from unresolved instrument identity", () => {
    const detail = borrowerDetail(
      [
        row({
          registrant_link_status: "UNKNOWN",
          registrant_cik: null,
          registrant_name: null,
          accession_number: "0000000000-99-000010",
        }),
        row({
          registrant_link_status: "UNKNOWN",
          registrant_cik: null,
          registrant_name: null,
          accession_number: "0000000000-99-000011",
          reported_date: "2099-06-30",
        }),
      ],
      ID,
    );
    expect(detail?.registrants).toHaveLength(2);
    expect(detail?.registrants.every((item) => item.linkStatus === "Unknown")).toBe(true);
    expect(detail?.instrumentState).toBe("Unresolved");
  });
});

describe("source linkage", () => {
  it("links the accession to the EDGAR document and not to an internal id", () => {
    const sources = sourceRows([row()], ID);
    render(<BorrowerSources id={ID} name="TEST BORROWER A" sources={sources} />);
    const link = screen.getByRole("link", { name: "0000000000-99-000001" });
    expect(link).toHaveAttribute("href", sources[0].documentUrl);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(sources[0].documentUrl?.startsWith(EDGAR_DOCUMENT_PREFIX)).toBe(true);
    expect(screen.getByText("Original EDGAR filing")).toBeInTheDocument();
    expect(screen.queryByText(ID)).not.toBeInTheDocument();
    expect(screen.getByText(/identifier text found in the filing document/i)).toBeInTheDocument();
  });

  it("does not describe a failed name check as unchecked", () => {
    const sources = sourceRows([row({ name_validation_outcome: "FAIL", document_url: null })], ID);
    render(<BorrowerSources id={ID} name="TEST BORROWER A" sources={sources} />);
    expect(screen.getByText("Identifier text was not found in the filing document")).toBeInTheDocument();
    expect(document.body.textContent).toContain("Document URL Unknown");
    expect(screen.queryByRole("link", { name: "0000000000-99-000001" })).not.toBeInTheDocument();
    expect(screen.queryByText(ID)).not.toBeInTheDocument();
  });
});

describe("no fabricated valuation or instrument facts", () => {
  it("does not show cost, fair value, or a matched instrument", () => {
    const detail = borrowerDetail([
      row({ event_code: "REGISTRANT_FIRST_OBSERVED_NAME" }),
    ], ID);
    const { container } = render(<BorrowerIntelligence borrower={detail!} />);
    expect(screen.getByText(VALUATION_NOTE)).toBeInTheDocument();
    expect(screen.getByText(ENTITY_NOTE)).toBeInTheDocument();
    expect(screen.getAllByText("Registrant first observed").length).toBeGreaterThan(0);
    expect(screen.queryByText(/new investment|new position|new borrower/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/NEW_POSITION|VALUATION_MOVEMENT|PIK|NON_ACCRUAL/)).not.toBeInTheDocument();
    expect(screen.getByText(EMPTY_POSITIONS)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\$\s?\d/);
    expect(container.textContent).not.toMatch(/origination|fvr|fair value ratio/i);
    const instrument = screen.getByText("Instrument identity").closest("div")?.querySelector("dd");
    expect(instrument).toHaveTextContent("Unresolved · UNKNOWN_INSTRUMENT_ATTRIBUTES");
    expect(instrument).not.toHaveTextContent("Matched");
    const nameResolution = screen.getByText("Name resolution").closest("div")?.querySelector("dd");
    expect(nameResolution).toHaveTextContent("Matched · EXACT_NORMALIZED_NAME");
    const accessionLinks = screen.getAllByRole("link", { name: "0000000000-99-000001" });
    expect(accessionLinks.length).toBeGreaterThan(0);
    for (const link of accessionLinks) {
      expect(link).toHaveAttribute(
        "href",
        `${EDGAR_DOCUMENT_PREFIX}0000000000/000000000099000001/test-filing.htm`,
      );
    }
  });

  it("refuses a listing row that carries a valuation field", () => {
    expect(() => listBorrowers([row({ fair_value: "10" } as Partial<ObservationRow>)], "")).toThrow(/not displayable/);
  });
});

function position(overrides: Partial<PositionObservationRow> = {}): PositionObservationRow {
  return {
    legal_entity_id: ID,
    position_observation_id: "9000000001",
    reported_date: "2099-12-31",
    accession_number: "0000000000-99-000001",
    registrant_cik: "0000000001",
    registrant_link_status: "LINKED",
    entity_resolution_state: "MATCHED",
    instrument_resolution_state: "UNRESOLVED",
    continuity_state: "UNRESOLVED",
    economic_group_state: "UNRESOLVED",
    principal_state: "REPORTED",
    principal_raw: "100",
    principal_currency_state: "UNKNOWN",
    cost_state: "UNKNOWN",
    cost_raw: null,
    cost_currency_state: null,
    fair_value_state: "UNKNOWN",
    fair_value_raw: null,
    fair_value_currency_state: null,
    acquisition_state: "REPORTED",
    acquisition_raw: "04/2099",
    acquisition_precision: "MONTH",
    interest_rate_state: "UNKNOWN",
    interest_rate_raw: null,
    spread_state: "UNKNOWN",
    spread_raw: null,
    interest_rate_floor_state: "UNKNOWN",
    interest_rate_floor_raw: null,
    maturity_source: "REPORTED_MONTH",
    maturity_raw: "12/2099",
    maturity_precision: "MONTH",
    maturity_filing_verified: false,
    maturity_document_url: null,
    observation_evidence_level: "L1_STRUCTURED_DATASET",
    ...overrides,
  };
}

describe("historical position observations", () => {
  const listings = [
    row({
      accession_number: "0000000000-99-000001",
      document_url: `${EDGAR_DOCUMENT_PREFIX}0000000000/000000000099000001/test-filing.htm`,
    }),
    row({
      accession_number: "0000000000-99-000002",
      document_url: `${EDGAR_DOCUMENT_PREFIX}0000000000/000000000099000002/other-filing.htm`,
      registrant_cik: "0000000002",
      registrant_name: "TEST BDC TWO",
    }),
  ];

  it("shows stored observations for the legal entity, newest period first, across BDCs", () => {
    const positions = historicalPositions(
      [
        position({
          position_observation_id: "9000000002",
          reported_date: "2099-03-31",
          accession_number: "0000000000-99-000002",
          registrant_cik: "0000000002",
          principal_state: "UNKNOWN",
          principal_raw: null,
          principal_currency_state: null,
          fair_value_state: "REPORTED",
          fair_value_raw: "70",
          fair_value_currency_state: "UNKNOWN",
        }),
        position(),
        position({
          legal_entity_id: "00000000-0000-4000-8000-000000000002",
          position_observation_id: "9000000003",
          accession_number: "0000000000-99-000099",
          reported_date: "2099-09-30",
        }),
      ],
      listings,
      ID,
    );
    expect(positions.map((item) => item.reportedDate)).toEqual(["2099-12-31", "2099-03-31"]);
    expect(positions.map((item) => item.registrantCik)).toEqual(["0000000001", "0000000002"]);
    expect(positions.map((item) => item.id)).not.toContain("9000000003");

    const detail = borrowerDetail([row({ reported_date: "2098-12-31", accession_number: "0000000000-98-000001" })], ID);
    render(<BorrowerIntelligence borrower={detail!} positions={positions} />);
    const section = screen.getByRole("heading", { name: "Historical positions" }).closest("section");
    expect(section).toBeTruthy();
    expect(section).toHaveTextContent(TIMELINE_NOTE);
    expect(TIMELINE_NOTE).toMatch(/Matched means this observation is linked to a resolved position/);
    expect(TIMELINE_NOTE).toMatch(/Confirmed changes require comparable observations of the same position/);
    expect(TIMELINE_NOTE).not.toMatch(/same borrower|same legal entity implies/i);
    const renderedDates = [...section!.querySelectorAll("tbody tr")].map((tr) => tr.children[0]?.textContent);
    expect(renderedDates).toEqual(["2099-12-31", "2099-03-31"]);
    expect(section).toHaveTextContent("0000000001");
    expect(section).toHaveTextContent("0000000002");
    expect(section).not.toHaveTextContent("2099-06-30");
    expect(section).not.toHaveTextContent("2099-09-30");
    expect(section).toHaveTextContent("Unresolved");
    expect(section).toHaveTextContent(ACQUISITION_LABEL);
    expect(section).not.toHaveTextContent(/origination/i);
    expect(section).toHaveTextContent("04/2099");
    expect(section).toHaveTextContent("12/2099");
    expect(section).not.toHaveTextContent("2099-12-01");
    expect(section).toHaveTextContent("100");
    expect(section).toHaveTextContent("70");
    expect(section).toHaveTextContent("Unknown");
    expect(section).toHaveTextContent("Currency Unknown");
    expect(section).toHaveTextContent("Structured SEC data set");
    expect(section).not.toHaveTextContent("0.7");
    expect(section).not.toHaveTextContent(/fvr|fair value ratio|exited|repaid|refinanced|new investment|increased exposure|decreased exposure/i);
    const earlyLink = screen.getByRole("link", { name: "0000000000-99-000002" });
    expect(earlyLink).toHaveAttribute("href", listings[1].document_url);
    const lateLink = screen.getByRole("link", { name: "0000000000-99-000001" });
    expect(lateLink).toHaveAttribute("href", listings[0].document_url);
  });

  it("keeps a missing amount unknown and does not invent an exit row", () => {
    const positions = historicalPositions([
      position({
        principal_state: "UNKNOWN",
        principal_raw: null,
        cost_state: "UNKNOWN",
        fair_value_state: "UNKNOWN",
        acquisition_state: "UNKNOWN",
        acquisition_raw: null,
        acquisition_precision: null,
        maturity_source: "UNKNOWN",
        maturity_raw: null,
        maturity_precision: null,
      }),
    ], [], ID);
    expect(positions[0]?.principal).toBe("Unknown");
    expect(positions[0]?.cost).toBe("Unknown");
    expect(positions[0]?.fairValue).toBe("Unknown");
    expect(positions[0]?.acquisition).toBe("Unknown");
    expect(positions[0]?.maturity).toBe("Unknown");
    expect(positions[0]?.principalCurrency).toBeNull();
    const detail = borrowerDetail([row()], ID);
    render(<BorrowerIntelligence borrower={detail!} positions={positions} />);
    const section = screen.getByRole("heading", { name: "Historical positions" }).closest("section");
    expect(section).toHaveTextContent("Unknown");
    expect(section).not.toHaveTextContent(/^0$/);
    expect(section).not.toHaveTextContent(/exit|repaid/i);
  });

  it("keeps a stored instrument type when that observation has no industry", () => {
    const research: ResearchFieldRow[] = [
      {
        position_observation_id: "9000000001",
        field_code: "INSTRUMENT_TYPE",
        raw_value: "TEST LIEN",
        value_state: "REPORTED",
        evidence_level: "L2_ORIGINAL_FILING",
      },
      {
        position_observation_id: "9000000099",
        field_code: "INDUSTRY",
        raw_value: "OTHER INDUSTRY",
        value_state: "REPORTED",
        evidence_level: "L2_ORIGINAL_FILING",
      },
      {
        position_observation_id: "9000000001",
        field_code: "INDUSTRY",
        raw_value: "FIRST INDUSTRY",
        value_state: "REPORTED",
        evidence_level: "L2_ORIGINAL_FILING",
      },
      {
        position_observation_id: "9000000001",
        field_code: "INDUSTRY",
        raw_value: "SECOND INDUSTRY",
        value_state: "REPORTED",
        evidence_level: "L2_ORIGINAL_FILING",
      },
    ];
    const openIndustry = historicalPositions([position()], listings, ID, [
      research[0],
      research[1],
    ]);
    expect(openIndustry).toHaveLength(1);
    expect(openIndustry[0]?.instrumentType).toEqual({ text: "TEST LIEN", evidenceLabel: "Original EDGAR filing" });
    expect(openIndustry[0]?.industry).toEqual({ text: "Unknown", evidenceLabel: null });
    expect(openIndustry[0]?.industry.text).not.toBe("OTHER INDUSTRY");

    const conflicting = historicalPositions([position()], listings, ID, research);
    expect(conflicting[0]?.industry.text).toBe("Multiple values");
    expect(conflicting[0]?.instrumentType.text).toBe("TEST LIEN");

    const detail = borrowerDetail([row()], ID);
    render(<BorrowerIntelligence borrower={detail!} positions={openIndustry} />);
    const section = screen.getByRole("heading", { name: "Historical positions" }).closest("section");
    expect(section).toHaveTextContent("TEST LIEN");
    expect(section).toHaveTextContent("TEST BDC ONE");
    expect(section).toHaveTextContent("Unknown");
    expect(section).not.toHaveTextContent("OTHER INDUSTRY");
    expect(section).toHaveTextContent("Original EDGAR filing");
  });

  it("lists two observations in one reporting period as two rows", () => {
    const positions = historicalPositions([
      position(),
      position({
        position_observation_id: "9000000002",
        accession_number: "0000000000-99-000002",
        principal_raw: "40",
      }),
    ], listings, ID);
    expect(periodBands(positions)).toHaveLength(1);
    expect(periodBands(positions)[0]?.positions.map((item) => item.id)).toEqual(["9000000001", "9000000002"]);
    const detail = borrowerDetail([row()], ID);
    render(<BorrowerIntelligence borrower={detail!} positions={positions} />);
    const section = screen.getByRole("heading", { name: "Historical positions" }).closest("section");
    expect(section?.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(screen.getAllByRole("heading", { name: "Reporting period 2099-12-31" })).toHaveLength(1);
    expect(section).not.toHaveTextContent(/new position|increased exposure|decreased exposure/i);
  });

  it("counts observations and leaves an unknown registrant out of the BDC count", () => {
    const positions = historicalPositions([
      position(),
      position({
        position_observation_id: "9000000002",
        reported_date: "2099-03-31",
        accession_number: "0000000000-99-000002",
        registrant_cik: null,
        registrant_link_status: "UNKNOWN",
      }),
      position({
        position_observation_id: "9000000004",
        reported_date: "2099-06-30",
        accession_number: "0000000000-99-000004",
        registrant_cik: "0000000001",
        continuity_state: "MATCHED",
        instrument_resolution_state: "MATCHED",
      }),
    ], listings, ID);
    const activity = observedActivity(positions, []);
    expect(activity.earliest).toBe("2099-03-31");
    expect(activity.latest).toBe("2099-12-31");
    expect(activity.facts).toEqual([
      { label: "Historical observations", value: "3" },
      { label: "Identified BDCs", value: "1" },
      { label: "Observations with matched instrument identity", value: "1" },
      { label: "Observations with matched position continuity", value: "1" },
      { label: "Confirmed position changes", value: "0" },
      { label: "Observations with unresolved instrument identity or position continuity", value: "2" },
    ]);
    const detail = borrowerDetail([row()], ID);
    render(<BorrowerIntelligence borrower={detail!} positions={positions} />);
    const summary = screen.getByRole("heading", { name: "Observed activity" }).closest("section");
    expect(summary).toHaveTextContent("Historical observations");
    expect(summary).toHaveTextContent("3");
    expect(summary).toHaveTextContent("Identified BDCs");
    expect(summary).not.toHaveTextContent(/score|rank|health/i);
  });
});

function summary(storedObservations: string): BorrowerSummary {
  return {
    id: ID,
    name: "TEST BORROWER A",
    entityState: "Matched",
    entityMethod: "EXACT_NORMALIZED_NAME",
    instrumentState: "Unresolved",
    instrumentMethod: "UNKNOWN_INSTRUMENT_ATTRIBUTES",
    linkedRegistrants: "24",
    observedDates: "16",
    storedObservations,
  };
}

describe("stored observation labels", () => {
  it("keeps a stored-observation count distinct from exposure or coverage", () => {
    render(<BorrowerList borrowers={[summary("181")]} query="" error={null} />);
    expect(screen.getByRole("columnheader", { name: "Stored observations" })).toBeInTheDocument();
    expect(screen.getByText("181")).toBeInTheDocument();
    expect(screen.getByText(COUNT_NOTE)).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Name resolution" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Instrument identity" })).toBeInTheDocument();
    expect(screen.getByText(/Matched · EXACT_NORMALIZED_NAME/)).toBeInTheDocument();
    const instrumentCell = screen.getByRole("columnheader", { name: "Instrument identity" });
    const instrumentIndex = [...instrumentCell.parentElement!.children].indexOf(instrumentCell);
    const row = screen.getByRole("row", { name: /TEST BORROWER A/ });
    expect(row.children[instrumentIndex]).toHaveTextContent("Unresolved · UNKNOWN_INSTRUMENT_ATTRIBUTES");
    const headers = screen.getAllByRole("columnheader").map((header) => header.textContent ?? "").join(" ");
    expect(headers).not.toMatch(/exposure|coverage|active holdings|positions/i);
    expect(document.querySelector(".overflow-x-auto")).toBeTruthy();
  });
});

const POSITION = "00000000-0000-4000-8000-0000000000aa";
const OTHER = "00000000-0000-4000-8000-000000000002";

function comparison(overrides: Partial<PositionComparisonRow> = {}): PositionComparisonRow {
  return {
    legal_entity_id: ID,
    position_id: POSITION,
    earlier_position_observation_id: "9100000001",
    later_position_observation_id: "9100000002",
    earlier_reported_date: "2099-03-31",
    later_reported_date: "2099-06-30",
    earlier_accession_number: "0000000000-99-000001",
    later_accession_number: "0000000000-99-000002",
    earlier_observation_evidence_id: "501",
    later_observation_evidence_id: "502",
    earlier_observation_evidence_level: "L1_STRUCTURED_DATASET",
    later_observation_evidence_level: "L2_ORIGINAL_FILING",
    earlier_registrant_cik: "0000000001",
    earlier_registrant_link_status: "LINKED",
    later_registrant_cik: "0000000001",
    later_registrant_link_status: "LINKED",
    principal_comparison_state: "COMPARABLE",
    earlier_principal_raw: "100",
    later_principal_raw: "120",
    principal_delta: "7",
    earlier_principal_currency_state: "UNKNOWN",
    later_principal_currency_state: "UNKNOWN",
    cost_comparison_state: "COMPARABLE",
    earlier_cost_raw: "80",
    later_cost_raw: "90",
    cost_delta: "10",
    earlier_cost_currency_state: "UNKNOWN",
    later_cost_currency_state: "UNKNOWN",
    fair_value_comparison_state: "COMPARABLE",
    earlier_fair_value_raw: "70",
    later_fair_value_raw: "60",
    fair_value_delta: "-10",
    earlier_fair_value_currency_state: "UNKNOWN",
    later_fair_value_currency_state: "UNKNOWN",
    maturity_comparison_state: "COMPARABLE",
    maturity_changed: true,
    earlier_maturity_raw: "12/2099",
    later_maturity_raw: "06/2100",
    earlier_maturity_precision: "MONTH",
    later_maturity_precision: "MONTH",
    earlier_maturity_date: "2099-12-01",
    later_maturity_date: "2100-06-01",
    acquisition_comparison_state: "COMPARABLE",
    earlier_acquisition_raw: "2099-01-15",
    later_acquisition_raw: "2099-01-15",
    earlier_acquisition_precision: null,
    later_acquisition_precision: null,
    earlier_acquisition_date: "2099-01-15",
    later_acquisition_date: "2099-01-15",
    interest_rate_comparison_state: "INSUFFICIENT_DATA",
    earlier_interest_rate_raw: "0.05",
    later_interest_rate_raw: null,
    interest_rate_delta: "0",
    spread_comparison_state: "INSUFFICIENT_DATA",
    earlier_spread_raw: null,
    later_spread_raw: null,
    spread_delta: null,
    interest_rate_floor_comparison_state: "COMPARABLE",
    earlier_interest_rate_floor_raw: "0.04",
    later_interest_rate_floor_raw: "0.05",
    interest_rate_floor_delta: "0.01",
    ...overrides,
  };
}

describe("confirmed position changes", () => {
  const listings = [
    row({
      accession_number: "0000000000-99-000001",
      document_url: `${EDGAR_DOCUMENT_PREFIX}0000000000/000000000099000001/test-filing.htm`,
    }),
    row({
      accession_number: "0000000000-99-000002",
      document_url: `${EDGAR_DOCUMENT_PREFIX}0000000000/000000000099000002/other-filing.htm`,
    }),
  ];

  it("renders stored comparison values and does not recalculate them", () => {
    const comparisons = positionComparisons([
      comparison(),
      comparison({
        legal_entity_id: OTHER,
        position_id: "00000000-0000-4000-8000-0000000000bb",
        earlier_position_observation_id: "9100000008",
        later_position_observation_id: "9100000009",
        later_reported_date: "2099-12-31",
        principal_delta: "999",
      }),
      comparison({
        position_id: "00000000-0000-4000-8000-0000000000cc",
        earlier_position_observation_id: "9100000003",
        later_position_observation_id: "9100000004",
        earlier_reported_date: "2099-06-30",
        later_reported_date: "2099-09-30",
        earlier_accession_number: "0000000000-99-000002",
        later_accession_number: "0000000000-99-000001",
      }),
    ], listings, ID);
    expect(comparisons).toHaveLength(2);
    expect(comparisons.map((item) => item.laterDate)).toEqual(["2099-09-30", "2099-06-30"]);
    expect(comparisons.map((item) => item.positionId)).not.toContain("00000000-0000-4000-8000-0000000000bb");
    const principal = comparisons[1]?.fields.find((field) => field.label === "Principal");
    const fairValue = comparisons[1]?.fields.find((field) => field.label === "Fair value");
    const rate = comparisons[1]?.fields.find((field) => field.label === "Interest rate");
    const maturity = comparisons[1]?.fields.find((field) => field.label === "Maturity");
    const acquisition = comparisons[1]?.fields.find((field) => field.label === COMPARISON_ACQUISITION_LABEL);
    expect(principal).toMatchObject({ earlier: "100", later: "120", change: "7", state: "Comparable" });
    expect(fairValue).toMatchObject({ earlier: "70", later: "60", change: "-10", state: "Comparable" });
    expect(rate).toMatchObject({ earlier: "0.05", later: "Unknown", change: "Insufficient data", state: "Insufficient data" });
    expect(maturity).toMatchObject({ earlier: "12/2099", later: "06/2100", change: "Yes", state: "Comparable" });
    expect(acquisition?.label).toBe("Acquisition date");

    const detail = borrowerDetail([row()], ID);
    render(<BorrowerIntelligence borrower={detail!} comparisons={comparisons} />);
    const section = screen.getByRole("heading", { name: "Confirmed Position Changes" }).closest("section");
    expect(section).toBeTruthy();
    expect(section).toHaveTextContent(COMPARISON_NOTE);
    expect(section).toHaveTextContent(CONTINUITY_SCOPE_NOTE);
    expect(section).toHaveTextContent(EVIDENCE_REVIEW_NOTE);
    expect(COMPARISON_NOTE).toMatch(/across reporting periods/);
    expect(COMPARISON_NOTE).toMatch(/matched observation is not itself a confirmed change/i);
    expect(section).toHaveTextContent("2099-03-31");
    expect(section).toHaveTextContent("2099-06-30");
    expect(section).toHaveTextContent("2099-09-30");
    expect(section).toHaveTextContent("Evidence & change review");
    expect(section).toHaveTextContent("Observation evidence 501");
    expect(section).toHaveTextContent("Observation evidence 502");
    expect(section).toHaveTextContent("Position observation");
    expect(section).toHaveTextContent("9100000001");
    expect(section).toHaveTextContent("9100000002");
    const principalChanges = [...section!.querySelectorAll("tbody tr")]
      .filter((tr) => tr.querySelector("th")?.textContent === "Principal")
      .map((tr) => tr.children[3]?.textContent?.replace(/\s+/g, " ").trim());
    const fairValueChanges = [...section!.querySelectorAll("tbody tr")]
      .filter((tr) => tr.querySelector("th")?.textContent === "Fair value")
      .map((tr) => tr.children[3]?.textContent?.replace(/\s+/g, " ").trim());
    const rateChanges = [...section!.querySelectorAll("tbody tr")]
      .filter((tr) => tr.querySelector("th")?.textContent === "Interest rate")
      .map((tr) => tr.children[3]?.textContent?.replace(/\s+/g, " ").trim());
    expect(principalChanges.every((text) => text?.startsWith("7"))).toBe(true);
    expect(fairValueChanges.every((text) => text?.startsWith("-10"))).toBe(true);
    expect(rateChanges.every((text) => text?.startsWith("Insufficient data"))).toBe(true);
    expect(section).toHaveTextContent("Insufficient data");
    expect(section).toHaveTextContent("Acquisition date");
    expect(section).toHaveTextContent("12/2099");
    expect(section).toHaveTextContent("06/2100");
    expect(section).not.toHaveTextContent("2099-12-01");
    expect(section).not.toHaveTextContent("2100-06-01");
    expect(section).not.toHaveTextContent("999");
    expect(section).toHaveTextContent("0000000000-99-000001");
    expect(section).toHaveTextContent("0000000000-99-000002");
    expect(section).toHaveTextContent("Structured SEC data set");
    expect(section).toHaveTextContent("Original EDGAR filing");
    expect(section).not.toHaveTextContent(/credit deterioration|credit improvement|default|non-accrual|repayment|exit|refinanc|origination|risk increase|risk decrease|fvr|fair value ratio/i);
    const earlyLink = withinSectionLink(section, "0000000000-99-000001");
    expect(earlyLink).toHaveAttribute("href", listings[0].document_url);
    const lateLink = withinSectionLink(section, "0000000000-99-000002");
    expect(lateLink).toHaveAttribute("href", listings[1].document_url);
  });

  it("shows the empty state when a matched entity has no confirmed same-position comparison", () => {
    const detail = borrowerDetail([row()], ID);
    render(<BorrowerIntelligence borrower={detail!} comparisons={[]} />);
    const section = screen.getByRole("heading", { name: "Confirmed Position Changes" }).closest("section");
    expect(section).toHaveTextContent(EMPTY_COMPARISONS);
    expect(section).toHaveTextContent(CONTINUITY_SCOPE_NOTE);
    expect(section).toHaveTextContent(EVIDENCE_REVIEW_NOTE);
    expect(section).toHaveTextContent("MATCHED");
    expect(section).toHaveTextContent("matched legal-entity name is not a confirmed position");
    expect(section).not.toHaveTextContent("Amount evidence");
    expect(section).not.toHaveTextContent("Earlier source filing");
    expect(section).not.toHaveTextContent("could not be read");
    expect(section).not.toHaveTextContent(/no credit|no risk|no repayment|no refinancing/i);
  });

  it("reviews a same-currency comparable amount with prior, current, delta, and SEC links", () => {
    const comparisons = positionComparisons([
      comparison({
        principal_comparison_state: "COMPARABLE",
        principal_delta: "20",
        earlier_principal_currency_state: "FROM_FILING",
        later_principal_currency_state: "FROM_FILING",
        fair_value_comparison_state: "COMPARABLE",
        fair_value_delta: "-10",
        earlier_fair_value_currency_state: "FROM_FILING",
        later_fair_value_currency_state: "FROM_FILING",
        cost_comparison_state: "COMPARABLE",
        cost_delta: "10",
        earlier_cost_currency_state: "FROM_FILING",
        later_cost_currency_state: "FROM_FILING",
      }),
    ], listings, ID);
    const principal = comparisons[0]?.fields.find((field) => field.label === "Principal");
    expect(principal).toMatchObject({
      earlier: "100",
      later: "120",
      change: "20",
      state: "Comparable",
      reviewNote: COMPARABLE_CHANGE_NOTE,
      earlierCurrency: null,
      laterCurrency: null,
    });
    const detail = borrowerDetail([row()], ID);
    render(<BorrowerIntelligence borrower={detail!} comparisons={comparisons} />);
    const section = screen.getByRole("heading", { name: "Confirmed Position Changes" }).closest("section");
    expect(section).toHaveTextContent("Evidence & change review · 2099-03-31 to 2099-06-30");
    expect(section).toHaveTextContent("Amount evidence");
    expect(section).toHaveTextContent(COMPARABLE_CHANGE_NOTE);
    expect(section).toHaveTextContent("Stored delta");
    expect(section).toHaveTextContent("20");
    expect(section).toHaveTextContent("-10");
    expect(withinSectionLink(section, "0000000000-99-000001")).toHaveAttribute("href", listings[0].document_url);
    expect(withinSectionLink(section, "0000000000-99-000002")).toHaveAttribute("href", listings[1].document_url);
    expect(section).not.toHaveTextContent(/deterioration|improvement|default|non-accrual|repayment|exit|refinanc|origination/i);
  });

  it("explains unknown currency without inventing a period delta", () => {
    const comparisons = positionComparisons([
      comparison({
        principal_comparison_state: "INSUFFICIENT_DATA",
        principal_delta: null,
        earlier_principal_raw: "10",
        later_principal_raw: "25",
        earlier_principal_currency_state: "UNKNOWN",
        later_principal_currency_state: "UNKNOWN",
        fair_value_comparison_state: "INSUFFICIENT_DATA",
        fair_value_delta: "999",
        earlier_fair_value_raw: "8",
        later_fair_value_raw: "20",
        earlier_fair_value_currency_state: "AMBIGUOUS",
        later_fair_value_currency_state: "AMBIGUOUS",
        cost_comparison_state: "INSUFFICIENT_DATA",
        cost_delta: null,
        earlier_cost_raw: "9",
        later_cost_raw: "22",
        earlier_cost_currency_state: "UNKNOWN",
        later_cost_currency_state: "UNKNOWN",
      }),
    ], listings, ID);
    expect(comparisons[0]?.fields.find((field) => field.label === "Principal")).toMatchObject({
      change: "Insufficient data",
      state: "Insufficient data",
      reviewNote: CHANGE_NOT_ESTABLISHED_CURRENCY_UNKNOWN,
      earlierCurrency: CURRENCY_NOTE,
      laterCurrency: CURRENCY_NOTE,
    });
    expect(comparisons[0]?.fields.find((field) => field.label === "Fair value")).toMatchObject({
      change: "Insufficient data",
      reviewNote: CHANGE_NOT_ESTABLISHED_CURRENCY_UNKNOWN,
      earlierCurrency: "Currency Ambiguous",
      laterCurrency: "Currency Ambiguous",
    });
    const detail = borrowerDetail([row()], ID);
    render(<BorrowerIntelligence borrower={detail!} comparisons={comparisons} />);
    const section = screen.getByRole("heading", { name: "Confirmed Position Changes" }).closest("section");
    expect(section).toHaveTextContent(CHANGE_NOT_ESTABLISHED_CURRENCY_UNKNOWN);
    expect(section).toHaveTextContent(CURRENCY_NOTE);
    expect(section).toHaveTextContent("Currency Ambiguous");
    expect(section).toHaveTextContent("Not shown");
    expect(section).not.toHaveTextContent("999");
    const principalDeltaCells = [...section!.querySelectorAll("li")].filter((item) =>
      item.textContent?.includes("Principal"));
    expect(principalDeltaCells.some((item) => item.textContent?.includes("Not shown"))).toBe(true);
  });

  it("uses a generic insufficient explanation when currency states are established but codes are unavailable", () => {
    const comparisons = positionComparisons([
      comparison({
        principal_comparison_state: "INSUFFICIENT_DATA",
        principal_delta: "15",
        earlier_principal_raw: "10",
        later_principal_raw: "25",
        earlier_principal_currency_state: "FROM_FILING",
        later_principal_currency_state: "FROM_FILING",
        fair_value_comparison_state: "INSUFFICIENT_DATA",
        fair_value_delta: null,
        earlier_fair_value_raw: "8",
        later_fair_value_raw: "20",
        earlier_fair_value_currency_state: "FROM_FILING",
        later_fair_value_currency_state: "FROM_FILING",
      }),
    ], listings, ID);
    expect(comparisons[0]?.fields.find((field) => field.label === "Principal")?.reviewNote)
      .toBe(CHANGE_NOT_ESTABLISHED);
    expect(comparisons[0]?.fields.find((field) => field.label === "Principal")?.reviewNote)
      .not.toMatch(/incompatible|not established and compatible/i);
    const detail = borrowerDetail([row()], ID);
    render(<BorrowerIntelligence borrower={detail!} comparisons={comparisons} />);
    const section = screen.getByRole("heading", { name: "Confirmed Position Changes" }).closest("section");
    expect(section).toHaveTextContent(CHANGE_NOT_ESTABLISHED);
    expect(section).not.toHaveTextContent(/currency is not established and compatible/i);
    expect(section).toHaveTextContent("Not shown");
    expect(section).not.toHaveTextContent("Principal increased");
    const amountPrincipal = [...section!.querySelectorAll("li")].find((item) =>
      item.querySelector("p")?.textContent === "Principal");
    expect(amountPrincipal?.textContent).toContain("Not shown");
    expect(amountPrincipal?.textContent).not.toMatch(/\b15\b/);
  });

  it("explains a missing amount without inventing a period delta", () => {
    const comparisons = positionComparisons([
      comparison({
        principal_comparison_state: "INSUFFICIENT_DATA",
        principal_delta: "40",
        earlier_principal_raw: "100",
        later_principal_raw: null,
        earlier_principal_currency_state: "FROM_FILING",
        later_principal_currency_state: "FROM_FILING",
        fair_value_comparison_state: "INSUFFICIENT_DATA",
        fair_value_delta: null,
        earlier_fair_value_raw: null,
        later_fair_value_raw: "60",
        earlier_fair_value_currency_state: "FROM_FILING",
        later_fair_value_currency_state: "FROM_FILING",
      }),
    ], listings, ID);
    expect(comparisons[0]?.fields.find((field) => field.label === "Principal")).toMatchObject({
      earlier: "100",
      later: "Unknown",
      change: "Insufficient data",
      reviewNote: CHANGE_NOT_ESTABLISHED_MISSING_AMOUNT,
    });
    expect(comparisons[0]?.fields.find((field) => field.label === "Fair value")).toMatchObject({
      earlier: "Unknown",
      later: "60",
      reviewNote: CHANGE_NOT_ESTABLISHED_MISSING_AMOUNT,
    });
    const detail = borrowerDetail([row()], ID);
    render(<BorrowerIntelligence borrower={detail!} comparisons={comparisons} />);
    const section = screen.getByRole("heading", { name: "Confirmed Position Changes" }).closest("section");
    expect(section).toHaveTextContent(CHANGE_NOT_ESTABLISHED_MISSING_AMOUNT);
    expect(section).toHaveTextContent("Not shown");
    const amountPrincipal = [...section!.querySelectorAll("li")].find((item) =>
      item.querySelector("p")?.textContent === "Principal");
    expect(amountPrincipal?.textContent).toContain("Not shown");
    expect(amountPrincipal?.textContent).not.toMatch(/\b40\b/);
  });

  it("keeps unavailable filing URLs explicit while retaining the accession and evidence id", () => {
    const comparisons = positionComparisons([
      comparison({
        earlier_observation_evidence_id: null,
        later_observation_evidence_id: "502",
      }),
    ], [], ID);
    expect(comparisons[0]?.earlier.documentUrl).toBeNull();
    expect(comparisons[0]?.later.documentUrl).toBeNull();
    expect(comparisons[0]?.earlier.evidenceId).toBe("Unknown");
    expect(comparisons[0]?.later.evidenceId).toBe("502");
    const detail = borrowerDetail([row()], ID);
    render(<BorrowerIntelligence borrower={detail!} comparisons={comparisons} />);
    const section = screen.getByRole("heading", { name: "Confirmed Position Changes" }).closest("section");
    expect(section).toHaveTextContent("Filing URL unavailable");
    expect(section).toHaveTextContent("Observation evidence Unknown");
    expect(section).toHaveTextContent("Observation evidence 502");
    expect(section).toHaveTextContent("0000000000-99-000001");
    expect(section!.querySelector('a[href*="sec.gov"]')).toBeNull();
  });

  it("labels stored principal, fair value, and maturity differences without inventing a change", () => {
    const comparisons = positionComparisons([
      comparison(),
      comparison({
        position_id: "00000000-0000-4000-8000-0000000000dd",
        earlier_position_observation_id: "9100000005",
        later_position_observation_id: "9100000006",
        earlier_reported_date: "2099-01-31",
        later_reported_date: "2099-02-28",
        principal_comparison_state: "INSUFFICIENT_DATA",
        principal_delta: "5",
        fair_value_comparison_state: "COMPARABLE",
        fair_value_delta: "0",
        maturity_comparison_state: "INSUFFICIENT_DATA",
        maturity_changed: null,
      }),
    ], listings, ID);
    const differences = storedDifferences(comparisons);
    expect(differences.map((item) => item.text)).toEqual([
      "2099-03-31 to 2099-06-30: Principal later stored value is higher. Stored delta 7.",
      "2099-03-31 to 2099-06-30: Fair value later stored value is lower. Stored delta -10.",
      "2099-03-31 to 2099-06-30: maturity stored values differ.",
      "2099-01-31 to 2099-02-28: Fair value later stored value is the same. Stored delta 0.",
    ]);
    expect(differences.map((item) => item.text).join(" ")).not.toMatch(/interest|spread|floor|new position|exit/i);
    expect(storedDifferences(positionComparisons([
      comparison({ principal_delta: "not-stored", fair_value_comparison_state: "INSUFFICIENT_DATA", maturity_changed: null, maturity_comparison_state: "INSUFFICIENT_DATA" }),
    ], listings, ID))).toEqual([]);
  });

  describe("field-level evidence trace", () => {
    function tracedComparisons(trace: FieldValueTraceRow[]) {
      return enrichComparisonsWithFieldTrace(
        positionComparisons([comparison()], listings, ID),
        trace,
      );
    }

    it("renders field evidence ids and normalization rule versions when stored", () => {
      const detail = borrowerDetail([row()], ID);
      render(<BorrowerIntelligence borrower={detail!} comparisons={tracedComparisons([
        {
          position_observation_id: "9100000001",
          field_code: "PRINCIPAL_AMOUNT",
          raw_value: "100",
          normalized_numeric: "100",
          currency_code: "USD",
          currency_state: "FROM_FILING",
          scale_state: "UNITS",
          evidence_id: "9199307",
          normalization_rule_version_id: "42",
        },
        {
          position_observation_id: "9100000002",
          field_code: "PRINCIPAL_AMOUNT",
          raw_value: "120",
          normalized_numeric: "120",
          currency_code: "USD",
          currency_state: "FROM_FILING",
          scale_state: "UNITS",
          evidence_id: "9199308",
          normalization_rule_version_id: "42",
        },
      ])} />);
      const section = screen.getByRole("heading", { name: "Confirmed Position Changes" }).closest("section");
      expect(section).toHaveTextContent(FIELD_TRACE_NOTE);
      expect(section).toHaveTextContent("Field trace");
      expect(section).toHaveTextContent("Field evidence id");
      expect(section).toHaveTextContent("9199307");
      expect(section).toHaveTextContent("9199308");
      expect(section).toHaveTextContent("Normalization rule version");
      expect(section).toHaveTextContent("42");
      expect(section).toHaveTextContent("Observed value");
      expect(section).toHaveTextContent("Normalized stored value");
    });

    it("shows unavailable field evidence when trace rows are missing", () => {
      const detail = borrowerDetail([row()], ID);
      render(<BorrowerIntelligence borrower={detail!} comparisons={tracedComparisons([])} />);
      const section = screen.getByRole("heading", { name: "Confirmed Position Changes" }).closest("section");
      expect(section).toHaveTextContent("Field evidence id");
      expect(section!.textContent?.match(new RegExp(TRACE_UNAVAILABLE, "g"))?.length ?? 0).toBeGreaterThan(3);
    });

    it("shows both observed and normalized values when both are stored", () => {
      const detail = borrowerDetail([row()], ID);
      render(<BorrowerIntelligence borrower={detail!} comparisons={tracedComparisons([
        {
          position_observation_id: "9100000001",
          field_code: "PRINCIPAL_AMOUNT",
          raw_value: "1,000",
          normalized_numeric: "1000",
          currency_code: "USD",
          currency_state: "FROM_FILING",
          scale_state: "THOUSANDS",
          evidence_id: "9001",
          normalization_rule_version_id: "7",
        },
      ])} />);
      const section = screen.getByRole("heading", { name: "Confirmed Position Changes" }).closest("section");
      expect(section).toHaveTextContent("1,000");
      expect(section).toHaveTextContent("1000");
    });

    it("shows unavailable normalization rule when not stored on the field row", () => {
      const detail = borrowerDetail([row()], ID);
      render(<BorrowerIntelligence borrower={detail!} comparisons={tracedComparisons([
        {
          position_observation_id: "9100000002",
          field_code: "PRINCIPAL_AMOUNT",
          raw_value: "120",
          normalized_numeric: "120",
          currency_code: "USD",
          currency_state: "FROM_FILING",
          scale_state: "UNITS",
          evidence_id: "9002",
          normalization_rule_version_id: null,
        },
      ])} />);
      const section = screen.getByRole("heading", { name: "Confirmed Position Changes" }).closest("section");
      expect(section).toHaveTextContent("9002");
      expect(section!.textContent?.match(new RegExp(TRACE_UNAVAILABLE, "g"))?.length ?? 0).toBeGreaterThan(0);
    });

    it("keeps currency ambiguity on comparison amounts without inventing ISO codes", () => {
      const comparisons = enrichComparisonsWithFieldTrace(
        positionComparisons([
          comparison({
            principal_comparison_state: "INSUFFICIENT_DATA",
            principal_delta: null,
            earlier_principal_raw: "10",
            later_principal_raw: "25",
            earlier_principal_currency_state: "AMBIGUOUS",
            later_principal_currency_state: "AMBIGUOUS",
          }),
        ], listings, ID),
        [{
          position_observation_id: "9100000001",
          field_code: "PRINCIPAL_AMOUNT",
          raw_value: "10",
          normalized_numeric: "10",
          currency_code: null,
          currency_state: "AMBIGUOUS",
          scale_state: "UNITS",
          evidence_id: "9010",
          normalization_rule_version_id: "1",
        }],
      );
      const detail = borrowerDetail([row()], ID);
      render(<BorrowerIntelligence borrower={detail!} comparisons={comparisons} />);
      const section = screen.getByRole("heading", { name: "Confirmed Position Changes" }).closest("section");
      expect(section).toHaveTextContent(CHANGE_NOT_ESTABLISHED_CURRENCY_UNKNOWN);
      expect(section).toHaveTextContent("Currency Ambiguous");
      expect(section).toHaveTextContent("9010");
      expect(section).not.toHaveTextContent("USD");
    });
  });
});

const LIEN = "00000000-0000-4000-8000-0000000000c1";
const REVOLVER = "00000000-0000-4000-8000-0000000000c2";
const PREFERRED_EQUITY = "00000000-0000-4000-8000-0000000000c3";
const PREFERRED_STOCK = "00000000-0000-4000-8000-0000000000c4";

function quietComparison(overrides: Partial<PositionComparisonRow> = {}): PositionComparisonRow {
  return comparison({
    principal_delta: "0",
    fair_value_delta: "0",
    maturity_changed: false,
    cost_comparison_state: "INSUFFICIENT_DATA",
    earlier_cost_raw: null,
    later_cost_raw: null,
    cost_delta: null,
    interest_rate_floor_comparison_state: "INSUFFICIENT_DATA",
    earlier_interest_rate_floor_raw: null,
    later_interest_rate_floor_raw: null,
    interest_rate_floor_delta: null,
    acquisition_comparison_state: "INSUFFICIENT_DATA",
    earlier_acquisition_raw: null,
    later_acquisition_raw: null,
    ...overrides,
  });
}

describe("what changed", () => {
  const listings = [
    row({
      alias_text: "TEST CHYRONHEGO",
      accession_number: "0000000000-99-000001",
      document_url: `${EDGAR_DOCUMENT_PREFIX}0000000000/000000000099000001/test-filing.htm`,
    }),
    row({
      alias_text: "TEST CHYRONHEGO",
      accession_number: "0000000000-99-000002",
      document_url: `${EDGAR_DOCUMENT_PREFIX}0000000000/000000000099000002/other-filing.htm`,
    }),
  ];

  function typedPositions(types: Array<[string, string]>) {
    const observations = types.flatMap(([observationId], index) => [
      position({
        position_observation_id: observationId,
        reported_date: index % 2 === 0 ? "2099-03-31" : "2099-06-30",
        accession_number: index % 2 === 0 ? "0000000000-99-000001" : "0000000000-99-000002",
        instrument_resolution_state: "MATCHED",
        continuity_state: "MATCHED",
      }),
    ]);
    const research: ResearchFieldRow[] = types.map(([observationId, instrument]) => ({
      position_observation_id: observationId,
      field_code: "INSTRUMENT_TYPE",
      raw_value: instrument,
      value_state: "REPORTED",
      evidence_level: "L1_STRUCTURED_DATASET",
    }));
    return historicalPositions(observations, listings, ID, research);
  }

  it("lists only stored principal, fair value, and maturity movements", () => {
    const comparisons = positionComparisons([
      quietComparison({ principal_delta: "7" }),
      quietComparison({
        position_id: "00000000-0000-4000-8000-0000000000d1",
        earlier_position_observation_id: "9100000011",
        later_position_observation_id: "9100000012",
        principal_delta: "-4",
      }),
      quietComparison({
        position_id: "00000000-0000-4000-8000-0000000000d2",
        earlier_position_observation_id: "9100000013",
        later_position_observation_id: "9100000014",
        fair_value_delta: "8",
      }),
      quietComparison({
        position_id: "00000000-0000-4000-8000-0000000000d3",
        earlier_position_observation_id: "9100000015",
        later_position_observation_id: "9100000016",
        fair_value_delta: "-2",
      }),
      quietComparison({
        position_id: "00000000-0000-4000-8000-0000000000d4",
        earlier_position_observation_id: "9100000017",
        later_position_observation_id: "9100000018",
        maturity_changed: true,
        earlier_maturity_raw: "2099-01-31",
        later_maturity_raw: "2100-01-31",
        earlier_maturity_precision: "DAY",
        later_maturity_precision: "DAY",
      }),
    ], listings, ID);
    const items = whatChanged(comparisons, [], "TEST BORROWER A");
    expect(items.map((item) => item.signal)).toEqual([
      "principal-increased",
      "principal-decreased",
      "fair-value-increased",
      "fair-value-decreased",
      "maturity-changed",
    ]);
    expect(items.map((item) => item.statement)).toEqual([
      "Principal increased by 7 · Currency Unknown.",
      "Principal decreased by 4 · Currency Unknown.",
      "Fair value increased by 8 · Currency Unknown.",
      "Fair value decreased by 2 · Currency Unknown.",
      "Maturity changed from 2099-01-31 to 2100-01-31.",
    ]);
    expect(items.map((item) => item.storedDelta)).toEqual(["7", "-4", "8", "-2", null]);
    expect(items.every((item) => item.legalEntityName === "TEST BORROWER A")).toBe(true);
    expect(items.every((item) => item.earlierDate === "2099-03-31" && item.laterDate === "2099-06-30")).toBe(true);
    expect(new Set(items.map((item) => item.positionId)).size).toBe(5);
  });

  it("omits principal and fair value movements when currency compatibility failed", () => {
    const comparisons = positionComparisons([
      quietComparison({
        principal_comparison_state: "INSUFFICIENT_DATA",
        principal_delta: null,
        earlier_principal_raw: "10",
        later_principal_raw: "25",
        earlier_principal_currency_state: "FROM_FILING",
        later_principal_currency_state: "FROM_FILING",
        fair_value_comparison_state: "INSUFFICIENT_DATA",
        fair_value_delta: null,
        earlier_fair_value_raw: "8",
        later_fair_value_raw: "20",
        earlier_fair_value_currency_state: "FROM_FILING",
        later_fair_value_currency_state: "FROM_FILING",
        maturity_changed: false,
      }),
    ], listings, ID);
    const items = whatChanged(comparisons, [], "TEST BORROWER A");
    expect(items).toEqual([]);
    expect(comparisons[0]?.fields.find((field) => field.label === "Principal")).toMatchObject({
      change: "Insufficient data",
      state: "Insufficient data",
      reviewNote: CHANGE_NOT_ESTABLISHED,
    });
    expect(comparisons[0]?.fields.find((field) => field.label === "Fair value")).toMatchObject({
      change: "Insufficient data",
      state: "Insufficient data",
      reviewNote: CHANGE_NOT_ESTABLISHED,
    });
  });

  it("omits comparable-but-unchanged values and insufficient cost", () => {
    const comparisons = positionComparisons([
      quietComparison({
        cost_comparison_state: "INSUFFICIENT_DATA",
        cost_delta: "50",
        interest_rate_comparison_state: "COMPARABLE",
        earlier_interest_rate_raw: "0.01",
        later_interest_rate_raw: "0.02",
        interest_rate_delta: "0.01",
        spread_comparison_state: "COMPARABLE",
        earlier_spread_raw: "0.01",
        later_spread_raw: "0.03",
        spread_delta: "0.02",
        interest_rate_floor_comparison_state: "COMPARABLE",
        earlier_interest_rate_floor_raw: "0.01",
        later_interest_rate_floor_raw: "0.04",
        interest_rate_floor_delta: "0.03",
        acquisition_comparison_state: "COMPARABLE",
        earlier_acquisition_raw: "2099-01-01",
        later_acquisition_raw: "2099-02-01",
      }),
    ], listings, ID);
    expect(whatChanged(comparisons, [], "TEST BORROWER A")).toEqual([]);
    const detail = borrowerDetail([row()], ID);
    render(<BorrowerIntelligence borrower={detail!} comparisons={comparisons} />);
    const section = screen.getByRole("heading", { name: "What Changed" }).closest("section");
    expect(section).toHaveTextContent(EMPTY_WHAT_CHANGED);
    expect(section).toHaveTextContent(WHAT_CHANGED_NOTE);
    expect(section).not.toHaveTextContent("Principal increased");
    expect(section).not.toHaveTextContent("50");
    expect(section).not.toHaveTextContent("0.01");
    expect(section).not.toHaveTextContent("0.02");
    expect(section).not.toHaveTextContent("0.03");
  });

  it("keeps ChyronHego First Lien and Revolver changes separate from Preferred Equity", () => {
    const comparisons = positionComparisons([
      quietComparison({
        position_id: LIEN,
        earlier_position_observation_id: "9100000101",
        later_position_observation_id: "9100000102",
        principal_delta: "11",
        fair_value_delta: "12",
        maturity_changed: true,
        earlier_maturity_raw: "2099-12-31",
        later_maturity_raw: "2101-12-31",
        earlier_maturity_precision: "DAY",
        later_maturity_precision: "DAY",
      }),
      quietComparison({
        position_id: REVOLVER,
        earlier_position_observation_id: "9100000201",
        later_position_observation_id: "9100000202",
        principal_delta: "13",
        fair_value_delta: "-14",
        maturity_changed: true,
        earlier_maturity_raw: "2099-12-31",
        later_maturity_raw: "2102-12-31",
        earlier_maturity_precision: "DAY",
        later_maturity_precision: "DAY",
      }),
      quietComparison({
        position_id: PREFERRED_EQUITY,
        earlier_position_observation_id: "9100000301",
        later_position_observation_id: "9100000302",
        principal_comparison_state: "INSUFFICIENT_DATA",
        principal_delta: null,
        fair_value_delta: "15",
        maturity_comparison_state: "INSUFFICIENT_DATA",
        maturity_changed: null,
      }),
      quietComparison({
        position_id: PREFERRED_STOCK,
        earlier_position_observation_id: "9100000401",
        later_position_observation_id: "9100000402",
        principal_comparison_state: "INSUFFICIENT_DATA",
        principal_delta: null,
        fair_value_comparison_state: "INSUFFICIENT_DATA",
        fair_value_delta: null,
        maturity_comparison_state: "INSUFFICIENT_DATA",
        maturity_changed: null,
      }),
    ], listings, ID);
    const positions = typedPositions([
      ["9100000101", "First Lien"],
      ["9100000102", "First Lien"],
      ["9100000201", "Revolver"],
      ["9100000202", "Revolver"],
      ["9100000301", "Preferred Equity"],
      ["9100000302", "Preferred Equity"],
      ["9100000401", "Preferred Stock"],
      ["9100000402", "Preferred Stock"],
    ]);
    const items = whatChanged(comparisons, positions, "TEST CHYRONHEGO");
    const byPosition = (positionId: string) => items.filter((item) => item.positionId === positionId);
    expect(byPosition(LIEN).map((item) => item.signal)).toEqual([
      "principal-increased",
      "fair-value-increased",
      "maturity-changed",
    ]);
    expect(byPosition(LIEN).every((item) => item.instrument === "First Lien")).toBe(true);
    expect(byPosition(REVOLVER).map((item) => `${item.signal}:${item.instrument}`)).toEqual([
      "principal-increased:Revolver",
      "fair-value-decreased:Revolver",
      "maturity-changed:Revolver",
    ]);
    expect(byPosition(PREFERRED_EQUITY).map((item) => item.statement)).toEqual([
      "Fair value increased by 15 · Currency Unknown.",
    ]);
    expect(byPosition(PREFERRED_EQUITY)[0]?.instrument).toBe("Preferred Equity");
    expect(byPosition(PREFERRED_STOCK)).toEqual([]);
    const preferred = byPosition(PREFERRED_EQUITY).map((item) => item.statement).join(" ");
    expect(preferred).not.toContain("11");
    expect(preferred).not.toContain("2101-12-31");
    expect(preferred).not.toContain("2102-12-31");
    expect(items.map((item) => item.statement).join(" ")).not.toMatch(
      /credit improved|credit deteriorated|new money|repayment|refinanced|default|risk increased|risk decreased|origination|non-accrual|pik|exit|score|rank|new position/i,
    );

    const detail = borrowerDetail([row({ alias_text: "TEST CHYRONHEGO" })], ID);
    render(<BorrowerIntelligence borrower={detail!} positions={positions} comparisons={comparisons} />);
    const section = screen.getByRole("heading", { name: "What Changed" }).closest("section");
    expect(section).toHaveTextContent(WHAT_CHANGED_NOTE);
    expect(section).toHaveTextContent("First Lien");
    expect(section).toHaveTextContent("Revolver");
    expect(section).toHaveTextContent("Preferred Equity");
    expect(section).toHaveTextContent("Maturity changed from 2099-12-31 to 2101-12-31.");
    expect(section).toHaveTextContent("Maturity changed from 2099-12-31 to 2102-12-31.");
    expect(section).not.toHaveTextContent("Preferred Stock");
    expect(section).not.toHaveTextContent(/credit improved|new money|repayment|refinanced|default/i);
  });

  it("keeps each observation evidence id with its own instrument and accession", () => {
    const principal = quietComparison({
      position_id: "00000000-0000-4000-8000-0000000000e1",
      earlier_position_observation_id: "9100000501",
      later_position_observation_id: "9100000502",
      earlier_observation_evidence_id: "9199307",
      later_observation_evidence_id: "9199308",
      principal_delta: "7",
      maturity_changed: false,
    });
    const maturity = quietComparison({
      position_id: "00000000-0000-4000-8000-0000000000e2",
      earlier_position_observation_id: "9100000601",
      later_position_observation_id: "9100000602",
      earlier_observation_evidence_id: "9200998",
      later_observation_evidence_id: "9200999",
      principal_delta: "0",
      maturity_changed: true,
      earlier_maturity_raw: "2099-02-01",
      later_maturity_raw: "2100-02-01",
      earlier_maturity_precision: "DAY",
      later_maturity_precision: "DAY",
    });
    const missing = quietComparison({
      position_id: "00000000-0000-4000-8000-0000000000e3",
      earlier_position_observation_id: "9100000701",
      later_position_observation_id: "9100000702",
      earlier_observation_evidence_id: null,
      later_observation_evidence_id: "   ",
      principal_delta: "-3",
      maturity_changed: false,
    });
    const comparisons = positionComparisons([principal, maturity, missing], listings, ID);
    expect(comparisons.map((item) => [item.earlier.evidenceId, item.later.evidenceId])).toEqual([
      ["9199307", "9199308"],
      ["9200998", "9200999"],
      ["Unknown", "Unknown"],
    ]);
    const items = whatChanged(comparisons, [], "TEST BORROWER A");
    const principalItem = items.find((item) => item.signal === "principal-increased");
    const maturityItem = items.find((item) => item.signal === "maturity-changed");
    const missingItem = items.find((item) => item.signal === "principal-decreased");
    expect(principalItem).toMatchObject({
      earlierEvidenceId: "9199307",
      laterEvidenceId: "9199308",
      positionId: principal.position_id,
      earlierAccession: "0000000000-99-000001",
      laterAccession: "0000000000-99-000002",
    });
    expect(maturityItem).toMatchObject({
      earlierEvidenceId: "9200998",
      laterEvidenceId: "9200999",
      positionId: maturity.position_id,
    });
    expect(missingItem).toMatchObject({ earlierEvidenceId: "Unknown", laterEvidenceId: "Unknown" });
    expect(principalItem?.earlierEvidenceId).not.toBe(maturityItem?.earlierEvidenceId);
    expect(maturityItem?.earlierEvidenceId).not.toBe(missingItem?.earlierEvidenceId);

    const detail = borrowerDetail([row()], ID);
    render(<BorrowerIntelligence borrower={detail!} comparisons={comparisons} />);
    const section = screen.getByRole("heading", { name: "What Changed" }).closest("section");
    expect(section).toHaveTextContent("Earlier observation evidence");
    expect(section).toHaveTextContent("Later observation evidence");
    expect(section).toHaveTextContent("9199307");
    expect(section).toHaveTextContent("9199308");
    expect(section).toHaveTextContent("9200998");
    expect(section).toHaveTextContent("9200999");
    expect(section).toHaveTextContent("Unknown");
    expect(section).toHaveTextContent(WHAT_CHANGED_NOTE);
    const earlierLink = withinSectionLink(section, "0000000000-99-000001");
    expect(earlierLink).toHaveAttribute("href", listings[0].document_url);
    const laterLink = withinSectionLink(section, "0000000000-99-000002");
    expect(laterLink).toHaveAttribute("href", listings[1].document_url);

    const page = readFileSync(join(process.cwd(), "src/app/borrowers/[id]/page.tsx"), "utf8");
    const loader = readFileSync(join(process.cwd(), "src/server/load-borrowers.ts"), "utf8");
    expect(page.match(/loadBorrowerComparisonsAndRefinancing/g)).toHaveLength(2);
    expect(page).not.toMatch(/loadBorrowerPositionComparisons/);
    expect(page).not.toMatch(/loadBorrowerRefinancingOutcomes/);
    expect(loader).toMatch(/registry\.borrower_position_comparisons/);
    expect(loader).toMatch(/registry\.borrower_refinancing_outcomes/);
    expect(loader).not.toMatch(/borrower_comparisons_and_refinancing/);
    expect(loader).not.toMatch(/tsv_cell|TSV_CELL/);
  });
});

describe("borrower detail listing scope", () => {
  it("loads only the requested legal entity and does not request the full listing universe", () => {
    const page = readFileSync(join(process.cwd(), "src/app/borrowers/[id]/page.tsx"), "utf8");
    const loader = readFileSync(join(process.cwd(), "src/server/load-borrowers.ts"), "utf8");
    const listPage = readFileSync(join(process.cwd(), "src/app/borrowers/page.tsx"), "utf8");
    const sourcesPage = readFileSync(join(process.cwd(), "src/app/borrowers/[id]/sources/page.tsx"), "utf8");

    expect(page).toMatch(/loadBorrowerObservationsForEntity\s*\(\s*id\s*\)/);
    expect(page).not.toMatch(/loadBorrowerObservations\s*\(/);
    expect(page).not.toMatch(/loadBorrowerObservations\s*,/);

    expect(loader).toMatch(/export async function loadBorrowerObservationsForEntity/);
    expect(loader).toMatch(/WHERE legal_entity_id = '\$\{legalEntityId\}'/);
    expect(loader).toMatch(/FROM registry\.borrower_observation_listing/);

    // Directory and sources keep the full listing until those pages are optimized separately.
    expect(listPage).toMatch(/loadBorrowerObservations\s*\(/);
    expect(listPage).not.toMatch(/loadBorrowerObservationsForEntity/);
    expect(sourcesPage).toMatch(/loadBorrowerObservations\s*\(/);
    expect(sourcesPage).not.toMatch(/loadBorrowerObservationsForEntity/);
  });
});

function valuationRow(overrides: Partial<ValuationRow> = {}): ValuationRow {
  return {
    legal_entity_id: ID,
    position_observation_id: "9200000002",
    position_id: "00000000-0000-4000-8000-0000000000ee",
    instrument_id: "00000000-0000-4000-8000-0000000000ef",
    borrower_name_raw: "TEST BORROWER A",
    reported_date: "2099-06-30",
    accession_number: "0000000000-99-000001",
    registrant_cik: "0000000001",
    registrant_link_status: "LINKED",
    entity_resolution_state: "MATCHED",
    instrument_resolution_state: "MATCHED",
    continuity_state: "MATCHED",
    instrument_type_state: "REPORTED",
    instrument_type_raw: "TEST FIRST LIEN",
    instrument_type_evidence_level: "L1_STRUCTURED_DATASET",
    fair_value_state: "REPORTED",
    fair_value_raw: "60",
    fair_value_numeric: "60",
    fair_value_currency_state: "UNKNOWN",
    fair_value_currency_code: null,
    principal_state: "UNKNOWN",
    principal_raw: null,
    principal_numeric: null,
    principal_currency_state: null,
    principal_currency_code: null,
    cost_state: "UNKNOWN",
    cost_raw: null,
    cost_numeric: null,
    cost_currency_state: null,
    cost_currency_code: null,
    observation_evidence_id: "701",
    observation_evidence_level: "L1_STRUCTURED_DATASET",
    earlier_reported_date: "2099-03-31",
    fair_value_change_state: "COMPARABLE",
    fair_value_delta: "STORED-DELTA",
    fair_value_percentage_state: "COMPARABLE",
    fair_value_percentage: "STORED-PERCENT",
    fair_value_to_principal_state: "INSUFFICIENT_DATA",
    fair_value_to_principal: null,
    fair_value_to_cost_state: "INSUFFICIENT_DATA",
    fair_value_to_cost: null,
    cross_bdc_comparison_state: "UNAVAILABLE",
    valuation_definition: "valuation.position_history.v1",
    ...overrides,
  };
}

describe("historical valuation", () => {
  const listings = [
    row({
      accession_number: "0000000000-99-000001",
      document_url: `${EDGAR_DOCUMENT_PREFIX}0000000000/000000000099000001/test-filing.htm`,
    }),
  ];

  it("keeps the stored fair-value change and omits an unresolved instrument", () => {
    const history = valuationHistory([
      valuationRow(),
      valuationRow({
        position_observation_id: "9200000001",
        reported_date: "2099-03-31",
        earlier_reported_date: null,
        fair_value_raw: "70",
        fair_value_numeric: "70",
        principal_state: "REPORTED",
        principal_raw: "100",
        principal_numeric: "100",
        fair_value_change_state: "INSUFFICIENT_DATA",
        fair_value_delta: null,
        fair_value_percentage_state: "INSUFFICIENT_DATA",
        fair_value_percentage: null,
        fair_value_to_principal_state: "COMPARABLE",
        fair_value_to_principal: "STORED-QUOTIENT",
        fair_value_to_cost_state: "INSUFFICIENT_DATA",
        fair_value_to_cost: "999",
      }),
      valuationRow({
        position_observation_id: "9200000009",
        reported_date: "2099-09-30",
        instrument_resolution_state: "UNRESOLVED",
        continuity_state: "UNRESOLVED",
        fair_value_raw: "90",
        fair_value_delta: "SHOULD-NOT-SHOW",
        fair_value_percentage: "SHOULD-NOT-SHOW",
        fair_value_to_principal_state: "COMPARABLE",
        fair_value_to_principal: "SHOULD-NOT-SHOW",
      }),
    ], listings, ID);
    expect(history.timeline.map((point) => point.reportedDate)).toEqual(["2099-06-30", "2099-03-31"]);
    expect(history.timeline.map((point) => point.fairValueChange)).toEqual(["STORED-DELTA", "Insufficient data"]);
    expect(history.timeline.map((point) => point.principal)).toEqual(["Unknown", "100"]);
    expect(history.derived.map((metric) => metric.text)).toEqual([
      "2099-03-31 to 2099-06-30: Fair value change STORED-DELTA.",
      "2099-03-31 to 2099-06-30: Fair value percentage change STORED-PERCENT.",
      "2099-03-31: Fair value / principal STORED-QUOTIENT.",
    ]);
    expect(history.omittedUnresolved).toBe(true);
    expect(history.crossBdc).toBe("Unavailable");
    expect(JSON.stringify(history.timeline)).not.toMatch(/SHOULD-NOT-SHOW/);
    expect(history.timeline.some((point) => point.fairValue === "90")).toBe(false);
    const detail = borrowerDetail(listings, ID);
    render(<BorrowerIntelligence borrower={detail!} valuation={history} />);
    const section = screen.getByRole("heading", { name: "Valuation & Pricing" }).closest("section");
    expect(section).toHaveTextContent("2099-06-30");
    expect(section).toHaveTextContent("2099-03-31");
    expect(section).toHaveTextContent("TEST FIRST LIEN");
    expect(section).toHaveTextContent("TEST BDC ONE");
    expect(section).toHaveTextContent("STORED-DELTA");
    expect(section).toHaveTextContent("STORED-PERCENT");
    expect(section).toHaveTextContent("STORED-QUOTIENT");
    expect(section).toHaveTextContent("Unknown");
    expect(section).toHaveTextContent("Insufficient data");
    expect(section).toHaveTextContent(OMITTED_UNRESOLVED);
    expect(section).toHaveTextContent(CROSS_BDC_UNAVAILABLE);
    expect(section).toHaveTextContent("Structured SEC data set");
    expect(section).not.toHaveTextContent("SHOULD-NOT-SHOW");
    expect(section).not.toHaveTextContent("999");
    expect(section).not.toHaveTextContent(/score|rank|origination|exit/i);
    const source = withinSectionLink(section, "0000000000-99-000001");
    expect(source).toHaveAttribute("href", listings[0].document_url);
  });

  it("says derived metrics are unavailable when no stored inputs support them", () => {
    const history = valuationHistory([
      valuationRow({
        fair_value_change_state: "INSUFFICIENT_DATA",
        fair_value_delta: null,
        fair_value_percentage_state: "INSUFFICIENT_DATA",
        fair_value_percentage: "SHOULD-NOT-SHOW",
      }),
    ], listings, ID);
    expect(history.derived).toEqual([]);
    const detail = borrowerDetail(listings, ID);
    render(<BorrowerIntelligence borrower={detail!} valuation={history} />);
    const section = screen.getByRole("heading", { name: "Valuation & Pricing" }).closest("section");
    expect(section).toHaveTextContent(EMPTY_DERIVED);
    expect(section).toHaveTextContent("Insufficient data");
    expect(section).not.toHaveTextContent("SHOULD-NOT-SHOW");
  });

  it("keeps an empty valuation history explicit", () => {
    const detail = borrowerDetail([row()], ID);
    render(<BorrowerIntelligence borrower={detail!} />);
    const section = screen.getByRole("heading", { name: "Valuation & Pricing" }).closest("section");
    expect(section).toHaveTextContent(EMPTY_VALUATION);
    expect(section).toHaveTextContent(CROSS_BDC_UNAVAILABLE);
    expect(section).not.toHaveTextContent("could not be read");
  });
});

function maturityObservation(overrides: Partial<MaturityObservationRow> = {}): MaturityObservationRow {
  return {
    legal_entity_id: ID,
    position_observation_id: "9300000001",
    position_id: "00000000-0000-4000-8000-0000000000f1",
    instrument_id: "00000000-0000-4000-8000-0000000000f2",
    borrower_name_raw: "TEST BORROWER A",
    reported_date: "2099-03-31",
    accession_number: "0000000000-99-000001",
    registrant_cik: "0000000001",
    registrant_link_status: "LINKED",
    entity_resolution_state: "MATCHED",
    instrument_resolution_state: "MATCHED",
    continuity_state: "MATCHED",
    instrument_type_state: "REPORTED",
    instrument_type_raw: "TEST FIRST LIEN",
    maturity_source: "REPORTED_STRUCTURED",
    maturity_raw: "STORED-DAY",
    maturity_date: "2099-06-15",
    maturity_precision: null,
    maturity_year: null,
    maturity_month: null,
    maturity_precision_class: "DAY",
    maturity_bucket_year: "2099",
    maturity_observation_state: "OBSERVED",
    maturity_evidence_id: "801",
    maturity_filing_verified: false,
    maturity_document_url: null,
    observation_evidence_level: "L1_STRUCTURED_DATASET",
    principal_state: "REPORTED",
    principal_raw: "100",
    principal_numeric: "100",
    principal_currency_state: "UNKNOWN",
    principal_currency_code: null,
    fair_value_state: "UNKNOWN",
    fair_value_raw: null,
    fair_value_numeric: null,
    fair_value_currency_state: null,
    fair_value_currency_code: null,
    refinancing_outcome_state: "UNKNOWN",
    maturity_definition: "maturity.position_history.v1",
    ...overrides,
  };
}

function maturityYear(overrides: Partial<MaturityYearRow> = {}): MaturityYearRow {
  return {
    maturity_year: "2099",
    maturity_precision_class: "DAY",
    observation_count: "2",
    principal_aggregation_state: "INSUFFICIENT_DATA",
    principal_total: null,
    principal_currency_code: null,
    fair_value_aggregation_state: "INSUFFICIENT_DATA",
    fair_value_total: null,
    fair_value_currency_code: null,
    maturity_definition: "maturity.position_history.v1",
    ...overrides,
  };
}

describe("maturity wall", () => {
  const listings = [
    row({
      accession_number: "0000000000-99-000001",
      document_url: `${EDGAR_DOCUMENT_PREFIX}0000000000/000000000099000001/test-filing.htm`,
    }),
  ];

  it("preserves stored maturity order, precision, and an unresolved exclusion", () => {
    const wall = maturityWall([
      maturityObservation(),
      maturityObservation({
        position_observation_id: "9300000002",
        maturity_source: "REPORTED_MONTH",
        maturity_raw: "12/2099",
        maturity_date: null,
        maturity_precision: "MONTH",
        maturity_year: "2099",
        maturity_month: "12",
        maturity_precision_class: "MONTH",
        principal_state: "UNKNOWN",
        principal_raw: null,
        principal_numeric: null,
      }),
      maturityObservation({
        position_observation_id: "9300000003",
        maturity_source: "UNKNOWN",
        maturity_raw: null,
        maturity_date: null,
        maturity_precision_class: "NONE",
        maturity_bucket_year: null,
        maturity_observation_state: "UNKNOWN",
        principal_state: "UNKNOWN",
        principal_raw: null,
      }),
      maturityObservation({
        position_observation_id: "9300000009",
        instrument_resolution_state: "UNRESOLVED",
        continuity_state: "UNRESOLVED",
        maturity_raw: "SHOULD-NOT-SHOW",
        principal_raw: "999",
      }),
    ], listings, ID);
    expect(wall.points.map((point) => point.maturity)).toEqual(["STORED-DAY", "12/2099", "Unknown"]);
    expect(wall.points.map((point) => point.precision)).toEqual(["Calendar day", "Month", "Unknown"]);
    expect(wall.points.map((point) => point.principal)).toEqual(["100", "Unknown", "Unknown"]);
    expect(wall.points[0].fairValue).toBe("Unknown");
    expect(wall.points[0].principalCurrency).toBe("Currency Unknown");
    expect(wall.omittedUnresolved).toBe(true);
    expect(JSON.stringify(wall.points)).not.toMatch(/SHOULD-NOT-SHOW|999/);
    const years = maturityYears([
      maturityYear({ principal_aggregation_state: "COMPARABLE", principal_total: "STORED-TOTAL", principal_currency_code: "AAA" }),
    ]);
    expect(years[0].principal).toBe("STORED-TOTAL AAA");
    expect(years[0].fairValue).toBe("Insufficient data");
    const changes = maturityChangeLines(positionComparisons([comparison()], listings, ID));
    expect(changes.map((line) => line.text)).toEqual(["Maturity changed from 12/2099 to 06/2100."]);
    expect(changes.map((line) => line.text).join(" ")).not.toMatch(/refinanc|origination|score/i);
    const detail = borrowerDetail(listings, ID);
    render(<BorrowerIntelligence borrower={detail!} maturity={{
      wall,
      summary: {
        resolved_observation_count: "3",
        known_maturity_count: "2",
        unknown_maturity_count: "1",
        unresolved_count: "1",
        earliest_calendar_maturity: "STORED-DAY",
        earliest_month_maturity: "12/2099",
        refinancing_outcome_state: "UNKNOWN",
        maturity_definition: "maturity.position_history.v1",
      },
      years,
      changes,
    }} />);
    const section = screen.getByRole("heading", { name: "Maturity Wall" }).closest("section");
    expect(section).toHaveTextContent("STORED-DAY");
    expect(section).toHaveTextContent("12/2099");
    expect(section).toHaveTextContent("Calendar day");
    expect(section).toHaveTextContent("Month");
    expect(section).toHaveTextContent("Currency Unknown");
    expect(section).toHaveTextContent("STORED-TOTAL AAA");
    expect(section).toHaveTextContent("Insufficient data");
    expect(section).toHaveTextContent("Maturity changed from 12/2099 to 06/2100.");
    expect(section).toHaveTextContent(MATURITY_CHANGE_NOTE);
    expect(section).toHaveTextContent(REFINANCING_OUTCOME_NOTE);
    expect(section).toHaveTextContent("2 stored");
    expect(section).not.toHaveTextContent("2099-06-15");
    expect(section).not.toHaveTextContent("SHOULD-NOT-SHOW");
    expect(section).not.toHaveTextContent(/score|origination date is/i);
    const source = withinSectionLink(section, "0000000000-99-000001");
    expect(source).toHaveAttribute("href", listings[0].document_url);
  });

  it("keeps an empty maturity wall explicit", () => {
    const detail = borrowerDetail([row()], ID);
    render(<BorrowerIntelligence borrower={detail!} />);
    const section = screen.getByRole("heading", { name: "Maturity Wall" }).closest("section");
    expect(section).toHaveTextContent(EMPTY_MATURITY);
    expect(section).toHaveTextContent(EMPTY_MATURITY_CHANGE);
    expect(section).toHaveTextContent(REFINANCING_OUTCOME_NOTE);
    expect(section).not.toHaveTextContent("could not be read");
  });
});

function outcomeRow(overrides: Partial<RefinancingOutcomeRow> = {}): RefinancingOutcomeRow {
  return {
    legal_entity_id: ID,
    position_id: "00000000-0000-4000-8000-0000000000e1",
    instrument_id: "00000000-0000-4000-8000-0000000000e2",
    instrument_resolution_state: "MATCHED",
    continuity_state: "MATCHED",
    instrument_type_state: "REPORTED",
    instrument_type_raw: "TEST FIRST LIEN",
    earlier_position_observation_id: "9300000011",
    later_position_observation_id: "9300000012",
    earlier_reported_date: "2099-03-31",
    later_reported_date: "2099-09-30",
    event_date: null,
    event_type: "MATURITY_CHANGED",
    refinancing_outcome_state: "UNKNOWN",
    earlier_maturity_raw: "STORED-EARLIER",
    later_maturity_raw: "STORED-LATER",
    earlier_maturity_precision: "MONTH",
    later_maturity_precision: "MONTH",
    earlier_principal_state: "UNKNOWN",
    earlier_principal_raw: null,
    earlier_principal_currency_state: null,
    earlier_principal_currency_code: null,
    later_principal_state: "REPORTED",
    later_principal_raw: "STORED-PRINCIPAL",
    later_principal_currency_state: "UNKNOWN",
    later_principal_currency_code: null,
    earlier_accession_number: "0000000000-99-000001",
    later_accession_number: "0000000000-99-000002",
    earlier_observation_evidence_id: "901",
    later_observation_evidence_id: "902",
    earlier_observation_evidence_level: "L1_STRUCTURED_DATASET",
    later_observation_evidence_level: "L2_ORIGINAL_FILING",
    registrant_cik: "0000000001",
    registrant_link_status: "LINKED",
    outcome_definition: "refinancing.outcome_history.v1",
    ...overrides,
  };
}

describe("refinancing intelligence", () => {
  const listings = [
    row({
      accession_number: "0000000000-99-000001",
      document_url: `${EDGAR_DOCUMENT_PREFIX}0000000000/000000000099000001/test-filing.htm`,
    }),
    row({
      accession_number: "0000000000-99-000002",
      document_url: `${EDGAR_DOCUMENT_PREFIX}0000000000/000000000099000002/test-filing.htm`,
    }),
  ];

  it("shows a stored maturity change with Unknown refinancing outcome", () => {
    const outcomes = refinancingOutcomes([outcomeRow()], listings, ID);
    expect(outcomes.map((item) => item.statement)).toEqual(["Maturity changed from STORED-EARLIER to STORED-LATER."]);
    expect(outcomes[0].outcomeState).toBe("Unknown");
    expect(outcomes[0].transactionDate).toBe("Unknown");
    expect(outcomes[0].reportDates).toBe("2099-03-31 to 2099-09-30");
    expect(outcomes[0].earlierPrincipal).toBe("Unknown");
    expect(outcomes[0].laterPrincipal).toBe("STORED-PRINCIPAL");
    expect(outcomes[0].laterPrincipalCurrency).toBe("Currency Unknown");
    expect(outcomes.map((item) => item.statement).join(" ")).not.toMatch(/Refinancing is stored|probability|score/i);
    const detail = borrowerDetail(listings, ID);
    render(<BorrowerIntelligence borrower={detail!} refinancing={outcomes} />);
    const section = screen.getByRole("heading", { name: "Refinancing Intelligence" }).closest("section");
    expect(section).toHaveTextContent("Maturity changed from STORED-EARLIER to STORED-LATER.");
    expect(section).toHaveTextContent(MATURITY_CHANGED_NOTE);
    expect(section).toHaveTextContent(OUTCOME_STATE_NOTE);
    expect(section).toHaveTextContent("Refinancing outcome");
    expect(section).toHaveTextContent("Unknown");
    expect(section).toHaveTextContent("Transaction date");
    expect(section).toHaveTextContent("Report dates");
    expect(section).toHaveTextContent("2099-03-31 to 2099-09-30");
    expect(section).toHaveTextContent("STORED-PRINCIPAL");
    expect(section).toHaveTextContent("Currency Unknown");
    expect(section).not.toHaveTextContent(/^0$/);
    const source = withinSectionLink(section, "0000000000-99-000002");
    expect(source).toHaveAttribute("href", listings[1].document_url);
  });

  it("does not invent event types the read model does not emit", () => {
    const outcomes = refinancingOutcomes([
      outcomeRow({ event_type: "REFINANCING_EXPLICIT", later_position_observation_id: "9300000021" }),
      outcomeRow({ event_type: "REPAYMENT_EXPLICIT", later_position_observation_id: "9300000022" }),
      outcomeRow({ event_type: "POSITION_EXITED", later_position_observation_id: "9300000023" }),
      outcomeRow(),
    ], listings, ID);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].statement).toBe("Maturity changed from STORED-EARLIER to STORED-LATER.");
    expect(outcomes[0].outcomeState).toBe("Unknown");
  });

  it("keeps an empty refinancing section explicit", () => {
    const detail = borrowerDetail([row()], ID);
    render(<BorrowerIntelligence borrower={detail!} />);
    const section = screen.getByRole("heading", { name: "Refinancing Intelligence" }).closest("section");
    expect(section).toHaveTextContent(EMPTY_REFINANCING);
    expect(section).toHaveTextContent(OUTCOME_STATE_NOTE);
    expect(section).not.toHaveTextContent("could not be read");
  });
});

function withinSectionLink(section: Element | null, name: string): HTMLElement {
  const link = [...(section?.querySelectorAll("a") ?? [])].find((item) => item.textContent === name);
  if (!link) throw new Error(`missing link ${name}`);
  return link as HTMLElement;
}

describe("navigation", () => {
  it("offers Borrowers, Portfolios, Maturity, Coverage, and Account, and keeps the borrower heading", () => {
    render(<AppShell signedIn isAdmin={false}><p>Body</p></AppShell>);
    expect(screen.getByRole("link", { name: "Borrowers" })).toHaveAttribute("href", "/borrowers");
    expect(screen.getByRole("link", { name: "Borrowers" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Portfolios" })).toHaveAttribute("href", "/portfolios");
    expect(screen.getByRole("link", { name: "Maturity" })).toHaveAttribute("href", "/maturity");
    expect(screen.getByRole("link", { name: "Coverage" })).toHaveAttribute("href", "/market");
    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute("href", "/account");
    expect(screen.queryByRole("link", { name: "Review" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
    expect(screen.getByText("Find Borrowers")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /refinancing|screener/i })).not.toBeInTheDocument();
  });
});
