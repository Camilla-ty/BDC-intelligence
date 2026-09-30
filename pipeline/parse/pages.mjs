// Link extraction from the two SEC listing pages (SOURCE_SCHEMAS 3.2 and 6.1, observed markup).
// Only anchors are read; link text and the adjacent "Updated" text are kept exactly as shown.

const DATASET_LINK = /<a\s[^>]*href="(\/files\/[^"]*\/([0-9]{4}(?:q[1-4]|_[0-9]{2}))_bdc\.zip)"[^>]*>([^<]*)<\/a>/g;
const REPORT_CSV_LINK = /<a\s[^>]*href="(\/files\/[^"]*\.csv)"[^>]*>([^<]*)<\/a>(?:\s*<em>([^<]*)<\/em>)?/g;

export function releaseWindow(label) {
  const year = Number(label.slice(0, 4));
  const quarterly = /q[1-4]$/.test(label);
  const startMonth = quarterly ? (Number(label.slice(5)) - 1) * 3 + 1 : Number(label.slice(5));
  if (!quarterly && (startMonth < 1 || startMonth > 12)) throw new Error(`invalid release label ${label}`);
  const months = quarterly ? 3 : 1;
  const start = new Date(Date.UTC(year, startMonth - 1, 1));
  const end = new Date(Date.UTC(year, startMonth - 1 + months, 0));
  const iso = (d) => d.toISOString().slice(0, 10);
  return { cadence: quarterly ? "QUARTERLY" : "MONTHLY", windowStart: iso(start), windowEnd: iso(end) };
}

export function parseDatasetsPage(html) {
  const seen = new Map();
  let duplicates = 0;
  for (const m of html.matchAll(DATASET_LINK)) {
    const [, href, label, text] = m;
    if (seen.has(href)) {
      duplicates += 1;
      continue;
    }
    seen.set(href, { href, label, linkText: text, ...releaseWindow(label) });
  }
  return { links: [...seen.values()], duplicates };
}

export function parseBdcReportPage(html) {
  const seen = new Map();
  let duplicates = 0;
  for (const m of html.matchAll(REPORT_CSV_LINK)) {
    const [, href, text, updated] = m;
    if (seen.has(href)) {
      duplicates += 1;
      continue;
    }
    const yearLabel = text;
    seen.set(href, {
      href,
      url: `https://www.sec.gov${href}`,
      yearLabel,
      reportYear: /^[0-9]{4}$/.test(yearLabel) ? Number(yearLabel) : null,
      updatedLabel: updated ?? null,
    });
  }
  return { links: [...seen.values()], duplicates };
}
