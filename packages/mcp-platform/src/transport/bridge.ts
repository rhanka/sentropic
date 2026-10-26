/**
 * Shared SDK bridge: serve the compiled plan over the real MCP SDK, using
 * the low-level `Server` so tool arguments arrive raw (the high-level
 * `McpServer` only forwards arguments through a Zod schema, and schemaless
 * handlers receive handler-extra alone — verified by probe). The SDK
 * transports the bytes, the kernel validates the arguments: kernel
 * rejections become wire `isError` results, never wire exceptions; unknown
 * tools are a protocol `MethodNotFound` error. Both transports (Streamable
 * HTTP, stdio) share this registration, so wire bytes are identical.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ErrorCode,
  McpError,
  ToolSchema,
  type Tool,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { encodeToolResult, validateMcpWireResult } from './result-codec.js';
import { registerBridgeKernel, safeMcpProtocolError } from './bridge-kernel.js';
import { assertMcpJson, freezeMcpJson } from './tool-json.js';
import type { CompiledMcpToolSchemas, McpToolDiagnostic, McpToolValidationLimits } from './tool-schemas.js';
import { validateBoundedValue, type JSONValue } from '../registry-parameters.js';
import type { AppToolResult, StpConnectorContext } from '../runtime.js';
import { admitMemorySchema } from '../memory/schema-profile.js';
import { callMemoryBridge } from '../memory/wire-profile.js';
import { isMemoryToolName } from '../memory/contracts.js';

export type { AppToolResult } from '../runtime.js';

export type McpWireFailure =
  | { readonly kind: 'invalid-arguments'; readonly diagnostics: readonly McpToolDiagnostic[] }
  | { readonly kind: 'internal' };
export interface McpWireRunner {
  run(name: string, args: Record<string, unknown>, extra: Readonly<{ signal: AbortSignal }>): Promise<CallToolResult>;
}
export interface McpWireBridgeOptions {
  readonly schemas: CompiledMcpToolSchemas;
  readonly limits: McpToolValidationLimits;
  formatFailure(name: string, failure: McpWireFailure): CallToolResult;
}

/** Explicit native mode: preserve full descriptors/results, never try an application codec. */
export function registerMcpWireTools(
  server: Server, tools: readonly Tool[], runner: McpWireRunner, options: McpWireBridgeOptions,
): void {
  const limits = Object.freeze({ ...options.limits });
  const names = new Set<string>();
  for (const tool of tools) {
    // Descriptor metadata is trusted startup data. Schema budgets apply to
    // inputSchema in the compiler, independently of title/description size.
    assertMcpJson(tool, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
    if (names.has(tool.name) || !ToolSchema.safeParse(tool).success) throw new TypeError('Invalid MCP tool descriptor');
    names.add(tool.name);
  }
  const descriptors = freezeMcpJson(structuredClone(tools));
  const failure = (name: string, reason: McpWireFailure): CallToolResult => {
    try {
      const result = validateMcpWireResult(options.formatFailure(name, reason), limits);
      if (result.isError !== true) throw new TypeError();
      return result;
    } catch {
      return { content: [{ type: 'text', text: 'Tool call failed' }], isError: true };
    }
  };
  registerBridgeKernel(server, {
    tools: descriptors,
    async call(name, args, signal) {
      try {
        const checked = options.schemas.validate(name, args);
        if (!checked.valid) return failure(name, { kind: 'invalid-arguments', diagnostics: checked.diagnostics });
        signal.throwIfAborted();
        const result = await runner.run(name, checked.data, Object.freeze({ signal }));
        signal.throwIfAborted();
        return validateMcpWireResult(result, limits);
      } catch (error) {
        if (error instanceof McpError) throw safeMcpProtocolError(error);
        return failure(name, { kind: 'internal' });
      }
    },
  });
}

export interface BridgeTool {
  readonly name: string;
  readonly description?: string;
  /** Bounded 2020-12 schema: advertised on the wire and enforced by the kernel. */
  readonly schema: unknown;
  /**
   * Explicit wire-profile admission (L5 Lot 1): memory tools carry
   * `sentropic.engram.memory-wire/v1`. Absent means the existing default
   * (Immo) profile; the global/default codec never changes silently.
   */
  readonly profile?: string;
  readonly schemaProfile?: string;
  readonly outputSchema?: Tool['outputSchema'];
  readonly annotations?: Tool['annotations'];
  readonly _meta?: Tool['_meta'];
  readonly maxPacketBytes?: number;
}

/** Memory wire-profile identifier admitted explicitly through this bridge. */
export const MEMORY_BRIDGE_PROFILE_ID = 'sentropic.engram.memory-wire/v1';

/** True when the tool explicitly negotiates the memory wire profile. */
export function isMemoryProfileTool(tool: BridgeTool): boolean {
  return tool.profile === MEMORY_BRIDGE_PROFILE_ID;
}

/** Preflight is also available to compositions before they acquire provider resources. */
export function admitBridgeTools(tools: readonly BridgeTool[]): void {
  for (const tool of tools) {
    if ((tool.profile !== undefined || tool.schemaProfile !== undefined || isMemoryToolName(tool.name)) && !isMemoryProfileTool(tool)) throw new TypeError('Unsupported wire profile');
    if (!isMemoryProfileTool(tool)) continue;
    if (!isMemoryToolName(tool.name)) throw new TypeError('Unsupported memory tool');
    if (tool.maxPacketBytes !== undefined && (!Number.isSafeInteger(tool.maxPacketBytes) ||
      tool.maxPacketBytes < 4096 || tool.maxPacketBytes > 1048576)) throw new TypeError('Invalid memory packet budget');
    if (tool.schemaProfile !== 'sentropic.engram.memory-tools/2020-12-v1') throw new TypeError('Unsupported memory schema profile');
    admitMemorySchema(tool.schema);
    admitMemorySchema(tool.outputSchema);
  }
}

export interface BridgeRunner {
  run(
    tool: string,
    args: Record<string, JSONValue>,
    identity: RequestIdentity | undefined,
    call?: BridgeInvocation,
  ): Promise<AppToolResult>;
}

export interface BridgeInvocation {
  readonly context: StpConnectorContext;
  readonly signal: AbortSignal;
}

export interface BridgeOptions {
  /** Boundary identity forwarded to the runner on every call (else `undefined`). */
  readonly identity?: RequestIdentity;
  /** Per-call trusted host resolver; never sourced from SDK arguments or headers. */
  memoryContext?(tool: string, signal: AbortSignal): Promise<StpConnectorContext>;
}

export interface RequestIdentity {
  readonly clientId?: string;
  readonly tenantRef?: string;
  readonly scopes: readonly string[];
  readonly hasBearer: boolean;
}

function errorResult(auditId: string, code: string, message: string): AppToolResult {
  return {
    ok: false,
    auditId,
    redactionClass: 'low',
    error: { code, message, retriable: false },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function headerValue(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Parse untrusted transport headers into a hint record (bearer presence
 * only, never the token). B1: this is NEVER authority — no caller may derive
 * invocation identity from it; verified principals come from the host's
 * authentication and the mesh verified-invocation context only.
 *
 * @deprecated Do not use for authorization decisions; kept for parsing only.
 */
export function extractHttpRequestIdentity(
  headers: Record<string, string | string[] | undefined>,
): RequestIdentity {
  const scopes = (headerValue(headers, 'x-mcp-scopes') ?? '')
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
  const clientId = headerValue(headers, 'x-mcp-client-id');
  const tenantRef = headerValue(headers, 'x-mcp-tenant-ref');
  const authorization = headerValue(headers, 'authorization');
  return {
    ...(clientId === undefined ? {} : { clientId }),
    ...(tenantRef === undefined ? {} : { tenantRef }),
    scopes,
    hasBearer:
      authorization !== undefined && /^[Bb]earer\s+\S/.test(authorization),
  };
}

/**
 * Parse untrusted per-request headers from the SDK handler extra (hint
 * only, never authority — see `extractHttpRequestIdentity`). Supports
 * web-standard `Headers` and plain header records; returns `undefined`
 * when the transport carries no headers (e.g. in-memory, stdio). The raw
 * bearer is never exposed.
 *
 * @deprecated Do not use for authorization decisions; kept for parsing only.
 */
export function identityFromExtra(extra: unknown): RequestIdentity | undefined {
  if (!isRecord(extra)) return undefined;
  const headers = (extra as { requestInfo?: { headers?: unknown } }).requestInfo?.headers;
  if (headers instanceof Headers) {
    return extractHttpRequestIdentity(Object.fromEntries(headers.entries()));
  }
  if (isRecord(headers)) {
    const flat: Record<string, string | string[] | undefined> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (typeof value === 'string' || Array.isArray(value)) flat[key] = value as string | string[];
    }
    return extractHttpRequestIdentity(flat);
  }
  return undefined;
}

/** Register plan tools on a low-level SDK server; kernel-validated, wire-encoded. */
export function registerBridgeTools(
  server: Server,
  tools: readonly BridgeTool[],
  runner: BridgeRunner,
  options?: BridgeOptions,
): void {
  const identity = options?.identity;
  admitBridgeTools(tools);
  tools = tools.map(tool => isMemoryProfileTool(tool) ? freezeMcpJson(structuredClone(tool)) : tool);
  registerBridgeKernel(server, {
    unknownTool: name => new McpError(ErrorCode.MethodNotFound, `Unknown tool '${name}'`),
    tools: tools.map((tool) => ({
      name: tool.name,
      ...(isMemoryProfileTool(tool) ? { outputSchema: tool.outputSchema, annotations: tool.annotations, _meta: tool._meta } : {}),
      ...(tool.description === undefined ? {} : { description: tool.description }),
      inputSchema: {
        type: 'object' as const,
        ...(isRecord(tool.schema) ? tool.schema : {}),
      },
    })),
    async call(name, rawArgs, signal) {
    const tool = tools.find((candidate) => candidate.name === name)!;
    if (isMemoryProfileTool(tool)) return callMemoryBridge(tool, rawArgs as Record<string, unknown>, runner, options, signal);
    if (!isRecord(rawArgs)) {
      return encodeToolResult(errorResult('kernel-rejection', 'invalid_parameters', 'arguments must be an object'));
    }
    const args = rawArgs as Record<string, JSONValue>;
    const diagnostics = validateBoundedValue(tool.schema, args);
    if (diagnostics.length > 0) {
      return encodeToolResult(
        errorResult(
          'kernel-rejection',
          'invalid_parameters',
          diagnostics.map((d) => `${d.path}: ${d.message}`).join('; '),
        ),
      );
    }
    try {
      // The shared kernel exposes cancellation only; identity remains host-owned.
      return encodeToolResult(await runner.run(tool.name, args, identity));
    } catch (error) {
      return encodeToolResult(
        errorResult(
          'runner-failure',
          'runner_threw',
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
    },
  });
}
