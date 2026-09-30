// derived.golden_observation_count v1 (G-07).
// Count of distinct Golden position_observation ids. Not COST, not fair value, not Q14.
// Inputs are locator ids, not field values. The result is stored on the Golden Gate
// run outcome; it is not inserted into derived.derived_value (that table only accepts
// field-value or derived-value inputs).

export const GOLDEN_OBSERVATION_COUNT_CODE = "derived.golden_observation_count";
export const GOLDEN_OBSERVATION_COUNT_VERSION = "1";

export function uniquePositionObservationIds(positionObservationIds) {
  if (!Array.isArray(positionObservationIds)) {
    throw new Error("golden observation count requires an array of position_observation ids");
  }
  const seen = new Set();
  for (const raw of positionObservationIds) {
    const id = Number(raw);
    if (!Number.isSafeInteger(id) || id < 1) {
      throw new Error(`invalid position_observation_id: ${raw}`);
    }
    seen.add(id);
  }
  return [...seen].sort((a, b) => a - b);
}

export function goldenObservationCount(positionObservationIds) {
  return uniquePositionObservationIds(positionObservationIds).length;
}
