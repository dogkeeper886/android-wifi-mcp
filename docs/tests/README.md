# Test docs — format contract

Each file is one **scenario** (`TS-NN`) from a reviewed `[STORY-XXX] Test Plan`
issue. Produced by `qw-cases`, gated by `qw-review-cases`, then handed to the
project's binding + run layer (e.g. bound to `cicd/tests` YAML + MCP tools).

- One file per scenario: `docs/tests/TS-NN-<slug>.md`.
- A scenario holds one or more **cases** (`TC-NN`), each a **Steps table** of
  *Action* / *Expected Result* rows.
- Steps describe **observable outcomes**, not exact commands/strings — a case
  should survive a reasonable change in how the feature is built. Mark a case
  **(to-be)** when it depends on work not yet shipped.

## Front-matter

```yaml
---
id: TS-NN                 # scenario id
title: <scenario title>
namespace: <feature group>
story: STORY-XXX          # the need this verifies
story_hash: <sha256 of docs/stories/STORY-XXX.md>   # detects story drift
plan: <N>                 # the [STORY-XXX] Test Plan issue (scenario source)
issue: <N>                # related dev issue (the "how"), if any
status: green             # doc standing: green = current/valid
---
```

If `story_hash` no longer matches the story file, the story moved under the
test — re-check the scenario before trusting it.
