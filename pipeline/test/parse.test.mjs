import test from "node:test";
import assert from "node:assert/strict";
import { padCik, submissionsPageUrl, submissionsUrl, VERIFIED_BDC_REPORT_HEADER, VERIFIED_SOI_PRESET_HEADER } from "../lib/config.mjs";
import { parseCsvRecords } from "../parse/csv.mjs";
import { parseBdcReportCsv } from "../parse/bdc-report-csv.mjs";
import { parseDatasetsPage, parseBdcReportPage, releaseWindow } from "../parse/pages.mjs";
import { parseSubTsv } from "../parse/sub.mjs";
import { EMPTY_BUFFER_SHA256, parseSoiTsv, presetHeaderMatches } from "../parse/soi.mjs";
import { inspectSubmissionsMain, inspectSubmissionsPage } from "../parse/submissions.mjs";
import { FAKE, datasetsPageHtml, reportCsv, reportPageHtml, soiTsv, subTsv, submissionsMain, submissionsPage } from "./synthetic.mjs";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../lib/config.mjs";

test("CIK padding and submissions URLs", () => {
  assert.equal(padCik(9999999901), "9999999901");
  assert.equal(padCik("1"), "0000000001");
  assert.throws(() => padCik("abc"), /not a CIK/);
  assert.equal(submissionsUrl(FAKE.cik1), "https://data.sec.gov/submissions/CIK9999999901.json");
  assert.equal(submissionsPageUrl("CIK9999999901-submissions-001.json"), "https://data.sec.gov/submissions/CIK9999999901-submissions-001.json");
  assert.equal(submissionsPageUrl("not-a-page.json"), null);
  assert.equal(submissionsPageUrl("../CIK9999999901-submissions-001.json"), null);
});

test("release labels become filing-date windows", () => {
  assert.deepEqual(releaseWindow("2022q4"), { cadence: "QUARTERLY", windowStart: "2022-10-01", windowEnd: "2022-12-31" });
  assert.deepEqual(releaseWindow("2026_06"), { cadence: "MONTHLY", windowStart: "2026-06-01", windowEnd: "2026-06-30" });
  assert.deepEqual(releaseWindow("2099_12"), { cadence: "MONTHLY", windowStart: "2099-12-01", windowEnd: "2099-12-31" });
});

test("CSV parser keeps quoted commas, doubled quotes, embedded line breaks, BOM, and CRLF", () => {
  const text = "\uFEFFA,B\r\n\"x,y\",\"he said \"\"hi\"\"\"\r\n\"line\nbreak\",z\r\n";
  const { bom, records } = parseCsvRecords(text);
  assert.equal(bom, true);
  assert.equal(records[0].cells.join("|"), "A|B");
  assert.equal(records[1].cells[0], "x,y");
  assert.equal(records[1].cells[1], 'he said "hi"');
  assert.equal(records[2].cells[0], "line\nbreak");
  assert.equal(records[2].lineNumber, 3);
});

test("BDC Report CSV accepts only the verified header", () => {
  const ok = parseBdcReportCsv(reportCsv({ rows: [VERIFIED_BDC_REPORT_HEADER.map(() => "TEST")] }));
  assert.equal(ok.headerMatches, true);
  const drift = parseBdcReportCsv(Buffer.from("rep_file_num,CIK\n814-1,9999999901\n", "utf8"));
  assert.equal(drift.headerMatches, false);
});

test("page parsers take the year from link text and keep the file with no year unlabeled", () => {
  const sets = parseDatasetsPage(datasetsPageHtml(["2099_12", "2022q4"]));
  assert.equal(sets.links.length, 2);
  assert.equal(sets.links[1].label, "2022q4");
  const html = reportPageHtml([
    { href: "/files/investment/data/other/business-development-company-report/TEST-ONLY-2099.csv", year: "2099", updated: "Updated 1/1/2099" },
    { href: "/files/investment/data/other/business-development-company-report/business_development_company.csv", year: "not-a-year" },
  ]);
  const reports = parseBdcReportPage(html);
  assert.equal(reports.links[0].reportYear, 2099);
  assert.equal(reports.links[1].reportYear, null);
  assert.equal(reports.links[1].yearLabel, "not-a-year");
});

