# STORY-004: A test for every WiFi MCP tool, driven by real config

## User Story

As a maintainer of this WiFi MCP server,
I want a meaningful test for every tool we expose, with the SSIDs and credentials the
WiFi tools need supplied from config and runnable both locally and in CI,
So that we know our whole tool surface works before shipping, instead of testing only
the read-only corners.

## The Need

We are a WiFi MCP tool, yet our tests cover only a read-only slice — and several of
those only assert that a response has certain keys, which proves almost nothing. The
tools that matter most — connect, enterprise connect, forget, install certificate —
have no test at all, which is exactly why connect regressions reach users.

Real WiFi tests need real inputs: a target network, a password, enterprise
credentials. Those are environment-specific and secret, so they belong in a config
source, not hard-coded — and the same tests should then run locally first and, wired
with secrets, in GitHub Actions.

The existing test scripts are not sacred. Dead-weight can be trimmed or deleted, and
because the runner itself is changing (STORY-003) we don't need to migrate the old
cases — we can build the corpus fresh, working outward from the actual tool list.

## Success Looks Like

- Every MCP tool we expose has at least one test that exercises it for real, not just
  its response shape.
- WiFi tools that need a network or credential draw them from a single config source;
  nothing secret is hard-coded; running locally is the first-class path and CI reuses
  the same tests through secrets.
- The low-value shape-only tests are gone and the corpus is lean — every case earns its
  place.
- Coverage is traceable back to the tool surface — anyone can see which tool each test
  covers and confirm no tool is left untested.

## Open Questions

- The intended build order is tools → test docs under `docs/tests/` → runnable scripts;
  confirm that sequence and what each layer owns.
- Which existing cases to delete vs. keep — the pure key-existence smoke/sms/
  notifications tests are the first trim candidates.
- Where enterprise (802.1X) end-to-end lives: STORY-002 already sketches it as
  `(to-be)` test docs, so the two stories must be reconciled to avoid duplication.
- What keys the config/`.env` needs and how they map to GitHub Actions secrets.
- What "meaningful" coverage means for tools needing physical conditions CI can't
  reliably create (a captive portal, an inbound OTP SMS).

## Status

- Created: 2026-07-01
- Plan: #120
- Issues: #127 (coverage matrix — recorded as a comment on the issue), #128, #129, #130, #131, #132, #133
- Shipped (PR #135): scenario docs #128, wifi suite #130, gap tools #131, trim #129
- Open: #132 (enterprise ownership vs STORY-002), #133 (CI wiring — held for STORY-003)
- Test docs: `docs/tests/STORY-004/` (TS-01 connect e2e, TS-02 radio+forget, TS-03 network diagnostics)
- Runnable cases: `cicd/tests/testcases/` — `wifi/` (TC-WIFI-001..005), `smoke/` (TC-SMK-015..018), `logging/` (TC-LOG-001)
