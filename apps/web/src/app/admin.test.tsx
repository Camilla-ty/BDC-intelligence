import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminDashboard } from "@/components/AdminDashboard";
import { AdminFilingDetailView } from "@/components/AdminFilingDetail";
import { AdminFilingInventory } from "@/components/AdminFilingInventory";
import type { AdminFilingDetail, AdminFilingInventoryRow } from "@/lib/admin-filings";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin",
  notFound: () => {
    throw new Error("notFound");
  },
}));

const EMPTY_INVENTORY: AdminFilingInventoryRow = {
  filing_id: 1,
  accession_number: "0000000000-99-000001",
  filing_run_id: 9,
  filing_recorded_at: "2099-01-01T00:00:00Z",
  registrant_link_status: "UNKNOWN",
  registrant_ids: null,
  registrant_ciks: null,
  registrant_name_state: "UNKNOWN",
  registrant_name_raw: null,
  forms: null,
  form_raw_values: null,
  filed_dates: null,
  filed_date_raw_values: null,
  report_periods: null,
  report_period_raw_values: null,
  document_count: 0,
  artifact_count: 0,
  documents_available: false,
  artifacts_available: false,
  processing_outcomes: null,
  processing_row_count: 0,
  soi_row_observation_count: 0,
  position_observation_count: 0,
  num_fact_observation_count: 0,
};

const PROCESSED: AdminFilingInventoryRow = {
  ...EMPTY_INVENTORY,
  filing_id: 2,
  accession_number: "0000000000-99-000002",
  registrant_link_status: "LINKED",
  registrant_ciks: [1],
  registrant_name_state: "REPORTED",
  registrant_name_raw: "TEST BDC",
  forms: ["10-K"],
  filed_dates: ["2099-05-01"],
  report_periods: ["2099-03-31"],
  document_count: 1,
  artifact_count: 1,
  documents_available: true,
  artifacts_available: true,
  processing_outcomes: ["LOADED", "NOT_IN_SCOPE"],
  processing_row_count: 2,
  soi_row_observation_count: 3,
  position_observation_count: 2,
  num_fact_observation_count: 1,
};

