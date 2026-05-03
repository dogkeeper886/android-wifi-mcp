import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { DeviceManager } from './adb/device-manager.js';
import { DeviceObserver } from './adb/device-observer.js';
import { createMcpServer } from './server.js';
import { UpstreamProxy, parseUpstreamConfig } from './mcp/upstream-proxy.js';
import { logger } from './log/logger.js';
import { installCallRecording } from './log/middleware.js';
import { runWithTraceContext, establishTraceContext } from './log/trace-context.js';
import { closePool } from './db/pool.js';

const log = logger.child({ component: 'server' });

const deviceManager = new DeviceManager();
const deviceObserver = new DeviceObserver(process.env.ADB_PATH);
deviceManager.setObserver(deviceObserver);
const upstreamProxy = new UpstreamProxy();
const { server: mcpServer, nativeToolNames } = createMcpServer(deviceManager, upstreamProxy);

const shutdown = async () => {
  log.info('shutting down');
  await deviceObserver.stop().catch(() => {});
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
    // Establish per-request trace context: honor an incoming W3C traceparent
    // when present, otherwise mint a fresh one. Phase 2a: also honor an
    // incoming `X-Caller-Session-Id` header as a client-provided session
    // label (one tag per logical caller — multiple Claude Code windows,
    // separate QA harnesses, etc). Custom header avoids collision with the
    // MCP spec's `Mcp-Session-Id`, which is server-issued in stateful mode.
    // We stay stateless because the SDK's Server class is
    // single-transport-per-instance, so true server-managed sessions would
    // need one McpServer per session — a heavier refactor that's deferred
    // until per-session state isolation is actually needed.
    const ctx = establishTraceContext(req);

    await runWithTraceContext(ctx, async () => {
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
  deviceObserver.start();
  await initUpstreamProxy();
  installCallRecording(mcpServer, upstreamProxy, deviceObserver);

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
