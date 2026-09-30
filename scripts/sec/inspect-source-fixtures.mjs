#!/usr/bin/env node
// Offline structural analysis of the cached SEC source files listed in
// fixtures/sec/manifest.json. Writes structure-only snapshots (headers, counts, format
// classes, join rates) to fixtures/sec/snapshots/. Snapshots must never contain data
// values, registrant or borrower names, or financial amounts. Verification tooling only;
// this is not a parser for application data.
//
// Usage: npm run sec:inspect [-- --only F04,F05] [-- --check] [-- --select]

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifest = JSON.parse(readFileSync(path.join(repoRoot, "fixtures/sec/manifest.json"), "utf8"));
const snapshotDir = path.join(repoRoot, "fixtures/sec/snapshots");

const args = process.argv.slice(2);
const check = args.includes("--check");
const select = args.includes("--select");
const onlyIndex = args.indexOf("--only");
const only = onlyIndex >= 0 ? new Set(args[onlyIndex + 1].split(",")) : null;
const outDir = check ? mkdtempSync(path.join(os.tmpdir(), "sec-snapshots-")) : snapshotDir;

const SOI_PRESET_NUMERIC = [
  "Investment Interest Rate",
  "Investment, Basis Spread, Variable Rate",
  "Investment Owned, Balance, Principal Amount",
  "Investment Owned, Cost",
  "Investment Owned, Fair Value",
  "Investment Owned, Net Assets, Percentage",
];
const SOI_AGREEMENT_LABELS = [...SOI_PRESET_NUMERIC, "Adjusted cost basis", "Initial fair value of Investment"];
// Standard tag names as mapped from the preset SOI labels via TAG.tlabel in F04.
const NUM_AGREEMENT_TAGS = [
  "InvestmentInterestRate",
  "InvestmentBasisSpreadVariableRate",
  "InvestmentOwnedBalancePrincipalAmount",
  "InvestmentOwnedAtCost",
  "InvestmentOwnedAtFairValue",
  "InvestmentOwnedPercentOfNetAssets",
];
const IDENTIFIER_COLUMN = "Investment, Identifier Axis";
const ISSUER_NAME_COLUMNS = ["Investment, Issuer Name Axis", "Investment, Issuer Name [Extensible Enumeration]"];

// ---------- helpers ----------

const cachePath = (fixture) => path.join(repoRoot, fixture.cache_path);
const inc = (counter, key, by = 1) => {
  counter[key] = (counter[key] ?? 0) + by;
};

function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortDeep(value[k])]));
  }
  return value;
}

function classify(v) {
  if (v === "") return "empty";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return "date_yyyy-mm-dd";
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(v)) return "date_mm/dd/yyyy";
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(v)) return "datetime";
  if (/^\d{8}$/.test(v)) return "digits_8";
  if (/^-?\d+$/.test(v)) return "integer";
  if (/^-?\d*\.\d+$/.test(v)) return "decimal";
  if (/^-?\d+(\.\d+)?[eE][-+]?\d+$/.test(v)) return "scientific";
  if (/^(true|false)$/i.test(v)) return "boolean_text";
  if (/^https?:\/\//.test(v)) return "url";
  return "text";
}

const NUMERIC_CLASSES = new Set(["integer", "decimal", "scientific", "digits_8"]);

function magnitudeBand(v) {
  const n = Math.abs(Number(v));
  if (!Number.isFinite(n)) return "non_finite";
  if (n === 0) return "zero";
  if (n < 1) return "abs_lt_1";
  if (n < 100) return "abs_1_to_lt_100";
  if (n < 1e6) return "abs_100_to_lt_1e6";
  return "abs_ge_1e6";
}

function periodWindow(sourcePeriod) {
  let m = sourcePeriod.match(/^(\d{4})-(\d{2})$/);
  if (m) {
    const last = new Date(Date.UTC(+m[1], +m[2], 0)).getUTCDate();
    return [`${m[1]}-${m[2]}-01`, `${m[1]}-${m[2]}-${String(last).padStart(2, "0")}`];
  }
  m = sourcePeriod.match(/^(\d{4})Q([1-4])$/);
  if (m) {
    const startMonth = (+m[2] - 1) * 3 + 1;
    const last = new Date(Date.UTC(+m[1], startMonth + 2, 0)).getUTCDate();
    return [
      `${m[1]}-${String(startMonth).padStart(2, "0")}-01`,
      `${m[1]}-${String(startMonth + 2).padStart(2, "0")}-${String(last).padStart(2, "0")}`,
    ];
  }
  return null;
}

const toIsoDate = (v) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  if (/^\d{8}$/.test(v)) return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
};

function minMax(state, v) {
  if (!v) return;
  if (state.min === null || v < state.min) state.min = v;
  if (state.max === null || v > state.max) state.max = v;
}

function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return { count: 0 };
  return {
    count: sorted.length,
    min: sorted[0],
    median: sorted[Math.floor(sorted.length / 2)],
    max: sorted[sorted.length - 1],
  };
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file).on("data", (d) => hash.update(d)).on("end", () => resolve(hash.digest("hex"))).on("error", reject);
  });
}

