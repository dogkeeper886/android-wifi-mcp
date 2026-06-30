---
id: TS-01
title: Association is verified, not assumed
namespace: enterprise-wifi
story: STORY-002
story_hash: 875f03224823a642778e30a216471799c99e90c36a6ee7e8d231c0808d6e18b7
plan: 109
issue: 70
status: green
---

# TS-01: Association is verified, not assumed

**Objective:** A reported success from an enterprise connect means the device is
**actually associated** to the SSID; a non-association is reported plainly, never
as a false success.

## TC-01 — success means associated (to-be)

| Action | Expected Result |
|---|---|
| Connect to a known-good enterprise SSID with valid credentials | The result reports the device **associated** to the SSID — not merely "configuration accepted" |

## TC-02 — a failed association is not a false success (to-be)

| Action | Expected Result |
|---|---|
| Connect with credentials/conditions that won't associate (wrong password, or the SSID out of range) | Within a bounded verify window the result is **not** a success — it reports not-associated with a clear reason, rather than claiming success |

## TC-03 — independent confirmation (to-be)

| Action | Expected Result |
|---|---|
| After a reported success, read the device's current WiFi status out of band | The current SSID matches the network just connected — confirming the result reflected reality |
