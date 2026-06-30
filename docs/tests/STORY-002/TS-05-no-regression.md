---
id: TS-05
title: No regression to existing enterprise flows
namespace: enterprise-wifi
story: STORY-002
story_hash: 13aa58ae0565169296cd69e377528f698171f4bce41adc938ab5edb6dda5fe32
plan: 109
status: green
---

# TS-05: No regression to existing enterprise flows

**Objective:** Today's WPA2-Enterprise path keeps working unchanged — the new
verification and validation options don't break the flows that already work.

## TC-01 — existing WPA2-Enterprise connect

| Action | Expected Result |
|---|---|
| Connect to a WPA2-Enterprise SSID via PEAP/TTLS/TLS with a CA and a domain (the current flow) | The device associates as it does today — no new requirement or failure introduced |

## TC-02 — companion-app status check

| Action | Expected Result |
|---|---|
| Query the companion-app presence and notification-access status | It reports install + grant state correctly, as before |
