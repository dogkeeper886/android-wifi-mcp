# Test docs — format contract

Each file is one **scenario** (`TS-NN`) from a reviewed `[STORY-XXX] Test Plan`
issue. Produced by `qw-cases`, gated by `qw-review-cases`, then **bound** to its
`cicd/tests` script by `qw-bind` and kept fresh by `qw-drift`.

- One file per scenario, under a **per-story subfolder**: `docs/tests/STORY-XXX/TS-NN-<slug>.md`.
  `TS-NN` **restarts per story** (each story's folder owns its own TS-01, TS-02, …);
  the `story` front-matter field + the folder disambiguate. Ad-hoc tests (no story) go
  under a named subfolder, `docs/tests/<subject>/TS-NN-<slug>.md`.
- A scenario holds one or more **cases** (`## TC-NN — <title>`), each a **Steps table**
  of *Action* / *Expected Result* rows.
- Steps describe **observable outcomes**, not exact commands/strings — a case
  should survive a reasonable change in how the feature is built. Mark a case
  **(to-be)** when it depends on work not yet shipped.

## Binding a case to its script

A bound case carries a `**Script:**` line naming the cicd YAML that runs it:

```markdown
## TC-01 — success means associated

**Script:** cicd/tests/testcases/wifi/TC-WIFI-002.yml

| Action | Expected Result |
|---|---|
| Connect to a WPA2 SSID | The result reports the device associated to that SSID |
```

`qw-review-bind` (`npm --prefix cicd/tests run audit-bind`) checks the `**Script:**`
resolves. Because our steps are outcome-oriented, it does **not** require a step-count
match. Case binding states:

- **bound** — `**Script:**` resolves to a file.
- **(to-be)** — the title carries `(to-be)`: not bound yet, by design (no failure).
- **manual** — the doc's front-matter sets `binding: manual`: verified by hand, no cicd
  script (e.g. STORY-001's remote-stack e2e).
- **unbound** — a real gap: no `**Script:**` and not `(to-be)`/`manual`. `qw-drift` fails on it.

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
binding: manual           # optional — the whole scenario is verified by hand (no cicd script)
---
```

If `story_hash` no longer matches the story file, the story moved under the
test — re-check the scenario before trusting it.
