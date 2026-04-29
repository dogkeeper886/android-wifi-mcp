# android-wifi-mcp — CLAUDE.md

Project-specific guidance for Claude. Loaded automatically when working in this repo.

## What this is

An MCP server, originally for **Android WiFi control via ADB**, now expanded into a **broader on-device QA test toolkit**. Drives a phone over USB so Claude can run end-to-end mobile flows: connect to networks, capture OTPs, automate UI, optionally control browsers — all from a single MCP endpoint.

The user is a QA engineer. Treat this as a test-tool first: prefer reliability, observability, and deterministic teardown over user-facing polish.

## Architecture

```
Claude Code  ──MCP──►  android-wifi-mcp (this server)  ──ADB──►  phone
                              │
                              └──MCP/stdio──►  upstream MCPs (e.g. @playwright/mcp)
                                                    (transparently proxied — see #14)
```

- **Server entrypoint:** `src/index.ts` picks transport (HTTP default, `--stdio` for stdio).
- **Tool registry:** `src/server.ts` — `createMcpServer(deviceManager)` returns `{ server, nativeToolNames }` and registers 29 native tools.
- **Proxy:** `src/mcp/upstream-proxy.ts` spawns upstream MCP subprocesses on startup and merges their tools into one tools/list. Configured via `UPSTREAM_MCP` env var.
- **ADB layer:** `src/adb/` — `adb-client.ts` (process wrapper), `device-manager.ts` (multi-device), then per-domain wrappers: `wifi-commands.ts`, `screenshot-commands.ts`, `sms-commands.ts`, `enterprise-wifi.ts`, `settings-commands.ts`, `file-commands.ts`.
- **Companion app:** `companion-app/` — Kotlin Android app that handles 802.1X enterprise WiFi (the only flow that needs an on-device daemon today).
- **Network helpers:** `src/network/network-check.ts`.
- **Test framework:** `cicd/tests/` — custom YAML-driven runner. See "Tests" below.

## Transport — stdio is primary

The HTTP transport is **known to crash Claude Code's MCP client** (issue #7, currently low-priority). Stdio is the recommended path for everything: production registration, tests, ad-hoc clients.

- `npm start` → HTTP on `:3000` (kept for manual curl / debugging only)
- `npm run start:stdio` → stdio (registered with Claude Code via `claude mcp add --transport stdio ...`)
- `cicd/tests/src/mcp-client.ts` always uses stdio

## Tests

YAML-driven framework under `cicd/tests/`, ported from `ruckus1-mcp` and adapted for on-device testing.

- **`cicd/tests/src/cli.ts`** — `commander`-based CLI: `run` (with `--suite`, `--tag`, `--id` filters) and `list`.
- **`cicd/tests/src/executor.ts`** — runs each test step as a shell command, captures stdout/stderr, applies `expectPatterns` / `rejectPatterns`. **Per-test** snapshot/restore of WiFi state via `device-state.ts` so a failing test cannot poison the next.
- **`cicd/tests/src/mcp-client.ts`** — spawns `node dist/index.js --stdio`, calls one tool, prints JSON result.

Test cases live in `cicd/tests/testcases/<suite>/TC-<SUITE>-NNN.yml`. Suites: `smoke` (read-only + roundtrips), `sms`, `notifications`, `proxy`, plus pending `wifi`/`enterprise`/`portal`. Each test step runs `npx tsx cicd/tests/src/mcp-client.ts <tool> '<args>'`.

