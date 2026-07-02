---
id: TS-05
title: No regression to existing enterprise flows
namespace: enterprise-wifi
story: STORY-002
story_hash: 875f03224823a642778e30a216471799c99e90c36a6ee7e8d231c0808d6e18b7
plan: 109
status: green
---

# TS-05: No regression to existing enterprise flows

**Objective:** Today's WPA2-Enterprise path keeps working unchanged — the new
verification and validation options don't break the flows that already work.

## TC-01 — existing WPA2-Enterprise connect (to-be)

| Action | Expected Result |
|---|---|
| Connect to a WPA2-Enterprise SSID via PEAP/TTLS/TLS with a CA and a domain (the current flow) | The device associates as it does today — no new requirement or failure introduced |

## TC-02 — companion-app status check (to-be)

| Action | Expected Result |
|---|---|
| Query the companion-app presence and notification-access status | It reports install + grant state correctly, as before |
