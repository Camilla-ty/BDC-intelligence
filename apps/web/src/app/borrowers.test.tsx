import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/borrowers",
}));
import {
  ACQUISITION_LABEL as COMPARISON_ACQUISITION_LABEL,
  COMPARISON_NOTE,
  EMPTY_COMPARISONS,
  positionComparisons,
  type PositionComparisonRow,
} from "@/lib/borrower-comparisons";
import { observedActivity, storedDifferences } from "@/lib/borrower-activity";
import { BorrowerIntelligence } from "@/components/BorrowerIntelligence";
import {
  ACQUISITION_LABEL,
  EMPTY_POSITIONS,
  historicalPositions,
  periodBands,
  type PositionObservationRow,
  type ResearchFieldRow,
} from "@/lib/borrower-positions";
import { BorrowerList } from "@/components/BorrowerList";
import { BorrowerSources } from "@/components/BorrowerSources";
import { Shell } from "@/components/Shell";
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
    expect(section).toHaveTextContent("2099-03-31");
    expect(section).toHaveTextContent("2099-06-30");
    expect(section).toHaveTextContent("2099-09-30");
    const principalChanges = [...section!.querySelectorAll("tbody tr")]
      .filter((tr) => tr.querySelector("th")?.textContent === "Principal")
      .map((tr) => tr.children[3]?.textContent);
    const fairValueChanges = [...section!.querySelectorAll("tbody tr")]
      .filter((tr) => tr.querySelector("th")?.textContent === "Fair value")
      .map((tr) => tr.children[3]?.textContent);
    const rateChanges = [...section!.querySelectorAll("tbody tr")]
      .filter((tr) => tr.querySelector("th")?.textContent === "Interest rate")
      .map((tr) => tr.children[3]?.textContent);
    expect(principalChanges).toEqual(["7", "7"]);
    expect(fairValueChanges).toEqual(["-10", "-10"]);
    expect(rateChanges).toEqual(["Insufficient data", "Insufficient data"]);
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

  it("shows the empty state when no confirmed comparison exists", () => {
    const detail = borrowerDetail([row()], ID);
    render(<BorrowerIntelligence borrower={detail!} comparisons={[]} />);
    const section = screen.getByRole("heading", { name: "Confirmed Position Changes" }).closest("section");
    expect(section).toHaveTextContent(EMPTY_COMPARISONS);
    expect(section).toHaveTextContent("MATCHED");
    expect(section).not.toHaveTextContent("could not be read");
    expect(section).not.toHaveTextContent(/no credit|no risk|no repayment|no refinancing/i);
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
});

function withinSectionLink(section: Element | null, name: string): HTMLElement {
  const link = [...(section?.querySelectorAll("a") ?? [])].find((item) => item.textContent === name);
  if (!link) throw new Error(`missing link ${name}`);
  return link as HTMLElement;
}

describe("navigation", () => {
  it("offers Borrowers, Portfolios, Maturity, and Coverage, and keeps the borrower heading", () => {
    render(<Shell><p>Body</p></Shell>);
    expect(screen.getByRole("link", { name: "Borrowers" })).toHaveAttribute("href", "/borrowers");
    expect(screen.getByRole("link", { name: "Borrowers" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Portfolios" })).toHaveAttribute("href", "/portfolios");
    expect(screen.getByRole("link", { name: "Maturity" })).toHaveAttribute("href", "/maturity");
    expect(screen.getByRole("link", { name: "Coverage" })).toHaveAttribute("href", "/market");
    expect(screen.getByText("Find Borrowers")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /refinancing|screener/i })).not.toBeInTheDocument();
  });
});
