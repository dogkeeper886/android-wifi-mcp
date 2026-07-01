---
id: TS-02
title: Radio controls and forget do what they say
namespace: wifi
story: STORY-004
story_hash: 272e833442d0605dbbeca4a67c22e58be0f08f499e49da8edfc31e6b1620fb64
plan: 120
issue: 128
status: green
---

# TS-02: Radio controls and forget do what they say

**Objective:** The mutating radio tools (`wifi_enable`, `wifi_disable`,
`wifi_disconnect`, `wifi_forget`) change device state as claimed, confirmed by reading
status out of band, and each test restores what it changed.

Cases are **(to-be)** until the runnable binding ships (#130).

## TC-01 — enable turns the radio on (to-be)

| Action | Expected Result |
|---|---|
| Enable WiFi, then read status | Status reports WiFi **enabled** |

## TC-02 — disable turns the radio off, then it is restored (to-be)

| Action | Expected Result |
|---|---|
| Disable WiFi, read status, then re-enable | Status reports WiFi **disabled**; after re-enable the radio is on again — the device is left as found |

## TC-03 — disconnect drops the active association (to-be)

| Action | Expected Result |
|---|---|
| While associated, disconnect, then read status | Status reports **not connected** to the previously-active SSID |

## TC-04 — forget removes a saved network (to-be)

| Action | Expected Result |
|---|---|
| Forget a saved network, then list saved networks | The forgotten network is **absent** from the saved list |
