---
id: TS-04
title: WPA3-Enterprise
namespace: enterprise-wifi
story: STORY-002
story_hash: 875f03224823a642778e30a216471799c99e90c36a6ee7e8d231c0808d6e18b7
plan: 109
issue: 72
status: green
---

# TS-04: WPA3-Enterprise

**Objective:** Connect to a WPA3-Enterprise SSID where the access point supports it.

> **Pending a WPA3-Enterprise lab AP** — these cases run once such an AP is available;
> until then they stay (to-be) rather than being asserted on WPA2 hardware.

## TC-01 — WPA3-Enterprise connect (to-be)

| Action | Expected Result |
|---|---|
| Connect to a WPA3-Enterprise SSID | The device associates using WPA3-Enterprise |

## TC-02 — WPA3-Enterprise 192-bit / suite-B (to-be)

| Action | Expected Result |
|---|---|
| Connect to a WPA3-Enterprise 192-bit (suite-B) SSID on a supporting AP | The device associates in 192-bit mode |
