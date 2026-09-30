// Builds an obviously fake Phase 2 source tree (TEST BDC, CIK 9999999901+, dates in 2099,
// TEST-ONLY paths) into a data directory: content-addressed store plus a fetch log.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { VERIFIED_BDC_REPORT_HEADER, VERIFIED_SOI_PRESET_HEADER, VERIFIED_SUB_HEADER } from "../lib/config.mjs";
import { createFetchLog } from "../lib/fetch-log.mjs";
import { createStore } from "../lib/store.mjs";
import { buildStoredZip } from "./zip-store.mjs";

export const FAKE = {
  cik1: 9999999901,
  cik2: 9999999902,
  name1: "TEST BDC 1",
  name2: "TEST BDC 2",
  former: "TEST BDC OLD",
  acc: "0000000000-00-000001",
  accAmend: "0000000000-00-000002",
  accPrefix: "0000000099-00-000001",
  accDisagree: "0000000000-00-000003",
  accShared: "0000000000-00-000004",
  accOrphan: "0000000000-00-000099",
  accP7q1: "0000000000-00-000020",
  accP7q3: "0000000000-00-000021",
  accP7cik2: "0000000000-00-000022",
  ident: "TEST BORROWER A | TEST LOAN 1",
  ident2: "TEST BORROWER A | TEST LOAN 2",
  typeFirst: "TEST FIRST LIEN",
  typeSecond: "TEST SECOND LIEN",
};

export const SOI_EXTRA_HEADERS = Object.freeze([
  "Adjusted cost basis",
  "Initial fair value of Investment",
  "Investment, Interest Rate, Paid in Kind",
  "TEST ONLY Unmapped Column",
]);

function csvRow(cells) {
  return cells.map((c) => (c.includes(",") || c.includes('"') ? `"${c.replace(/"/g, '""')}"` : c)).join(",");
}

function subLine(fields) {
  return VERIFIED_SUB_HEADER.map((h) => fields[h] ?? "").join("\t");
}

export function datasetsPageHtml(labels) {
  return `<html><body>${labels.map((l) =>
    `<a href="/files/datastandardsinnovation/data/business-development-company-bdc-data-sets/${l}_bdc.zip">TEST ONLY ${l}</a>`).join("\n")}</body></html>`;
}

export function reportPageHtml(editions) {
  return `<html><body>${editions.map((e) =>
    `<a href="${e.href}">${e.year}</a>${e.updated ? ` <em>${e.updated}</em>` : ""}`).join("\n")}</body></html>`;
}

export function reportCsv({ bom = false, header = VERIFIED_BDC_REPORT_HEADER, rows }) {
  const text = `${header.join(",")}\r\n${rows.map(csvRow).join("\r\n")}\r\n`;
  return Buffer.from(bom ? `\uFEFF${text}` : text, "utf8");
}

export function subTsv(rows) {
  return `${VERIFIED_SUB_HEADER.join("\t")}\n${rows.map(subLine).join("\n")}${rows.length ? "\n" : ""}`;
}

export function soiLine(fields, extraHeaders = SOI_EXTRA_HEADERS) {
  const header = [...VERIFIED_SOI_PRESET_HEADER, ...extraHeaders];
  return header.map((h) => fields[h] ?? "").join("\t");
}

export function soiTsv(rows, extraHeaders = SOI_EXTRA_HEADERS) {
  const header = [...VERIFIED_SOI_PRESET_HEADER, ...extraHeaders];
  const lines = rows.map((row) => (typeof row === "string" ? row : soiLine(row, extraHeaders)));
  return `${header.join("\t")}\n${lines.join("\n")}${lines.length ? "\n" : ""}`;
}

