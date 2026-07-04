---
id: TS-05
title: query_log returns the tool-call audit trail
namespace: logging
story: STORY-004
plan: 120
issue: 128
status: green
---

# TS-05: query_log returns the tool-call audit trail

**Objective:** `query_log` returns the structured record of tool calls the server made —
a real audit trail, not a well-shaped empty response — so a run can be inspected after
the fact.

## TC-01 — query_log returns structured tool-call rows

**Script:** cicd/tests/testcases/logging/TC-LOG-001.yml

| Action | Expected Result |
|---|---|
| After some tool calls, query the log | The result contains structured rows for the calls made (tool name, timing) — the audit trail reflects real activity |
