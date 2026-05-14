/**
 * Per SPEC §1 (chat-core boundary) + §5 (Ports list) — MeshDispatchPort.
 *
 * Isolates the mesh-backed model invocation surface from `chat-core`
 * orchestration logic so the runtime never imports `@sentropic/llm-mesh`,
 * `api/src/services/llm-runtime`, or any provider adapter directly. Mirrors
 * the isolation pattern established in `./checkpoint-port.ts` (Lot 4),
 * `./message-port.ts` (Lot 6), `./stream-port.ts` (Lot 7), and
 * `./session-port.ts` (Lot 8): the surface stays contracts-free so the api
 * workspace can consume it via relative path without pulling the full
 * @sentropic/contracts + @sentropic/events graph.
 *
 * BR14b Lot 10 — first concrete shape of the mesh boundary. The fields
 * intentionally mirror the existing `callLLM` / `callLLMStream` option
 * surfaces in `api/src/services/llm-runtime/index.ts` so the concrete
 * `MeshDispatchAdapter` in `api/src/services/chat/mesh-dispatch-adapter.ts`
 * is a thin delegating wrapper (no transformation). Payload-typed fields
 * (`messages`, `tools`, `rawInput`, `structuredOutput`, `raw`) stay
 * `unknown` / `ReadonlyArray<unknown>` because chat-core treats them as
 * opaque vendor shapes that round-trip through the mesh; refining to
 * provider-neutral schemas is deferred to BR14c-style work.
 *
 * Streaming event taxonomy mirrors the existing `StreamEventType` union
 * (`reasoning_delta | content_delta | tool_call_start | tool_call_delta
 * | tool_call_result | status | error | done`) used by `callLLMStream`.
 */

export type MeshStreamEventType =
  | 'reasoning_delta'
  | 'content_delta'
  | 'tool_call_start'
  | 'tool_call_delta'
  | 'tool_call_result'
  | 'status'
  | 'error'
  | 'done';

export type MeshUsage = {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
};

export type MeshStructuredOutput = {
  readonly name: string;
  readonly schema: Record<string, unknown>;
  readonly description?: string;
  readonly strict?: boolean;
};

/**
 * Non-streaming invocation options. Mirror of `CallLLMOptions` in
 * `api/src/services/llm-runtime/index.ts`. `messages` and `tools` stay
 * opaque (`ReadonlyArray<unknown>`) — chat-core forwards vendor-shaped
 * payloads to the adapter as-is.
 */
export type MeshInvokeRequest = {
  readonly messages: ReadonlyArray<unknown>;
  readonly providerId?: string;
  readonly model?: string;
  readonly credential?: string;
  readonly userId?: string;
  readonly workspaceId?: string;
  readonly tools?: ReadonlyArray<unknown>;
  readonly toolChoice?: 'auto' | 'required' | 'none';
  readonly responseFormat?: 'json_object';
  readonly maxOutputTokens?: number;
  readonly signal?: AbortSignal;
};

/**
 * Non-streaming response. `raw` carries the provider-native shape (e.g.
 * `OpenAI.Chat.Completions.ChatCompletion`) that callers in chat-service
 * already destructure today — kept as `unknown` to preserve adapter
 * opacity, downstream code keeps its narrow types via local casts.
 */
export type MeshInvokeResponse = {
  readonly raw: unknown;
};

/**
 * Streaming invocation options. Mirror of `CallLLMStreamOptions` in
 * `api/src/services/llm-runtime/index.ts`. Adds `previousResponseId`,
 * `rawInput`, `structuredOutput`, `reasoningEffort`, `reasoningSummary`
 * — the exact set the existing chat-service.ts call-sites rely on for
 * continuation, structured output, and provider reasoning controls.
 */
export type MeshStreamRequest = {
  readonly messages: ReadonlyArray<unknown>;
  readonly providerId?: string;
  readonly model?: string;
  readonly credential?: string;
  readonly userId?: string;
  readonly workspaceId?: string;
  readonly reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh';
  readonly reasoningSummary?: 'auto' | 'concise' | 'detailed';
  readonly tools?: ReadonlyArray<unknown>;
  readonly previousResponseId?: string;
  readonly rawInput?: ReadonlyArray<unknown>;
  readonly responseFormat?: 'json_object';
  readonly structuredOutput?: MeshStructuredOutput;
  readonly toolChoice?: 'auto' | 'required' | 'none';
  readonly maxOutputTokens?: number;
  readonly signal?: AbortSignal;
};

/**
 * Streaming event. Mirrors the wire `StreamEvent` shape produced by
 * `callLLMStream`. `data` stays `unknown` — chat-service narrows per
 * event type at the call site (`asRecord` / shape checks).
 */
export type MeshStreamEvent = {
  readonly type: MeshStreamEventType;
  readonly data: unknown;
};

/**
 * MeshDispatchPort — contracts-free surface for mesh-backed model
 * invocation. `invoke` produces a single response; `invokeStream` yields
 * a normalized async stream of mesh events. Adapter is a thin wrapper
 * around `callLLM` / `callLLMStream` in BR14b Lot 10; subsequent lots
 * may refine signatures as the reasoning/tool loops migrate into
 * `ChatRuntime`.
 */
export interface MeshDispatchPort {
  invoke(request: MeshInvokeRequest): Promise<MeshInvokeResponse>;
  invokeStream(request: MeshStreamRequest): AsyncIterable<MeshStreamEvent>;
}
