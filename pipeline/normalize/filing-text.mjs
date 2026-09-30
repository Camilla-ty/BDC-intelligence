// Exact-string presence in a fetched filing document (P5-min).
// This is not an iXBRL or HTML parser: it does not extract facts, reconstruct tables,
// collapse whitespace in the needle, split on "|", or invent a match (G-01, G-08).

export function decodeHtmlEntities(text) {
  if (typeof text !== "string") throw new Error("decodeHtmlEntities requires a string");
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

export function stripTags(text) {
  if (typeof text !== "string") throw new Error("stripTags requires a string");
  return text.replace(/<[^>]+>/g, " ");
}

export function needleInFiling(buffer, needle) {
  if (!Buffer.isBuffer(buffer)) throw new Error("needleInFiling requires a Buffer");
  if (typeof needle !== "string") throw new Error("needle must be a string");
  if (needle === "") return false;
  const raw = buffer.toString("utf8");
  if (raw.includes(needle)) return true;
  const decoded = decodeHtmlEntities(raw);
  if (decoded.includes(needle)) return true;
  return stripTags(decoded).includes(needle);
}
