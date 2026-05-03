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
- **Settings & file staging**: Read/write `system`/`secure`/`global` settings, push/pull files to/from the device

## When to use this MCP vs alternatives

This server owns the **ADB-level control plane for QA flows**: WiFi, network probing, OTP capture, device-settings I/O, file staging. It deliberately does **not** ship generic Android UI automation or browser DOM tooling — those are better served by upstream projects you can run alongside.

| Goal | Use |
|---|---|
| Connect to WiFi (PSK / 802.1X), capture OTPs from SMS or notifications, probe captive portals, read/write Android settings, push or pull files | **`android-wifi-mcp`** (this project) |
| Drive system Settings UI, app screens, or any selector-based UI automation | **[`mobile-next/mobile-mcp`](https://github.com/mobile-next/mobile-mcp)** — semantic accessibility-tree access (`mobile_list_elements_on_screen`), tap by computed coordinates |
| Drive a captive-portal page, web admin UI, or anything DOM-level on the device | **[`playwright-android`](https://github.com/microsoft/playwright)** via Chrome Canary CDP — see [`docs/integrations/canary-cdp.md`](docs/integrations/canary-cdp.md) |

These three compose cleanly: register all three with Claude Code, and the assistant orchestrates whichever fits each step. The proxy in this server (#14) bundles `@playwright/mcp` for host-side browser DOM in the same tools/list, but mobile-mcp stays a separate registration.

For the gotcha on `adb shell uiautomator dump` (null-root retry loop) — see `docs/integrations/uiautomator-retry.md`. We don't ship a UI-dump tool; this is reference material for anyone calling uiautomator directly.

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

### For Enterprise WiFi or Notification Capture (Optional)

The companion Android app is needed for 802.1X enterprise WiFi and for capturing OTPs that don't arrive via SMS (#3 — notification listener for WhatsApp / email / banking). Skip this section if you only need WPA2/WPA3 personal WiFi + SMS-based OTPs.

**One-time host setup (Linux example, Fedora/RHEL):**

```bash
# JDK with javac (the headless variant alone won't compile)
sudo dnf install -y java-21-openjdk-devel

# Android command-line tools (~150 MB)
mkdir -p ~/Android/Sdk/cmdline-tools
curl -L -o /tmp/cmdline-tools.zip \
  "https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip"
unzip -q /tmp/cmdline-tools.zip -d /tmp && \
  mv /tmp/cmdline-tools ~/Android/Sdk/cmdline-tools/latest

export ANDROID_HOME=$HOME/Android/Sdk
export PATH=$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH

yes | sdkmanager --licenses > /dev/null
sdkmanager "platforms;android-34" "build-tools;34.0.0" "platform-tools"

# Gradle 8.5 (only if you don't already have a system Gradle)
curl -L -o /tmp/gradle.zip "https://services.gradle.org/distributions/gradle-8.5-bin.zip"
unzip -q /tmp/gradle.zip -d /tmp && mv /tmp/gradle-8.5 ~/Android/gradle
export PATH=~/Android/gradle/bin:$PATH
```

After this, `cd companion-app && gradle wrapper && ./gradlew assembleDebug` produces `app/build/outputs/apk/debug/app-debug.apk`.

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
npm start             # HTTP transport on http://localhost:3000
npm run stop          # Send SIGTERM to whatever is listening on $PORT (default 3000)
npm restart           # stop + start; use this after `npm run build` to pick up code changes
```

The server speaks **Streamable HTTP** (the MCP-spec transport). One process serves all connected MCP clients.

### 4. Configure your MCP client

#### Zed, Cursor, and other MCP clients with native HTTP support

```bash
claude mcp add --transport http android-wifi http://localhost:3000/mcp
```

Or in JSON config:

```json
{
  "mcpServers": {
    "android-wifi": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

#### Claude Code (uses the bundled stdio shim)

Claude Code's bundled HTTP MCP client crashes when registered against a Streamable HTTP server (issue #7 — bug is in their binary, not ours). Use the stdio shim shipped with this package as the bridge:

```bash
# After `npm install -g .` (or wherever the package is installed)
claude mcp add --transport stdio android-wifi android-wifi-shim http://localhost:3000/mcp
```

The shim is a ~30-LOC Node CLI that pretends to be a stdio MCP server to Claude Code and forwards every call to the HTTP backend. No Python or other extra dependencies — same Node toolchain you already have.

If you didn't install globally:

```bash
claude mcp add --transport stdio android-wifi node /path/to/android-wifi-mcp/bin/android-wifi-shim.mjs http://localhost:3000/mcp
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

**32 native tools** in 9 categories below. With the optional `@playwright/mcp` upstream enabled (see [Proxying upstream MCPs](#proxying-upstream-mcps)), an additional **21 `browser_*` tools** are surfaced through the same endpoint for **53 total**.

### Device Management

| Tool | Description |
|------|-------------|
| `device_list` | List all connected Android devices |
| `device_select` | Select a device for operations |
| `device_info` | Get detailed device information |
| `device_event_log` | Recent device-attach/detach/state-change transitions from the built-in `adb track-devices` listener |
| `query_log` | Structured query over the `tool_calls` + `device_events` tables (post-mortem; requires `DATABASE_URL`) |
| `device_screenshot` | Capture a PNG (returns base64 or saves to a host path) |

### Device Settings (system / secure / global)

| Tool | Description |
|------|-------------|
| `device_settings_get` | Read a value from `adb shell settings get <namespace> <key>` |
| `device_settings_put` | Write a value via `adb shell settings put <namespace> <key> <value>` |
| `device_settings_delete` | Delete a key via `adb shell settings delete <namespace> <key>` |

### Device File Transfer

| Tool | Description |
|------|-------------|
| `device_push_file` | Host → device via `adb push`. Use for staging certs, profiles, PCAPs |
| `device_pull_file` | Device → host via `adb pull`. Use for capturing downloads, app dumps, log files |

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

### SMS / OTP

Reads SMS messages from `content://sms/inbox` via adb shell — no root, no companion app. **Limitation:** some Samsung/OEM devices restrict the SMS content provider even from adb; the tools return an empty list with a `warning` field on those devices, and the recommended fallback is the notification listener planned in #3.

| Tool | Description |
|------|-------------|
| `sms_read_recent` | Read recent SMS, optionally filtered by sender, body regex, or recency |
| `sms_wait_for_otp` | Poll the inbox until a matching OTP arrives or timeout elapses |

### Notification capture (companion app)

For OTPs that don't come via SMS — WhatsApp, banking apps, email clients, etc. The companion app's `NotificationListenerService` captures every notification system-wide, then the host MCP server reads them through the same broadcast bridge used for enterprise WiFi. **Requires** the user to grant **Notification access** to the companion app once via Settings → Notifications → Notification access (the app's main screen has a one-tap shortcut). Granted state is reported by `wifi_check_companion_app`.

| Tool | Description |
|------|-------------|
| `notifications_list_recent` | List recent captured notifications, optionally filtered by package or body regex |
| `notifications_wait_for_otp` | Poll captured notifications until a matching OTP arrives or timeout elapses |

### Proxy lifecycle

| Tool | Description |
|------|-------------|
| `proxy_restart` | Tear down and respawn one upstream MCP subprocess by name. Use after `wifi_disconnect` or any device-level event that breaks the upstream's cached state — `@playwright/mcp` keeps a closed `Page` handle and surfaces "Target page, context or browser has been closed" for every call until the subprocess is restarted. Restoring `adb forward` alone does not fix it. |

### Proxied (optional)

When `UPSTREAM_MCP` is configured, this server transparently exposes tools from upstream MCP servers in the same namespace. The canonical default (`@playwright/mcp`) adds 21 DOM-level `browser_*` tools — `browser_navigate`, `browser_click`, `browser_fill_form`, `browser_evaluate`, `browser_snapshot`, `browser_take_screenshot`, etc. See [Proxying upstream MCPs](#proxying-upstream-mcps) for setup. These drive **host** Chromium today; phone-side Chrome is gated on a working Chrome DevTools Protocol path.

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

### Read or change an Android setting

```
> Read airplane_mode_on, then set private_dns_mode to "off"
```

Uses `device_settings_get` (namespace `global`, key `airplane_mode_on`) and `device_settings_put` (namespace `global`, key `private_dns_mode`, value `"off"`). For UI-driven Settings flows (the toggle screens, not the underlying provider), compose with `mobile-next/mobile-mcp`.

### Push a cert to the device, then install it

```
> Push /tmp/corp_ca.pem to /data/local/tmp/ca.pem, then install it as the CA cert "CorpCA"
```

Chains `device_push_file` and `wifi_install_certificate`. The push goes through `adb push`; the install routes through the companion app's bridge.

### Wait for a Login OTP via SMS

```
> Wait up to 60 seconds for an SMS OTP from "VERIFY" — give me the code as soon as it arrives
```

Calls `sms_wait_for_otp` with `senderFilter: "VERIFY"` and a 60s timeout. The tool returns the extracted OTP string when a matching message arrives. On devices that restrict the SMS content provider (some Samsung models), see #3 for the notification-listener fallback.

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
| `DATABASE_URL` | _(unset)_ | Postgres URL for structured logging. When unset, logging is disabled and the server runs unchanged. See "Structured logging" below. |
| `LOG_LEVEL` | info | pino log level (`trace`, `debug`, `info`, `warn`, `error`, `fatal`) |
| `LOG_DEST` | stderr | App log destination — `stderr` or a file path |

## Structured logging (optional, Phase 0b)

The server can record every tool call to a Postgres database for post-mortem queries (issue #51). This is **opt-in**: set `DATABASE_URL` and the recording layer activates; leave it unset and the server runs as before.

```bash
# Bring up Postgres (Docker Compose) and apply migrations
make up
make migrate

# Run the server with logging enabled
DATABASE_URL=postgres://mcp:mcp@localhost:5433/android_wifi_mcp npm start

# Inspect rows
make psql
# > SELECT tool_name, surface, duration_ms FROM tool_calls ORDER BY started_at DESC LIMIT 10;
```

`tool_calls` captures each call's args/result/error and `duration_ms`; `device_events` and `sessions` are placeholders populated in later phases (built-in observer, session routing). Schema lives under `migrations/`.

**Sensitive args are redacted before INSERT.** The middleware replaces values for these keys (case-insensitive) with `***`: `password`, `privateKey`, `privateKeyPassword`, `caCertificate`, `clientCertificate`, `certificate`. Recursion handles nested objects and arrays. The list lives in `src/log/redact.ts` — add to it if you introduce a new tool that takes a secret-bearing arg.

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

## Proxying upstream MCPs

This server can spawn other MCP servers as subprocesses and surface their tools through its own tool list, so Claude Code only needs **one MCP registration** to access device + WiFi + SMS + UI primitives + browser automation. The canonical example is composing with Microsoft's [`@playwright/mcp`](https://www.npmjs.com/package/@playwright/mcp) for DOM-level browser control.

### How to enable

Set the `UPSTREAM_MCP` environment variable. Two accepted formats:

```bash
# Shorthand: name=command [args...] ; ... (semicolon-separated for multiple)
UPSTREAM_MCP="playwright=npx -y @playwright/mcp@latest --headless"

# JSON: an array of { name, command, args?, env? }
UPSTREAM_MCP='[{"name":"playwright","command":"npx","args":["-y","@playwright/mcp@latest"]}]'
```

On startup the server spawns each upstream over stdio, fetches its `tools/list`, and registers every tool on its own surface. A call to a proxied tool is forwarded transparently — the client sees one server.

### Tool name collisions

If an upstream's tool name clashes with a native tool or another upstream's tool, the proxy prefixes it with `<upstream-name>__`. Example: a hypothetical second `device_list` from an upstream named `playwright` becomes `playwright__device_list`.

### Health observability

The HTTP `/health` endpoint reports per-upstream state (`connected` / `disconnected` / `failed`, plus `toolCount` and the last error). Stdio mode logs the same to stderr at startup.

### Per-upstream env overrides

Recognized today:

| Env var | Effect |
|---|---|
| `PLAYWRIGHT_HEADED=1` | Strips `--headless` from the args of an upstream named `playwright` at startup so Chromium runs visible. Saves having to rewrite `UPSTREAM_MCP` and re-register the server. |

### Lifecycle

Upstreams start eagerly at server boot. On `SIGINT` / `SIGTERM` the server closes all upstream subprocesses cleanly.

### Verified composition

The default `UPSTREAM_MCP` in `.env.example` is `@playwright/mcp` — running our server with that set yields **53 total tools** (32 native + 21 from `@playwright/mcp`), all reachable from one MCP endpoint. See `cicd/tests/testcases/proxy/TC-PROXY-002.yml` for the end-to-end smoke test.

## Testing

YAML-driven test framework under `cicd/tests/` runs against an attached Android device. Each test step spawns its own server (HTTP transport, OS-assigned port) so per-test `UPSTREAM_MCP` env isolation works the same way it did under stdio.

### Run smoke tests locally

```bash
# from repo root, one-time setup
npm install && npm run build
cd cicd/tests && npm install

# run the smoke suite
npm test                    # all tests
npm run test:smoke          # smoke suite only
npx tsx src/cli.ts list     # list available test cases
npx tsx src/cli.ts run --id TC-SMK-001   # one specific test
```

Results land in `cicd/results/<timestamp>_<suite>/` (`summary.json` plus one `<test-id>.json` per test).

### How the runner works

- `mcp-client.ts` spawns `node dist/index.js` (HTTP, OS-assigned port), waits for the listening line on stderr, connects via `StreamableHTTPClientTransport`, calls one tool, prints the JSON result, then tears the server down. Each test step is one such call.
- `executor.ts` snapshots WiFi state (enabled flag, current SSID, saved-network IDs) before each test and restores it after — **per-test**, so a failing test cannot poison the next one. Snapshot/restore goes through `adb` directly so the framework doesn't depend on the very thing under test.
- `simple-judge.ts` decides pass/fail from exit codes plus `expectPatterns`/`rejectPatterns`.

### Test suites

| Suite | What it covers | Status |
|---|---|---|
| `smoke` | Read-only checks against existing tools — safe to run any time | 7 tests |
| `ui` | UI-automation primitives (`device_*` from #1) | 9 tests |
| `sms` | SMS / OTP shape checks (tolerates Samsung-restricted inboxes) | 3 tests |
| `notifications` | Notification capture via companion app (OTPs from any package) | 3 tests |
| `proxy` | Upstream MCP proxying — mock + `@playwright/mcp` end-to-end | 2 tests |
| `wifi` | Connect/disconnect/forget against test SSIDs (env-driven) | not yet |
| `enterprise` | 802.1X (PEAP/TTLS/TLS) — needs companion app + RADIUS fixtures | not yet |
| `portal` | Captive portal flows — see #4 (deferred) | not yet |

### Adding a new test case

Use the `ci-testcase` skill (`.claude/skills/ci-testcase/SKILL.md`) — it generates a YAML in the right shape for the right suite. Pattern-matching gotcha: tool output is double-encoded JSON, so use **bare strings** in patterns (`connected.*true`, not `'"connected": true'`).

### CI

GitHub Actions workflows under `.github/workflows/`:

- `build.yml` — runs on github-hosted runners, does `npm ci` + `tsc --noEmit` + `npm run build`. No device needed.
- `test-run.yml` — reusable, `runs-on: self-hosted`, takes a `tag` input. Requires the runner to have `adb` installed and one Android device USB-attached.
- `test-smoke.yml` — calls `test-run.yml` with `tag: smoke`.
- `ci.yml` — orchestrator. **Manual trigger only** (`workflow_dispatch`) — chains build → test-smoke.

## Limitations

- **Android 11+ Required**: The `cmd wifi` interface requires Android 11 (SDK 30) or higher
- **Enterprise WiFi Requires Companion App**: 802.1X/EAP authentication needs the companion app installed
- **USB Required**: Device must be connected via USB with debugging enabled
- **No Captive Portal Automation**: Can detect but not automate portal login

## Project Structure

```
android-wifi-mcp/
├── src/
│   ├── index.ts                # Entry — HTTP server bootstrap
│   ├── server.ts               # MCP server factory + tool registrations
│   ├── types.ts                # TypeScript interfaces
│   ├── mcp/
│   │   └── upstream-proxy.ts   # Spawn + proxy other MCP servers (@playwright/mcp etc.)
│   ├── adb/
│   │   ├── adb-client.ts       # ADB command wrapper
│   │   ├── device-manager.ts   # Multi-device handling
│   │   ├── wifi-commands.ts    # cmd wifi wrapper
│   │   ├── screenshot-commands.ts # screencap wrapper
│   │   ├── settings-commands.ts   # adb shell settings get/put
│   │   ├── file-commands.ts       # adb push / adb pull
│   │   ├── sms-commands.ts     # SMS read / OTP polling via content provider
│   │   ├── notifications-commands.ts # Notification capture via companion app
│   │   └── enterprise-wifi.ts  # 802.1X enterprise WiFi
│   └── network/
│       └── network-check.ts    # Network diagnostics
├── companion-app/              # Android companion app for 802.1X
│   ├── app/src/main/kotlin/    # Kotlin source files
│   └── build.gradle.kts        # Gradle build config
├── docs/
│   └── integrations/           # Notes on composing with mobile-mcp / playwright-android
├── cicd/
│   ├── tests/                  # YAML-driven test framework (see Testing)
│   │   ├── src/
│   │   │   ├── cli.ts
│   │   │   ├── executor.ts     # per-test snapshot/restore of device state
│   │   │   ├── device-state.ts # adb-direct snapshot/restore helpers
│   │   │   ├── mcp-client.ts   # HTTP MCP client (spawns server, waits for ready, calls)
│   │   │   ├── loader.ts, judge/, reporter/, types.ts, config.ts
│   │   │   └── ...
│   │   ├── testcases/<suite>/  # smoke, sms, notifications, proxy (wifi/enterprise/portal pending)
│   │   └── fixtures/           # mock-mcp-upstream.mjs (used by TC-PROXY-001)
│   └── results/                # JSON per-run results
├── .github/workflows/          # build.yml, test-run.yml, test-{smoke,sms,notifications,proxy}.yml, ci.yml
├── .claude/skills/             # ci-testcase, ci-run
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```

## License

MIT
