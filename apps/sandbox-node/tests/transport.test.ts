import { describe, expect, it } from 'vitest';
import { requestScope, createAgentServer } from '../src/transport.js';
import { readFileSync } from 'node:fs';

describe('public mTLS agent boundary', () => {
  it('should separate operator scope from mandatory tenant scope', () => {
    expect(requestScope('/v1/node', undefined, 'operator')).toEqual({ scope: 'node' });
    expect(() => requestScope('/v1/node', undefined, 'data-plane')).toThrowError(/custody_revoked/);
    expect(() => requestScope('/v1/events?scope=node&tenantId=immo', undefined, 'operator')).toThrow();
    expect(() => requestScope('/v1/sandboxes', undefined, 'control-plane')).toThrowError(/missing_tenant_id/);
    expect(requestScope('/v1/sandboxes', 'immo', 'control-plane')).toEqual({ scope: 'tenant', tenantId: 'immo' });
  });
  it('should never push monitoring heartbeats or require a job-alerts destination', () => {
    for (const file of ['service', 'transport']) {
      const code = readFileSync(new URL(`../src/${file}.ts`, import.meta.url), 'utf8');
      expect(code).not.toMatch(/JOB_ALERTS_URL|sendJobAlertHeartbeat|setInterval/);
    }
  });
  it('should reject unauthenticated sockets', () => {
    const server = createAgentServer({}, () => { throw new Error('must not dispatch'); });
    let status: number | undefined;
    server.emit('request', { socket: { authorized: false } }, { writeHead(code: number) { status = code; return this; }, end() {} });
    expect(status).toBe(403);
    server.close();
  });
  it('should recognize only the exact installed client identities', () => {
    const roles: string[] = [];
    const server = createAgentServer({}, (_req, _res, role) => { roles.push(role); });
    for (const CN of ['control-plane:sentropic-api', 'data-plane:artifact-content', 'operator:cluster-controller', 'control-plane:other']) {
      server.emit('request', { socket: { authorized: true, getPeerCertificate: () => ({ subject: { CN } }) } },
        { writeHead() { return this; }, end() {} });
    }
    expect(roles).toEqual(['control-plane', 'data-plane', 'operator']);
    server.close();
  });
});
