---
id: TS-01
title: Local client drives the full stack via stdio
namespace: remote-stack
story: STORY-001
story_hash: 2937da1a558ea87ccb89179849dc3cf225de98f93ebf192f4819db0a3ee1a5a8
plan: 95
issue: 94
status: green
---

# TS-01: Local client drives the full stack via stdio

**Objective:** On the host wired to the phone, a stdio client reaches all three
servers and each acts on the device — the existing local path keeps working.
This is the baseline that must not regress when the http path is added.

## TC-01 — android-wifi over the stdio shim

| Action | Expected Result |
|---|---|
| From a client on the host, register `android-wifi` via the bundled stdio shim and list tools | The client connects; the device/WiFi/network tools are present |
| Call a read-only device tool (e.g. list devices) | Returns the real USB-connected phone, no error |

## TC-02 — android-playwright (local subprocess)

| Action | Expected Result |
|---|---|
| With the CDP bridge up, register `android-playwright` locally and list tools | Browser tools are present |
| Drive one browser action against the device's Chrome | The action takes effect on the device browser |

## TC-03 — mobile-next (local subprocess)

| Action | Expected Result |
|---|---|
| Register `mobile-next` locally and list tools | UI tools are present |
| Drive one on-device UI action | The action takes effect on the device UI |
