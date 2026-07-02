---
paths:
  - ".claude/commands/qa-workflow/**/*.md"
---

# qa-workflow

A sibling to `dev-workflow`. Where dev-workflow turns a need into shipped code, qa-workflow
turns a story into **trustworthy test docs** — readable markdown in `docs/tests/`, authored
from a reviewed test plan, then **bound** to the `cicd/tests` runner and kept fresh.

## The flow

```
   docs/stories/STORY-XXX.md   ──or──  "write a test for X"   (on request)
            │
            ▼
   qw-plan ───────► qw-review-plan      what to test — scenarios persisted as the
            │                            [STORY-XXX] Test Plan issue
            ▼
   qw-cases ──────► qw-review-cases     write docs/tests/TS-*.md (the format contract)
            │
            ▼
   qw-bind ───────► qw-review-bind      link each case to its cicd script (**Script:**)
            │
            ▼
   [ run the suite: make test / cicd runner ]
            │
            ▼
   qw-drift                             freshness gate — story_hash + binding audit
```

## The test-plan issue

`qw-plan`'s scenarios persist as a **GitHub issue**, titled `[STORY-XXX] Test Plan`, labelled
`test-plan` (distinct from dev's `[STORY-XXX] Plan`). `qw-review-plan` reviews it; `qw-cases`
reads it and records the issue number in each `TS-*.md` `plan:` field.

## Producer → review pairing

| Producer | Review | Covers |
|----------|--------|--------|
| `qw-plan`  | `qw-review-plan`  | does the plan cover the story? |
| `qw-cases` | `qw-review-cases` | each doc: one job, observable, traces back |
| `qw-bind`  | `qw-review-bind`  | each case links to a resolving `**Script:**` |
| —          | `qw-drift`        | story_hash + binding freshness (no producer — it *is* a review) |

No producer ships without a review covering its output.

## What this owns

- The authoring flow + the `docs/tests/` format (the contract), **and** the binding + drift
  gate: `qw-bind`/`qw-review-bind` (`npm run audit-bind`) and `qw-drift` (`npm run drift`),
  backed by `cicd/tests/src/{testdoc,audit-bind,drift,port-yaml}.ts`.
- Binding is **audit, not codegen**: markdown owns intent, the cicd YAML owns execution. Our
  docs are outcome-oriented, so a case is *bound* when its `**Script:**` resolves (no
  step-count match); `(to-be)` cases and `binding: manual` docs are expected-unbound.

The format a test doc must follow is `docs/tests/README.md`.

## Project-specific values

The `docs/tests/` path, the `test-plan` label + colour, the `TS-`/`TC-` id schemes, the
test-doc front-matter fields, the hash algorithm, and the default status are **not** owned
by the `qw-*` commands — they resolve from `.claude/rules/project-profile.md`. The values
a command shows are the defaults; change them in the profile, not the command.
