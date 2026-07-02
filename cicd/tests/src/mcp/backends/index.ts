/**
 * Backend factory — resolves a ChatBackend by name (config-selected).
 * Adding a runtime = a new backends/<vendor>.ts + one case here. host.ts never changes.
 */
import type { ChatBackend } from '../chat-backend.js';
import { OllamaBackend } from './ollama.js';

export function makeBackend(name: string, opts: { host: string }): ChatBackend {
  switch (name) {
    case 'ollama':
      return new OllamaBackend(opts.host);
    default:
      throw new Error(`unknown chat backend "${name}" (built-in: ollama)`);
  }
}
