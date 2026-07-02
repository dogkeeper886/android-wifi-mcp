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

/** Parse `key: value` front-matter between the first pair of `---` fences. */
export function parseFrontMatter(md: string): Record<string, string> {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  const fm: Record<string, string> = {};
  if (!m) return fm;
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z_]+):\s*(.*?)\s*$/);
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

/** The scenario docs in a docs/tests/ tree, recursively, in stable order. */
export function scenarioFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string, prefix: string) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
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
  const cases: TestCase[] = [];

  // `## TC-NN — title` starts a case; its block runs to the next `## ` or EOF.
  const tcRe = /^##\s+(TC-\d+)\s*[—:-]?\s*(.*)$/gm;
  const matches = [...md.matchAll(tcRe)];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index! + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : md.length;
    const block = md.slice(start, end);

    const steps: TestCase['steps'] = [];
    for (const line of block.split('\n')) {
      if (!line.trim().startsWith('|')) continue;
      const cells = tableCells(line);
      if (cells.length < 2) continue;
      if (/^-+$/.test(cells[0].replace(/\s/g, ''))) continue;   // separator row
      if (cells[0].toLowerCase() === 'action') continue;        // header row
      steps.push({ action: cells[0], expected: cells[1] ?? '' });
    }

    const title = matches[i][2].trim();
    cases.push({
      tc: matches[i][1],
      title,
      toBe: /\(to-be\)/i.test(title),
      objective: block.match(/\*\*Objective:\*\*[ \t]*(.+)/)?.[1]?.trim() ?? null,
      script: block.match(/\*\*Script:\*\*\s*(\S+)/)?.[1] ?? null,
      steps,
    });
  }
  return { frontMatter, cases };
}

/** Read and parse a scenario file from disk. */
export function readScenario(file: string): Scenario {
  return parseScenario(readFileSync(file, 'utf8'));
}
