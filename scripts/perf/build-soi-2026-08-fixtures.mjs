#!/usr/bin/env node
// Local-only builder for isolated 2026_08 SOI performance fixtures (Step 2, Approach B2).
// Reads the immutable content-addressed ZIP; never writes it or the production fetch log.
// Outputs only under .data/perf/soi/2026_08/. Does not invent or alter disclosed values.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  DEFAULT_DATA_DIR, REPO_ROOT, SOI_MEMBER_PATH, SUB_MEMBER_PATH, VERIFIED_SOI_PRESET_HEADER,
} from "../../pipeline/lib/config.mjs";
import { LOG_FILE, readFetchLog, createFetchLog } from "../../pipeline/lib/fetch-log.mjs";
import { createStore, sha256Hex } from "../../pipeline/lib/store.mjs";
import { parseSoiTsv } from "../../pipeline/parse/soi.mjs";
import { parseSubTsv } from "../../pipeline/parse/sub.mjs";
import { listMembers, readMember } from "../../pipeline/parse/zip.mjs";
import { buildStoredZip } from "../../pipeline/test/zip-store.mjs";

const SOURCE_ZIP_SHA256 = "0529ab8920f4d5c02d4f9b1ddc933d914065d4a3acf8bed39a49f44b040f657d";
const SOURCE_SEQ = 18;
const SOURCE_SOI_BYTES = 108761267;
const OUT_ROOT = path.join(REPO_ROOT, ".data", "perf", "soi", "2026_08");
const IDENT = "Investment, Identifier Axis";
const Q14_COST = "Adjusted cost basis";
const Q14_FV = "Initial fair value of Investment";
const PRESET_COST = "Investment Owned, Cost";
const PRESET_FV = "Investment Owned, Fair Value";
const F07_ROWS = 181907;
const F07_IDENT = 139219;
const F07_NOIDENT = F07_ROWS - F07_IDENT;
const F07_Q14_COST = 129485;
const F07_Q14_FV = 147754;
const DATASETS_PAGE_URL = "https://www.sec.gov/data-research/sec-markets-data/bdc-data-sets";
const ZIP_HREF = "/files/datastandardsinnovation/data/business-development-company-bdc-data-sets/2026_08_bdc.zip";
const ZIP_URL = `https://www.sec.gov${ZIP_HREF}`;
const DATASETS_PAGE_HTML = `<html><body><a href="${ZIP_HREF}">2026_08</a></body></html>\n`;
const TARGETS = [1000, 10000, 50000];

function hashLine(raw) {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

function colIndex(header, label) {
  const i = header.indexOf(label);
  if (i < 0) throw new Error(`header missing ${label}`);
  return i;
}

function nonempty(cells, i) {
  return i < cells.length && cells[i] !== "";
}

function dupBudget(n) {
  return n <= 1000 ? Math.min(50, Math.floor(0.05 * n)) : Math.min(200, Math.floor(0.05 * n));
}

function classify(header, raw, width) {
  const cells = raw.split("\t");
  const iAdsh = colIndex(header, "adsh");
  const iDdate = colIndex(header, "ddate");
  const iQtrs = colIndex(header, "qtrs");
  const iIdent = colIndex(header, IDENT);
  const iCost = colIndex(header, Q14_COST);
  const iFv = colIndex(header, Q14_FV);
  const iPresetCost = colIndex(header, PRESET_COST);
  const iPresetFv = colIndex(header, PRESET_FV);
  const hasIdent = nonempty(cells, iIdent);
  return {
    raw,
    cells,
    adsh: cells[iAdsh] ?? "",
    ddate: cells[iDdate] ?? "",
    qtrs: cells[iQtrs] ?? "",
    ident: cells[iIdent] ?? "",
    hasIdent,
    q14Cost: nonempty(cells, iCost),
    q14Fv: nonempty(cells, iFv),
    presetCost: nonempty(cells, iPresetCost),
    presetFv: nonempty(cells, iPresetFv),
    mismatch: cells.length !== width,
    sha256: hashLine(raw),
  };
}

function addLine(selected, classified, lineNumber) {
  if (selected.has(lineNumber)) return;
  selected.set(lineNumber, classified);
}

function groupKey(row) {
  return `${row.adsh}\0${row.ident}\0${row.ddate}\0${row.qtrs}`;
}

function duplicateGroups(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!row.hasIdent) continue;
    const k = groupKey(row);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(row);
  }
  return [...map.values()]
    .filter((g) => g.length >= 2)
    .sort((a, b) => a.length - b.length || a[0].lineNumber - b[0].lineNumber);
}

