import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authCookieOptions, supabaseAuthConfig } from "@/server/auth/config";

// Session refresh for sign-in routes only. Not an access boundary: pages and server
// actions verify the user themselves. Public research routes are outside the matcher.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const config = supabaseAuthConfig();
  if (config != null) {
    const supabase = createServerClient(config.url, config.publishableKey, {
      cookieOptions: authCookieOptions(),
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
          for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
        },
      },
    });
    try {
      await supabase.auth.getClaims();
    } catch {
      // A failed refresh leaves the user signed out; the page decides what to show.
    }
  }
  if (!response.headers.has("Cache-Control")) response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/login", "/account", "/auth/callback"],
};