function soiBase(adsh, cik, name, extra = {}) {
  return {
    adsh, cik, name,
    ddate: extra.ddate ?? "2099-12-31",
    qtrs: extra.qtrs ?? "0",
    form: extra.form ?? "10-K",
    filed: "2099-12-31",
    period: "2099-12-31",
    inlineurl: extra.inlineurl ?? `https://www.sec.gov/ix?doc=/Archives/edgar/data/${cik}/000000000000000001/test-only.htm`,
    cstm: "0",
    "Investment, Identifier Axis": extra.identifier ?? FAKE.ident,
    "Investment Type Axis": extra.type ?? "",
    "Investment Interest Rate": extra.rate ?? "0.05",
    "Investment Owned, Balance, Principal Amount": extra.principal ?? "100",
    "Investment Owned, Cost": extra.presetCost ?? "",
    "Investment Owned, Fair Value": extra.presetFv ?? "",
    "Adjusted cost basis": extra.adjCost ?? "90",
    "Initial fair value of Investment": extra.initFv ?? "80",
    "Investment, Interest Rate, Paid in Kind": extra.pik ?? "0.01",
    "TEST ONLY Unmapped Column": extra.unmapped ?? "TEST ONLY EXTRA",
    "Investment Maturity Date": extra.maturity ?? "",
  };
}

function filingArrays(rows) {
  const keys = [
    "accessionNumber", "filingDate", "reportDate", "acceptanceDateTime", "act", "form", "fileNumber",
    "filmNumber", "items", "core_type", "size", "isXBRL", "isInlineXBRL", "isXBRLNumeric",
    "primaryDocument", "primaryDocDescription",
  ];
  const out = {};
  for (const k of keys) out[k] = rows.map((r) => r[k] ?? (k === "isXBRL" || k === "isInlineXBRL" || k === "isXBRLNumeric" || k === "size" ? 0 : ""));
  return out;
}

function filingRow(acc, form, date, extra = {}) {
  return {
    accessionNumber: acc, filingDate: date, reportDate: date,
    acceptanceDateTime: `${date}T00:00:00.000Z`, form,
    primaryDocument: "test-only.htm", primaryDocDescription: "TEST ONLY",
    fileNumber: "814-99999", isXBRL: 1, isInlineXBRL: 1, ...extra,
  };
}

export function submissionsMain({ cik, name, filings, files, formerNames = [] }) {
  return JSON.stringify({
    cik: String(cik).padStart(10, "0"),
    name,
    formerNames,
    tickers: ["TESTX"],
    exchanges: ["TEST"],
    fiscalYearEnd: "1231",
    stateOfIncorporation: "DE",
    filings: { recent: filingArrays(filings), files },
  });
}

export function submissionsPage(filings) {
  return JSON.stringify(filingArrays(filings));
}

export function defaultSubRows() {
  const filed = "20991231";
  return [
    { adsh: FAKE.acc, cik: String(FAKE.cik1), name: FAKE.name1, form: "10-K", period: filed, fy: "2099", fp: "FY", filed, accepted: "2099-12-31 00:00:00", prevrpt: "0", inlineurl: `https://www.sec.gov/ix?doc=/Archives/edgar/data/${FAKE.cik1}/000000000000000001/test-only.htm` },
    { adsh: FAKE.accAmend, cik: String(FAKE.cik1), name: FAKE.name1, form: "10-Q/A", period: filed, fy: "2099", fp: "Q3", filed, accepted: "2099-12-31 00:00:00", prevrpt: "0", inlineurl: `https://www.sec.gov/ix?doc=/Archives/edgar/data/${FAKE.cik1}/000000000000000002/test-only.htm` },
    { adsh: FAKE.accPrefix, cik: String(FAKE.cik1), name: FAKE.name1, form: "8-K", period: filed, fy: "2099", fp: "FY", filed, accepted: "2099-12-31 00:00:00", prevrpt: "0", inlineurl: `https://www.sec.gov/ix?doc=/Archives/edgar/data/${FAKE.cik1}/000000009900000001/test-only.htm` },
    { adsh: FAKE.accDisagree, cik: String(FAKE.cik1), name: FAKE.name1, form: "10-Q", period: filed, fy: "2099", fp: "Q2", filed, accepted: "2099-12-31 00:00:00", prevrpt: "0", inlineurl: `https://www.sec.gov/ix?doc=/Archives/edgar/data/${FAKE.cik1}/000000000000000003/test-only.htm` },
  ];
}

