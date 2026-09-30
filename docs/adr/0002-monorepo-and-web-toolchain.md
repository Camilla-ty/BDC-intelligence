# 0002. Monorepo and web toolchain

## Status

Accepted

## Context

The project needs a web application now and will need other components (for example a
data pipeline) later. The repository must be deployable to Vercel and verifiable in CI.

## Decision

- **Repository:** a single repository using npm workspaces. The web application lives in
  `apps/web`. Other components will be added as separate top-level directories when their
  phases begin.
- **Package manager:** npm, with a committed `package-lock.json`.
- **Runtime:** Node.js 24, pinned in `.nvmrc` and `engines`. This is approved for now and
  may be revisited.
- **Web:** Next.js (App Router) with React and strict TypeScript.
- **Styling:** Tailwind CSS v4, configured in CSS.
- **Linting:** ESLint flat config with `eslint-config-next`. No Prettier.
- **Testing:** Vitest with React Testing Library and jsdom.
- **CI:** GitHub Actions runs the verification scripts, lint, typecheck, tests, and build.
- **Deployment:** Vercel-compatible (root directory `apps/web`, no `vercel.json`). Connecting
  Vercel is deferred.

## Consequences

- One lockfile and one `npm run verify` command cover the whole repository.
- The installed Next.js version has breaking changes relative to older documentation;
  agents must read `apps/web/AGENTS.md` and the bundled Next.js docs.
- Database, data access, pipeline, storage, and authentication choices are not decided here.
