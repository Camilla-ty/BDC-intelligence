# SEC source schemas

**Version:** 2 (registry and filing-history verification; version 1 was the Phase 0.2 spike).
**Status:** Verified against real SEC files. Nothing here is application data.
**Last verified:** 2026-09-28 (UTC). All fixtures were retrieved on that date.
**Verifier:** project maintainers, using `scripts/sec/fetch-source-fixtures.mjs` and
`scripts/sec/inspect-source-fixtures.mjs`.

This document records what official SEC sources contain, how they are structured, and how far
each can be trusted. It is the reference that code must cite before depending on any SEC endpoint,
file, column, or JSON key. Raw SEC files are kept only in the ignored local `.cache/sec/`. The
repository holds only the fixture manifest (`fixtures/sec/manifest.json`) and structure-only
snapshots (`fixtures/sec/snapshots/`): headers, counts, and format classes, with no names and no
financial values.

**Evidence legend**

| Label | Meaning |
|---|---|
| Documented | Stated in an official SEC page or document, cited by source ID and section or page. |
| Observed | Seen in a real retrieved file, cited by fixture ID. |
| Documented+Observed | Both. |

**Status values** (used in the matrix and inventories)

| Status | Meaning |
|---|---|
| Available | The field exists in the named source and was observed with values consistent with its definition. |
| Partial | Exists only for some rows or filers, only inside a combined string, only as a dynamic column, or only through an observed (undocumented) join. |
| Not available | Not present in any verified SEC source. Downstream it is shown as Unknown. |
| Level 2 extraction required | Only obtainable by reading the original filing document. |
| Not verified | Not yet checked against a real file. |
| OPEN QUESTION | Evidence conflicts or is insufficient; see section 15. |

**Documentation versions used**

- **S2 readme PDF** (fixture F02): 15 pages, no visible version or date. Identified only by its
  SHA-256 `661838034b6251d8a939e303fab8a975b285c7e08b28485fab6972fc60a799d6`.
- **In-archive `readme.htm`**: shipped inside every dataset ZIP, byte-identical across F03–F07
  (SHA-256 prefix `de79ca26b93c`). It is newer than the PDF: it documents `qtrs` and drops the
  footnote truncation. Where the two differ, this document cites the in-archive readme and logs the
  difference in section 14.
- **In-archive `bdc_metadata.json`**: a W3C CSV-on-the-Web table schema, byte-identical across
  F03–F07 (SHA-256 prefix `825ef7f9b9d5`). It gives column lists and primary keys.

---

## 1. Source register

Authority classes: **Authoritative** (the original filing), **Bootstrap** (BDC Data Sets),
**Registry** (BDC Report), **Discovery** (submissions, indexes), **Reference identifier** (ticker
files), **Policy** (access rules).

| ID | Source | Official URL | Format | Cadence | Contents | Grain | Period meaning | Identifiers | Limitations | Authority | Used in MVP | Fixtures |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| S1 | BDC Data Sets page | https://www.sec.gov/data-research/sec-markets-data/bdc-data-sets | HTML | Monthly (page text) | Coverage statement, dated notes, links to every dataset ZIP and the readme | One page | Coverage "October 2022 - August 2026" | None | Notes are dated prose; no machine-readable change log | Policy / documentation | Yes (reference) | F01 |
| S2 | BDC readme (PDF) | https://www.sec.gov/files/bdc_readme.pdf | PDF | Unstated | Scope, organization, file format, table definitions | One document | n/a | n/a | Older than the in-archive readme; omits `qtrs`; no version | Documentation | Yes (reference) | F02 |
| S3 | BDC dataset ZIPs | https://www.sec.gov/files/datastandardsinnovation/data/business-development-company-bdc-data-sets/{period}_bdc.zip | ZIP of UTF-8 TSV + `readme.htm` + `bdc_metadata.json` | Monthly; refreshed in place | SUB, TAG, NUM, TXT, PRE, CAL, NON tables and the SOI report | Per table (section 4) | Filing-date window (section 3.6) | CIK (registrant), `adsh` (accession) | "Not a substitute for such filings"; SOI has no key and dynamic columns | Bootstrap | Yes | F03, F04, F05, F06, F07 |
| S4 | BDC Report | https://www.sec.gov/data-research/sec-markets-data/opendatasetsshtmlbdc | CSV and XML | Annual (page labels show early-June updates) | Registry of active 814- entities: file number, CIK, name, address, last filing | One row per registrant | "Updated" date on page | CIK (zero-padded, 10 digits), 814- file number | No ticker, adviser, or public/private type; column layout differs before 2020 (section 6.1) | Registry | Yes (2020–2026 CSVs only) | F08, F09, F15, F20–F33 |
| S5 | Submissions API | https://data.sec.gov/submissions/CIK##########.json | JSON | Real time | Entity metadata, tickers, exchanges, filing history in columnar arrays | One file per CIK | As retrieved | CIK (10-digit, zero-padded, in URL) | JSON keys are not documented field by field; additional-page URLs are observed, not documented (section 7.1) | Discovery | Yes | F11, F12, F16, F19a, F19b |
| S6 | Bulk submissions ZIP | https://www.sec.gov/Archives/edgar/daily-index/bulkdata/submissions.zip | ZIP of JSON | Nightly (Documented, S5 page) | All S5 files | One JSON per CIK | As retrieved | CIK | Large; not needed for MVP | Discovery | No (listed) | none (link observed in F16) |
| S7 | EDGAR Archives (filing folder, `index.json`, primary document) | https://www.sec.gov/Archives/edgar/data/{cik}/{accession-no-dashes}/ | Directory listing JSON, HTML/iXBRL | Immutable per accession | Every document of one filing | One folder per accession | The filing's own period | CIK in path (no leading zeros observed), accession | Must be fetched per filing | Authoritative | Yes (evidence) | F13a, F13b |
| S8 | Ticker association files | https://www.sec.gov/files/company_tickers_exchange.json | JSON | Unstated | CIK, name, ticker, exchange | One row per ticker | As retrieved | CIK (integer), ticker | Covers only a minority of BDC CIKs (section 9) | Reference identifier | Partial | F10 |
| S9 | Accessing EDGAR Data | https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data | HTML | Unstated | Fair access, User-Agent rule, archive paths, accession-number anatomy | One page | n/a | n/a | n/a | Policy | Yes (reference) | F14 |
| S10 | Webmaster FAQ and Privacy Information | https://www.sec.gov/about/webmaster-frequently-asked-questions and https://www.sec.gov/about/privacy-information | HTML | Unstated | Developer guidance; rate-limit policy | One page each | n/a | n/a | n/a | Policy | Yes (reference) | F17, F18 |
| S11 | EDGAR full index | https://www.sec.gov/Archives/edgar/full-index/ | Index files | Daily/quarterly (Documented, S9) | Filing lists by form, company, CIK | One row per filing | Quarter | CIK, accession path | Not needed while S3 and S5 suffice | Discovery | No (listed) | none |
| S12 | XBRL company facts / frames APIs | https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json | JSON | Real time | Entity-level XBRL facts | One file per CIK | Per fact | CIK | Entity-wide facts, not individual holdings | Discovery | No (listed) | none (documented in F16) |
| S13 | Standard taxonomies | https://www.sec.gov/data-research/standard-taxonomies | Taxonomy packages | Annual | Tag definitions and labels | Per tag | Taxonomy year | Tag name + version | Not retrieved in this phase | Documentation | Reference only | none |

NY Fed, FRED, and FINRA are not SEC sources and are out of scope for this document.

## 2. Fair access and request policy

| Requirement | Official value | Source | Date verified | Our policy |
|---|---|---|---|---|
| Maximum request rate | 10 requests per second, across all machines | S9 (F14), S10 (F17, F18) | 2026-09-28 | At most 1 request per second in this phase (`MIN_INTERVAL_MS = 1100`) |
| Excess traffic | Further requests from the IP may be limited for a brief period | S10 Privacy Information (F18) | 2026-09-28 | Stop immediately on HTTP 403 or 429; stop on any other non-2xx |
| Declared User-Agent | Company or project name plus contact email in the `User-Agent` header | S9 (F14), S10 (F17) | 2026-09-28 | Read from the local `SEC_USER_AGENT` environment variable; refuse to run without it; never logged or recorded |
| Compression | Sample headers include `Accept-Encoding: gzip, deflate` | S9 (F14) | 2026-09-28 | Sent on every request; checksums are taken after content decoding |
| Authentication | None; no API keys | S5 API page (F16) | 2026-09-28 | None used |
| CORS | `data.sec.gov` does not support CORS | S5 API page (F16) | 2026-09-28 | Server-side retrieval only |
| Bulk preferred | Bulk ZIPs are the most efficient way to fetch large amounts of API data | S5 API page (F16) | 2026-09-28 | Noted for later phases (S6) |
| Allowed hosts | n/a | This project | 2026-09-28 | Only `www.sec.gov` and `data.sec.gov` (checked before the request and on the final URL); https only |
| Re-fetching | n/a | This project | 2026-09-28 | Skip a fixture whose cached SHA-256 already matches the manifest; `--refresh` records `previous_sha256` when content changed |

## 3. BDC Data Sets

### 3.1 Page facts and dated notes (Documented, S1, F01)

- Coverage label: "October 2022 - August 2026". The data sets "will be updated monthly".
- September 2026 note: all files were refreshed to add `qtrs` to `soi.tsv`, and `soi.tsv` was
  updated to resolve a parsing issue affecting some records.
- July 2026 note: all files were refreshed to add `qtrs` to `num.tsv` and `txt.tsv`; the 2025
  files were consolidated into quarterly files.
- June 2026 notes: there were no BDC filings with financial statement data in June 2026; the
  `2026_06` file contains no financial data, and its `non.tsv` holds 8-K and DEF 14A data. From June
  2026 the `num.tsv`/`txt.tsv` footnote field is no longer truncated, and typed dimensions are
  included in the `segments` field of `num.tsv` and `txt.tsv`.
- Disclaimer: the data may contain extraction errors and is "not a substitute for such filings".
  In this project the data sets are bootstrap data, never the final authority.
- Page "Last Reviewed or Updated" date at retrieval: Aug. 31, 2026 (F01 snapshot).

### 3.2 Period naming and cadence