function multiDdateAccessions(rows) {
  const byAdsh = new Map();
  for (const row of rows) {
    if (!byAdsh.has(row.adsh)) byAdsh.set(row.adsh, []);
    byAdsh.get(row.adsh).push(row);
  }
  const out = [];
  for (const [adsh, list] of byAdsh) {
    const dates = new Map();
    for (const row of list) {
      if (!dates.has(row.ddate)) dates.set(row.ddate, []);
      dates.get(row.ddate).push(row);
    }
    if (dates.size < 2) continue;
    const dateLists = [...dates.entries()]
      .map(([ddate, lines]) => ({ ddate, lines }))
      .sort((a, b) => a.lines.length - b.lines.length || a.ddate.localeCompare(b.ddate));
    out.push({ adsh, total: list.length, dateLists });
  }
  out.sort((a, b) => a.total - b.total || a.adsh.localeCompare(b.adsh));
  return out;
}

function selectMustInclude(rows, n, notes) {
  const selected = new Map();
  const budget = dupBudget(n);
  const groups = duplicateGroups(rows);
  if (groups.length === 0) throw new Error("no duplicate identifier groups in source");
  let dupLines = 0;
  let dupGroupsTaken = 0;
  for (const g of groups) {
    if (dupGroupsTaken >= 1 && dupLines + g.length > budget) break;
    if (dupLines + g.length > budget && dupGroupsTaken >= 1) break;
    if (dupLines + g.length > budget && dupGroupsTaken === 0) {
      if (g.length > n) throw new Error("smallest duplicate group exceeds N");
      break;
    }
    for (const row of g) addLine(selected, row, row.lineNumber);
    dupLines += g.length;
    dupGroupsTaken += 1;
    if (dupLines >= budget) break;
  }
  if (dupGroupsTaken < 1) {
    for (const row of groups[0]) addLine(selected, row, row.lineNumber);
    dupGroupsTaken = 1;
    notes.push("duplicate group added even though it exceeded the line budget");
  }

  const accessions = multiDdateAccessions(rows);
  if (accessions.length === 0) throw new Error("no multi-ddate accession in source");
  let multiAdded = false;
  for (const acc of accessions) {
    const pair = acc.dateLists.slice(0, 2);
    const allLines = pair.flatMap((d) => d.lines);
    if (selected.size + allLines.filter((r) => !selected.has(r.lineNumber)).length <= n) {
      for (const row of allLines) addLine(selected, row, row.lineNumber);
      notes.push(`multi-ddate: two least-populous dates of smallest fitting accession (${allLines.length} lines)`);
      multiAdded = true;
      break;
    }
  }
  if (!multiAdded) {
    const acc = accessions[0];
    const pair = acc.dateLists.slice(0, 2);
    const fallback = pair.map((d) => d.lines[0]);
    for (const row of fallback) addLine(selected, row, row.lineNumber);
    notes.push("multi-ddate fallback: one line per two dates");
  }

  const first = (pred) => rows.find((r) => pred(r));
  const rare = [
    ["no-ident", (r) => !r.hasIdent],
    ["ident empty Q14 cost", (r) => r.hasIdent && !r.q14Cost],
    ["ident empty Q14 FV", (r) => r.hasIdent && !r.q14Fv],
    ["ident Q14 cost", (r) => r.hasIdent && r.q14Cost],
    ["ident Q14 FV", (r) => r.hasIdent && r.q14Fv],
  ];
  for (const [label, pred] of rare) {
    const row = first(pred);
    if (!row) {
      notes.push(`rare class missing in source: ${label}`);
      continue;
    }
    if (selected.size < n) addLine(selected, row, row.lineNumber);
  }
  for (const row of rows.filter((r) => r.mismatch)) {
    if (selected.size < n) addLine(selected, row, row.lineNumber);
  }
  const presetCostRows = rows.filter((r) => r.presetCost);
  for (const row of presetCostRows) {
    if (selected.size < n) addLine(selected, row, row.lineNumber);
  }

  if (selected.size > n) {
    notes.push(`must-include ${selected.size} exceeded N=${n}; shrinking duplicate groups`);
    const keptDups = duplicateGroups([...selected.values()]);
    const drop = keptDups.sort((a, b) => b.length - a.length || b[0].lineNumber - a[0].lineNumber);
    while (selected.size > n && drop.length > 1) {
      const g = drop.shift();
      for (const row of g) selected.delete(row.lineNumber);
    }
    if (selected.size > n) {
      notes.push("shrinking multi-ddate to two-line fallback");
      const still = [...selected.values()].sort((a, b) => a.lineNumber - b.lineNumber);
      const byAdsh = multiDdateAccessions(still);
      if (byAdsh.length) {
        const extra = still.filter((r) => r.adsh === byAdsh[0].adsh);
        const keepNums = new Set(byAdsh[0].dateLists.slice(0, 2).map((d) => d.lines[0].lineNumber));
        for (const row of extra) {
          if (!keepNums.has(row.lineNumber)) selected.delete(row.lineNumber);
        }
      }
    }
    if (selected.size > n) throw new Error(`must-include still ${selected.size} after shrink for N=${n}`);
  }
  return selected;
}

