---
id: TS-04
title: End-to-end remote QA flow on one phone
namespace: remote-stack
story: STORY-001
story_hash: 2937da1a558ea87ccb89179849dc3cf225de98f93ebf192f4819db0a3ee1a5a8
plan: 95
issue: 94
status: green
---

# TS-04: End-to-end remote QA flow on one phone

**Objective:** A single remote client chains all three servers in one flow,
against the same USB phone — the story's headline outcome. **(to-be — depends
on #94.)**

## TC-01 — full flow, one operator, one phone

| Action | Expected Result |
|---|---|
| From another machine, bring the phone onto a network via `android-wifi` (`wifi_connect`) | The phone associates to the target network |
| Drive a page in the device browser via `android-playwright` | The page responds in the device's Chrome |
| Tap an on-device dialog via `mobile-next` | The dialog responds on the device UI |
| Confirm the whole flow acted on **the same single phone** | Each step's effect is visible on that one device; no step silently hit the client machine |
