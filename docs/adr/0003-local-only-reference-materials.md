# 0003. Local-only reference materials

## Status

Accepted

## Context

Product reference materials and the detailed implementation plan contain confidential
detail. The repository is intended to be public.

## Decision

- `/reference/` and `docs/IMPLEMENTATION_PLAN.md` are local-only. Both are listed in
  `.gitignore` and must never be committed or force-added.
- Files under `/reference/` are read-only and are never modified.
- `npm run verify:no-reference-tracked` fails if any local-only path is tracked by git. It
  runs in CI.
- `npm run verify:reference` checks the local reference files against recorded SHA-256
  checksums. When the files are absent (as in CI), it skips and exits successfully.
- Public files (including agent rules and documentation) contain principles only. They do
  not contain requirement-document section references, quotations, or confidential detail.

## Consequences

- CI and cloud agents do not have access to the reference materials or the detailed plan
  and must ask when they need them.
- Any change to a reference file is detected locally by checksum.
