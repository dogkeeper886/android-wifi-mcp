/**
 * Scaffold a markdown test-doc from an existing cicd YAML (ported from upstream,
 * adapted to THIS repo's doc format).
 *
 * The "revert direction": bootstrap the human-readable half FROM an executable
 * that already exists. Output is a scaffold — it carries the steps and the
 * `**Script:**` binding; objective, expected results, story link, and namespace
 * are TODOs a human/agent fills, then `qw-review-bind` audits the result.
 *
 * Run: npm run port-yaml -- cicd/tests/testcases/wifi/TC-WIFI-002.yml > docs/tests/STORY-XXX/TS-NN-slug.md
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, isAbsolute } from 'node:path';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'); // cicd/tests/src → repo root

const rel = process.argv[2];
if (!rel) {
  console.error('usage: npm run port-yaml -- <repo-relative/path/to/TC-*.yml>');
  process.exit(2);
}
const yaml = readFileSync(isAbsolute(rel) ? rel : join(REPO_ROOT, rel), 'utf8');

const name = yaml.match(/^name:\s*(.*)$/m)?.[1]?.trim() ?? 'Ported scenario';

// Escape pipes so a cell containing `|` (a regex alternation) stays one cell
// when the doc is parsed back (testdoc.tableCells).
const esc = (s: string) => s.replace(/\|/g, '\\|');

// Each step starts at `  - name:`; its block runs to the next step or EOF.
const stepRe = /^\s*-\s+name:\s*(.*)$/gm;
const marks = [...yaml.matchAll(stepRe)];
const rows = marks.map((m, i) => {
  const start = m.index! + m[0].length;
  const end = i + 1 < marks.length ? marks[i + 1].index! : yaml.length;
  const block = yaml.slice(start, end);
  const expect = block.match(/expectPatterns:\s*\n\s*-\s*"?([^"\n]+)"?/)?.[1]?.trim();
  return `| ${esc(m[1].trim())} | ${esc(expect ?? 'TODO')} |`;
});

process.stdout.write(`---
id: TS-NN
title: ${name}
namespace: TODO
story: STORY-NNN
story_hash: TODO
plan: TODO
issue: TODO
status: unbound
---

# TS-NN: ${name}

**Objective:** TODO — link this to the story's need.

## TC-01 — ${name}

**Script:** ${rel}

| Action | Expected Result |
|---|---|
${rows.join('\n')}
`);
