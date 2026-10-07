import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { authCookieOptions, supabaseAuthConfig } from "@/server/auth/config";

// Server-only by design (ADR 0013). Never import from a "use client" module.

// One client per request: @supabase/ssr delivers cache headers only on a client's first cookie write.
export async function createSupabaseServerClient(): Promise<SupabaseClient | null> {
  const config = supabaseAuthConfig();
  if (config == null) return null;
  const cookieStore = await cookies();
  return createServerClient(config.url, config.publishableKey, {
    cookieOptions: authCookieOptions(),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Server Components cannot write cookies; the proxy and server actions persist refreshed sessions.
        }
      },
    },
  });
}
