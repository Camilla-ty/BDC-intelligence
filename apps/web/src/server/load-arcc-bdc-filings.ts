// Phase 1-B: read accession → filing_id pairs from admin.filing_inventory.
// No registry.* queries from the web layer. No writes.

import type { BdcFlowFilingRef } from "@/lib/sec-coverage-reconcile";
import { ARCC_CIK } from "@/server/sec/config";
import { executeSql } from "@/server/sql-text";

const READ_ERROR = "The BDC Flow filing inventory could not be read for reconciliation.";

export type SqlExecutor = (sql: string) => Promise<{ ok: true; text: string } | { ok: false; text?: string }>;

function escapeLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function adminSql(body: string): string {
  return `SET ROLE admin_reader;\nSET statement_timeout = '30s';\n${body}\nRESET ROLE;\n`;
}

/** Numeric CIK for array membership against admin.filing_inventory.registrant_ciks (bigint[]). */
export function cikNumeric(cik: string): number {
  const n = Number(cik.replace(/^0+/, "") || "0");
  if (!Number.isInteger(n) || n < 0) throw new Error(`not a CIK: ${cik}`);
  return n;
}

function parseRefs(json: unknown): BdcFlowFilingRef[] | null {
  if (!Array.isArray(json)) return null;
  const refs: BdcFlowFilingRef[] = [];
  for (const item of json) {
    if (item == null || typeof item !== "object" || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    const filingId = typeof row.filing_id === "number" ? row.filing_id : Number(row.filing_id);
    const accession = row.accession_number;
    if (!Number.isInteger(filingId) || filingId <= 0) return null;
    if (typeof accession !== "string" || accession.trim() === "") return null;
    refs.push({ filingId, accessionNumber: accession });
  }
  return refs;
}

/**
 * Load BDC Flow filing_id for exact SEC accession matches via admin.filing_inventory.
 * Call only after requireAdmin(). Does not classify unmatched SEC rows — that is pure reconcile.
 */
export async function loadBdcFlowFilingRefsByAccession(
  accessions: ReadonlyArray<string>,
  options: { executeSqlImpl?: SqlExecutor } = {},
): Promise<{ refs: BdcFlowFilingRef[]; error: string | null }> {
  if (accessions.length === 0) return { refs: [], error: null };

  const unique = [...new Set(accessions)];
  const literals = unique.map((a) => `'${escapeLiteral(a)}'`).join(", ");
  const run = options.executeSqlImpl ?? executeSql;
  const executed = await run(adminSql(`
SELECT coalesce(json_agg(json_build_object(
  'filing_id', filing_id,
  'accession_number', accession_number
) ORDER BY accession_number, filing_id), '[]'::json)
FROM admin.filing_inventory
WHERE accession_number IN (${literals});
`));
  if (!executed.ok) return { refs: [], error: READ_ERROR };
  let json: unknown;
  try {
    json = JSON.parse(executed.text === "" ? "null" : executed.text);
  } catch {
    return { refs: [], error: READ_ERROR };
  }
  const refs = parseRefs(json);
  if (refs == null) return { refs: [], error: READ_ERROR };
  return { refs, error: null };
}

/**
 * Count BDC Flow filings linked to the ARCC registrant CIK that are not in the SEC coverage set.
 * Informative only — not mixed into the SEC coverage table.
 */
export async function loadArccBdcFlowOnlyCount(
  secAccessions: ReadonlyArray<string>,
  options: { cik?: string; executeSqlImpl?: SqlExecutor } = {},
): Promise<{ count: number | null; error: string | null }> {
  const cikNum = cikNumeric(options.cik ?? ARCC_CIK);
  const unique = [...new Set(secAccessions)];
  const secArraySql =
    unique.length === 0
      ? "ARRAY[]::text[]"
      : `ARRAY[${unique.map((a) => `'${escapeLiteral(a)}'`).join(", ")}]::text[]`;

  const run = options.executeSqlImpl ?? executeSql;
  const executed = await run(adminSql(`
SELECT count(*)::bigint
FROM admin.filing_inventory
WHERE ${cikNum} = ANY(registrant_ciks)
  AND NOT (accession_number = ANY(${secArraySql}));
`));
  if (!executed.ok) return { count: null, error: READ_ERROR };
  const count = Number(executed.text.trim());
  if (!Number.isFinite(count) || count < 0 || !Number.isInteger(count)) {
    return { count: null, error: READ_ERROR };
  }
  return { count, error: null };
}
