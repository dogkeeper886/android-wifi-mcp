# Review the Test Plan

```
Check the proposed scenarios cover the story — and stay coverage, not a frozen
step-by-step spec.

Target: the `[STORY-XXX] Test Plan` issue written by `/qw-plan` (label `test-plan`).

## PURPOSE

The paired review for `/qw-plan`. Gates the persisted **test-plan issue** before
`qw-cases` writes any docs, so coverage gaps are caught cheaply. See
`.claude/rules/qa-workflow.md`.

Fits in the qa-workflow:

    qw-plan → qw-review-plan → qw-cases → qw-review-cases   (the authoring half)
    → hand off to the project's binding + run layer

---

## WORKFLOW

    /qw-review-plan STORY-003
        │
        ├─► Step 1: Read the test-plan issue
        │   - Find it (`test-plan` is qa's own label — distinct from dev's `plan`):
        │       gh issue list --search "[STORY-XXX] Test Plan" --label test-plan --state all
        │     (ad-hoc target: search "Test Plan: <subject>"). Read its scenarios.
        │   - If none exists, report and stop (run `/qw-plan` first).
        │
        ├─► Step 2: Coverage vs the story
        │   - [ ] Every item in the story's "Success Looks Like" maps to a scenario.
        │   - [ ] Nothing essential to verifying the story is missing.
        │   - [ ] No scenario goes beyond the story's need.
        │
        ├─► Step 3: Each scenario
        │   - [ ] One coherent slice; independently runnable.
        │   - [ ] Maps to at least one of the project's executables (or names the gap).
        │   - [ ] No duplication of a scenario already in docs/tests/ (grep the story link).
        │
        └─► Step 4: Decision (recorded on the issue)
            - PASS: covers the story → comment "Reviewed — covers the story" on the issue;
              proceed to `/qw-cases`.
            - REVISE: comment the missing or excess scenario on the issue; back to `/qw-plan`.

---

## API Notes

- Coverage gate only — step detail is `qw-cases`/`qw-review-cases`'s job.
- Review paired with the producer `/qw-plan`; it gates the persisted
  `[STORY-XXX] Test Plan` issue, recording PASS/REVISE as a comment on it.
```
