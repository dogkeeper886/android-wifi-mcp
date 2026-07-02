/**
 * The one parser for a docs/tests/ scenario doc (ported from upstream
 * agent-workflows-runner, adapted to THIS repo's doc format).
 *
 * Format differences from upstream (see docs/tests/README.md):
 *   - case heading is `## TC-NN — title` (h2, em-dash), not `### TC-NN: title`
 *   - the steps table is 2 columns (Action | Expected Result), outcome-oriented —
 *     NOT numbered and NOT 1:1 with the YAML's steps
 *   - `**Objective:**` is scenario-level (top of file); cases may have none
 *   - `**Script:**` binds a case to its cicd YAML (the binding this parser feeds)
 * A case whose title carries `(to-be)` is intentionally not-yet-bound.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';

export interface TestCase {
  tc: string;        // "TC-01"
  title: string;
  toBe: boolean;     // title carries "(to-be)" — expected-unbound by design
  objective: string | null;
  script: string | null; // the bound cicd YAML path (repo-relative), or null
  steps: { action: string; expected: string }[];
}

export interface Scenario {
  frontMatter: Record<string, string>;
  cases: TestCase[];
}

/** Parse `key: value` front-matter between the first pair of `---` fences (LF or CRLF). */
export function parseFrontMatter(md: string): Record<string, string> {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fm: Record<string, string> = {};
  if (!m) return fm;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*?)\s*$/);
    if (kv) fm[kv[1]] = kv[2];
  }
  return fm;
}

/** Split a markdown table row into trimmed cells (unescaped pipes only). */
function tableCells(row: string): string[] {
  return row
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.replace(/\\\|/g, '|').trim());
}

/** The scenario docs in a docs/tests/ tree, recursively, in natural (numeric) order. */
export function scenarioFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string, prefix: string) => {
    const entries = readdirSync(d, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    for (const e of entries) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(`${d}/${e.name}`, rel);
      else if (e.name.endsWith('.md') && e.name !== 'README.md') out.push(rel);
    }
  };
  walk(dir, '');
  return out;
}

/** Parse a scenario file into its front-matter and cases (each with its steps). */
export function parseScenario(md: string): Scenario {
  const frontMatter = parseFrontMatter(md);
  // Strip fenced code blocks so an example `## TC-NN` inside ``` doesn't mint a case.
  const body = md.replace(/```[\s\S]*?```/g, '').replace(/~~~[\s\S]*?~~~/g, '');

  const cases: TestCase[] = [];
  // Every `## ` heading is a block boundary; only TC headings become cases, so a
  // `## Setup`/`## Notes` section can't bleed its Script/steps into a case.
  const h2 = [...body.matchAll(/^##\s+(.*)$/gm)];
  for (let i = 0; i < h2.length; i++) {
    const head = h2[i][1].trim();
    const tcm = head.match(/^(TC-\d+)\s*[—:-]?\s*(.*)$/);
    if (!tcm) continue;
    const start = h2[i].index! + h2[i][0].length;
    const end = i + 1 < h2.length ? h2[i + 1].index! : body.length;
    const block = body.slice(start, end);

    const steps: TestCase['steps'] = [];
    for (const line of block.split('\n')) {
      if (!line.trim().startsWith('|')) continue;
      const cells = tableCells(line);
      if (cells.length < 2) continue;
      if (/^:?-+:?$/.test(cells[0].replace(/\s/g, ''))) continue;        // separator (incl. :---:)
      if (cells[0].replace(/\*/g, '').toLowerCase() === 'action') continue; // header
      steps.push({ action: cells[0], expected: cells[1] ?? '' });
    }

    const title = tcm[2].trim();
    cases.push({
      tc: tcm[1],
      title,
      toBe: /\(to-be\)/i.test(title),
      objective: block.match(/\*\*Objective:\*\*[ \t]*(.+)/)?.[1]?.trim() ?? null,
      // Tolerate a path wrapped in backticks or with trailing punctuation.
      script: block.match(/\*\*Script:\*\*\s*`?([^\s`,;]+)/)?.[1] ?? null,
      steps,
    });
  }
  return { frontMatter, cases };
}

/** Read and parse a scenario file from disk. */
export function readScenario(file: string): Scenario {
  return parseScenario(readFileSync(file, 'utf8'));
}
