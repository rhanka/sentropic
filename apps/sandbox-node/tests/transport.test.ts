import { describe, expect, it } from 'vitest';
import { requestScope, sendJobAlertHeartbeat, createAgentServer } from '../src/transport.js';

describe('public mTLS agent boundary', () => {
  it('should separate operator scope from mandatory tenant scope', () => {
    expect(requestScope('/v1/node', undefined, 'operator')).toEqual({ scope: 'node' });
    expect(() => requestScope('/v1/node', undefined, 'data-plane')).toThrowError(/custody_revoked/);
    expect(() => requestScope('/v1/events?scope=node&tenantId=immo', undefined, 'operator')).toThrow();
    expect(() => requestScope('/v1/sandboxes', undefined, 'control-plane')).toThrowError(/missing_tenant_id/);
    expect(requestScope('/v1/sandboxes', 'immo', 'control-plane')).toEqual({ scope: 'tenant', tenantId: 'immo' });
  });
  it('should refuse plaintext heartbeat destinations and unauthenticated sockets', async () => {
    await expect(sendJobAlertHeartbeat('http://job-alerts', {}, {})).rejects.toThrowError(/HTTPS/);
    const server = createAgentServer({}, () => { throw new Error('must not dispatch'); });
    let status: number | undefined;
    server.emit('request', { socket: { authorized: false } }, { writeHead(code: number) { status = code; return this; }, end() {} });
    expect(status).toBe(403);
    server.close();
  });
});
