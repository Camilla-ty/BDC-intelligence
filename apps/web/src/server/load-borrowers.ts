import { spawnSync } from "node:child_process";
import { assertListingFields, type ObservationRow } from "@/lib/borrowers";

// ENGINEERING DECISION: Phase 10-min reads registry.borrower_observation_listing as bdc_reader
// through the local PostgreSQL container. A hosted DATABASE_URL client is FUTURE / NOT MVP.
const CONTAINER = process.env.BDC_DB_CONTAINER ?? "bdc-intelligence-pg";
const DATABASE = process.env.BDC_DATABASE ?? "bdc_local";

const LISTING_SQL = `
SET ROLE bdc_reader;
SET statement_timeout = '30s';
SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
FROM (
  SELECT legal_entity_id::text,
         alias_text,
         verification_state,
         entity_resolution_state,
         entity_resolution_method,
         reported_date::text,
         accession_number,
         document_name,
         document_url,
         registrant_link_status,
         registrant_cik,
         registrant_name,
         instrument_resolution_state,
         instrument_resolution_method,
         instrument_type_state,
         event_code,
         observation_evidence_level,
         name_validation_outcome
  FROM registry.borrower_observation_listing
  ORDER BY alias_text, reported_date, accession_number
) t;
RESET ROLE;
`;

export type ListingResult = { rows: ObservationRow[]; error: string | null };

export function loadBorrowerObservations(): ListingResult {
  const result = spawnSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", DATABASE, "-At"],
    { input: LISTING_SQL, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    return { rows: [], error: "The borrower listing could not be read." };
  }
  const line = (result.stdout ?? "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(line === "" ? "[]" : line);
  } catch {
    return { rows: [], error: "The borrower listing could not be read." };
  }
  if (!Array.isArray(parsed)) return { rows: [], error: "The borrower listing could not be read." };
  const rows: ObservationRow[] = [];
  for (const item of parsed) {
    if (item == null || typeof item !== "object") {
      return { rows: [], error: "The borrower listing could not be read." };
    }
    try {
      assertListingFields(item);
    } catch {
      return { rows: [], error: "The borrower listing could not be read." };
    }
    const row = item as ObservationRow;
    if (typeof row.legal_entity_id !== "string" || typeof row.alias_text !== "string") {
      return { rows: [], error: "The borrower listing could not be read." };
    }
    rows.push(row);
  }
  return { rows, error: null };
}
