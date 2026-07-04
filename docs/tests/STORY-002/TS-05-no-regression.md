---
id: TS-05
title: No regression to existing enterprise flows
namespace: enterprise-wifi
story: STORY-002
plan: 109
status: green
---

# TS-05: No regression to existing enterprise flows

**Objective:** Today's WPA2-Enterprise path keeps working unchanged — the new
verification and validation options don't break the flows that already work.

## TC-01 — existing WPA2-Enterprise connect

**Script:** cicd/tests/testcases/enterprise/TC-ENT-001.yml

| Action | Expected Result |
|---|---|
| Connect to a WPA2-Enterprise SSID via EAP-TLS with a CA and a domain (the current flow), then disconnect | The device associates as it does today — no new requirement or failure introduced — and disconnect tears it down cleanly |

## TC-02 — companion-app status check

**Script:** cicd/tests/testcases/notifications/TC-NOTIF-005.yml

| Action | Expected Result |
|---|---|
| Query the companion-app presence via `wifi_check_companion_app` | It reports install + grant state correctly, as before |
