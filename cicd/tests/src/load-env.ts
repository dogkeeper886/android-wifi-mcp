/**
 * Load the repo-root `.env` into process.env before anything reads it.
 *
 * Import this FIRST in the CLI entrypoint — ESM evaluates imports in source
 * order, so config.js (which builds CONFIG from process.env at import time) and
 * every {{TEST_SSID_*}} / TEST_DEVICE_SERIAL / DATABASE_URL lookup then see the
 * persisted fixtures. Uses the same root `.env` the MCP server loads, so the
 * harness and the server share one source of truth. dotenv does not override
 * vars already set in the environment (e.g. a self-hosted runner's secrets win).
 */
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
// cicd/tests/src -> repo root is three levels up.
config({ path: path.resolve(here, '..', '..', '..', '.env') });
