# STORY-001: Drive the phone remotely through the whole MCP stack

## User Story

As a QA engineer whose workstation is **not** the machine wired to the test phone,
I want to reach the whole MCP stack — `android-wifi`, `android-playwright`, and `mobile-next` — whether my client runs locally (stdio) or on another machine (http),
So that I can run complete phone QA flows (WiFi, in-browser, and on-device UI) without the phone being plugged into my own machine.

## The Need

Phone QA needs three cooperating MCP servers — one for WiFi/network control, one for the device browser, one for the OS UI. Today they assume the client runs on the **same** machine as the phone: only the WiFi server can be reached across the network, while the browser and UI servers come up on the client's own machine. So a QA engineer working from a different machine can control WiFi but **not** the browser or UI — those land where there is no phone.

The team wants one phone, wired to a shared host, drivable by whoever needs it, from wherever they are — without each person re-improvising the connection.

## Success Looks Like

- A QA engineer on the **same host** still drives all three servers — the existing local (stdio) path keeps working.
- A QA engineer on a **different machine** connects to all three servers over the network and completes an **end-to-end flow** against the one USB-connected phone: bring up WiFi, drive a page in the device browser, and tap an on-device dialog — all acting on that same phone.
- Connecting is a **documented, repeatable** setup, not a per-person improvisation.

## Open Questions

- How is the stack exposed **safely** — anyone who can reach it can drive the phone (WiFi, OTPs, screenshots)? (auth / network boundary)
- How is the stack **started** — one command or per-server, and on which addresses/ports?
- Does the remote bridge behave the same across all three servers' transports?
- What happens when **two people** aim at the same phone at once? (shared-device behaviour — relates to #62)
- Technical approach is tracked in **#94**.

## Status

- **Done: 2026-06-26** — acceptance run green (see #95); all of "Success Looks Like" met: local stdio drives all three, a remote machine drives all three + an end-to-end flow on the one phone, from documented repeatable setup.
- Created: 2026-06-25
- Issues: #94 (plan), #95 (test plan), #98 · #99 · #100 (tasks), #102 (mobile-next remote fix — proxied through android-wifi)
- Notes: the device-browser legs require Chrome Canary foregrounded (precondition, see `docs/integrations/canary-cdp.md`); shared-device concurrent-writes (TS-07 TC-02) left defined-by-serialization, not stress-tested (relates to #62).
