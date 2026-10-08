// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const memo = vi.hoisted(() => {
  let cacheWraps = 0;
  return {
    cacheWraps: () => cacheWraps,
    resetWraps: () => {
      cacheWraps = 0;
    },
    cache: <T extends (...args: never[]) => unknown>(fn: T): T => {
      cacheWraps += 1;
      let value: ReturnType<T> | undefined;
      let started = false;
      return ((...args: never[]) => {
        if (!started) {
          started = true;
          value = fn(...args) as ReturnType<T>;
        }
        return value as ReturnType<T>;
      }) as T;
    },
  };
});

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, cache: memo.cache };
});

const authMocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  createSupabaseServerClient: vi.fn(),
  executeSql: vi.fn(),
}));

vi.mock("@/server/auth/supabase", () => ({
  createSupabaseServerClient: authMocks.createSupabaseServerClient,
}));

vi.mock("@/server/sql-text", () => ({
  executeSql: authMocks.executeSql,
}));

afterEach(() => {
  vi.clearAllMocks();
  memo.resetWraps();
});

describe("request-scoped auth memoization wiring", () => {
  it("wraps getCurrentUser and getCurrentAccess with React.cache (not unstable_cache)", () => {
    const root = join(process.cwd(), "src/server/auth");
    const userSrc = readFileSync(join(root, "current-user.ts"), "utf8");
    const accessSrc = readFileSync(join(root, "access.ts"), "utf8");
    expect(userSrc).toMatch(/import\s*\{\s*cache\s*\}\s*from\s*["']react["']/);
    expect(userSrc).toMatch(/export const getCurrentUser = cache\(/);
    expect(userSrc).not.toMatch(/unstable_cache/);
    expect(accessSrc).toMatch(/import\s*\{\s*cache\s*\}\s*from\s*["']react["']/);
    expect(accessSrc).toMatch(/export const getCurrentAccess = cache\(/);
    expect(accessSrc).not.toMatch(/unstable_cache/);
  });
});

describe("request-scoped auth memoization behavior", () => {
  it("reuses one Supabase getUser and one access SQL result within the same memo scope", async () => {
    authMocks.createSupabaseServerClient.mockResolvedValue({
      auth: { getUser: authMocks.getUser },
    });
    authMocks.getUser.mockResolvedValue({
      data: { user: { id: "00000000-0000-4000-8000-000000000001", email: "member@example.test" } },
      error: null,
    });
    authMocks.executeSql.mockResolvedValue({
      ok: true,
      text: JSON.stringify({ deployed: true, is_admin: false, is_pro: false, effective_role: "MEMBER" }),
    });

    const { getCurrentUser } = await import("@/server/auth/current-user");
    const { getCurrentAccess, requireAuthenticatedUser } = await import("@/server/auth/access");

    expect(memo.cacheWraps()).toBeGreaterThanOrEqual(2);

    const firstUser = await getCurrentUser();
    const secondUser = await getCurrentUser();
    expect(secondUser).toBe(firstUser);
    expect(authMocks.getUser).toHaveBeenCalledTimes(1);
    expect(authMocks.createSupabaseServerClient).toHaveBeenCalledTimes(1);

    const firstAccess = await getCurrentAccess();
    const secondAccess = await getCurrentAccess();
    const required = await requireAuthenticatedUser();
    expect(secondAccess).toBe(firstAccess);
    expect(required).toBe(firstAccess);
    expect(authMocks.executeSql).toHaveBeenCalledTimes(1);
    expect(authMocks.getUser).toHaveBeenCalledTimes(1);
  });
});
