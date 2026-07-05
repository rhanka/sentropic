/**
 * Slice 2 — mock MCP transport probes (§11 session persistence / isolation).
 *
 * Covers: dispatch through an owned session, cross-client isolation (a foreign
 * client cannot reuse another client's session), and unknown-session fail-close.
 */
import { describe, expect, it } from 'vitest';
import { InMemoryMcpClient, InMemoryMcpServer, type McpResponse } from '../src/mock/mcp-transport.js';

function echoServer(): InMemoryMcpServer {
  return new InMemoryMcpServer(async (req, session): Promise<McpResponse> => ({
    ok: true,
    result: { method: req.method, clientId: session.clientId },
  }));
}

describe('InMemoryMcpServer / InMemoryMcpClient', () => {
  it('dispatches a request through a client-owned session', async () => {
    const server = echoServer();
    const client = new InMemoryMcpClient('claude.ai', server);
    client.connect();
    const res = await client.send({ method: 'tools/list' });
    expect(res.ok).toBe(true);
    if (res.ok) expect((res.result as { clientId: string }).clientId).toBe('claude.ai');
  });

  it('fails closed when a foreign client tries to reuse a session', async () => {
    const server = echoServer();
    const owner = new InMemoryMcpClient('claude.ai', server);
    const sessionId = owner.connect();
    const res = await server.handle(sessionId, 'codex', { method: 'tools/list' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('session_client_mismatch');
  });

  it('fails closed on an unknown session', async () => {
    const server = echoServer();
    const res = await server.handle('does-not-exist', 'claude.ai', { method: 'tools/list' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('unknown_session');
  });

  it('F7: the bearer is consumed at the boundary — the handler never receives the raw token', async () => {
    let seenKeys: string[] = [];
    let authSeen: unknown;
    // The authorizer is the ONLY place that sees the raw token; its output (never
    // the token itself) is what reaches the handler context.
    const server = new InMemoryMcpServer(
      async (req, session): Promise<McpResponse> => {
        seenKeys = Object.keys(req as Record<string, unknown>);
        authSeen = session.auth;
        return { ok: true, result: { keys: seenKeys, auth: session.auth } };
      },
      (token) => ({ verified: typeof token === 'string' }),
    );
    const client = new InMemoryMcpClient('claude.ai', server);
    client.connect();
    const RAW = 'bearer-raw-token-must-not-cross-the-boundary';
    const res = await client.send({ method: 'tools/call', token: RAW });

    expect(res.ok).toBe(true);
    // Structurally absent: the handler's request has no `token` field at all.
    expect(seenKeys).not.toContain('token');
    expect(authSeen).toEqual({ verified: true });
    // The raw token appears nowhere in the response surfaced from the handler.
    expect(JSON.stringify(res)).not.toContain(RAW);
  });
});
