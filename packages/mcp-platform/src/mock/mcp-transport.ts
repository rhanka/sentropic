/**
 * Slice 2 — In-memory mock MCP client/server transport.
 *
 * A deterministic stand-in for an MCP streamable-HTTP transport (§9 reference,
 * §11 session-persistence probes). Sessions are keyed by `mcp-session-id` and
 * BOUND to the originating client id: a foreign client cannot reuse another
 * client's session (cross-client isolation, fail-closed).
 *
 * MOCK-ONLY: in-memory maps, synchronous dispatch; no network, no SDK, no
 * `@modelcontextprotocol/sdk` dependency.
 */
import { randomUUID } from 'node:crypto';

export type McpRequest = {
  method: string;
  params?: Record<string, unknown>;
  token?: string; // bearer presented per request; CONSUMED at the auth boundary
};

// What the downstream handler/connector actually receives: the bearer is
// structurally absent — it never crosses the auth boundary (§6.6 no-passthrough).
export type SanitizedMcpRequest = {
  method: string;
  params?: Record<string, unknown>;
};

export type McpResponse =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: string; message: string } };

// Auth boundary: consumes the raw bearer and yields an authorization outcome. The
// raw token is NEVER included in the context handed to the handler.
export type TokenAuthorizer = (
  token: string | undefined,
  session: { id: string; clientId: string },
) => unknown;

export type McpRequestHandler = (
  req: SanitizedMcpRequest,
  session: { id: string; clientId: string; auth?: unknown },
) => Promise<McpResponse>;

type SessionRecord = { id: string; clientId: string; createdAt: string };

export class InMemoryMcpServer {
  readonly #sessions = new Map<string, SessionRecord>();
  readonly #handler: McpRequestHandler;
  readonly #authorizer?: TokenAuthorizer;

  constructor(handler: McpRequestHandler, authorizer?: TokenAuthorizer) {
    this.#handler = handler;
    this.#authorizer = authorizer;
  }

  openSession(clientId: string): string {
    const id = randomUUID();
    this.#sessions.set(id, { id, clientId, createdAt: new Date().toISOString() });
    return id;
  }

  closeSession(sessionId: string): void {
    this.#sessions.delete(sessionId);
  }

  hasSession(sessionId: string): boolean {
    return this.#sessions.has(sessionId);
  }

  /** Dispatch a request. Fail-closed when the session is unknown or the calling
   *  client does not own it (cross-client isolation). The bearer is consumed at
   *  this boundary and stripped before the handler runs (token no-passthrough). */
  async handle(sessionId: string, clientId: string, req: McpRequest): Promise<McpResponse> {
    const session = this.#sessions.get(sessionId);
    if (!session) return { ok: false, error: { code: 'unknown_session', message: 'no such session' } };
    if (session.clientId !== clientId) {
      return { ok: false, error: { code: 'session_client_mismatch', message: 'foreign client' } };
    }
    // Consume the bearer at the boundary; the handler only ever sees a sanitized
    // request (no `token` field) plus an authorization outcome.
    const { token, ...sanitized } = req;
    const auth = this.#authorizer ? this.#authorizer(token, { id: session.id, clientId }) : undefined;
    return this.#handler(sanitized, { id: session.id, clientId, auth });
  }
}

/** A client bound to a single clientId; opens and reuses one server session. */
export class InMemoryMcpClient {
  #sessionId?: string;

  constructor(
    readonly clientId: string,
    private readonly server: InMemoryMcpServer,
  ) {}

  connect(): string {
    this.#sessionId = this.server.openSession(this.clientId);
    return this.#sessionId;
  }

  get sessionId(): string | undefined {
    return this.#sessionId;
  }

  async send(req: McpRequest): Promise<McpResponse> {
    if (!this.#sessionId) throw new Error('client not connected');
    return this.server.handle(this.#sessionId, this.clientId, req);
  }
}
