---
id: TS-04
title: WPA3-Enterprise
namespace: enterprise-wifi
story: STORY-002
plan: 109
issue: 72
status: green
---

# TS-04: WPA3-Enterprise

**Objective:** Connect to a WPA3-Enterprise SSID where the access point supports it.

> TC-01 is bound and runs green against the WPA3-Enterprise lab AP (proven this session,
> #72). TC-02 (192-bit / suite-B) stays (to-be) — the code path exists but no suite-B AP
> is available to assert it on.

## TC-01 — WPA3-Enterprise connect

**Script:** cicd/tests/testcases/enterprise/TC-ENT-002.yml

| Action | Expected Result |
|---|---|
| Connect to a WPA3-Enterprise SSID (`securityType: wpa3-eap`) | The device associates using WPA3-Enterprise, confirmed out of band via `wifi_status` |

## TC-02 — WPA3-Enterprise 192-bit / suite-B (to-be)

| Action | Expected Result |
|---|---|
| Connect to a WPA3-Enterprise 192-bit (suite-B) SSID on a supporting AP | The device associates in 192-bit mode |
