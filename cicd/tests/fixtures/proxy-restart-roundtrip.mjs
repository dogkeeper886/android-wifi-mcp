#!/usr/bin/env node
/**
 * One-shot script for TC-PROXY-003.
 *
 * `mcp-client.ts` is one-call-per-spawn, but proxy_restart is only
 * meaningful inside a single server lifetime — testing that the
 * upstream really respawned requires a second tool call against the
 * same server process. So we spawn the server once, call mock_echo,
 * call proxy_restart, then call mock_echo again, and print the three
 * results separated by markers the YAML can match against.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..', '..', '..');
const serverEntry = path.join(projectRoot, 'dist', 'index.js');

const transport = new StdioClientTransport({
  command: 'node',
  args: [serverEntry, '--stdio'],
  env: { ...process.env },
});
const client = new Client({ name: 'proxy-restart-test', version: '1.0.0' });
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