function fillToN(rows, selected, n) {
  const identTarget = Math.round(n * (F07_IDENT / F07_ROWS));
  const noIdentTarget = n - identTarget;
  const costTarget = Math.round(n * (F07_Q14_COST / F07_ROWS));
  const fvTarget = Math.round(n * (F07_Q14_FV / F07_ROWS));
  let ident = 0;
  let noident = 0;
  let cost = 0;
  let fv = 0;
  for (const row of selected.values()) {
    if (row.hasIdent) ident += 1;
    else noident += 1;
    if (row.q14Cost) cost += 1;
    if (row.q14Fv) fv += 1;
  }
  const bump = (row) => {
    if (row.hasIdent) ident += 1;
    else noident += 1;
    if (row.q14Cost) cost += 1;
    if (row.q14Fv) fv += 1;
  };
  // ident / non-ident are a partition (F07 ~76.5% / ~23.5%). Q14 flags overlap and
  // must not keep adding non-identifier rows after that quota is met.
  const needed = (row) => (
    (row.hasIdent && ident < identTarget)
    || (!row.hasIdent && noident < noIdentTarget)
  );
  for (const row of rows) {
    if (selected.size >= n) break;
    if (selected.has(row.lineNumber)) continue;
    if (needed(row)) {
      addLine(selected, row, row.lineNumber);
      bump(row);
    }
  }
  for (const row of rows) {
    if (selected.size >= n) break;
    if (selected.has(row.lineNumber)) continue;
    const q14Short = (row.q14Cost && cost < costTarget) || (row.q14Fv && fv < fvTarget);
    if (q14Short) {
      addLine(selected, row, row.lineNumber);
      bump(row);
    }
  }
  for (const row of rows) {
    if (selected.size >= n) break;
    if (selected.has(row.lineNumber)) continue;
    addLine(selected, row, row.lineNumber);
    bump(row);
  }
  if (selected.size !== n) throw new Error(`fill produced ${selected.size} rows, expected ${n}`);
}

function fixtureStats(selectedRows, sourceRows) {
  const ident = selectedRows.filter((r) => r.hasIdent).length;
  const keys = new Map();
  for (const r of selectedRows.filter((r) => r.hasIdent)) {
    const k = groupKey(r);
    keys.set(k, (keys.get(k) ?? 0) + 1);
  }
  const dupGroups = [...keys.values()].filter((c) => c > 1).length;
  const byAdsh = new Map();
  for (const r of selectedRows) {
    if (!byAdsh.has(r.adsh)) byAdsh.set(r.adsh, new Set());
    byAdsh.get(r.adsh).add(r.ddate);
  }
  const multiDdate = [...byAdsh.values()].filter((s) => s.size >= 2).length;
  return {
    row_count: selectedRows.length,
    identifier_count: ident,
    non_identifier_count: selectedRows.length - ident,
    q14_cost_count: selectedRows.filter((r) => r.q14Cost).length,
    q14_fv_count: selectedRows.filter((r) => r.q14Fv).length,
    preset_cost_count: selectedRows.filter((r) => r.presetCost).length,
    preset_fv_count: selectedRows.filter((r) => r.presetFv).length,
    duplicate_group_count: dupGroups,
    multi_ddate_count: multiDdate,
    field_count_mismatch_count: selectedRows.filter((r) => r.mismatch).length,
    source_row_count: sourceRows.length,
  };
}