function zipMembers(zip) {
  const out = execFileSync("unzip", ["-l", zip], { encoding: "utf8" });
  const members = [];
  for (const line of out.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}\s+(.+)$/);
    if (m) members.push({ path: m[2].trim(), bytes: Number(m[1]) });
  }
  return members;
}

// Streams one ZIP member split strictly on "\n" (the documented line terminator; a lone
// "\r" stays inside the line). Resolves with the member's SHA-256.
function streamMember(zip, member, onLine) {
  return new Promise((resolve, reject) => {
    const child = spawn("unzip", ["-p", zip, member]);
    const hash = createHash("sha256");
    const decoder = new StringDecoder("utf8");
    let rest = "";
    child.stdout.on("data", (d) => {
      hash.update(d);
      const parts = (rest + decoder.write(d)).split("\n");
      rest = parts.pop();
      for (const part of parts) onLine(part);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      rest += decoder.end();
      if (rest !== "") onLine(rest);
      if (code !== 0) reject(new Error(`unzip -p ${member} exited ${code}`));
      else resolve(hash.digest("hex"));
    });
  });
}

const readMember = (zip, member) => execFileSync("unzip", ["-p", zip, member], { maxBuffer: 64 * 1024 * 1024 });

function compareHeader(observed, documented) {
  if (!documented) return { documented_columns: null };
  const trimmed = documented.map((c) => c.trim());
  return {
    documented_columns: trimmed.length,
    documented_names_with_whitespace: documented.filter((c) => c !== c.trim()),
    observed_columns: observed ? observed.length : 0,
    missing_from_file: trimmed.filter((c) => !(observed ?? []).includes(c)),
    extra_in_file: (observed ?? []).filter((c) => !trimmed.includes(c)),
    same_order_for_documented: observed ? trimmed.every((c, i) => observed[i] === c) : false,
  };
}

// ---------- dataset ZIP analysis ----------

