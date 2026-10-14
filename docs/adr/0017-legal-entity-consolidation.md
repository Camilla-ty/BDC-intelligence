# 0017. Legal-entity consolidation for canonical Borrower ID

## Status

Accepted

## Context

Each real-world company should resolve to one stable Borrower ID. The master key is
already `identity.legal_entity.id` (ADR 0006, G-14). Exact company-cell matching can
reuse an entity for new observations, but duplicate legal-entity UUIDs can still arise.
Merging must never delete UUIDs or rewrite historical entity-resolution decisions (G-10).

## Decision

- Canonical Borrower ID remains `identity.legal_entity.id`. No second master table.
- Consolidation is an append-only `resolution.legal_entity_consolidation_decision`
  with a single current head per `from_legal_entity_id`.
- `PROBABLE` / `CONSOLIDATION_PROPOSED` is a pending proposal and does not change the
  effective approved mapping. When a proposal supersedes an existing `MATCHED` head,
  `resolution.approved_consolidation_target` keeps the prior `MATCHED` target until
  explicit approval, rejection (restore), or reversal.
- `MATCHED` / `CONSOLIDATION_APPROVED` is the effective approved edge followed by
  `resolution.canonical_legal_entity(uuid)`.
- Reversal inserts `REJECTED` / `CONSOLIDATION_REVERSED` with a null target; history is kept.
- Consolidation table writes are helper-only (`resolution_writer`); `bdc_pipeline_writer`
  cannot INSERT directly.
- Only `HUMAN_REVIEW` actors may write consolidations, via `resolution_writer` helpers.
- Structured `evidence.evidence` and researcher citations are both allowed and kept distinct.
- Borrower detail URLs for an approved source UUID redirect to the canonical UUID.
- Automatic name/alias/fuzzy/LLM consolidation is out of scope.

## Consequences

- Existing duplicate companies are not auto-merged; researchers propose and approve explicitly.
- Period-comparison and listing consumers that still key only on matched LE must be migrated
  before production reliance on consolidated identity across every surface.
- Hosted database login roles must be granted `resolution_writer` membership before Admin
  writes succeed (same operational pattern as `review_writer`).
