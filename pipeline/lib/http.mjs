// SEC HTTP client: allowed hosts only, at most one request per MIN_INTERVAL_MS, stop on 403/429,
// at most MAX_RETRIES retries with backoff on 5xx or network errors, 404 returned to the caller.
// The User-Agent value is sent but never logged, stored, or included in errors.

import {
  ACCEPT_ENCODING, ALLOWED_HOSTS, MAX_RETRIES, MIN_INTERVAL_MS, RETRY_BACKOFF_MS, STOP_STATUSES,
} from "./config.mjs";

export class FairAccessStop extends Error {
  constructor(url, status) {
    super(`HTTP ${status} from ${url}; all requests stopped per the SEC fair-access policy`);
    this.status = status;
  }
}

export function requireUserAgent(env = process.env) {
  const value = (env.SEC_USER_AGENT ?? "").trim();
  if (!/^\S.*\s\S+@\S+\.\S+$/.test(value)) {
    throw new Error("SEC_USER_AGENT must be set (for example in .env.local) to a name and contact email");
  }
  return value;
}

export function isAllowedUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && ALLOWED_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createSecClient({
  userAgent, fetchImpl = globalThis.fetch, sleep = defaultSleep, now = () => Date.now(),
  minIntervalMs = MIN_INTERVAL_MS, maxRetries = MAX_RETRIES, backoffMs = RETRY_BACKOFF_MS,
}) {
  if (!userAgent) throw new Error("a User-Agent is required");
  let lastRequestAt = -Infinity;
  let requestCount = 0;

  async function throttle() {
    const wait = lastRequestAt + minIntervalMs - now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = now();
    requestCount += 1;
  }

  async function get(url) {
    if (!isAllowedUrl(url)) throw new Error(`refused: ${url} is not https on an allowed SEC host`);
    for (let attempt = 0; ; attempt += 1) {
      await throttle();
      let response;
      try {
        response = await fetchImpl(url, {
          headers: { "User-Agent": userAgent, "Accept-Encoding": ACCEPT_ENCODING },
          redirect: "follow",
        });
      } catch (error) {
        if (attempt < maxRetries) {
          await sleep(backoffMs[Math.min(attempt, backoffMs.length - 1)]);
          continue;
        }
        throw new Error(`request to ${url} failed after ${attempt + 1} attempt(s): ${error.message}`);
      }
      const finalUrl = response.url || url;
      if (!isAllowedUrl(finalUrl)) throw new Error(`refused: ${url} redirected off the allowed SEC hosts`);
      if (STOP_STATUSES.has(response.status)) throw new FairAccessStop(url, response.status);
      if (response.status >= 500 && attempt < maxRetries) {
        await sleep(backoffMs[Math.min(attempt, backoffMs.length - 1)]);
        continue;
      }
      if (response.status >= 500) throw new Error(`HTTP ${response.status} from ${url} after ${attempt + 1} attempt(s)`);
      if (response.status !== 404 && (response.status < 200 || response.status > 299)) {
        throw new Error(`unexpected HTTP ${response.status} from ${url}`);
      }
      const body = Buffer.from(await response.arrayBuffer());
      return {
        status: response.status,
        finalUrl,
        contentType: response.headers.get("content-type"),
        lastModified: response.headers.get("last-modified"),
        etag: response.headers.get("etag"),
        body,
        attempts: attempt + 1,
      };
    }
  }

  return { get, requestCount: () => requestCount };
}
