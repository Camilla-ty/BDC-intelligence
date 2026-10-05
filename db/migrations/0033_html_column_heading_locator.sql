-- 0033 column-heading locator type.
-- Enum values only. PostgreSQL cannot use a new enum value in the transaction that
-- adds it, and each migration file runs in one transaction. Migration 0034 uses
-- this value. This file inserts no evidence rows.

ALTER TYPE ref.locator_type ADD VALUE 'HTML_COLUMN_HEADING';
