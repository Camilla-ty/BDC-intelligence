-- 0004 registry: SEC registrants, filings, filing documents, dataset releases.
-- G-09: CIK identifies the SEC registrant and appears only in registry.registrant.
-- A filing is identified by its accession number. Its registrant comes only from explicit
-- filing metadata (registry.filing_registrant_link), never from the accession prefix, which
-- identifies the submitter (possibly a filer agent). No accession-prefix column exists.
-- Evidence columns for these tables are added in 0005, after evidence.evidence exists.

CREATE TABLE registry.registrant (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cik          bigint NOT NULL UNIQUE CHECK (cik BETWEEN 1 AND 9999999999),
  run_id       bigint NOT NULL REFERENCES ops.run (id),
  recorded_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE registry.registrant IS 'An SEC registrant (filing entity, typically a BDC). Never a borrower, legal entity, or economic group.';
COMMENT ON COLUMN registry.registrant.cik IS 'Stored as a number; sources show it unpadded (data sets) or zero-padded to 10 digits (BDC Report, submissions URL).';

CREATE TABLE registry.registrant_attribute_observation (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  registrant_id     bigint NOT NULL REFERENCES registry.registrant (id),
  attribute_code    text NOT NULL REFERENCES ref.registrant_attribute (code),
  raw_value         text NOT NULL,
  normalized_value  text,
  source_as_of      date,
  rule_version_id   bigint NOT NULL REFERENCES ops.rule_version (id),
  run_id            bigint NOT NULL REFERENCES ops.run (id),
  supersedes_id     bigint REFERENCES registry.registrant_attribute_observation (id),
  supersede_reason  text,
  recorded_at       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE registry.registrant_attribute_observation IS 'Names, file numbers, tickers change over time and differ by source; each value is an observation.';
SELECT ops.add_supersession('registry.registrant_attribute_observation', 'registrant_id,attribute_code', 'multi');

CREATE TABLE registry.dataset_release (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dataset_code    text NOT NULL CHECK (dataset_code IN ('SEC_BDC_DATA_SETS')),
  release_label   text NOT NULL CHECK (release_label ~ '^[0-9]{4}(q[1-4]|_[0-9]{2})$'),
  cadence         text NOT NULL CHECK (cadence IN ('MONTHLY', 'QUARTERLY')),
  window_start    date NOT NULL,
  window_end      date NOT NULL,
  run_id          bigint NOT NULL REFERENCES ops.run (id),
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dataset_code, release_label),
  CHECK (window_start <= window_end),
  CHECK ((cadence = 'QUARTERLY') = (release_label ~ 'q[1-4]$'))
);
COMMENT ON TABLE registry.dataset_release IS 'A data set file identity (for example 2026_08). The window is a filing-date window, not a reporting period.';

CREATE TABLE registry.dataset_release_artifact (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dataset_release_id  bigint NOT NULL REFERENCES registry.dataset_release (id),
  artifact_id         bigint NOT NULL REFERENCES raw.artifact (id),
  run_id              bigint NOT NULL REFERENCES ops.run (id),
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dataset_release_id, artifact_id)
);
COMMENT ON TABLE registry.dataset_release_artifact IS 'Every artifact version that has served a release; refreshes add rows.';

