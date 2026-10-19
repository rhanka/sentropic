import type { Hono } from 'hono';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import type { CompiledMcpRegistry } from '@sentropic/mcp-platform/registry';
import type { McpToolValidationLimits } from '@sentropic/mcp-platform/transport/tool-schemas';

export interface VerifiedMcpRequest {
  readonly principal: Readonly<{
    issuer: string;
    sub: string;
    clientId?: string;
    tid?: string;
    scopes: readonly string[];
    claims: readonly string[];
    attributes: Readonly<Record<string, unknown>>;
  }>;
  readonly resource: string;
  readonly correlationId: string;
  readonly signal: AbortSignal;
}

export interface StatefulMcpHooks {
  /** Host must bound the complete raw JSON-RPC body before parsing. */
  readonly maxRequestBytes: number;
  /** Public McpServer.server seam: install before connect, or under the host barrier. */
  register(server: Server): void;
  run<T>(authority: VerifiedMcpRequest, next: () => Promise<T>): Promise<T>;
}

export interface StatefulMcpHost {
  readonly verifiedClaimNames: readonly string[];
  /**
   * Bind once: pause admission (including initialize), drain old calls, then
   * replace list/call on every existing server and register future servers.
   * Clear old bearer state; disable high-level tool updates. Release only on
   * complete success; installation failure retains objects and closed admission.
   * The host keeps sessions, authentication, owner/expiry semantics and cleanup.
   */
  bind(hooks: StatefulMcpHooks): Promise<Hono>;
}

export type McpWrapRefusal =
  | { kind: 'scope'; missingScopes: readonly string[] }
  | { kind: 'account' | 'policy' | 'invalid-arguments' | 'inactive' | 'internal' };

export interface StatefulMcpNamespaceOptions {
  readonly host: StatefulMcpHost;
  readonly registry: CompiledMcpRegistry;
  readonly tools: readonly Tool[];
  readonly limits: McpToolValidationLimits;
  authorize(tool: string, context: VerifiedMcpRequest): Promise<boolean>;
  invoke(tool: string, args: Record<string, unknown>, context: VerifiedMcpRequest): Promise<CallToolResult>;
  formatRefusal(tool: string, refusal: McpWrapRefusal, context: VerifiedMcpRequest): CallToolResult;
}
