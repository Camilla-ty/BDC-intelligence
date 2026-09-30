#!/usr/bin/env node
// Verifies the agent guardrail files: required files exist, Cursor rules are configured
// correctly, every guardrail ID is documented and covered by a rule, and ADRs are
// well-formed. Node built-ins only. GUARDRAILS_ROOT overrides the repository root.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  process.env.GUARDRAILS_ROOT ?? path.join(path.dirname(fileURLToPath(import.meta.url)), ".."),
);

const GUARDRAIL_IDS = Array.from({ length: 17 }, (_, i) => `G-${String(i + 1).padStart(2, "0")}`);
const RULES_DIR = ".cursor/rules";
const CORE_RULE = "00-core-guardrails.mdc";
const ADR_DIR = "docs/adr";
const ADR_HEADINGS = ["## Status", "## Context", "## Decision", "## Consequences"];

const REQUIRED_FILES = [
  "AGENTS.md",
  "docs/METHODOLOGY.md",
  "docs/DEFINITION_OF_DONE.md",
  "docs/DATA_MODEL.md",
  `${ADR_DIR}/README.md`,
  `${RULES_DIR}/${CORE_RULE}`,
  `${RULES_DIR}/sec-sources.mdc`,
  `${RULES_DIR}/data-integrity-provenance.mdc`,
  `${RULES_DIR}/identity-resolution.mdc`,
  `${RULES_DIR}/deterministic-computation.mdc`,
  `${RULES_DIR}/no-scores-rankings.mdc`,
  `${RULES_DIR}/web-ui.mdc`,
  `${RULES_DIR}/tests-and-fixtures.mdc`,
  `${RULES_DIR}/db-schema.mdc`,
  `${ADR_DIR}/0001-record-architecture-decisions.md`,
  `${ADR_DIR}/0002-monorepo-and-web-toolchain.md`,
  `${ADR_DIR}/0003-local-only-reference-materials.md`,
  `${ADR_DIR}/0004-evidence-first-source-hierarchy.md`,
  `${ADR_DIR}/0005-append-only-history-and-raw-preservation.md`,
  `${ADR_DIR}/0006-identity-layers-and-resolution-states.md`,
  `${ADR_DIR}/0007-deterministic-computation-and-llm-boundary.md`,
  `${ADR_DIR}/0008-no-opaque-scores-or-rankings.md`,
  `${ADR_DIR}/0009-postgresql-and-plain-sql-migrations.md`,
  `${ADR_DIR}/0010-observation-provenance-and-authority-model.md`,
  `${ADR_DIR}/0011-registry-ingestion.md`,
  `${ADR_DIR}/0012-soi-ingestion.md`,
];

const errors = [];
const read = (rel) => readFileSync(path.join(repoRoot, rel), "utf8");
const idsIn = (text) => new Set(text.match(/\bG-\d{2}\b/g) ?? []);

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z]+):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  return { fields, body: text.slice(match[0].length) };
}

// 1. Required files
for (const rel of REQUIRED_FILES) {
  if (!existsSync(path.join(repoRoot, rel))) errors.push(`missing required file: ${rel}`);
}

// 2. Guardrail IDs documented in AGENTS.md
if (existsSync(path.join(repoRoot, "AGENTS.md"))) {
  const agentIds = idsIn(read("AGENTS.md"));
  for (const id of GUARDRAIL_IDS) {
    if (!agentIds.has(id)) errors.push(`AGENTS.md does not define ${id}`);
  }
  for (const id of agentIds) {
    if (!GUARDRAIL_IDS.includes(id)) errors.push(`AGENTS.md references unknown guardrail ${id}`);
  }
}

// 3. Cursor rules: frontmatter, apply configuration, declared guardrail coverage
const rulesPath = path.join(repoRoot, RULES_DIR);
const covered = new Set();
const ruleFiles = existsSync(rulesPath)
  ? readdirSync(rulesPath).filter((f) => f.endsWith(".mdc")).sort()
  : [];

for (const file of ruleFiles) {
  const rel = `${RULES_DIR}/${file}`;
  const parsed = parseFrontmatter(read(rel));
  if (!parsed) {
    errors.push(`${rel}: missing YAML frontmatter`);
    continue;
  }
  const { fields, body } = parsed;

  if (!fields.description) errors.push(`${rel}: frontmatter needs a non-empty description`);

  if (fields.alwaysApply !== "true" && fields.alwaysApply !== "false") {
    errors.push(`${rel}: alwaysApply must be true or false`);
  } else if (file === CORE_RULE) {
    if (fields.alwaysApply !== "true") errors.push(`${rel}: the core rule must be alwaysApply: true`);
  } else {
    if (fields.alwaysApply !== "false") {
      errors.push(`${rel}: only ${CORE_RULE} may be alwaysApply: true`);
    }
    if (!fields.globs) errors.push(`${rel}: scoped rules need non-empty globs`);
  }

  const declaration = body.match(/^Guardrails:(.*)$/m);
  if (!declaration) {
    errors.push(`${rel}: missing "Guardrails:" declaration line`);
    continue;
  }
  const declared = idsIn(declaration[1]);
  if (declared.size === 0) errors.push(`${rel}: "Guardrails:" line lists no IDs`);
  for (const id of declared) {
    if (GUARDRAIL_IDS.includes(id)) covered.add(id);
    else errors.push(`${rel}: declares unknown guardrail ${id}`);
  }
}

for (const id of GUARDRAIL_IDS) {
  if (!covered.has(id)) errors.push(`${id} is not declared by any rule in ${RULES_DIR}`);
}

// 4. ADR structure and index
const adrPath = path.join(repoRoot, ADR_DIR);
const adrFiles = existsSync(adrPath)
  ? readdirSync(adrPath).filter((f) => /^\d{4}-.+\.md$/.test(f)).sort()
  : [];
const adrIndex = existsSync(path.join(adrPath, "README.md")) ? read(`${ADR_DIR}/README.md`) : "";

for (const file of adrFiles) {
  const lines = read(`${ADR_DIR}/${file}`).split(/\r?\n/).map((l) => l.trim());
  for (const heading of ADR_HEADINGS) {
    if (!lines.includes(heading)) errors.push(`${ADR_DIR}/${file}: missing heading "${heading}"`);
  }
  if (!adrIndex.includes(`(${file})`)) errors.push(`${ADR_DIR}/README.md: index does not link ${file}`);
}

if (errors.length > 0) {
  console.error("verify:guardrails failed:");
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(
  `verify:guardrails passed: ${ruleFiles.length} rule(s), ${GUARDRAIL_IDS.length} guardrail IDs covered, ${adrFiles.length} ADR(s)`,
);
