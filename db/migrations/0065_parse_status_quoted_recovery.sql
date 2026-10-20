-- 0065: add QUOTED_RECOVERY to parse_status (ADR 0019).
-- PostgreSQL cannot use a newly added enum value as a typed literal in the same
-- transaction. Constraints, the sidecar, and triggers that name QUOTED_RECOVERY
-- belong in the next migration.

ALTER TYPE ref.parse_status ADD VALUE 'QUOTED_RECOVERY';
