# Driving the device's browser via Chrome DevTools Protocol (Canary CDP)

This is the recipe for using `playwright-android` to talk to **the phone's** Chrome browser at the DOM level — captive-portal pages, web admin UIs, anything that needs real selectors instead of pixel coordinates.

The setup is **doc-only**; this MCP server doesn't ship a wrapper for it. Once the bridge is up, register `playwright-android` (or any CDP client) alongside `android-wifi-mcp` and the assistant can use both.

## Why Chrome Canary, not stable Chrome

On most Samsung and many other OEM devices, **stable Chrome's DevTools socket is locked down** — you can `adb forward` to it but `/json/version` returns nothing usable, and CDP attach fails. Chrome Canary on the device serves the standard endpoint out of the box, no flags or root needed.

Same applies to Chromium beta and dev channels — Canary is the most widely available channel that ships unmodified, so it's the safest default.

## One-time device setup

1. Install **Chrome Canary** from Play Store: `com.chrome.canary`.
2. Open Canary at least once and dismiss the welcome screens. The DevTools socket is exposed automatically once the app has run; no developer-options toggle required.
3. USB debugging stays enabled as for any other ADB-driven workflow.

That's it — nothing persistent on the host side.

## Per-session bridge

Three commands every time the device reconnects:

```bash
# Forward the host's localhost:9222 to the device's Chrome DevTools UNIX socket
adb forward tcp:9222 localabstract:chrome_devtools_remote

# Verify the bridge is alive (returns Chrome version + WebKit version JSON)
curl -s http://localhost:9222/json/version

# List the open tabs / pages — each entry has a webSocketDebuggerUrl
curl -s http://localhost:9222/json
```

If `/json/version` is empty or returns an HTML error, Canary isn't running on the device. Open it (just bring it to foreground; no specific URL needed) and retry.

To tear down: `adb forward --remove tcp:9222`.

## Captive-portal cert workaround

Captive portals typically present a self-signed cert on a private FQDN (or IP). Strict CDP navigation (`Page.navigate` with `waitUntil: 'load'`) will fail when the browser blocks the cert error.

The practical bypass: **don't navigate into the portal — let Android open it for you**.

1. After joining an open SSID, Android's `CaptiveLoginActivity` automatically posts a *"Sign in to Wi-Fi network"* notification.
2. Tap that notification (or send `mobile_press_button` "BACK"-then-tap via mobile-mcp). Chrome opens the portal in a new tab, with the cert exception pre-accepted.
3. From the host, list pages: `curl http://localhost:9222/json` — the new portal tab shows up with a `webSocketDebuggerUrl`.
4. Attach `playwright-android` to that existing page rather than navigating into it.

This sidesteps the strict-cert path entirely. The trade-off is that you depend on Android's captive-portal detection firing — which it normally does within a few seconds of joining the SSID.

## Attaching playwright-android

With the bridge up and pages listed, point a CDP client at `http://localhost:9222`:

```js
// playwright (host-Chromium) connects to a remote CDP endpoint
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const contexts = browser.contexts();
const page = contexts[0].pages()[0];   // or pick by url

await page.click('button:has-text("Connect with WhatsApp")');
```

For MCP composition, register `playwright-android` (the MCP wrapper for the same protocol) alongside this server:

```bash
claude mcp add --transport stdio android-wifi node /path/to/dist/index.js --stdio
claude mcp add --transport stdio playwright-android <playwright-android-server-cmd>
```

Claude then orchestrates: `wifi_connect` (this server) → notification arrives → tap into portal → `browser_*` tools (playwright-android) interact with the DOM → `network_check_internet` (this server) verifies the connection.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `curl http://localhost:9222/json/version` returns nothing | Canary not running, or wrong app | Foreground Canary on the device; verify it's `com.chrome.canary` not stable Chrome (`com.android.chrome`) |
| `adb forward` succeeds but the curl hangs | Stable Chrome was forwarded by accident | The socket name `localabstract:chrome_devtools_remote` is shared — only one Chrome variant should be in foreground. Force-stop the others |
| `connectOverCDP` succeeds but `pages()` is empty | No tabs open | Open at least one tab in Canary, even `chrome://newtab` |
| Captive-portal page is blank when attached | Navigated into a strict-cert URL | Don't navigate — attach to the page Android opened via the captive-portal notification |

## What this MCP server does and does not do here

- **Does**: drives the WiFi join (`wifi_connect`), detects the captive portal (`network_check_captive`), pulls / pushes files (`device_push_file` / `device_pull_file`), captures OTPs from notifications.
- **Does not**: ship a `device_open_canary_cdp` or `device_attach_browser` tool. The bridge is one `adb forward` line that the user sets up once per session — adding a tool around it would be more state to manage than it's worth.

## See also

- [`uiautomator-retry.md`](./uiautomator-retry.md) — the reverse case (mobile-mcp's UI-tree path), for screens that aren't a browser.
- [`Genymobile/scrcpy`](https://github.com/Genymobile/scrcpy) — for visual mirroring while you debug a CDP session.
