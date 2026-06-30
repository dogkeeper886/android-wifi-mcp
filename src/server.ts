import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DeviceManager } from './adb/device-manager.js';
import { NetworkCheck } from './network/network-check.js';
import { EnterpriseWifiCommands } from './adb/enterprise-wifi.js';
import { UpstreamProxy } from './mcp/upstream-proxy.js';
import { runQuery, KNOWN_CLASSIFICATIONS } from './log/query.js';
import { SecurityType, EapMethod, Phase2Method } from './types.js';

export interface CreateServerResult {
  server: McpServer;
  nativeToolNames: string[];
}

export function createMcpServer(
  deviceManager: DeviceManager,
  upstreamProxy?: UpstreamProxy
): CreateServerResult {
  const mcpServer = new McpServer({
    name: 'android-wifi-mcp',
    version: '1.0.0',
  });
  const nativeToolNames: string[] = [];

  // Wrap mcpServer.tool to also collect names so the upstream proxy can
  // detect collisions without reaching into McpServer internals.
  const originalTool = mcpServer.tool.bind(mcpServer);
  mcpServer.tool = ((name: string, ...rest: unknown[]) => {
    nativeToolNames.push(name);
    // @ts-expect-error — pass-through to the wrapped overloaded method.
    return originalTool(name, ...rest);
  }) as typeof mcpServer.tool;

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
    'query_log',
    'Query the structured-logging tables (tool_calls + device_events) without raw SQL — server validates filters and parameterizes everything. Use this for post-mortems: pull every call for a trace_id, filter by tool_name or surface, narrow to errors_only, or pivot on a Phase 4 attribution classification (physical_disconnect, rsa_revoked, adb_server_confusion, unknown_disconnect). Returns a note when DATABASE_URL is unset.',
    {
      trace_id: z.string().optional().describe('Filter to a single trace_id (W3C 32-hex or UUID-dashed)'),
      session_id: z.string().optional().describe('Filter to a single session_id (Phase 2 — currently always null in tool_calls)'),
      tool_name: z.string().optional().describe('Exact match on tool_name, e.g. "wifi_connect"'),
      surface: z.string().optional().describe('Exact match on surface, e.g. "native" or "proxy:playwright"'),
      since: z.string().optional().describe('ISO timestamp; only rows with started_at >= since'),
      until: z.string().optional().describe('ISO timestamp; only rows with started_at <= until'),
      errors_only: z.boolean().optional().default(false).describe('Only return rows where error IS NOT NULL'),
      classification: z.enum(KNOWN_CLASSIFICATIONS).optional().describe('Filter by Phase 4 attribution.classification'),
      limit: z.number().int().optional().default(50).describe('Max rows to return (capped at 1000)'),
      offset: z.number().int().optional().default(0).describe('Pagination offset'),
      include_events: z.boolean().optional().default(false).describe('When set with trace_id, fetch device_events sharing that trace_id. NOTE: today this returns []; the device observer emits transitions outside any tool-call ALS so device_events.trace_id is always null. Phase 4b will populate it via udev/serial+time correlation. Use device_event_log for the in-memory ring in the meantime.'),
    },
    async (filters) => {
      const result = await runQuery(filters);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  mcpServer.tool(
    'device_event_log',
    'Recent device-attach/detach/state-change transitions observed by the built-in `adb track-devices` listener. Useful when a tool just failed with "No Android devices connected" — the log answers when the device left and what state it was in. The observer also writes each transition to the `device_events` table when DATABASE_URL is set.',
    {
      limit: z.number().optional().default(32).describe('Max transitions to return (newest first, default 32)'),
      serial: z.string().optional().describe('Filter to a specific serial'),
    },
    async ({ limit, serial }) => {
      const observer = deviceManager.getObserver();
      if (!observer) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ events: [], note: 'Device observer is not attached to this server' }, null, 2) }],
        };
      }
      let events = observer.getRecent(limit);
      if (serial) events = events.filter(e => e.serial === serial);
      return {
        content: [{ type: 'text', text: JSON.stringify({ count: events.length, events }, null, 2) }],
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

  // ============ Device Settings (system / secure / global) ============

  mcpServer.tool(
    'device_settings_get',
    'Read a value from the Android settings provider via `adb shell settings get`. Namespaces: system (user prefs), secure (auth/lockscreen/IME), global (airplane_mode_on, mobile_data, private_dns_*, captive_portal_server, etc).',
    {
      namespace: z.enum(['system', 'secure', 'global']).describe('Settings namespace'),
      key: z.string().describe('Setting key, e.g. "airplane_mode_on" or "default_input_method"'),
    },
    async ({ namespace, key }) => {
      await ensureDevice();
      const settings = deviceManager.getSettingsCommands();
      const result = await settings.get(namespace, key);
      if (result.error) {
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  mcpServer.tool(
    'device_settings_put',
    'Write a value to the Android settings provider via `adb shell settings put`. Requires WRITE_SECURE_SETTINGS, which the ADB shell user holds by default on dev/userdebug builds.',
    {
      namespace: z.enum(['system', 'secure', 'global']).describe('Settings namespace'),
      key: z.string().describe('Setting key'),
      value: z.string().describe('New value (always written as a string; the settings provider preserves it as text)'),
    },
    async ({ namespace, key, value }) => {
      await ensureDevice();
      const settings = deviceManager.getSettingsCommands();
      const result = await settings.put(namespace, key, value);
      if (result.success) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
        isError: true,
      };
    }
  );

  mcpServer.tool(
    'device_settings_delete',
    'Delete a key from the Android settings provider via `adb shell settings delete`. Subsequent gets return value: null. Same permission rules as device_settings_put. Idempotent — calling on a missing key still returns success: true.',
    {
      namespace: z.enum(['system', 'secure', 'global']).describe('Settings namespace'),
      key: z.string().describe('Setting key to delete'),
    },
    async ({ namespace, key }) => {
      await ensureDevice();
      const settings = deviceManager.getSettingsCommands();
      const result = await settings.delete(namespace, key);
      if (result.success) {
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: true,
      };
    }
  );

  // ============ Device File Transfer ============

  mcpServer.tool(
    'device_push_file',
    'Push a file from the host to the device via `adb push`. Useful for staging certs, profiles, PCAPs. Targets like `/data/local/tmp/` work; `/data/data/<pkg>/` requires `run-as` (use the companion-app bridge instead).',
    {
      localPath: z.string().describe('Absolute path on the host machine'),
      remotePath: z.string().describe('Destination path on the device'),
    },
    async ({ localPath, remotePath }) => {
      await ensureDevice();
      const files = deviceManager.getFileCommands();
      const result = await files.push(localPath, remotePath);
      if (result.success) {
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: true,
      };
    }
  );

  mcpServer.tool(
    'device_pull_file',
    'Pull a file from the device to the host via `adb pull`. Useful for capturing downloaded files, app-private dumps for assertions, log files. Source must be readable by the adb shell user.',
    {
      remotePath: z.string().describe('Source path on the device'),
      localPath: z.string().describe('Absolute destination path on the host machine'),
    },
    async ({ remotePath, localPath }) => {
      await ensureDevice();
      const files = deviceManager.getFileCommands();
      const result = await files.pull(remotePath, localPath);
      if (result.success) {
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: true,
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
                networks: networks.sort((a, b) => b.rssi - a.rssi),
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

  // ============ Enterprise WiFi Tools (802.1X/EAP) ============

  mcpServer.tool(
    'wifi_connect_enterprise',
    'Connect to 802.1X enterprise WiFi (EAP-PEAP/TTLS/TLS). Requires companion app.',
    {
      ssid: z.string().describe('Network SSID'),
      eapMethod: z.enum(['peap', 'ttls', 'tls']).describe('EAP method'),
      identity: z.string().describe('Username or email for authentication'),
      domainSuffixMatch: z.string().optional().describe('RADIUS server domain to match (e.g. radius.corp.com). Optional when caCertificate is set.'),
      phase2Method: z
        .enum(['mschapv2', 'pap', 'gtc', 'none'])
        .optional()
        .default('mschapv2')
        .describe('Phase 2 authentication method (for PEAP/TTLS)'),
      password: z.string().optional().describe('Password (required for PEAP/TTLS)'),
      anonymousIdentity: z.string().optional().describe('Anonymous outer identity'),
      caCertificate: z.string().optional().describe('CA certificate, PEM. May be a full chain (intermediates + a self-signed root) — needed when the RADIUS uses a public cert and presents only leaf + intermediate.'),
      clientCertificate: z.string().optional().describe('Client certificate for EAP-TLS (base64-encoded PEM)'),
      privateKey: z.string().optional().describe('Private key for EAP-TLS (base64-encoded PEM)'),
      privateKeyPassword: z.string().optional().describe('Private key password (if encrypted)'),
      verify: z.boolean().optional().default(true).describe('Poll for actual association after the suggestion is accepted; a success then means the device is on the SSID, not just that the config was accepted. Set false for the old fire-and-forget behaviour.'),
      verifyTimeoutMs: z.number().int().optional().default(30000).describe('How long to wait for association when verify is true (ms, default 30000)'),
    },
    async (params) => {
      await ensureDevice();
      const enterpriseWifi = new EnterpriseWifiCommands(deviceManager.getAdbClient());

      const result = await enterpriseWifi.connectEnterprise({
        ssid: params.ssid,
        eapMethod: params.eapMethod as EapMethod,
        phase2Method: params.phase2Method as Phase2Method,
        identity: params.identity,
        password: params.password,
        anonymousIdentity: params.anonymousIdentity,
        domainSuffixMatch: params.domainSuffixMatch,
        caCertificate: params.caCertificate,
        clientCertificate: params.clientCertificate,
        privateKey: params.privateKey,
        privateKeyPassword: params.privateKeyPassword,
        verify: params.verify,
        verifyTimeoutMs: params.verifyTimeoutMs,
      });

      if (result.success) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  ssid: result.ssid,
                  eapMethod: result.eapMethod,
                  message: 'Connected to enterprise WiFi successfully',
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
                  eapMethod: result.eapMethod,
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
    'wifi_disconnect_enterprise',
    "Forget enterprise WiFi: remove the companion's network suggestion(s) so the device stops auto-joining and no stale suggestion competes next time. Android removes the app's suggestions as a set, so this clears the companion's enterprise network. Requires companion app.",
    {
      ssid: z.string().describe('Network SSID being forgotten (for intent/logging; the companion clears its enterprise suggestion set)'),
    },
    async ({ ssid }) => {
      await ensureDevice();
      const enterpriseWifi = new EnterpriseWifiCommands(deviceManager.getAdbClient());

      const result = await enterpriseWifi.disconnectEnterprise(ssid);

      if (result.success) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                { success: true, ssid: result.ssid, message: 'Enterprise network suggestion removed' },
                null,
                2
              ),
            },
          ],
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ success: false, ssid: result.ssid, error: result.error }, null, 2),
          },
        ],
        isError: true,
      };
    }
  );

  mcpServer.tool(
    'wifi_install_certificate',
    'Install a CA or client certificate for enterprise WiFi. Requires companion app.',
    {
      certificate: z.string().describe('Certificate content (base64-encoded PEM or DER)'),
      alias: z.string().describe('Friendly name for the certificate'),
      type: z.enum(['ca', 'client']).describe('Certificate type'),
    },
    async ({ certificate, alias, type }) => {
      await ensureDevice();
      const enterpriseWifi = new EnterpriseWifiCommands(deviceManager.getAdbClient());

      const result = await enterpriseWifi.installCertificate(certificate, alias, type);

      if (result.success) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  alias: result.alias,
                  type: result.type,
                  message: `Certificate "${alias}" installed successfully`,
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
                  alias: result.alias,
                  type: result.type,
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
    'wifi_check_companion_app',
    'Check if the enterprise WiFi companion app is installed',
    {},
    async () => {
      await ensureDevice();
      const enterpriseWifi = new EnterpriseWifiCommands(deviceManager.getAdbClient());
      const installed = await enterpriseWifi.isCompanionAppInstalled();

      const notifStatus = installed
        ? await deviceManager.getNotificationCommands().getStatus().catch(() => null)
        : null;

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                companionAppInstalled: installed,
                packageName: 'com.example.wifimcpcompanion',
                notificationAccessGranted: notifStatus?.listenerConnected ?? false,
                capturedNotifications: notifStatus?.capturedCount ?? 0,
                message: installed
                  ? notifStatus?.listenerConnected
                    ? 'Companion app installed; notification access granted'
                    : 'Companion app installed, but notification access not granted. Open the app and tap Grant Notification Access.'
                  : 'Companion app not installed. Build + install companion-app/ to use enterprise WiFi or notification-based OTP capture.',
              },
              null,
              2
            ),
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
    "Detect captive portal via Android's connectivity verdict (open/captive/unknown)",
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

  // ============ Device Screenshot ============
  //
  // Generic UI automation (taps, swipes, key events, type, app launch, URL
  // open, ui dump, package list) was removed in #20's option-A trim. Compose
  // with `mobile-next/mobile-mcp` for selector-based UI work, and with
  // `android-playwright` (Chrome Canary CDP) for in-browser DOM. Screenshot
  // stays here because it's a cheap verification primitive used internally by
  // our WiFi/network/OTP flows.

  mcpServer.tool(
    'device_screenshot',
    'Capture a PNG screenshot. Returns image content with base64 data, or saves to a host path if `outputPath` is given.',
    {
      outputPath: z.string().optional().describe('Optional host filesystem path to save the PNG. If omitted, returns base64 image content.'),
    },
    async ({ outputPath }) => {
      await ensureDevice();
      const screenshot = deviceManager.getScreenshotCommands();
      const result = await screenshot.screenshot(outputPath);

      if ('outputPath' in result) {
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      // Inline image content + a small text summary so callers that only
      // inspect text still see metadata.
      return {
        content: [
          {
            type: 'image',
            data: result.base64,
            mimeType: result.mimeType,
          },
          {
            type: 'text',
            text: JSON.stringify({ success: true, mimeType: result.mimeType, bytes: result.bytes }, null, 2),
          },
        ],
      };
    }
  );

  // ============ SMS / OTP Tools ============

  mcpServer.tool(
    'sms_read_recent',
    'Read recent SMS messages from the device inbox. Optionally filter by sender substring/regex, body regex (with capture group for OTP), or recency. Note: some Samsung/OEM devices restrict content://sms/inbox even via adb shell — the response includes a warning when no rows are returned. Use the companion app notification listener (#3) for those devices.',
    {
      limit: z.number().optional().default(10).describe('Max messages to return (default 10)'),
      senderFilter: z.string().optional().describe('Regex/substring match against the sender (case-insensitive)'),
      bodyRegex: z.string().optional().describe('Regex match against body. If it has a capture group, the captured text becomes the OTP'),
      sinceSeconds: z.number().optional().describe('Only return messages received within the last N seconds'),
    },
    async ({ limit, senderFilter, bodyRegex, sinceSeconds }) => {
      await ensureDevice();
      const sms = deviceManager.getSmsCommands();
      const result = await sms.readRecent({ limit, senderFilter, bodyRegex, sinceSeconds });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  mcpServer.tool(
    'sms_wait_for_otp',
    'Poll the SMS inbox until a matching message arrives or timeout elapses. Returns the extracted OTP string when found. Default timeout 60s, default poll 2s.',
    {
      senderFilter: z.string().optional().describe('Regex/substring to match against the sender'),
      bodyRegex: z.string().optional().describe('Regex against body. If it has a capture group, that becomes the OTP; else first 4-8 digit run is used'),
      sinceSeconds: z.number().optional().default(60).describe('Initial look-back window for matching messages (default 60s)'),
      timeoutMs: z.number().optional().default(60000).describe('Max time to wait in milliseconds (default 60000)'),
      pollIntervalMs: z.number().optional().default(2000).describe('Poll interval in milliseconds (default 2000)'),
    },
    async ({ senderFilter, bodyRegex, sinceSeconds, timeoutMs, pollIntervalMs }) => {
      await ensureDevice();
      const sms = deviceManager.getSmsCommands();
      const result = await sms.waitForOtp({ senderFilter, bodyRegex, sinceSeconds, timeoutMs, pollIntervalMs });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ============ Notification / OTP Tools (companion app) ============

  mcpServer.tool(
    'notifications_list_recent',
    'List recent notifications captured by the companion app (WhatsApp, email, banking apps, etc). Useful for OTPs that do not arrive via SMS. Requires the companion app installed and notification access granted (see wifi_check_companion_app).',
    {
      packageFilter: z.string().optional().describe('Regex match against package name, e.g. "com.whatsapp" or "bank"'),
      bodyRegex: z.string().optional().describe('Regex against title+text. If it has a capture group, that becomes the OTP; else first 4-8 digit run is used'),
      sinceSeconds: z.number().optional().describe('Only return notifications received within the last N seconds'),
      limit: z.number().optional().default(50).describe('Max notifications to return (default 50)'),
    },
    async ({ packageFilter, bodyRegex, sinceSeconds, limit }) => {
      await ensureDevice();
      const notif = deviceManager.getNotificationCommands();
      const result = await notif.listRecent({ packageFilter, bodyRegex, sinceSeconds, limit });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  mcpServer.tool(
    'notifications_wait_for_otp',
    'Poll captured notifications until a matching OTP arrives or timeout elapses. Default timeout 60s, default poll 2s. Use packageFilter (e.g. "com.whatsapp") to scope.',
    {
      packageFilter: z.string().optional().describe('Regex against package name'),
      bodyRegex: z.string().optional().describe('Regex against title+text. Capture group becomes the OTP if present'),
      sinceSeconds: z.number().optional().default(60).describe('Initial look-back window (default 60s)'),
      timeoutMs: z.number().optional().default(60000).describe('Max time to wait in milliseconds (default 60000)'),
      pollIntervalMs: z.number().optional().default(2000).describe('Poll interval in milliseconds (default 2000)'),
    },
    async ({ packageFilter, bodyRegex, sinceSeconds, timeoutMs, pollIntervalMs }) => {
      await ensureDevice();
      const notif = deviceManager.getNotificationCommands();
      const result = await notif.waitForOtp({ packageFilter, bodyRegex, sinceSeconds, timeoutMs, pollIntervalMs });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ============ Proxy Lifecycle ============

  mcpServer.tool(
    'proxy_restart',
    'Tear down and respawn one upstream MCP subprocess by name (e.g. "playwright"). Use after a wifi_disconnect or any device-level event that breaks the upstream\'s cached state — @playwright/mcp keeps a closed Page handle and returns "Target page, context or browser has been closed" forever otherwise. Restoring adb forward alone is not enough; the cache lives in the upstream process memory.',
    {
      name: z.string().describe('Upstream name as configured in UPSTREAM_MCP (e.g. "playwright")'),
    },
    async ({ name }) => {
      if (!upstreamProxy) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'No upstream proxy attached to this server' }, null, 2) }],
          isError: true,
        };
      }
      try {
        const status = await upstreamProxy.restartOne(name);
        return {
          content: [{ type: 'text', text: JSON.stringify(status, null, 2) }],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: (e as Error).message }, null, 2) }],
          isError: true,
        };
      }
    }
  );

  return { server: mcpServer, nativeToolNames };
}
