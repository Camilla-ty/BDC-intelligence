# 0004. Evidence-first source hierarchy

## Status

Accepted

## Context

The product is only useful if its figures can be trusted and traced. Structured SEC
datasets are convenient for scale but are derived from filings and can contain extraction
errors. Language models can produce plausible but unsupported output.

## Decision

- The original SEC/EDGAR filing is the authoritative evidence for what was disclosed.
- Structured SEC datasets are a scalable ingestion layer, validated against filings for
  important facts.
- Our calculations are derived analytics and are always labeled as derived.
- LLM output is never a source of financial facts.
- Only SEC endpoints, files, and fields documented from official SEC sources are used (G-03).
- Every material fact retains provenance to its source document (G-12).
- Where evidence is missing, the value is Unknown (G-01, G-04), and missing coverage is
  never presented as zero (G-05).
- No fabricated financial data is used anywhere (G-02), with a narrow exception for
  obviously fake values in unit tests of arithmetic.

## Consequences

- Some fields will be Unknown in production. This is expected and visible.
- Source-schema documentation must exist before any ingestion code is written.
