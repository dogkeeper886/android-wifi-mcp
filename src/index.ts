import express, { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { DeviceManager } from './adb/device-manager.js';
import { NetworkCheck } from './network/network-check.js';
import { SecurityType } from './types.js';

const app = express();
app.use(express.json());

// Create device manager
const deviceManager = new DeviceManager();

// Create MCP server
const mcpServer = new McpServer({
  name: 'android-wifi-mcp',
  version: '1.0.0',
});

// Helper to ensure device is selected
async function ensureDevice(): Promise<void> {
  await deviceManager.ensureDeviceSelected();
}

// ============ Device Tools ============

mcpServer.tool(
  'device_list',
  'List all connected Android devices',
  {},
  async () => {
    const devices = await deviceManager.listDevices();
    const selectedDevice = deviceManager.getSelectedDevice();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              devices: devices.map(d => ({
                serial: d.serial,
                state: d.state,
                model: d.model || d.product || 'Unknown',
                selected: d.serial === selectedDevice,
              })),
              selectedDevice,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

mcpServer.tool(
  'device_select',
  'Select an Android device for operations',
  {
    serial: z.string().describe('Device serial number'),
  },
  async ({ serial }) => {
    deviceManager.selectDevice(serial);
    const info = await deviceManager.getSelectedDeviceInfo();

    return {
      content: [
        {
          type: 'text',
          text: `Selected device: ${serial}\nModel: ${info.model}\nAndroid: ${info.androidVersion} (SDK ${info.sdkVersion})`,
        },
      ],
    };
  }
);

mcpServer.tool(
  'device_info',
  'Get detailed information about the selected Android device',
  {},
  async () => {
    await ensureDevice();
    const info = await deviceManager.getSelectedDeviceInfo();
    const versionCheck = await deviceManager.checkAndroidVersion();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              ...info,
              compatibility: versionCheck,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ============ WiFi Tools ============

mcpServer.tool(
  'wifi_scan',
  'Scan for available WiFi networks',
  {},
  async () => {
    await ensureDevice();
    const wifi = deviceManager.getWifiCommands();
    const networks = await wifi.scan();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              count: networks.length,
              networks: networks.sort((a, b) => b.rssi - a.rssi), // Sort by signal strength
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

mcpServer.tool(
  'wifi_connect',
  'Connect to a WiFi network (WPA2/WPA3/Open/OWE)',
  {
    ssid: z.string().describe('Network SSID'),
    security: z.enum(['open', 'owe', 'wpa2', 'wpa3']).describe('Security type'),
    password: z.string().optional().describe('Network password (required for WPA2/WPA3)'),
  },
  async ({ ssid, security, password }) => {
    await ensureDevice();
    const wifi = deviceManager.getWifiCommands();

    if ((security === 'wpa2' || security === 'wpa3') && !password) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: Password is required for WPA2/WPA3 networks',
          },
        ],
        isError: true,
      };
    }

    const result = await wifi.connect(ssid, security as SecurityType, password);

    if (result.success) {
      const status = await wifi.getStatus();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                ssid: result.ssid,
                status,
              },
              null,
              2
            ),
          },
        ],
      };
    } else {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                ssid: result.ssid,
                error: result.error,
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  }
);

mcpServer.tool(
  'wifi_disconnect',
  'Disconnect from the current WiFi network',
  {
    mode: z
      .enum(['toggle', 'forget'])
      .optional()
      .default('toggle')
      .describe(
        'Disconnect mode: "toggle" (disable/enable WiFi, keeps saved network) or "forget" (removes saved network)'
      ),
  },
  async ({ mode }) => {
    await ensureDevice();
    const wifi = deviceManager.getWifiCommands();
    await wifi.disconnect(mode);

    const message =
      mode === 'forget'
        ? 'Disconnected and forgot WiFi network'
        : 'Disconnected from WiFi network';

    return {
      content: [
        {
          type: 'text',
          text: message,
        },
      ],
    };
  }
);

mcpServer.tool(
  'wifi_status',
  'Get current WiFi connection status',
  {},
  async () => {
    await ensureDevice();
    const wifi = deviceManager.getWifiCommands();
    const status = await wifi.getStatus();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(status, null, 2),
        },
      ],
    };
  }
);

