---
paths:
  - ".claude/commands/**/*.md"
  - ".claude/skills/**/*.md"
---

# project-profile

The one place a downstream project declares its specifics. The shipped commands and
skills state their *intent* and resolve any project-specific value — a path, an ID
scheme, a label, an integration, a format, an audience — **from this file**, instead of
hardcoding it. Customize a workflow by editing this file, not the units.

**How a unit uses it.** Where a command or skill would otherwise bake in a value, it
points at the matching section here (e.g. "create the *plan* label — see
project-profile → Labels"). The values below are the **defaults**: they reproduce this
repo's current behaviour, so a project that changes nothing behaves exactly as it does
now. Adoption is opt-in — change a line here and every unit follows.

**What belongs here vs. not.** This file is for **declarative** customization — a value
or a list. A whole **procedure** (e.g. how to publish to Confluence and review the
render) is *not* a value; it belongs in its own project-owned skill, never crammed into
a general unit. Lists → here; procedures → a project skill. This is the rules files'
"what this owns vs. what it hands off" boundary, made concrete.

---

## Paths

- stories dir: `docs/stories/`
- tests dir: `docs/tests/`
- images dir: `docs/images/`
- story format contract: `docs/stories/README.md`
- test format contract: `docs/tests/README.md`

## ID schemes

- story id: `STORY-XXX` (zero-padded sequential, e.g. `STORY-001`)
- scenario id: `TS-NN`
- case id: `TC-NN`
- title prefixes: `[STORY-XXX] Plan` · `[STORY-XXX] Test Plan` · `[STORY-XXX] <task>`

## Labels

Names the workflow uses; colours where the workflow pins one (`#hex`), otherwise the
project's choice.

- plan: `plan` (`#5319e7`)
- test plan: `test-plan` (`#006b75`)
- priority: `priority:high` · `priority:medium` · `priority:low`
- type: `feature` · `enhancement` · `bug` · `docs`
- status: `status:in-progress` · `status:needs-review` · `status:blocked`

## Linking & branch

- story back-reference (in titles/bodies): `[STORY-XXX]`
- plan back-reference (task → plan): `Part of #<plan>`
- issue closure (PR → issue): `Fixes #N` / `Closes #N`
- feature branch name: `issue-<N>-<slug>`

## Git

- default branch: *derive it* (`gh repo view --json defaultBranchRef -q .defaultBranchRef.name`), don't assume `main`
- merge strategy: `--merge` (preserve history; switch to `--squash` only if the project requires)

## Front-matter & format contract (test docs)

- test-doc layout: per-story subfolder `docs/tests/STORY-XXX/TS-NN-<slug>.md` — `TS-NN` restarts per story; ad-hoc tests → `docs/tests/<subject>/TS-NN-<slug>.md`
- front-matter fields: `id, title, namespace, story, story_hash, plan, issue, status`
- story hash: `sha256` of the story file (`sha256sum`)
- default status: `green`

## Docs & diagrams

- README output: `README.md`
- diagram policy: one diagram per key idea — each its own SVG source committed + rendered to PNG (no Mermaid / inline diagram blocks)
- images dir: `docs/images/` (also under Paths)

## Review semantics

- canonical format (source of truth): `markdown`
- live integrations: `GitHub` — tools the project genuinely uses; coupling to one
  listed here is correct, not drift. (A downstream adds its own, e.g. Jira, Confluence,
  TestLink.)
- deliverable (triggers a paired review): a unit that *produces or changes* an output —
  by name (`create-`/`sync-`/`publish-`/`draft-`/`init-`) or as a producing gerund skill
  (`planning-…`, `drafting-…`)
- audience (human-read docs): engineers and newcomers
