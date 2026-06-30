---
id: TS-04
title: WPA3-Enterprise
namespace: enterprise-wifi
story: STORY-002
story_hash: 13aa58ae0565169296cd69e377528f698171f4bce41adc938ab5edb6dda5fe32
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
