// Local dry-run for the verified Golden Borrower date bindings.
// Reads the stored filing bytes at the supplied coordinates only.
// Does not connect to a database, fetch, or insert a field value.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { DEFAULT_DATA_DIR } from "../lib/config.mjs";
import { planVerifiedDates, summarizeDatePlan } from "../normalize/date-field-plan.mjs";

export const DATE_ARTIFACTS = {
  358: "2b472c1f58a3eb6dab7fbc42e5af4cfe07ae407fee40ac1419278e0c4cacf705",
  359: "5a4db508455ee15237a5889f3652973566485aee5cf7009430e8d23d790e81e4",
  360: "0cef9248effd289622688901b52b9d1fc60b9efdba7c2933923c711dd69cdc72",
  361: "1198e53d4e4112e184f81b370b72d069d78995cd9c443c2e6b9dcf69819ad0c5",
  363: "bd067eba79026c2d3ee92dc7702b68013cd76628b91a59590d730ce4bd533519",
  364: "833590b020c2958a666dce2c9c09918aaa98308e5adff4a9339f104299dc1603",
  366: "add07d1dae169ff7b656538618c5e2bf9504234d7d333b77dff83a0eda8ac6c0",
  368: "c20adec5bed72b1b59b706ea5396efb77888ee25bc1a40bda29c1518a6d6e05b",
  369: "e0c6e1728e2ef4bc1f0bea545fab669d4a9f96a826cfcffc74c997f37d594f32",
  371: "2358e8ed1eee525071a99fce4ce697787e4f1ddfce9730b7e1fa727f43c09fba",
};

function month(observationId, artifactId, reportedDate, valueRow, valueSlot, rawDate, expectedField, headingRow, matchedText) {
  return {
    observationId,
    artifactId,
    reportedDate,
    valueRow,
    valueSlot,
    rawDate,
    expectedField,
    headings: [{ row: headingRow, slot: valueSlot, matchedText }],
  };
}

function stacked(observationId, artifactId, reportedDate, valueRow, slot, rawDate, maturityRow, dateRow) {
  return {
    observationId,
    artifactId,
    reportedDate,
    valueRow,
    valueSlot: slot,
    rawDate,
    expectedField: "MATURITY_DATE",
    headings: [
      { row: maturityRow, slot, matchedText: "Maturity" },
      { row: dateRow, slot, matchedText: "Date" },
    ],
  };
}

export const VERIFIED_DATE_BINDINGS = [
  month(893583, 369, "2024-09-30", 296, 39, "04/2023", "ACQUISITION_DATE", 293, "Purchase Date"),
  month(893583, 369, "2024-09-30", 296, 45, "12/2028", "MATURITY_DATE", 293, "Maturity/Expiration Date"),
  month(893584, 369, "2024-09-30", 297, 39, "04/2023", "ACQUISITION_DATE", 293, "Purchase Date"),
  month(893584, 369, "2024-09-30", 297, 45, "12/2028", "MATURITY_DATE", 293, "Maturity/Expiration Date"),
  month(893587, 364, "2024-09-30", 395, 30, "05/2020", "ACQUISITION_DATE", 366, "Acquisition Date"),
  month(893587, 364, "2024-09-30", 395, 36, "12/2028", "MATURITY_DATE", 366, "Maturity/Expiration Date"),
  month(981407, 368, "2024-06-30", 275, 33, "04/2023", "ACQUISITION_DATE", 251, "Purchase Date"),
  month(981407, 368, "2024-06-30", 275, 39, "12/2028", "MATURITY_DATE", 251, "Maturity/Expiration Date"),
  month(981408, 368, "2024-06-30", 276, 33, "04/2023", "ACQUISITION_DATE", 251, "Purchase Date"),
  month(981408, 368, "2024-06-30", 276, 39, "12/2028", "MATURITY_DATE", 251, "Maturity/Expiration Date"),
  month(981411, 363, "2024-06-30", 387, 30, "05/2020", "ACQUISITION_DATE", 378, "Acquisition Date"),
  month(981411, 363, "2024-06-30", 387, 36, "12/2028", "MATURITY_DATE", 378, "Maturity/Expiration Date"),
  month(1067074, 371, "2024-03-31", 236, 30, "10/2023", "ACQUISITION_DATE", 201, "Purchase Date"),
  month(1067074, 371, "2024-03-31", 236, 36, "12/2028", "MATURITY_DATE", 201, "Maturity/Expiration Date"),
  month(1146287, 366, "2023-12-31", 420, 30, "04/2023", "ACQUISITION_DATE", 385, "Purchase Date"),
  month(1146287, 366, "2023-12-31", 420, 36, "12/2028", "MATURITY_DATE", 385, "Maturity/Expiration Date"),
  month(1146286, 361, "2023-12-31", 535, 30, "05/2020", "ACQUISITION_DATE", 506, "Acquisition Date"),
  month(1146286, 361, "2023-12-31", 535, 36, "12/2028", "MATURITY_DATE", 506, "Maturity/Expiration Date"),
  month(1146289, 361, "2022-12-31", 1373, 30, "05/2020", "ACQUISITION_DATE", 1338, "Acquisition Date"),
  month(1146289, 361, "2022-12-31", 1373, 36, "12/2025", "MATURITY_DATE", 1338, "Maturity/Expiration Date"),
  stacked(1416599, 358, "2022-09-30", 1377, 18, "12/19/2025", 1360, 1361),
  stacked(1416598, 358, "2022-03-31", 1441, 18, "12/19/2025", 1424, 1425),
  stacked(1394757, 359, "2022-12-31", 1449, 18, "12/19/2025", 1432, 1433),
  stacked(1394756, 359, "2022-03-31", 1512, 18, "12/19/2025", 1495, 1496),
  stacked(1328736, 360, "2023-03-31", 1839, 18, "12/19/2025", 1824, 1825),
  stacked(1328735, 360, "2022-03-31", 1900, 18, "12/19/2025", 1883, 1884),
];

export function loadDateArtifactHtml(dataDir = DEFAULT_DATA_DIR) {
  const htmlByArtifact = new Map();
  for (const [id, sha256] of Object.entries(DATE_ARTIFACTS)) {
    const file = `${dataDir}/raw/sha256/${sha256.slice(0, 2)}/${sha256}`;
    const bytes = readFileSync(file);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== sha256) throw new Error(`artifact ${id} bytes do not match the stored sha256`);
    htmlByArtifact.set(Number(id), bytes.toString("utf8"));
  }
  return htmlByArtifact;
}

export function dryRunVerifiedDates(dataDir = DEFAULT_DATA_DIR) {
  return planVerifiedDates(VERIFIED_DATE_BINDINGS, loadDateArtifactHtml(dataDir));
}

function isDirect() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isDirect()) {
  const plan = dryRunVerifiedDates();
  if (!plan.accepted) throw new Error(`${plan.observationId ?? ""} ${plan.reason}`.trim());
  const summary = summarizeDatePlan(plan);
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  for (const field of plan.fields) {
    process.stdout.write([
      field.observationId,
      field.artifactId,
      field.fieldCode,
      field.rawValue,
      field.precision,
      field.datePrecision ?? "",
      field.normalizedYear ?? "",
      field.normalizedMonth ?? "",
      field.normalizedDate ?? "",
      field.valueRow,
      field.valueSlot,
      field.headingKeys.join("+"),
    ].join("\t") + "\n");
  }
}
