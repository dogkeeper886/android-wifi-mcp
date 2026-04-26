---
name: ci-testcase
description: |
  Generate YAML test cases from an issue or feature request that test android-wifi-mcp tools against an attached Android device.
  Use when the user wants to create tests, generate test cases, or add test coverage for a feature.
disable-model-invocation: true
---

# Create Test Case for android-wifi-mcp

Generate a YAML test case file that exercises one or more MCP tools against the attached Android device.

{{input}}

## PURPOSE

Read an issue (or a description of what to test) and emit YAML test case(s) under `cicd/tests/testcases/<suite>/` that verify behavior end-to-end via the MCP server's stdio entry point.

---

## AGENT WORKFLOW

### Step 1: Identify the suite

Pick the right suite for the test:

| Suite | When |
|---|---|
| `smoke` | Read-only, fast, no device side-effects (status, scan, info, list, ping). Always-safe to run. |
| `wifi` | Connect/disconnect/forget against a known test SSID. Stateful — relies on per-test snapshot/restore. |
| `enterprise` | 802.1X / EAP flows. Needs RADIUS test fixtures + the companion app installed. |
| `ui` | UI-automation primitives (tap/type/screenshot). Lands with #1. |
| `portal` | Captive portal interaction. Lands with #4. |

### Step 2: Identify what to test

From the issue acceptance criteria, determine:
- Which MCP tool(s) to call
- What output fields prove success (use bare strings — see gotcha below)
- What output indicates failure (typically `isError`)
- Any env-var fixtures the test needs (SSID, password, etc.)

### Step 3: Generate the YAML

Create the file as `cicd/tests/testcases/<suite>/TC-<SUITE>-<NNN>.yml`:

```yaml
id: TC-WIFI-001
name: <descriptive name>
suite: wifi
tags: [wifi]
priority: 1
timeout: 30000
dependencies: []

steps:
  - name: <step description>
    command: npx tsx cicd/tests/src/mcp-client.ts <tool_name> '{"arg":"value"}'
    expectPatterns:
      - "<bare string or regex — see gotcha>"
    rejectPatterns:
      - "isError"

criteria: |
  <Plain-language description of what this test verifies.>
```

**ID conventions:**
- `TC-SMK-NNN` (smoke) · `TC-WIFI-NNN` (wifi) · `TC-ENT-NNN` (enterprise) · `TC-UI-NNN` (ui) · `TC-PRT-NNN` (portal)

**Priority:** lower = runs first within the suite. Use it to enforce a sane order when tests within a suite have an implicit ordering (e.g. enable WiFi before scanning).

### Step 4: Pattern-matching gotcha

`mcp-client.ts` returns double-encoded JSON — the tool's JSON is inside a `text` field whose value has escaped quotes. **Use bare strings**, not quoted forms:

- ✅ `connected.*true`
- ✅ `hasInternet.*true`
- ❌ `'"connected": true'` — won't match the escaped output `\"connected\": true`

For the same reason, the canonical failure signal is the bare string `isError` (not `'"isError"'`).

### Step 5: Env-var fixtures

If the test needs credentials or SSIDs, reference them with `${TEST_...}`:

```yaml
command: npx tsx cicd/tests/src/mcp-client.ts wifi_connect '{"ssid":"${TEST_SSID_WPA2}","security":"wpa2","password":"${TEST_SSID_WPA2_PASSWORD}"}'
```

The executor expands `${VAR}` from the environment before running the command. Document any new env vars in `.env.example`.

### Step 6: Per-test state restore

The executor automatically snapshots the device's WiFi state before each test and forgets any networks added during the test. You don't need to write cleanup steps for added networks — but if your test changes other state (e.g., installs a certificate), add a teardown step.

### Step 7: Report

Show the user:
- The created file paths
- What each test verifies
- Suggest: `cd cicd/tests && npm test -- --suite <suite>` to run them

---

## OUTPUT

Paths to created test case files.
