# Driving the device's browser via Chrome DevTools Protocol (Canary CDP)

This is the recipe for using `@playwright/mcp` to talk to **the phone's** Chrome browser at the DOM level — captive-portal pages, web admin UIs, anything that needs real selectors instead of pixel coordinates.

The setup is **doc-only**; this MCP server doesn't ship a wrapper for it. Once the bridge is up, register `@playwright/mcp` (pointed at the bridge) alongside `android-wifi-mcp` and `mobile-next/mobile-mcp`, and the assistant orchestrates the three.

## Why Chrome Canary, not stable Chrome

On most Samsung and many other OEM devices, **stable Chrome's DevTools socket is locked down** — you can `adb forward` to it but `/json/version` returns nothing usable, and CDP attach fails. Chrome Canary on the device serves the standard endpoint out of the box, no flags or root needed.

Same applies to Chromium beta and dev channels — Canary is the most widely available channel that ships unmodified, so it's the safest default.

## Register the three MCP servers with Claude Code

The phone-side QA story uses three cooperating MCP servers, each owning a different layer:

| Server | What it owns | How it's invoked |
|---|---|---|
| **`android-wifi`** (this project) | WiFi join, network probing, OTP capture, settings, file staging | local `node dist/index.js --stdio` |
| **`mobile-next`** ([mobile-mcp](https://github.com/mobile-next/mobile-mcp)) | OS UI driving (Settings, system dialogs, third-party apps) via the accessibility tree | `npx -y @mobilenext/mobile-mcp@latest` |
| **`playwright-android`** | Browser DOM on the **device** (captive portals, web admin UIs) — this is `@playwright/mcp` pointed at the CDP bridge below | `npx -y @playwright/mcp@latest --cdp-endpoint http://localhost:9222` |

> Note: `playwright-android` **is not a separate package** — it's the standard `@playwright/mcp` started with `--cdp-endpoint http://localhost:9222`, which makes it attach to whatever Chrome instance the bridge is forwarding (Canary on the device, here). If you also use `@playwright/mcp` for host-side Chromium, register it twice with different names.

Register all three:

```bash
# This project — adjust the path to your dist/
claude mcp add android-wifi -- node /path/to/android-wifi-mcp/dist/index.js --stdio

# mobile-mcp for OS UI work
claude mcp add mobile-next -- npx -y @mobilenext/mobile-mcp@latest

# playwright-mcp pointed at the CDP bridge (set up in the next sections)
claude mcp add playwright-android -- npx -y @playwright/mcp@latest --cdp-endpoint http://localhost:9222
```

`claude mcp list` confirms all three are connected. `playwright-android` will report `Connected` even before the bridge is up — it lazy-connects to the CDP endpoint when a `browser_*` tool is called, so don't be misled by its startup status.

## One-time device setup

1. Install **Chrome Canary** from Play Store: `com.chrome.canary`.
2. Open Canary at least once and dismiss the welcome screens. The DevTools socket is exposed automatically once the app has run; no developer-options toggle required.
3. USB debugging stays enabled as for any other ADB-driven workflow.

That's it — nothing persistent on the host side beyond the MCP registrations above.

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

1. After joining an open SSID (e.g. via this project's `wifi_connect`), Android's `CaptiveLoginActivity` automatically posts a *"Sign in to Wi-Fi network"* notification.
2. Open the notification shade and tap the notification. With `mobile-next`: `mobile_swipe_on_screen` down from the top to expand the shade, then `mobile_list_elements_on_screen` to locate the *"Sign in to Wi-Fi network"* row, then `mobile_click_on_screen_at_coordinates` on its bounds. Chrome opens the portal in a new tab, with the cert exception pre-accepted.
3. From the host, list pages: `curl http://localhost:9222/json` — the new portal tab shows up with a `webSocketDebuggerUrl`.
4. From `playwright-android`, use `browser_snapshot` / `browser_click` / etc. — they attach to the existing page rather than navigating into it.

This sidesteps the strict-cert path entirely. The trade-off is that you depend on Android's captive-portal detection firing — which it normally does within a few seconds of joining the SSID.

## End-to-end orchestration example

With all three MCPs registered and the bridge up, a captive-portal verification flow looks like:

| Step | MCP | Tool |
|---|---|---|
| 1. Join the open SSID | `android-wifi` | `wifi_connect` (security: `open`) |
| 2. Confirm the captive portal | `android-wifi` | `network_check_captive` |
| 3. Tap the captive-portal notification | `mobile-next` | `mobile_list_elements_on_screen` → `mobile_click_on_screen_at_coordinates` |
| 4. Drive the portal page (e.g. "Connect with WhatsApp") | `playwright-android` | `browser_snapshot` → `browser_click` |
| 5. Wait for OTP | `android-wifi` | `notifications_wait_for_otp` |
| 6. Enter OTP back into the portal | `playwright-android` | `browser_type` |
| 7. Verify connectivity | `android-wifi` | `network_check_internet` |

Claude orchestrates the seven steps. No code on your side beyond registering the three servers and running `adb forward` once per session.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `curl http://localhost:9222/json/version` returns nothing | Canary not running, or wrong app | Foreground Canary on the device; verify it's `com.chrome.canary` not stable Chrome (`com.android.chrome`) |
| `adb forward` succeeds but the curl hangs | Stable Chrome was forwarded by accident | The socket name `localabstract:chrome_devtools_remote` is shared — only one Chrome variant should be in foreground. Force-stop the others |
| `playwright-android` reports `Connected` in `claude mcp list` but `browser_snapshot` fails | Bridge or Canary not up at call time | The MCP server is connected; the CDP endpoint isn't. Run the `adb forward` command and foreground Canary, then retry the tool call |
| Captive-portal page is blank when attached | Navigated into a strict-cert URL | Don't navigate — attach to the page Android opened via the captive-portal notification |

## What this MCP server does and does not do here

- **Does**: drives the WiFi join (`wifi_connect`), detects the captive portal (`network_check_captive`), pulls / pushes files (`device_push_file` / `device_pull_file`), captures OTPs from notifications.
- **Does not**: ship a `device_open_canary_cdp` or `device_attach_browser` tool. The bridge is one `adb forward` line that the user sets up once per session — adding a tool around it would be more state to manage than it's worth.

## See also

- [`uiautomator-retry.md`](./uiautomator-retry.md) — the reverse case (mobile-mcp's UI-tree path), for screens that aren't a browser.
- [`Genymobile/scrcpy`](https://github.com/Genymobile/scrcpy) — for visual mirroring while you debug a CDP session.
