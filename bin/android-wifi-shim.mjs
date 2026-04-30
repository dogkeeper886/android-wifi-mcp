#!/usr/bin/env node
/**
 * android-wifi-shim — stdio↔HTTP MCP transport bridge.
 *
 * Why this exists: as of 2026-04, Claude Code's bundled MCP HTTP client
 * crashes when registered against a Streamable HTTP MCP server (see
 * issue #7). Stdio still works. This shim runs as a stdio MCP server to
 * Claude Code, and internally is an MCP HTTP client to our backend.
 *
 * Other modern MCP clients (Zed, Cursor, etc.) speak HTTP natively and
 * don't need this — point them at the backend URL directly.
 *
 * Usage:
 *   android-wifi-shim <backend-url>
 *
 * Example:
 *   android-wifi-shim http://localhost:3000/mcp
 *
 * Registering with Claude Code:
 *   claude mcp add --transport stdio android-wifi android-wifi-shim http://localhost:3000/mcp
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

function usage(exitCode = 0) {
  process.stderr.write(`android-wifi-shim — stdio↔HTTP MCP transport bridge

Usage:
  android-wifi-shim <backend-url>

Example:
  android-wifi-shim http://localhost:3000/mcp

Registering with Claude Code:
  claude mcp add --transport stdio android-wifi android-wifi-shim http://localhost:3000/mcp

Environment:
  ANDROID_WIFI_SHIM_BACKEND  Backend URL (overrides positional arg if set)
`);
  process.exit(exitCode);
}

const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help')) usage(0);

const backendUrl = process.env.ANDROID_WIFI_SHIM_BACKEND || args[0];
if (!backendUrl) {
  process.stderr.write('android-wifi-shim: backend URL required (positional arg or ANDROID_WIFI_SHIM_BACKEND env)\n');
  usage(1);
}

let parsedUrl;
try {
  parsedUrl = new URL(backendUrl);
} catch (e) {
  process.stderr.write(`android-wifi-shim: invalid URL '${backendUrl}': ${e.message}\n`);
  process.exit(1);
}

const clientTransport = new StreamableHTTPClientTransport(parsedUrl);
const client = new Client({ name: 'android-wifi-shim', version: '1.0.0' });

try {
  await client.connect(clientTransport);
} catch (e) {
  process.stderr.write(`android-wifi-shim: failed to connect to backend ${backendUrl}: ${e.message}\n`);
  process.exit(1);
}

const server = new Server(
  { name: 'android-wifi-shim', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return await client.listTools();
});

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  return await client.callTool({
    name: req.params.name,
    arguments: req.params.arguments,
  });
});

const stdioTransport = new StdioServerTransport();
await server.connect(stdioTransport);
process.stderr.write(`android-wifi-shim: forwarding stdio → ${backendUrl}\n`);

const shutdown = async () => {
  try { await client.close(); } catch { /* ignore */ }
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
