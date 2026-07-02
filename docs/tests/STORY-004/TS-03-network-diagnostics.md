---
id: TS-03
title: Network diagnostics reach a real host
namespace: network
story: STORY-004
story_hash: ecc52dc3d9f6ce59597ff8fd9e041a04bd35c5ad3423062c086b064a6f521fa0
plan: 120
issue: 128
status: green
---

# TS-03: Network diagnostics reach a real host

**Objective:** The diagnostic tools (`network_dns_lookup`, `network_ping`) return a
real result for a real target — a resolved address, a reachable host — not just a
well-shaped empty response.

TC-01 and TC-03 ship as `TC-SMK-015`/`TC-SMK-016` in the smoke suite and run wherever
the device has internet (targets are hardcoded public hosts — `example.com`, `8.8.8.8`).
TC-02 is **(to-be)** — no binding yet.

## TC-01 — dns lookup resolves a hostname

| Action | Expected Result |
|---|---|
| Resolve a known-resolvable hostname | The result contains at least one IP address for that hostname |

## TC-02 — dns lookup reports an unresolvable name plainly (to-be)

| Action | Expected Result |
|---|---|
| Resolve a name that does not exist | The result reports resolution failure clearly — not a crash, not a false address |

## TC-03 — ping reaches a live host

| Action | Expected Result |
|---|---|
| Ping a known-reachable host | The result reports the host reachable, with a latency figure |
