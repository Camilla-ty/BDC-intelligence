// BORROWER_NAME_NORMALIZE guard. The current head of a supplied root is the row in its
// supersession chain that no later row supersedes — the same predicate as
// obs.current_borrower_name_observation. A head that already records this normalization
// inserts nothing. A root that is itself the head inserts one successor. Any other head
// fails closed. This module does not update or delete rows and does not open a second branch.

import {
  BORROWER_NAME_RULE_CODE, BORROWER_NAME_RULE_VERSION, normalizeBorrowerName,
} from "../normalize/borrower-name.mjs";

export const BORROWER_NAME_SUPERSEDE_REASON = "norm.borrower_name v1 applied to RAW_ONLY filing cell";

export class BorrowerNameHeadConflictError extends Error {
  constructor(rootId, head, expected) {
    const shown = head.normalizedText == null ? "NULL" : JSON.stringify(head.normalizedText);
    const expectedText = expected.normalizedText == null ? "NULL" : JSON.stringify(expected.normalizedText);
    super(`borrower name ${rootId} current head ${head.id} conflicts with ${BORROWER_NAME_RULE_CODE} v${BORROWER_NAME_RULE_VERSION} (rule_version_id ${head.ruleVersionId}, extraction_state ${head.extractionState}, normalized_text ${shown}; expected rule_version_id ${expected.ruleVersionId}, extraction_state ${expected.extractionState}, normalized_text ${expectedText})`);
    this.name = "BorrowerNameHeadConflictError";
    this.rootId = rootId;
    this.currentHeadId = head.id;
  }
}

function assertRule(rule) {
  if (rule?.code !== BORROWER_NAME_RULE_CODE || String(rule.version) !== BORROWER_NAME_RULE_VERSION || !Number.isInteger(rule.id)) {
    throw new Error(`${BORROWER_NAME_RULE_CODE} v${BORROWER_NAME_RULE_VERSION} requires its stored rule version`);
  }
}

// True when no row in the set supersedes this one. That is the current-view predicate.
export function isCurrentBorrowerNameHead(row, rows) {
  return !rows.some((other) => other.supersedesId === row.id);
}

export function currentHeadOfChain(rootId, rows) {
  const byId = new Map();
  const children = new Map();
  for (const row of rows) {
    if (byId.has(row.id)) throw new Error(`borrower name ${row.id} is listed twice`);
    byId.set(row.id, row);
    if (row.supersedesId == null) continue;
    const next = children.get(row.supersedesId) ?? [];
    next.push(row);
    children.set(row.supersedesId, next);
  }
  const root = byId.get(rootId);
  if (!root) throw new Error(`borrower name ${rootId} is not in the lineage`);
  let head = root;
  const seen = new Set();
  while (true) {
    if (seen.has(head.id)) throw new Error(`borrower name ${rootId} lineage cycles at ${head.id}`);
    seen.add(head.id);
    const next = children.get(head.id) ?? [];
    if (next.length > 1) throw new Error(`borrower name ${head.id} has more than one successor`);
    if (next.length === 0) break;
    head = next[0];
  }
  if (!isCurrentBorrowerNameHead(head, rows)) {
    throw new Error(`borrower name ${rootId} chain does not reach a current head`);
  }
  return head;
}

function sameNormalization(head, expected) {
  return head.ruleVersionId === expected.ruleVersionId
    && head.extractionState === expected.extractionState
    && (head.normalizedText ?? null) === (expected.normalizedText ?? null);
}

function successorOf(root, expected) {
  return {
    positionObservationId: root.positionObservationId,
    evidenceId: root.evidenceId,
    rawText: root.rawText,
    nameSource: root.nameSource,
    sourceColumnLabel: root.sourceColumnLabel ?? null,
    sourceColumnPosition: root.sourceColumnPosition ?? null,
    extractionState: expected.extractionState,
    normalizedText: expected.normalizedText,
    ruleVersionId: expected.ruleVersionId,
    supersedesId: root.id,
    supersedeReason: BORROWER_NAME_SUPERSEDE_REASON,
  };
}

// One supplied root. `rows` must include that root and every descendant. The expected
// result is normalizeBorrowerName(root.rawText) under the supplied rule version.
export function planBorrowerNameSuccessor(root, rows, rule) {
  assertRule(rule);
  if (root?.id == null) throw new Error("borrower name root is missing");
  const expected = {
    ...normalizeBorrowerName(root.rawText),
    ruleVersionId: rule.id,
  };
  const head = currentHeadOfChain(root.id, rows);
  if (sameNormalization(head, expected)) {
    return { action: "skip", rootId: root.id, currentHeadId: head.id };
  }
  if (head.id === root.id) {
    return { action: "insert", rootId: root.id, successor: successorOf(root, expected) };
  }
  throw new BorrowerNameHeadConflictError(root.id, head, expected);
}

// Plans every supplied root before any insert. A conflict throws, so the caller writes nothing.
export function planBorrowerNameNormalize(roots, rows, rule) {
  const seen = new Set();
  const plans = roots.map((root) => {
    if (seen.has(root.id)) throw new Error(`borrower name ${root.id} is supplied twice`);
    seen.add(root.id);
    return planBorrowerNameSuccessor(root, rows, rule);
  });
  return {
    inserts: plans.filter((plan) => plan.action === "insert"),
    skips: plans.filter((plan) => plan.action === "skip"),
  };
}
