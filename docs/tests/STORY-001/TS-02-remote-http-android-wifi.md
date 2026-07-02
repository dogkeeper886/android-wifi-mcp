---
id: TS-02
title: Remote client reaches android-wifi over http
namespace: remote-stack
story: STORY-001
story_hash: 4f42d5b1693d86abbca8a49743d1cd89f479d8db07d8ec0a0d379fc211fa144c
plan: 95
issue: 94
status: green
binding: manual
---

# TS-02: Remote client reaches android-wifi over http

**Objective:** From a different machine, a client connects to `android-wifi`
over the network and drives device/WiFi tools against the USB phone.

## TC-01 — connect via the codeless http bridge

| Action | Expected Result |
|---|---|
| From another machine on the same network, point a stdio client at the host's `android-wifi` URL through the `mcp-remote` bridge (plain-http allowed) | The bridge connects and the client lists the native tools |
| (negative) Omit the plain-http allowance | Connection is refused with a clear, actionable message — covered in TS-06 |

## TC-02 — a device call returns the real phone's state

| Action | Expected Result |
|---|---|
| Call a read-only device tool (list devices / WiFi status) from the remote client | Returns the state of the **host's** USB phone — the same device the host would see |

## TC-03 — native-HTTP client, no bridge

| Action | Expected Result |
|---|---|
| From a client that speaks the http transport natively, register the `android-wifi` URL directly | Connects and lists tools equivalently, without the bridge |