function writeTsv(headerLine, rows) {
  const body = rows.map((r) => r.raw).join("\n");
  return Buffer.from(`${headerLine}\n${body}\n`, "utf8");
}

function subRowsFor(soiRows, subParsed) {
  const wanted = new Set(soiRows.map((r) => r.adsh));
  const iAdsh = 0;
  const picked = [];
  for (const row of subParsed.rows) {
    const adsh = row.raw.split("\t")[iAdsh] ?? "";
    if (wanted.has(adsh)) picked.push(row);
  }
  return picked;
}

function ensureDir(p) {
  mkdirSync(p, { recursive: true });
}

function gitIgnored(p) {
  const r = spawnSync("git", ["check-ignore", "-q", "--", p], { cwd: REPO_ROOT });
  return r.status === 0;
}

function gitTracked(p) {
  const r = spawnSync("git", ["ls-files", "--", p], { cwd: REPO_ROOT, encoding: "utf8" });
  return r.stdout.trim() !== "";
}

function originalZipInfo(dataDir) {
  const { entries } = readFetchLog(dataDir);
  const entry = entries.find((e) => e.seq === SOURCE_SEQ && e.context?.release_label === "2026_08");
  if (!entry?.storage_key) throw new Error("2026_08 ZIP not found in production fetch log");
  const store = createStore(dataDir);
  const zipPath = store.pathFor(entry.storage_key);
  return { entry, zipPath };
}

function verifyFixture({
  n, tsvPath, zipPath, treeDir, manifest, headerLine, originalByLine, originalHeaderSha, originalZipPath, originalShaBefore,
}) {
  const issues = [];
  const zipShaNow = sha256Hex(readFileSync(originalZipPath));
  if (zipShaNow !== SOURCE_ZIP_SHA256) issues.push("original ZIP sha256 changed");
  if (zipShaNow !== originalShaBefore) issues.push("original ZIP sha256 changed during this run");
  const tsv = readFileSync(tsvPath);
  const parsed = parseSoiTsv(tsv);
  if (parsed.emptyFile) issues.push(`${n}: empty SOI`);
  if (!parsed.presetHeaderMatches) issues.push(`${n}: preset header mismatch`);
  if (parsed.header.join("\t") !== headerLine) issues.push(`${n}: header bytes differ from original`);
  if (parsed.headerSha256 !== originalHeaderSha) issues.push(`${n}: header sha256 differs`);
  if (parsed.rows.length !== n) issues.push(`${n}: row count ${parsed.rows.length}`);
  if (!VERIFIED_SOI_PRESET_HEADER.every((label, i) => parsed.header[i] === label)) {
    issues.push(`${n}: first 21 labels drifted`);
  }
  for (let i = 0; i < parsed.rows.length; i += 1) {
    const meta = manifest.selected_rows[i];
    const orig = originalByLine.get(meta.original_line_number);
    if (!orig) {
      issues.push(`${n}: original line ${meta.original_line_number} missing`);
      break;
    }
    if (parsed.rows[i].raw !== orig.raw) issues.push(`${n}: fixture row ${i + 1} != original line ${meta.original_line_number}`);
    if (hashLine(parsed.rows[i].raw) !== orig.sha256 || orig.sha256 !== meta.line_sha256) {
      issues.push(`${n}: sha mismatch at original line ${meta.original_line_number}`);
    }
  }
  const members = listMembers(zipPath);
  if (!members.includes(SOI_MEMBER_PATH)) issues.push(`${n}: ZIP missing soi.tsv`);
  if (!members.includes(SUB_MEMBER_PATH)) issues.push(`${n}: ZIP missing datasets/sub.tsv`);
  const zipSoi = parseSoiTsv(readMember(zipPath, SOI_MEMBER_PATH));
  if (zipSoi.rows.length !== n) issues.push(`${n}: ZIP soi.tsv row count ${zipSoi.rows.length}`);
  if (zipSoi.headerSha256 !== originalHeaderSha) issues.push(`${n}: ZIP header sha differs`);
  const treeLog = path.join(treeDir, LOG_FILE);
  const prodLog = path.join(DEFAULT_DATA_DIR, LOG_FILE);
  if (path.resolve(treeLog) === path.resolve(prodLog)) issues.push(`${n}: isolated log is production log`);
  if (!existsSync(treeLog)) issues.push(`${n}: missing isolated fetch-log`);
  const isolated = readFetchLog(treeDir);
  const prod = readFetchLog(DEFAULT_DATA_DIR);
  if (isolated.bytes.equals(prod.bytes)) issues.push(`${n}: isolated fetch-log bytes equal production`);
  if (isolated.entries.some((e) => e.sha256 === SOURCE_ZIP_SHA256 && e.storage_key?.includes(SOURCE_ZIP_SHA256))) {
    issues.push(`${n}: isolated tree points at original ZIP object`);
  }
  for (const p of [tsvPath, zipPath, treeLog, path.join(OUT_ROOT, "manifests", `soi_${n}.json`)]) {
    if (!gitIgnored(p)) issues.push(`not gitignored: ${p}`);
    if (gitTracked(p)) issues.push(`tracked by git: ${p}`);
  }
  if (manifest.row_count !== n) issues.push(`${n}: manifest row_count`);
  if (manifest.selected_rows.length !== n) issues.push(`${n}: manifest selected_rows length`);
  return issues;
}

