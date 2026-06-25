---
id: TS-03
title: Remote client reaches the browser + UI servers over http
namespace: remote-stack
story: STORY-001
story_hash: 2937da1a558ea87ccb89179849dc3cf225de98f93ebf192f4819db0a3ee1a5a8
plan: 95
issue: 94
status: green
---

# TS-03: Remote client reaches the browser + UI servers over http

**Objective:** With `android-playwright` and `mobile-next` served over the
network **from the USB host**, a remote client drives them and they act on the
one USB phone — not on the client machine. **(to-be — depends on #94 serving
these two over http.)**

## TC-01 — remote → android-playwright → device browser

| Action | Expected Result |
|---|---|
| From another machine, connect to the host-served `android-playwright` and list tools | Browser tools are present |
| Drive a browser action | It runs against the **host phone's** Chrome, not any browser on the client |

## TC-02 — remote → mobile-next → device UI

| Action | Expected Result |
|---|---|
| From another machine, connect to the host-served `mobile-next` and list tools | UI tools are present |
| Drive a UI action | It runs against the **host phone's** UI |

## TC-03 — effect lands on the USB phone (independent check)

| Action | Expected Result |
|---|---|
| After a remote browser/UI action, observe the device independently (e.g. a screenshot or state read via android-wifi) | The observed change matches the action — confirming it landed on the USB phone, not the client |
