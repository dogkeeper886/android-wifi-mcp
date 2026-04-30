#!/usr/bin/env node
/**
 * One-shot script for TC-PROXY-003.
 *
 * `mcp-client.ts` is one-call-per-spawn, but proxy_restart is only
 * meaningful inside a single server lifetime — testing that the
 * upstream really respawned requires a second tool call against the
 * same server process. So we spawn the server once (HTTP transport,
 * OS-assigned port), call mock_echo, call proxy_restart, then call
 * mock_echo again, and print the three results separated by markers
 * the YAML can match against.
 */
import { spawn } from 'child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..', '..', '..');
const serverEntry = path.join(projectRoot, 'dist', 'index.js');

const proc = spawn('node', [serverEntry], {
  env: { ...process.env, PORT: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const startTimeoutMs = 10000;
const readyPattern = /listening on (http:\/\/[\d.]+:\d+)/;

const baseUrl = await new Promise((resolve, reject) => {
  const deadline = setTimeout(() => {
    proc.kill('SIGKILL');
    reject(new Error(`Server did not start within ${startTimeoutMs}ms`));
  }, startTimeoutMs);

  const onLine = (chunk) => {
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
  proc.on('error', (err) => { clearTimeout(deadline); reject(err); });
  proc.on('exit', (code) => { clearTimeout(deadline); reject(new Error(`Server exited with code ${code} before listening`)); });
});

const cleanup = () => { if (!proc.killed) proc.kill('SIGTERM'); };
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });

const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
const client = new Client({ name: 'proxy-restart-test', version: '1.0.0' });

try {
  await client.connect(transport);

  const before = await client.callTool({ name: 'mock_echo', arguments: { text: 'before-restart' } });
  console.log('--- before ---');
  console.log(JSON.stringify(before, null, 2));

  const restarted = await client.callTool({ name: 'proxy_restart', arguments: { name: 'mock' } });
  console.log('--- restart ---');
  console.log(JSON.stringify(restarted, null, 2));

  const after = await client.callTool({ name: 'mock_echo', arguments: { text: 'after-restart' } });
  console.log('--- after ---');
  console.log(JSON.stringify(after, null, 2));

  await client.close();
} finally {
  cleanup();
  await new Promise((r) => proc.on('exit', r));
}