CREATE TABLE registry.filing (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  accession_number  text NOT NULL UNIQUE CHECK (accession_number ~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$'),
  run_id            bigint NOT NULL REFERENCES ops.run (id),
  recorded_at       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE registry.filing IS 'An EDGAR filing, identified by accession number. The first ten digits identify the submitter, never the registrant.';

CREATE TABLE registry.filing_registrant_link (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  filing_id         bigint NOT NULL REFERENCES registry.filing (id),
  registrant_id     bigint NOT NULL REFERENCES registry.registrant (id),
  link_source       ref.filing_link_source NOT NULL,
  run_id            bigint NOT NULL REFERENCES ops.run (id),
  supersedes_id     bigint REFERENCES registry.filing_registrant_link (id),
  supersede_reason  text,
  recorded_at       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE registry.filing_registrant_link IS 'Filing to registrant, only from explicit filing metadata. Several links (co-registrants or disagreeing sources) may coexist; none is chosen silently.';
SELECT ops.add_supersession('registry.filing_registrant_link', 'filing_id', 'multi');

CREATE TABLE registry.filing_attribute_observation (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  filing_id             bigint NOT NULL REFERENCES registry.filing (id),
  attribute_code        text NOT NULL REFERENCES ref.filing_attribute (code),
  raw_value             text NOT NULL,
  normalized_text       text,
  normalized_date       date,
  normalized_timestamp  timestamptz,
  value_state           ref.value_state NOT NULL CHECK (value_state IN ('REPORTED', 'UNKNOWN', 'NOT_APPLICABLE')),
  rule_version_id       bigint NOT NULL REFERENCES ops.rule_version (id),
  run_id                bigint NOT NULL REFERENCES ops.run (id),
  supersedes_id         bigint REFERENCES registry.filing_attribute_observation (id),
  supersede_reason      text,
  recorded_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(normalized_text, normalized_date, normalized_timestamp) <= 1),
  CHECK (value_state = 'REPORTED'
         OR num_nonnulls(normalized_text, normalized_date, normalized_timestamp) = 0)
);
COMMENT ON TABLE registry.filing_attribute_observation IS 'Form, dates, fiscal focus, prevrpt, and document names per source. Sources may disagree side by side.';
SELECT ops.add_supersession('registry.filing_attribute_observation', 'filing_id,attribute_code', 'multi');

CREATE TABLE registry.filing_document (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  filing_id        bigint NOT NULL REFERENCES registry.filing (id),
  document_name    text NOT NULL CHECK (btrim(document_name) <> ''),
  document_url     text NOT NULL CHECK (document_url ~ '^https://www\.sec\.gov/Archives/edgar/data/'),
  named_by         text NOT NULL CHECK (named_by IN ('FILING_INDEX_JSON', 'SUBMISSIONS_PRIMARY_DOCUMENT', 'SOI_INLINEURL')),
  rule_version_id  bigint NOT NULL REFERENCES ops.rule_version (id),
  run_id           bigint NOT NULL REFERENCES ops.run (id),
  recorded_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE registry.filing_document_artifact (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  filing_document_id  bigint NOT NULL REFERENCES registry.filing_document (id),
  artifact_id         bigint NOT NULL REFERENCES raw.artifact (id),
  run_id              bigint NOT NULL REFERENCES ops.run (id),
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (filing_document_id, artifact_id)
);

CREATE TABLE registry.filing_relationship_decision (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  filing_id          bigint NOT NULL REFERENCES registry.filing (id),
  relationship_type  text NOT NULL CHECK (relationship_type IN ('AMENDS')),
  related_filing_id  bigint REFERENCES registry.filing (id),
  state              ref.resolution_state NOT NULL,
  method             text NOT NULL CHECK (btrim(method) <> ''),
  rationale          text NOT NULL CHECK (btrim(rationale) <> ''),
  actor_kind         ref.actor_kind NOT NULL,
  decided_by         text NOT NULL CHECK (btrim(decided_by) <> ''),
  decided_at         timestamptz NOT NULL,
  rule_version_id    bigint NOT NULL REFERENCES ops.rule_version (id),
  run_id             bigint NOT NULL REFERENCES ops.run (id),
  supersedes_id      bigint REFERENCES registry.filing_relationship_decision (id),
  supersede_reason   text,
  recorded_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (state = 'UNRESOLVED' OR related_filing_id IS NOT NULL),
  CHECK (related_filing_id IS DISTINCT FROM filing_id)
);
COMMENT ON TABLE registry.filing_relationship_decision IS 'Whether a filing amends another. Supersession detection is OPEN QUESTION Q17; UNRESOLVED is the expected default.';
SELECT ops.add_supersession('registry.filing_relationship_decision', 'filing_id,relationship_type', 'single_chain');

SELECT ops.apply_append_only_to_all();
