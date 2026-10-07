import type { CookieOptionsWithName } from "@supabase/ssr";

// Server-only by design (ADR 0013). Never import from a "use client" module.

export type SupabaseAuthConfig = { url: string; publishableKey: string };

export function supabaseAuthConfig(): SupabaseAuthConfig | null {
  const url = process.env.SUPABASE_URL?.trim();
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) return null;
  return { url, publishableKey };
}

export function authCookieOptions(): CookieOptionsWithName {
  return { secure: process.env.NODE_ENV === "production" };
}
