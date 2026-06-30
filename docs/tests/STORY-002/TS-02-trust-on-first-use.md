---
id: TS-02
title: Lab-usable via trust-on-first-use
namespace: enterprise-wifi
story: STORY-002
story_hash: 13aa58ae0565169296cd69e377528f698171f4bce41adc938ab5edb6dda5fe32
plan: 109
issue: 69
status: green
---

# TS-02: Lab-usable via trust-on-first-use

**Objective:** A tester can connect to a lab/test 802.1X AP that has no pinned CA
and no/unknown RADIUS domain, via an explicit trust-on-first-use choice, with clear
guard rails when a config can't be validated.

## TC-01 — TOFU connect on a supported device (to-be)

| Action | Expected Result |
|---|---|
| On a current Android device, connect to a lab enterprise SSID with trust-on-first-use chosen, no CA, and no domain | The device associates to the SSID |

## TC-02 — an unvalidatable config gives an actionable error (to-be)

| Action | Expected Result |
|---|---|
| Connect with no CA, no domain, and trust-on-first-use **not** chosen | A clear, actionable error naming the choices (enable trust-on-first-use, or provide a CA / domain) — not a raw framework error and not a false success |

## TC-03 — trust-on-first-use on an unsupported OS (to-be)

| Action | Expected Result |
|---|---|
| Request trust-on-first-use on a device too old to support it | A clear "requires a newer Android" message — not a silent failure or a misleading success |
