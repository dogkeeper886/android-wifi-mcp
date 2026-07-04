---
id: TS-08
title: The proxy composes upstream MCP servers into one namespace
namespace: remote-stack
story: STORY-001
plan: 95
issue: 94
status: green
---

# TS-08: The proxy composes upstream MCP servers into one namespace

**Objective:** The unified proxy exposes the *other* MCP servers' tools through one
namespace — so a remote client reaching `android-wifi` also reaches `android-playwright`
and `mobile-next` — and can respawn a crashed upstream without losing the composition.
This is the mechanism behind STORY-001's "reach the whole MCP stack."

## TC-01 — an upstream tool is reachable through the unified namespace

**Script:** cicd/tests/testcases/proxy/TC-PROXY-001.yml

| Action | Expected Result |
|---|---|
| Call a mock upstream's tool through the proxy | The proxy routes the call and returns the upstream's result — the tool appears in the unified namespace |

## TC-02 — a real @playwright/mcp tool works through the proxy

**Script:** cicd/tests/testcases/proxy/TC-PROXY-002.yml

| Action | Expected Result |
|---|---|
| Invoke `browser_navigate` (from @playwright/mcp) via the proxy against a host browser | The browser navigates — the browser server is driven through the same namespace as `android-wifi` |

## TC-03 — proxy_restart respawns an upstream and re-registers its tools

**Script:** cicd/tests/testcases/proxy/TC-PROXY-003.yml

| Action | Expected Result |
|---|---|
| Call an upstream tool, `proxy_restart` it, then call it again | The tool works before and after — restart tears down and respawns the upstream and re-registers its tools cleanly |
