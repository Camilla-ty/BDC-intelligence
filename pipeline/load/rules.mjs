// Versioned rule definitions for Phase 2 (G-07, G-12). A rule's definition_sha256 is the SHA-256
// of its code and version over the files that implement it. Changing any of those files without
// bumping the version is refused at load time, so a rule version always names one behavior.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../lib/config.mjs";
import { lit, queryRows } from "../lib/db.mjs";

const COMMON = ["pipeline/lib/config.mjs"];

export const RULES = [
  { code: "parser.sec_datasets_page", kind: "PARSER", version: "1", files: ["pipeline/parse/pages.mjs", "pipeline/load/units/pages.mjs"],
    spec: "docs/SOURCE_SCHEMAS.md 3.2", description: "Extracts data set ZIP links and release labels from the BDC Data Sets page" },
  { code: "parser.sec_bdc_report_page", kind: "PARSER", version: "1", files: ["pipeline/parse/pages.mjs", "pipeline/load/units/pages.mjs"],
    spec: "docs/SOURCE_SCHEMAS.md 6, 6.1", description: "Extracts BDC Report CSV links, link-text years, and Updated labels" },
  { code: "parser.sec_bdc_report_csv", kind: "PARSER", version: "1", files: ["pipeline/parse/csv.mjs", "pipeline/parse/bdc-report-csv.mjs"],
    spec: "docs/SOURCE_SCHEMAS.md 6.1", description: "Parses BDC Report CSVs in the verified 2020-2026 layout only" },
  { code: "parser.sec_sub_tsv", kind: "PARSER", version: "1", files: ["pipeline/parse/sub.mjs", "pipeline/parse/zip.mjs"],
    spec: "docs/SOURCE_SCHEMAS.md 3.3, 4.1, 4.8", description: "Lands every ZIP member checksum and the SUB table exactly as received" },
  { code: "parser.sec_submissions_json", kind: "PARSER", version: "1", files: ["pipeline/parse/submissions.mjs"],
    spec: "docs/SOURCE_SCHEMAS.md 7, 7.1", description: "Checks submissions main-file and page structure; bodies are flattened by the database" },
  { code: "registry.projection", kind: "NORMALIZATION", version: "1",
    files: ["pipeline/load/sql.mjs", "pipeline/load/units/pages.mjs", "pipeline/load/units/bdc-report-csv.mjs", "pipeline/load/units/dataset-zip.mjs", "pipeline/load/units/submissions.mjs"],
    spec: "docs/SOURCE_SCHEMAS.md 7.2; docs/DATA_MODEL.md", description: "Projects registrants, filings, links, attributes, name history, and documents from raw rows and JSON values" },
  { code: "resolution.amends_unresolved", kind: "RESOLUTION", version: "1", files: ["pipeline/load/sql.mjs"],
    spec: "docs/SOURCE_SCHEMAS.md 11 (Q17)", description: "Records an UNRESOLVED AMENDS decision with no target for every /A filing; no amendment matching" },
  { code: "coverage.registry", kind: "COVERAGE", version: "1", files: ["pipeline/load/sql.mjs", "pipeline/load/units/dataset-zip.mjs", "pipeline/load/units/submissions.mjs"],
    spec: "docs/SOURCE_SCHEMAS.md 3.6, 7.1", description: "FILING_METADATA coverage per release and registrant; FILING_HISTORY coverage per registrant" },
  { code: "validation.registry_cross_source", kind: "VALIDATION", version: "1", files: ["pipeline/load/validate.mjs"],
    spec: "docs/DATA_MODEL.md", description: "Compares form, filing date, and registrant link between SUB and submissions; never picks a winner" },
  { code: "pipeline.registry_load", kind: "EXTRACTION", version: "1", files: ["pipeline/load/run.mjs", "pipeline/lib/db.mjs", "pipeline/lib/fetch-log.mjs", "pipeline/lib/store.mjs"],
    spec: "docs/adr/0011-registry-ingestion.md", description: "Offline loader: processes fetch-log entries in order, once per artifact and loader version" },
  { code: "parser.sec_soi_tsv", kind: "PARSER", version: "1", files: ["pipeline/parse/soi.mjs", "pipeline/parse/zip.mjs"],
    spec: "docs/SOURCE_SCHEMAS.md 3.3, 4.8, 5.1", description: "Lands soi.tsv exactly as received; preset header prefix is verified, extra dynamic columns are kept" },
  { code: "obs.projection.soi", kind: "NORMALIZATION", version: "2", files: ["pipeline/load/units/dataset-soi.mjs", "pipeline/load/sql.mjs"],
    spec: "docs/SOURCE_SCHEMAS.md 5; docs/DATA_MODEL.md", description: "Projects each SOI line to a row observation and identifier rows to position field values; does not resolve entities or instruments" },
  { code: "coverage.soi", kind: "COVERAGE", version: "2", files: ["pipeline/load/sql.mjs", "pipeline/load/units/dataset-soi.mjs"],
    spec: "docs/SOURCE_SCHEMAS.md 3.2, 3.3, 5.2", description: "SOI_HOLDINGS coverage per release and per registrant, independent of FILING_METADATA" },
  { code: "validation.soi_adsh_cik", kind: "VALIDATION", version: "2", files: ["pipeline/load/units/dataset-soi.mjs"],
    spec: "docs/SOURCE_SCHEMAS.md 5.3, 9", description: "Compares the SOI cik cell to explicit filing-registrant links; never uses the accession prefix; never picks a winner" },
  { code: "pipeline.soi_load", kind: "EXTRACTION", version: "1", files: ["pipeline/load/soi-run.mjs", "pipeline/lib/db.mjs", "pipeline/lib/fetch-log.mjs", "pipeline/lib/store.mjs"],
    spec: "docs/adr/0012-soi-ingestion.md", description: "Offline SOI loader: processes ZIP artifacts already loaded by registry:load, once per artifact and soi-load version" },
  { code: "norm.borrower_name", kind: "NORMALIZATION", version: "1",
    files: ["pipeline/normalize/borrower-name.mjs", "pipeline/load/p4-min.mjs"],
    spec: "docs/METHODOLOGY.md 7; docs/SOURCE_SCHEMAS.md 5.3",
    description: "Stores disclosed borrower-name text with NFC and edge-space trim; raw preserved; no suffix, casefold, fuzzy, or LLM rewrite" },
  { code: "norm.instrument_type", kind: "NORMALIZATION", version: "1",
    files: ["pipeline/normalize/instrument-type.mjs", "pipeline/load/p4-min.mjs"],
    spec: "docs/METHODOLOGY.md 7; docs/SOURCE_SCHEMAS.md 5.1",
    description: "Uses the disclosed Investment Type Axis member as-is; missing member is UNKNOWN; no invented type taxonomy" },
  { code: "pipeline.p5_golden", kind: "EXTRACTION", version: "1",
    files: ["pipeline/p5-golden-fetch.mjs", "pipeline/load/p5-min.mjs", "pipeline/lib/store.mjs", "pipeline/lib/fetch-log.mjs"],
    spec: "docs/SOURCE_SCHEMAS.md 8; docs/METHODOLOGY.md 7.3",
    description: "Fetches stored Golden filing_document URLs only and lands bytes as raw.artifact plus filing_document_artifact" },
  { code: "validation.golden_filing_string", kind: "VALIDATION", version: "1",
    files: ["pipeline/normalize/filing-text.mjs", "pipeline/load/p5-min.mjs"],
    spec: "docs/METHODOLOGY.md 7.3; docs/DATA_MODEL.md 5",
    description: "Exact-string presence of Golden identifier and raw field values in the fetched filing document; no iXBRL parser; no LLM match" },
  { code: "resolution.entity_exact_normalized_name", kind: "RESOLUTION", version: "1",
    files: ["pipeline/normalize/entity-name-match.mjs", "pipeline/load/p6-min.mjs"],
    spec: "docs/METHODOLOGY.md 7.4; docs/adr/0006-identity-layers-and-resolution-states.md",
    description: "MATCHED only when norm.borrower_name v1 text is exactly equal; SYSTEM_RULE; no fuzzy, suffix rewrite, or LLM" },
  { code: "resolution.entity_near_name_candidate", kind: "RESOLUTION", version: "1",
    files: ["pipeline/normalize/entity-name-match.mjs", "pipeline/load/p6-min.mjs"],
    spec: "docs/METHODOLOGY.md 7.4; docs/adr/0006-identity-layers-and-resolution-states.md",
    description: "Corporate-suffix / Holdco token difference generates a LEGAL_ENTITY candidate and UNRESOLVED decision; never MATCHED" },
  { code: "resolution.instrument_exact_identifier_and_type", kind: "RESOLUTION", version: "1",
    files: ["pipeline/normalize/instrument-identity.mjs", "pipeline/load/p7-min.mjs"],
    spec: "docs/METHODOLOGY.md 7.5; docs/adr/0006-identity-layers-and-resolution-states.md",
    description: "MATCHED instrument only when identifier text is exact and Investment Type Axis is a non-empty REPORTED member; SYSTEM_RULE; no fuzzy or LLM" },
  { code: "resolution.instrument_unknown_attributes", kind: "RESOLUTION", version: "1",
    files: ["pipeline/normalize/instrument-identity.mjs", "pipeline/load/p7-min.mjs"],
    spec: "docs/METHODOLOGY.md 7.5; docs/adr/0006-identity-layers-and-resolution-states.md",
    description: "Missing or empty Investment Type Axis member leaves instrument identity UNRESOLVED; never MATCHED from legal entity alone" },
  { code: "resolution.position_same_registrant_and_instrument", kind: "RESOLUTION", version: "1",
    files: ["pipeline/normalize/instrument-identity.mjs", "pipeline/load/p7-min.mjs"],
    spec: "docs/METHODOLOGY.md 7.5; docs/adr/0006-identity-layers-and-resolution-states.md",
    description: "MATCHED continuity only for the same LINKED filing registrant and same MATCHED instrument; different BDCs stay separate series" },
  { code: "resolution.position_unresolved_without_instrument", kind: "RESOLUTION", version: "1",
    files: ["pipeline/normalize/instrument-identity.mjs", "pipeline/load/p7-min.mjs"],
    spec: "docs/METHODOLOGY.md 7.5; docs/adr/0006-identity-layers-and-resolution-states.md",
    description: "Continuity stays UNRESOLVED when instrument identity or the filing registrant is not uniquely established; missing dates are not observed, never zero" },
  { code: "validation.golden_gate", kind: "VALIDATION", version: "4",
    files: ["pipeline/golden-gate.mjs", "pipeline/load/golden-gate.mjs", "pipeline/normalize/golden-observation-count.mjs"],
    spec: "docs/METHODOLOGY.md 8; docs/DATA_MODEL.md 11",
    description: "Phase 8 Golden Borrower Gate: evaluates the thin-slice chain and derived.golden_observation_count v1; does not MATCH instruments or derive COST/FV" },
  { code: "event.registrant_first_observed_name", kind: "DERIVATION", version: "1",
    unknownInputPolicy: "REJECT_UNKNOWN_INPUTS",
    files: ["pipeline/normalize/observation-events.mjs", "pipeline/load/p9-min.mjs"],
    spec: "docs/METHODOLOGY.md 9.1",
    description: "Earliest reported_date observation for a LINKED filing registrant in an explicit list; not an instrument, exposure, or valuation event" },
];

