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
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { encodeToolResult } from './result-codec.js';
import { validateBoundedValue, type JSONValue } from '../registry-parameters.js';
import type { AppToolResult } from '../runtime.js';

export type { AppToolResult } from '../runtime.js';

export interface BridgeTool {
  readonly name: string;
  readonly description?: string;
  /** Bounded 2020-12 schema: advertised on the wire and enforced by the kernel. */
  readonly schema: unknown;
}

export interface BridgeRunner {
  run(
    tool: string,
    args: Record<string, JSONValue>,
    identity: RequestIdentity | undefined,
  ): Promise<AppToolResult>;
}

export interface BridgeOptions {
  /** Boundary identity forwarded to the runner on every call (else `undefined`). */
  readonly identity?: RequestIdentity;
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
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      ...(tool.description === undefined ? {} : { description: tool.description }),
      inputSchema: {
        type: 'object' as const,
        ...(isRecord(tool.schema) ? tool.schema : {}),
      },
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const name = request.params.name;
    const tool = tools.find((candidate) => candidate.name === name);
    if (tool === undefined) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool '${name}'`);
    }
    const rawArgs = request.params.arguments ?? {};
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
      // B1: the runner receives the host-owned mount identity only. Client
      // headers are untrusted and never override it (`extra` is intentionally
      // unread here); verified per-request identity is the host's composition
      // concern (mesh verified-invocation context).
      void extra;
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
  });
}
