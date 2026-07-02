/**
 * ChatBackend — the vendor-neutral seam for the model-under-test.
 *
 * The MCP host loop (host.ts) drives a model through a real tool server but knows
 * NOTHING about which model runtime it's talking to: it only calls `ChatBackend.chat()`.
 * Every runtime-specific detail (HTTP endpoint, wire shapes, the "can't do tools"
 * signal, arg coercion, token-eviction) lives in a backend under `backends/`.
 *
 * To target another runtime: implement `ChatBackend` in `backends/<vendor>.ts` and
 * add one `case` to `backends/index.ts`. Do NOT edit host.ts. The reference backend
 * is `backends/ollama.ts`.
 *
 * Message shape note: messages use the OpenAI/Ollama-style convention (a `tool_calls`
 * array of `{ function: { name, arguments } }` on an assistant turn; a tool result as
 * `{ role:'tool', content, tool_name }`). The host echoes these verbatim; a backend
 * whose runtime differs translates them internally inside `chat()`.
 */

/** A tool offered to the model, in the OpenAI/Ollama "function" shape. */
export interface ChatTool {
  type: 'function';
  function: { name: string; description: string; parameters: unknown };
}

/** A tool call as it appears on an assistant message (wire shape, echoed verbatim). */
export interface ChatToolCallWire {
  function: { name: string; arguments: unknown };
}

/** One conversation turn. `tool_calls` rides an assistant turn; `tool_name` a tool result. */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ChatToolCallWire[];
  tool_name?: string;
}

/** One round's request: the conversation so far + the tool menu + decode options. */
export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools: ChatTool[];
  numCtx: number;
  timeoutMs: number;
}

/** A tool call normalized for the host: bare name + an args object (never a JSON string). */
export interface ChatToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/** Per-round generation perf, named neutrally. Durations stay in nanoseconds so the
 *  host's existing rounding/throughput math is unchanged. */
export interface ChatMetrics {
  inTokens: number;
  outTokens: number;
  totalDurationNs: number;
  evalDurationNs: number;
}

/** One round's reply, normalized away from any vendor's wire shape. */
export interface ChatResponse {
  content: string;
  /** Normalized tool calls for the host to execute + record. Empty ⇒ final answer. */
  toolCalls: ChatToolCall[];
  /** The assistant turn to echo back into the history before tool results (when toolCalls
   *  is non-empty). The host pushes it verbatim; backends shape it for their runtime. */
  assistantMessage?: ChatMessage;
  /** The runtime signalled the model/template cannot do tools → a clean capability verdict. */
  toolsUnsupported?: boolean;
  /** A backend-level error string. The host returns a trajectory carrying it, never throws. */
  error?: string;
  metrics: ChatMetrics;
}

/** THE SEAM. The host loop calls only this; nothing else knows the runtime. */
export interface ChatBackend {
  /** Human label for reports (e.g. 'ollama'). */
  readonly name: string;
  chat(req: ChatRequest): Promise<ChatResponse>;
  /** Optional: release model resources between models (e.g. Ollama keep_alive:0). */
  unload?(model: string): Promise<void>;
}
