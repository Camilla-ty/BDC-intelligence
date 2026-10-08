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
    loadArccSecCoverage: vi.fn(),
  };
});

vi.mock("@/server/auth/access", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/server/load-arcc-sec-coverage", () => ({
  loadArccSecCoverage: mocks.loadArccSecCoverage,
}));

import ArccSecCoveragePage from "@/app/admin/coverage/arcc/page";

afterEach(() => {
  vi.clearAllMocks();
});

describe("/admin/coverage/arcc authorization", () => {
  it("denies MEMBER and PRO via requireAdmin", async () => {
    mocks.requireAdmin.mockRejectedValue(new mocks.NotFoundSignal());
    await expect(ArccSecCoveragePage()).rejects.toBeInstanceOf(mocks.NotFoundSignal);
    expect(mocks.loadArccSecCoverage).not.toHaveBeenCalled();
  });

  it("allows ADMIN to load the SEC coverage page", async () => {
    mocks.requireAdmin.mockResolvedValue({ isAdmin: true, effectiveRole: "ADMIN" });
    mocks.loadArccSecCoverage.mockResolvedValue({
      coverage: {
        cik: "0001287750",
        registrantName: "Ares Capital Corporation",
        sourceUrl: "https://data.sec.gov/submissions/CIK0001287750.json",
        fetchedAt: "2099-01-01T00:00:00.000Z",
        recentCount: 0,
        historyFiles: [],
        historyPagesFetched: 0,
        historyPagesSkipped: 0,
        coverageFrom: null,
        coverageTo: null,
        filings: [],
        coverageNote: "test",
      },
      error: null,
    });
    await expect(ArccSecCoveragePage()).resolves.toBeTruthy();
    expect(mocks.loadArccSecCoverage).toHaveBeenCalled();
  });
});