async function analyzeDatasetZip(fixture, selection) {
  const zip = cachePath(fixture);
  const members = zipMembers(zip);
  const window = periodWindow(fixture.source_period);
  const metadata = members.some((m) => m.path === "bdc_metadata.json")
    ? JSON.parse(readMember(zip, "bdc_metadata.json").toString("utf8"))
    : null;
  const documented = {};
  for (const t of metadata?.tables ?? []) {
    documented[t.url] = {
      columns: t.tableSchema.columns.map((c) => c.name),
      primary_key: t.tableSchema.primaryKey ?? null,
    };
  }

  const snapshot = {
    fixture_id: fixture.id,
    source_type: fixture.source_type,
    source_period: fixture.source_period,
    fixture_sha256: fixture.retrieval.sha256,
    filed_window_assumed_from_file_name: window,
    archive_members: [],
    metadata_dialect: metadata?.dialect ?? null,
    tables: {},
  };

  const byName = Object.fromEntries(members.map((m) => [path.basename(m.path), m]));
  const order = ["sub.tsv", "tag.tsv", "soi.tsv", "num.tsv", "txt.tsv", "pre.tsv", "cal.tsv", "non.tsv"];
  const subByAdsh = new Map();
  const soiLabelTags = new Map();
  const soiCikRows = new Map();
  const soiCikLatest = new Map();
  const soiAgreementValues = new Map();
  const numAgreementValues = new Map();

  for (const m of members) {
    if (!m.path.endsWith(".tsv")) {
      snapshot.archive_members.push({ path: m.path, bytes: m.bytes, sha256: createHash("sha256").update(readMember(zip, m.path)).digest("hex") });
    }
  }

  for (const name of order) {
    const member = byName[name];
    if (!member) {
      snapshot.tables[name] = { present: false };
      continue;
    }
    const table = { present: true, member_path: member.path, bytes: member.bytes };
    const doc = documented[name];
    table.documented_primary_key = doc?.primary_key ?? null;
    let header = null;
    let rows = 0;
    let fieldCountMismatches = 0;
    let colIndex = new Map();
    const idx = (col) => colIndex.get(col) ?? -1;

    // per-table state
    const s = {
      counters: {},
      qtrs: {},
      forms: {},
      cols: null,
      adshRows: new Map(),
      adshDdates: new Map(),
      keys: { k1: new Set(), k2: new Set(), k3: new Set() },
      filed: { min: null, max: null },
      ddate: { min: null, max: null },
      period: { min: null, max: null },
      footOver512: 0,
      footMax: 0,
      uom: {},
      labelUnits: {},
      labelBands: {},
    };

    const onLine = (line) => {
      if (header === null) {
        header = line.split("\t");
        colIndex = new Map(header.map((h, i) => [h, i]));
        s.cols = header.map(() => ({ non_empty: 0, classes: {}, bands: {} }));
        return;
      }
      rows += 1;
      const f = line.split("\t");
      if (f.length !== header.length) {
        fieldCountMismatches += 1;
        inc(s.counters, `field_count_${f.length < header.length ? "fewer" : "more"}_than_header`);
      }
      if (line.includes("\r")) inc(s.counters, "lines_containing_carriage_return");
      const get = (col) => {
        const i = idx(col);
        return i >= 0 ? (f[i] ?? "") : "";
      };

      if (name === "sub.tsv") {
        subByAdsh.set(get("adsh"), { period: toIsoDate(get("period")) });
        inc(s.forms, get("form"));
        inc(s.counters, `prevrpt=${get("prevrpt")}`);
        inc(s.counters, `detail=${get("detail")}`);
        inc(s.counters, `fp=${get("fp") || "(empty)"}`);
        inc(s.counters, `adsh_format_${/^\d{10}-\d{2}-\d{6}$/.test(get("adsh")) ? "valid" : "invalid"}`);
        inc(s.counters, `cik_format=${classify(get("cik"))}_len${get("cik").length}`);
        inc(s.counters, `period_format=${classify(get("period"))}`);
        inc(s.counters, `filed_format=${classify(get("filed"))}`);
        inc(s.counters, `accepted_format=${classify(get("accepted"))}`);
        minMax(s.filed, toIsoDate(get("filed")));
        return;
      }

      if (name === "tag.tsv") {
        inc(s.counters, `custom=${get("custom")}`);
        const label = get("tlabel");
        if (get("custom") === "0" && SOI_PRESET_NUMERIC.includes(label)) {
          if (!soiLabelTags.has(label)) soiLabelTags.set(label, new Set());
          soiLabelTags.get(label).add(get("tag"));
        }
        return;
      }

      if (name === "num.tsv" || name === "txt.tsv") {
        inc(s.qtrs, get("qtrs"));
        const footlen = Number(get("footlen") || 0);
        if (footlen > 512) s.footOver512 += 1;
        if (footlen > s.footMax) s.footMax = footlen;
        if (name === "num.tsv") {
          inc(s.uom, get("uom"));
          inc(s.counters, `value_format=${classify(get("value"))}`);
          const segments = get("segments");
          const tag = get("tag");
          if (NUM_AGREEMENT_TAGS.includes(tag)) {
            const member = segments.match(/InvestmentIdentifierAxis\([^)]*\)=(.*?)\(\)(?:;|$)/)?.[1];
            const v = get("value");
            if (member !== undefined && v !== "") {
              const key = `${get("adsh")}\u0001${toIsoDate(get("ddate"))}\u0001${member}`;
              if (!numAgreementValues.has(key)) numAgreementValues.set(key, new Map());
              const byTag = numAgreementValues.get(key);
              if (!byTag.has(tag)) byTag.set(tag, new Set());
              byTag.get(tag).add(String(Number(v)));
            }
          }
          if (segments.includes("InvestmentIdentifierAxis")) {
            for (const [label, tags] of soiLabelTags) {
              if (tags.has(get("tag"))) {
                s.labelUnits[label] ??= {};
                inc(s.labelUnits[label], get("uom"));
                const v = get("value");
                if (v !== "") {
                  s.labelBands[label] ??= {};
                  inc(s.labelBands[label], magnitudeBand(v));
                }
              }
            }
          }
        }
        return;
      }

      if (name === "pre.tsv") {
        inc(s.counters, `stmt=${get("stmt") || "(empty)"}`);
        return;
      }

      if (name === "non.tsv") {
        inc(s.forms, get("form"));
        s.adshRows.set(get("adsh"), 1);
        return;
      }

      if (name === "soi.tsv") {
        for (let i = 0; i < header.length; i += 1) {
          const v = f[i] ?? "";
          if (v === "") continue;
          const col = s.cols[i];
          col.non_empty += 1;
          const cls = classify(v);
          inc(col.classes, cls);
          if (NUMERIC_CLASSES.has(cls) && i >= 10) inc(col.bands, magnitudeBand(v));
        }
        const adsh = get("adsh");
        const cik = get("cik");
        const ident = get(IDENTIFIER_COLUMN);
        const ddate = get("ddate");
        const qtrs = get("qtrs");
        const period = get("period");
        s.adshRows.set(adsh, (s.adshRows.get(adsh) ?? 0) + 1);
        if (!s.adshDdates.has(adsh)) s.adshDdates.set(adsh, new Set());
        s.adshDdates.get(adsh).add(ddate);
        s.keys.k1.add(`${adsh}\u0001${ident}\u0001${ddate}`);
        s.keys.k2.add(`${adsh}\u0001${ident}\u0001${ddate}\u0001${qtrs}`);
        s.keys.k3.add(createHash("sha1").update(line).digest("base64"));
        inc(s.qtrs, qtrs);
        inc(s.forms, get("form"));
        inc(s.counters, `cstm=${get("cstm")}`);
        inc(s.counters, `identifier_${ident === "" ? "empty" : "present"}`);
        if (ident !== "") inc(s.counters, `identifier_pipe_count=${Math.min((ident.match(/\|/g) ?? []).length, 4)}${(ident.match(/\|/g) ?? []).length >= 4 ? "+" : ""}`);
        for (const col of ISSUER_NAME_COLUMNS) {
          const issuer = get(col);
          if (issuer !== "") {
            inc(s.counters, `${col} present`);
            if (ident.includes(issuer)) inc(s.counters, `${col} contained_in_identifier`);
          }
        }
        const isoDdate = toIsoDate(ddate);
        const isoPeriod = toIsoDate(period);
        if (ident !== "") {
          const values = [];
          for (const label of SOI_AGREEMENT_LABELS) {
            const v = get(label);
            if (v !== "") values.push([label, String(Number(v))]);
          }
          if (values.length) {
            const key = `${adsh}\u0001${isoDdate}\u0001${ident}`;
            if (!soiAgreementValues.has(key)) soiAgreementValues.set(key, []);
            soiAgreementValues.get(key).push(...values);
          }
        }
        minMax(s.ddate, isoDdate);
        minMax(s.period, isoPeriod);
        const isoFiled = toIsoDate(get("filed"));
        minMax(s.filed, isoFiled);
        if (!isoPeriod) inc(s.counters, "ddate_vs_period=period_empty");
        else if (isoDdate === isoPeriod) inc(s.counters, "ddate_vs_period=equal");
        else inc(s.counters, `ddate_vs_period=${isoDdate < isoPeriod ? "ddate_before_period" : "ddate_after_period"}`);
        if (window && isoFiled) {
          inc(s.counters, `filed_vs_file_window=${isoFiled < window[0] ? "before" : isoFiled > window[1] ? "after" : "within"}`);
        }
        inc(s.counters, `adsh_format_${/^\d{10}-\d{2}-\d{6}$/.test(adsh) ? "valid" : "invalid"}`);
        inc(s.counters, `cik_format=${classify(cik)}_len${cik.length}`);
        inc(s.counters, `adsh_prefix_${adsh.slice(0, 10) === cik.padStart(10, "0") ? "equals_registrant_cik" : "differs_from_registrant_cik"}`);
        const url = get("inlineurl");
        const um = url.match(/^https:\/\/www\.sec\.gov\/(ix\?doc=\/)?Archives\/edgar\/data\/(\d+)\/(\d{18})\/([^/]+)$/);
        if (!um) inc(s.counters, "inlineurl_pattern=unmatched");
        else {
          const [, viewerPrefix, urlCik, urlAccession] = um;
          inc(s.counters, `inlineurl_pattern=${viewerPrefix ? "ix_viewer_wrapping_archives_path" : "archives_path"}`);
          inc(s.counters, `inlineurl_cik_${Number(urlCik) === Number(cik) ? "equals" : "differs_from"}_registrant_cik`);
          inc(s.counters, `inlineurl_accession_${urlAccession === adsh.replace(/-/g, "") ? "equals" : "differs_from"}_adsh`);
          inc(s.counters, `inlineurl_cik_path_${/^0/.test(urlCik) ? "zero_padded" : "no_leading_zeros"}`);
        }
        const sub = subByAdsh.get(adsh);
        inc(s.counters, `adsh_in_sub=${sub ? "yes" : "no"}`);
        if (sub) inc(s.counters, `period_vs_sub_period=${sub.period === isoPeriod ? "equal" : "differs"}`);
        soiCikRows.set(cik, (soiCikRows.get(cik) ?? 0) + 1);
        const latest = soiCikLatest.get(cik);
        if (!latest || isoFiled > latest.filed || (isoFiled === latest.filed && adsh > latest.adsh)) {
          soiCikLatest.set(cik, { filed: isoFiled, adsh, inlineurl: url });
        }
      }
    };

    table.sha256 = member.bytes > 0 ? await streamMember(zip, member.path, onLine) : createHash("sha256").digest("hex");
    table.empty_file = member.bytes === 0;
    table.header = header;
    table.rows = rows;
    table.field_count_mismatches = fieldCountMismatches;
    table.header_vs_bdc_metadata = compareHeader(header, doc?.columns);

    if (name === "sub.tsv") Object.assign(table, { forms: s.forms, counters: s.counters, filed_range: s.filed, distinct_adsh: subByAdsh.size });
    if (name === "tag.tsv") {
      table.counters = s.counters;
      table.standard_tags_for_soi_preset_labels = Object.fromEntries([...soiLabelTags].map(([k, v]) => [k, [...v].sort()]));
    }
    if (name === "num.tsv") {
      Object.assign(table, {
        qtrs: s.qtrs,
        uom_top: Object.fromEntries(Object.entries(s.uom).sort((a, b) => b[1] - a[1]).slice(0, 12)),
        uom_distinct: Object.keys(s.uom).length,
        counters: s.counters,
        footnotes_longer_than_512_bytes: s.footOver512,
        units_for_soi_preset_labels_on_identifier_axis_rows: s.labelUnits,
        magnitude_bands_for_soi_preset_labels_on_identifier_axis_rows: s.labelBands,
      });
    }
    if (name === "txt.tsv") Object.assign(table, { qtrs: s.qtrs, counters: s.counters, footnotes_longer_than_512_bytes: s.footOver512 });
    if (name === "pre.tsv") table.counters = s.counters;
    if (name === "non.tsv") Object.assign(table, { forms: s.forms, distinct_adsh: s.adshRows.size });
    if (name === "soi.tsv" && header) {
      const ddatesPerAdsh = {};
      for (const set of s.adshDdates.values()) inc(ddatesPerAdsh, String(set.size));
      Object.assign(table, {
        columns: Object.fromEntries(
          header.map((h, i) => [
            `${String(i + 1).padStart(3, "0")} ${h}`,
            { non_empty: s.cols[i].non_empty, format_classes: s.cols[i].classes, magnitude_bands: s.cols[i].bands },
          ]),
        ),
        preset_columns_present: (documented["soi.tsv"]?.columns ?? []).filter((c) => header.includes(c)).length,
        dynamic_columns: header.length - (documented["soi.tsv"]?.columns ?? []).filter((c) => header.includes(c)).length,
        grain: {
          distinct_adsh: s.adshRows.size,
          distinct_registrant_cik: soiCikRows.size,
          rows_per_adsh: distribution([...s.adshRows.values()]),
          distinct_ddate_values_per_adsh: ddatesPerAdsh,
          candidate_keys: {
            "adsh+identifier+ddate": { distinct: s.keys.k1.size, duplicate_rows: rows - s.keys.k1.size },
            "adsh+identifier+ddate+qtrs": { distinct: s.keys.k2.size, duplicate_rows: rows - s.keys.k2.size },
            "entire_row": { distinct: s.keys.k3.size, duplicate_rows: rows - s.keys.k3.size },
          },
        },
        qtrs: s.qtrs,
        forms: s.forms,
        counters: s.counters,
        filed_range: s.filed,
        ddate_range: s.ddate,
        period_range: s.period,
      });
    }
    snapshot.tables[name] = table;
    process.stderr.write(`  ${fixture.id} ${name}: ${rows} rows\n`);
  }

  // For SOI rows with an identifier, count how often each SOI column's value equals a NUM
  // fact of each standard tag for the same accession, date, and identifier member.
  const agreement = {};
  for (const [key, values] of soiAgreementValues) {
    const byTag = numAgreementValues.get(key);
    for (const [label, value] of values) {
      agreement[label] ??= { soi_values_with_identifier: 0, no_num_fact_for_key: 0, equals_num_tag: {} };
      const a = agreement[label];
      a.soi_values_with_identifier += 1;
      if (!byTag) {
        a.no_num_fact_for_key += 1;
        continue;
      }
      for (const tag of NUM_AGREEMENT_TAGS) {
        if (byTag.get(tag)?.has(value)) inc(a.equals_num_tag, tag);
      }
    }
  }
  snapshot.soi_vs_num_value_agreement = {
    method:
      "Counts of SOI values (rows with a non-empty identifier) equal to a NUM value of each tag with the same adsh, ddate, and InvestmentIdentifierAxis typed member. Counts only; no values recorded.",
    by_soi_column: agreement,
  };

  if (select) {
    const ranked = [...soiCikRows].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    selection[fixture.id] = ranked.slice(0, 3).map(([cik, n]) => ({ cik, soi_rows: n, latest: soiCikLatest.get(cik) }));
  }
  snapshot.registrant_ciks_in_soi = soiCikRows.size;
  snapshot._soiCiks = [...soiCikRows.keys()];
  return snapshot;
}

