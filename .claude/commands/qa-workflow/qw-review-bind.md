# Review a Test Doc ↔ Script Binding

```
Audit that each test doc and its bound executable still agree — flag any case whose
`**Script:**` no longer resolves, and any where doc and script have drifted in meaning.

Target: the docs/tests/ scenarios (all, or one named file).

## PURPOSE

The paired review for `/qw-bind`. Binding is audit-not-codegen, so something has to
*check* that the markdown and the YAML haven't drifted apart. This runs the
deterministic audit and adds a human/agent pass for meaning.

Fits in the qa-workflow:

    qw-plan → qw-cases → qw-bind → qw-review-bind → [run] → qw-drift

---

## WORKFLOW

    /qw-review-bind
        │
        ├─► Step 1: Run the deterministic audit
        │     npm --prefix cicd/tests run audit-bind
        │   Per case it reports one of:
        │     - bound   — the `**Script:**` path resolves to a file
        │     - to-be   — the case is `(to-be)`, not bound by design
        │     - manual  — the doc is `binding: manual` (verified by hand, no script)
        │     - UNBOUND — a real gap: no Script, or the Script path doesn't resolve
        │   Exits non-zero if any case is UNBOUND (so CI and /qw-drift gate on it).
        │
        ├─► Step 2: Read the meaning the audit can't
        │   For each `bound` case, skim that the doc's Action/Expected rows still
        │   describe what the YAML actually does — structure can resolve while meaning
        │   has drifted (e.g. the doc claims a persistent disconnect but the script
        │   asserts a clean toggle call). Flag any semantic mismatch.
        │
        └─► Step 3: Decision
            - PASS: no UNBOUND (audit exits 0) and meaning holds.
            - REVISE: for each UNBOUND (or semantic mismatch), fix the doc's
              `**Script:**` / Steps or the binding — smallest change first — then re-run.

---

## API Notes

- The audit (`audit-bind`) is structural + deterministic: our docs are outcome-oriented,
  so it checks that the `**Script:**` resolves, NOT a step-count match. Semantic
  agreement is the reviewer's job.
- `bound` / `to-be` / `manual` / `unbound` are the case's binding states.
- Review paired with the producer `/qw-bind`.
```
