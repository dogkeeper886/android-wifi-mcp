# UiAutomator dump retry loop

## What

`adb shell uiautomator dump` occasionally fails with the message:

```
ERROR: null root node returned by UiTestAutomationBridge.
```

This happens when the system UI is mid-transition or the accessibility service hasn't latched onto the active window yet. The fix is to retry — usually one more attempt is enough, occasionally two or three.

## Where this came from

Previously, this project shipped a `device_ui_dump` tool that called `uiautomator dump` once and returned whatever it got. That tool was removed in the [option-A trim](https://github.com/dogkeeper886/android-wifi-mcp/issues/20) — generic UI automation now belongs to [`mobile-next/mobile-mcp`](https://github.com/mobile-next/mobile-mcp), which already implements the retry loop in `src/android.ts:getUiAutomatorDump`.

## The pattern

If you're writing your own UI dump caller (in any language), guard against the null-root error with a bounded retry:

```ts
async function getUiAutomatorXml(adb): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const dump = await adb.shell('exec-out uiautomator dump /dev/tty');
    if (dump.includes('null root node returned by UiTestAutomationBridge')) {
      continue;
    }
    return dump.substring(dump.indexOf('<?xml'));
  }
  throw new Error('Failed to get UIAutomator XML after 10 attempts');
}
```

mobile-mcp uses 10 retries with no delay — the operation is cheap enough (single ADB roundtrip) that a tight loop is fine.

## When you'll see this

- Right after launching an app (window not yet stable)
- During an Activity transition
- When the device just woke from sleep
- On older Android versions (more frequent)

## Why we documented it instead of keeping the tool

Per #20: this project's surface is intentionally narrow (ADB-level control plane for QA flows). Adding our own retry-aware UI dump would either reinvent UiAutomator instrumentation poorly or pull in a heavy dependency. mobile-mcp does this well, so we defer to them and capture the gotcha here for anyone touching `uiautomator dump` directly.