export function defaultSoiRows() {
  return [
    soiBase(FAKE.acc, String(FAKE.cik1), FAKE.name1, { unmapped: "TEST ONLY DUP A" }),
    soiBase(FAKE.acc, String(FAKE.cik1), FAKE.name1, { principal: "101", unmapped: "TEST ONLY DUP B" }),
    soiBase(FAKE.acc, String(FAKE.cik1), FAKE.name1, { ddate: "2099-09-30", unmapped: "TEST ONLY OTHER DATE" }),
    soiBase(FAKE.acc, String(FAKE.cik1), FAKE.name1, { identifier: "", principal: "300", adjCost: "", initFv: "", rate: "", pik: "", unmapped: "" }),
    soiBase(FAKE.accPrefix, String(FAKE.cik1), FAKE.name1, { form: "8-K", identifier: "TEST BORROWER B | TEST LOAN 2" }),
    soiBase(FAKE.accOrphan, String(FAKE.cik1), FAKE.name1, { identifier: "TEST BORROWER C | TEST LOAN 3" }),
    `${soiLine(soiBase(FAKE.acc, String(FAKE.cik1), FAKE.name1, { identifier: "TEST BORROWER D | TEST LOAN 4" }))}\tTOO_MANY`,
    soiBase(FAKE.accDisagree, String(FAKE.cik2), FAKE.name2, { form: "10-Q", identifier: "TEST BORROWER E | TEST LOAN 5" }),
  ];
}

export function defaultFilledZip(readme = "<html>TEST ONLY</html>") {
  return buildStoredZip({
    "datasets/sub.tsv": subTsv(defaultSubRows()),
    "soi.tsv": soiTsv(defaultSoiRows()),
    "readme.htm": readme,
  });
}

export function defaultSources() {
  const date = "2099-12-31";
  const zipFilled = defaultFilledZip();
  const zipEmpty = buildStoredZip({
    "datasets/sub.tsv": subTsv([]),
    "soi.tsv": Buffer.alloc(0),
  });

  const pageName = "CIK9999999901-submissions-001.json";
  const main1 = submissionsMain({
    cik: FAKE.cik1, name: FAKE.name1,
    formerNames: [{ name: FAKE.former, from: "2099-01-01T00:00:00.000Z", to: "2099-02-01T00:00:00.000Z" }],
    filings: [
      filingRow(FAKE.acc, "10-K", date),
      filingRow(FAKE.accAmend, "10-Q/A", date),
      filingRow(FAKE.accPrefix, "8-K", date),
      filingRow(FAKE.accDisagree, "10-K", date),
      filingRow(FAKE.accShared, "8-K", date),
    ],
    files: [{ name: pageName, filingCount: 1, filingFrom: "2099-01-01", filingTo: "2099-06-30" }],
  });
  const page1 = submissionsPage([filingRow("0000000000-00-000010", "N-54A", "2099-06-15")]);
  const main2 = submissionsMain({
    cik: FAKE.cik2, name: FAKE.name2,
    filings: [filingRow(FAKE.accShared, "8-K", date)],
    files: [],
  });

  return {
    datasetsPage: datasetsPageHtml(["2099_12", "2099_11"]),
    reportPage: reportPageHtml([
      { href: "/files/investment/data/other/business-development-company-report/TEST-ONLY-2026.csv", year: "2026", updated: "Updated 1/1/2099" },
      { href: "/files/investment/data/other/business-development-company-report/TEST-ONLY-2019.csv", year: "2019", updated: "Updated 1/1/2019" },
    ]),
    csvLoaded: reportCsv({
      bom: true,
      rows: [
        ["814-99999", "9999999901", FAKE.name1, "1 Test Street", "", "Test City", "DE", "00000", "12/31/99", "10-K"],
        ["814-99998", "9999999902", FAKE.name2, "2 Test Street", "", "Test City", "DE", "00000", "12/31/99", "10-Q"],
      ],
    }),
    csv2019: reportCsv({
      header: ["rep_file_num", "CIK", "entity_name"],
      rows: [["814-00000", "9999999901", FAKE.name1]],
    }),
    zipFilled,
    zipEmpty,
    main1,
    page1,
    pageName,
    main2,
  };
}

