-- 0003 raw landing: source bytes and physical rows, stored exactly as received (G-11, G-12).
-- Nothing here interprets a value. A row is identified only by where it came from
-- (table load + line number); SOI has no natural key and none is assumed.

CREATE TABLE raw.artifact (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_url        text NOT NULL CHECK (source_url ~ '^https://(www|data|xbrl)\.sec\.gov/'),
  final_url         text NOT NULL CHECK (final_url ~ '^https://(www|data|xbrl)\.sec\.gov/'),
  source_type_code  text NOT NULL REFERENCES ref.source_type (code),
  http_status       integer NOT NULL CHECK (http_status BETWEEN 100 AND 599),
  content_type      text,
  last_modified     text,
  etag              text,
  byte_size         bigint NOT NULL CHECK (byte_size >= 0),
  sha256            text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  retrieved_at      timestamptz NOT NULL,
  storage_key       text NOT NULL CHECK (btrim(storage_key) <> ''),
  run_id            bigint NOT NULL REFERENCES ops.run (id),
  recorded_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_url, sha256)
);
COMMENT ON TABLE raw.artifact IS 'One downloaded byte stream. A SEC refresh of the same URL (new SHA-256) is a new artifact, never an overwrite.';
COMMENT ON COLUMN raw.artifact.last_modified IS 'HTTP Last-Modified header exactly as received.';
COMMENT ON COLUMN raw.artifact.storage_key IS 'Where the immutable bytes are kept (local cache path or object key). No storage vendor is chosen yet.';

CREATE TABLE raw.artifact_lineage (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  artifact_id           bigint NOT NULL UNIQUE REFERENCES raw.artifact (id),
  previous_artifact_id  bigint NOT NULL REFERENCES raw.artifact (id),
  basis                 text NOT NULL CHECK (basis IN ('SAME_SOURCE_URL')),
  run_id                bigint NOT NULL REFERENCES ops.run (id),
  recorded_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (artifact_id <> previous_artifact_id)
);

CREATE FUNCTION raw.check_artifact_lineage() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM raw.artifact a JOIN raw.artifact p ON p.id = NEW.previous_artifact_id
    WHERE a.id = NEW.artifact_id AND a.source_url = p.source_url AND a.sha256 <> p.sha256
      AND a.retrieved_at >= p.retrieved_at
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'artifact lineage requires the same source_url, a different sha256, and a later retrieval';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER check_artifact_lineage BEFORE INSERT ON raw.artifact_lineage
  FOR EACH ROW EXECUTE FUNCTION raw.check_artifact_lineage();

CREATE TABLE raw.artifact_member (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  artifact_id  bigint NOT NULL REFERENCES raw.artifact (id),
  member_path  text NOT NULL CHECK (btrim(member_path) <> ''),
  byte_size    bigint NOT NULL CHECK (byte_size >= 0),
  sha256       text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  run_id       bigint NOT NULL REFERENCES ops.run (id),
  recorded_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (artifact_id, member_path),
  UNIQUE (id, artifact_id)
);

CREATE TABLE raw.table_load (
  id                           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  artifact_id                  bigint NOT NULL REFERENCES raw.artifact (id),
  artifact_member_id           bigint,
  table_code                   text NOT NULL REFERENCES ref.dataset_table (code),
  delimiter                    text NOT NULL CHECK (delimiter IN (E'\t', ',')),
  header                       text[] NOT NULL CHECK (cardinality(header) >= 1),
  header_sha256                text NOT NULL CHECK (header_sha256 ~ '^[0-9a-f]{64}$'),
  parser_rule_version_id       bigint NOT NULL REFERENCES ops.rule_version (id),
  row_count                    bigint NOT NULL CHECK (row_count >= 0),
  field_count_mismatch_count   bigint NOT NULL CHECK (field_count_mismatch_count BETWEEN 0 AND row_count),
  parse_status                 ref.parse_status NOT NULL,
  run_id                       bigint NOT NULL REFERENCES ops.run (id),
  recorded_at                  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (artifact_member_id, artifact_id) REFERENCES raw.artifact_member (id, artifact_id),
  UNIQUE NULLS NOT DISTINCT (artifact_id, artifact_member_id, parser_rule_version_id)
);
COMMENT ON TABLE raw.table_load IS 'One parse of one tabular member. header is the exact header row, in order.';

CREATE TABLE raw.tabular_row (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_load_id    bigint NOT NULL REFERENCES raw.table_load (id),
  line_number      bigint NOT NULL CHECK (line_number >= 1),
  raw_line         text NOT NULL,
  raw_line_sha256  text NOT NULL CHECK (raw_line_sha256 ~ '^[0-9a-f]{64}$'),
  cells            text[] NOT NULL,
  field_count      integer NOT NULL CHECK (field_count >= 0),
  parse_status     ref.parse_status NOT NULL CHECK (parse_status IN ('OK', 'FIELD_COUNT_MISMATCH')),
  run_id           bigint NOT NULL REFERENCES ops.run (id),
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (table_load_id, line_number),
  CHECK (cardinality(cells) = field_count)
);
COMMENT ON TABLE raw.tabular_row IS 'One physical line of a TSV/CSV member, exactly as received. (table_load_id, line_number) is a location, not a business key.';
COMMENT ON COLUMN raw.tabular_row.cells IS 'Cells aligned by position with raw.table_load.header. For tab-delimited loads, cells must equal the raw line split on tabs.';

-- Losslessness: the hash must match the stored line, tab-delimited cells must be the exact
-- split of the line, and the parse status must reflect the header width.
CREATE FUNCTION raw.check_tabular_row() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  tl raw.table_load;
BEGIN
  SELECT * INTO tl FROM raw.table_load WHERE id = NEW.table_load_id;
  IF encode(sha256(convert_to(NEW.raw_line, 'UTF8')), 'hex') <> NEW.raw_line_sha256 THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1', MESSAGE = 'raw_line_sha256 does not match raw_line';
  END IF;
  IF tl.delimiter = E'\t' AND NEW.cells IS DISTINCT FROM string_to_array(NEW.raw_line, E'\t') THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1', MESSAGE = 'cells must be the exact tab split of raw_line';
  END IF;
  IF (NEW.parse_status = 'OK') <> (NEW.field_count = cardinality(tl.header)) THEN
    RAISE EXCEPTION USING ERRCODE = 'BDCI1',
      MESSAGE = 'parse_status must be OK exactly when field_count equals the header width';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER check_tabular_row BEFORE INSERT ON raw.tabular_row
  FOR EACH ROW EXECUTE FUNCTION raw.check_tabular_row();

CREATE INDEX tabular_row_sha_idx ON raw.tabular_row (raw_line_sha256);

SELECT ops.apply_append_only_to_all();
