#!/usr/bin/env npx tsx
/**
 * Small device CLI for a case's `setup`/`teardown` steps. Those steps are shell
 * commands, so they can't call device-state helpers directly — this exposes them.
 *
 *   npx tsx cicd/tests/src/device-cli.ts clear-networks [--all] [SSID ...]
 *
 * `clear-networks` forgets saved networks. With SSIDs it forgets only those (safe on a
 * shared phone); with `--all` it wipes every saved network but requires
 * TEST_DEVICE_SERIAL's phone to be declared dedicated (TEST_DEDICATED_DEVICE=true).
 */
import { clearSavedNetworks } from './device-state.js';

const [command, ...rest] = process.argv.slice(2);

if (command === 'clear-networks') {
  const all = rest.includes('--all');
  const ssids = rest.filter((a) => !a.startsWith('--'));
  const n = await clearSavedNetworks({ all, ssids });
  const what = all ? 'all' : ssids.length ? `matching: ${ssids.join(', ')}` : 'none listed';
  console.log(`cleared ${n} saved network(s) (${what})`);
} else {
  console.error(
    `Unknown command: ${command || '(none)'}\nUsage: device-cli.ts clear-networks [--all] [SSID ...]`
  );
  process.exit(1);
}
