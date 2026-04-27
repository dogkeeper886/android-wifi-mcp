# Evolve Report — 2026-04-27

## Summary
- **Time range analyzed:** last 90 days (effective activity: 2026-04-26 → 2026-04-27, ~36-hour window)
- **Issues analyzed:** 10 (9 closed, 1 open)
- **Commits analyzed:** ~25 (all merges + per-PR commits)
- **Insights found:** 7 (High: 3, Medium: 2, Low: 2)
- **Prior report:** first run

## High-Confidence Insights

### H1 — Repeated 6-file scaffolding for new tool categories (Workflow Gap)
- **Evidence:** PR #8 (stdio transport), #11 (UI), #12 (SMS), #15 (proxy), #18 (notifications)
- **Pattern:** every feature added the same shape — new `src/adb/<name>-commands.ts`, registration in `src/server.ts`, YAML tests under `cicd/tests/testcases/<suite>/`, `.github/workflows/test-<suite>.yml`, `SUITES` entry in `cicd/tests/src/config.ts`, README table row, sometimes `.env.example` placeholder
- **Confidence:** High (5 instances)
- **Suggestion:** project-level `add-suite` skill that scaffolds all six files at once. Deferred to action 5.

### H2 — Speculative spec items survive too long (Friction Point)
- **Evidence:** #14 auto-restart caveat dropped after challenge (commit `2849f08`); #4 `portal_*` convenience wrappers deferred when value collapsed in a DOM-level world; #10 closed in favor of `@playwright/mcp` composition
- **Confidence:** High (3+ challenged-and-removed cases in one session)
- **Suggestion:** codify a "spec sanity gate" in CLAUDE.md. **Applied as action 1.**

### H3 — README tool-count drift between feature merges (Knowledge Decay)
- **Evidence:** commit `f687bcd Refresh README to reflect post-#14 tool surface` retroactively fixed counts that drifted across #11/#12/#15; #18 nearly re-introduced drift before being caught in self-review
- **Confidence:** High (3 instances of the same drift)
- **Suggestion:** `npm run tools:count` script + CLAUDE.md "update on tool add" rule. **Applied as action 3.**

## Medium-Confidence Insights

### M1 — Direct-push to main can skip the verify-claims step (Friction Point)
- **Evidence:** `f687bcd` was pushed direct to main; user asked "did you review it?" — verification happened *after* push
- **Suggestion:** CLAUDE.md note — verify before push, treat post-push review as backstop only. **Applied as action 4.**

### M2 — Companion-app first-time setup not in README (Knowledge Decay)
- **Evidence:** README mentions `gradle wrapper` for one-time setup but doesn't enumerate Android SDK + JDK + which sdkmanager packages. Discovered mid-session as a 30-minute install detour (see PR #18 setup).
- **Suggestion:** add Android SDK + JDK setup section. **Applied as action 2.**

## Low-Confidence Observations (awareness only)

### L1 — `dw-*` skill chain is well-tuned
- 6 issues round-tripped through `plan → implement → create-pr → review-pr → merge` without rework. No action; preserve.

### L2 — Issue/PR labels follow a convention but the label set was bootstrapped mid-flight
- `priority:*` and `status:*` labels were created via `dw-plan`'s label-ensure step on first invocation. No drift since. Stable.

## Actions Applied

| # | Priority | Action | Verdict | Files Touched | Commit |
|---|----------|--------|---------|---------------|--------|
| 1 | Critical | "Spec sanity gate" rule in CLAUDE.md | Applied | `CLAUDE.md` | `1829746` |
| 2 | Important | Android SDK + JDK setup section in README | Applied | `README.md` | `1829746` |
| 3 | Important | `npm run tools:count` + "update-on-tool-add" rule | Applied | `package.json`, `CLAUDE.md` | `1829746` |
| 4 | Important | Direct-push verify-claims rule in CLAUDE.md | Applied | `CLAUDE.md` | `1829746` |
| 5 | Nice-to-have | `add-suite` skill for the 6-file pattern | **Skipped** — defer until 2+ recurrences | — | — |

## Patterns to Monitor

| Pattern | What to check next run | Success criterion |
|---|---|---|
| README tool-count drift | Any PR adding a tool that didn't update the count line | Zero drift PRs after action 3 |
| Speculative spec items | "is this an assumption?" pushbacks per session | Zero speculative items reach PR |
| Add-suite scaffolding repetition | Next-feature PRs that recreate the 6-file pattern by hand | 2+ recurrences ⇒ promote action 5 |
| Direct-push verify gate | Any direct-push commit followed by a corrective edit | Zero corrective edits to direct-pushed claims |

## Notes for Next Run

- This is the first evolve run; baseline established. Future runs should evaluate the four applied actions for effectiveness using the success criteria above.
- The session this report draws from is exceptionally dense (9 PRs, 6 features shipped, 3 issues deferred-with-rationale, 36 hours). Future evolve runs probably won't have this much signal in a single window — expect smaller, narrower reports.
