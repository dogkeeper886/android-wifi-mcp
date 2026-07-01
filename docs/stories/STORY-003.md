# STORY-003: Judge WiFi tool tests by intent, with an AI agent

## User Story

As a test author for this WiFi MCP server,
I want the CI runner to decide whether a tool worked by judging its intent — using an
AI agent where the outcome isn't deterministic,
So that live, varying WiFi responses are verified for real instead of matched against
brittle fixed patterns.

## The Need

The whole point of the suite is to prove our MCP tools actually work. But we are a WiFi
server, and WiFi is not static: which access points are in range, whether a connect
succeeds, the signal, the exact SSID and status text all change from run to run. Today
the runner can only pattern-match — does the response contain these keys, these
regexes. That forces every test into a rigid shape and can't tell a genuine success
from a string that happened to appear.

The tools are not uniform either. Some are deterministic — device info, a settings
round-trip — where pattern-matching is exactly right and cheap. Others are stateful and
non-deterministic — connect, scan, status — where "did it work" is a judgment call
against the real device.

So for those, the tester itself may need to be an AI agent: one that reads the tool's
output and the test's stated intent, and where needed actively checks the live device,
rather than us hand-writing expected strings that break on the next run.

## Success Looks Like

- A test can state its intent ("the device is now associated to the target network")
  and the runner reaches a correct pass/fail even when the exact response text differs
  between runs.
- Deterministic tools keep their fast, cheap checks; only the non-deterministic ones
  need agent judgment — no one is forced to use one style for everything.
- When the agent tester can't run in an environment (no credentials, no device), the
  run degrades safely to the deterministic check instead of failing every test.
- A WiFi connect regression that today slips past pattern-matching is caught.

## Open Questions

- Which judgment tiers to adopt from the upstream `agent-workflows-runner` fork we
  already carry — the semantic agent-judge, the live-tool verifier (agent calls our
  read-only tools to confirm ground truth), or both — and how they compose with the
  existing deterministic judge.
- How the agent tester authenticates locally vs. in GitHub Actions, and the behavior on
  a hosted runner with no attached device.
- How each tool is categorized (deterministic vs. needs-agent) and where that lives.
- Relationship to STORY-004, whose test corpus runs under this runner.

## Status

- Created: 2026-07-01
- Plan: #119
- Issues: #122, #123, #124, #125, #126