| Fact | Evidence | Status |
|---|---|---|
| Quarterly names `2022q4_bdc.zip` through `2025q4_bdc.zip`; monthly names `2026_01_bdc.zip` through `2026_08_bdc.zip` (21 ZIP links on the page: 13 quarterly, 8 monthly; the page's other two file links are PDFs) | Observed, F01 snapshot `data_file_links` | Available |
| 2025 files were consolidated into quarterly files in July 2026 | Documented, S1 (F01) | Available |
| Whether 2026 monthly files will later be consolidated (URLs would change); see Q7 | Not stated on S1 (F01) | OPEN QUESTION |
| `2026_06` is an empty financial period: every table except NON has a header row and zero data rows; `soi.tsv` is 0 bytes (no header at all); NON has 4,411 rows (8-K, 8-K/A, DEF 14A) | Observed, F03 | Available |
| Refreshes reuse the same URL: every sampled ZIP has a `Last-Modified` of 2026-09-18 (F03–F06) or 2026-09-25 (F07), after the September refresh note | Observed, manifest retrieval metadata | Available |

A missing or empty period must never be read as zero holdings; it means no financial filings were
included for that window.

### 3.3 Archive structure (Observed, F03–F07)

| Member | Present in | Notes |
|---|---|---|
| `datasets/sub.tsv`, `datasets/tag.tsv`, `datasets/num.tsv`, `datasets/txt.tsv`, `datasets/pre.tsv`, `datasets/cal.tsv`, `datasets/non.tsv` | F03–F07 | The seven packaged tables sit in a `datasets/` folder, as documented (S2 section 1). |
| `soi.tsv` | F03–F07 | At the archive root, separate from `datasets/`, matching "a separate report" (S2 section 1). 0 bytes in F03. |
| `readme.htm` | F03–F07 | Not mentioned on S1 or in S2. Byte-identical across all five archives. |
| `bdc_metadata.json` | F03–F07 | Not mentioned on S1 or in S2. CSVW schema; tab delimiter, one header row. Byte-identical across all five archives. |

Per-member byte counts and SHA-256 values are in each dataset snapshot (`fixtures/sec/snapshots/F03.json` … `F07.json`).

### 3.4 Inclusion scope (Documented, S2 section 2)

- Submissions with a file number beginning "814-", or a filer that filed an N-54A and has not yet
  filed an N-54C.
- XBRL submissions that include financial statements (for example 10-K, 10-Q). Data from
  non-financial-statement XBRL filings (for example 8-K) is summarized in NON.
- Reporting period on or after August 1, 2022, "up to the month end filing date inclusive".
- All values are "as filed".

Observed: every SOI and SUB row in F04–F07 has a 10-Q, 10-K, 10-Q/A, or 10-K/A form. NON also
contains a small number of 10-Q/10-K rows (for example 24 in F07, 496 10-K in F05), which the
documentation does not explain (section 14).

### 3.5 Table relationships

Documented (S2 section 3, Figure 2): NUM, TXT, PRE, CAL, and SOI reference SUB via `adsh`; NUM,
TXT, PRE, CAL (`ptag/pversion`, `ctag/cversion`), and NON reference TAG via `tag, version`; PRE
references NUM via `adsh, tag, version`. NON has no relationship except to TAG.

Observed join results:

| Join | F04 | F05 | F06 | F07 |
|---|---|---|---|---|
| SOI `adsh` found in SUB | 9,969 / 9,969 rows | 52,747 / 52,747 | 156,115 / 156,115 | 181,907 / 181,907 |
| SOI `period` equals SUB `period` for the same `adsh` | 100% | 100% | 100% | 100% |

### 3.6 What the dataset period means

Documented: scope runs "up to the month end filing date inclusive" (S2 section 2).
Observed: every SOI row's `filed` date falls inside the window implied by the file name in all
four sampled financial files (F04: 9,969/9,969; F05: 52,747/52,747; F06: 156,115/156,115; F07:
181,907/181,907). SOI `ddate` values span many earlier years (for example 2008-01-31 in F05) and a
few later dates.

**Conclusion (Documented+Observed):** a dataset file is a **filing-date window**, not a reporting
period. A given reporting period can appear in more than one file (for example an original filing
and a later amendment).

## 4. Table inventories

Types, sizes, nullability, and keys are Documented (in-archive readme and S2 section 5; keys also
in `bdc_metadata.json`). Positions and observed formats come from F04–F07. Observed formats use the
inspection classes `integer`, `decimal`, `digits_8` (yyyymmdd), `date_yyyy-mm-dd`, `datetime`,
`url`, `text`.

### 4.1 SUB (submissions)

Documented key: `adsh`. Observed: `adsh` is distinct per row in every file (F07: 174 rows, 174
distinct).

| Pos | Field | SEC description (short) | Documented type / size / nullable | Observed |
|---|---|---|---|---|
| 1 | adsh | Accession number, `nnnnnnnnnn-nn-nnnnnn` | ALPHANUMERIC / 20 / No | Format valid in all rows |
| 2 | cik | Registrant CIK, "ten-digit number" | NUMERIC / 10 / No | Integer **without leading zeros** (5–7 digits observed) |
| 3 | name | Registrant name as of the filing date | ALPHANUMERIC / 150 / No | Text |
| 4–16 | countryba … mas2 | Business and mailing address fields | ALPHANUMERIC / 2–40 / Yes | Text |
| 17–18 | countryinc, stprinc | Country and state of incorporation | ALPHANUMERIC / 2 / No, Yes | Text |
| 19 | ein | Employer identification number | NUMERIC / 10 / Yes | Present |
| 20–21 | former, changed | Former name and change date (yyyymmdd) | ALPHANUMERIC 150, DATE 8 / Yes | Present |
| 22–23 | afs, wksi | Filer status; WKSI flag | ALPHANUMERIC 5 / Yes; BOOLEAN / No | Present |
| 24 | fye | Fiscal year end (mmdd) | ALPHANUMERIC / 4 / No | Present |
| 25 | form | Submission type | ALPHANUMERIC / 10 / No | 10-Q, 10-K, 10-Q/A, 10-K/A |
| 26 | period | Balance sheet date, rounded to nearest month-end (yyyymmdd) | DATE / 8 / Yes | `digits_8` in all rows |
| 27–28 | fy, fp | Fiscal year / period focus | YEAR 4, ALPHANUMERIC 2 / Yes | `fp` values FY, Q1, Q2, Q3 observed |
| 29 | filed | Filing date (yyyymmdd) | DATE / 8 / No | `digits_8` in all rows |
| 30 | **fileNumber** | **Not documented** | — | Present in every file (F04–F07); not in readme or metadata |
| 31 | accepted | Acceptance date-time (yyyy-mm-dd hh:mm:ss) | DATETIME / 19 / No | `datetime` in all rows |
| 32 | prevrpt | 1 if the submission was amended before the table cutoff | BOOLEAN / 1 / No | 0 in every row of F04–F07 |
| 33 | detail | 1 if detail-tagged | BOOLEAN / 1 / No | 1 in every row |
| 34 | instance | XBRL instance document name | ALPHANUMERIC / 40 / No | Present |
| 35–36 | pubfloatusd, floatdate | Public float and date | NUMERIC 8, DATE 8 / Yes | Present |
| 37 | inlineurl | URL to inline XBRL filing | ALPHANUMERIC / 150 / No | Present |

### 4.2 TAG (tags)

Documented key: `tag, version`. Header observed exactly as documented in F04–F07: `tag, version,
custom, abstract, datatype, iord, crdr, tlabel, doc`. Observed: F07 has 37,272 custom and 4,788
standard tag rows. The standard tags whose `tlabel` equals the SOI preset value labels are
`InvestmentInterestRate`, `InvestmentBasisSpreadVariableRate`,
`InvestmentOwnedBalancePrincipalAmount`, `InvestmentOwnedAtCost`, `InvestmentOwnedAtFairValue`,
and `InvestmentOwnedPercentOfNetAssets` (F04, F06, F07). In F05 (2022 taxonomy) the cost, fair
value, and percentage labels did not map by `tlabel`, so label text differs by taxonomy year.

### 4.3 NUM (numbers)

Documented key (in-archive readme Figure 5 and `bdc_metadata.json`): `adsh, tag, version, ddate,
qtrs, uom, segments`. The S2 section 3 key list omits `qtrs` (section 14).

| Pos | Field | Documented | Observed |
|---|---|---|---|
| 1 | adsh | Accession number | Present |
| 2 | tag | Tag name | Present |
| 3 | version | Taxonomy identifier, or `adsh` for a custom tag | Present |
| 4 | ddate | End date rounded to nearest month end, YYYYMMDD | Present |
| 5 | qtrs | Number of quarters represented, rounded; 0 = point in time (in-archive readme only) | Integers; F07 distribution from 0 to 90 |
| 6 | uom | Unit of measure | Present; currencies (USD and at least 15 others in F07), `pure`, `Rate`, `shares` |
| 7 | segments | Axis=member pairs, `;`-delimited; typed members as `Axis(version)=text()` | Present; typed identifier members observed |
| 8 | dimn | Number of dimensions | Present |
| 9 | value | Not scaled; rounded to four decimal places | `decimal` for almost all rows (F07: 947,509 decimal, 19 integer, 2,541 empty) |
| 10 | footnote | Footnote text (no truncation in the in-archive readme) | Footnotes longer than 512 bytes present in every file (F07: 432,981 rows) |
| 11 | footlen | Footnote length in bytes | Present |

### 4.4 TXT (plain text)

Documented key (in-archive readme and metadata): `adsh, tag, version, ddate, qtrs, segments`.
Header observed as documented: `adsh, tag, version, ddate, qtrs, segments, dimn, value, txtlen,
footnote, footlen`. `value` is whitespace-normalized and "truncated to a maximum number of bytes"
(the number is not stated). Footnotes longer than 512 bytes observed (F07: 53,094 rows).

### 4.5 PRE (presentation)

Documented key: `adsh, report, line`. Header observed as documented. `stmt` values observed: BS,
IS, CF, EQ, CI, SI, UN, empty, and **CP**, which is not in the documented list (F04–F07; section 14).

### 4.6 CAL (calculations)

Documented key: `adsh, grp, arc`. Header observed as documented: `adsh, grp, arc, negative, ptag,
pversion, ctag, cversion`.

### 4.7 NON (non-financial-statement filings)

No key relationship except to TAG. Header observed: `adsh, cik, name, form, filed, period, ddate,
tag, version, label, segments, value, indexurl`. The documentation names the 11th column `segment`;
the files use `segments` (section 14). Forms observed: mostly 8-K, 8-K/A, and DEF 14A, plus some
10-Q/10-K/10-K/A rows.

### 4.8 Line format

Documented: UTF-8, tab-delimited, `\n`-terminated lines, lowercase header names (S2 section 4).
Observed: no carriage returns in data lines. A few rows have **more** tab-separated fields than the
header (F05: NUM 107, SOI 15, TXT 14; F06: NUM 21, SOI 3, TXT 1; F07: NUM 23, SOI 4; F04: none),
consistent with tab characters inside values. The SOI header uses mixed-case labels, not the
lowercase rule.

## 5. SOI in depth

### 5.1 Column inventory

**Preset columns** (Documented in in-archive readme Figure 10 and S2 Figure 10; observed position
and non-empty row counts per file). Order is identical in all sampled files.

| Pos | Column | F05 2022q4 | F06 2025q4 | F04 2026_07 | F07 2026_08 | Observed value classes | Status |
|---|---|---|---|---|---|---|---|
| 1 | adsh | 52,747 | 156,115 | 9,969 | 181,907 | text (accession format) | Available |
| 2 | cik | 52,747 | 156,115 | 9,969 | 181,907 | integer, no leading zeros | Available |
| 3 | name | 52,747 | 156,115 | 9,969 | 181,907 | text | Available |
| 4 | ddate | 52,747 | 156,115 | 9,969 | 181,907 | date_yyyy-mm-dd | Available |
| 5 | qtrs | 52,747 | 156,115 | 9,969 | 181,907 | integer | Available |
| 6 | form | 52,747 | 156,115 | 9,969 | 181,907 | text | Available |
| 7 | filed | 52,747 | 156,115 | 9,969 | 181,907 | date_yyyy-mm-dd | Available |
| 8 | period | 52,747 | 156,115 | 9,969 | 181,907 | date_yyyy-mm-dd | Available |
| 9 | inlineurl | 52,747 | 156,115 | 9,969 | 181,907 | url | Available |
| 10 | cstm | 52,747 | 156,115 | 9,969 | 181,907 | integer (0 or 1) | Available |
| 11 | Industry Sector Axis | 13,288 | 15,315 | 637 | 18,190 | text | Partial |
| 12 | Investment, Identifier Axis | 26,339 | 119,406 | 7,995 | 139,219 | text | Partial |
| 13 | Investment, Issuer Affiliation Axis | 1,726 | 7,683 | 149 | 10,049 | text | Partial |
| 14 | Investment Type Axis | 16,263 | 14,137 | 510 | 16,159 | text | Partial |
| 15 | Investment Interest Rate | 13,243 | 59,861 | 3,668 | 69,483 | decimal | Available |
| 16 | Investment, Basis Spread, Variable Rate | 19,432 | 66,482 | 3,996 | 81,674 | decimal | Available |
| 17 | Investment Maturity Date | 6,053 | 37,978 | 161 | 47,202 | date_yyyy-mm-dd | Available |
| 18 | Investment Owned, Balance, Principal Amount | 25,006 | 81,930 | 5,518 | 95,163 | decimal | Available |
| 19 | Investment Owned, Cost | 4 | 3 | 0 | 2 | decimal | OPEN QUESTION |
| 20 | Investment Owned, Fair Value | 1 | 0 | 0 | 0 | — | OPEN QUESTION |
| 21 | Investment Owned, Net Assets, Percentage | 20,269 | 62,358 | 3,713 | 72,282 | decimal | Available |

A handful of cells (at most 5 per column per file) have a class that does not fit the column (for
example a decimal in the maturity column). Their counts match the rows with extra fields (4.8), so
they are treated as column shifts, not as a format.

**Dynamic columns.** Total distinct SOI columns across F04–F07: 302 (61 in F04, 168 in F05, 249 in
F06, 248 in F07). 137 appear in at least three sampled files; 57 appear in all four. The table
below lists every non-preset column seen in at least three files, with non-empty row counts. All
dynamic columns are **Partial** by definition: the readme says their "inclusion and location may
change for each update". Columns seen in only one or two files are counted in the snapshots and
not listed here.

<!-- soi-dynamic-columns:start -->

| Column (as in header) | F05 2022q4 | F06 2025q4 | F04 2026_07 | F07 2026_08 | Observed value classes | Status |
|---|---|---|---|---|---|---|
| Adjusted cost basis | 34,326 | 113,517 | 8,895 | 129,485 | decimal | Partial |
| Asset Acquisition Axis | 396 | 1 | absent | 1 | decimal, text | Partial |
| Asset Class Axis | 495 | 264 | 28 | 956 | text | Partial |
| Award Date Axis | 364 | 3 | absent | 2 | text | Partial |
| Business Acquisition Axis | 2 | 2 | absent | 11 | text | Partial |
| Cash and cash equivalents | 2 | 69 | absent | 82 | decimal | Partial |
| Cash and Cash Equivalents Axis | 17 | 245 | 8 | 255 | text | Partial |
| Cash equivalents | absent | 118 | 4 | 116 | decimal | Partial |
| Changes in fair value of warrant and derivative liabilities | 27 | 60 | absent | 114 | decimal | Partial |
| Class of Financing Receivable Axis | 9 | 3 | absent | 2 | text | Partial |
| Class of Stock Axis | 1,257 | 187 | 6 | 176 | text | Partial |
| Collaborative Arrangement and Arrangement Other than Collaborative Axis | 3 | 7 | absent | 15 | digits_8, text | Partial |
| Collateral Held Axis | 116 | 5 | absent | 6 | text | Partial |
| Concentration percentage | 180 | 782 | absent | 913 | decimal | Partial |
| Concentration Risk Benchmark Axis | 190 | 1,046 | 38 | 1,041 | digits_8, text | Partial |
| Concentration Risk Type Axis | 189 | 950 | 78 | 1,041 | text | Partial |
| Consolidated Entities Axis | 219 | 233 | 2 | 370 | integer, text | Partial |
| Consolidation Items Axis | absent | 6 | 6 | 111 | text | Partial |
| Counterparty Name Axis | 22 | 191 | absent | 381 | decimal, text | Partial |
| Credit Facility Axis | 1,889 | 828 | absent | 806 | text | Partial |
| Credit line maximum | 5 | 16 | absent | 9 | decimal | Partial |
| Currency Axis | 78 | 75 | absent | 8 | text | Partial |
| Customer Axis | 7 | 13 | 6 | 16 | text | Partial |
| Debt Instrument Axis | 4,697 | 398 | 6 | 518 | decimal, text | Partial |
| Debt Instrument, Basis Spread on Variable Rate | 31 | 231 | absent | 198 | decimal | Partial |
| Debt Instrument, Interest Rate Terms | 1,640 | 28 | absent | 90 | decimal, integer, text | Partial |
| Debt Instrument, Redemption, Period Axis | 7 | 12 | absent | 12 | decimal, text | Partial |
| Derivative Asset | 48 | 80 | absent | 112 | decimal | Partial |
| Derivative Asset, Counterparty Name [Extensible Enumeration] | 111 | 9 | absent | 1 | url | Partial |
| Derivative Asset, Gross Asset Including Not Subject to Master Netting Arrangement | 35 | 104 | 2 | 101 | decimal | Partial |
| Derivative Asset, Not Subject to Master Netting Arrangement | 2 | 2 | absent | 2 | decimal | Partial |
| Derivative Asset, Notional Amount | 180 | 973 | 2 | 1,210 | decimal | Partial |
| Derivative Asset, Subject to Master Netting Arrangement, Liability Offset | 27 | 293 | absent | 452 | decimal | Partial |
| Derivative Instrument Axis | 1,078 | 658 | absent | 1,067 | text | Partial |
| Derivative Liability, Notional Amount | 180 | 881 | 2 | 1,098 | decimal | Partial |
| Derivative, Basis Spread on Variable Rate | 73 | 196 | absent | 316 | decimal | Partial |
| Derivative, Contract End Date | 1,121 | 640 | 2 | 919 | date_yyyy-mm-dd | Partial |
| Derivative, Currency Bought | 1 | 2 | absent | 3 | integer, text | Partial |
| Derivative, Currency Sold | 1 | 2 | absent | 3 | integer, text | Partial |
| Derivative, Fair Value, Net | 3 | 154 | absent | 282 | decimal | Partial |
| Derivative, Fixed Interest Rate | 28 | 250 | absent | 349 | decimal | Partial |
| Derivative, Notional Amount | 44 | 377 | absent | 720 | decimal | Partial |
| Derivative, Number of Instruments Held | 13 | 6 | absent | 6 | decimal | Partial |
| Equity Components Axis | 1,520 | 50 | absent | 63 | decimal, text | Partial |
| Equity interest owned | 10 | 23 | absent | 26 | decimal | Partial |
| Equity Interest Type Axis | 6 | 4 | absent | 1 | text | Partial |
| Equity Method Investment, Additional Information | 200 | 20 | absent | 67 | text | Partial |
| Equity Method Investment, Nonconsolidated Investee Axis | 3 | 12 | 6 | 8 | text | Partial |
| Equity, Attributable to Parent | 2 | 6 | absent | 14 | decimal | Partial |
| Exercise price | 232 | 93 | absent | 133 | decimal | Partial |
| Fair Value Hierarchy and NAV Axis | 809 | 4,805 | 148 | 5,197 | text | Partial |
| Financial Instrument Axis | 891 | 4,023 | 136 | 4,450 | text | Partial |
| Geographical Axis | 2,679 | 2,293 | 179 | 3,229 | text | Partial |
| Hedging Designation Axis | 7 | 40 | absent | 144 | text | Partial |
| Initial fair value of Investment | 38,692 | 129,467 | 9,332 | 147,754 | decimal | Partial |
| Interest and Dividend Income, Securities, Operating | 93 | 193 | absent | 292 | decimal | Partial |
| Interest Rate Derivatives, at Fair Value, Net | 20 | 26 | absent | 39 | decimal | Partial |
| Investment Company, Financial Support to Investee Contractually Required, Amount | 203 | 2,622 | absent | 2,669 | decimal | Partial |
| Investment Company, Financial Support to Investee Contractually Required, Not Provided, Amount | 243 | 7,594 | absent | 8,597 | decimal | Partial |
| Investment Company, Nonconsolidated Subsidiary Axis | 2,051 | 2,175 | 17 | 2,940 | text | Partial |
| Investment Owned, Face Amount | 918 | 658 | absent | 822 | decimal | Partial |
| Investment shares | 4,880 | 12,286 | 1,374 | 13,439 | decimal | Partial |
| Investment, Acquisition Date | 1,594 | 10,664 | 488 | 14,806 | date_yyyy-mm-dd, decimal | Partial |
| Investment, Industry Sector [Extensible Enumeration] | 2,326 | 3,889 | absent | 4,484 | decimal, url | Partial |
| Investment, Interest Rate, Floor | 2,835 | 18,629 | 273 | 21,453 | decimal, url | Partial |
| Investment, Interest Rate, Paid in Cash | 423 | 5,381 | 86 | 5,389 | decimal | Partial |
| Investment, Interest Rate, Paid in Kind | 1,603 | 8,739 | 794 | 11,090 | decimal | Partial |
| Investment, Issuer Affiliation [Extensible Enumeration] | 2,014 | 1,911 | absent | 2,178 | decimal, url | Partial |
| Investment, Issuer Geographic Region [Extensible Enumeration] | 1,402 | 759 | absent | 2,305 | url | Partial |
| Investment, Issuer Name [Extensible Enumeration] | 1,998 | 3,057 | absent | 2,996 | url | Partial |
| Investment, Issuer Name Axis | 2,053 | 6,944 | 856 | 7,635 | text | Partial |
| Investment, Name Axis | 10,184 | 633 | 77 | 981 | text | Partial |
| Investment, Non-income Producing [true false] | 1,717 | 1,754 | absent | 2,033 | boolean_text, url | Partial |
| Investment, Restriction Status [true false] | 1,515 | 345 | absent | 430 | boolean_text | Partial |
| Investment, Significant Unobservable Input [true false] | 580 | 2,032 | absent | 2,138 | boolean_text | Partial |
| Investment, Tax Basis, Unrealized Gain | 3 | 0 | absent | 0 | boolean_text, decimal | Partial |
| Investment, Tax Basis, Unrealized Gain (Loss) | 3 | 14 | absent | 6 | decimal | Partial |
| Investment, Tax Basis, Unrealized Loss | 2 | 0 | absent | 0 | decimal | Partial |
| Investment, Type [Extensible Enumeration] | 1,929 | 2,853 | absent | 3,214 | url | Partial |
| Investment, Variable Interest Rate, Type [Extensible Enumeration] | 1,471 | 30,162 | 127 | 40,809 | url | Partial |
| InvestmentHoldings | 51 | 79 | absent | 79 | text | Partial |
| Investments | 472 | 84 | absent | 503 | decimal, url | Partial |
| Investments in and Advances to Affiliates, at Fair Value, Gross Additions | 149 | 662 | absent | 825 | decimal | Partial |
| Investments in and Advances to Affiliates, at Fair Value, Gross Reductions | 158 | 655 | absent | 749 | decimal | Partial |
| Investments, Fair Value Disclosure | 36 | 70 | absent | 460 | decimal | Partial |
| Legal Entity Axis | 4,488 | 1,772 | 495 | 1,246 | text | Partial |
| Lender Name Axis | 4 | 4 | 4 | absent | text | Partial |
| Lien Category Axis | 803 | 9 | absent | 12 | text | Partial |
| Long-Lived Tangible Asset Axis | 22 | 24 | absent | 42 | text | Partial |
| Long-term Debt, Type Axis | 4,368 | 340 | 3 | 267 | text | Partial |
| Loss Contingency Nature Axis | 8 | 10 | absent | 11 | text | Partial |
| Measurement Basis Axis | 6 | 28 | absent | 28 | text | Partial |
| Measurement Frequency Axis | 96 | 401 | absent | 450 | text | Partial |
| Measurement Input Type Axis | 139 | 786 | 41 | 946 | text | Partial |
| Net Assets | 4 | 10 | absent | 1 | decimal | Partial |
| Noninvestment Asset Less Noninvestment Liability, Percent of Net Asset | 2 | 0 | absent | 0 | decimal | Partial |
| Open Forward Foreign Currency Contract, Identifier Axis | 289 | 1,490 | 4 | 1,988 | text | Partial |
| Option Indexed to Issuer's Equity, Type Axis | 19 | 4 | absent | 4 | text | Partial |
| Ownership Axis | 997 | 384 | absent | 328 | text | Partial |
| Payments for (Proceeds from) Investments | 12 | 62 | absent | 83 | decimal | Partial |
| Pledging Purpose Axis | 40 | 13 | absent | 12 | text | Partial |
| Position Axis | 57 | 7 | absent | 40 | text | Partial |
| Products and Services Axis | 1,619 | 17 | absent | 44 | text | Partial |
| Range Axis | 337 | 990 | 46 | 1,264 | text | Partial |
| RateType | 8 | 16 | absent | 16 | text | Partial |
| Recognized gain (loss) | 28 | 82 | absent | 63 | decimal | Partial |
| Related Party Axis | 1,080 | 140 | 2 | 142 | text | Partial |
| Related Party Transaction Axis | 3 | 66 | 9 | 3 | text | Partial |
| Security deposit remaining | 4 | 144 | 5 | 182 | decimal | Partial |
| Subsequent Event Type Axis | 14 | 44 | absent | 23 | text | Partial |
| Tax basis | 2 | 0 | absent | 0 | decimal | Partial |
| Trading Activity Axis | 8 | 6 | absent | 31 | text | Partial |
| Unrealized Gain (Loss) on Derivatives | 12 | 323 | absent | 573 | decimal | Partial |
| Unrealized Gain (Loss) on Investments | 58 | 120 | absent | 95 | decimal | Partial |
| Valuation Approach and Technique Axis | 376 | 1,641 | 72 | 1,881 | text | Partial |
| Variable Rate Axis | 1,289 | 372 | absent | 475 | text | Partial |

<!-- soi-dynamic-columns:end -->

### 5.2 Row grain

- **Documented:** "one row for each holding"; "No key is defined" (S2 section 5.08).
- **Observed:** no candidate key is unique. Whole rows are never duplicated.

| Candidate key | F04 duplicates | F05 duplicates | F06 duplicates | F07 duplicates |
|---|---|---|---|---|
| adsh + identifier + ddate | 2,466 | 29,065 | 48,364 | 58,914 |
| adsh + identifier + ddate + qtrs | 1,977 | 27,040 | 36,920 | 43,422 |
| entire row | 0 | 0 | 0 | 0 |

- Rows per accession (F07): 163 accessions, from 57 to 4,790 rows each, median 891.
- Distinct `ddate` values per accession range from 1 to 17 (F07), so one filing carries
  prior-period comparative rows and other dated facts alongside the current holdings.
- `ddate` is earlier than `period` in 88,838 of 181,907 F07 rows, equal in 93,049, and later in 20.
- Rows with an empty identifier: F07 42,688 of 181,907 (totals, subtotals, or facts without the
  identifier axis).

**Conclusion:** a row is a pivot of facts sharing one combination of axis members and one
`ddate`/`qtrs` context, not a guaranteed single holding. Selecting current holdings requires at
least `ddate = period` and `qtrs = 0`, and even then duplicates remain. This is an OPEN QUESTION
(Q6) for the normalization phase.

### 5.3 Identifiers

- **Registrant:** `cik` and `name` are the filing BDC's (Documented). They are never a borrower key.
- **Investment, Identifier Axis:** free text, the typed member supplied by the filer. The readme's
  own example combines an instrument type and a company name with `|`. Observed `|` counts per
  non-empty identifier vary by file: F07 has 73,728 with none, 44,518 with one, 13,555 with two,
  438 with three, and 6,980 with four or more; F05 has almost none. There is no fixed structure.
- **Investment, Issuer Name Axis** (dynamic): a separate issuer-name member, present in a minority
  of rows (F07: 7,635). **Investment, Issuer Name [Extensible Enumeration]** holds URI values
  (F07: 2,996).
- No borrower identifier (LEI or similar) exists in SOI.

### 5.4 Units and scale

- **SOI has no unit column** (Documented by omission; Observed).
- **Units via NUM (Observed, not a documented join).** Joining SOI to NUM on `adsh`, `ddate`, and
  the identifier typed member recovers the unit. Principal amounts in F07 NUM facts on
  identifier-axis rows carry USD in 92,285 facts and 15 other currencies (EUR, GBP, CAD, AUD, SEK,
  and others) in the rest. Cost and fair value facts likewise include non-USD currencies.
  **Currency cannot be determined from SOI alone.**
- **Value agreement (Observed).** For SOI rows with an identifier, the share of SOI values that
  equal a NUM fact of the expected standard tag for the same accession, date, and identifier:

| SOI column | Expected NUM tag | F04 | F05 | F06 | F07 |
|---|---|---|---|---|---|
| Investment Interest Rate | InvestmentInterestRate | 3,668/3,668 | 9,357/9,358 | 59,517/59,816 | 68,906/69,145 |
| Investment, Basis Spread, Variable Rate | InvestmentBasisSpreadVariableRate | 3,996/3,996 | 17,821/17,833 | 66,024/66,345 | 81,258/81,500 |
| Investment Owned, Balance, Principal Amount | InvestmentOwnedBalancePrincipalAmount | 5,290/5,290 | 19,700/19,706 | 78,649/79,060 | 91,914/92,251 |
| Investment Owned, Net Assets, Percentage | InvestmentOwnedPercentOfNetAssets | 3,262/3,262 | 14,946/14,950 | 49,983/50,105 | 58,034/58,157 |
| Adjusted cost basis (dynamic) | InvestmentOwnedAtCost | 7,320/7,320 | 21,286/21,289 | 92,986/93,405 | 106,319/106,665 |
| Initial fair value of Investment (dynamic) | InvestmentOwnedAtFairValue | 7,398/7,398 | 22,471/22,474 | 99,904/100,322 | 115,342/115,697 |

  Almost every miss is a row whose identifier had no NUM fact at all under that key. The preset
  "Investment Owned, Cost" and "Investment Owned, Fair Value" columns are essentially empty in every
  file, while the dynamic "Adjusted cost basis" and "Initial fair value of Investment" columns carry
  values that equal the standard cost and fair-value facts. Why SOI labels these columns this way,
  and whether that will persist, is **OPEN QUESTION (Q14)**.
- **Scale.** NUM `value` is "not scaled" (Documented). Rates and percentages are mostly fractions:
  in F07 NUM identifier-axis facts, interest rates are below 1 in 70,292 facts and between 1 and 100
  in 5; spreads below 1 in 83,303 and between 1 and 100 in 2; percent of net assets below 1 in
  42,864 and between 1 and 100 in 57. Rate `uom` values are `pure` or `Rate`. A small set of
  whole-number percentages therefore exists; scale per filer is **OPEN QUESTION (Q4)**.

### 5.5 Dates

- `ddate`, `filed`, `period`, and `Investment Maturity Date` are `yyyy-mm-dd` in all sampled rows
  (Observed; matches the in-archive readme; S2 says `mm/dd/yyyy`, see section 14).
- `ddate` and `period` are rounded to the nearest month end (Documented). The exact balance-sheet
  date is not in SOI; it is in the filing (Level 2) or the submissions `reportDate` array (observed
  key, section 7).
- SUB uses `yyyymmdd` for `period` and `filed` (Documented+Observed).

### 5.6 `qtrs`

- **Documented** (in-archive readme, SOI, NUM, and TXT field tables): "The count of the number of
  quarters represented by the data value, rounded to the nearest whole number. '0' indicates it is a
  point-in-time value." S1 notes say it was added to SOI in September 2026 "to help distinguish
  duration facts". S2 does not mention it.
- **Observed** in SOI:

| qtrs | F04 | F05 | F06 | F07 |
|---|---|---|---|---|
| 0 | 9,479 | 45,542 | 141,946 | 162,530 |
| 1 | 152 | 8 | 159 | 232 |
| 2 | 95 | 167 | 103 | 8,698 |
| 3 | 0 | 3,390 | 7,206 | 1,520 |
| 4 | 243 | 3,640 | 6,699 | 8,898 |
| 5 or more | 0 | 0 | 2 | 29 |

- **Status:** definition Documented+Observed. How SOI combines point-in-time and duration facts in
  one row is **OPEN QUESTION (Q15)**.

### 5.7 Limitations

- Custom tags and custom axes are documented as excluded, yet the observed headers include
  CamelCase names that look like filer-defined labels (for example `InvestmentInterestRateFloor`,
  `RateType`, `InvestmentHoldings`). **OPEN QUESTION (Q16).**
- Dynamic columns change between files (61 to 249 columns in the sample).
- No key (5.2).
- The September 2026 refresh re-parsed SOI; older downloaded copies of the same URL differ.
- Amendments appear "as filed" (section 11).
- `cstm` is observed as 0/1, while the documentation says 1 = TRUE and 2 = FALSE (section 14).

## 6. BDC Report

- **Documented (S4 page, F15):** "basic identification information for all entities with an
  'active' filing status that have been issued an 814- reporting number", including N-6F filers,
  BDCs that have not begun selling shares, and entities that ceased operations without withdrawing.
  Fields: Reporting File Number, CIK ("a ten digit number"), Name of Registrant, Address_1,
  Address_2, City, State, Zip Code, Date Last Filing, Type Last Filing. Files are listed per year
  back to 2012. The 2016–2026 CSV links carry an adjacent "Updated" date (2026 file: 6/1/2026);
  the 2012–2015 CSV links have none (Observed, F15).
- **Observed CSV header (F08):** `File_No, CIK, Registrant_Name, Address_1, Address_2, City, State,
  Zip_Code, Filing Date, Filing Type`. 212 rows, no field-count mismatches. CIK is 10 digits with
  leading zeros in all 212 rows. `Filing Type` holds many form types (8-K and 10-Q most common).
- **Observed XML (F09):** root element with one `company` element per registrant (212), children
  `file_number, cik, registrant_name, address_1, address_2, city, state, zip_code,
  last_filling_date, last_filling_type` (spelling as in the file). `address_2` present in 114,
  `zip_code` in 210.
- **Not contained:** ticker, adviser/manager, public/private type, BDC status beyond "active".

### 6.1 Yearly files and layouts (Observed, F20–F33)

- **Year label (Observed, F15):** each CSV and XML link on the page has link text equal to the year
  and an adjacent "Updated" date. File names follow two patterns
  (`business-development-company-YYYY.csv` for 2024–2026, `business_development_company_YYYY.csv`
  for 2012–2023) and one file has no year in its name: `business_development_company.csv`, whose
  link text is `2016` ("Updated 09/23/2016"). The year is taken from the link text, never guessed
  from the file name.
- **Layouts (Observed):** all files are UTF-8 with CRLF line endings and no field-count mismatches.

| Years | Fixtures | Header | CIK cells | Date cells | Byte-order mark | Phase 2 use |
|---|---|---|---|---|---|---|
| 2025–2026 | F08, F20 | Identical to the verified 2026 layout | 10 digits, zero-padded | `mm/dd/yy` | Yes | Loaded |
| 2020–2024 | F21–F25 | Identical to the verified 2026 layout | 10 digits, zero-padded | `mm/dd/yy` | No | Loaded; the mark is optional |
| 2016, 2018, 2019 | F29, F27, F26 | `rep_file_num, CIK, entity_name, street1, street2, city, state_code, zip, filing_date, doc_type_code` | 10 digits | `mm/dd/yy`, and a literal `[NULL]` | No | Not loaded (layout differs) |
| 2017 | F28 | First row is a title, not a header | n/a | n/a | No | Not loaded (layout differs) |
| 2015 | F30 | The page's field names (`Reporting File Number`, `Name of Registrant`, ...) | 10 digits | `mm/dd/yy`, one 5-digit value, one empty | No | Not loaded (layout differs) |
| 2014 | F31 | `Reporting File Number, CIK Number, Name of Registered Investment Company, ...` | 5–7 digits, unpadded | `m/d/yyyy` | No | Not loaded (layout differs) |
| 2013 | F32 | Leading and trailing unnamed columns, space-padded names, `sub_type` before `last_filing_date` | 10 digits | `mm/dd/yy` | No | Not loaded (layout differs) |
| 2012 | F33 | Lowercase names matching the XML elements (`last_filling_date`, ...) | 5–7 digits, unpadded | Date-time text such as `Mon dd yyyy h:mmAM`, some empty or `[NULL]` | No | Not loaded (layout differs) |

Only the 2020–2026 files are parsed (decision recorded in the Phase 2 approval). The 2012–2019
files are verified and documented but not loaded; a later phase may add one documented parser per
layout.

## 7. Submissions JSON

- **URL rule (Documented, S5 page F16):** `https://data.sec.gov/submissions/CIK##########.json`, a
  10-digit CIK with leading zeros. No authentication.
- **Documented contents:** current name, former names, exchanges and tickers, a `filings` object
  whose recent part holds "at least one year's of filing or to 1,000 (whichever is more)" filings
  in columnar arrays, and a `files` array pointing to additional JSON files with date ranges.
- **Observed key inventory (F11, F12; Observed, not documented):**
  - Top level: `addresses` (`business`, `mailing`), `category`, `cik` (string), `description`,
    `ein`, `entityType`, `exchanges` (array), `filings`, `fiscalYearEnd`, `flags`, `formerNames`
    (array of `name`, `from`, `to`), `insiderTransactionForIssuerExists`,
    `insiderTransactionForOwnerExists`, `investorWebsite`, `lei`, `name`, `ownerOrg`, `phone`,
    `sic`, `sicDescription`, `stateOfIncorporation`, `stateOfIncorporationDescription`, `tickers`
    (array), `website`.
  - `filings.recent` column arrays (16, equal length): `accessionNumber`, `filingDate`,
    `reportDate`, `acceptanceDateTime`, `act`, `form`, `fileNumber`, `filmNumber`, `items`,
    `core_type`, `size`, `isXBRL`, `isInlineXBRL`, `isXBRLNumeric`, `primaryDocument`,
    `primaryDocDescription`.
  - `filings.files[]` entries: `name`, `filingCount`, `filingFrom`, `filingTo`.
- **Pagination (Observed):** recent arrays hold 1,001 entries (F11) and 1,000 (F12); both files have
  one entry in `files[]`.
- **Join to SOI (Observed):** every SOI accession for these CIKs in the cached datasets appears in
  `filings.recent.accessionNumber` (F11: 3/3; F12: 1/1).
- **Value formats (Observed, F11, F12, F19a, F19b):** top-level `cik` is a 10-digit zero-padded
  string; `filingDate` and non-empty `reportDate` are `yyyy-mm-dd`; `acceptanceDateTime` and the
  `formerNames[].from`/`to` values are `yyyy-mm-ddThh:mm:ss.sssZ` text (the time zone meaning is not
  documented, Q22); `isXBRL` and `isInlineXBRL` are 0 or 1. `reportDate`, `act`, `fileNumber`,
  `filmNumber`, `items`, and `primaryDocDescription` are empty strings for some filings (for example
  F19a: `reportDate` empty in 260 of 560). `accessionNumber`, `filingDate`, `form`,
  `acceptanceDateTime`, and `primaryDocument` were never empty in the samples.
- **Accession prefix (Observed):** differs from the registrant CIK for 884 of 1,001 recent filings
  in F11 and for all 560 filings in F19a.

### 7.1 Additional submissions pages (Observed, F19a, F19b)

- **Documented (S5 page, F16):** "If the entity has additional filings, files will contain an array
  of additional JSON files and the date range for the filings each one contains." The page does not
  state the URL of those files.
- **URL rule (Observed, not documented):** `https://data.sec.gov/submissions/{name}`, where `{name}`
  is `filings.files[].name` (for example `CIK##########-submissions-001.json`). Confirmed by two
  fetches (F19a from F11, F19b from F12): HTTP 200 and JSON content matching the parent entry.
- **Structure (Observed):** the page's top level is the same 16 column arrays as
  `filings.recent`, in the same order, with no wrapping object and no entity metadata. Array
  lengths equal the parent entry's `filingCount` (560, 98); every `filingDate` is inside the
  entry's `filingFrom`–`filingTo`; no accession also appears in the parent's `filings.recent`.
- **Completeness rule used in Phase 2:** a registrant's filing history is complete only when every
  `files[]` entry was fetched and its array length equals `filingCount`.

### 7.2 Registry field register (Phase 2)

Every source field that Phase 2 loads, with its evidence class. **Observed does not mean
authoritative**: observed fields are loaded at the source's evidence level and labeled with their
documentation status in `ref.registry_field_mapping`.

| Source | Field | Status | Evidence | Loaded as |
|---|---|---|---|---|
| S4 CSV | `File_No` | Available | Documented+Observed (F15 "Reporting File Number"; F08, F20–F25) | Registrant `FILE_NUMBER` |
| S4 CSV | `CIK` | Available | Documented+Observed (F15; F08, F20–F25) | Registrant CIK |
| S4 CSV | `Registrant_Name` | Available | Documented+Observed (F15; F08, F20–F25) | Registrant `NAME` |
| S4 CSV | `Address_1`, `Address_2`, `City`, `State`, `Zip_Code` | Available | Documented+Observed (F15; F08, F20–F25) | Registrant address attributes |
| S4 CSV | `Filing Date`, `Filing Type` | Available | Documented+Observed (F15 "Date Last Filing", "Type Last Filing"; F08, F20–F25) | Registrant last-filing attributes |
| S4 CSV | Presence of a row in a yearly file | Available | Documented+Observed (F15; F08, F20–F25) | Registrant `BDC_REPORT_LISTING` (year from the page link text) |
| S4 page | Link text (year) of each CSV | Available | Observed (F15) | Report year label |
| S1 page | Dataset ZIP links | Available | Observed (F01 snapshot `data_file_links`) | Data-set releases |
| S3 SUB | `adsh`, `cik`, `name`, `form`, `period`, `fy`, `fp`, `filed`, `accepted`, `prevrpt`, `inlineurl` | Available | Documented+Observed (in-archive readme; F04–F07) | Filing identity, registrant link, filing attributes |
| S3 SUB | `fileNumber` | Partial | Observed (F04–F07); not documented | Raw row only; not projected |
| S5 | `cik` | Available | Observed (F11, F12); CIK in the URL is Documented (F16) | Must equal the URL CIK |
| S5 | `name`, `formerNames[]` (`name`, `from`, `to`), `tickers[]`, `exchanges[]` | Partial | Observed (F11, F12); contents described in F16 | Registrant attributes and name history |
| S5 | `fiscalYearEnd`, `stateOfIncorporation` | Partial | Observed (F11, F12) | Registrant attributes |
| S5 | `accessionNumber`, `filingDate`, `form`, `primaryDocument` | Partial | Observed (F11, F12, F19a, F19b); "filing history" described in F16 | Filing identity, attributes, primary document |
| S5 | `reportDate`, `acceptanceDateTime`, `fileNumber`, `primaryDocDescription`, `isXBRL`, `isInlineXBRL` | Partial | Observed (F11, F12, F19a, F19b) | Filing attributes (`acceptanceDateTime` raw only) |
| S5 | `filings.files[]` (`name`, `filingCount`, `filingFrom`, `filingTo`) | Partial | Documented array (F16); key names and URL rule Observed (F19a, F19b) | Pagination and completeness |

## 8. EDGAR Archives URL construction

- **Documented (S9, F14):** filing folder `/Archives/edgar/data/{cik}/{accession-no-dashes}/`,
  containing all documents of the filing; `{accession}.txt`; `{accession}-index.html`;
  `{accession}.hdr.sgml`; `index.json` as a JSON version of the directory listing.
- **Accession prefix (Documented, S9):** the first ten digits are the CIK of the submitting entity,
  "the company or a third-party filer agent". Observed: the prefix differs from the registrant CIK
  in 112,138 of 181,907 F07 SOI rows (F04: 5,080 of 9,969). **Never derive the registrant from the
  accession number.**
- **SOI `inlineurl` (Observed, F04–F07, 100% of rows):**
  `https://www.sec.gov/ix?doc=/Archives/edgar/data/{cik}/{accession-no-dashes}/{document}`, the
  inline viewer wrapping an archive path. The CIK in the path equals the registrant CIK, has no
  leading zeros, and the accession equals `adsh` without dashes.
- **Primary document name:** the last path segment of `inlineurl` (Observed), also listed in the
  submissions `primaryDocument` array (observed key).
- **`index.json` (Observed, F13a):** `directory` with `name`, `parent-dir`, and `item[]` entries of
  `name`, `type`, `size`, `last-modified`. The sampled folder has 106 items (92 `.htm`, 6 `.xml`,
  plus `.xsd`, `.zip`, `.json`, `.txt`, `.css`, `.js`).
- **Primary document (Observed, F13b):** inline XBRL with an `ix:header`, 22,756 `ix:nonFraction`
  and 192 `ix:nonNumeric` elements, and all six investment concepts from 5.4 present.
- **Level 2 check (Observed, F13b):** all 2,889 distinct SOI identifier strings for this accession
  occur verbatim in the document text after entity decoding and whitespace normalization (2,889
  found, 0 missing). Only the counts are recorded.
- **Inline XBRL fact format and context period (Documented, EDGAR XBRL Guide
  https://www.sec.gov/files/edgar/filer-information/specifications/xbrl-guide-2026-05-15.pdf
  section 11.12; Observed in one stored 10-Q primary document).** EDGAR instances follow Inline
  XBRL 1.1 and may use XBRL International Transformation Registry versions 2020-02-12 to
  2022-02-16. In that registry `ixt:fixed-zero` maps any displayed string to the value 0. The
  observed document binds `ixt` to the 2020-02-12 registry namespace; 1,096 of its 1,103
  `ixt:fixed-zero` facts display an em dash and the other 7 display words. The maturity binder
  reads only the em dash display as 0. Each `xbrli:context` period is an `xbrli:instant` or an
  `xbrli:startDate`/`xbrli:endDate` pair; the binder compares the instant or end date with SOI
  `ddate` as the same `yyyy-mm-dd` with no rounding (5.5).

### 8.1 Inline XBRL footnotes

Authoritative sources: XBRL International, *Inline XBRL Part 1: Specification 1.1*,
Recommendation of 2013-11-18 (sections 6 and 13; full URL in docs/METHODOLOGY.md 7.7, because
this document links only SEC hosts), and the EDGAR XBRL Guide
https://www.sec.gov/files/edgar/filer-information/specifications/xbrl-guide-2026-05-15.pdf
(chapter 9, section 9.4, section 11.11). EDGAR instances follow Inline XBRL 1.1 (section 8 above).

- **`ix:footnote` (Documented, Inline XBRL 1.1 section 6).** Represents an XBRL footnote
  resource (`link:footnote`). It MUST have an `id` attribute and an `xml:lang` in scope; its
  `footnoteRole` defaults to the XBRL 2.1 footnote role when absent. The specification ties an
  `ix:footnote` to the facts it refers to only through `ix:relationship`.
- **`ix:relationship` (Documented, Inline XBRL 1.1 section 13.1).** A child of `ix:resources`
  with required `fromRefs` and `toRefs` lists of ids and optional `arcrole`, `linkRole`, and
  `order`. Table 14 defines the `{arcrole}` property as "the actual value of the `arcrole`
  attribute or, if absent," the XBRL 2.1 `fact-footnote` arcrole. If any `toRefs` target is an
  `ix:footnote`, every target must be one, and each fact in `fromRefs` maps to a footnote arc
  from that fact to each footnote in the target document. Fact-to-fact relationships use other
  arcroles, for example `fact-explanatoryFact`.
- **Fact-footnote relationship.** A footnote is linked to a fact when an `ix:relationship` lists
  the fact id in `fromRefs`, the `ix:footnote` id in `toRefs`, and either has no `arcrole`
  (specification default) or has exactly the `fact-footnote` arcrole.
- **EDGAR restrictions (Documented, EDGAR XBRL Guide).** Chapter 9 lists "XBRL footnotes that
  are not local or use custom relationships" among features EDGAR does not permit. Section 9.4
  requires every `link:footnote` to be the target of at least one footnote arc (Dangling Footnote,
  EFM 6.5.33) and requires standard footnote roles. Section 11.11 does not restrict `ix:footnote`
  or `ix:relationship` (it disallows `ix:tuple`, `ix:fraction`, `target`, and `xml:base`).
- **Visible "(n)" label (Observed presentation convention, not an XBRL requirement).** Neither
  source defines a visible label, its text, or its position. In the stored BDC schedules audited
  for P7 (14 documents) the filer prints a label such as "(2)" immediately before the
  `ix:footnote` element and prints the same "(n)" after the text of a schedule cell. Labels are
  not unique within a document: the same "(n)" labels a different `ix:footnote` in 13 of the 14
  documents (for example once per period schedule). One filer's documents omit `arcrole` on
  `ix:relationship`. A label is therefore treated as a candidate only, verified against the
  footnotes linked from facts on the same table row (docs/METHODOLOGY.md 7.7).

## 9. Identifiers and join keys

| Key | Where it appears | Documented join? | Observed match | Caveats |
|---|---|---|---|---|
| `adsh` SOI/NUM/TXT to SUB | All tables | Yes (S2 Figure 2) | 100% of SOI rows (F04–F07) | Accession prefix may be a filer agent |
| SOI `adsh` to submissions `accessionNumber` | S3, S5 | No | F11 3/3, F12 1/1 | Only the recent arrays checked |
| SOI CIK to BDC Report CIK | S3, S4 | No | 152 of 177 distinct SOI registrant CIKs (JOINS) | SOI unpadded, BDC Report zero-padded; compare numerically |
| SOI CIK to submissions CIK | S3, S5 | No | Both F11 and F12 resolve | URL needs 10-digit zero padding |
| CIK to ticker file | S3/S4, S8 | No | 53 of 177 SOI CIKs; 49 of 212 BDC Report CIKs (JOINS) | Most BDCs have no ticker entry |
| `inlineurl` to archive path | S3, S7 | No | 100% pattern match; CIK and accession consistent (F04–F07) | Viewer prefix must be removed |
| SOI identifier to NUM typed member | S3 | No | See 5.4 value agreement | Member string must match exactly |

## 10. Period semantics

| Field | Meaning | Evidence |
|---|---|---|
| SUB/SOI `period` | Balance-sheet date rounded to nearest month end | Documented+Observed |
| `ddate` | End date of the data value, rounded to month end; can be earlier or later than `period` | Documented+Observed |
| `qtrs` | Quarters covered; 0 = point in time | Documented (in-archive readme)+Observed |
| `fy`, `fp` | Fiscal year and period focus from the filing | Documented+Observed (SUB) |
| `filed` | EDGAR filing date | Documented+Observed |
| `accepted` | EDGAR acceptance date-time | Documented+Observed (SUB) |
| Submissions `reportDate` | Present as a column array; meaning not documented | Observed (F11, F12) |
| Dataset file period | Filing-date window (3.6) | Documented+Observed |

## 11. Amendments and refreshes

- **Amendments:** 10-Q/A and 10-K/A appear in SUB and SOI (F04, F06). SUB `prevrpt` ("subsequently
  amended prior to the end cutoff") is 0 in every sampled row, including files that contain
  amendments. Because files are filing-date windows, an original and its amendment usually sit in
  different files, and nothing in a later file flags the earlier original. Detecting supersession
  across files is **OPEN QUESTION (Q17)**.
- **Refreshes:** SEC republishes all files at the same URLs (September 2026 and July 2026 notes;
  `Last-Modified` 2026-09-18/25 on every sampled ZIP). A different SHA-256 on re-fetch means SEC
  republished the file. Raw files must be stored immutably by checksum with retrieval time; a
  refresh is a new version, never an overwrite.

## 12. Product field availability matrix

Field names are generic. "SOI" means the S3 `soi.tsv` report.

| Field group | Field | Candidate source | Exact source field | Status | Evidence | Notes |
|---|---|---|---|---|---|---|
| Registrant | CIK | S3 SOI/SUB; S4; S5 | `cik`; `CIK`; `cik` | Available | Documented+Observed (F04–F07, F08, F11) | Unpadded in S3, zero-padded in S4 and the S5 URL |
| Registrant | Name | S3 SOI/SUB | `name` | Available | Documented+Observed (F04–F07) | Name as of the filing date |
| Registrant | Ticker | S8; S5 | `ticker`; `tickers` | Partial | Observed (F10, F11, F12) | Not in S3 or S4; S8 covers 53 of 177 sampled SOI CIKs |
| Registrant | Reporting period | S3 SUB/SOI | `period`, `fy`, `fp` | Available | Documented+Observed (F04–F07) | Month-end rounded |
| Registrant | Accession | S3 | `adsh` | Available | Documented+Observed (F04–F07) | Prefix may be a filer agent |
| Registrant | Filing date | S3 | `filed` | Available | Documented+Observed (F04–F07) | |
| Registrant | Form | S3 | `form` | Available | Documented+Observed (F04–F07) | Includes /A amendments |
| Registrant | Manager / adviser | none | none | Not available | Not in S3, S4, or S5 key inventory (F04–F12) | Unknown |
| Registrant | Status | S4 | presence in the report | Partial | Documented+Observed (F08, F15) | Report covers "active" 814- entities only; no status field |
| Registrant | Public / private type | none | none | Not available | Not in S3 or S4 (F04–F09) | S5 `exchanges`/`tickers` show listing only; no inference |
| Registrant | Coverage dates | S3 file presence; S5 filing history | `filed` per file; `filings` | Partial | Observed (F04–F07, F11) | Datasets start with reporting periods from Aug 2022 |
| Holding | Raw company name | S3 SOI | `Investment, Identifier Axis`; `Investment, Issuer Name Axis` | Partial | Documented+Observed (F04–F07) | Usually embedded in the identifier text; separate issuer name in a minority of rows |
| Holding | Investment description | S3 SOI | `Investment, Identifier Axis` | Partial | Documented+Observed (F04–F07) | No fixed structure (5.3) |
| Holding | Instrument type | S3 SOI | `Investment Type Axis` | Partial | Documented+Observed (F04–F07) | Sparse (F07: 16,159 of 181,907 rows) |
| Holding | Seniority | S3 SOI; filing | `Lien Category Axis` (dynamic) | Level 2 extraction required | Observed (F05–F07) | Column populated in very few rows |
| Holding | Secured flag | filing | none in SOI | Level 2 extraction required | Observed absence (F04–F07) | |
| Holding | Industry | S3 SOI | `Industry Sector Axis` | Partial | Documented+Observed (F04–F07) | Sparse (F07: 18,190 of 181,907 rows) |
| Holding | Issuer affiliation | S3 SOI | `Investment, Issuer Affiliation Axis` | Partial | Documented+Observed (F04–F07) | |
| Pricing | Interest rate | S3 SOI | `Investment Interest Rate` | Available | Documented+Observed (F04–F07) | Mostly fractions; scale per filer is Q4 |
| Pricing | Reference rate name | S3 SOI | `Investment, Variable Interest Rate, Type [Extensible Enumeration]` (dynamic) | Partial | Observed (F04–F07) | Values are taxonomy URIs |
| Pricing | Spread | S3 SOI | `Investment, Basis Spread, Variable Rate` | Available | Documented+Observed (F04–F07) | Mostly fractions |
| Pricing | Floor | S3 SOI | `Investment, Interest Rate, Floor` (dynamic) | Partial | Observed (F04–F07) | A CamelCase variant also appears (Q16) |
| Pricing | Cash / PIK split | S3 SOI | `Investment, Interest Rate, Paid in Kind`; `Investment, Interest Rate, Paid in Cash` (dynamic) | Partial | Observed (F04–F07) | |
| Pricing | All-in coupon | S3 SOI | `Investment Interest Rate` | OPEN QUESTION | Documented (S2 Figure 10) | Whether the rate includes PIK is not defined (Q18) |
| Dates and economics | Acquisition date | S3 SOI | `Investment, Acquisition Date` (dynamic) | Partial | Observed (F04–F07) | |
| Dates and economics | Maturity | S3 SOI | `Investment Maturity Date` | Available | Documented+Observed (F04–F07) | yyyy-mm-dd |
| Dates and economics | Principal | S3 SOI; NUM for unit | `Investment Owned, Balance, Principal Amount`; NUM `uom` | Available | Documented+Observed (F04–F07) | Currency only via NUM join |
| Dates and economics | Cost | S3 SOI | `Adjusted cost basis` (dynamic); preset `Investment Owned, Cost` empty | Partial | Observed (F04–F07) | Values equal NUM `InvestmentOwnedAtCost` (5.4); Q14 |
| Dates and economics | Fair value | S3 SOI | `Initial fair value of Investment` (dynamic); preset `Investment Owned, Fair Value` empty | Partial | Observed (F04–F07) | Values equal NUM `InvestmentOwnedAtFairValue` (5.4); Q14 |
| Dates and economics | % of net assets | S3 SOI | `Investment Owned, Net Assets, Percentage` | Available | Documented+Observed (F04–F07) | Mostly fractions; Q4 |
| Status flags | Non-accrual | S3 SOI; filing | `Financial Instrument Performance Status Axis` (dynamic) | Level 2 extraction required | Observed (F06, F07) | At most 8 rows per file |
| Status flags | Restricted | S3 SOI | `Investment, Restriction Status [true false]` (dynamic) | Partial | Observed (F05–F07) | Sparse |
| Status flags | Region / country | S3 SOI | `Geographical Axis`; `Investment, Issuer Geographic Region [Extensible Enumeration]` (dynamic) | Partial | Observed (F04–F07) | |
| Status flags | Fair-value level | S3 SOI | `Fair Value Hierarchy and NAV Axis` (dynamic) | Partial | Observed (F04–F07) | |
| Status flags | Footnotes | S3 NUM/TXT | `footnote` | Partial | Documented+Observed (F04–F07) | Not in SOI; join needed; no truncation since June 2026 |
| Our provenance | Source URL | S3 SOI; S7 | `inlineurl`; archive path | Available | Documented+Observed (F04–F07, F13a) | Remove the viewer prefix for the archive URL |
| Our provenance | Retrieval time | our fetch metadata | `retrieved_at`, `last_modified` | Available | Observed (manifest, F01–F18) | Recorded by our fetcher, not by SEC |
| Our provenance | Parser version | none (our own field) | none | Not available | Not an SEC field (F01–F18) | Produced by our own pipeline in a later phase |
| Enrichment | Sponsor | none | none | Not available | Not in S3, S4, S5 (F04–F12) | Never inferred |
| Enrichment | EBITDA | none | none | Not available | Not in S3 SOI (F04–F07) | Never inferred |
| Enrichment | Leverage | none | none | Not available | Not in S3 SOI (F04–F07) | Never inferred |
| Enrichment | OID | none | none | Not available | Not in S3 SOI preset columns (F04–F07) | Never inferred |

## 13. Fixture register

Rendered from `fixtures/sec/manifest.json`. Every fixture has `storage: cache`; the raw file is in
the ignored `.cache/sec/` only. SHA-256 is of the response body after HTTP content decoding; full
values are in the manifest.

| ID | Source | Type | URL | Period | HTTP | Bytes | SHA-256 (prefix) | Last-Modified |
|---|---|---|---|---|---|---|---|---|
| F01 | S1 | sec_web_page | https://www.sec.gov/data-research/sec-markets-data/bdc-data-sets | as retrieved | 200 | 83,285 | 84e94ba002a0 | 2026-09-28 |
| F02 | S2 | sec_documentation_pdf | https://www.sec.gov/files/bdc_readme.pdf | as retrieved | 200 | 355,310 | 661838034b62 | 2026-06-11 |
| F03 | S3 | bdc_dataset_zip | https://www.sec.gov/files/datastandardsinnovation/data/business-development-company-bdc-data-sets/2026_06_bdc.zip | 2026-06 | 200 | 83,284 | d14a5a744647 | 2026-09-18 |
| F04 | S3 | bdc_dataset_zip | https://www.sec.gov/files/datastandardsinnovation/data/business-development-company-bdc-data-sets/2026_07_bdc.zip | 2026-07 | 200 | 2,459,486 | dded644dc587 | 2026-09-18 |
| F05 | S3 | bdc_dataset_zip | https://www.sec.gov/files/datastandardsinnovation/data/business-development-company-bdc-data-sets/2022q4_bdc.zip | 2022Q4 | 200 | 11,875,936 | 3c06eedaf224 | 2026-09-18 |
| F06 | S3 | bdc_dataset_zip | https://www.sec.gov/files/datastandardsinnovation/data/business-development-company-bdc-data-sets/2025q4_bdc.zip | 2025Q4 | 200 | 35,135,856 | 094216b9f962 | 2026-09-18 |
| F07 | S3 | bdc_dataset_zip | https://www.sec.gov/files/datastandardsinnovation/data/business-development-company-bdc-data-sets/2026_08_bdc.zip | 2026-08 | 200 | 75,870,583 | 0529ab8920f4 | 2026-09-25 |
| F08 | S4 | bdc_report_csv | https://www.sec.gov/files/investment/data/other/business-development-company-report/business-development-company-2026.csv | 2026 | 200 | 24,369 | e90392f21824 | 2026-06-01 |
| F09 | S4 | bdc_report_xml | https://www.sec.gov/files/investment/data/other/business-development-company-report/business-development-company-2026.xml | 2026 | 200 | 84,477 | b6669d7349a9 | 2026-06-01 |
| F10 | S8 | sec_reference_json | https://www.sec.gov/files/company_tickers_exchange.json | as retrieved | 200 | 523,297 | affa8f025ab3 | 2026-09-25 |
| F11 | S5 | submissions_json | https://data.sec.gov/submissions/CIK0001287750.json | as retrieved | 200 | 162,404 | 44561da5551e | — |
| F12 | S5 | submissions_json | https://data.sec.gov/submissions/CIK0001587987.json | as retrieved | 200 | 165,268 | d6e39a9b5390 | — |
| F13a | S7 | filing_index_json | https://www.sec.gov/Archives/edgar/data/1287750/000162828026050307/index.json | filing folder | 200 | 10,072 | ea70660735c6 | — |
| F13b | S7 | filing_primary_document | https://www.sec.gov/Archives/edgar/data/1287750/000162828026050307/arcc-20260630.htm | filing | 200 | 24,846,131 | e500d1f0705d | 2026-07-29 |
| F14 | S9 | sec_web_page | https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data | as retrieved | 200 | 80,302 | c0b624c4f7e3 | 2026-09-26 |
| F15 | S4 | sec_web_page | https://www.sec.gov/data-research/sec-markets-data/opendatasetsshtmlbdc | as retrieved | 200 | 89,283 | ae5916e8f7b0 | 2026-09-28 |
| F16 | S5 | sec_web_page | https://www.sec.gov/edgar/sec-api-documentation (redirects to https://www.sec.gov/search-filings/edgar-application-programming-interfaces) | as retrieved | 200 | 68,946 | e0c42c651f77 | 2026-09-26 |
| F17 | S10 | sec_web_page | https://www.sec.gov/os/webmaster-faq (redirects to https://www.sec.gov/about/webmaster-frequently-asked-questions) | as retrieved | 200 | 96,702 | f58b3de7a0d5 | 2026-09-26 |
| F18 | S10 | sec_web_page | https://www.sec.gov/privacy.htm (redirects to https://www.sec.gov/about/privacy-information) | as retrieved | 200 | 90,345 | d259a7e9bf20 | 2026-09-26 |
| F19a | S5 | submissions_page_json | https://data.sec.gov/submissions/CIK0001287750-submissions-001.json | as retrieved | 200 | 90,864 | d8c6b0fa7a01 | — |
| F19b | S5 | submissions_page_json | https://data.sec.gov/submissions/CIK0001587987-submissions-001.json | as retrieved | 200 | 15,545 | 59d472e61b3f | — |
| F20 | S4 | bdc_report_csv | https://www.sec.gov/files/investment/data/other/business-development-company-report/business-development-company-2025.csv | 2025 | 200 | 22,434 | 92750ef5bd60 | 2025-06-02 |
| F21 | S4 | bdc_report_csv | https://www.sec.gov/files/investment/data/other/business-development-company-report/business-development-company-2024.csv | 2024 | 200 | 20,008 | d4a8e824d45c | 2024-06-05 |
| F22 | S4 | bdc_report_csv | https://www.sec.gov/files/investment/data/other/business-development-company-report/business_development_company_2023.csv | 2023 | 200 | 19,802 | 238512b3a44d | 2023-06-08 |
| F23 | S4 | bdc_report_csv | https://www.sec.gov/files/investment/data/other/business-development-company-report/business_development_company_2022.csv | 2022 | 200 | 19,350 | aa1c670c04c8 | 2022-06-27 |
| F24 | S4 | bdc_report_csv | https://www.sec.gov/files/investment/data/other/business-development-company-report/business_development_company_2021.csv | 2021 | 200 | 16,009 | eb0551f085a3 | 2021-07-12 |
| F25 | S4 | bdc_report_csv | https://www.sec.gov/files/investment/data/other/business-development-company-report/business_development_company_2020.csv | 2020 | 200 | 14,742 | 3b31c6251964 | 2020-12-19 |
| F26 | S4 | bdc_report_csv | https://www.sec.gov/files/investment/data/other/business-development-company-report/business_development_company_2019.csv | 2019 | 200 | 16,214 | 5fc02bb533fe | 2020-12-19 |
| F27 | S4 | bdc_report_csv | https://www.sec.gov/files/investment/data/other/business-development-company-report/business_development_company_2018.csv | 2018 | 200 | 15,943 | 21396a3b453b | 2020-12-19 |
| F28 | S4 | bdc_report_csv | https://www.sec.gov/files/investment/data/other/business-development-company-report/business_development_company_2017.csv | 2017 | 200 | 15,725 | 69e6fa35ef29 | 2020-12-19 |
| F29 | S4 | bdc_report_csv | https://www.sec.gov/files/investment/data/other/business-development-company-report/business_development_company.csv | 2016 | 200 | 16,518 | 784c4db9f73e | 2020-12-19 |
| F30 | S4 | bdc_report_csv | https://www.sec.gov/files/investment/data/other/business-development-company-report/business_development_company_2015.csv | 2015 | 200 | 15,422 | 554e814133d7 | 2020-12-19 |
| F31 | S4 | bdc_report_csv | https://www.sec.gov/files/investment/data/other/business-development-company-report/business_development_company_2014.csv | 2014 | 200 | 17,977 | 7d15503ba00c | 2020-12-19 |
| F32 | S4 | bdc_report_csv | https://www.sec.gov/files/investment/data/other/business-development-company-report/business_development_company_2013.csv | 2013 | 200 | 48,955 | 128c62a11ee1 | 2020-12-19 |
| F33 | S4 | bdc_report_csv | https://www.sec.gov/files/investment/data/other/business-development-company-report/business_development_company_2012.csv | 2012 | 200 | 16,444 | f884c213447f | 2020-12-19 |

Selection rules (also in the manifest): F11 is the registrant with the most SOI rows in F04; F12 is
the registrant with the most SOI rows in F05 that differs from F11; F13a/F13b are the latest-filed
SOI accession of the F11 registrant in F04, with the document name taken from its `inlineurl`.
F19a/F19b are the only `filings.files[]` entries of F11 and F12. F20–F33 are every other CSV linked
from F15, with the year taken from the link text.
HTML pages (F01, F14–F18) contain dynamic markup, so their checksums are expected to change on every
retrieval.

## 14. Discrepancies

| # | Topic | S2 readme PDF | In-archive readme / metadata | Observed files | Resolution used here |
|---|---|---|---|---|---|
| 1 | `qtrs` in NUM, TXT, SOI | Absent (pp. 9–15) | Documented in all three tables | Present in all three (F04–F07) | Follow the files and in-archive readme |
| 2 | SOI date format | `mm/dd/yyyy` (p. 14) | `yyyy-mm-dd` | `yyyy-mm-dd` | Follow the files |
| 3 | NUM/TXT footnote truncation | "truncated to 512 characters" (pp. 10–11) | No truncation stated | Footnotes over 512 bytes in every file | Follow the files; S1 note confirms |
| 4 | NUM/TXT key | Key lists in section 3 omit `qtrs` | Field tables and metadata include `qtrs` | Not tested | Use the metadata key |
| 5 | SOI column overview | Figure 1 lists `url` and omits `qtrs`, `cstm` | Same Figure 1; Figure 10 lists `inlineurl`, `cstm`, and `qtrs` | Header has `inlineurl`, `qtrs`, `cstm` | Follow the files |
| 6 | `cstm` codes | 1 = TRUE, 2 = FALSE | Same | 0 and 1 only | OPEN QUESTION (Q19) |
| 7 | SUB columns | No `fileNumber` | No `fileNumber` | `fileNumber` between `filed` and `accepted` (F04–F07) | Record as observed, not documented |
| 8 | NON column name | `segment` | `segment` | `segments` (F03–F07) | Follow the files |
| 9 | Column names with trailing spaces | PRE `version `, CAL `pversion ` in tables | Same in metadata | Headers have no trailing spaces | Trim when comparing |
| 10 | PRE `stmt` codes | BS, IS, CF, EQ, CI, SI, UN | Same | Also `CP` (F04–F07) | OPEN QUESTION (Q20) |
| 11 | CIK format | "Ten-digit number" | Same | 5–7 digit integers, no leading zeros | Compare numerically; pad for S5 URLs |
| 12 | NON contents | Filings without financial statements | Same | Some 10-Q/10-K/10-K/A rows (F04, F05, F07) | Record as observed |
| 13 | SOI custom content | Custom tags and axes excluded | Same | CamelCase, filer-style column names present | OPEN QUESTION (Q16) |
| 14 | SOI cost and fair value | Preset columns defined | Same | Preset columns nearly empty; values under dynamic labels | OPEN QUESTION (Q14) |
| 15 | Tab-delimited lines | One field per tab | Same | A few rows have extra fields (4.8) | Treat as malformed rows; count and quarantine |
| 16 | SOI header case | Lowercase field names | Same | SOI uses mixed-case labels | Match labels exactly |
| 17 | BDC Report field names | n/a | n/a | Page names, CSV header, and XML elements all differ (section 6) | Map by position and documented meaning |
| 18 | BDC Report layout by year | n/a | n/a | 2020–2026 share one header; 2012–2019 use six other layouts (section 6.1) | Load 2020–2026 only; the header must equal the verified layout exactly |
| 19 | BDC Report byte-order mark | n/a | n/a | Present in 2025–2026, absent in 2020–2024 (F08, F20–F25) | Optional; raw bytes keep it, the parsed header strips it |
| 20 | Additional submissions page location | "array of additional JSON files" without a URL (F16) | n/a | `https://data.sec.gov/submissions/{name}` returns the page (F19a, F19b) | Use the observed rule; label it Observed |

## 15. Open questions

| # | Question | Status | Evidence so far |
|---|---|---|---|
| Q1 | User-Agent identity | Resolved | Supplied locally via `SEC_USER_AGENT`; never recorded |
| Q2 | Fixture storage | Resolved | Raw files in ignored `.cache/sec/`; repo holds manifest and structure-only snapshots |
| Q3 | Definition of `qtrs` | Resolved (Documented+Observed) | In-archive readme definition; section 5.6 |
| Q4 | Scale of rates and percentages per filer | OPEN QUESTION | Mostly fractions; a few whole-number values (5.4) |
| Q5 | Splitting the combined identifier into company and instrument | OPEN QUESTION | No fixed structure (5.3); decided in normalization |
| Q6 | Selecting current holdings from SOI rows | OPEN QUESTION | No unique key even with `ddate`, `qtrs` (5.2) |
| Q7 | Future consolidation of 2026 monthly files | OPEN QUESTION | 2025 was consolidated in July 2026 |
| Q8 | Manager/adviser, public/private type, status | Not available | Not in S3, S4, S5 |
| Q9 | Dataset period meaning | Resolved (Documented+Observed) | Filing-date window (3.6) |
| Q10 | Frequency of dynamic columns | Resolved (Observed) | Counts in 5.1; sparse fields marked Level 2 |
| Q11 | Whether entity-level XBRL APIs are needed | OPEN QUESTION | Not verified; NUM may suffice |
| Q12 | Developer FAQ URL | Resolved (Observed) | https://www.sec.gov/about/webmaster-frequently-asked-questions (F17) |
| Q13 | Readme version identification | Resolved | SHA-256 of F02 and of the in-archive readme |
| Q14 | Why SOI cost/fair value appear under "Adjusted cost basis" / "Initial fair value of Investment", and whether that is stable | OPEN QUESTION | Value agreement in 5.4 |
| Q15 | How SOI combines point-in-time and duration facts in one row | OPEN QUESTION | `qtrs` distribution (5.6) |
| Q16 | Why filer-style column names appear despite the documented exclusion | OPEN QUESTION | Section 5.7 |
| Q17 | Detecting superseded originals across files | OPEN QUESTION | `prevrpt` always 0 (section 11) |
| Q18 | Whether `Investment Interest Rate` is an all-in rate including PIK | OPEN QUESTION | Definition is "Rate of interest on investment" only |
| Q19 | `cstm` coding (0/1 observed vs 1/2 documented) | OPEN QUESTION | Section 14 row 6 |
| Q20 | Meaning of PRE `stmt = CP` | OPEN QUESTION | Section 14 row 10 |
| Q21 | URL of additional submissions pages | Resolved (Observed) | `https://data.sec.gov/submissions/{name}`; F19a, F19b (section 7.1). Not documented by SEC |
| Q22 | Time zone of SUB `accepted` and submissions `acceptanceDateTime` / `formerNames` dates | OPEN QUESTION | SUB has no zone; submissions text ends in `Z` but the meaning is not documented; stored as raw text only |
| Q23 | Older BDC Report formats and the file without a year | Resolved (Observed) | 2016 from the link text; 2012–2019 layouts differ and are not loaded (section 6.1) |
| Q24 | Meaning of one accession listed in several registrants' submissions histories | OPEN QUESTION | Not yet observed in samples; every listing registrant is linked and shown as MULTIPLE |

## 16. Verification log and change log

**How to re-verify**

1. `npm run sec:fetch` (needs `SEC_USER_AGENT` in `.env.local`; network; never in CI). Skips
   fixtures whose cached checksum already matches; `-- --refresh` re-downloads and records changes.
2. `npm run sec:inspect` regenerates the snapshots offline; `-- --check` regenerates into a temp
   directory and fails if anything differs from the committed snapshots.
3. `npm run verify:source-fixtures` recomputes checksums from `.cache/sec/` and scans public files
   for leaked names or the User-Agent value (skips when the cache is absent).
4. `npm run verify:source-schemas` checks this document and the manifest offline (runs in CI).

**Verification log**

| Date (UTC) | Action | Result |
|---|---|---|
| 2026-09-28 | Retrieved F01–F10 and F14–F18 at ≤1 request/second | All HTTP 200; no 403/429 |
| 2026-09-28 | Retrieved F11, F12, F13a, F13b | All HTTP 200; no 403/429 |
| 2026-09-28 | Generated 20 snapshots; re-ran with `--check` | Identical output |
| 2026-09-28 | Level 2 identifier presence check on F13b | 2,889 of 2,889 found |
| 2026-09-28 | Retrieved F19a, F19b, F20–F33 at ≤1 request/second (Phase 2 step 2.0) | All HTTP 200; no 403/429 |
| 2026-09-28 | Compared BDC Report headers across years; checked additional submissions pages against their parent entries | 2020–2026 identical layout; 2012–2019 differ; both pages match `filingCount` and date ranges |

**Change log**

| Date | Change |
|---|---|
| 2026-09-28 | Initial verified version (Phase 0.2). |
| 2026-09-28 | Version 2: BDC Report yearly layouts (6.1), additional submissions pages (7.1), registry field register (7.2), fixtures F19a–F33, discrepancies 18–20, questions Q21–Q24. Corrections: the Data Sets page lists 21 ZIPs, not 22 (3.2); the 2012–2015 BDC Report links have no "Updated" label (6). |
| 2026-10-02 | Section 8: Inline XBRL `ixt:fixed-zero` format and context period end, as used by the maturity binder. |
| 2026-10-07 | Section 8.1: Inline XBRL `ix:footnote`, `ix:relationship`, the default `fact-footnote` arcrole, EDGAR footnote restrictions, and the visible "(n)" label as an observed presentation convention. |
