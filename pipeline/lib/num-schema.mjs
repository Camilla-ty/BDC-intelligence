// NUM table constants (SOURCE_SCHEMAS 3.3, 4.3). Kept out of pipeline/lib/config.mjs so
// edits do not change the definition_sha256 of every rule that includes that COMMON file.

export const NUM_MEMBER_PATH = "datasets/num.tsv";

// Documented NUM header in documented order (SOURCE_SCHEMAS 4.3). Any other header is schema drift.
export const VERIFIED_NUM_HEADER = Object.freeze([
  "adsh", "tag", "version", "ddate", "qtrs", "uom", "segments", "dimn", "value", "footnote", "footlen",
]);
