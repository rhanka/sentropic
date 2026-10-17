import { oauthAuthority, type OAuthRequestAuthority } from './oauth-context.js';
import type { McpOAuthSessionOptions } from './oauth-contracts.js';
import type { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

interface Connection {
  readonly transport: WebStandardStreamableHTTPServerTransport;
  close(): Promise<void>;
}
interface Session extends Connection {
  readonly owner: string;
  readonly created: number;
  touched: number;
  readonly lifetime: AbortController;
}

const missing = () => Response.json({ error: { code: 'session_not_found', message: 'MCP session not found.' } }, { status: 404 });
const unavailable = () => Response.json({ error: { code: 'mcp_unavailable', message: 'MCP is unavailable.' } }, { status: 503 });

/** Process-local stateful transports. Every method checks owner and both deadlines first. */
export function createOAuthSessions(
  options: McpOAuthSessionOptions,
  binding: { resource: string; environment: string },
  connect: () => Promise<Connection>,
) {
  const idle = options.idleTimeoutMs ?? 30 * 60_000;
  const absolute = options.maxLifetimeMs ?? 8 * 60 * 60_000;
  const capacity = options.maxSessions ?? 1000;
  for (const value of [idle, absolute, capacity]) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError('MCP session limits must be positive integers');
  }
  const now = options.nowMs ?? Date.now;
  const sessions = new Map<string, Session>();
  const creating = new Set<Promise<Connection>>();
  const closing = new Set<Promise<void>>();
  let closed = false;
  const owner = ({ principal }: OAuthRequestAuthority) => JSON.stringify([
    principal.sub, principal.clientId ?? null, principal.tid, binding.resource, binding.environment,
  ]);
  const expired = (session: Session) => now() - session.touched >= idle || now() - session.created >= absolute;
  const retire = (id: string, session: Session) => {
    if (sessions.get(id) === session) sessions.delete(id);
    session.lifetime.abort();
    const work = session.close().catch(() => undefined);
    closing.add(work);
    void work.finally(() => closing.delete(work));
  };
  const sweep = () => {
    for (const [id, session] of sessions) if (expired(session)) retire(id, session);
  };
  const timer = setInterval(sweep, Math.min(idle, absolute, 60_000));
  timer.unref();

  return {
    async handle(request: Request, authority: OAuthRequestAuthority): Promise<Response> {
      if (closed) return unavailable();
      sweep();
      const id = request.headers.get('mcp-session-id');
      let session: Session;
      if (id !== null) {
        const existing = sessions.get(id);
        if (!existing || existing.owner !== owner(authority)) return missing();
        session = existing;
        session.touched = now();
      } else {
        if (request.method !== 'POST') return missing();
        if (sessions.size + creating.size >= capacity) return unavailable();
        const pending = connect();
        creating.add(pending);
        let connection: Connection;
        try { connection = await pending; } catch { return unavailable(); }
        finally { creating.delete(pending); }
        session = { ...connection, owner: owner(authority), created: now(), touched: now(), lifetime: new AbortController() };
        if (closed || request.signal.aborted) {
          retire('', session);
          return unavailable();
        }
      }
      const current = Object.freeze({ ...authority,
        signal: AbortSignal.any([authority.signal, session.lifetime.signal]),
      });
      try {
        const response = await oauthAuthority.run(current, () => session.transport.handleRequest(request));
        if (id === null) {
          const assigned = session.transport.sessionId;
          if (!closed && !current.signal.aborted && response.status < 400 && assigned && !sessions.has(assigned)) {
            sessions.set(assigned, session);
          } else {
            retire('', session);
            if (response.status < 400) return unavailable();
          }
        } else if (request.method === 'DELETE' && response.ok) {
          retire(id, session);
        }
        return response;
      } catch {
        if (id === null) retire('', session);
        return unavailable();
      }
    },
    async close(): Promise<void> {
      closed = true;
      clearInterval(timer);
      for (const [id, session] of sessions) retire(id, session);
      // A connection being established when shutdown started is also closed before returning.
      await Promise.allSettled([...creating].map(async (pending) => (await pending).close()));
      await Promise.all([...closing]);
    },
  };
}
