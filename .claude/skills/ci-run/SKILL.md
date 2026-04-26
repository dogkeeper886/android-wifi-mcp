---
name: ci-run
description: |
  Execute android-wifi-mcp test cases against the attached Android device.
  Use when the user wants to run tests, execute test cases, or verify MCP tool behavior end-to-end.
disable-model-invocation: true
---

# Run android-wifi-mcp Test Cases

Execute YAML test cases against the attached Android device using the MCP stdio transport.

{{input}}

## PURPOSE

Run YAML test cases by spawning the MCP server over stdio, calling tools, and evaluating results.

---

## AGENT WORKFLOW

### Step 1: Identify the scope

Input can be:
- A test ID (e.g., `TC-SMK-003`) — run that specific test
- A suite name (e.g., `smoke`, `wifi`) — run the whole suite
- A tag (e.g., `device`, `network`) — run all tests tagged with it
- Empty — run everything

### Step 2: Pre-flight checks

Before running:
- `adb devices` lists at least one `device`-state entry
- `dist/index.js` exists at the repo root (run `npm run build` if not)
- `cicd/tests/node_modules` exists (run `cd cicd/tests && npm install` if not)

If any of those is missing, fix it and report what you did.

### Step 3: Execute

From the repo root:

```bash
cd cicd/tests && npx tsx src/cli.ts run --suite <suite>
# or
cd cicd/tests && npx tsx src/cli.ts run --id <TC-XXX-NNN>
# or
cd cicd/tests && npx tsx src/cli.ts run --tag <tag>
```

The runner streams progress to stderr and writes JSON results to `cicd/results/<timestamp>_<suite>/`.

Per-test, the executor snapshots WiFi state before and restores after — even on failure — so a flaky test doesn't poison subsequent ones.

### Step 4: Interpret results

A non-zero exit code from the runner means at least one test failed. The console reporter prints a summary table; per-test JSON reports are in the results directory for deeper inspection.

For a failing test:
- Open `cicd/results/<timestamp>/<test-id>.json` for the full step-by-step trace
- Common causes:
  - Tool error → check the `stdout` field for the actual MCP response
  - Pattern miss → confirm you used **bare strings** (see ci-testcase skill for the gotcha)
  - Device state drift → confirm restore actually ran (look for `Restored device state` in the log)

### Step 5: Report

Output:
- Pass/fail count
- For failures: test ID, the failing step, and the first diagnostic line
- Path to the results directory

---

## OUTPUT

Test results summary plus the path to the JSON results for the run.
