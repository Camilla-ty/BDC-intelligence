// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class RedirectSignal extends Error {
    constructor(readonly path: string) {
      super(`redirect ${path}`);
    }
  }
  return {
    RedirectSignal,
    requireAuthenticatedUser: vi.fn(),
    loadBorrowerObservations: vi.fn(),
    loadBorrowerObservationsForEntity: vi.fn(),
    loadPortfolioDirectory: vi.fn(),
    loadEmptyPeriods: vi.fn(),
    loadMarketDirectory: vi.fn(),
  };
});

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new mocks.RedirectSignal(path);
  },
}));
vi.mock("@/server/auth/access", () => ({
  requireAuthenticatedUser: mocks.requireAuthenticatedUser,
  requireAdmin: vi.fn(),
  getCurrentAccess: vi.fn(),
}));
vi.mock("@/server/load-borrowers", () => ({
  loadBorrowerObservations: mocks.loadBorrowerObservations,
  loadBorrowerObservationsForEntity: mocks.loadBorrowerObservationsForEntity,
  loadBorrowerPositionObservations: vi.fn(),
  loadBorrowerPositionComparisons: vi.fn(),
  loadBorrowerPositionValuation: vi.fn(),
  loadBorrowerMaturityObservations: vi.fn(),
  loadBorrowerMaturitySummary: vi.fn(),
  loadBorrowerMaturityYears: vi.fn(),
  loadBorrowerRefinancingOutcomes: vi.fn(),
  loadPositionResearchFields: vi.fn(),
}));
vi.mock("@/server/load-portfolios", () => ({
  loadPortfolioDirectory: mocks.loadPortfolioDirectory,
  loadEmptyPeriods: mocks.loadEmptyPeriods,
  loadPortfolioDetail: vi.fn(),
  loadPortfolioLines: vi.fn(),
  loadPortfolioHoldings: vi.fn(),
  loadPortfolioHoldingPage: vi.fn(),
  loadPortfolioPeriodChanges: vi.fn(),
}));
vi.mock("@/server/load-market", () => ({
  loadMarketDirectory: mocks.loadMarketDirectory,
  loadMarketRelease: vi.fn(),
  loadMarketDate: vi.fn(),
}));
vi.mock("@/server/load-maturity", () => ({
  loadMaturityDetail: vi.fn(),
  loadMaturityLines: vi.fn(),
}));

import BorrowersPage from "@/app/borrowers/page";
import BorrowerPage from "@/app/borrowers/[id]/page";
import PortfoliosPage from "@/app/portfolios/page";
import MaturityPage from "@/app/maturity/page";
import MarketPage from "@/app/market/page";
import AccountPage from "@/app/account/page";
import { getCurrentUser } from "@/server/auth/current-user";

vi.mock("@/server/auth/current-user", () => ({
  getCurrentUser: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("research route authentication", () => {
  it("sends unauthenticated visitors to /login before loading research data", async () => {
    mocks.requireAuthenticatedUser.mockRejectedValue(new mocks.RedirectSignal("/login"));

    await expect(BorrowersPage({ searchParams: Promise.resolve({}) })).rejects.toBeInstanceOf(mocks.RedirectSignal);
    await expect(BorrowerPage({ params: Promise.resolve({ id: "test-id" }) })).rejects.toBeInstanceOf(mocks.RedirectSignal);
    await expect(PortfoliosPage({ searchParams: Promise.resolve({}) })).rejects.toBeInstanceOf(mocks.RedirectSignal);
    await expect(MaturityPage({ searchParams: Promise.resolve({}) })).rejects.toBeInstanceOf(mocks.RedirectSignal);
    await expect(MarketPage({ searchParams: Promise.resolve({}) })).rejects.toBeInstanceOf(mocks.RedirectSignal);

    expect(mocks.requireAuthenticatedUser).toHaveBeenCalledTimes(5);
    expect(mocks.loadBorrowerObservations).not.toHaveBeenCalled();
    expect(mocks.loadBorrowerObservationsForEntity).not.toHaveBeenCalled();
    expect(mocks.loadPortfolioDirectory).not.toHaveBeenCalled();
    expect(mocks.loadMarketDirectory).not.toHaveBeenCalled();
  });

  it("allows MEMBER, PRO, and ADMIN to reach research pages after authentication", async () => {
    for (const role of ["MEMBER", "PRO", "ADMIN"] as const) {
      mocks.requireAuthenticatedUser.mockResolvedValue({
        user: { id: "00000000-0000-4000-8000-000000000001", email: "user@example.test" },
        effectiveRole: role,
        isAdmin: role === "ADMIN",
        isPro: role === "PRO" || role === "ADMIN",
      });
      mocks.loadBorrowerObservations.mockResolvedValue({ rows: [], error: null });
      mocks.loadPortfolioDirectory.mockResolvedValue({ rows: [], error: null });
      mocks.loadEmptyPeriods.mockResolvedValue({ labels: [], error: null });
      mocks.loadMarketDirectory.mockResolvedValue({
        registrants: [],
        releases: [],
        dates: [],
        error: null,
      });

      await expect(BorrowersPage({ searchParams: Promise.resolve({}) })).resolves.toBeTruthy();
      await expect(PortfoliosPage({ searchParams: Promise.resolve({}) })).resolves.toBeTruthy();
      await expect(MaturityPage({ searchParams: Promise.resolve({}) })).resolves.toBeTruthy();
      await expect(MarketPage({ searchParams: Promise.resolve({}) })).resolves.toBeTruthy();
    }
  });

  it("keeps /account available to any authenticated user and redirects when signed out", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(null);
    await expect(AccountPage()).rejects.toBeInstanceOf(mocks.RedirectSignal);

    vi.mocked(getCurrentUser).mockResolvedValueOnce({
      id: "00000000-0000-4000-8000-000000000001",
      email: "member@example.test",
    });
    await expect(AccountPage()).resolves.toBeTruthy();
  });
});