mcpServer.tool(
  'wifi_enable',
  'Enable WiFi on the device',
  {},
  async () => {
    await ensureDevice();
    const wifi = deviceManager.getWifiCommands();
    await wifi.setEnabled(true);

    // Wait a bit and check status
    await new Promise(resolve => setTimeout(resolve, 1000));
    const enabled = await wifi.isEnabled();

    return {
      content: [
        {
          type: 'text',
          text: enabled ? 'WiFi enabled successfully' : 'WiFi enable command sent (verify with wifi_status)',
        },
      ],
    };
  }
);

mcpServer.tool(
  'wifi_disable',
  'Disable WiFi on the device',
  {},
  async () => {
    await ensureDevice();
    const wifi = deviceManager.getWifiCommands();
    await wifi.setEnabled(false);

    // Wait a bit and check status
    await new Promise(resolve => setTimeout(resolve, 1000));
    const enabled = await wifi.isEnabled();

    return {
      content: [
        {
          type: 'text',
          text: !enabled ? 'WiFi disabled successfully' : 'WiFi disable command sent (verify with wifi_status)',
        },
      ],
    };
  }
);

mcpServer.tool(
  'wifi_list_networks',
  'List saved WiFi networks on the device',
  {},
  async () => {
    await ensureDevice();
    const wifi = deviceManager.getWifiCommands();
    const networks = await wifi.listSavedNetworks();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              count: networks.length,
              networks,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

mcpServer.tool(
  'wifi_forget',
  'Forget a saved WiFi network',
  {
    networkId: z.number().describe('Network ID to forget (from wifi_list_networks)'),
  },
  async ({ networkId }) => {
    await ensureDevice();
    const wifi = deviceManager.getWifiCommands();
    await wifi.forgetNetwork(networkId);

    return {
      content: [
        {
          type: 'text',
          text: `Forgot network with ID ${networkId}`,
        },
      ],
    };
  }
);

// ============ Network Diagnostics Tools ============

mcpServer.tool(
  'network_ping',
  'Ping a host from the device',
  {
    host: z.string().describe('Host to ping (IP address or hostname)'),
    count: z.number().optional().default(4).describe('Number of ping packets'),
  },
  async ({ host, count }) => {
    await ensureDevice();
    const networkCheck = new NetworkCheck(deviceManager.getAdbClient());
    const result = await networkCheck.ping(host, count);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

mcpServer.tool(
  'network_dns_lookup',
  'Perform DNS lookup from the device',
  {
    hostname: z.string().describe('Hostname to resolve'),
  },
  async ({ hostname }) => {
    await ensureDevice();
    const networkCheck = new NetworkCheck(deviceManager.getAdbClient());
    const result = await networkCheck.dnsLookup(hostname);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

mcpServer.tool(
  'network_check_internet',
  'Check internet connectivity from the device',
  {},
  async () => {
    await ensureDevice();
    const networkCheck = new NetworkCheck(deviceManager.getAdbClient());
    const result = await networkCheck.checkInternet();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

mcpServer.tool(
  'network_check_captive',
  'Check for captive portal on the device',
  {},
  async () => {
    await ensureDevice();
    const networkCheck = new NetworkCheck(deviceManager.getAdbClient());
    const result = await networkCheck.checkCaptivePortal();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

mcpServer.tool(
  'network_interface_info',
  'Get network interface information (IP, gateway, DNS)',
  {},
  async () => {
    await ensureDevice();
    const networkCheck = new NetworkCheck(deviceManager.getAdbClient());
    const result = await networkCheck.getInterfaceInfo();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

// ============ HTTP Server Setup ============

// MCP endpoint using Streamable HTTP Transport
app.post('/mcp', async (req: Request, res: Response) => {
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless mode
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

// Health check endpoint
app.get('/health', async (_req: Request, res: Response) => {
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

// Graceful shutdown
const shutdown = async () => {
  console.log('Shutting down...');
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start server
const startServer = async () => {
  const PORT = process.env.PORT || 3000;
  const HOST = process.env.HOST || '0.0.0.0';

  // Initialize device manager
  try {
    await deviceManager.initialize();
    console.log('ADB initialized successfully');

    // List connected devices
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

  app.listen(Number(PORT), HOST, () => {
    console.log(`android-wifi-mcp server listening on http://${HOST}:${PORT}`);
    console.log(`MCP endpoint: http://${HOST}:${PORT}/mcp`);
    console.log(`Health check: http://${HOST}:${PORT}/health`);
  });
};

startServer();
