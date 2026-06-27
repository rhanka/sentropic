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
  token?: string; // bearer presented per request (verified by the authz layer)
};

export type McpResponse =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: string; message: string } };

export type McpRequestHandler = (
  req: McpRequest,
  session: { id: string; clientId: string },
) => Promise<McpResponse>;

type SessionRecord = { id: string; clientId: string; createdAt: string };

export class InMemoryMcpServer {
  readonly #sessions = new Map<string, SessionRecord>();
  readonly #handler: McpRequestHandler;

  constructor(handler: McpRequestHandler) {
    this.#handler = handler;
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
   *  client does not own it (cross-client isolation). */
  async handle(sessionId: string, clientId: string, req: McpRequest): Promise<McpResponse> {
    const session = this.#sessions.get(sessionId);
    if (!session) return { ok: false, error: { code: 'unknown_session', message: 'no such session' } };
    if (session.clientId !== clientId) {
      return { ok: false, error: { code: 'session_client_mismatch', message: 'foreign client' } };
    }
    return this.#handler(req, { id: session.id, clientId });
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