test("SUB parser splits on LF and reports header drift", () => {
  const ok = parseSubTsv(Buffer.from(subTsv([{ adsh: FAKE.acc, cik: "9999999901", name: FAKE.name1, form: "10-K" }])));
  assert.equal(ok.headerMatches, true);
  assert.equal(ok.rows.length, 1);
  const drift = parseSubTsv(Buffer.from("adsh\tcik\n0000000000-00-000001\t1\n"));
  assert.equal(drift.headerMatches, false);
});

test("SOI parser accepts the preset header plus extra dynamic columns", () => {
  const ok = parseSoiTsv(Buffer.from(soiTsv([{
    adsh: FAKE.acc, cik: "9999999901", name: FAKE.name1, ddate: "2099-12-31", qtrs: "0",
    "Investment, Identifier Axis": FAKE.ident, "Adjusted cost basis": "90",
  }])));
  assert.equal(ok.emptyFile, false);
  assert.equal(ok.presetHeaderMatches, true);
  assert.equal(ok.rows.length, 1);
  assert.ok(ok.header.length > VERIFIED_SOI_PRESET_HEADER.length);
  assert.equal(presetHeaderMatches(ok.header), true);
});

test("SOI parser treats a 0-byte file as empty, not as header drift", () => {
  const empty = parseSoiTsv(Buffer.alloc(0));
  assert.equal(empty.emptyFile, true);
  assert.deepEqual(empty.header, []);
  assert.equal(empty.headerSha256, EMPTY_BUFFER_SHA256);
  assert.equal(empty.rows.length, 0);
});

test("SOI parser reports preset-header drift and keeps mixed-case labels", () => {
  const drift = parseSoiTsv(Buffer.from("adsh\tcik\n0000000000-00-000001\t9999999901\n"));
  assert.equal(drift.presetHeaderMatches, false);
  const lower = parseSoiTsv(Buffer.from(`${VERIFIED_SOI_PRESET_HEADER.map((h) => h.toLowerCase()).join("\t")}\n`));
  assert.equal(lower.presetHeaderMatches, false);
});

test("submissions inspector rejects unequal arrays, a mismatched CIK, and missing keys", () => {
  const good = inspectSubmissionsMain(Buffer.from(submissionsMain({
    cik: FAKE.cik1, name: FAKE.name1, filings: [{ accessionNumber: FAKE.acc, filingDate: "2099-12-31", form: "10-K", primaryDocument: "test-only.htm" }], files: [],
  })), FAKE.cik1);
  assert.deepEqual(good.problems, []);
  const badCik = inspectSubmissionsMain(Buffer.from(submissionsMain({
    cik: FAKE.cik2, name: FAKE.name1, filings: [{ accessionNumber: FAKE.acc, filingDate: "2099-12-31", form: "10-K", primaryDocument: "test-only.htm" }], files: [],
  })), FAKE.cik1);
  assert.ok(badCik.problems.some((p) => /cik does not equal/.test(p)));
  const unequal = JSON.parse(submissionsPage([{ accessionNumber: FAKE.acc, form: "10-K" }]));
  unequal.form = [];
  const page = inspectSubmissionsPage(Buffer.from(JSON.stringify(unequal)));
  assert.ok(page.problems.some((p) => /different lengths|lacks arrays/.test(p)));
});

test("committed synthetic fixtures are the same formats the parsers accept", () => {
  const dir = path.join(REPO_ROOT, "fixtures/pipeline/synthetic");
  const page = parseDatasetsPage(readFileSync(path.join(dir, "datasets-page.html"), "utf8"));
  assert.ok(page.links.some((l) => l.label === "2099_12"));
  const csv = parseBdcReportCsv(readFileSync(path.join(dir, "bdc-report-2099.csv")));
  assert.equal(csv.headerMatches, true);
  const main = inspectSubmissionsMain(readFileSync(path.join(dir, "submissions-CIK9999999901.json")), FAKE.cik1);
  assert.deepEqual(main.problems, []);
});
