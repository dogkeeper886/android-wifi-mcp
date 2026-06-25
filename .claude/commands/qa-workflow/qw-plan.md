# Plan What to Test

```
Derive the scenarios that verify a story (or an on-request target) — the "what
to test", before any test doc is written.

Target: a STORY-XXX, or an ad-hoc request ("write a test for X").

## PURPOSE

The front of the qa-workflow — the test analogue of reading a story before
implementing. It produces a short list of **scenarios** (each a TS-to-be) that together
cover the need, and **persists them as a `[STORY-XXX] Test Plan` GitHub issue** so the plan
survives the session and `qw-review-plan` reviews a real artifact (not a chat message);
`qw-cases` then writes against it. See `.claude/rules/qa-workflow.md`.

Fits in the qa-workflow:

    qw-plan → qw-review-plan → qw-cases → qw-review-cases   (the authoring half)
    → hand off to the project's binding + run layer

---

## WORKFLOW

    /qw-plan STORY-003
        │
        ├─► Step 1: Read the need
        │   - If a STORY-XXX: read docs/stories/STORY-XXX.md (the need + "Success Looks Like").
        │   - If an on-request target: restate what behaviour is to be verified.
        │
        ├─► Step 2: Check what already exists
        │   - List the docs/tests/ scenarios already linked to this story:
        │       grep -l 'story: STORY-XXX' docs/tests/
        │   - If the project has a reuse index, query it for cases already covering this
        │     behaviour, so the plan reuses vetted coverage instead of duplicating it (optional).
        │   - Check for an existing test-plan issue (extend it, don't duplicate):
        │       gh issue list --search "[STORY-XXX] Test Plan" --label test-plan --state all
        │     (`test-plan` is qa's own label — distinct from dev's `plan`)
        │
        ├─► Step 3: Propose scenarios
        │   - Break the need into scenarios (TS-to-be), each:
        │     • one coherent slice of behaviour, • independently runnable,
        │     • mappable to one or more of the project's executables (bound later, project layer).
        │   - For each, name the cases (TC-to-be) it will hold, at a sentence each.
        │
        ├─► Step 4: Open the test-plan issue
        │   - Ensure the label (idempotent):
        │       gh label create "test-plan" --color "006b75" --description "The qa test plan for a story (what to test)" --force
        │   - Write the scenarios into a GitHub issue so they outlive the session
        │     (the template below). Title: [STORY-XXX] Test Plan
        │     (ad-hoc target → "Test Plan: <subject>", no story prefix). Label: test-plan.
        │       gh issue create --label "test-plan" --title "[STORY-XXX] Test Plan" --body "…"
        │
        └─► Step 5: Hand off — stop for review
            - Show the test-plan issue URL for `/qw-review-plan`, then `/qw-cases`.
            - STOP. Do NOT write TS docs — that is `/qw-cases`.

---

## TEST-PLAN ISSUE BODY

    ## Scenarios
    ### TS-01 (to-be): <scenario title>
    - Objective: <the slice of behaviour it verifies>
    - Cases: TC-01 <one line>, TC-02 <one line>

    ### TS-02 (to-be): …

    Part of STORY-XXX

---

## API Notes

- A scenario here is a *plan item*, not yet a file — `qw-cases` writes the doc.
- The scenarios persist as a `[STORY-XXX] Test Plan` issue (label `test-plan`; ad-hoc →
  `Test Plan: <subject>`) — the same plan-as-issue form `dev-workflow` uses, with its own
  `test-plan` label so it never collides with dev's `[STORY-XXX] Plan` (label `plan`).
- The story is the goal; keep the plan to coverage, not step detail.
- Producer paired with `/qw-review-plan`, which reviews the issue.
```
