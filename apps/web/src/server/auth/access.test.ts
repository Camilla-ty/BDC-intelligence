// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOGIN_PATH } from "@/lib/auth-input";
import { currentAccessSql } from "@/server/auth/access";

const mocks = vi.hoisted(() => {
  class RedirectSignal extends Error {
    constructor(readonly path: string) {
      super(`redirect ${path}`);
    }
  }
  class NotFoundSignal extends Error {
    constructor() {
      super("NEXT_HTTP_ERROR_FALLBACK;404");
    }
  }
  return {
    RedirectSignal,
    NotFoundSignal,
    getCurrentUser: vi.fn(),
    executeSql: vi.fn(),
    redirect: vi.fn((path: string) => {
      throw new RedirectSignal(path);
    }),
    notFound: vi.fn(() => {
      throw new NotFoundSignal();
    }),
  };
});

vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: mocks.notFound }));
vi.mock("@/server/auth/current-user", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/server/sql-text", () => ({ executeSql: mocks.executeSql }));

import { getCurrentAccess, requireAdmin, requireAuthenticatedUser, requireProOrAdmin } from "@/server/auth/access";

const MEMBER = "00000000-0000-4000-8000-000000000010";
const PRO = "00000000-0000-4000-8000-000000000011";
const ADMIN = "00000000-0000-4000-8000-000000000012";

function user(id: string) {
  return { id, email: "member@example.test" };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("currentAccessSql", () => {
  it("queries by UUID under access_reader and never by email", () => {
    const sql = currentAccessSql("00000000-0000-4000-8000-000000000001");
    expect(sql).toMatch(/SET ROLE access_reader/);
    expect(sql).toMatch(/access\.current_access/);
    expect(sql).toMatch(/'00000000-0000-4000-8000-000000000001'::uuid/);
    expect(sql).not.toMatch(/email|camilla@|user_metadata|app_metadata|record_grant/i);
    expect(() => currentAccessSql("camilla@bdcflow.com")).toThrow(/cannot be queried/);
  });
});

describe("getCurrentAccess", () => {
  it("returns null when no one is signed in", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    expect(await getCurrentAccess()).toBeNull();
    expect(mocks.executeSql).not.toHaveBeenCalled();
  });

  it("returns MEMBER when the ledger has no row", async () => {
    mocks.getCurrentUser.mockResolvedValue(user(MEMBER));
    mocks.executeSql.mockResolvedValue({
      ok: true,
      text: JSON.stringify({ deployed: true, is_admin: false, is_pro: false, effective_role: "MEMBER" }),
    });
    expect(await getCurrentAccess()).toEqual({
      user: user(MEMBER),
      effectiveRole: "MEMBER",
      isAdmin: false,
      isPro: false,
    });
  });

  it("returns PRO and ADMIN from the ledger, not from email", async () => {
    mocks.getCurrentUser.mockResolvedValue(user(PRO));
    mocks.executeSql.mockResolvedValue({
      ok: true,
      text: JSON.stringify({ deployed: true, is_admin: false, is_pro: true, effective_role: "PRO" }),
    });
    expect(await getCurrentAccess()).toMatchObject({ effectiveRole: "PRO", isPro: true, isAdmin: false });
    mocks.getCurrentUser.mockResolvedValue(user(ADMIN));
    mocks.executeSql.mockResolvedValue({
      ok: true,
      text: JSON.stringify({ deployed: true, is_admin: true, is_pro: true, effective_role: "ADMIN" }),
    });
    expect(await getCurrentAccess()).toMatchObject({ effectiveRole: "ADMIN", isAdmin: true, isPro: true });
  });

  it("fails closed to MEMBER when the lookup fails", async () => {
    mocks.getCurrentUser.mockResolvedValue(user(MEMBER));
    mocks.executeSql.mockResolvedValue({ ok: false });
    expect(await getCurrentAccess()).toMatchObject({ effectiveRole: "MEMBER", isAdmin: false });
  });
});

describe("require helpers", () => {
  it("sends an unauthenticated visitor to /login", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    await expect(requireAuthenticatedUser()).rejects.toBeInstanceOf(mocks.RedirectSignal);
    expect(mocks.redirect).toHaveBeenCalledWith(LOGIN_PATH);
    await expect(requireAdmin()).rejects.toBeInstanceOf(mocks.RedirectSignal);
  });

  it("rejects MEMBER and PRO for requireAdmin and accepts ADMIN", async () => {
    mocks.getCurrentUser.mockResolvedValue(user(MEMBER));
    mocks.executeSql.mockResolvedValue({
      ok: true,
      text: JSON.stringify({ deployed: true, is_admin: false, is_pro: false, effective_role: "MEMBER" }),
    });
    await expect(requireAdmin()).rejects.toBeInstanceOf(mocks.NotFoundSignal);
    mocks.getCurrentUser.mockResolvedValue(user(PRO));
    mocks.executeSql.mockResolvedValue({
      ok: true,
      text: JSON.stringify({ deployed: true, is_admin: false, is_pro: true, effective_role: "PRO" }),
    });
    await expect(requireAdmin()).rejects.toBeInstanceOf(mocks.NotFoundSignal);
    await expect(requireProOrAdmin()).resolves.toMatchObject({ effectiveRole: "PRO" });
    mocks.getCurrentUser.mockResolvedValue(user(ADMIN));
    mocks.executeSql.mockResolvedValue({
      ok: true,
      text: JSON.stringify({ deployed: true, is_admin: true, is_pro: false, effective_role: "ADMIN" }),
    });
    await expect(requireAdmin()).resolves.toMatchObject({ effectiveRole: "ADMIN", isAdmin: true });
  });
});
