import { DeviceManager } from './adb/device-manager.js';
import { createMcpServer } from './server.js';

const useStdio = process.argv.includes('--stdio');

// In stdio mode, stdout is the JSON-RPC channel — any non-protocol bytes
// break the client. Redirect console.log to stderr so device-manager init
// messages don't poison the stream.
if (useStdio) {
  console.log = console.error;
}

const deviceManager = new DeviceManager();
const mcpServer = createMcpServer(deviceManager);

const shutdown = async () => {
  console.log('Shutting down...');
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

async function startStdio(): Promise<void> {
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');

  await initDevice();

  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error('android-wifi-mcp listening on stdio');
}

async function startHttp(): Promise<void> {
  const express = (await import('express')).default;
  const { StreamableHTTPServerTransport } = await import(
    '@modelcontextprotocol/sdk/server/streamableHttp.js'
  );

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
    });
  });

  await initDevice();

  const PORT = process.env.PORT || 3000;
  const HOST = process.env.HOST || '0.0.0.0';

  app.listen(Number(PORT), HOST, () => {
    console.log(`android-wifi-mcp server listening on http://${HOST}:${PORT}`);
    console.log(`MCP endpoint: http://${HOST}:${PORT}/mcp`);
    console.log(`Health check: http://${HOST}:${PORT}/health`);
  });
}

if (useStdio) {
  startStdio().catch((err) => {
    console.error('Failed to start stdio server:', err);
    process.exit(1);
  });
} else {
  startHttp().catch((err) => {
    console.error('Failed to start HTTP server:', err);
    process.exit(1);
  });
}
