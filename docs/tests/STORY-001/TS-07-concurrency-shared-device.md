---
id: TS-07
title: Two clients, one phone (shared-device behaviour)
namespace: remote-stack
story: STORY-001
story_hash: 4f42d5b1693d86abbca8a49743d1cd89f479d8db07d8ec0a0d379fc211fa144c
plan: 95
issue: 94
status: green
---

# TS-07: Two clients, one phone (shared-device behaviour)

**Objective:** When two clients target the same phone at once, behaviour is
**defined** — not silent corruption. Covers the story's concurrency open
question (relates to #62); can be deferred if scope stays single-user.

## TC-01 — two clients connect at once

| Action | Expected Result |
|---|---|
| Two remote clients connect to the stack simultaneously and each lists tools | Both connect and list tools; neither evicts the other unexpectedly |

## TC-02 — concurrent device-affecting calls

| Action | Expected Result |
|---|---|
| The two clients issue device-affecting calls at the same time (e.g. both select/drive the device) | The outcome is **defined** — serialized, last-wins, or a clear error — and the device state is never left corrupt or ambiguous |
