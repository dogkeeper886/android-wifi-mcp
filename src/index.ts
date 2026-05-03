import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { DeviceManager } from './adb/device-manager.js';
import { createMcpServer } from './server.js';
import { UpstreamProxy, parseUpstreamConfig } from './mcp/upstream-proxy.js';
import { logger } from './log/logger.js';
import { installCallRecording } from './log/middleware.js';
import { closePool } from './db/pool.js';

const log = logger.child({ component: 'server' });

const deviceManager = new DeviceManager();
const upstreamProxy = new UpstreamProxy();
const { server: mcpServer, nativeToolNames } = createMcpServer(deviceManager, upstreamProxy);

const shutdown = async () => {
  log.info('shutting down');
  await upstreamProxy.closeAll().catch(() => {});
  await closePool();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

async function initDevice(): Promise<void> {
  try {
    await deviceManager.initialize();
    log.info('adb initialized');

    const devices = await deviceManager.listDevices();
    const connectedDevices = devices.filter(d => d.state === 'device');
    log.info({ count: connectedDevices.length }, 'connected devices');
    for (const device of connectedDevices) {
      log.info({ serial: device.serial, model: device.model || 'Unknown' }, 'device');
    }
  } catch (error) {
    log.warn({ err: error }, 'adb initialization failed — ensure platform-tools are on PATH');
  }
}

async function initUpstreamProxy(): Promise<void> {
  const configs = parseUpstreamConfig(process.env.UPSTREAM_MCP);
  if (configs.length === 0) return;
  log.info({ count: configs.length }, 'connecting upstream MCP server(s)');
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
      log.error({ err: error }, 'MCP request error');
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
      // ignore
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
  installCallRecording(mcpServer, upstreamProxy);

  const PORT = process.env.PORT ?? '3000';
  const HOST = process.env.HOST || '0.0.0.0';

  const httpServer = app.listen(Number(PORT), HOST, () => {
    const addr = httpServer.address();
    const actualPort = typeof addr === 'object' && addr ? addr.port : PORT;
    log.info(`listening on http://${HOST}:${actualPort}`);
    log.info(`MCP endpoint: http://${HOST}:${actualPort}/mcp`);
    log.info(`Health: http://${HOST}:${actualPort}/health`);
  });
}

start().catch((err) => {
  log.fatal({ err }, 'failed to start server');
  process.exit(1);
});
