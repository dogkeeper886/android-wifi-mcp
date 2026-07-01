---
id: TS-06
title: Failure modes and exposure are clear
namespace: remote-stack
story: STORY-001
story_hash: 4f42d5b1693d86abbca8a49743d1cd89f479d8db07d8ec0a0d379fc211fa144c
plan: 95
issue: 94
status: green
---

# TS-06: Failure modes and exposure are clear

**Objective:** Reaching the stack fails **predictably** (a clear error, not a
hang), and the security exposure of the remote path is understood.

## TC-01 — unreachable host / closed port

| Action | Expected Result |
|---|---|
| Point a remote client at a wrong address, or at the host with the port closed in the firewall | A clear connection error within a short bound — not an indefinite hang |

## TC-02 — plain-http without the allowance

| Action | Expected Result |
|---|---|
| Point the http bridge at a non-`localhost` plain-http URL without the plain-http allowance | A clear, actionable refusal naming the missing allowance |

## TC-03 — exposure check

| Action | Expected Result |
|---|---|
| From any machine that can reach the host's served ports, connect and call a device tool | It succeeds — reachability alone grants full control of the phone (WiFi, OTPs, screenshots). Per the recorded decision (README "Security & exposure"), the stack is unauthenticated by design; the control is the **network boundary** (trusted LAN / VPN / firewall), so this case verifies the boundary is in place, not a per-request auth. |
