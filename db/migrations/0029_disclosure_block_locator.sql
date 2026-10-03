-- 0029 disclosure-block locator types.
-- Enum values only. PostgreSQL cannot use a new enum value in the transaction that
-- adds it, and each migration file runs in one transaction. Migration 0030 uses
-- these values. This file inserts no evidence rows.

ALTER TYPE ref.locator_type ADD VALUE 'DISCLOSURE_BLOCK';
ALTER TYPE ref.locator_type ADD VALUE 'HTML_TABLE_CELL';