**Pattern-matching gotcha:** `mcp-client.ts` returns double-encoded JSON (the tool's JSON is inside a `text` field with escaped quotes). **Use bare strings** in patterns:
- ✅ `connected.*true`, `hasInternet.*true`
- ❌ `'"connected": true'` — won't match `\"connected\": true`

`isError` is the canonical failure signal (bare).

`{{TEST_RUN_ID}}` is auto-injected (GITHUB_RUN_ID in CI; random 6 chars locally) for fixture namespacing.

To add a test, use the **`ci-testcase`** project skill (`.claude/skills/ci-testcase/SKILL.md`). To run, `cd cicd/tests && npm test [-- --suite <s>]` or use the `ci-run` skill.

**Unit tests** live under `tests/unit/*.test.mjs` (separate from the YAML integration suite). They use Node's built-in `node:test` runner and import from compiled `dist/`. Run with `npm run test:unit` from the repo root after `npm run build`. Currently cover `parseUpstreamConfig`, `applyEnvOverrides`, and `resolveToolName` in `src/mcp/upstream-proxy.ts`.

## Tool surface

29 native tools across 7 categories (`device_*` mgmt, `device_settings_*`, `device_*_file`, `wifi_*`, `wifi_*_enterprise`, `network_*`, `sms_*` / `notifications_*`). Generic UI automation (`device_tap` / `device_swipe` / `device_keyevent` / `device_type_text` / `device_open_url` / `device_launch_app` / `device_list_packages` / `device_ui_dump`) was intentionally removed in #20 — compose with [`mobile-next/mobile-mcp`](https://github.com/mobile-next/mobile-mcp) for selector-based UI work and `playwright-android` for browser DOM. With `UPSTREAM_MCP=playwright=...` set, an additional 21 `browser_*` tools from `@playwright/mcp` are proxied through — **50 total**.

The unified namespace is the design goal: Claude Code sees one server, gets one tools/list. Don't add a feature here that exists in a mature upstream — proxy it instead. (#10 was closed and #14 implemented for exactly this reason.)

## Phone CDP / browser automation

`@playwright/mcp` controls **host Chromium** by default. To drive **the phone's** browser via DOM-level CDP, use **Chrome Canary on the device** — Samsung's stable Chrome is locked down and doesn't serve `/json/version`, but Canary works out of the box. See the `phone_cdp_works_on_canary` memory for the recipe.

## Workflows

- **Add a tool:** new method on the right `*-commands.ts` class, register in `src/server.ts` (the wrapper around `mcpServer.tool` collects names for the proxy), update README's Available Tools table, add a YAML test under `cicd/tests/testcases/<suite>/`. Use the `ci-testcase` skill to bootstrap the YAML.
- **Add a test:** see `ci-testcase` skill.
- **Run tests locally:** `cd cicd/tests && npm test` (smoke + everything tagged); add `--suite <s>` to scope.
- **Issue → PR:** `dw-implement` → `dw-create-pr` → `dw-review-pr` → `dw-merge` (home-level skills, see `~/.claude/CLAUDE.md`).
- **Always branch + PR.** Even for docs / README / CLAUDE.md / config-only changes. The home-level "direct-push for docs" exception does **not** apply in this repo — a wrong-issue-number bug shipped through a docs-only direct-push (commit `1829746`) and the PR self-review would have caught it. Branch as `fix/<slug>` or `feature/<slug>` for non-issue-tracked work.
- **Verify factual claims before push** regardless of branch — counts, file paths, anchor links, command names, issue numbers. Run `npm run tools:count` for tool count claims. Post-push / post-merge review is a backstop, not the gate.

## Conventions

- Branch names: `issue-<N>-<slug>` for issue-linked work; `feature/<short-slug>` for tasks not tracked as issues.
- Tool descriptions: short imperative, one line. The MCP client surfaces this verbatim.
- `ensureDevice()` is called at the top of every tool that touches the device — auto-selects the only connected device or errors clearly when ambiguous.
- Don't add features speculatively. The `auto-restart` caveat for #14 and the `portal_*` wrappers in #4 were both speculative; both were dropped or deferred when the user asked "is this an assumption?" — yes, they were.
- **Spec sanity gate (before filing a feature issue):** (1) list the existing-tool composition that would already cover the use case; (2) name a real test scenario that needs the new work today, not someday; (3) if either is missing, defer or close. The "is this an assumption?" question is a stop-and-check signal, not something to argue past.
- **Tool count discipline.** Whenever you add or remove a tool from `src/server.ts`, run `npm run tools:count` and update README's "**N native tools**" line in the same commit. Drift compounds quickly.

## Pointers

- `~/.claude/CLAUDE.md` — universal workflow rules (PR conventions, dev workflow skills)
- `.claude/skills/ci-testcase/SKILL.md` — generate a YAML test case
- `.claude/skills/ci-run/SKILL.md` — execute the suite
- `README.md` — user-facing setup, tool tables, project structure
- `cicd/tests/testcases/proxy/TC-PROXY-002.yml` — canonical example of testing a proxied tool end-to-end
