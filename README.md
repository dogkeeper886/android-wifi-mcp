# android-wifi-mcp

> Drive a USB-connected Android phone's **WiFi, network, OTPs, and UI** from any MCP client — locally, or from another machine across the network.

[![build](https://github.com/dogkeeper886/android-wifi-mcp/actions/workflows/build.yml/badge.svg)](https://github.com/dogkeeper886/android-wifi-mcp/actions/workflows/build.yml)
![node](https://img.shields.io/badge/node-%E2%89%A518-3c873a)
![license](https://img.shields.io/badge/license-MIT-blue)

An [MCP](https://modelcontextprotocol.io) server that turns a phone wired to a host into a programmable device. It speaks `adb` to one selected Android device and exposes **32 tools** over Streamable HTTP — scan/connect WiFi (incl. 802.1X enterprise), run network diagnostics, capture SMS/notification OTPs, read/write settings, push/pull files. Point Claude (or any MCP client) at it and automate phone QA: join a captive-portal network, wait for the OTP, drive the page, tap the dialog.

It also serves the **whole QA stack to a remote machine** — with one command the host publishes android-wifi *plus* the device browser *plus* on-device UI, so a tester whose laptop isn't wired to the phone can still run end-to-end flows against it.

## How it works

One phone is wired to one host. The **android-wifi** server runs next to it and talks `adb`; everything else is about *who can reach those tools* and *what else rides alongside*.

![Architecture: MCP clients reach the USB host's android-wifi (:3000, with mobile-next proxied in) and android-playwright (:8931), which drive the one Android phone over adb and CDP.](docs/images/architecture.png)

- **android-wifi** — the core server: HTTP-only ([Streamable HTTP](https://modelcontextprotocol.io)) on `:3000`, one selected device at a time (with multi-device selection), all `adb` via `execFile` so credentials can't be shell-injected.
- **No built-in auth** — both HTTP endpoints bind `0.0.0.0`; the control is the **network boundary** ([by design](#security)).

Two ideas make the stack more than a single server — each gets its own picture below: **[one tool surface](#the-tools)** (how other MCP servers fold in) and the **[end-to-end remote flow](#remote-access-make-serve-all)** (how a remote machine drives all of it).

> Diagram sources live in [`docs/images/`](docs/images/) (`*.svg`) — regenerate the PNGs with `make readme-diagram`.

## Quickstart (local, ~30 seconds)

```bash
npm install && npm run build
make doctor          # preflight: node, adb, device, build
# plug in the phone · enable USB debugging · tap "Allow" on the RSA prompt
make serve           # android-wifi on http://localhost:3000  (GET /health, POST /mcp)
```

Register it with Claude Code — the bundled shim bridges stdio ↔ HTTP, since Claude Code's HTTP client can't speak Streamable HTTP directly ([#7](https://github.com/dogkeeper886/android-wifi-mcp/issues/7)):

```bash
claude mcp add --transport stdio android-wifi -- node bin/android-wifi-shim.mjs http://localhost:3000/mcp
```

Now ask: *"list devices, scan WiFi, connect to `<ssid>`."* On Linux without root-level adb access, run `make udev` once.

> **Requires** Node ≥ 18, `adb`, and an **Android 11+** device (the `cmd wifi` interface). The browser tools attach to **Chrome Canary** on the device — stable Chrome's DevTools socket is locked on many OEM builds ([why](docs/integrations/canary-cdp.md)).

## The tools

android-wifi registers **32 native tools**. Beyond those, its **upstream proxy** spawns *other* MCP servers as stdio children and merges their tools into one list — so a client connects to android-wifi alone and gets WiFi/device **+** browser **+** on-device UI together:

![One tool surface: android-wifi native (32) plus @playwright/mcp (~21 browser_*) and mobile-next (~23 mobile_*) stdio upstreams merge through the upstream proxy into one tools/list on :3000.](docs/images/tool-surface.png)

| Group | Tools |
|-------|-------|
| **Device** | `device_list` · `device_select` · `device_info` · `device_event_log` · `device_screenshot` · `query_log` |
| **WiFi** | `wifi_scan` · `wifi_connect` · `wifi_disconnect` · `wifi_status` · `wifi_enable` · `wifi_disable` · `wifi_list_networks` · `wifi_forget` |
| **Enterprise 802.1X** | `wifi_connect_enterprise` · `wifi_install_certificate` · `wifi_check_companion_app` |
| **Network diagnostics** | `network_ping` · `network_dns_lookup` · `network_check_internet` · `network_check_captive` · `network_interface_info` |
| **SMS / OTP** | `sms_read_recent` · `sms_wait_for_otp` |
| **Notification OTP** | `notifications_list_recent` · `notifications_wait_for_otp` |
| **Settings & files** | `device_settings_get` · `device_settings_put` · `device_settings_delete` · `device_push_file` · `device_pull_file` |
| **Proxy** | `proxy_restart` |

Modern Android ships no `curl`/`nslookup`, so network checks read `dumpsys connectivity` and `ping` (captive-portal verdict, `VALIDATED` state, interface/route info). Colliding upstream tool names are prefixed `<upstream>__`.

## Remote access (`make serve-all`)

To drive the **full** stack from another machine, serve it on the host where the phone is — then one remote agent runs an end-to-end flow against the one phone:

![End-to-end remote QA flow: a remote client calls wifi_connect (android-wifi :3000), browser_navigate (android-playwright :8931), then a mobile tap (mobile_* via :3000) — each step landing on the same USB phone.](docs/images/remote-flow.png)

```bash
make serve-all        # android-wifi :3000 (+ mobile-next proxied in), android-playwright :8931, + CDP bridge
make serve-all-stop   # tear it all down
```

The remote client registers **two** HTTP endpoints — copy [`.mcp.example`](.mcp.example) and substitute the host IP. Both speak Streamable HTTP, bridged codelessly with [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) (`--allow-http` is required for a plain-HTTP LAN URL):

```jsonc
"android-wifi":       { "command": "npx", "args": ["-y","mcp-remote","http://<HOST_IP>:3000/mcp","--allow-http"] },
"android-playwright": { "command": "npx", "args": ["-y","mcp-remote","http://<HOST_IP>:8931/mcp","--allow-http"] }
```

**mobile-next isn't a third port.** It's single-session SSE over the network ([#102](https://github.com/dogkeeper886/android-wifi-mcp/issues/102)), so `serve-all` runs it as a **stdio upstream of android-wifi** — its `mobile_*` tools ride android-wifi's multi-session `:3000`. (For a single-client local run, [`.mcp.json`](.mcp.json) registers all three as separate stdio servers instead.)

### Security

The bundle is **unauthenticated by design** — reachability alone grants full phone control (WiFi, OTPs, screenshots, browser, UI). That's acceptable for a **lab QA tool on a trusted network**; bolting bespoke auth onto heterogeneous servers buys less than network isolation. Keep the host on a trusted LAN, open `:3000`/`:8931` only to known source IPs (or put it behind a VPN/Tailscale), and never expose the ports to the public internet.

## Enterprise WiFi & notification OTPs (companion app)

`cmd wifi` can't do 802.1X, and the shell user can't read most notifications — so a small **companion app** (`com.example.wifimcpcompanion`, Kotlin) bridges those via Android's native APIs. Build and install it once:

```bash
cd companion-app && ./gradlew assembleDebug
adb install app/build/outputs/apk/debug/app-debug.apk
# open the app once; for notification OTPs, tap "Grant Notification Access"
```

Then `wifi_connect_enterprise` (PEAP/TTLS/TLS), `wifi_install_certificate`, and `notifications_wait_for_otp` work; `wifi_check_companion_app` reports install + grant status. SMS OTPs (`sms_*`) need no app, but `content://sms/inbox` is locked down on some Samsung/OEM builds — fall back to notification capture there.

## Structured logging (optional, Postgres)

Set `DATABASE_URL` and every tool call + device event is recorded — with W3C trace context, failure attribution against device attach/detach events, and secret redaction. Unset, the server runs unchanged with no Postgres.

```bash
make up && make migrate     # Postgres in Docker + schema (tool_calls, device_events, sessions)
DATABASE_URL=postgres://mcp:mcp@localhost:5433/android_wifi_mcp npm start
make psql                   # inspect — or use the query_log tool
```

## Configuration

| Env | Default | Purpose |
|-----|---------|---------|
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Server bind |
| `ADB_PATH` | `adb` | Path to the adb binary |
| `UPSTREAM_MCP` | — | Spawn upstream MCP servers: `name=command [args…]` (`;`-separated) or a JSON array |
| `PLAYWRIGHT_HEADED` | — | `1` runs the Playwright upstream visibly (strips `--headless`) |
| `DATABASE_URL` | — | Enables Postgres logging when set |
| `LOG_LEVEL` / `LOG_DEST` | `info` / `stderr` | pino logging |

`serve-all` ports (`PORT`, `PW_PORT`, `CDP_PORT`) are overridable on the `make` line. See [`.env.example`](.env.example).

## Documentation

- [`docs/integrations/canary-cdp.md`](docs/integrations/canary-cdp.md) — driving the device browser via Chrome Canary + CDP
- [`docs/stories/`](docs/stories/) — user stories (the *need* behind features)
- [`docs/tests/`](docs/tests/) — acceptance test scenarios (TS-01…07)
- [`docs/integrations/uiautomator-retry.md`](docs/integrations/uiautomator-retry.md) — UI-dump null-root retry reference

## Development

```bash
make build        # tsc → dist/
make test-unit    # fast unit tests
make test         # full suite
make readme-diagram   # re-render every diagram PNG from its SVG source
make help         # all targets
```

`cicd/tests/` holds a YAML-driven, device-aware test harness (smoke, sms, notifications, proxy suites) that snapshots and restores WiFi state around each run. CI lives in [`.github/workflows/`](.github/workflows/).

## License

MIT.
