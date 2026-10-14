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
  ADMIN_FILING_INVENTORY_DEFAULT_LIMIT,
  ADMIN_FILING_INVENTORY_MAX_LIMIT,
} from "@/lib/admin-filings";
import {
  loadAdminDashboard,
  loadAdminFilingDetail,
  loadAdminFilingInventory,
} from "@/server/load-admin-filings";

const LIST_ROW = {
  filing_id: 1,
  accession_number: "0000000000-99-000001",
  filing_recorded_at: "2099-01-01T00:00:00Z",
  registrant_name_state: "UNKNOWN",
  registrant_name_raw: null,
  forms: null,
  filed_dates: ["2099-05-01"],
  report_periods: null,
  document_count: 0,
  artifact_count: 0,
  processing_outcomes: null,
  soi_row_observation_count: 0,
  position_observation_count: 0,
  num_fact_observation_count: 0,
};

const INVENTORY_ROW = {
  ...LIST_ROW,
  filing_run_id: 9,
  registrant_link_status: "LINKED",
  registrant_ids: [2],
  registrant_ciks: [9999999901],
  form_raw_values: null,
  filed_date_raw_values: ["20990501"],
  report_period_raw_values: null,
  documents_available: false,
  artifacts_available: false,
  processing_row_count: 0,
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

  it("loads a bounded inventory page with LIMIT/OFFSET and preserves null processing outcomes", async () => {
    mocks.requireAdmin.mockResolvedValue({ isAdmin: true });
    mocks.executeSql.mockResolvedValue({
      ok: true,
      text: JSON.stringify({ total: 1, rows: [LIST_ROW] }),
    });
    const { rows, total, error } = await loadAdminFilingInventory("", 50, 0);
    expect(error).toBeNull();
    expect(total).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.processing_outcomes).toBeNull();
    expect(rows[0]?.registrant_name_state).toBe("UNKNOWN");
    const sql = String(mocks.executeSql.mock.calls[0]?.[0] ?? "");
    expect(sql).toMatch(/SET ROLE admin_reader/);
    expect(sql).toMatch(/SET statement_timeout = '30s'/);
    expect(sql).toMatch(/admin\.filing_inventory/);
    expect(sql).toMatch(/LIMIT 50 OFFSET 0/);
    expect(sql).toMatch(/ORDER BY \(SELECT max\(d\) FROM unnest\(filed_dates\) AS d\) DESC NULLS LAST/);
    expect(sql).not.toMatch(/form_raw_values|registrant_ciks|documents_available/);
    expect(sql).toMatch(/SELECT count\(\*\)::integer/);
  });

  it("clamps page size to the server maximum and rejects invalid offsets", async () => {
    mocks.requireAdmin.mockResolvedValue({ isAdmin: true });
    mocks.executeSql.mockResolvedValue({
      ok: true,
      text: JSON.stringify({ total: 0, rows: [] }),
    });
    await loadAdminFilingInventory("", ADMIN_FILING_INVENTORY_MAX_LIMIT + 50, 100);
    const sql = String(mocks.executeSql.mock.calls[0]?.[0] ?? "");
    expect(sql).toMatch(new RegExp(`LIMIT ${ADMIN_FILING_INVENTORY_MAX_LIMIT} OFFSET 100`));
    expect(sql).not.toMatch(new RegExp(`LIMIT ${ADMIN_FILING_INVENTORY_MAX_LIMIT + 50}`));

    mocks.executeSql.mockClear();
    const invalid = await loadAdminFilingInventory("", ADMIN_FILING_INVENTORY_DEFAULT_LIMIT, -1);
    expect(invalid).toEqual({ rows: [], total: null, error: null });
    expect(mocks.executeSql).not.toHaveBeenCalled();
  });

  it("preserves accession/registrant/form/CIK search filters on paged queries", async () => {
    mocks.requireAdmin.mockResolvedValue({ isAdmin: true });
    mocks.executeSql.mockResolvedValue({
      ok: true,
      text: JSON.stringify({ total: 0, rows: [] }),
    });
    await loadAdminFilingInventory("ARCC", 50, 50);
    const sql = String(mocks.executeSql.mock.calls[0]?.[0] ?? "");
    expect(sql).toMatch(/accession_number ILIKE '%ARCC%'/);
    expect(sql).toMatch(/registrant_name_raw/);
    expect(sql).toMatch(/registrant_name_state ILIKE '%ARCC%'/);
    expect(sql).toMatch(/unnest\(coalesce\(forms/);
    expect(sql).toMatch(/unnest\(coalesce\(form_raw_values/);
    expect(sql).toMatch(/unnest\(coalesce\(registrant_ciks/);
    expect(sql).toMatch(/LIMIT 50 OFFSET 50/);
  });

  it("returns empty inventory rows without inventing filings", async () => {
    mocks.requireAdmin.mockResolvedValue({ isAdmin: true });
    mocks.executeSql.mockResolvedValue({
      ok: true,
      text: JSON.stringify({ total: 0, rows: [] }),
    });
    const { rows, total, error } = await loadAdminFilingInventory();
    expect(error).toBeNull();
    expect(total).toBe(0);
    expect(rows).toEqual([]);
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