// ---------- other source types ----------

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v !== ""));
}

const VERIFIED_BDC_REPORT_HEADER = ["File_No", "CIK", "Registrant_Name", "Address_1", "Address_2", "City", "State", "Zip_Code", "Filing Date", "Filing Type"];

function analyzeBdcReportCsv(fixture) {
  const text = readFileSync(cachePath(fixture), "utf8");
  const rows = parseCsv(text.replace(/^\uFEFF/, ""));
  const header = rows[0];
  const data = rows.slice(1);
  const columns = {};
  header.forEach((h, i) => {
    const classes = {};
    let nonEmpty = 0;
    for (const r of data) {
      const v = (r[i] ?? "").trim();
      if (v !== "") nonEmpty += 1;
      inc(classes, v === "" ? "empty" : classify(v));
    }
    columns[`${String(i + 1).padStart(2, "0")} ${h}`] = { non_empty: nonEmpty, format_classes: classes };
  });
  const cikIndex = header.findIndex((h) => /cik/i.test(h));
  const cikLengths = {};
  for (const r of data) inc(cikLengths, `len${(r[cikIndex] ?? "").trim().length}`);
  const typeIndex = header.findIndex((h) => /type/i.test(h));
  const types = {};
  for (const r of data) inc(types, (r[typeIndex] ?? "").trim() || "(empty)");
  return {
    snapshot: {
      fixture_id: fixture.id,
      source_type: fixture.source_type,
      fixture_sha256: fixture.retrieval.sha256,
      header,
      header_equals_verified_2026_layout: JSON.stringify(header) === JSON.stringify(VERIFIED_BDC_REPORT_HEADER),
      starts_with_byte_order_mark: text.charCodeAt(0) === 0xfeff,
      rows: data.length,
      field_count_mismatches: data.filter((r) => r.length !== header.length).length,
      columns,
      cik_value_lengths: cikLengths,
      type_last_filing_values: types,
    },
    ciks: new Set(data.map((r) => String(Number((r[cikIndex] ?? "").trim())))),
  };
}

