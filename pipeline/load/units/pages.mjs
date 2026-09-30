// Load units for the Data Sets page (releases and listings) and the BDC Report page (editions).
// Evidence is the HTML anchor (href) on the page artifact, at DISCOVERY level.

import { copyBlock, lit, num } from "../../lib/db.mjs";
import { parseBdcReportPage, parseDatasetsPage } from "../../parse/pages.mjs";
import { artifactBlock, finishBlock, prelude, streamBlock } from "../sql.mjs";

function anchorEvidence(runId) {
  return `
CREATE TEMP TABLE _lev (id bigint, html_anchor text) ON COMMIT DROP;
WITH ins AS (
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_anchor, run_id)
  SELECT 'DISCOVERY'::ref.evidence_level, pg_temp.ctx('artifact'), 'HTML_ANCHOR'::ref.locator_type, l.href, ${num(runId)} FROM _links l ORDER BY l.ord
  RETURNING id, html_anchor)
INSERT INTO _lev SELECT * FROM ins;
`;
}

export function datasetsPageUnit({ entry, body, runId, rules }) {
  const { links, duplicates } = parseDatasetsPage(body.toString("utf8"));
  const rows = links.map((l, i) => [l.href, l.label, l.linkText, l.cadence, l.windowStart, l.windowEnd, i + 1]);
  const sql = `${prelude()}
${artifactBlock("artifact", entry, runId)}
${streamBlock("artifact")}
CREATE TEMP TABLE _links (href text, label text, link_text text, cadence text, window_start date, window_end date, ord integer) ON COMMIT DROP;
${copyBlock("_links", ["href", "label", "link_text", "cadence", "window_start", "window_end", "ord"], rows)}
${anchorEvidence(runId)}
CREATE TEMP TABLE _rel_new ON COMMIT DROP AS
SELECT l.* FROM _links l
WHERE NOT EXISTS (SELECT 1 FROM registry.dataset_release r WHERE r.dataset_code = 'SEC_BDC_DATA_SETS' AND r.release_label = l.label);
INSERT INTO registry.dataset_release (dataset_code, release_label, cadence, window_start, window_end, run_id, evidence_id)
SELECT 'SEC_BDC_DATA_SETS', l.label, l.cadence, l.window_start, l.window_end, ${num(runId)}, e.id
FROM _rel_new l JOIN _lev e ON e.html_anchor = l.href ORDER BY l.ord;
INSERT INTO registry.dataset_release_listing (dataset_release_id, page_artifact_id, link_href, link_text, evidence_id, rule_version_id, run_id)
SELECT r.id, pg_temp.ctx('artifact'), l.href, l.link_text, e.id, ${num(rules["parser.sec_datasets_page"])}, ${num(runId)}
FROM _links l JOIN _lev e ON e.html_anchor = l.href
JOIN registry.dataset_release r ON r.dataset_code = 'SEC_BDC_DATA_SETS' AND r.release_label = l.label
ORDER BY l.ord;
INSERT INTO _counts VALUES ('release_links', ${links.length}), ('duplicate_links_ignored', ${duplicates});
INSERT INTO _counts SELECT 'releases_added', count(*) FROM _rel_new;
INSERT INTO _counts
SELECT 'release_listings_absent_from_newer_source', count(DISTINCT x.dataset_release_id)
FROM registry.dataset_release_listing x
WHERE x.page_artifact_id IN (SELECT id FROM _stream) AND x.page_artifact_id <> pg_temp.ctx('artifact')
  AND x.dataset_release_id NOT IN (SELECT r.id FROM registry.dataset_release r JOIN _links l ON l.label = r.release_label);
${finishBlock({ keys: ["artifact"], ruleId: rules["pipeline.registry_load"], runId, detail: "Data Sets page links recorded" })}`;
  return { sql, links };
}

export function bdcReportPageUnit({ entry, body, runId, rules }) {
  const { links, duplicates } = parseBdcReportPage(body.toString("utf8"));
  const rows = links.map((l, i) => [l.href, l.url, l.yearLabel, l.reportYear, l.updatedLabel, i + 1]);
  const sql = `${prelude()}
${artifactBlock("artifact", entry, runId)}
CREATE TEMP TABLE _links (href text, url text, year_label text, report_year integer, updated_label text, ord integer) ON COMMIT DROP;
${copyBlock("_links", ["href", "url", "year_label", "report_year", "updated_label", "ord"], rows)}
${anchorEvidence(runId)}
INSERT INTO registry.bdc_report_edition (page_artifact_id, link_href, csv_url, year_label_raw, report_year, updated_label_raw,
    evidence_id, rule_version_id, run_id)
SELECT pg_temp.ctx('artifact'), l.href, l.url, l.year_label, l.report_year, l.updated_label, e.id,
       ${num(rules["parser.sec_bdc_report_page"])}, ${num(runId)}
FROM _links l JOIN _lev e ON e.html_anchor = l.href ORDER BY l.ord;
INSERT INTO _counts VALUES ('report_csv_links', ${links.length}), ('duplicate_links_ignored', ${duplicates}),
  ('links_without_updated_label', ${links.filter((l) => l.updatedLabel === null).length});
${finishBlock({ keys: ["artifact"], ruleId: rules["pipeline.registry_load"], runId, detail: "BDC Report page CSV links recorded" })}`;
  return { sql, links };
}
