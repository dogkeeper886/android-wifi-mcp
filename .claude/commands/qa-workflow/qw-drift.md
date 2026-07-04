# Check the Traceability Chain

```
Surface every break or gap in the chain — tool → test doc → test script → workflow —
before a missing link lets a green build lie about coverage.

Target: the whole chain, derived from the books the repo already keeps (runs in CI and on demand).

## PURPOSE

The chain gate of the qa-workflow, and a review in its own right (no paired producer —
it checks the whole set). It resolves every link by existence/reference — no story hash,
no coverage file — so a revert (deleting or renaming a story, doc, script, or workflow)
trips it. Story *meaning* drift stays a human read here, not an automated hash.

Fits in the qa-workflow:

    … qw-bind → qw-review-bind → [run] → qw-drift ──► back to qw-cases / qw-bind on a gap

---

## WORKFLOW

    /qw-drift
        │
        ├─► Run the gate:  npm --prefix cicd/tests run drift
        │   Two tiers, each derived from the books (src/server.ts, the YAML cases, the
        │   docs, the stories, the workflows). HARD gaps are loose or broken links — they
        │   FAIL the gate:
        │     - UNCOVERED — a tool in src/server.ts is run by no YAML case AND no (to-be)
        │                   case plans it (truly untracked).
        │     - NO-STORY  — a doc's `story:` is missing or its story file doesn't exist.
        │     - UNBOUND   — a case has no resolving `**Script:**` and isn't `(to-be)` /
        │                   `binding: manual` (reuses the bind audit).
        │     - ORPHAN    — a YAML case is bound by no test doc.
        │   PLANNED items are tracked, not broken — reported but they do NOT fail:
        │     - PLANNED — a tool with no script yet, homed as a `(to-be)` case in a story.
        │     - NO-WF   — a suite whose tests + docs exist but has no workflow yet (CI pending).
        │   Exits non-zero only on HARD gaps; a revert that breaks a link still trips it.
        │
        ├─► Then the read a hash can't do:
        │   For each doc, skim that its cases still cover the story's "Success Looks Like".
        │   Structure can resolve while meaning has drifted — flag any that no longer holds.
        │
        └─► On a finding:
            - UNCOVERED / ORPHAN — close or track it: bind via `/qw-cases` → `/qw-bind`,
              or home it as a `(to-be)` case in a story (then it reads PLANNED, not a gap).
            - NO-STORY — fix the `story:` link (or restore the story).
            - UNBOUND — bind via `/qw-bind` → `/qw-review-bind`, or mark `(to-be)` /
              `binding: manual` if that's the truth.
            - PLANNED / NO-WF — a healthy backlog: write the fixture/test or add the
              `test-<suite>.yml` workflow when that work comes up.
            - Meaning drift — fix the doc via `/qw-cases` → `/qw-review-cases`.

---

## API Notes

- All five checks are existence/reference — deterministic, no stack, no hashing; they run
  in CI and on demand, and survive a revert (a deleted file breaks its link).
- `(to-be)` cases and `binding: manual` docs are expected-unbound and never fail the gate.
- The books are the source of truth: tools from `src/server.ts`, coverage from the YAML
  `command:` lines, suites from the YAML `suite:`, workflows from `.github/workflows/` —
  there is no coverage file to maintain.
- No paired producer — `qw-drift` *is* a review (the qa-workflow pairing rule).
```
