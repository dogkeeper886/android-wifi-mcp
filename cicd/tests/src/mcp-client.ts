#!/usr/bin/env npx tsx
/**
 * Lightweight MCP client CLI for integration testing.
 * Spawns the MCP server (HTTP transport, OS-assigned port), waits for it
 * to start listening, calls one tool over HTTP, prints the result as JSON,
 * then tears the server down.
 *
 * Usage: npx tsx cicd/tests/src/mcp-client.ts <tool_name> '<json_args>'
 *
 * Each invocation spawns its own server, so per-test UPSTREAM_MCP env
 * isolation matches the prior stdio behavior.
 */
import { spawn } from 'child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import path from 'path';
import { fileURLToPath } from 'url';

const [toolName, argsJson] = process.argv.slice(2);
if (!toolName) {
  console.error('Usage: mcp-client.ts <tool_name> [json_args]');
  process.exit(1);
}

const args = argsJson ? JSON.parse(argsJson) : {};

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..', '..', '..');
const serverEntry = path.join(projectRoot, 'dist', 'index.js');

const proc = spawn('node', [serverEntry], {
  env: { ...process.env, PORT: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const startTimeoutMs = 10000;
const readyPattern = /listening on (http:\/\/[\d.]+:\d+)/;

const baseUrl = await new Promise<string>((resolve, reject) => {
  const deadline = setTimeout(() => {
    proc.kill('SIGKILL');
    reject(new Error(`Server did not start within ${startTimeoutMs}ms`));
  }, startTimeoutMs);

  const onLine = (chunk: Buffer) => {
    const text = chunk.toString();
    process.stderr.write(text);
    const m = text.match(readyPattern);
    if (m) {
      clearTimeout(deadline);
      resolve(m[1]);
    }
  };

  proc.stdout.on('data', onLine);
  proc.stderr.on('data', onLine);
  proc.on('error', (err) => {
    clearTimeout(deadline);
    reject(err);
  });
  proc.on('exit', (code) => {
    clearTimeout(deadline);
    reject(new Error(`Server exited with code ${code} before listening`));
  });
});

const cleanup = () => {
  if (!proc.killed) proc.kill('SIGTERM');
};
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });

const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
const client = new Client({ name: 'android-wifi-mcp-test-client', version: '1.0.0' });

try {
  await client.connect(transport);
  const result = await client.callTool({ name: toolName, arguments: args });
  console.log(JSON.stringify(result, null, 2));
  await client.close();
} finally {
  cleanup();
  await new Promise((r) => proc.on('exit', r));
}
