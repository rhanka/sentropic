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
});