export function p7Sources() {
  const filedQ1 = "20990331";
  const filedQ3 = "20990930";
  const sub = [
    ...defaultSubRows(),
    { adsh: FAKE.accP7q1, cik: String(FAKE.cik1), name: FAKE.name1, form: "10-Q", period: filedQ1, fy: "2099", fp: "Q1", filed: filedQ1, accepted: "2099-03-31 00:00:00", prevrpt: "0", inlineurl: `https://www.sec.gov/ix?doc=/Archives/edgar/data/${FAKE.cik1}/000000000000000020/test-only.htm` },
    { adsh: FAKE.accP7q3, cik: String(FAKE.cik1), name: FAKE.name1, form: "10-Q", period: filedQ3, fy: "2099", fp: "Q3", filed: filedQ3, accepted: "2099-09-30 00:00:00", prevrpt: "0", inlineurl: `https://www.sec.gov/ix?doc=/Archives/edgar/data/${FAKE.cik1}/000000000000000021/test-only.htm` },
    { adsh: FAKE.accP7cik2, cik: String(FAKE.cik2), name: FAKE.name2, form: "10-Q", period: filedQ1, fy: "2099", fp: "Q1", filed: filedQ1, accepted: "2099-03-31 00:00:00", prevrpt: "0", inlineurl: `https://www.sec.gov/ix?doc=/Archives/edgar/data/${FAKE.cik2}/000000000000000022/test-only.htm` },
  ];
  const soi = [
    ...defaultSoiRows(),
    soiBase(FAKE.accP7q1, String(FAKE.cik1), FAKE.name1, {
      form: "10-Q", ddate: "2099-03-31", period: "2099-03-31", type: FAKE.typeFirst,
      inlineurl: `https://www.sec.gov/ix?doc=/Archives/edgar/data/${FAKE.cik1}/000000000000000020/test-only.htm`,
    }),
    soiBase(FAKE.accP7q1, String(FAKE.cik1), FAKE.name1, {
      form: "10-Q", ddate: "2099-03-31", period: "2099-03-31", identifier: FAKE.ident2, type: FAKE.typeSecond,
      inlineurl: `https://www.sec.gov/ix?doc=/Archives/edgar/data/${FAKE.cik1}/000000000000000020/test-only.htm`,
    }),
    soiBase(FAKE.accP7q3, String(FAKE.cik1), FAKE.name1, {
      form: "10-Q", ddate: "2099-09-30", period: "2099-09-30", type: FAKE.typeFirst,
      inlineurl: `https://www.sec.gov/ix?doc=/Archives/edgar/data/${FAKE.cik1}/000000000000000021/test-only.htm`,
    }),
    soiBase(FAKE.accP7cik2, String(FAKE.cik2), FAKE.name2, {
      form: "10-Q", ddate: "2099-03-31", period: "2099-03-31", type: FAKE.typeFirst,
      inlineurl: `https://www.sec.gov/ix?doc=/Archives/edgar/data/${FAKE.cik2}/000000000000000022/test-only.htm`,
    }),
  ];
  const sources = defaultSources();
  sources.zipFilled = buildStoredZip({
    "datasets/sub.tsv": subTsv(sub),
    "soi.tsv": soiTsv(soi),
    "readme.htm": "<html>TEST ONLY</html>",
  });
  const pageName = "CIK9999999901-submissions-001.json";
  sources.main1 = submissionsMain({
    cik: FAKE.cik1, name: FAKE.name1,
    formerNames: [{ name: FAKE.former, from: "2099-01-01T00:00:00.000Z", to: "2099-02-01T00:00:00.000Z" }],
    filings: [
      filingRow(FAKE.acc, "10-K", "2099-12-31"),
      filingRow(FAKE.accAmend, "10-Q/A", "2099-12-31"),
      filingRow(FAKE.accPrefix, "8-K", "2099-12-31"),
      filingRow(FAKE.accDisagree, "10-K", "2099-12-31"),
      filingRow(FAKE.accShared, "8-K", "2099-12-31"),
      filingRow(FAKE.accP7q1, "10-Q", "2099-03-31"),
      filingRow(FAKE.accP7q3, "10-Q", "2099-09-30"),
    ],
    files: [{ name: pageName, filingCount: 1, filingFrom: "2099-01-01", filingTo: "2099-06-30" }],
  });
  sources.main2 = submissionsMain({
    cik: FAKE.cik2, name: FAKE.name2,
    filings: [
      filingRow(FAKE.accShared, "8-K", "2099-12-31"),
      filingRow(FAKE.accP7cik2, "10-Q", "2099-03-31"),
    ],
    files: [],
  });
  return sources;
}