describe("Admin Phase A UI", () => {
  it("shows dashboard counts and recent filings for an admin", () => {
    render(
      <AdminDashboard
        summary={{
          total_filings: 2,
          filings_with_documents: 1,
          filings_with_artifacts: 1,
          filings_with_processing: 1,
          filings_with_observations: 1,
          recent: [PROCESSED, EMPTY_INVENTORY],
        }}
        error={null}
      />,
    );
    expect(screen.getByRole("heading", { name: "Admin" })).toBeTruthy();
    expect(screen.getByText("Filing inventory")).toBeTruthy();
    expect(screen.getByText("Total filings").closest("div")?.textContent).toContain("2");
    expect(screen.getByText("0000000000-99-000002")).toBeTruthy();
    expect(screen.getByText("No linked processing rows")).toBeTruthy();
  });

  it("renders inventory Unknown and MULTIPLE states without inventing processing success", () => {
    const multiple: AdminFilingInventoryRow = {
      ...EMPTY_INVENTORY,
      registrant_name_state: "MULTIPLE_VALUES",
      forms: ["10-K", "10-Q"],
    };
    render(<AdminFilingInventory rows={[multiple]} query="" error={null} />);
    expect(screen.getByRole("heading", { name: "Filing inventory" })).toBeTruthy();
    expect(screen.getAllByText("MULTIPLE_VALUES").length).toBeGreaterThan(0);
    expect(screen.getByText("10-K, 10-Q")).toBeTruthy();
    expect(screen.getByText("No linked processing rows")).toBeTruthy();
    expect(screen.queryByText(/successfully processed|health|quality/i)).toBeNull();
  });

  it("shows filing detail chain with explicit absence for documents, artifacts, and processing", () => {
    const detail: AdminFilingDetail = {
      inventory: EMPTY_INVENTORY,
      registrants: [
        {
          filing_id: 1,
          accession_number: EMPTY_INVENTORY.accession_number,
          registrant_id: null,
          cik: null,
          link_source: null,
          registrant_link_status: "UNKNOWN",
          evidence_id: null,
          name_state: "UNKNOWN",
          name_raw: null,
        },
      ],
      attributes: [],
      documents: [],
      artifacts: [],
      processing: [],
    };
    render(<AdminFilingDetailView detail={detail} />);
    expect(screen.getByRole("heading", { name: "Filing detail" })).toBeTruthy();
    expect(screen.getByText("No named documents linked to this filing.")).toBeTruthy();
    expect(screen.getByText("No linked artifacts for this filing.")).toBeTruthy();
    expect(
      screen.getByText("No linked processing rows. A named document alone is not a processing success."),
    ).toBeTruthy();
    expect(screen.getAllByText("Unknown").length).toBeGreaterThan(0);
  });

  it("shows stored SEC locators and processing outcomes without collapsing disagreement", () => {
    const detail: AdminFilingDetail = {
      inventory: PROCESSED,
      registrants: [],
      attributes: [
        {
          filing_id: 2,
          accession_number: PROCESSED.accession_number,
          observation_id: 10,
          attribute_code: "FORM",
          raw_value: "10-K",
          value_state: "REPORTED",
          normalized_text: "10-K",
          normalized_date: null,
          normalized_timestamp: null,
          source_type_code: "SEC_SUBMISSIONS_JSON",
          source_stream: "submissions",
          evidence_level: "L1_STRUCTURED_DATASET",
          documentation_status: "OBSERVED_UNCONFIRMED",
          evidence_id: 3,
          rule_version_id: 4,
          run_id: 5,
        },
        {
          filing_id: 2,
          accession_number: PROCESSED.accession_number,
          observation_id: 11,
          attribute_code: "FORM",
          raw_value: "10-K/A",
          value_state: "REPORTED",
          normalized_text: "10-K/A",
          normalized_date: null,
          normalized_timestamp: null,
          source_type_code: "SEC_BDC_DATASET_ZIP",
          source_stream: "sub",
          evidence_level: "L1_STRUCTURED_DATASET",
          documentation_status: "OBSERVED_UNCONFIRMED",
          evidence_id: 6,
          rule_version_id: 4,
          run_id: 5,
        },
      ],
      documents: [
        {
          filing_id: 2,
          accession_number: PROCESSED.accession_number,
          filing_document_id: 20,
          document_name: "test.htm",
          document_url: "https://www.sec.gov/Archives/edgar/data/1/0001/test.htm",
          named_by: "FILING_INDEX_JSON",
          rule_version_id: 4,
          run_id: 5,
          evidence_id: 7,
          recorded_at: "2099-01-02T00:00:00Z",
          artifact_linked: true,
        },
      ],
      artifacts: [
        {
          filing_id: 2,
          accession_number: PROCESSED.accession_number,
          filing_document_id: 20,
          document_name: "test.htm",
          document_url: "https://www.sec.gov/Archives/edgar/data/1/0001/test.htm",
          filing_document_artifact_id: 21,
          artifact_id: 30,
          source_url: "https://www.sec.gov/Archives/edgar/data/1/0001/test.htm",
          final_url: "https://www.sec.gov/Archives/edgar/data/1/0001/test.htm",
          source_type_code: "SEC_FILING_DOCUMENT",
          http_status: 200,
          content_type: "text/html",
          last_modified: null,
          etag: null,
          byte_size: 12,
          sha256: "ab".repeat(32),
          retrieved_at: "2099-01-02T00:00:00Z",
          storage_key: "test-only/doc",
          artifact_run_id: 5,
          artifact_recorded_at: "2099-01-02T00:00:00Z",
        },
      ],
      processing: [
        {
          filing_id: 2,
          accession_number: PROCESSED.accession_number,
          artifact_processing_id: 40,
          artifact_id: 30,
          rule_version_id: 4,
          rule_code: "test.parser",
          rule_version: "1",
          rule_kind: "PARSER",
          outcome: "LOADED",
          detail: "TEST ONLY",
          counts: { rows: 1 },
          run_id: 5,
          run_kind: "TEST",
          run_status: "SUCCEEDED",
          run_started_at: "2099-01-02T00:00:00Z",
          run_finished_at: "2099-01-02T00:01:00Z",
          processing_recorded_at: "2099-01-02T00:01:00Z",
        },
        {
          filing_id: 2,
          accession_number: PROCESSED.accession_number,
          artifact_processing_id: 41,
          artifact_id: 30,
          rule_version_id: 8,
          rule_code: "test.project",
          rule_version: "1",
          rule_kind: "NORMALIZATION",
          outcome: "NOT_IN_SCOPE",
          detail: "TEST ONLY second",
          counts: { rows: 0 },
          run_id: 5,
          run_kind: "TEST",
          run_status: "SUCCEEDED",
          run_started_at: "2099-01-02T00:00:00Z",
          run_finished_at: "2099-01-02T00:01:00Z",
          processing_recorded_at: "2099-01-02T00:01:00Z",
        },
      ],
    };
    render(<AdminFilingDetailView detail={detail} />);
    expect(screen.getAllByText("10-K").length).toBeGreaterThan(0);
    expect(screen.getAllByText("10-K/A").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "https://www.sec.gov/Archives/edgar/data/1/0001/test.htm" })).toBeTruthy();
    expect(screen.getAllByText("LOADED").length).toBeGreaterThan(0);
    expect(screen.getAllByText("NOT_IN_SCOPE").length).toBeGreaterThan(0);
    expect(screen.getByText(/test\.parser/)).toBeTruthy();
    expect(screen.getByText(/sha256/)).toBeTruthy();
  });
});
