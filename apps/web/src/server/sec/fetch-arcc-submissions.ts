import {
  assembleCoverage,
  parseSubmissionsMain,
  parseSubmissionsPage,
  rowsFromFilingArrays,
  type SecSubmissionsCoverage,
} from "@/lib/sec-submissions";
import { ARCC_CIK, submissionsPageUrl, submissionsUrl } from "@/server/sec/config";
import { createSecClient, requireUserAgent, type SecEnv } from "@/server/sec/http";

export type FetchArccOptions = {
  env?: SecEnv;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  now?: () => Date;
  cik?: string;
};

function decodeJson(body: ArrayBuffer): unknown {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  return JSON.parse(text) as unknown;
}

export async function fetchArccSecSubmissions(
  options: FetchArccOptions = {},
): Promise<{ coverage: SecSubmissionsCoverage | null; error: string | null }> {
  const env = options.env ?? (process.env as SecEnv);
  const cik = options.cik ?? ARCC_CIK;
  const sourceUrl = submissionsUrl(cik);
  const fetchedAt = (options.now ?? (() => new Date()))().toISOString();

  let userAgent: string;
  try {
    userAgent = requireUserAgent(env);
  } catch (error) {
    return {
      coverage: null,
      error: error instanceof Error ? error.message : "SEC_USER_AGENT is not configured.",
    };
  }

  const client = createSecClient({
    userAgent,
    fetchImpl: options.fetchImpl ?? globalThis.fetch.bind(globalThis),
  });

  try {
    const mainResponse = await client.get(sourceUrl);
    if (mainResponse.status === 404) {
      return { coverage: null, error: `SEC submissions file was not found for CIK ${cik}.` };
    }
    const mainJson = decodeJson(mainResponse.body);
    const main = parseSubmissionsMain(mainJson, cik);
    if (main.error || main.recent == null) {
      return { coverage: null, error: main.error ?? "SEC submissions recent filings could not be read." };
    }
    const recentParsed = rowsFromFilingArrays(main.recent, main.cik, "filings.recent");
    if (recentParsed.error) {
      return { coverage: null, error: recentParsed.error };
    }

    const historyPageRows: ReturnType<typeof rowsFromFilingArrays>["rows"][] = [];
    let historyPagesFetched = 0;
    let historyPagesSkipped = 0;

    for (const file of main.files) {
      const pageUrl = file.name ? submissionsPageUrl(file.name) : null;
      if (pageUrl == null) {
        if (file.name) historyPagesSkipped += 1;
        continue;
      }
      const pageResponse = await client.get(pageUrl);
      if (pageResponse.status === 404) {
        return { coverage: null, error: `SEC history page was not found: ${file.name}` };
      }
      const pageJson = decodeJson(pageResponse.body);
      const page = parseSubmissionsPage(pageJson);
      if (page.error || page.arrays == null) {
        return { coverage: null, error: page.error ?? `SEC history page could not be read: ${file.name}` };
      }
      const parsed = rowsFromFilingArrays(page.arrays, main.cik, `history ${file.name}`);
      if (parsed.error) {
        return { coverage: null, error: `${file.name}: ${parsed.error}` };
      }
      historyPageRows.push(parsed.rows);
      historyPagesFetched += 1;
    }

    return {
      coverage: assembleCoverage({
        cik: main.cik,
        registrantName: main.registrantName,
        sourceUrl,
        fetchedAt,
        recentRows: recentParsed.rows,
        historyFiles: main.files,
        historyPageRows,
        historyPagesFetched,
        historyPagesSkipped,
      }),
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The SEC submissions request failed.";
    // Never echo SEC_USER_AGENT even if somehow present.
    return { coverage: null, error: message.replace(/User-Agent\s*[:=]\s*\S+/gi, "User-Agent=[redacted]") };
  }
}