function analyzeBdcReportXml(fixture) {
  const xml = readFileSync(cachePath(fixture), "utf8");
  const elements = {};
  for (const m of xml.matchAll(/<([A-Za-z_][\w.-]*)[\s>/]/g)) inc(elements, m[1]);
  return {
    fixture_id: fixture.id,
    source_type: fixture.source_type,
    fixture_sha256: fixture.retrieval.sha256,
    xml_declaration: (xml.match(/^<\?xml[^>]*\?>/) ?? [null])[0],
    element_name_counts: elements,
  };
}

function analyzeTickers(fixture) {
  const json = JSON.parse(readFileSync(cachePath(fixture), "utf8"));
  const fields = json.fields ?? null;
  const data = json.data ?? [];
  const types = {};
  if (fields) fields.forEach((f, i) => {
    types[f] = {};
    for (const r of data) inc(types[f], r[i] === null ? "null" : typeof r[i]);
  });
  const cikIndex = fields ? fields.indexOf("cik") : -1;
  return {
    snapshot: {
      fixture_id: fixture.id,
      source_type: fixture.source_type,
      fixture_sha256: fixture.retrieval.sha256,
      top_level_keys: Object.keys(json),
      fields,
      rows: data.length,
      value_types_by_field: types,
    },
    ciks: new Set(cikIndex >= 0 ? data.map((r) => String(r[cikIndex])) : []),
  };
}

