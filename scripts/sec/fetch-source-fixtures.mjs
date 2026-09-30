#!/usr/bin/env node
// Downloads the SEC source files listed in fixtures/sec/manifest.json into the git-ignored
// .cache/sec/ directory and records retrieval metadata (never the User-Agent value).
// Verification tooling only; not an ingestion pipeline. Never run in CI.
//
// Usage: npm run sec:fetch [-- --only F04,F05] [-- --refresh]

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifestPath = path.join(repoRoot, "fixtures/sec/manifest.json");
const MIN_INTERVAL_MS = 1100;

const args = process.argv.slice(2);
const refresh = args.includes("--refresh");
const onlyIndex = args.indexOf("--only");
const only = onlyIndex >= 0 ? new Set(args[onlyIndex + 1].split(",")) : null;

const userAgent = (process.env.SEC_USER_AGENT ?? "").trim();
if (!/^\S.*\s\S+@\S+\.\S+$/.test(userAgent)) {
  console.error(
    "sec:fetch refused: SEC_USER_AGENT must be set (e.g. in .env.local) to a name and contact email.",
  );
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const allowedHosts = new Set(manifest.request_policy.allowed_hosts);
const stopStatuses = new Set(manifest.request_policy.stop_on_http_status);

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const saveManifest = () => writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isAllowed(url) {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" && allowedHosts.has(hostname);
  } catch {
    return false;
  }
}

const selected = manifest.fixtures.filter((f) => !only || only.has(f.id));
const disallowed = selected.filter((f) => !isAllowed(f.url));
if (disallowed.length > 0) {
  for (const f of disallowed) console.error(`sec:fetch refused: ${f.id} URL is not https on an allowed SEC host`);
  process.exit(1);
}

let lastRequestAt = 0;
let failed = false;

for (const fixture of selected) {
  const cacheFile = path.join(repoRoot, fixture.cache_path);

  if (!refresh && fixture.retrieval?.sha256 && existsSync(cacheFile)) {
    const cachedHash = sha256(readFileSync(cacheFile));
    if (cachedHash === fixture.retrieval.sha256) {
      console.log(`${fixture.id}: cached, checksum matches, skipped`);
      continue;
    }
  }

  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();

  let response;
  try {
    response = await fetch(fixture.url, {
      headers: {
        "User-Agent": userAgent,
        "Accept-Encoding": manifest.request_policy.accept_encoding,
      },
      redirect: "follow",
    });
  } catch (error) {
    console.error(`${fixture.id}: request failed: ${error.message}`);
    failed = true;
    break;
  }

  if (!isAllowed(response.url)) {
    console.error(`${fixture.id}: redirected off the allowed SEC hosts; stopping without saving`);
    failed = true;
    break;
  }

  if (stopStatuses.has(response.status)) {
    console.error(`${fixture.id}: HTTP ${response.status}; stopping all requests per SEC fair-access policy`);
    failed = true;
    break;
  }
  if (!response.ok) {
    console.error(`${fixture.id}: HTTP ${response.status}; stopping`);
    failed = true;
    break;
  }

  const body = Buffer.from(await response.arrayBuffer());
  const hash = sha256(body);
  const previous = fixture.retrieval?.sha256 ?? null;

  mkdirSync(path.dirname(cacheFile), { recursive: true });
  writeFileSync(cacheFile, body);

  fixture.retrieval = {
    retrieved_at: new Date().toISOString(),
    final_url: response.url,
    http_status: response.status,
    content_type: response.headers.get("content-type"),
    content_encoding: response.headers.get("content-encoding"),
    content_length_header: response.headers.get("content-length"),
    last_modified: response.headers.get("last-modified"),
    etag: response.headers.get("etag"),
    bytes: body.length,
    sha256: hash,
    sha256_of: "response body after HTTP content decoding",
    ...(previous && previous !== hash ? { previous_sha256: previous } : {}),
  };
  saveManifest();
  console.log(`${fixture.id}: HTTP ${response.status}, ${body.length} bytes, sha256 ${hash.slice(0, 12)}…`);
}

saveManifest();
process.exit(failed ? 1 : 0);
