# 0014. Application authorization ledger

## Status

Accepted

## Context

ADR 0013 gives BDC Flow a signed-in Supabase user. Admin filing QA and future paid
features need application roles. Email is not an authorization key. A mutable role column
on `public.user_profile` would overwrite history (G-10) and would sit in a schema the
Supabase Data API exposes by default. Local and CI PostgreSQL have no `auth` schema, so a
foreign key to `auth.users` would break `npm run db:test`. The existing `identity` schema
holds legal entities, groups, and instruments (G-14), not application users.

## Decision

- **Identity:** Supabase Auth. The application key is `auth.users.id` (JWT `sub`), stored
  as `uuid` in `access.grant_event.user_id`. No email column. No FK to `auth.users`.
- **Authorization:** schema `access`, not `public` and not `identity`. The Data API must
  not expose it.
- **Ledger:** append-only `access.grant_event` with `grant_kind` ADMIN or PRO, `action`
  GRANT or REVOKE, `source` BOOTSTRAP, OPERATOR, or SUBSCRIPTION, nullable `actor_user_id`,
  and a non-empty `reason`. MEMBER is never stored. `actor_user_id` must differ from
  `user_id`. BOOTSTRAP is the only source that may omit an actor.
- **Current access:** `access.current_access` is computed. The latest event per
  (`user_id`, `grant_kind`) is current. An active ADMIN grant is effective role ADMIN,
  else an active PRO grant is PRO, else MEMBER. ADMIN and PRO may both be active.
- **Reads:** role `access_reader` (NOLOGIN) has SELECT on `access.current_access` only.
  `bdc_reader` is unchanged and has no access to this schema. The hosted login role must
  be granted `access_reader` by an operator; the migration does not grant it to a login
  role.
- **Writes:** the web application cannot insert grants. `access.record_grant` is not
  granted to application roles. Operators run `node scripts/access-grant.mjs` with the
  owner or `PIPELINE_DATABASE_URL` connection.
- **Bootstrap:** the first ADMIN is `BOOTSTRAP` with `--user-id` set to that person's
  Supabase user UUID (Auth dashboard) and an explicit `--reason`. There is no web UI.
- **Server checks:** `getCurrentUser()` still calls `getUser()`. `getCurrentAccess()`,
  `requireAuthenticatedUser()`, `requireAdmin()`, and `requireProOrAdmin()` run only on
  the server. `getSession()` is not used. `proxy.ts` is not the security boundary.
- **Out of scope:** payments, Stripe, subscription tables, profile UI, `/admin`, OAuth,
  custom JWT role claims, row-level security, service-role keys. A later payment webhook
  may append PRO events with source `SUBSCRIPTION`.

## Consequences

- A new email OTP user is MEMBER until an operator records a grant.
- Revoking ADMIN or PRO is another ledger row, not an UPDATE.
- Hosted authorization lookups fail closed (MEMBER, so `requireAdmin` denies) until
  `access_reader` is granted to the web login role and migration 0047 is applied.
- Working-tree WIP already occupies untracked `0047_borrower_maturity_wall.sql` through
  `0052`. This migration is numbered 0047 for `origin/main`. Schema tests for this change
  must run from a tree that contains 0001–0046 plus this file only. Do not overwrite the
  dirty `db/schema.snapshot.sql`; regenerate it from `main` plus this migration at commit
  time.
