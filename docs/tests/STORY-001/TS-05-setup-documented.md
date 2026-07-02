---
id: TS-05
title: Setup is documented and repeatable
namespace: remote-stack
story: STORY-001
story_hash: 4f42d5b1693d86abbca8a49743d1cd89f479d8db07d8ec0a0d379fc211fa144c
plan: 95
issue: 94
status: green
---

# TS-05: Setup is documented and repeatable

**Objective:** A QA engineer new to the project can stand up local and remote
access **from the docs alone** — no per-person improvisation.

## TC-01 — local setup from the docs

| Action | Expected Result |
|---|---|
| Following only the documented steps, a client on the host connects to all three servers (stdio) | All three connect; no undocumented step was needed |

## TC-02 — remote setup from the docs

| Action | Expected Result |
|---|---|
| Following only the documented steps, a client on another machine connects to all three servers (http) and reaches the host phone | All three connect and act on the host phone; no undocumented step was needed |

## TC-03 — docs match reality

| Action | Expected Result |
|---|---|
| Run the documented commands verbatim (substituting only the host address) | They work as written — no silent correction, missing flag, or stale name |
