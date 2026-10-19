import { Hono } from 'hono';
import { mcpAuthRoutes } from '@sentropic/mcp-auth/hono';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { hostAuth, oldServer, readRpc, validInitialize, verifiedAuthority } from './stateful-host-auth.mjs';

/** Conforming host test adapter, owning only auth, admission and HTTP/session lifecycle. */
export function makeStatefulHost(tools, overrides = {}) {
  const { auth, token } = hostAuth();
  const app = new Hono();
  app.route('/mcp', mcpAuthRoutes(auth));
  app.route('/', mcpAuthRoutes(auth));
  const sessions = new Map();
  const pending = new Set();
  const stats = { servers: 0, transports: 0, closes: 0, oldCalls: 0, sdkCredentials: 0, gets: 0 };
  let hooks, bound = false, admission = 'open', now = 0;
  const expired = entry => now - entry.lastSeenAt > (overrides.idle ?? 1_800_000)
    || now - entry.createdAt > (overrides.absolute ?? 28_800_000);
  const unknown = c => c.json({ jsonrpc: '2.0', error: {
    code: -32000, message: 'Unknown or expired MCP session' }, id: null }, 404);
  const close = async entry => { if (!entry.closed) await entry.transport.close(); };
  const sweep = async () => {
    for (const entry of sessions.values()) if (expired(entry)) await close(entry);
  };
  const host = {
    verifiedClaimNames: ['admin'],
    async bind(nextHooks) {
      if (bound) throw new Error('Already bound');
      bound = true; admission = 'binding';
      // Admission remains closed while admitted POST operations finish.
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          admission = 'failed'; reject(new Error('Host drain deadline exceeded'));
        }, overrides.drainTimeoutMs ?? 1_000);
        Promise.all([...pending]).then(() => { clearTimeout(timer); resolve(); },
          error => { clearTimeout(timer); reject(error); });
      });
      try {
        for (const entry of sessions.values()) {
          if (overrides.failInstall) overrides.failInstall(entry.server.server);
          nextHooks.register(entry.server.server);
          entry.server.disableToolUpdates();
        }
        hooks = nextHooks;
        admission = 'open';
        return app;
      } catch (error) { admission = 'failed'; throw error; }
    },
  };
  app.on(['POST', 'GET', 'DELETE'], '/mcp', async c => {
    let verified;
    try { verified = await auth.verify(c.req.raw, { requiredScopes: ['immo:read'] }); }
    catch (error) { return auth.challenge(error); }
    if (admission !== 'open') return c.json({ error: 'Host admission closed' }, 503);
    const sid = c.req.header('mcp-session-id');
    let entry = sid ? sessions.get(sid) : undefined;
    if (sid) {
      if (!entry) return unknown(c);
      if (expired(entry)) { await close(entry); return unknown(c); }
      const client = verified.claims.azp ?? verified.claims.client_id;
      if (verified.sub !== entry.sub || (client && entry.client && client !== entry.client)) return unknown(c);
      entry.lastSeenAt = now;
      if (c.req.method === 'GET') stats.gets++;
    }
    let body;
    if (c.req.method === 'POST') {
      try { body = await readRpc(c.req.raw, hooks?.maxRequestBytes ?? 2 ** 25); }
      catch (error) { return c.json({ error: 'Invalid request' }, error instanceof RangeError ? 413 : 400); }
    }
    if (!entry) {
      if (c.req.method !== 'POST' || !validInitialize(body)) return c.json({ error: 'Missing session' }, 400);
      await sweep();
      const server = oldServer(tools, async name => {
        stats.oldCalls++;
        return overrides.oldInvoke ? overrides.oldInvoke(name) : { content: [] };
      });
      stats.servers++; stats.transports++;
      if (hooks) { hooks.register(server.server); server.disableToolUpdates(); }
      const lifetime = new AbortController();
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(), enableJsonResponse: true,
      });
      entry = { server, transport, lifetime, sub: verified.sub,
        client: verified.claims.azp ?? verified.claims.client_id, createdAt: now, lastSeenAt: now,
        closed: false, pending: new Set(), calls: new Set() };
      const originalClose = transport.close.bind(transport);
      transport.close = async () => {
        if (entry.closed) return;
        stats.closes++; entry.closed = true; lifetime.abort();
        sessions.delete(transport.sessionId);
        await Promise.all([...entry.pending]);
        await originalClose();
      };
      await server.connect(transport);
    }
    const current = entry;
    const headers = new Headers(c.req.raw.headers);
    headers.delete('authorization'); headers.delete('cookie');
    const request = new Request(c.req.url, {
      method: c.req.method, headers, signal: c.req.raw.signal,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (request.headers.has('authorization')) stats.sdkCredentials++;
    if (body?.method === 'tools/call') current.calls.add(body.id);
    const execute = async () => {
      const response = await current.transport.handleRequest(request);
      if (body?.method === 'notifications/cancelled' && current.calls.has(body.params?.requestId)) {
        // SDK Protocol suppresses replies after cancellation. The host releases the
        // original HTTP response explicitly through the transport's public send seam.
        await current.transport.send({ jsonrpc: '2.0', id: body.params.requestId,
          error: { code: -32603, message: 'Request cancelled' } });
      }
      return response;
    };
    const authority = verifiedAuthority(verified, AbortSignal.any([request.signal, current.lifetime.signal]));
    const operation = hooks ? hooks.run(authority, execute) : execute();
    if (c.req.method === 'POST') pending.add(operation);
    if (sid && c.req.method === 'POST') current.pending.add(operation);
    try {
      const response = await operation;
      if (current.transport.sessionId && !current.closed) sessions.set(current.transport.sessionId, current);
      else if (!sid) await close(current);
      return response;
    } catch (error) { if (!sid) await close(current); throw error; }
    finally {
      pending.delete(operation); current.pending.delete(operation);
      if (body?.method === 'tools/call') current.calls.delete(body.id);
    }
  });
  return { app, host, token, stats, sessions, sweep,
    setNow: value => { now = value; }, admission: () => admission,
    close: async () => { for (const entry of sessions.values()) await close(entry); } };
}
