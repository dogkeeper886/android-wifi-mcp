# Session Patterns

Last updated: 2026-04-29
Total sessions recorded: 1

## Workflow Distribution

| Pattern | Count | Last Seen |
|---------|-------|-----------|
| Maintenance | 1 | 2026-04-29 |
| Meta | 1 | 2026-04-29 |

## Recurring Friction Points

| Friction Point | Occurrences | First Seen | Last Seen | Status |
|----------------|-------------|------------|-----------|--------|
| Test-pattern collision (rejectPattern matched both true and false JSON values) | 1 | 2026-04-29 | 2026-04-29 | Open — could be addressed by tightening MCP wrappers to omit isError on success |
| File-permission regression after `mv` from `/tmp` for sensitive config | 1 | 2026-04-29 | 2026-04-29 | Open — candidate for `safe-config-edit` helper |
| Tool-count drift between code and CLAUDE.md / README | 1 | 2026-04-29 | 2026-04-29 | Open — already have `tools:count`; needs enforcement step |
| Stale running-MCP-server during dev (post-edit cache) | 1 | 2026-04-29 | 2026-04-29 | Open — worked around with test-runner spawn; minor |

## Improvement Candidates

| Candidate | Evidence Count | Suggestion | Status |
|-----------|---------------|------------|--------|
| Formalize pre-merge self-review (caught 4 real issues this session) | 4 | Bake into a `dw-review-pr`-style checklist or hook for this project | Proposed |
| `safe-config-edit` helper that preserves perms after temp-file + mv | 1 | Wrap the pattern: backup → jq edit → atomic mv → chmod restore | Proposed |
| Tool-count enforcement (auto-update CLAUDE.md / README count line on tool change) | 1 | Pre-commit hook or `dw-review-pr` checklist | Proposed |
| Test-net-before-refactor pattern as documented template | 1 | Worked cleanly once; capture as a project convention for future "extract-shared-class" work | Proposed |
