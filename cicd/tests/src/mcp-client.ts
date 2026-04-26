#!/usr/bin/env npx tsx
/**
 * Lightweight MCP client CLI for integration testing.
 * Spawns the MCP server over stdio, calls a tool, prints the result as JSON.
 *
 * Usage: npx tsx cicd/tests/src/mcp-client.ts <tool_name> '<json_args>'
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';
import { fileURLToPath } from 'url';

const [toolName, argsJson] = process.argv.slice(2);
if (!toolName) {
  console.error('Usage: mcp-client.ts <tool_name> [json_args]');
  process.exit(1);
}

const args = argsJson ? JSON.parse(argsJson) : {};

// Resolve dist/index.js relative to this file so the client works from any CWD.
const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..', '..', '..');
const serverEntry = path.join(projectRoot, 'dist', 'index.js');

const transport = new StdioClientTransport({
  command: 'node',
  args: [serverEntry, '--stdio'],
  env: { ...process.env } as Record<string, string>,
});

const client = new Client({ name: 'android-wifi-mcp-test-client', version: '1.0.0' });
await client.connect(transport);

const result = await client.callTool({ name: toolName, arguments: args });
console.log(JSON.stringify(result, null, 2));

await client.close();
