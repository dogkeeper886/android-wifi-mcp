---
paths:
  - ".github/workflows/**/*.yml"
---

# CI Workflow Patterns

## Suite-Based Reusable Runner

CI is split into a single reusable runner + one thin caller per suite:

```
.github/workflows/
├── build.yml                # standalone build
├── test-run.yml             # reusable runner (workflow_call): npx tsx src/cli.ts run --tag <tag>
├── test-<suite>.yml         # one per suite (~15 lines) — calls test-run with tag: <suite>
└── ci.yml                   # pipeline: build → suites
```

**Adding a suite workflow:**
1. Tag the cases: `tags: [my-suite]` (and put them in `cicd/tests/testcases/my-suite/`).
2. Copy `test-smoke.yml` → `test-my-suite.yml`; set `tag: my-suite`.
3. Wire it as a job in `ci.yml` if it should run in the default pipeline.

## Key Design Decisions

**Dual triggers:** every workflow supports `workflow_dispatch` (manual, with dropdowns)
and `workflow_call` (callable from the pipeline). A `workflow_call` input default does
NOT apply to a bare `workflow_dispatch`, so forward with a fallback:
`judge_mode: ${{ inputs.judge_mode || 'simple' }}`.

**Judge mode:** the runner is deterministic unless `JUDGE_MODE=dual`; each workflow
exposes a `simple`/`dual` choice and passes it through (`ci.yml` → `test-<suite>.yml` →
`test-run.yml`). In `dual`, only cases marked `judge: agent` pay for the agent judge.

**Lab gating:** suites that need real hardware (e.g. `wifi`) must not run on a runner
that lacks it. Gate the job on a repo variable — `if: ${{ vars.WIFI_LAB == 'true' }}` —
so it **skips cleanly** (green, not failed) until the lab is armed. See `test-wifi.yml`.

## Environment (repository Variables / Secrets → Actions)

| Name | Purpose | Example |
|------|---------|---------|
| `JUDGE_MODE` | `simple` (default) or `dual` (opt in the agent judge) | `dual` |
| `JUDGE_AGENT` | Command for the ACP agent; unset = bundled Claude ACP agent (keyless) | (unset) |
| `CLAUDE_CODE_OAUTH_TOKEN` | Secret authenticating the bundled agent on a hosted runner; unneeded on a self-hosted runner logged into Claude Code | `sk-ant-oat...` |
| `TEST_DEVICE_SERIAL`, `TEST_SSID_*`, `TEST_EAP_*` | Device + WiFi test data (see `.env.example`) | — |

An unauthenticated agent **degrades cleanly to the simple judge** — `dual` never mass-fails
for missing auth.
