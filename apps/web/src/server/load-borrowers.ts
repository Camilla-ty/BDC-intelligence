import { assertListingFields, type ObservationRow } from "@/lib/borrowers";
import { executeSql } from "@/server/sql-text";

// Reads registry.borrower_observation_listing as bdc_reader. The SQL is unchanged.
// DATABASE_URL selects the hosted client; otherwise the local container is used.

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

export async function loadBorrowerObservations(): Promise<ListingResult> {
  const executed = await executeSql(LISTING_SQL);
  if (!executed.ok) {
    return { rows: [], error: "The borrower listing could not be read." };
  }
  const line = executed.text;
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
