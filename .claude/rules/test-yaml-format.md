---
paths:
  - "cicd/tests/testcases/**/*.yml"
  - "cicd/tests/src/types.ts"
  - "cicd/tests/src/loader.ts"
---

# Test Case YAML Format

## Schema

```yaml
id: TC-[SUITE]-[NUMBER]            # e.g. TC-SMK-001, TC-WIFI-002
name: Human-readable test name
suite: smoke                       # see Suites below (extend SUITES in config.ts)
tags: [smoke, wifi]                # for --tag filtering (optional)
priority: 1                        # lower runs first
timeout: 30000                     # milliseconds
dependencies: [TC-WIFI-002]        # tests that must run first (topo-sorted)
judge: simple                      # optional: 'simple' (default) or 'agent' (see below)
goal: One-line objective for the agent judge (optional)

steps:
  - name: Step description
    command: shell command to execute       # usually mcp-client.ts <tool> '<json>'
    timeout: 5000                  # optional, overrides test timeout
    expectPatterns:                # all must match (regex, case-insensitive)
      - "pattern"
    rejectPatterns:                # none may match (regex)
      - "isError"
    capture:                       # extract values from the tool's JSON output
      varName: "field[key=value].subfield"

criteria: |
  Human-readable pass criteria (also the agent judge's rubric context).
```

## Judge style (STORY-003)

`judge: agent` opts a case into the ACP agent judge in dual mode (`JUDGE_MODE=dual`) —
for tools whose output is **non-deterministic** (connect / scan / status). The
deterministic `SimpleJudge` always runs; `agent` adds a second, semantic verdict and
**both must pass**. Omit it (or `simple`) for stable tools — they stay fast and free.

## Pattern gotcha — the double-encoded payload

`mcp-client.ts` prints the tool result as JSON whose `content[0].text` is itself a JSON
string, so inner keys render **escaped**: `\"connected\": true`. A pattern with a literal
quote next to a key (`"connected"`) therefore **never matches**. Match the bare key or
bridge with `.*` (`connected.*true`) — the established idiom in the smoke suite.

## Variable capture

Resolves from a prior step's captured output first, then `process.env` (so
`{{TEST_SSID_WPA2}}` works from `.env` / CI secrets). Path syntax:

- `field` — direct field
- `data.name` — nested field
- `networks[ssid=Foo].networkId` — array find by field match
- `$[type=user].email` — root array find

**No numeric indexing:** `devices[0].serial` is NOT supported — the path splits on `.`
and there is no `[0]`. Use a `field[key=value]` find (`devices[state=device].serial`).
MCP double-encoded responses (`content[0].text`) are unwrapped automatically.

## Suites

`smoke` (reachability + shape, zero-config), `wifi` / `enterprise` (mutating, need a lab
AP + `.env`), `sms`, `notifications`, `portal`, `proxy`, `ui`, `logging` (needs Postgres).
Add custom suites by extending `SUITES` in `config.ts`.

## ID format

`TC-{SUITE}-{NUMBER}` matching the suite dir: `TC-SMK-*`, `TC-WIFI-*`, `TC-SMS-*`,
`TC-NOTIF-*`, `TC-PROXY-*`, `TC-LOG-*`.
