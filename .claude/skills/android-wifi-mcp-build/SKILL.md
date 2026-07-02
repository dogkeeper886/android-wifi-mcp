---
name: android-wifi-mcp-build
description: |
  Build the android-wifi-mcp project. Use when the user asks to build the code,
  compile, or produce a fresh server bundle and/or companion APK. "Build" means
  BOTH the Node MCP server and the Kotlin companion app unless the user narrows it.
---

# Build android-wifi-mcp

The repo has **two** build targets. A bare "build" means both.

| Command | Builds | Needs |
|---|---|---|
| `make build` | server + companion APK | Node + Android SDK/JDK |
| `make build-server` | Node MCP server (`tsc` → `dist/`) | Node |
| `make build-app` | Kotlin companion APK | Android SDK/JDK |

`make build` = `build-server` + `build-app`. The server-only workflows (`make
test`, `make serve-all`, `make setup`) depend on `build-server`, so they never
pull in the Android SDK — only a user-facing `make build` builds the APK.

## Steps

1. **Pick scope.** If the user said plain "build", run `make build`. If they
   named the server or the phone app, run `make build-server` or `make build-app`.
2. **Run it** from the repo root.
3. **Report the outputs:**
   - Server: `dist/index.js`
   - APK: `companion-app/app/build/outputs/apk/debug/app-debug.apk`
4. **Don't auto-restart or reinstall.** Rebuilding the server does not restart
   the running service; rebuilding the APK does not reinstall it on the phone.
   If the user wants the change live, offer:
   - Server: `make serve-restart` (stops `:3000`, starts fresh)
   - APK: `adb install -r companion-app/app/build/outputs/apk/debug/app-debug.apk`
     (confirm the target device first with `adb devices`).

## Notes

- The `certs/` directory holds real private keys and is gitignored — it is test
  material, not a build input.
- CI builds the server with `npm run build` directly (not `make`), so the
  Makefile's build wiring does not affect CI.
