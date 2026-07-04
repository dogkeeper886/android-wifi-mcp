---
id: TS-04
title: Inspection and management tools return real results
namespace: device
story: STORY-004
plan: 120
issue: 128
status: green
---

# TS-04: Inspection and management tools return real results

**Objective:** The read/inspect/manage tools on the device surface (`device_list`,
`device_settings_*`, `device_push_file`/`device_pull_file`, `device_screenshot`,
`device_event_log`, `device_select`, `wifi_status`, `wifi_scan`) return a **real
result reflecting real device state** — a listed device, a round-tripped setting, a
byte-equal file, a saved PNG — not a well-shaped empty response, and their failure
paths surface clean structured errors.

All cases are bound and run green in the smoke suite against an attached device.

## TC-01 — device_list returns the attached device

**Script:** cicd/tests/testcases/smoke/TC-SMK-001.yml

| Action | Expected Result |
|---|---|
| List attached devices | The result contains the connected Android device (serial present) |

## TC-02 — wifi_status reflects real radio + connection state

**Script:** cicd/tests/testcases/smoke/TC-SMK-003.yml

| Action | Expected Result |
|---|---|
| Read WiFi status while connected | Reports the radio **enabled** and **connected** to the current SSID |

## TC-03 — wifi_scan returns real networks

**Script:** cicd/tests/testcases/smoke/TC-SMK-004.yml

| Action | Expected Result |
|---|---|
| Scan for WiFi networks | The result contains **at least one** network from the surrounding environment |

## TC-04 — device_settings put/get/delete round-trips

**Script:** cicd/tests/testcases/smoke/TC-SMK-009.yml

| Action | Expected Result |
|---|---|
| Put a sentinel key, get it, delete it, get again | Put succeeds and the value reads back; after delete it reads null — a real state change, then cleaned up |

## TC-05 — push/pull preserves file bytes

**Script:** cicd/tests/testcases/smoke/TC-SMK-010.yml

| Action | Expected Result |
|---|---|
| Push a host file to the device, pull it back | The round-tripped file is **byte-equal** to the original |

## TC-06 — device_screenshot writes a real PNG

**Script:** cicd/tests/testcases/smoke/TC-SMK-011.yml

| Action | Expected Result |
|---|---|
| Capture a screenshot to a host path | The file exists, is non-empty, and is a valid PNG |

## TC-07 — push/pull failure paths surface clean errors

**Script:** cicd/tests/testcases/smoke/TC-SMK-012.yml

| Action | Expected Result |
|---|---|
| Push/pull with a bad path | Each call returns `success: false` with `isError: true` — a clean structured error, not a throw or hang |

## TC-08 — device_event_log returns the attach/detach ring

**Script:** cicd/tests/testcases/smoke/TC-SMK-017.yml

| Action | Expected Result |
|---|---|
| Read the device event log | The result is the attach/detach transition ring for the device |

## TC-09 — device_select selects a device by serial

**Script:** cicd/tests/testcases/smoke/TC-SMK-018.yml

| Action | Expected Result |
|---|---|
| Select a device by its serial | The named device becomes the active target for subsequent tool calls |

## TC-10 — device_info reports the device's real Android version (to-be)

| Action | Expected Result |
|---|---|
| Read device info | Reports a real SDK / Android version for the connected device (SDK ≥ 30) — verified against the actual device, not just field presence. The prior shape-only test was removed; a meaningful assertion is still to write. |
