# STORY-005: Self-contained tests with real setup, preconditions, and teardown

## User Story

As a maintainer running the WiFi MCP test suite,
I want every test to prepare its own known-clean state, confirm the conditions it
needs are actually present, and fully clean up after itself,
So that tests are reliable and independent — no test inherits another test's or the
device's leftover state, and a run means the same thing every time.

## The Need

Our tests are not self-contained. The framework only takes a passive snapshot before a
test and, afterward, forgets saved networks whose id is new. There is no step that
clears the device to a known-clean config, nothing that checks the network a test needs
is even in range, and cleanup misses anything that isn't a brand-new saved-network id
(a re-used profile, the live connection, a network suggestion).

The result is that tests inherit baseline pollution and each other's residue. The
sharpest example: `wifi_connect_enterprise` connects via a network *suggestion*, which
Android ranks below saved networks — so if a competing network was left saved on the
device, the enterprise connection associates and then immediately roams away, and the
test fails for a reason that has nothing to do with the tool. A run's outcome depends on
what happened to be on the phone beforehand, which is the opposite of a trustworthy CI.

## Success Looks Like

- Each test starts from a known-clean device state regardless of what ran before or what
  the phone already had saved — it does not depend on, and is not derailed by, baseline
  config.
- A test that needs a particular network (or other physical condition) confirms that
  condition is present before asserting, and fails fast or skips cleanly with a clear
  reason when it isn't — instead of failing deep inside a step with a confusing error.
- After a test, the device is back to the state it was in before — everything the test
  created (saved profiles, the live connection, suggestions) is removed.
- The enterprise connect test passes reliably on the same device as the rest of the wifi
  suite, with no manual device babysitting between runs.
- Running the suite twice back-to-back gives the same result; order does not matter for
  independent tests.

## Open Questions

- Where setup/teardown/precondition belong: new phases on the test-case schema
  (`setup:` / `teardown:` / `requires:`) that the executor runs around the steps, versus
  convention inside `steps[]`. What does each layer own?
- What "clear config" may safely do: on a dedicated CI phone it can wipe saved networks;
  on a shared phone it must not touch personal networks. How is that boundary declared
  and enforced?
- Reversibility limits: `cmd wifi` has `forget-network` but no `disable-network`, so a
  test can't neutralize a competing saved network non-destructively. Does teardown need
  to re-establish anything, and how, given we can't recreate a network without its
  credentials?
- Precondition mechanics: how a test declares "SSID X must be in range," how the runner
  checks it (scan + settle), and whether a missing precondition is a skip (green) or a
  failure.
- Whether the fix is purely in the test framework, or also needs a tool/companion change
  so enterprise connect can hold (see #164).

## Status

- Created: 2026-07-03
- Issues: none (motivating bug: #164)
