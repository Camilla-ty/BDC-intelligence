// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class RedirectSignal extends Error {
    constructor(readonly path: string) {
      super(`redirect ${path}`);
    }
  }
  return {
    RedirectSignal,
    cookieStore: { getAll: vi.fn(() => [] as { name: string; value: string }[]), set: vi.fn() },
    auth: {
      signInWithOtp: vi.fn(),
      verifyOtp: vi.fn(),
      signInWithOAuth: vi.fn(),
      exchangeCodeForSession: vi.fn(),
      signOut: vi.fn(),
      getUser: vi.fn(),
      getClaims: vi.fn(),
      getSession: vi.fn(),
    },
    createServerClient: vi.fn(),
    redirect: vi.fn((path: string) => {
      throw new RedirectSignal(path);
    }),
  };
});

vi.mock("next/headers", () => ({ cookies: vi.fn(async () => mocks.cookieStore) }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));

import {
  AUTH_UNAVAILABLE_MESSAGE,
  CODE_SENT_MESSAGE,
  INVALID_CODE_MESSAGE,
  INVALID_EMAIL_MESSAGE,
  OAUTH_FAILED_MESSAGE,
  SEND_FAILED_MESSAGE,
  VERIFY_FAILED_MESSAGE,
} from "@/lib/auth-input";
import { GET as oauthCallback } from "@/app/auth/callback/route";
import { requestOtp, signInWithMicrosoft, signOut, verifyOtp } from "@/server/auth/actions";
import { applicationOrigin, oauthCallbackUrl } from "@/server/auth/config";
import { getCurrentUser } from "@/server/auth/current-user";
import { config as proxyConfig, proxy } from "@/proxy";
import { NextRequest } from "next/server";

type CookieOptionsArg = {
  cookieOptions: { secure?: boolean };
  cookies: {
    getAll: () => unknown;
    setAll: (cookies: { name: string; value: string; options: Record<string, unknown> }[], headers: Record<string, string>) => void;
  };
};

function lastClientOptions(): CookieOptionsArg {
  const call = mocks.createServerClient.mock.calls.at(-1);
  if (call == null) throw new Error("no Supabase client was created");
  return call[2] as CookieOptionsArg;
}

async function redirectPath(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof mocks.RedirectSignal) return error.path;
    throw error;
  }
  throw new Error("expected a redirect");
}

beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "https://test-project.supabase.test");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "TEST_PUBLISHABLE_KEY");
  vi.stubEnv("SITE_URL", "https://app.example.test");
  mocks.createServerClient.mockImplementation(() => ({ auth: mocks.auth }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("requestOtp", () => {
  it("normalizes the email and allows a new address to sign up", async () => {
    mocks.auth.signInWithOtp.mockResolvedValue({ data: { user: null, session: null }, error: null });
    const result = await requestOtp("  New.User@Example.TEST ");
    expect(mocks.auth.signInWithOtp).toHaveBeenCalledWith({
      email: "new.user@example.test",
      options: { shouldCreateUser: true },
    });
    expect(result).toEqual({ ok: true, message: CODE_SENT_MESSAGE });
  });

  it("answers an existing address exactly like a new one", async () => {
    mocks.auth.signInWithOtp.mockResolvedValue({ data: { user: null, session: null }, error: null });
    const existing = await requestOtp("existing.user@example.test");
    const fresh = await requestOtp("another.user@example.test");
    expect(existing).toEqual(fresh);
    for (const call of mocks.auth.signInWithOtp.mock.calls) {
      expect(call[0].options).toEqual({ shouldCreateUser: true });
    }
  });

  it("rejects an invalid email before calling Supabase", async () => {
    for (const input of ["", "not-an-email", "two@@example.test", "spaces in@example.test", 42 as unknown as string]) {
      expect(await requestOtp(input)).toEqual({ ok: false, error: INVALID_EMAIL_MESSAGE });
    }
    expect(mocks.createServerClient).not.toHaveBeenCalled();
    expect(mocks.auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it("hides provider error details", async () => {
    mocks.auth.signInWithOtp.mockResolvedValue({ data: {}, error: { message: "TEST PROVIDER INTERNAL DETAIL", status: 429 } });
    const result = await requestOtp("user@example.test");
    expect(result).toEqual({ ok: false, error: SEND_FAILED_MESSAGE });
    expect(JSON.stringify(result)).not.toMatch(/TEST PROVIDER INTERNAL DETAIL|429/);
  });

  it("reports sign-in as unavailable when Supabase is not configured", async () => {
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "");
    expect(await requestOtp("user@example.test")).toEqual({ ok: false, error: AUTH_UNAVAILABLE_MESSAGE });
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });
});

describe("verifyOtp", () => {
  it("verifies an email code, writes session cookies, and redirects to the fixed destination", async () => {
    mocks.auth.verifyOtp.mockImplementation(async () => {
      lastClientOptions().cookies.setAll(
        [{ name: "sb-test-auth-token", value: "TEST_SESSION_VALUE", options: { path: "/", sameSite: "lax" } }],
        {},
      );
      return { data: { session: { access_token: "TEST" }, user: { id: "TEST" } }, error: null };
    });
    const path = await redirectPath(verifyOtp("User@Example.test", "123 456"));
    expect(path).toBe("/account");
    expect(mocks.auth.verifyOtp).toHaveBeenCalledWith({ email: "user@example.test", token: "123456", type: "email" });
    expect(mocks.cookieStore.set).toHaveBeenCalledWith("sb-test-auth-token", "TEST_SESSION_VALUE", { path: "/", sameSite: "lax" });
  });

  it("marks cookies Secure in production only", async () => {
    mocks.auth.signInWithOtp.mockResolvedValue({ data: {}, error: null });
    await requestOtp("user@example.test");
    expect(lastClientOptions().cookieOptions).toEqual({ secure: false });
    vi.stubEnv("NODE_ENV", "production");
    await requestOtp("user@example.test");
    expect(lastClientOptions().cookieOptions).toEqual({ secure: true });
  });

  it("returns a generic error for a wrong or expired code and does not redirect", async () => {
    mocks.auth.verifyOtp.mockResolvedValueOnce({ data: { session: null, user: null }, error: { message: "Token has expired or is invalid", status: 403 } });
    expect(await verifyOtp("user@example.test", "000000")).toEqual({ ok: false, error: VERIFY_FAILED_MESSAGE });
    mocks.auth.verifyOtp.mockRejectedValueOnce(new Error("TEST NETWORK FAILURE"));
    expect(await verifyOtp("user@example.test", "000000")).toEqual({ ok: false, error: VERIFY_FAILED_MESSAGE });
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.cookieStore.set).not.toHaveBeenCalled();
  });

  it("rejects a malformed code or email before calling Supabase", async () => {
    expect(await verifyOtp("user@example.test", "abc123")).toEqual({ ok: false, error: INVALID_CODE_MESSAGE });
    expect(await verifyOtp("user@example.test", "12345")).toEqual({ ok: false, error: INVALID_CODE_MESSAGE });
    expect(await verifyOtp("bad", "123456")).toEqual({ ok: false, error: INVALID_EMAIL_MESSAGE });
    expect(mocks.auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("ignores any caller-supplied redirect target", async () => {
    mocks.auth.verifyOtp.mockResolvedValue({ data: { session: { access_token: "TEST" } }, error: null });
    const loose = verifyOtp as unknown as (...args: unknown[]) => Promise<unknown>;
    expect(await redirectPath(loose("user@example.test", "123456", "https://attacker.example.test/next"))).toBe("/account");
    expect(await redirectPath(loose("user@example.test", "123456", "//attacker.example.test"))).toBe("/account");
    expect(mocks.redirect.mock.calls.every(([path]) => path === "/account")).toBe(true);
  });
});

describe("signInWithMicrosoft", () => {
  it("starts Azure OAuth with the fixed callback URL and redirects to the provider", async () => {
    mocks.auth.signInWithOAuth.mockResolvedValue({
      data: { provider: "azure", url: "https://login.microsoftonline.test/oauth" },
      error: null,
    });
    const path = await redirectPath(signInWithMicrosoft());
    expect(path).toBe("https://login.microsoftonline.test/oauth");
    expect(mocks.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "azure",
      options: {
        redirectTo: "https://app.example.test/auth/callback",
        scopes: "openid email profile",
        skipBrowserRedirect: true,
      },
    });
  });

  it("ignores any caller-supplied redirect target", async () => {
    mocks.auth.signInWithOAuth.mockResolvedValue({
      data: { provider: "azure", url: "https://login.microsoftonline.test/oauth" },
      error: null,
    });
    const loose = signInWithMicrosoft as unknown as (...args: unknown[]) => Promise<unknown>;
    expect(await redirectPath(loose("https://attacker.example.test/next"))).toBe("https://login.microsoftonline.test/oauth");
    expect(mocks.auth.signInWithOAuth.mock.calls[0]?.[0].options.redirectTo).toBe("https://app.example.test/auth/callback");
  });

  it("hides provider error details", async () => {
    mocks.auth.signInWithOAuth.mockResolvedValue({
      data: { provider: "azure", url: null },
      error: { message: "TEST AZURE PROVIDER INTERNAL DETAIL", status: 400 },
    });
    const result = await signInWithMicrosoft();
    expect(result).toEqual({ ok: false, error: OAUTH_FAILED_MESSAGE });
    expect(JSON.stringify(result)).not.toMatch(/TEST AZURE PROVIDER INTERNAL DETAIL|400/);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("reports sign-in as unavailable when SITE_URL or Supabase is not configured", async () => {
    vi.stubEnv("SITE_URL", "");
    expect(await signInWithMicrosoft()).toEqual({ ok: false, error: AUTH_UNAVAILABLE_MESSAGE });
    expect(mocks.auth.signInWithOAuth).not.toHaveBeenCalled();
    vi.stubEnv("SITE_URL", "https://app.example.test");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "");
    expect(await signInWithMicrosoft()).toEqual({ ok: false, error: AUTH_UNAVAILABLE_MESSAGE });
    expect(mocks.auth.signInWithOAuth).not.toHaveBeenCalled();
  });
});

describe("oauth callback", () => {
  it("exchanges a valid code, sets session cookies, and redirects to /account", async () => {
    mocks.auth.exchangeCodeForSession.mockImplementation(async () => {
      lastClientOptions().cookies.setAll(
        [{ name: "sb-test-auth-token", value: "TEST_OAUTH_SESSION", options: { path: "/", sameSite: "lax" } }],
        {},
      );
      return { data: { session: { access_token: "TEST" }, user: { id: "TEST" } }, error: null };
    });
    const response = await oauthCallback(new NextRequest("https://app.example.test/auth/callback?code=TEST_AUTH_CODE"));
    expect(mocks.auth.exchangeCodeForSession).toHaveBeenCalledWith("TEST_AUTH_CODE");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://app.example.test/account");
    expect(response.cookies.get("sb-test-auth-token")?.value).toBe("TEST_OAUTH_SESSION");
    expect(response.headers.get("Cache-Control")).toMatch(/no-store/);
  });

  it("redirects to /login when the code is missing or invalid", async () => {
    for (const url of [
      "https://app.example.test/auth/callback",
      "https://app.example.test/auth/callback?code=",
      "https://app.example.test/auth/callback?code=bad%20code",
      "https://app.example.test/auth/callback?error=access_denied&error_description=TEST_PROVIDER_DETAIL",
    ]) {
      const response = await oauthCallback(new NextRequest(url));
      expect(response.headers.get("location")).toBe("https://app.example.test/login");
      expect(response.headers.get("location")).not.toMatch(/TEST_PROVIDER_DETAIL|access_denied/);
    }
    expect(mocks.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("redirects to /login when the exchange fails and does not expose provider details", async () => {
    mocks.auth.exchangeCodeForSession.mockResolvedValueOnce({
      data: { session: null, user: null },
      error: { message: "TEST EXCHANGE INTERNAL DETAIL", status: 400 },
    });
    const failed = await oauthCallback(new NextRequest("https://app.example.test/auth/callback?code=TEST_AUTH_CODE"));
    expect(failed.headers.get("location")).toBe("https://app.example.test/login");
    expect(JSON.stringify([...failed.headers.entries()])).not.toMatch(/TEST EXCHANGE INTERNAL DETAIL/);
    mocks.auth.exchangeCodeForSession.mockRejectedValueOnce(new Error("TEST NETWORK FAILURE"));
    const crashed = await oauthCallback(new NextRequest("https://app.example.test/auth/callback?code=TEST_AUTH_CODE"));
    expect(crashed.headers.get("location")).toBe("https://app.example.test/login");
  });

  it("never accepts a user-controlled post-login redirect", async () => {
    mocks.auth.exchangeCodeForSession.mockResolvedValue({ data: { session: { access_token: "TEST" } }, error: null });
    const response = await oauthCallback(
      new NextRequest("https://app.example.test/auth/callback?code=TEST_AUTH_CODE&next=https://attacker.example.test"),
    );
    expect(response.headers.get("location")).toBe("https://app.example.test/account");
    expect(response.headers.get("location")).not.toMatch(/attacker/);
  });
});

describe("applicationOrigin", () => {
  it("accepts only a bare http(s) origin from SITE_URL", () => {
    expect(applicationOrigin()).toBe("https://app.example.test");
    expect(oauthCallbackUrl()).toBe("https://app.example.test/auth/callback");
    vi.stubEnv("SITE_URL", "https://app.example.test/");
    expect(applicationOrigin()).toBe("https://app.example.test");
    vi.stubEnv("SITE_URL", "https://user:pass@app.example.test");
    expect(applicationOrigin()).toBeNull();
    vi.stubEnv("SITE_URL", "https://app.example.test/extra");
    expect(applicationOrigin()).toBeNull();
    vi.stubEnv("SITE_URL", "https://app.example.test?next=/evil");
    expect(applicationOrigin()).toBeNull();
  });
});

describe("signOut", () => {
  it("signs out and redirects to /login", async () => {
    mocks.auth.signOut.mockResolvedValue({ error: null });
    expect(await redirectPath(signOut())).toBe("/login");
    expect(mocks.auth.signOut).toHaveBeenCalledTimes(1);
  });

  it("still redirects to /login when the revoke call fails", async () => {
    mocks.auth.signOut.mockRejectedValue(new Error("TEST NETWORK FAILURE"));
    expect(await redirectPath(signOut())).toBe("/login");
  });
});

describe("getCurrentUser", () => {
  it("returns only the verified user id and email", async () => {
    mocks.auth.getUser.mockResolvedValue({
      data: { user: { id: "00000000-0000-4000-8000-000000000001", email: "member@example.test", user_metadata: { role: "admin" } } },
      error: null,
    });
    expect(await getCurrentUser()).toEqual({ id: "00000000-0000-4000-8000-000000000001", email: "member@example.test" });
    expect(mocks.auth.getSession).not.toHaveBeenCalled();
  });

  it("returns null without a verified user", async () => {
    mocks.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: { message: "Auth session missing", status: 400 } });
    expect(await getCurrentUser()).toBeNull();
    mocks.auth.getUser.mockRejectedValueOnce(new Error("TEST NETWORK FAILURE"));
    expect(await getCurrentUser()).toBeNull();
    vi.stubEnv("SUPABASE_URL", "");
    expect(await getCurrentUser()).toBeNull();
    expect(mocks.auth.getSession).not.toHaveBeenCalled();
  });
});

describe("proxy", () => {
  it("runs only on the sign-in and OAuth callback routes", () => {
    expect(proxyConfig.matcher).toEqual(["/login", "/account", "/auth/callback"]);
  });

  it("refreshes the session, forwards refreshed cookies, and marks the response uncacheable", async () => {
    mocks.auth.getClaims.mockImplementation(async () => {
      lastClientOptions().cookies.setAll(
        [{ name: "sb-test-auth-token", value: "TEST_REFRESHED", options: { path: "/", sameSite: "lax" } }],
        { "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0" },
      );
      return { data: null, error: null };
    });
    const response = await proxy(new NextRequest("http://localhost/account"));
    expect(mocks.auth.getClaims).toHaveBeenCalledTimes(1);
    expect(response.cookies.get("sb-test-auth-token")?.value).toBe("TEST_REFRESHED");
    expect(response.headers.get("Cache-Control")).toMatch(/no-store/);
    expect(response.headers.get("location")).toBeNull();
  });

  it("passes through without Supabase configuration", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    const response = await proxy(new NextRequest("http://localhost/login"));
    expect(mocks.createServerClient).not.toHaveBeenCalled();
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
