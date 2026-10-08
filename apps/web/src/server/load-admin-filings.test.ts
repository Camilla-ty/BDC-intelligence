// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class NotFoundSignal extends Error {
    constructor() {
      super("NEXT_HTTP_ERROR_FALLBACK;404");
    }
  }
  class RedirectSignal extends Error {
    constructor(readonly path: string) {
      super(`redirect ${path}`);
    }
  }
  return {
    NotFoundSignal,
    RedirectSignal,
    requireAdmin: vi.fn(),
    executeSql: vi.fn(),
    notFound: vi.fn(() => {
      throw new NotFoundSignal();
    }),
    redirect: vi.fn((path: string) => {
      throw new RedirectSignal(path);
    }),
  };
});

vi.mock("next/navigation", () => ({ notFound: mocks.notFound, redirect: mocks.redirect }));
vi.mock("@/server/auth/access", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/server/sql-text", () => ({ executeSql: mocks.executeSql }));

import {
  loadAdminDashboard,
  loadAdminFilingDetail,
  loadAdminFilingInventory,
} from "@/server/load-admin-filings";

const INVENTORY_ROW = {
  filing_id: 1,
  accession_number: "0000000000-99-000001",
  filing_run_id: 9,
  filing_recorded_at: "2099-01-01T00:00:00Z",
  registrant_link_status: "LINKED",
  registrant_ids: [2],
  registrant_ciks: [9999999901],
  registrant_name_state: "UNKNOWN",
  registrant_name_raw: null,
  forms: null,
  form_raw_values: null,
  filed_dates: ["2099-05-01"],
  filed_date_raw_values: ["20990501"],
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

afterEach(() => {
  vi.clearAllMocks();
});

describe("admin filing loaders", () => {
  it("requires ADMIN before every admin read", async () => {
    mocks.requireAdmin.mockRejectedValue(new mocks.NotFoundSignal());
    await expect(loadAdminDashboard()).rejects.toBeInstanceOf(mocks.NotFoundSignal);
    await expect(loadAdminFilingInventory()).rejects.toBeInstanceOf(mocks.NotFoundSignal);
    await expect(loadAdminFilingDetail("1")).rejects.toBeInstanceOf(mocks.NotFoundSignal);
    expect(mocks.executeSql).not.toHaveBeenCalled();
  });

  it("reads only admin.* views under admin_reader", async () => {
    mocks.requireAdmin.mockResolvedValue({ isAdmin: true });
    mocks.executeSql.mockResolvedValue({
      ok: true,
      text: JSON.stringify({
        total_filings: 1,
        filings_with_documents: 0,
        filings_with_artifacts: 0,
        filings_with_processing: 0,
        filings_with_observations: 0,
        recent: [INVENTORY_ROW],
      }),
    });
    await loadAdminDashboard();
    const sql = String(mocks.executeSql.mock.calls[0]?.[0] ?? "");
    expect(sql).toMatch(/SET ROLE admin_reader/);
    expect(sql).toMatch(/admin\.filing_inventory/);
    expect(sql).not.toMatch(/\bFROM\s+(raw|registry|ops|obs)\./i);
    expect(sql).not.toMatch(/grant_event|bdc_reader/i);
  });

  it("loads inventory ordered deterministically and preserves null processing outcomes", async () => {
    mocks.requireAdmin.mockResolvedValue({ isAdmin: true });
    mocks.executeSql.mockResolvedValue({ ok: true, text: JSON.stringify([INVENTORY_ROW]) });
    const { rows, error } = await loadAdminFilingInventory();
    expect(error).toBeNull();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.processing_outcomes).toBeNull();
    expect(rows[0]?.registrant_name_state).toBe("UNKNOWN");
    const sql = String(mocks.executeSql.mock.calls[0]?.[0] ?? "");
    expect(sql).toMatch(/admin\.filing_inventory/);
    expect(sql).toMatch(/ORDER BY \(SELECT max\(d\) FROM unnest\(filed_dates\) AS d\) DESC NULLS LAST/);
    expect(sql).toMatch(/accession_number DESC/);
    expect(sql).toMatch(/filing_id DESC/);
  });

  it("loads filing detail from admin child views and reports missing filings", async () => {
    mocks.requireAdmin.mockResolvedValue({ isAdmin: true });
    mocks.executeSql.mockResolvedValue({
      ok: true,
      text: JSON.stringify({
        inventory: INVENTORY_ROW,
        registrants: [],
        attributes: [],
        documents: [],
        artifacts: [],
        processing: [],
      }),
    });
    const found = await loadAdminFilingDetail("0000000000-99-000001");
    expect(found.notFound).toBe(false);
    expect(found.detail?.inventory.processing_outcomes).toBeNull();
    const sql = String(mocks.executeSql.mock.calls[0]?.[0] ?? "");
    expect(sql).toMatch(/admin\.filing_registrant/);
    expect(sql).toMatch(/admin\.filing_attribute/);
    expect(sql).toMatch(/admin\.filing_document/);
    expect(sql).toMatch(/admin\.filing_artifact/);
    expect(sql).toMatch(/admin\.filing_processing/);
    expect(sql).toMatch(/accession_number = '0000000000-99-000001'/);

    mocks.executeSql.mockResolvedValue({
      ok: true,
      text: JSON.stringify({
        inventory: null,
        registrants: [],
        attributes: [],
        documents: [],
        artifacts: [],
        processing: [],
      }),
    });
    const missing = await loadAdminFilingDetail("999");
    expect(missing.notFound).toBe(true);
    expect(missing.detail).toBeNull();
  });
});
