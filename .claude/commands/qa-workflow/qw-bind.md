# Bind a Test Doc to its Executable

```
Link each case in a test doc to the cicd script that runs it — or scaffold a new
test doc from an existing cicd YAML (the revert direction).

Target: a docs/tests/STORY-XXX/TS-*.md scenario, or a cicd YAML to port.

## PURPOSE

Binding is **audit, not codegen**: the markdown owns *intent* (why / what), the cicd
YAML owns *execution* (how it runs). This command establishes the link; its paired
review `/qw-review-bind` checks the link still holds, and `/qw-drift` gates on it.

Adaptation for this repo: our docs are **outcome-oriented** — a case's Action/Expected
rows are NOT 1:1 with the YAML's steps — so a case is *bound* simply when its
`**Script:**` path resolves to a file (no step-count match). A case whose title carries
`(to-be)` is intentionally not-yet-bound; a whole doc verified by hand sets front-matter
`binding: manual`.

Fits in the qa-workflow:

    qw-plan → qw-cases → qw-bind → qw-review-bind → [run] → qw-drift

---

## WORKFLOW

### A. Forward — bind an existing test doc

    /qw-bind docs/tests/STORY-004/TS-01-connect-verify-cleanup.md
        │
        ├─► For each `## TC-NN —` case, add a `**Script:**` line naming the cicd YAML
        │   that runs it (repo-relative, e.g. cicd/tests/testcases/wifi/TC-WIFI-002.yml).
        ├─► Drop the `(to-be)` marker from a case once it has a resolving Script.
        │   Leave `(to-be)` on cases with no script yet.
        └─► Run `/qw-review-bind` to confirm.

### B. Revert — scaffold a doc from an executable

    /qw-bind cicd/tests/testcases/wifi/TC-WIFI-002.yml
        │
        ├─► Generate a scaffold from the YAML:
        │     npm --prefix cicd/tests run port-yaml -- <yaml> > docs/tests/STORY-XXX/TS-NN-<slug>.md
        │   The scaffold carries the steps and the `**Script:**` binding; objective,
        │   expected results, story link, namespace, and story_hash are TODOs.
        └─► Fill the TODOs (format contract: docs/tests/README.md), then `/qw-review-bind`.

---

## API Notes

- `port-yaml` is a scaffolder, not a translator — a human/agent fills meaning.
- `story_hash` = `sha256sum docs/stories/STORY-XXX.md` (the drift anchor).
- Producer paired with `/qw-review-bind` (the audit).
```
