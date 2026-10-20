import type { Hono } from 'hono';
import type { McpAuthConfig } from '@sentropic/mcp-auth';
import type { CompiledMcpRegistry } from '@sentropic/mcp-platform/registry';
import type { AppToolResult, BridgeRunner, BridgeTool } from '@sentropic/mcp-platform/transport/bridge';
import type { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { ClusterMeshHonoNamespaceModule } from '../hono/plugin.js';
import type { TokenExchangeIssuer } from '../token-exchange.js';

/** Verified human identity. Neither bearer material nor untrusted context headers are exposed. */
export interface McpOAuthPrincipal {
  readonly sub: string;
  readonly clientId?: string;
  readonly scopes: readonly string[];
  readonly tid: string | null;
}

export interface McpOAuthEgressResponse {
  readonly status: number;
  /** Bounded JSON from the fixed downstream; response headers are not exposed. */
  readonly body: unknown;
}

export interface McpOAuthCallContext {
  readonly principal: McpOAuthPrincipal;
  readonly correlationId: string;
  readonly egress: {
    /** Valid only during this invocation, for a profile bound to this exact tool. */
    request(profileId: string, params: Readonly<Record<string, string>>): Promise<McpOAuthEgressResponse>;
  };
}

export interface McpOAuthEgressProfile {
  readonly tool: string;
  readonly method: 'GET';
  /** Trusted host transport origin, independently configured from the token audience. */
  readonly origin: string;
  readonly audience: string;
  readonly pathTemplate: string;
  readonly requiredScopes: readonly string[];
  /** Must return canonical safe path segments; the composition revalidates them. */
  readonly validateParams: (params: Readonly<Record<string, string>>) => Readonly<Record<string, string>>;
}

export interface McpOAuthExchangeOptions {
  readonly issuer: TokenExchangeIssuer;
  readonly workloadClientId: string;
  readonly workloadActorSub: string;
  readonly policyRevision: string;
  readonly profiles: Readonly<Record<string, McpOAuthEgressProfile>>;
  /** Trusted host bindings, never accepted from a tool call. */
  readonly fetchFn?: typeof fetch;
  readonly nowMs?: () => number;
}

export interface McpOAuthSessionOptions {
  readonly createTransport: () => WebStandardStreamableHTTPServerTransport;
  /** Defaults preserve Immo T2: 30 minutes idle, 8 hours absolute. */
  readonly idleTimeoutMs?: number;
  readonly maxLifetimeMs?: number;
  readonly maxSessions?: number;
  readonly nowMs?: () => number;
}

export interface McpOAuthNamespaceOptions {
  readonly registry: CompiledMcpRegistry;
  readonly tools: readonly BridgeTool[];
  readonly resource: string;
  readonly authorizationServers: readonly string[];
  readonly keySource?: McpAuthConfig['keySource'];
  readonly scopesSupported: readonly string[];
  readonly requiredIngressScopes: readonly string[];
  /** Exact assurance identifier; missing or insufficient assurance refuses when configured. */
  readonly requiredAcr?: string;
  /** Restricts exchange subjects only; ingress binds the optional signed client to the session. */
  readonly subjectClientId?: string;
  readonly environment: string;
  readonly sessions: McpOAuthSessionOptions;
  readonly resolveAccount: (principal: McpOAuthPrincipal) => Promise<
    { readonly allowed: true } | { readonly allowed: false; readonly reason: string }
  >;
  readonly exchange?: McpOAuthExchangeOptions;
  readonly invoke: (
    tool: string,
    args: Parameters<BridgeRunner['run']>[1],
    call: McpOAuthCallContext,
  ) => Promise<AppToolResult>;
}

export interface McpOAuthNamespace {
  /** Mount at application root, before protected routes. */
  readonly metadataRoutes: Hono;
  /** Mount at the resource path; paths within this router are relative. */
  readonly mcpRoutes: Hono;
  /** Equivalent namespace mount, sharing the same router and session ownership. */
  readonly module: ClusterMeshHonoNamespaceModule;
  close(): Promise<void>;
}
