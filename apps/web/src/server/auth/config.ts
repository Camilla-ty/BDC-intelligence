import type { CookieOptionsWithName } from "@supabase/ssr";
import { AUTH_CALLBACK_PATH } from "@/lib/auth-input";

// Server-only by design (ADR 0015). Never import from a "use client" module.

export type SupabaseAuthConfig = { url: string; publishableKey: string };

export function supabaseAuthConfig(): SupabaseAuthConfig | null {
  const url = process.env.SUPABASE_URL?.trim();
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) return null;
  return { url, publishableKey };
}

/** Canonical application origin for OAuth redirectTo. Not taken from the request. */
export function applicationOrigin(): string | null {
  const raw = process.env.SITE_URL?.trim();
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  if (parsed.pathname !== "/" && parsed.pathname !== "") return null;
  return parsed.origin;
}

export function oauthCallbackUrl(): string | null {
  const origin = applicationOrigin();
  return origin == null ? null : `${origin}${AUTH_CALLBACK_PATH}`;
}

export function authCookieOptions(): CookieOptionsWithName {
  return { secure: process.env.NODE_ENV === "production" };
}
