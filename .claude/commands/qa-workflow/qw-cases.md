# Write the Test Docs

```
Turn a reviewed test plan into readable test docs in docs/tests/ — reusing vetted
steps where a reuse index is available, instead of re-inventing them.

Target: the reviewed `[STORY-XXX] Test Plan` issue from `/qw-review-plan` (its scenarios).

## PURPOSE

The authoring producer of the qa-workflow — the test analogue of `dw-implement`.
Writes each planned scenario as a `docs/tests/TS-*.md` doc in the format contract
(docs/tests/README.md): front-matter + cases, each case a Steps table of
Action / Expected Result rows.

Fits in the qa-workflow:

    qw-plan → qw-review-plan → qw-cases → qw-review-cases   (the authoring half)
    → hand off to the project's binding + run layer

---

## WORKFLOW

    /qw-cases STORY-003
        │
        ├─► Step 1: Read the test-plan issue
        │   - Find it (`test-plan` is qa's own label — distinct from dev's `plan`):
        │       gh issue list --search "[STORY-XXX] Test Plan" --label test-plan --state all
        │     Read its scenarios; note its number <plan>. (No plan issue → the scenarios
        │     came from /qw-plan in chat; <plan> is absent.)
        │
        ├─► Step 2: One file per scenario
        │   - Create docs/tests/TS-NN-<slug>.md with front-matter:
        │       id, title, namespace, story (+ the drift anchor the profile declares),
        │       plan: <plan> (the test-plan issue number — omit when there is none),
        │       issue, status: green
        │   - (Format and field meanings: docs/tests/README.md.)
        │
        ├─► Step 3: Write each case (TC) — reuse before re-inventing
        │   - If the project has a reuse index, query it before writing: is the case's
        │     objective already covered? is there a vetted step for the action you mean?
        │     Reuse or extend a close match instead of coining a near-duplicate (optional).
        │   - Fill the Steps table: each row one Action + its Expected Result.
        │
        └─► Step 4: Hand off
            - Run `/qw-review-cases` to gate the docs.
            - Reviewed docs then hand to the project's binding + run layer — bind each case
              to its executable and run it. (If a reuse index exists, the new docs get
              indexed there.)

---

## OUTPUT

The test docs written. Trace carries each doc's path and the test-plan issue. Reported
per `.claude/rules/agent-report.md` — the verdict first, and a section with nothing to
report says so.

---

## API Notes

- Reuse is optional: if the project has a reuse index, query it for a vetted case or
  step before authoring a near-duplicate, so coverage converges instead of duplicating.
- Drift anchor: record whatever the profile declares, so a later gate can tell the story
  has moved (default: `story_hash`, the `sha256sum` of the story file). A project that
  detects drift another way declares that instead — don't assume hashing.
- `plan`: the `[STORY-XXX] Test Plan` issue number — the scenario source and the trace
  back (see docs/tests/README.md). Absent for ad-hoc tests written without a plan.
- Producer paired with `/qw-review-cases`.
```
