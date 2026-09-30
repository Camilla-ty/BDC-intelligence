# 0011. Registry ingestion pipeline

## Status

Accepted

## Context

Phase 2 loads the BDC master registry and filing history from verified SEC sources (the Data
Sets page, BDC Report page and 2020–2026 CSVs, data-set ZIP SUB tables, and submissions JSON
including additional pages). Phase 1 defined the schema and provenance model (ADR 0009,
ADR 0010). Ingestion must stay network-free in CI, keep fetch separate from load, never infer a
registrant from an accession-number prefix, and leave cross-source disagreements visible.

## Decision

- **Fetch and load are separate.** `npm run registry:fetch` talks to the SEC, writes bytes to
  the git-ignored content-addressed store (`.data/sec/raw/sha256/…`), and appends a hash-chained
  fetch log. `npm run registry:load` is offline: it rebuilds the database from that log and
  store. The same log and store produce the same database.
- **No npm HTTP or database client.** Fetch uses `fetch` and Node built-ins. Load uses
  `docker exec psql` and `COPY`, as in ADR 0009. Fair access: User-Agent from `SEC_USER_AGENT`,
  at most one request per 1.1 seconds, stop on HTTP 403/429, bounded retries on 5xx.
- **Additional submissions pages** use the observed URL `https://data.sec.gov/submissions/{name}`
  (SOURCE_SCHEMAS 7.1). Names outside the observed `CIK##########-submissions-###.json` pattern
  are not fetched.
- **BDC Report years 2020–2026** in the verified header are loaded. 2012–2019 editions are
  recorded as `NOT_IN_SCOPE`. An in-range file whose header differs is recorded as
  `SCHEMA_DRIFT` and the load stops. The year comes from the page link text, never the file name.
- **SUB only.** ZIP members are checksummed; only `datasets/sub.tsv` is parsed. SOI and other
  tables are not ingested.
- **Registrant identity is explicit.** Filing-to-registrant links use the SUB `cik` cell or the
  CIK in the submissions URL. There is no accession-prefix column or derivation. Conflicting
  links stay visible (`MULTIPLE`).
- **Amendments.** Every `/A` form receives an `UNRESOLVED` `AMENDS` decision with no target and
  method `NO_AMENDMENT_MATCHING`. `PREVRPT` is stored raw only (Q17).
- **History is stream-scoped.** Within one source stream, an unchanged value is skipped, a
  changed value supersedes, and values absent from a newer retrieval are counted and audited,
  never deleted. Different streams coexist. Cross-source disagreements are `FAIL` validation
  results plus `CONTRADICTS` supplementary evidence; nothing picks a winner.
- **Coverage** is asserted with an aspect: `FILING_METADATA` (per release, and per registrant
  in that release) and `FILING_HISTORY` (per registrant). Unasserted scopes stay `UNKNOWN`.
- **CI** runs only synthetic, obviously fake fixtures (TEST BDC, CIK `9999999901+`, dates in
  2099, TEST-ONLY URLs). Real SEC bytes stay in ignored local storage and a disposable local
  Docker database.

## Consequences

- Offline rebuilds are deterministic given the fetch log and store.
- Schema drift and unverified URL shapes fail loudly instead of being adapted.
- Amendment matching, SOI holdings, entity/instrument resolution, analytics, and UI remain
  later phases.
- A later phase that documents additional submissions-page URL shapes, or parsers for
  2012–2019 BDC Report layouts, must update `docs/SOURCE_SCHEMAS.md` before changing loaders.
