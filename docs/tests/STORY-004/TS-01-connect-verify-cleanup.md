---
id: TS-01
title: Connect means associated, and the device is left as found
namespace: wifi
story: STORY-004
story_hash: 272e833442d0605dbbeca4a67c22e58be0f08f499e49da8edfc31e6b1620fb64
plan: 120
issue: 128
status: green
---

# TS-01: Connect means associated, and the device is left as found

**Objective:** A reported success from `wifi_connect` means the device is **actually
associated** to the target SSID — confirmed independently, not assumed from "config
accepted" — and the test leaves the device in its original state.

Cases are **(to-be)** until the runnable binding ships (#130) and a target network is
configured (`TEST_SSID_*`).

## TC-01 — success means associated (to-be)

| Action | Expected Result |
|---|---|
| Connect to a known-good WPA2 SSID with the correct password | The result reports the device **associated** to that SSID, not merely "configuration accepted" |

## TC-02 — a failed connect is not a false success (to-be)

| Action | Expected Result |
|---|---|
| Connect with a wrong password (or an out-of-range SSID) | Within a bounded window the result is **not** a success — it reports not-associated with a clear reason |

## TC-03 — independent confirmation (to-be)

| Action | Expected Result |
|---|---|
| After a reported success, read WiFi status out of band | The current SSID matches the network just connected — the result reflected reality |

## TC-04 — the device is left as found (to-be)

| Action | Expected Result |
|---|---|
| After the test completes (pass or fail) | The network added during the test is forgotten and the prior WiFi enabled-state is restored — no residue for the next test |
