# STORY-002: Trustworthy, lab-usable enterprise (802.1X) WiFi

## User Story

As a QA engineer testing devices against **enterprise / 802.1X** WiFi,
I want to put the phone onto an enterprise network and **know it actually connected** — including the lab and test APs we use day to day,
So that I can run enterprise WiFi QA flows whose results I can trust, without hand-checking the phone.

## The Need

Enterprise 802.1X is a primary QA target — corporate networks, RADIUS-backed lab SSIDs, compliance deployments. Today the tool can *build and submit* an enterprise config, but it's only half-usable:

- **It can't be trusted.** `wifi_connect_enterprise` reports success the moment Android *accepts* the configuration — not when the device has actually associated. A "success" can mean the phone never joined the network, so every enterprise result is a half-truth a tester has to verify by hand.
- **It can't reach the networks we actually test on.** It only handles strict WPA2-Enterprise with full server-certificate validation (a pinned CA *and* a known RADIUS domain). The everyday lab case — a test AP with no CA on hand, a RADIUS hostname that rotates, or a WPA3-Enterprise-only SSID — simply fails, often with a cryptic Android error instead of an actionable one.

The result is a feature that looks like it works but can't be relied on for the enterprise scenarios that matter most.

## Success Looks Like

- When `wifi_connect_enterprise` reports **success, the device is genuinely associated** to the SSID — and when it isn't, the result says so plainly, rather than a false success.
- A tester can connect to a **lab / test 802.1X AP** that has no pinned CA or an unknown RADIUS domain — via a documented, deliberate trust-on-first-use choice — and gets a **clear, actionable error** when a config genuinely can't be validated.
- A **pinned-CA-without-a-known-domain** config connects.
- **WPA3-Enterprise** SSIDs connect where the AP supports them.
- The existing local (stdio + companion-app) path keeps working — no regression to today's WPA2-Enterprise flows.

## Open Questions

- Where the association check lives — the trace suggests reusing the host-side poll already proven for PSK `wifi_connect` (#65) rather than blocking inside the companion. To confirm during planning.
- Trust-on-first-use correctness on Android 13+ (the corrected `enableTrustOnFirstUse` approach from #69/#73) and the behaviour/error below API 33.
- How the association verify interacts with the still-open `ASSOCIATING`-past-deadline gap (#91).
- WPA3-Enterprise verification needs a WPA3-Enterprise lab AP; if one isn't available, that slice may ship as code with a deferred/pending acceptance test (#72).
- Companion-app version bump + rebuild/reinstall cadence, and which slices need a new APK vs. host-only changes.

## Status

- Created: 2026-06-30
- Issues: #69, #70, #71, #72 (technical breakdown; #73 closed — folded into #69)
