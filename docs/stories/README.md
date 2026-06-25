# Stories — format contract

A **story** captures a *need*: what a user is trying to achieve and why. It is a
**goal, not a spec** — the *how* (files, APIs, ports, design) is worked out later on
the GitHub plan issue (`dw-plan`) and in the test cases, never here.

- One file per story: `docs/stories/STORY-XXX.md` (zero-padded sequential id).
- Produced by `dw-story`, gated by `dw-review-story`, then fed to `dw-plan` /
  `dw-tasks` (dev) and/or `qw-plan` (QA).

## Required sections

```markdown
# STORY-XXX: <title>

## User Story
As a <role>,
I want to <action>,
So that <benefit>.

## The Need
<the problem behind the request, in the user's terms — what and why>

## Success Looks Like
<observable, user-facing outcomes that mean it's done — not implementation steps>

## Open Questions
<what still has to be figured out — resolved later on the issue; the "how" goes here>

## Status
- Created: <YYYY-MM-DD>
- Issues: <none | #N …>
```

**Rule of thumb:** if a line names a file, flag, port, or design choice, it belongs
in the plan issue or a test case — not the story.
