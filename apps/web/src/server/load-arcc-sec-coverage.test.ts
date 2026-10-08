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

afterEach(() => {
  vi.clearAllMocks();
});

describe("loadArccSecCoverage", () => {
  it("requires ADMIN before any SEC request", async () => {
    mocks.requireAdmin.mockRejectedValue(new mocks.NotFoundSignal());
    const fetchImpl = vi.fn();
    await expect(loadArccSecCoverage({ fetchImpl })).rejects.toBeInstanceOf(
      mocks.NotFoundSignal,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fetches the live SEC submissions URL shape for ARCC with mocked HTTP", async () => {
    mocks.requireAdmin.mockResolvedValue({ isAdmin: true });
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
        ]),
        files: [
          {
            name: "CIK0001287750-submissions-001.json",
            filingCount: 1,
            filingFrom: "2019-01-01",
            filingTo: "2019-12-31",
          },
        ],
      },
    };
    const page = columnar([
      {
        accessionNumber: "0001287750-19-000001",
        filingDate: "2019-02-01",
        reportDate: "2018-12-31",
        form: "10-K",
        primaryDocument: "arcc.htm",
      },
    ]);

    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      void init;
      if (url === "https://data.sec.gov/submissions/CIK0001287750.json") {
        return new Response(JSON.stringify(main), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === "https://data.sec.gov/submissions/CIK0001287750-submissions-001.json") {
        return new Response(JSON.stringify(page), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("missing", { status: 404 });
    });

    const { coverage, error } = await loadArccSecCoverage({
      fetchImpl,
      env: { SEC_USER_AGENT: "BDC Flow test@example.test" },
      now: () => new Date("2099-01-01T00:00:00.000Z"),
    });

    expect(error).toBeNull();
    expect(coverage?.filings).toHaveLength(2);
    expect(coverage?.filings[0]?.accessionNumber).toBe("0001628280-26-050307");
    expect(coverage?.filings[0]?.primaryDocumentUrl).toBe(
      "https://www.sec.gov/Archives/edgar/data/1287750/000162828026050307/arcc-20260630.htm",
    );
    expect(coverage?.sourceUrl).toBe("https://data.sec.gov/submissions/CIK0001287750.json");
    expect(coverage?.coverageNote).toMatch(/does not reconcile/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const init = fetchImpl.mock.calls[0]?.[1];
    const headers = init?.headers as Record<string, string>;
    expect(headers["User-Agent"]).toBe("BDC Flow test@example.test");
  });

  it("surfaces a clear error when SEC_USER_AGENT is missing", async () => {
    mocks.requireAdmin.mockResolvedValue({ isAdmin: true });
    const { coverage, error } = await loadArccSecCoverage({
      fetchImpl: vi.fn(),
      env: {},
    });
    expect(coverage).toBeNull();
    expect(error).toMatch(/SEC_USER_AGENT/);
  });
});
