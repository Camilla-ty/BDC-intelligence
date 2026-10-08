import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { LOGIN_PATH, SIGNED_IN_PATH } from "@/lib/auth-input";
import { applicationOrigin, authCookieOptions, supabaseAuthConfig } from "@/server/auth/config";

// OAuth return: exchange the authorization code for a session, then go to /account.
// Failures go to /login. Provider error details are never shown. No user-controlled next path.

function safeRedirect(request: NextRequest, path: typeof LOGIN_PATH | typeof SIGNED_IN_PATH): NextResponse {
  const origin = applicationOrigin();
  const target = origin != null ? `${origin}${path}` : new URL(path, request.url).toString();
  const response = NextResponse.redirect(target);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function authorizationCode(value: string | null): string | null {
  if (value == null) return null;
  const code = value.trim();
  if (code.length === 0 || code.length > 2048) return null;
  if (!/^[A-Za-z0-9._~+/=-]+$/.test(code)) return null;
  return code;
}

export async function GET(request: NextRequest) {
  const code = authorizationCode(request.nextUrl.searchParams.get("code"));
  if (code == null) return safeRedirect(request, LOGIN_PATH);

  const config = supabaseAuthConfig();
  if (config == null) return safeRedirect(request, LOGIN_PATH);

  const response = safeRedirect(request, SIGNED_IN_PATH);
  const supabase = createServerClient(config.url, config.publishableKey, {
    cookieOptions: authCookieOptions(),
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  try {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return safeRedirect(request, LOGIN_PATH);
  } catch {
    return safeRedirect(request, LOGIN_PATH);
  }

  return response;
}
