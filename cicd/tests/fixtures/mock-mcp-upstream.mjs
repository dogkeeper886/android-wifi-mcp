#!/usr/bin/env node
/**
 * Minimal stdio MCP server used by TC-PROXY-001 to verify the upstream
 * proxy without depending on @playwright/mcp or the network.
 *
 * Exposes one tool: `mock_echo` that returns "MOCK_ECHO: <text>".
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const server = new Server(
  { name: 'mock-upstream', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'mock_echo',
      description: 'Echo back the input text — used by TC-PROXY-001.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to echo' },
        },
        required: ['text'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  if (name === 'mock_echo') {
    return {
      content: [{ type: 'text', text: `MOCK_ECHO: ${args.text}` }],
    };
  }
  throw new Error(`Unknown tool: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
