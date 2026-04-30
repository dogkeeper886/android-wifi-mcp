import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { DeviceManager } from './adb/device-manager.js';
import { createMcpServer } from './server.js';
import { UpstreamProxy, parseUpstreamConfig } from './mcp/upstream-proxy.js';

const deviceManager = new DeviceManager();
const upstreamProxy = new UpstreamProxy();
const { server: mcpServer, nativeToolNames } = createMcpServer(deviceManager, upstreamProxy);

const shutdown = async () => {
  console.log('Shutting down...');
  await upstreamProxy.closeAll().catch(() => {});
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

async function initDevice(): Promise<void> {
  try {
    await deviceManager.initialize();
    console.log('ADB initialized successfully');

    const devices = await deviceManager.listDevices();
    const connectedDevices = devices.filter(d => d.state === 'device');
    console.log(`Connected devices: ${connectedDevices.length}`);
    for (const device of connectedDevices) {
      console.log(`  - ${device.serial} (${device.model || 'Unknown model'})`);
    }
  } catch (error) {
    console.error('Warning: ADB initialization failed:', error);
    console.error('Please ensure Android SDK Platform Tools are installed and in PATH');
  }
}

async function initUpstreamProxy(): Promise<void> {
  const configs = parseUpstreamConfig(process.env.UPSTREAM_MCP);
  if (configs.length === 0) return;
  console.log(`Connecting ${configs.length} upstream MCP server(s)...`);
  await upstreamProxy.connectAll(configs, nativeToolNames);
  upstreamProxy.attach(mcpServer);
}

async function start(): Promise<void> {
  const app = express();
  app.use(express.json());

  app.post('/mcp', async (req, res) => {
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      res.on('close', () => {
        transport.close();
      });

      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('MCP request error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  });

  app.get('/health', async (_req, res) => {
    const adbAvailable = await deviceManager.getAdbClient().checkAdb();
    let deviceCount = 0;

    try {
      const devices = await deviceManager.listDevices();
      deviceCount = devices.filter(d => d.state === 'device').length;
    } catch {
      // Ignore errors
    }

    res.json({
      status: adbAvailable ? 'ok' : 'degraded',
      server: 'android-wifi-mcp',
      version: '1.0.0',
      adb: adbAvailable,
      connectedDevices: deviceCount,
      upstreams: upstreamProxy.getStatus(),
    });
  });

  await initDevice();
  await initUpstreamProxy();

  const PORT = process.env.PORT ?? '3000';
  const HOST = process.env.HOST || '0.0.0.0';

  const httpServer = app.listen(Number(PORT), HOST, () => {
    const addr = httpServer.address();
    const actualPort = typeof addr === 'object' && addr ? addr.port : PORT;
    console.log(`android-wifi-mcp server listening on http://${HOST}:${actualPort}`);
    console.log(`MCP endpoint: http://${HOST}:${actualPort}/mcp`);
    console.log(`Health check: http://${HOST}:${actualPort}/health`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