function describeJson(value, depth = 0) {
  if (Array.isArray(value)) {
    return { type: "array", length: value.length, ...(value.length && depth < 3 ? { element: describeJson(value[0], depth + 1) } : {}) };
  }
  if (value && typeof value === "object") {
    return { type: "object", keys: Object.fromEntries(Object.keys(value).map((k) => [k, depth < 3 ? describeJson(value[k], depth + 1) : { type: typeof value[k] }])) };
  }
  return { type: value === null ? "null" : typeof value };
}

function analyzeSubmissions(fixture, soiAdshByCik) {
  const json = JSON.parse(readFileSync(cachePath(fixture), "utf8"));
  const recent = json.filings?.recent ?? {};
  const recentKeys = Object.keys(recent);
  const lengths = {};
  for (const k of recentKeys) inc(lengths, String(recent[k].length));
  const cik = String(Number(json.cik));
  const accessions = new Set(recent.accessionNumber ?? []);
  const soiAdsh = soiAdshByCik.get(cik) ?? new Set();
  let found = 0;
  for (const a of soiAdsh) if (accessions.has(a)) found += 1;
  const shape = describeJson(json);
  // Never record values: replace the recent-filings arrays by their key names only.
  if (shape.keys?.filings?.keys?.recent) shape.keys.filings.keys.recent = { type: "object", column_arrays: recentKeys };
  return {
    fixture_id: fixture.id,
    source_type: fixture.source_type,
    fixture_sha256: fixture.retrieval.sha256,
    structure: shape,
    recent_array_lengths: lengths,
    older_filing_files: (json.filings?.files ?? []).length,
    older_filing_file_entry_keys: json.filings?.files?.[0] ? Object.keys(json.filings.files[0]) : [],
    soi_accessions_for_this_cik_in_cached_datasets: soiAdsh.size,
    of_which_found_in_recent_accessionNumber: found,
  };
}

// Additional submissions page named by a parent file's filings.files[] entry (never values).
function analyzeSubmissionsPage(fixture) {
  const json = JSON.parse(readFileSync(cachePath(fixture), "utf8"));
  const keys = Object.keys(json);
  const lengths = {};
  for (const k of keys) inc(lengths, Array.isArray(json[k]) ? String(json[k].length) : "not_array");
  const name = path.basename(fixture.url);
  const parent = manifest.fixtures.find(
    (f) => f.source_type === "submissions_json" && existsSync(cachePath(f)) && name.startsWith(path.basename(f.url, ".json")),
  );
  const result = { fixture_id: fixture.id, source_type: fixture.source_type, fixture_sha256: fixture.retrieval.sha256, top_level_keys: keys, array_lengths: lengths };
  if (parent) {
    const p = JSON.parse(readFileSync(cachePath(parent), "utf8"));
    const entry = (p.filings?.files ?? []).find((e) => e.name === name);
    const dates = json.filingDate ?? [];
    const recent = new Set(p.filings?.recent?.accessionNumber ?? []);
    result.parent_fixture = parent.id;
    result.named_in_parent_files_array = Boolean(entry);
    result.keys_equal_parent_recent_keys = JSON.stringify(keys) === JSON.stringify(Object.keys(p.filings?.recent ?? {}));
    result.array_length_equals_parent_filing_count = Boolean(entry) && (json.accessionNumber ?? []).length === entry.filingCount;
    result.filing_dates_within_parent_entry_range = Boolean(entry) && dates.every((d) => d >= entry.filingFrom && d <= entry.filingTo);
    result.accessions_also_in_parent_recent = (json.accessionNumber ?? []).filter((a) => recent.has(a)).length;
    result.accession_prefix_differs_from_registrant_cik = (json.accessionNumber ?? []).filter((a) => Number(a.slice(0, 10)) !== Number(p.cik)).length;
  }
  return result;
}

function htmlText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/\s+/g, " ");
}

