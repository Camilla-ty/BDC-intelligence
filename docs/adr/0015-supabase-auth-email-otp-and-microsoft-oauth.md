# 0015. Supabase Auth with email OTP and Microsoft OAuth

## Status

Accepted

## Context

[ADR 0013](0013-supabase-auth-email-otp.md) established Supabase Auth with email one-time codes
only and explicitly excluded OAuth and Microsoft login. Operators later enabled the Supabase
Azure provider outside the repository. The application still needs a server-only sign-in path
that establishes a Supabase session, while application authorization stays in PostgreSQL
([ADR 0014](0014-application-authorization.md)). Microsoft email or domain must not become an
authorization key.

## Decision

- **Supersedes ADR 0013** for the authentication method set. Email one-time codes remain
  supported exactly as before. Microsoft OAuth is an additional sign-in method.
- **Provider:** Supabase Auth. Email OTP (`signInWithOtp` / `verifyOtp`) and Microsoft via
  Supabase Azure OAuth (`provider: "azure"`, `signInWithOAuth` / `exchangeCodeForSession`).
  No passwords. No browser Supabase client. No service-role or secret key in the web process.
- **OAuth callback:** fixed path `/auth/callback`. `redirectTo` is built only from server-only
  `SITE_URL` plus that path. The browser cannot supply a post-login redirect. Success goes to
  `/account`; failure goes to `/login`. Provider error details are never shown to users.
- **Environment:** `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and (for Microsoft sign-in)
  `SITE_URL`. All server-only (no `NEXT_PUBLIC_` prefix). Azure client secrets stay in the
  Supabase/Azure configuration, not in the Next.js application.
- **Identity:** a signed-in user is identified by the Supabase user id (`auth.users.id` / JWT
  `sub`), same as email OTP. Microsoft email or tenant domain is display/contact metadata only.
- **Authorization:** unchanged. Roles come from `access.current_access` (ADR 0014). A new
  Microsoft user receives no elevated application role automatically (MEMBER until an operator
  records a grant).
- **Proxy:** session cookie refresh covers `/login`, `/account`, and `/auth/callback`. The
  proxy is not an access boundary.
- **Identity check:** `getCurrentUser()` still uses `auth.getUser()`. `getSession()` is never
  used for an access decision.

## Consequences

- Email OTP and Microsoft OAuth both produce a Supabase session; both are then subject to the
  same access ledger checks.
- Microsoft sign-in requires Supabase Azure provider configuration and a matching `SITE_URL`
  redirect allow-list entry outside this repository.
- Linking an existing email-OTP user to a Microsoft identity is a Supabase Auth configuration
  concern, not an application authorization rule.
