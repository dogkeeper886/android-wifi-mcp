---
id: TS-03
title: Network diagnostics reach a real host
namespace: network
story: STORY-004
plan: 120
issue: 128
status: green
---

# TS-03: Network diagnostics reach a real host

**Objective:** The network tools (`network_dns_lookup`, `network_ping`,
`network_check_internet`, `network_interface_info`, `network_check_captive`) return a
real result for real conditions — a resolved address, a reachable host, a live IP, a
truthful internet/captive verdict — not just a well-shaped empty response.

TC-01/03/04/05/06 are bound and run wherever the device has connectivity. TC-02 is
**(to-be)** — no binding yet.

## TC-01 — dns lookup resolves a hostname

**Script:** cicd/tests/testcases/smoke/TC-SMK-015.yml

| Action | Expected Result |
|---|---|
| Resolve a known-resolvable hostname | The result contains at least one IP address for that hostname |

## TC-02 — dns lookup reports an unresolvable name plainly (to-be)

| Action | Expected Result |
|---|---|
| Resolve a name that does not exist | The result reports resolution failure clearly — not a crash, not a false address |

## TC-03 — ping reaches a live host

**Script:** cicd/tests/testcases/smoke/TC-SMK-016.yml

| Action | Expected Result |
|---|---|
| Ping a known-reachable host | The result reports the host reachable (`alive` true) |

## TC-04 — internet check reports a truthful verdict

**Script:** cicd/tests/testcases/smoke/TC-SMK-006.yml

| Action | Expected Result |
|---|---|
| Check internet connectivity while online | `network_check_internet` reports `hasInternet: true` |

## TC-05 — interface info returns a live IP

**Script:** cicd/tests/testcases/smoke/TC-SMK-007.yml

| Action | Expected Result |
|---|---|
| Read the WiFi interface info while connected | `network_interface_info` returns a real (non-empty) IP address |

## TC-06 — captive check returns an Android-sourced verdict

**Script:** cicd/tests/testcases/smoke/TC-SMK-014.yml

| Action | Expected Result |
|---|---|
| Check captive-portal status | `network_check_captive` returns a tri-state verdict (`open`/`captive`/`unknown`) from Android's own connectivity check |