function analyzePage(fixture) {
  const html = readFileSync(cachePath(fixture), "utf8");
  const text = htmlText(html);
  const phrases = new Set();
  for (const m of text.matchAll(/[^.]*\b\d+\s*requests?\s*(?:per|\/)\s*second[^.]*\./gi)) phrases.add(m[0].trim());
  for (const m of text.matchAll(/(?:Current max request rate|declare your user agent)[^.]*\./gi)) phrases.add(m[0].trim());
  const links = new Set();
  for (const m of html.matchAll(/href="([^"]+\.(?:zip|pdf|csv|xml|json))"/gi)) {
    const link = m[1].replace(/^https?:\/\/www\.sec\.gov/, "");
    if (link.startsWith("/")) links.add(link);
  }
  return {
    fixture_id: fixture.id,
    source_type: fixture.source_type,
    note: "HTML pages include dynamic markup; their checksums are expected to change on every retrieval",
    title: (html.match(/<title>([^<]*)<\/title>/i) ?? [null, null])[1]?.trim() ?? null,
    last_reviewed_or_updated: (text.match(/Last Reviewed or Updated:\s*([A-Z][a-z]+\.? \d{1,2}, \d{4})/) ?? [null, null])[1],
    fair_access_phrases: [...phrases].sort(),
    data_file_links: [...links].sort(),
  };
}

function analyzePdf(fixture) {
  const buf = readFileSync(cachePath(fixture));
  return {
    fixture_id: fixture.id,
    source_type: fixture.source_type,
    fixture_sha256: fixture.retrieval.sha256,
    bytes: buf.length,
    pdf_header: buf.subarray(0, 8).toString("latin1"),
    page_objects: (buf.toString("latin1").match(/\/Type\s*\/Page(?!s)/g) ?? []).length,
    note: "Transcribed manually into docs/SOURCE_SCHEMAS.md; not parsed by this script",
  };
}

function analyzeFilingIndex(fixture) {
  const json = JSON.parse(readFileSync(cachePath(fixture), "utf8"));
  const items = json.directory?.item ?? [];
  const types = {};
  for (const it of items) inc(types, path.extname(it.name ?? "") || "(none)");
  return {
    fixture_id: fixture.id,
    source_type: fixture.source_type,
    fixture_sha256: fixture.retrieval.sha256,
    structure: describeJson({ ...json, directory: { ...json.directory, item: items.slice(0, 1) } }),
    items: items.length,
    item_extensions: types,
  };
}

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

const normalizeText = (s) => decodeEntities(s).replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\s+/g, " ").trim();

