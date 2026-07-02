/**
 * Ollama reference backend — the ONLY vendor-coupled module in the MCP path.
 *
 * Implements ChatBackend over Ollama's /api/chat. Everything Ollama-specific lives
 * here: the HTTP endpoint, the response shape (message.tool_calls, prompt_eval_count,
 * eval_duration, …), the "does not support tools" signal, the JSON-string arg quirk,
 * and keep_alive:0 eviction. host.ts imports none of this — only the ChatBackend type.
 */
import http from 'node:http';
import https from 'node:https';
import type {
  ChatBackend,
  ChatRequest,
  ChatResponse,
  ChatToolCall,
} from '../chat-backend.js';

/** POST /api/chat over node:http so the per-call timeout is honored end-to-end.
 *  fetch() (undici) imposes its own ~300s headers/body timeout that AbortSignal
 *  can't lift — it silently kills slow generations at 5 min. node:http has no
 *  such cap, so timeoutMs (via AbortSignal) is the only deadline. */
function post(host: string, path: string, body: string, timeoutMs: number): Promise<any> {
  const url = new URL(`${host}${path}`);
  const transport = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(
      url,
      { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        // The response is a separate emitter from req — a reset mid-body (a real risk on a
        // slow/OOMing backend) errors here, not on req. Without this it's an uncaught throw.
        res.on('error', reject);
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch {
            reject(new Error('ollama: invalid JSON response'));
          }
        });
      },
    );
    const signal = AbortSignal.timeout(timeoutMs);
    const onAbort = () => req.destroy(new Error(`ollama request timed out after ${timeoutMs}ms`));
    signal.addEventListener('abort', onAbort, { once: true });
    req.on('close', () => signal.removeEventListener('abort', onAbort));
    req.on('error', reject);
    req.end(body);
  });
}

/** Ollama is documented to return tool-call arguments as an object, but some
 *  model templates emit a JSON string — normalize both to an object. */
function asArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return (raw ?? {}) as Record<string, unknown>;
}

const ZERO_METRICS = { inTokens: 0, outTokens: 0, totalDurationNs: 0, evalDurationNs: 0 };

export class OllamaBackend implements ChatBackend {
  readonly name = 'ollama';
  constructor(private host: string) {}

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const body = JSON.stringify({
      model: req.model,
      messages: req.messages,
      tools: req.tools,
      stream: false,
      options: { temperature: 0, seed: 42, num_ctx: req.numCtx },
    });

    let raw: any;
    try {
      raw = await post(this.host, '/api/chat', body, req.timeoutMs);
    } catch (e) {
      return { content: '', toolCalls: [], error: e instanceof Error ? e.message : String(e), metrics: { ...ZERO_METRICS } };
    }

    if (!raw || typeof raw !== 'object') {
      return { content: '', toolCalls: [], error: 'ollama /api/chat: no/invalid response', metrics: { ...ZERO_METRICS } };
    }
    // Ollama returns {error: "...does not support tools"} when the model's template
    // can't do tool calling — a clean capability verdict, not a crash.
    if (raw.error) {
      const toolsUnsupported = /does not support tools/i.test(String(raw.error));
      return { content: '', toolCalls: [], toolsUnsupported, error: String(raw.error), metrics: { ...ZERO_METRICS } };
    }

    const msg = raw.message ?? {};
    const wireCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    const toolCalls: ChatToolCall[] = wireCalls.map((tc: any) => ({
      name: tc.function?.name ?? '',
      arguments: asArgs(tc.function?.arguments),
    }));

    return {
      content: msg.content ?? '',
      toolCalls,
      assistantMessage: { role: 'assistant', content: msg.content ?? '', tool_calls: wireCalls },
      metrics: {
        inTokens: raw.prompt_eval_count ?? 0,
        outTokens: raw.eval_count ?? 0,
        totalDurationNs: raw.total_duration ?? 0,
        evalDurationNs: raw.eval_duration ?? 0,
      },
    };
  }

  /** Evict a model (keep_alive: 0). Best-effort: a benchmark loops over models
   *  sequentially, so each must be released before the next loads — otherwise the
   *  previous one stays resident and two models contend for the GPU. A failed
   *  unload must never fail the test. */
  async unload(model: string): Promise<void> {
    try {
      await fetch(`${this.host}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, keep_alive: 0 }),
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      /* best-effort */
    }
  }
}
