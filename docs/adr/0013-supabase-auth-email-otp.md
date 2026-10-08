# 0013. Supabase Auth with email one-time codes

## Status

Superseded by [0015](0015-supabase-auth-email-otp-and-microsoft-oauth.md)

## Context

ADR 0002 left authentication undecided. Later admin work (filing and extraction QA) needs a
server-verified signed-in user. ADR 0009 allows exactly one npm database package; it does not
cover an authentication client. The application database stays PostgreSQL, reached through
the existing SQL-text client and `bdc_reader`.

## Decision

- **Provider:** Supabase Auth, email one-time codes only. No passwords, no magic links in the
  user flow, no OAuth or Microsoft login. A new email address signs up through the same flow
  (`shouldCreateUser: true`).
- **Dependencies:** `@supabase/supabase-js` and `@supabase/ssr` in `apps/web`, pinned. They
  are authentication clients, not database clients; the ADR 0009 database-package rule is
  unchanged and nothing here queries PostgreSQL through Supabase.
- **Server only:** there is no browser Supabase client. Code requests, code verification, and
  sign-out are server actions (`apps/web/src/server/auth/actions.ts`). The server client uses
  the `@supabase/ssr` `getAll`/`setAll` cookie pattern with Next.js `cookies()`.
- **Environment:** the web process reads only `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`,
  both server-only (no `NEXT_PUBLIC_` prefix). No service-role or secret key is used.
  `DATABASE_URL` and `PIPELINE_DATABASE_URL` are unrelated to authentication.
- **Identity check:** `getCurrentUser()` calls `auth.getUser()`, which confirms the session
  with the Auth server. `getSession()` is never used for an access decision.
- **Proxy:** `apps/web/src/proxy.ts` refreshes the session only on `/login` and `/account`
  and marks those responses uncacheable. Public research pages are outside its matcher. The
  proxy is not an access boundary; pages and server actions check the user themselves.
- **Cookies:** `@supabase/ssr` defaults (`SameSite=Lax`, path `/`), plus `Secure` in
  production. HttpOnly stays at the library default (off) until it is decided separately.
- **Not in this decision:** roles, authorization, profile or grant tables, row-level
  security, custom JWT claims, payments.

## Consequences

- Sign-in works only after the Supabase project is configured (email provider, a code-based
  email template, URL settings, and custom SMTP for non-team addresses).
- No application table stores users; a user is identified by the Supabase user id.
- Application authorization is [ADR 0014](0014-application-authorization.md).
- Making the auth cookies HttpOnly is an open engineering decision; it is possible because no
  browser client reads them, but it is not enabled here.
- **Superseded:** Microsoft OAuth was added in [ADR 0015](0015-supabase-auth-email-otp-and-microsoft-oauth.md);
  email OTP remains supported under that decision.
