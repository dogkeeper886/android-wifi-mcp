# android-wifi-mcp

MCP Server for WiFi control on Android devices via ADB (Android Debug Bridge).

This server enables Claude and other MCP clients to remotely control WiFi connectivity on Android devices connected via USB.

## Features

- **WiFi Control**: Scan, connect, disconnect, enable/disable WiFi
- **Network Types**: Open, OWE, WPA2-PSK, WPA3-SAE support
- **802.1X Enterprise WiFi**: EAP-PEAP, EAP-TTLS, EAP-TLS support (requires companion app)
- **Multi-Device**: Manage multiple connected Android devices
- **Network Diagnostics**: Ping, DNS lookup, internet connectivity, captive portal detection
- **Device Info**: Query device model, Android version, and compatibility

## Requirements

### Host PC
- Node.js 18+
- Android SDK Platform Tools (for `adb`)
  - Fedora: `sudo dnf install android-tools`
  - Ubuntu/Debian: `sudo apt install android-tools-adb`
  - macOS: `brew install android-platform-tools`
  - Windows: Download from [Android Developer](https://developer.android.com/tools/releases/platform-tools)

### Android Device
- Android 11 (SDK 30) or higher
- USB Debugging enabled
- USB cable connection to host PC

### For Enterprise WiFi (Optional)
- Android SDK (for building companion app)
- Gradle 8.x

## Setup

### 1. Enable USB Debugging on Android

1. Go to **Settings > About Phone**
2. Tap **Build Number** 7 times to enable Developer Options
3. Go to **Settings > Developer Options**
4. Enable **USB Debugging**
5. Connect device via USB
6. Accept the RSA key prompt on the device

### 2. Verify ADB Connection

```bash
adb devices
```

You should see your device listed as "device" (not "unauthorized" or "offline").

### 3. Install and Run MCP Server

```bash
cd android-wifi-mcp
npm install
npm run build
npm start
```

The server will start on `http://localhost:3000`.

### 4. Configure Claude Code

#### Using Claude Code CLI (Recommended)

**HTTP transport** (requires server running):
```bash
claude mcp add --transport http android-wifi http://localhost:3000/mcp
```

**Stdio transport** (auto-starts server):
```bash
claude mcp add --transport stdio android-wifi -- node /path/to/android-wifi-mcp/dist/index.js
```

#### Manual JSON Configuration (Alternative)

Add to your MCP settings:

```json
{
  "mcpServers": {
    "android-wifi": {
      "command": "node",
      "args": ["/path/to/android-wifi-mcp/dist/index.js"],
      "env": {
        "PORT": "3000"
      }
    }
  }
}
```

Or connect via HTTP transport:

```json
{
  "mcpServers": {
    "android-wifi": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

### 5. Setup Enterprise WiFi (Optional)

Skip this section if you only need WPA2/WPA3 personal networks.

Enterprise WiFi (802.1X/EAP) requires a companion Android app because the `cmd wifi` interface only supports PSK-based authentication.

#### Supported EAP Methods

| Method | Description | Credentials |
|--------|-------------|-------------|
| EAP-PEAP | Protected EAP with MSCHAPv2 | Username + Password |
| EAP-TTLS | Tunneled TLS | Username + Password |
| EAP-TLS | Certificate-based | Client Certificate + Private Key |

#### Build and Install Companion App

1. **Build the APK** (requires Android SDK and Gradle):
   ```bash
   cd companion-app
   gradle wrapper        # Generate wrapper (first time only)
   ./gradlew assembleDebug
   ```

2. **Install on device**:
   ```bash
   adb install app/build/outputs/apk/debug/app-debug.apk
   ```

3. **Launch the app** once to grant permissions:
   ```bash
   adb shell am start -n com.example.wifimcpcompanion/.MainActivity
   ```

4. **Verify installation**:
   ```
   > Use wifi_check_companion_app to verify the app is installed
   ```

## Available Tools

### Device Management

| Tool | Description |
|------|-------------|
| `device_list` | List all connected Android devices |
| `device_select` | Select a device for operations |
| `device_info` | Get detailed device information |

### WiFi Control

| Tool | Description |
|------|-------------|
| `wifi_scan` | Scan for available WiFi networks |
| `wifi_connect` | Connect to a WiFi network (WPA2/WPA3) |
| `wifi_disconnect` | Disconnect from current network |
| `wifi_status` | Get current WiFi connection status |
| `wifi_enable` | Enable WiFi |
| `wifi_disable` | Disable WiFi |
| `wifi_list_networks` | List saved WiFi networks |
| `wifi_forget` | Forget a saved network |

### Enterprise WiFi (802.1X)

| Tool | Description |
|------|-------------|
| `wifi_connect_enterprise` | Connect to 802.1X WiFi (PEAP/TTLS/TLS) |
| `wifi_install_certificate` | Install CA or client certificate |
| `wifi_check_companion_app` | Check if companion app is installed |

### Network Diagnostics

| Tool | Description |
|------|-------------|
| `network_ping` | Ping a host from the device |
| `network_dns_lookup` | Perform DNS lookup |
| `network_check_internet` | Check internet connectivity |
| `network_check_captive` | Check for captive portal |
| `network_interface_info` | Get IP, gateway, DNS info |

## Usage Examples

### List Connected Devices

```
> Use device_list to see connected Android devices
```

### Connect to WiFi (WPA2/WPA3)

```
> Connect my phone to the network "HomeWiFi" with password "mypassword123"
```

This will use `wifi_connect` with:
- ssid: "HomeWiFi"
- security: "wpa2"
- password: "mypassword123"

### Connect to Enterprise WiFi (802.1X)

```
> Connect to "CorpWiFi" using PEAP with username "user@corp.com" and password "secret"
```

This will use `wifi_connect_enterprise` with:
- ssid: "CorpWiFi"
- eapMethod: "peap"
- identity: "user@corp.com"
- password: "secret"
- domainSuffixMatch: "radius.corp.com" (required for Android 11+)

### Check Connection Status

```
> What's the current WiFi status on my phone?
```

### Scan for Networks

```
> Scan for available WiFi networks on my Android device
```

### Diagnose Connectivity

```
> Check if my phone has internet access and detect any captive portal
```

## Reference

### Security Types

| Type | Use Case | Password Required |
|------|----------|-------------------|
| `open` | Open networks (no security) | No |
| `owe` | Opportunistic Wireless Encryption | No |
| `wpa2` | WPA2-PSK (most common) | Yes |
| `wpa3` | WPA3-SAE (modern) | Yes |

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `HOST` | 0.0.0.0 | Server bind address |
| `ADB_PATH` | adb | Path to adb binary |

## Troubleshooting

### "No devices connected"

1. Check USB cable connection
2. Verify USB debugging is enabled
3. Run `adb devices` to check device state
4. If "unauthorized", accept the prompt on the device

### "Multiple devices connected"

Use `device_select` to choose which device to control:
```
> Select device with serial R5CT12345AB
```

### "ADB is not available"

Install Android SDK Platform Tools and ensure `adb` is in your PATH:
```bash
which adb  # Linux/macOS
where adb  # Windows
```

### WiFi commands fail

- Ensure Android 11+ (`cmd wifi` requires SDK 30+)
- Check device is not in restricted mode (work profile, etc.)
- Some Samsung devices may have different behavior

### Enterprise WiFi not working

- Ensure companion app is installed and launched once
- Check `wifi_check_companion_app` returns success
- Verify the domain suffix match is correct for your RADIUS server

## Limitations

- **Android 11+ Required**: The `cmd wifi` interface requires Android 11 (SDK 30) or higher
- **Enterprise WiFi Requires Companion App**: 802.1X/EAP authentication needs the companion app installed
- **USB Required**: Device must be connected via USB with debugging enabled
- **No Captive Portal Automation**: Can detect but not automate portal login

## Project Structure

```
android-wifi-mcp/
├── src/
│   ├── index.ts               # MCP server entry point
│   ├── types.ts               # TypeScript interfaces
│   ├── adb/
│   │   ├── adb-client.ts      # ADB command wrapper
│   │   ├── device-manager.ts  # Multi-device handling
│   │   ├── wifi-commands.ts   # cmd wifi wrapper
│   │   └── enterprise-wifi.ts # 802.1X enterprise WiFi
│   └── network/
│       └── network-check.ts   # Network diagnostics
├── companion-app/             # Android companion app for 802.1X
│   ├── app/src/main/kotlin/   # Kotlin source files
│   └── build.gradle.kts       # Gradle build config
├── package.json
├── tsconfig.json
└── README.md
```

## License

MIT
