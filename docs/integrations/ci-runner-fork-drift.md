# CI runner: fork-drift baseline vs `agent-workflows-runner`

Our `cicd/tests` is a fork of the upstream `agent-workflows-runner`. STORY-003 pulls
upstream's judge tiers (agent-judge, live-MCP verifier) into it. This baseline (issue
#122) records how far the shared files have drifted, so the ports graft cleanly.

Measured against `/home/jack/src/agent-workflows-runner/cicd/tests/src` on 2026-07-02.

## Shared files — drift

| File | Ours | Upstream | Drift | Note |
|------|------|----------|-------|------|
| `judge/index.ts` | 1 | 3 | small | ours exports only `SimpleJudge`; add `AgentJudge` |
| `judge/simple-judge.ts` | 69 | 80 | small | compatible; keep ours |
| `config.ts` | 30 | 108 | **large** | ours lacks the `judge` + `mcp` config blocks the ports read |
| `types.ts` | 110 | 259 | **large** | ours lacks verifier/test-mcp types; `Judgment` shape is compatible |
| `reporter/json.ts` | 109 | 134 | medium | needs the dual-judge merge (`pass = simple && agent`) + per-judge breakdown |
| `reporter/console.ts` | 60 | 96 | medium | needs per-judge verdict output |
| `cli.ts` | 183 | 292 | **large** | ours lacks the `JUDGE_MODE=dual` wiring and the `test-mcp` command |
| `loader.ts` | 191 | 230 | medium | fork-local (dependency/suite handling); **keep ours** |
| `executor.ts` | 375 | 357 | **large / rewritten** | ours adds device snapshot/restore — **keep ours**, do not sync |

## Upstream-only files to port

- **#123** `judge/agent-judge.ts` (386) — ACP LLM judge. Imports `{ TestResult, Judgment }`
  from `../types`, `CONFIG` from `../config`, and `@agentclientprotocol/sdk`.
- **#124** `judge/verifier-judge.ts` (549) + `mcp/{test-mcp,host,chat-backend,server-config}.ts`
  (~634) + `mcp/backends/{index,ollama}.ts` — the live-MCP verifier and its model host.

Not part of STORY-003 (test-doc tooling / docker): `audit-bind.ts`, `drift.ts`,
`port-yaml.ts`, `testdoc.ts`, `log-collector.ts` — **do not port**.

## New dependencies (`cicd/tests/package.json`)

- `@agentclientprotocol/sdk`, `@agentclientprotocol/claude-agent-acp` — the ACP judge.
- `dotenv` — upstream loads `.env`; useful for `JUDGE_*` / `TEST_SSID_*` (STORY-004).

## Recommendation

- **Graft, don't sync.** Keep our diverged `executor.ts`, `loader.ts`, `config.ts`,
  `types.ts` — they carry fork-local behavior (snapshot/restore, our SUITES). *Add* the
  upstream `judge`/`mcp` config blocks and types rather than overwriting.
- **Land order:** #123 (agent-judge — self-contained, cleanest) → #124 (verifier +
  test-mcp — heaviest, attaches our MCP server) → #125 (per-test judge style) → #126
  (CI wiring). #123 proves the ACP path end to end before the heavier verifier.
- **Runtime auth:** the judge needs an ACP agent (bundled Claude ACP, keyless via
  `~/.claude` / `CLAUDE_CODE_OAUTH_TOKEN`); the verifier's `test-mcp` needs a model
  backend (ollama). Where that isn't present, the code must **degrade to the
  deterministic judge**, not fail — and CI runtime verification is deferred to an
  environment that has it.
