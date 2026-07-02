# Check for Test Drift

```
Surface every test doc that no longer matches what it verifies — before a stale test
passes quietly and a green build lies.

Target: every test doc under docs/tests/ (runs in CI and on demand).

## PURPOSE

The freshness gate of the qa-workflow, and a review in its own right (no paired
producer — it checks the whole set). Drift is silent until something looks; this looks,
deterministically, every run.

Fits in the qa-workflow:

    … qw-bind → qw-review-bind → [run] → qw-drift ──► back to qw-cases / qw-bind when stale

---

## WORKFLOW

    /qw-drift
        │
        ├─► Run the gate:  npm --prefix cicd/tests run drift
        │   Two deterministic signals:
        │     - STALE   — the linked story's sha256 no longer matches the doc's
        │                 `story_hash` (the story moved since the test was synced).
        │     - UNBOUND — a case has no resolving `**Script:**` and is not `(to-be)`
        │                 and its doc is not `binding: manual` (reuses the bind audit).
        │   Exits non-zero if anything is stale or unbound (so CI fails on drift).
        │
        └─► On a finding:
            - STALE: re-read the test against the changed story. If it still holds,
              update `story_hash` (`sha256sum docs/stories/STORY-XXX.md`); if not, fix
              the test via `/qw-cases` → `/qw-review-cases`.
            - UNBOUND: bind it via `/qw-bind` → `/qw-review-bind`, or mark it `(to-be)`
              / the doc `binding: manual` if that's the truth.

---

## API Notes

- Hash-first is deterministic and needs no stack; it runs in CI and on demand.
- `(to-be)` cases and `binding: manual` docs are expected-unbound and never fail the gate.
- No paired producer — `qw-drift` *is* a review (the qa-workflow pairing rule).
```
