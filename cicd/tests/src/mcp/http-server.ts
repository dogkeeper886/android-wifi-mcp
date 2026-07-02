/**
 * Spawn our HTTP MCP server and wait until it is listening — the fork-local
 * adaptation the stdio-based upstream lacks.
 *
 * Upstream's host/verifier drive a *stdio* MCP server (the agent/host spawns it and
 * pipes JSON-RPC over stdin/stdout). Our server speaks HTTP (StreamableHTTP,
 * `src/index.ts`), so instead we launch it on an OS-assigned port (PORT=0), read the
 * `listening on http://…` line it prints, and hand callers the base URL. Callers then
 * connect an MCP Client over StreamableHTTP (the host) or point the ACP agent at the
 * URL as an `{ type: 'http' }` MCP server (the verifier). Mirrors `mcp-client.ts`.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { McpServerConfig } from './server-config.js';

/** Repo root, resolved from this file (…/cicd/tests/src/mcp → repo root). */
export function repoRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..', '..', '..');
}

export interface RunningServer {
  /** Base URL, e.g. http://127.0.0.1:54321 — append '/mcp' for the MCP endpoint. */
  baseUrl: string;
  /** Terminate the spawned server. Idempotent. */
  cleanup: () => void;
}

const READY = /listening on (http:\/\/[\d.]+:\d+)/;

/**
 * Spawn `cfg.command cfg.args` with PORT=0 and wait (up to startTimeoutMs) for the
 * server to announce its URL on stdout/stderr. Rejects on early exit or timeout.
 */
export async function spawnHttpMcpServer(
  cfg: McpServerConfig,
  startTimeoutMs = 15000
): Promise<RunningServer> {
  const proc: ChildProcess = spawn(cfg.command, cfg.args, {
    cwd: cfg.cwd || repoRoot(),
    env: { ...process.env, ...(cfg.env ?? {}), PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let done = false;
  const cleanup = () => {
    if (!proc.killed) proc.kill('SIGTERM');
  };

  const baseUrl = await new Promise<string>((resolve, reject) => {
    const deadline = setTimeout(() => {
      if (done) return;
      done = true;
      proc.kill('SIGKILL');
      reject(new Error(`MCP server did not start within ${startTimeoutMs}ms`));
    }, startTimeoutMs);

    const onLine = (chunk: Buffer) => {
      const text = chunk.toString();
      process.stderr.write(text); // surface server logs like mcp-client does
      const m = text.match(READY);
      if (m && !done) {
        done = true;
        clearTimeout(deadline);
        resolve(m[1]);
      }
    };
    proc.stdout?.on('data', onLine);
    proc.stderr?.on('data', onLine);
    proc.on('error', (err) => {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      reject(err);
    });
    proc.on('exit', (code) => {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      reject(new Error(`MCP server exited with code ${code} before listening`));
    });
  });

  return { baseUrl, cleanup };
}
