# Review the Test Docs

```
Check each test doc does one clear job, has observable steps, and traces back to
its story — before it is bound and run.

Target: the docs/tests/TS-*.md docs written by /qw-cases for a STORY-XXX.

## PURPOSE

The paired review for `/qw-cases`. The test-doc analogue of `dw-review-implement`:
gates the written docs for quality and traceability.

Fits in the qa-workflow:

    qw-plan → qw-review-plan → qw-cases → qw-review-cases   (the authoring half)
    → hand off to the project's binding + run layer

---

## WORKFLOW

    /qw-review-cases STORY-003
        │
        ├─► Step 1: Each doc
        │   - [ ] One scenario, one job; cases are coherent slices of it.
        │   - [ ] Front-matter complete and resolvable: story file exists,
        │         story_hash matches it, namespace set, status present.
        │   - [ ] Each step's Expected Result is observable — checkable, not vague.
        │   - [ ] Conforms to the format contract (docs/tests/README.md).
        │
        ├─► Step 2: Traceability
        │   - [ ] story → doc resolves both ways (→ executable once bound, project layer).
        │   - [ ] No duplicate of an existing scenario for the same story.
        │
        └─► Step 3: Decision
            - PASS: docs do their job and trace back → hand off to the project's binding
              + run layer (bind each case to its executable, then run it).
            - REVISE: fix the named doc — smallest change first — and re-check.

---

## API Notes

- This reviews the *doc* (intent); the doc↔script binding is reviewed in the project's binding + run layer, not here.
- Published-deliverable phrasing/typography is out of scope here.
- Review paired with the producer `/qw-cases`.
```
