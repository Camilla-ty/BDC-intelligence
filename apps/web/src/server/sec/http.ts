// SEC fair-access HTTP client for Admin Phase 1-A.
// Mirrors pipeline/lib/http.mjs: allowed hosts, throttle, stop on 403/429,
// User-Agent required and never returned in errors.

import {
  ACCEPT_ENCODING,
  ALLOWED_HOSTS,
  MAX_RETRIES,
  MIN_INTERVAL_MS,
  RETRY_BACKOFF_MS,
  STOP_STATUSES,
} from "@/server/sec/config";

export class FairAccessStop extends Error {
  readonly status: number;
  constructor(url: string, status: number) {
    super(`HTTP ${status} from ${url}; all requests stopped per the SEC fair-access policy`);
    this.status = status;
  }
}

/** Env slice used for SEC requests; tests pass a plain object. */
export type SecEnv = { SEC_USER_AGENT?: string };

export function requireUserAgent(env: SecEnv = process.env as SecEnv): string {
  const value = (env.SEC_USER_AGENT ?? "").trim();
  if (!/^\S.*\s\S+@\S+\.\S+$/.test(value)) {
    throw new Error("SEC_USER_AGENT must be set (for example in .env.local) to a name and contact email");
  }
  return value;
}

export function isAllowedUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && ALLOWED_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

export type SecGetResult = {
  status: number;
  finalUrl: string;
  contentType: string | null;
  body: ArrayBuffer;
};

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>;

export function createSecClient({
  userAgent,
  fetchImpl = globalThis.fetch.bind(globalThis) as FetchImpl,
  sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
  minIntervalMs = MIN_INTERVAL_MS,
  maxRetries = MAX_RETRIES,
  backoffMs = RETRY_BACKOFF_MS,
}: {
  userAgent: string;
  fetchImpl?: FetchImpl;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  minIntervalMs?: number;
  maxRetries?: number;
  backoffMs?: readonly number[];
}) {
  if (!userAgent) throw new Error("a User-Agent is required");
  let lastRequestAt = -Infinity;

  async function throttle() {
    const wait = lastRequestAt + minIntervalMs - now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = now();
  }

  async function get(url: string): Promise<SecGetResult> {
    if (!isAllowedUrl(url)) throw new Error(`refused: ${url} is not https on an allowed SEC host`);
    for (let attempt = 0; ; attempt += 1) {
      await throttle();
      let response: Response;
      try {
        response = await fetchImpl(url, {
          headers: { "User-Agent": userAgent, "Accept-Encoding": ACCEPT_ENCODING },
          redirect: "follow",
        });
      } catch (error) {
        if (attempt < maxRetries) {
          await sleep(backoffMs[Math.min(attempt, backoffMs.length - 1)] ?? 2000);
          continue;
        }
        const message = error instanceof Error ? error.message : "request failed";
        throw new Error(`request to ${url} failed after ${attempt + 1} attempt(s): ${message}`);
      }
      const finalUrl = response.url || url;
      if (!isAllowedUrl(finalUrl)) throw new Error(`refused: ${url} redirected off the allowed SEC hosts`);
      if (STOP_STATUSES.has(response.status)) throw new FairAccessStop(url, response.status);
      if (response.status >= 500 && attempt < maxRetries) {
        await sleep(backoffMs[Math.min(attempt, backoffMs.length - 1)] ?? 2000);
        continue;
      }
      if (response.status >= 500) {
        throw new Error(`HTTP ${response.status} from ${url} after ${attempt + 1} attempt(s)`);
      }
      if (response.status !== 404 && (response.status < 200 || response.status > 299)) {
        throw new Error(`unexpected HTTP ${response.status} from ${url}`);
      }
      return {
        status: response.status,
        finalUrl,
        contentType: response.headers.get("content-type"),
        body: await response.arrayBuffer(),
      };
    }
  }

  return { get };
}
