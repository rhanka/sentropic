/**
 * Local-tool protocol types — host-agnostic.
 *
 * These mirror the wire contract used by the chat runtime
 * (`localToolDefinitions` advertised to the model → `tool_call` emitted by the
 * model → `tool-results` posted back by the client). The actual execution is
 * supplied per host (Chrome DOM tools, Cowork desktop eyes/hands, etc.).
 *
 * Shapes are aligned with `@sentropic/chat-core` (`LocalToolDefinitionInput`)
 * and the chat-ui pending-call normalization so the bridge introduces no new
 * protocol surface.
 */

/**
 * A local tool advertised to the model in a chat request. `parameters` is a
 * JSON-Schema object describing the tool arguments.
 */
export type ToolDefinition = {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
};

/**
 * A tool invocation emitted by the model and dispatched to the host executor.
 * `arguments` is the parsed argument object (already JSON-decoded from the
 * raw `argsText` carried on the stream).
 */
export type ToolCall = {
    /** Stable id correlating the call with its result (`callId` on the wire). */
    toolCallId: string;
    name: string;
    arguments: Record<string, unknown>;
};

/**
 * The outcome of executing a {@link ToolCall}, posted back via
 * `POST /chat/messages/:id/tool-results`. `output` is the serialized tool
 * result string fed back to the model.
 */
export type ToolResult = {
    toolCallId: string;
    name: string;
    output: string;
    error?: string;
};

/**
 * Per-host execution context passed to every {@link ToolExecutor}. The base is
 * empty; hosts extend it (e.g. the Chrome extension adds `senderTabId` /
 * `senderWindowId`, the desktop binary adds screen/display handles).
 */
export type ToolExecutionContext = Record<string, unknown>;

/**
 * A host-provided tool implementation. Receives the parsed argument object and
 * the host context, returns an arbitrary serializable result (the host wraps it
 * into a {@link ToolResult}).
 */
export type ToolExecutor<Context extends ToolExecutionContext = ToolExecutionContext> = (
    args: Record<string, unknown>,
    context: Context,
) => Promise<unknown>;