export function writeSyntheticTree(dataDir, sources = defaultSources()) {
  mkdirSync(dataDir, { recursive: true });
  const store = createStore(dataDir);
  const log = createFetchLog(dataDir);
  const session = "TEST-ONLY-SESSION";
  let t = Date.parse("2099-12-31T00:00:00Z");
  const put = (url, sourceType, body, context) => {
    const stored = store.put(Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8"));
    t += 1000;
    return log.append({
      session_id: session,
      requested_at: new Date(t).toISOString(),
      url,
      final_url: url,
      http_status: 200,
      content_type: "application/octet-stream",
      byte_size: stored.byteSize,
      sha256: stored.sha256,
      storage_key: stored.storageKey,
      source_type: sourceType,
      context,
    });
  };

  put("https://www.sec.gov/data-research/sec-markets-data/bdc-data-sets", "SEC_BDC_DATASETS_PAGE", sources.datasetsPage, { kind: "datasets_page" });
  const reportPage = put("https://www.sec.gov/data-research/sec-markets-data/opendatasetsshtmlbdc", "SEC_BDC_REPORT_PAGE", sources.reportPage, { kind: "bdc_report_page" });
  put("https://www.sec.gov/files/investment/data/other/business-development-company-report/TEST-ONLY-2026.csv", "SEC_BDC_REPORT_CSV", sources.csvLoaded, { kind: "bdc_report_csv", page_seq: reportPage.seq, year_label: "2026" });
  put("https://www.sec.gov/files/investment/data/other/business-development-company-report/TEST-ONLY-2019.csv", "SEC_BDC_REPORT_CSV", sources.csv2019, { kind: "bdc_report_csv", page_seq: reportPage.seq, year_label: "2019" });
  const datasetsPageSeq = 1;
  put("https://www.sec.gov/files/datastandardsinnovation/data/business-development-company-bdc-data-sets/2099_12_bdc.zip", "SEC_BDC_DATASET_ZIP", sources.zipFilled, { kind: "dataset_zip", page_seq: datasetsPageSeq, release_label: "2099_12" });
  put("https://www.sec.gov/files/datastandardsinnovation/data/business-development-company-bdc-data-sets/2099_11_bdc.zip", "SEC_BDC_DATASET_ZIP", sources.zipEmpty, { kind: "dataset_zip", page_seq: datasetsPageSeq, release_label: "2099_11" });
  const main = put("https://data.sec.gov/submissions/CIK9999999901.json", "SEC_SUBMISSIONS_JSON", sources.main1, { kind: "submissions", cik: FAKE.cik1 });
  put(`https://data.sec.gov/submissions/${sources.pageName}`, "SEC_SUBMISSIONS_PAGE_JSON", sources.page1, { kind: "submissions_page", cik: FAKE.cik1, parent_seq: main.seq, name: sources.pageName });
  put("https://data.sec.gov/submissions/CIK9999999902.json", "SEC_SUBMISSIONS_JSON", sources.main2, { kind: "submissions", cik: FAKE.cik2 });
  return { store, log };
}

// Marker strings every synthetic payload must carry so a guard test can refuse realistic data.
export function markerStrings() {
  return ["TEST BDC", "TEST-ONLY", "999999990", "2099"];
}
