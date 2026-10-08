// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class NotFoundSignal extends Error {
    constructor() {
      super("NEXT_HTTP_ERROR_FALLBACK;404");
    }
  }
  return {
    NotFoundSignal,
    requireAdmin: vi.fn(),
  };
});

vi.mock("@/server/auth/access", () => ({ requireAdmin: mocks.requireAdmin }));

import { loadArccSecCoverage } from "@/server/load-arcc-sec-coverage";

function columnar(rows: Array<Record<string, string>>) {
  const keys = [
    "accessionNumber", "filingDate", "reportDate", "acceptanceDateTime", "act", "form",
    "fileNumber", "filmNumber", "items", "core_type", "size", "isXBRL", "isInlineXBRL",
    "isXBRLNumeric", "primaryDocument", "primaryDocDescription",
  ];
  const out: Record<string, unknown[]> = Object.fromEntries(keys.map((k) => [k, []]));
  for (const row of rows) {
    for (const key of keys) {
      if (key === "size" || key.startsWith("is")) out[key].push(0);
      else out[key].push(row[key] ?? "");
    }
  }
  return out;
}

function mockSecFetch() {
  const main = {
    cik: "0001287750",
    name: "Ares Capital Corporation",
    filings: {
      recent: columnar([
        {
          accessionNumber: "0001628280-26-050307",
          filingDate: "2026-07-29",
          reportDate: "2026-06-30",
          acceptanceDateTime: "2026-07-29T21:00:00.000Z",
          form: "10-Q",
          primaryDocument: "arcc-20260630.htm",
        },
        {
          accessionNumber: "0001104659-26-106734",
          filingDate: "2026-09-10",
          form: "424B2",
          primaryDocument: "tm.htm",
        },
      ]),
      files: [],
    },
  };
  return vi.fn(async (url: string, init?: RequestInit) => {
    void init;
    if (url === "https://data.sec.gov/submissions/CIK0001287750.json") {
      return new Response(JSON.stringify(main), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("missing", { status: 404 });
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("loadArccSecCoverage", () => {
  it("requires ADMIN before any SEC request or inventory lookup", async () => {
    mocks.requireAdmin.mockRejectedValue(new mocks.NotFoundSignal());
    const fetchImpl = vi.fn();
    await expect(loadArccSecCoverage({ fetchImpl })).rejects.toBeInstanceOf(
      mocks.NotFoundSignal,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reconciles exact accessions after a successful SEC fetch", async () => {
    mocks.requireAdmin.mockResolvedValue({ isAdmin: true });
    const fetchImpl = mockSecFetch();
    const { coverage, reconciliation, reconciliationError, error } = await loadArccSecCoverage({
      fetchImpl,
      env: { SEC_USER_AGENT: "BDC Flow test@example.test" },
      now: () => new Date("2099-01-01T00:00:00.000Z"),
      bdcFlowRefs: {
        refs: [{ accessionNumber: "0001628280-26-050307", filingId: 42 }],
        bdcFlowOnlyCount: 3,
      },
    });

    expect(error).toBeNull();
    expect(reconciliationError).toBeNull();
    expect(coverage?.filings).toHaveLength(2);
    expect(reconciliation?.rows.map((r) => r.bdcFlowStatus)).toEqual(["RECEIVED", "MISSING"]);
    expect(reconciliation?.rows[0]?.filingDetailHref).toBe("/admin/filings/42");
    expect(reconciliation?.summary.coveragePercent).toBe(50);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not convert SEC fetch failure into MISSING classifications", async () => {
    mocks.requireAdmin.mockResolvedValue({ isAdmin: true });
    const { coverage, reconciliation, reconciliationError, error } = await loadArccSecCoverage({
      fetchImpl: vi.fn(),
      env: {},
      bdcFlowRefs: {
        refs: [{ accessionNumber: "0001628280-26-050307", filingId: 1 }],
      },
    });
    expect(coverage).toBeNull();
    expect(reconciliation).toBeNull();
    expect(reconciliationError).toBeNull();
    expect(error).toMatch(/SEC_USER_AGENT/);
  });

  it("does not convert BDC Flow lookup failure into MISSING classifications", async () => {
    mocks.requireAdmin.mockResolvedValue({ isAdmin: true });
    const { coverage, reconciliation, reconciliationError, error } = await loadArccSecCoverage({
      fetchImpl: mockSecFetch(),
      env: { SEC_USER_AGENT: "BDC Flow test@example.test" },
      now: () => new Date("2099-01-01T00:00:00.000Z"),
      bdcFlowRefs: {
        error: "The BDC Flow filing inventory could not be read for reconciliation.",
      },
    });
    expect(error).toBeNull();
    expect(coverage?.filings).toHaveLength(2);
    expect(reconciliation).toBeNull();
    expect(reconciliationError).toMatch(/inventory could not be read/);
  });
});