export function ruleDefinitionSha(rule) {
  const hash = createHash("sha256").update(`${rule.code} v${rule.version}\n`);
  for (const f of [...new Set([...COMMON, ...rule.files])].sort()) {
    hash.update(`${f}\n`).update(readFileSync(path.join(REPO_ROOT, f)));
  }
  return hash.digest("hex");
}

function unknownPolicySql(rule) {
  if (rule.kind !== "DERIVATION") return "NULL::ops.unknown_input_policy";
  if (!rule.unknownInputPolicy) throw new Error(`derivation rule ${rule.code} requires unknownInputPolicy`);
  return `${lit(rule.unknownInputPolicy)}::ops.unknown_input_policy`;
}

export function registerRules(database, runId) {
  const defs = RULES.map((r) => ({ ...r, sha: ruleDefinitionSha(r) }));
  const values = defs.map((r) => `(${lit(r.code)}, ${lit(r.kind)}::ops.rule_kind, ${lit(r.version)}, ${lit(r.sha)}, ${lit(r.spec)}, ${lit(r.description)}, ${unknownPolicySql(r)})`).join(",\n  ");
  const rows = queryRows(database, `
BEGIN;
INSERT INTO ops.rule_version (rule_code, rule_kind, version, definition_sha256, spec_reference, description, unknown_input_policy, created_by)
SELECT v.c, v.k, v.ver, v.sha, v.spec, v.d, v.pol, 'pipeline registry:load'
FROM (VALUES
  ${values}
) AS v (c, k, ver, sha, spec, d, pol)
WHERE NOT EXISTS (SELECT 1 FROM ops.rule_version r WHERE r.rule_code = v.c AND r.version = v.ver);
SELECT r.rule_code, r.id, r.definition_sha256 FROM ops.rule_version r
WHERE (r.rule_code, r.version) IN (${defs.map((d) => `(${lit(d.code)}, ${lit(d.version)})`).join(", ")})
ORDER BY r.rule_code;
COMMIT;`);
  const ids = {};
  for (const [code, id, sha] of rows) {
    const def = defs.find((d) => d.code === code);
    if (def.sha !== sha) {
      throw new Error(`rule ${code} v${def.version} changed without a version bump (stored definition differs); bump the version in pipeline/load/rules.mjs`);
    }
    ids[code] = Number(id);
  }
  queryRows(database, `INSERT INTO ops.run_rule_version (run_id, rule_version_id)
SELECT ${runId}, id FROM ops.rule_version WHERE id IN (${Object.values(ids).join(", ")}) ORDER BY id;`);
  return ids;
}