function accessionFromArchiveUrl(url) {
  const m = url.match(/\/Archives\/edgar\/data\/\d+\/(\d{18})\//);
  return m ? `${m[1].slice(0, 10)}-${m[1].slice(10, 12)}-${m[1].slice(12)}` : null;
}

// Level 2 check: do the SOI identifier strings of this accession occur in the filing text?
function analyzePrimaryDocument(fixture, identifiers) {
  const html = readFileSync(cachePath(fixture), "utf8");
  const text = normalizeText(html.replace(/<[^>]+>/g, " "));
  const concepts = {};
  for (const m of html.matchAll(/<ix:(nonFraction|nonNumeric)\b[^>]*\bname="([^"]+)"/g)) inc(concepts, m[1]);
  const conceptNames = new Set([...html.matchAll(/<ix:nonFraction\b[^>]*\bname="([^"]+)"/g)].map((m) => m[1]));
  let found = 0;
  let foundParts = 0;
  for (const id of identifiers) {
    const n = normalizeText(id);
    if (text.includes(n)) found += 1;
    else {
      // Identifiers are often composed from several table cells joined by commas or pipes.
      const pieces = n.split(/\s*[,|]\s*/).filter((p) => p.length > 2);
      if (pieces.length && pieces.every((p) => text.includes(p))) foundParts += 1;
    }
  }
  return {
    fixture_id: fixture.id,
    source_type: fixture.source_type,
    fixture_sha256: fixture.retrieval.sha256,
    accession: accessionFromArchiveUrl(fixture.url),
    bytes: Buffer.byteLength(html),
    inline_xbrl_fact_elements: concepts,
    has_ix_header: html.includes("<ix:header"),
    selected_investment_concepts_present: NUM_AGREEMENT_TAGS.map((t) => `us-gaap:${t}`).filter((c) => conceptNames.has(c)),
    level2_identifier_presence: {
      method:
        "Distinct non-empty SOI identifier strings for this accession across cached datasets, entity-decoded and whitespace-normalized, searched in the tag-stripped document text. Counts only.",
      distinct_soi_identifiers: identifiers.size,
      found_as_whole_string: found,
      found_only_as_separate_parts: foundParts,
      not_found: identifiers.size - found - foundParts,
    },
  };
}

// ---------- main ----------

const selection = {};
const soiAdshByCik = new Map();
const primaryAccessions = new Set(
  manifest.fixtures.filter((f) => f.source_type === "filing_primary_document").map((f) => accessionFromArchiveUrl(f.url)),
);
const identifiersByAccession = new Map([...primaryAccessions].map((a) => [a, new Set()]));
const soiCikSets = {};
let bdcReportCiks = null;
let tickerCiks = null;
const written = [];

function write(id, snapshot) {
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${id}.json`);
  writeFileSync(file, `${JSON.stringify(sortDeep(snapshot), null, 2)}\n`);
  written.push(`${id}.json`);
}

for (const fixture of manifest.fixtures) {
  if (only && !only.has(fixture.id)) continue;
  if (!fixture.retrieval || !existsSync(cachePath(fixture))) {
    console.error(`${fixture.id}: not cached; run npm run sec:fetch first`);
    process.exit(1);
  }
  const actual = await sha256File(cachePath(fixture));
  if (actual !== fixture.retrieval.sha256) {
    console.error(`${fixture.id}: cached file checksum does not match manifest`);
    process.exit(1);
  }
  process.stderr.write(`${fixture.id} (${fixture.source_type})\n`);

  switch (fixture.source_type) {
    case "bdc_dataset_zip": {
      const snap = await analyzeDatasetZip(fixture, selection);
      soiCikSets[fixture.id] = new Set(snap._soiCiks);
      delete snap._soiCiks;
      write(fixture.id, snap);
      break;
    }
    case "bdc_report_csv": {
      const { snapshot, ciks } = analyzeBdcReportCsv(fixture);
      // JOINS compares against the first (2026) report only, so adding older years keeps it stable.
      bdcReportCiks ??= ciks;
      write(fixture.id, snapshot);
      break;
    }
    case "bdc_report_xml":
      write(fixture.id, analyzeBdcReportXml(fixture));
      break;
    case "sec_reference_json": {
      const { snapshot, ciks } = analyzeTickers(fixture);
      tickerCiks = ciks;
      write(fixture.id, snapshot);
      break;
    }
    case "submissions_json":
      write(fixture.id, analyzeSubmissions(fixture, soiAdshByCik));
      break;
    case "submissions_page_json":
      write(fixture.id, analyzeSubmissionsPage(fixture));
      break;
    case "filing_index_json":
      write(fixture.id, analyzeFilingIndex(fixture));
      break;
    case "filing_primary_document":
      write(fixture.id, analyzePrimaryDocument(fixture, identifiersByAccession.get(accessionFromArchiveUrl(fixture.url)) ?? new Set()));
      break;
    case "sec_web_page":
      write(fixture.id, analyzePage(fixture));
      break;
    case "sec_documentation_pdf":
      write(fixture.id, analyzePdf(fixture));
      break;
    default:
      process.stderr.write(`  ${fixture.id}: no structural analyzer for ${fixture.source_type}; checksum only\n`);
  }

  if (fixture.source_type === "bdc_dataset_zip") {
    await streamMember(cachePath(fixture), "soi.tsv", (() => {
      let header = null;
      return (line) => {
        if (!header) {
          header = line.split("\t");
          return;
        }
        const f = line.split("\t");
        const cik = String(Number(f[header.indexOf("cik")]));
        const adsh = f[header.indexOf("adsh")];
        if (!soiAdshByCik.has(cik)) soiAdshByCik.set(cik, new Set());
        soiAdshByCik.get(cik).add(adsh);
        const ident = f[header.indexOf(IDENTIFIER_COLUMN)];
        if (ident && identifiersByAccession.has(adsh)) identifiersByAccession.get(adsh).add(ident);
      };
    })()).catch(() => {});
  }
}

if (!only || only.size > 1) {
  const joins = { fixture_id: "JOINS", description: "Identifier overlap between cached sources (counts only)" };
  const allSoi = new Set(Object.values(soiCikSets).flatMap((s) => [...s].map((c) => String(Number(c)))));
  joins.distinct_registrant_ciks_across_cached_soi = allSoi.size;
  if (bdcReportCiks) {
    joins.bdc_report_ciks = bdcReportCiks.size;
    joins.soi_ciks_found_in_bdc_report = [...allSoi].filter((c) => bdcReportCiks.has(c)).length;
  }
  if (tickerCiks) {
    joins.soi_ciks_found_in_ticker_file = [...allSoi].filter((c) => tickerCiks.has(c)).length;
    if (bdcReportCiks) joins.bdc_report_ciks_found_in_ticker_file = [...bdcReportCiks].filter((c) => tickerCiks.has(c)).length;
  }
  write("JOINS", joins);
}

if (select) console.log(JSON.stringify(selection, null, 2));

if (check) {
  let diffs = 0;
  for (const file of written) {
    const committed = path.join(snapshotDir, file);
    const fresh = readFileSync(path.join(outDir, file), "utf8");
    if (!existsSync(committed) || readFileSync(committed, "utf8") !== fresh) {
      console.error(`snapshot differs from committed version: ${file}`);
      diffs += 1;
    }
  }
  const committedFiles = existsSync(snapshotDir) ? readdirSync(snapshotDir).filter((f) => f.endsWith(".json")) : [];
  console.log(`sec:inspect --check: ${written.length} snapshot(s) regenerated in ${outDir}, ${diffs} difference(s), ${committedFiles.length} committed`);
  process.exit(diffs > 0 ? 1 : 0);
}

console.log(`sec:inspect wrote ${written.length} snapshot(s) to ${path.relative(repoRoot, outDir)}`);