function main() {
  const originalShaBefore = sha256Hex(readFileSync(originalZipInfo(DEFAULT_DATA_DIR).zipPath));
  if (originalShaBefore !== SOURCE_ZIP_SHA256) {
    throw new Error("refusing to run: original 2026_08 ZIP does not match recorded sha256");
  }
  const { entry, zipPath } = originalZipInfo(DEFAULT_DATA_DIR);
  const soiBuf = readMember(zipPath, SOI_MEMBER_PATH);
  if (soiBuf.length !== SOURCE_SOI_BYTES) {
    throw new Error(`soi.tsv size ${soiBuf.length} !== recorded ${SOURCE_SOI_BYTES}`);
  }
  const soi = parseSoiTsv(soiBuf);
  if (!soi.presetHeaderMatches) throw new Error("source soi.tsv preset header does not match");
  const headerLine = soi.header.join("\t");
  const width = soi.header.length;
  const rows = soi.rows.map((r) => ({ lineNumber: r.lineNumber, ...classify(soi.header, r.raw, width) }));
  const originalByLine = new Map(rows.map((r) => [r.lineNumber, r]));
  const subBuf = readMember(zipPath, SUB_MEMBER_PATH);
  const sub = parseSubTsv(subBuf);
  if (!sub.headerMatches) throw new Error("source datasets/sub.tsv header does not match verified SUB header");
  const subHeaderLine = sub.header.join("\t");

  ensureDir(path.join(OUT_ROOT, "slices"));
  ensureDir(path.join(OUT_ROOT, "manifests"));
  ensureDir(path.join(OUT_ROOT, "zips"));
  writeFileSync(path.join(OUT_ROOT, "SOURCE.txt"), [
    "Immutable source: 2026_08 BDC data-set ZIP in .data/sec (not modified by this builder).",
    `fetch_log_seq=${SOURCE_SEQ}`,
    `zip_sha256=${SOURCE_ZIP_SHA256}`,
    `storage_key=${entry.storage_key}`,
    `soi_tsv_uncompressed_bytes=${SOURCE_SOI_BYTES}`,
    `soi_header_sha256=${soi.headerSha256}`,
    `soi_data_lines=${soi.rows.length}`,
    `sub_header_sha256=${sub.headerSha256}`,
    `sub_data_lines=${sub.rows.length}`,
    "",
  ].join("\n"));

  const reports = [];
  const allIssues = [];

  for (const n of TARGETS) {
    const notes = [];
    const selectedMap = selectMustInclude(rows, n, notes);
    fillToN(rows, selectedMap, n);
    const selectedRows = [...selectedMap.values()].sort((a, b) => a.lineNumber - b.lineNumber);
    if (selectedRows.length !== n) throw new Error(`N=${n} selected ${selectedRows.length}`);
    const soiTsv = writeTsv(headerLine, selectedRows);
    const subPicked = subRowsFor(selectedRows, sub);
    const subTsv = writeTsv(subHeaderLine, subPicked.map((r) => ({ raw: r.raw })));
    const zipBuf = buildStoredZip({
      [SUB_MEMBER_PATH]: subTsv,
      [SOI_MEMBER_PATH]: soiTsv,
    });
    const stats = fixtureStats(selectedRows, rows);
    const tsvPath = path.join(OUT_ROOT, "slices", `soi_${n}.tsv`);
    const zipOutPath = path.join(OUT_ROOT, "zips", `2026_08_soi_${n}.zip`);
    const treeDir = path.join(OUT_ROOT, "trees", `soi_${n}`);
    if (existsSync(treeDir)) rmSync(treeDir, { recursive: true, force: true });
    ensureDir(treeDir);
    writeFileSync(tsvPath, soiTsv);
    writeFileSync(zipOutPath, zipBuf);

    const store = createStore(treeDir);
    const log = createFetchLog(treeDir);
    const session = `perf-2026-08-soi-${n}`;
    const pageStored = store.put(Buffer.from(DATASETS_PAGE_HTML, "utf8"));
    log.append({
      session_id: session,
      requested_at: "2099-12-31T00:00:00.000Z",
      url: DATASETS_PAGE_URL,
      final_url: DATASETS_PAGE_URL,
      http_status: 200,
      content_type: "text/html",
      byte_size: pageStored.byteSize,
      sha256: pageStored.sha256,
      storage_key: pageStored.storageKey,
      source_type: "SEC_BDC_DATASETS_PAGE",
      context: { kind: "datasets_page", perf_fixture: `soi_${n}` },
    });
    const zipStored = store.put(zipBuf);
    log.append({
      session_id: session,
      requested_at: "2099-12-31T00:00:01.000Z",
      url: ZIP_URL,
      final_url: ZIP_URL,
      http_status: 200,
      content_type: "application/zip",
      byte_size: zipStored.byteSize,
      sha256: zipStored.sha256,
      storage_key: zipStored.storageKey,
      source_type: "SEC_BDC_DATASET_ZIP",
      context: { kind: "dataset_zip", release_label: "2026_08", perf_fixture: `soi_${n}` },
    });

    const manifest = {
      fixture: `soi_${n}`,
      source_zip_sha256: SOURCE_ZIP_SHA256,
      source_fetch_log_seq: SOURCE_SEQ,
      source_soi_tsv_size: SOURCE_SOI_BYTES,
      source_header_sha256: soi.headerSha256,
      source_sub_row_count: sub.rows.length,
      fixture_zip_sha256: zipStored.sha256,
      fixture_zip_bytes: zipStored.byteSize,
      fixture_tsv_bytes: soiTsv.length,
      fixture_sub_row_count: subPicked.length,
      header_width: width,
      notes,
      ...stats,
      selected_rows: selectedRows.map((r) => ({
        original_line_number: r.lineNumber,
        line_sha256: r.sha256,
      })),
    };
    const manifestPath = path.join(OUT_ROOT, "manifests", `soi_${n}.json`);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const issues = verifyFixture({
      n, tsvPath, zipPath: zipOutPath, treeDir, manifest, headerLine, originalByLine,
      originalHeaderSha: soi.headerSha256, originalZipPath: zipPath, originalShaBefore,
    });
    allIssues.push(...issues);
    reports.push({
      n,
      ...stats,
      fixture_zip_sha256: zipStored.sha256,
      fixture_zip_bytes: zipStored.byteSize,
      fixture_sub_row_count: subPicked.length,
      notes,
      issues,
    });
  }

  const originalShaAfter = sha256Hex(readFileSync(zipPath));
  const summary = {
    original_zip_sha256_before: originalShaBefore,
    original_zip_sha256_after: originalShaAfter,
    original_zip_unchanged: originalShaAfter === SOURCE_ZIP_SHA256 && originalShaAfter === originalShaBefore,
    production_fetch_log: path.join(DEFAULT_DATA_DIR, LOG_FILE),
    output_root: OUT_ROOT,
    reports,
    issues: allIssues,
  };
  writeFileSync(path.join(OUT_ROOT, "verification.json"), `${JSON.stringify(summary, null, 2)}\n`);
  if (allIssues.length || !summary.original_zip_unchanged) {
    console.error(JSON.stringify(summary, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify(summary, null, 2));
}

main();
