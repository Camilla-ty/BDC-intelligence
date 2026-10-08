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
    loadAdminDashboard: vi.fn(),
    loadAdminFilingInventory: vi.fn(),
    loadAdminFilingDetail: vi.fn(),
    notFound: vi.fn(() => {
      throw new NotFoundSignal();
    }),
  };
});

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/server/auth/access", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/server/load-admin-filings", () => ({
  loadAdminDashboard: mocks.loadAdminDashboard,
  loadAdminFilingInventory: mocks.loadAdminFilingInventory,
  loadAdminFilingDetail: mocks.loadAdminFilingDetail,
}));

import AdminPage from "@/app/admin/page";
import AdminFilingsPage from "@/app/admin/filings/page";
import AdminFilingDetailPage from "@/app/admin/filings/[id]/page";

afterEach(() => {
  vi.clearAllMocks();
});

describe("Admin route authorization", () => {
  it("denies MEMBER and PRO via requireAdmin notFound on every admin page", async () => {
    mocks.requireAdmin.mockRejectedValue(new mocks.NotFoundSignal());

    await expect(AdminPage()).rejects.toBeInstanceOf(mocks.NotFoundSignal);
    await expect(AdminFilingsPage({ searchParams: Promise.resolve({}) })).rejects.toBeInstanceOf(
      mocks.NotFoundSignal,
    );
    await expect(AdminFilingDetailPage({ params: Promise.resolve({ id: "1" }) })).rejects.toBeInstanceOf(
      mocks.NotFoundSignal,
    );

    expect(mocks.requireAdmin).toHaveBeenCalledTimes(3);
    expect(mocks.loadAdminDashboard).not.toHaveBeenCalled();
    expect(mocks.loadAdminFilingInventory).not.toHaveBeenCalled();
    expect(mocks.loadAdminFilingDetail).not.toHaveBeenCalled();
  });

  it("allows ADMIN to load dashboard, inventory, and detail", async () => {
    mocks.requireAdmin.mockResolvedValue({ isAdmin: true, effectiveRole: "ADMIN" });
    mocks.loadAdminDashboard.mockResolvedValue({
      summary: {
        total_filings: 0,
        filings_with_documents: 0,
        filings_with_artifacts: 0,
        filings_with_processing: 0,
        filings_with_observations: 0,
        recent: [],
      },
      error: null,
    });
    mocks.loadAdminFilingInventory.mockResolvedValue({ rows: [], error: null });
    mocks.loadAdminFilingDetail.mockResolvedValue({
      detail: null,
      error: null,
      notFound: true,
    });

    await expect(AdminPage()).resolves.toBeTruthy();
    await expect(AdminFilingsPage({ searchParams: Promise.resolve({ q: "" }) })).resolves.toBeTruthy();
    await expect(AdminFilingDetailPage({ params: Promise.resolve({ id: "999" }) })).rejects.toBeInstanceOf(
      mocks.NotFoundSignal,
    );

    expect(mocks.loadAdminDashboard).toHaveBeenCalled();
    expect(mocks.loadAdminFilingInventory).toHaveBeenCalled();
    expect(mocks.loadAdminFilingDetail).toHaveBeenCalledWith("999");
    expect(mocks.notFound).toHaveBeenCalled();
  });
});
