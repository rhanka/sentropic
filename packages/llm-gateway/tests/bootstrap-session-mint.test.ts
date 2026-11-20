import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startGatewayHost } from '../src/node/gateway-host.js';
import { createGatewayControlClient } from '../src/node/control-client.js';
import { computeBootstrapProof, createLoopbackSessionMintHandler } from '../src/node/bootstrap-session-mint.js';
import { GatewaySessionService } from '../src/session-service.js';
import type { GatewayStateStore, StoredState } from '../src/ports/gateway-state.js';
import { durableHostFixture, routingContract } from './helpers/durable-host.js';

const SECRET = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4';
const payload = (clientSessionRef = 'cli-1', extra: Record<string, unknown> = {}) =>
  JSON.stringify({ ownerScopeRef: 'owner-a', workspaceRef: 'w', clientSessionRef, routingContract, ...extra });

const signedHeaders = (body: string, opts: { secret?: string; ts?: number; nonce?: string; method?: string; path?: string } = {}) => {
  const timestampMs = opts.ts ?? Date.now();
  const nonce = opts.nonce ?? `n-${Math.random().toString(36).slice(2)}`;
  const proof = computeBootstrapProof({
    secret: opts.secret ?? SECRET, method: opts.method ?? 'POST', path: opts.path ?? '/v1/session',
    timestampMs, nonce, body,
  });
  return {
    'content-type': 'application/json',
    'x-sentropic-bootstrap-proof': proof,
    'x-sentropic-bootstrap-timestamp': String(timestampMs),
    'x-sentropic-bootstrap-nonce': nonce,
  };
};

describe('L1.1 control.sock-first session mint & default-OFF loopback bootstrap proof', () => {
  it('disables loopback HTTP POST /v1/session by default while control.sock mints sessions', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'gw-boot-off-'));
    const host = await startGatewayHost({ stateDir, mesh: durableHostFixture().mesh, listen: { host: '127.0.0.1', port: 0 } });
    try {
      const res = await fetch(`${host.endpoint}/v1/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload() });
      expect(res.status).toBe(404);
      const control = createGatewayControlClient({ controlSocket: host.controlSocket });
      const issued = await control.acquireSession({ ownerScopeRef: 'owner-a', workspaceRef: 'w', clientSessionRef: 'sock-1', routingContract });
      expect(issued.key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    } finally { await host.stop(); await rm(stateDir, { recursive: true, force: true }); }
  });

  it('rejects unauthenticated, forged, expired (>60s), replayed nonce, full-cache (503) and burst>10 (429), and caps ttlDays=1', async () => {
    let clock = 1_700_000_000_000;
    const stateDir = await mkdtemp(join(tmpdir(), 'gw-boot-on-'));
    const host = await startGatewayHost({
      stateDir, mesh: durableHostFixture().mesh, listen: { host: '127.0.0.1', port: 0 },
      enableLoopbackHttpSessionMint: true, bootstrapSecret: SECRET, bootstrapNow: () => clock, bootstrapMaxNonces: 3,
    });
    try {
      const body = payload('cli-auth', { ttlDays: 30 });
      // Unauthenticated -> 401, no key
      const unauth = await fetch(`${host.endpoint}/v1/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      expect(unauth.status).toBe(401);
      expect(await unauth.text()).not.toContain('sessionRef');
      // Forged HMAC -> 401
      const forged = await fetch(`${host.endpoint}/v1/session`, { method: 'POST', headers: signedHeaders(body, { secret: 'wrong-secret-012345678901234567890123456789', ts: clock, nonce: 'forged-1' }), body });
      expect(forged.status).toBe(401);
      // Expired (>60s) -> 401
      const expired = await fetch(`${host.endpoint}/v1/session`, { method: 'POST', headers: signedHeaders(body, { ts: clock - 61_000, nonce: 'exp-1' }), body });
      expect(expired.status).toBe(401);
      // Valid proof -> 200, 32-byte base64url key, ttl capped to <= 24h (1 day)
      const validHeaders = signedHeaders(body, { ts: clock, nonce: 'nonce-1' });
      const ok = await fetch(`${host.endpoint}/v1/session`, { method: 'POST', headers: validHeaders, body });
      expect(ok.status).toBe(200);
      const issued = (await ok.json()) as { key: string; sessionRef: string; expiresAt: string };
      expect(issued.key).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Date.parse(issued.expiresAt) - Date.now()).toBeLessThanOrEqual(86_400_000 + 5_000);
      // Replayed nonce within 300s -> 401
      const replay = await fetch(`${host.endpoint}/v1/session`, { method: 'POST', headers: validHeaders, body });
      expect(replay.status).toBe(401);
      // Fill remaining nonce cache (max 3), 4th unique nonce fails closed with 503
      for (const n of ['nonce-2', 'nonce-3']) {
        const r = await fetch(`${host.endpoint}/v1/session`, { method: 'POST', headers: signedHeaders(payload(n), { ts: clock, nonce: n }), body: payload(n) });
        expect(r.status).toBe(200);
      }
      const full = await fetch(`${host.endpoint}/v1/session`, { method: 'POST', headers: signedHeaders(payload('n4'), { ts: clock, nonce: 'nonce-4' }), body: payload('n4') });
      expect(full.status).toBe(503);
      // Advance clock past 300s TTL so expired nonces evict, then exhaust burst=10 -> 429
      clock += 301_000;
      const b0 = payload('after-ttl');
      expect((await fetch(`${host.endpoint}/v1/session`, { method: 'POST', headers: signedHeaders(b0, { ts: clock, nonce: 'after-ttl' }), body: b0 })).status).toBe(200);
    } finally { await host.stop(); await rm(stateDir, { recursive: true, force: true }); }
  });

  it('enforces token-bucket burst=10, refill=1/s rate limit with 429', async () => {
    let clock = 1_700_000_000_000;
    const stateDir = await mkdtemp(join(tmpdir(), 'gw-boot-rate-'));
    const host = await startGatewayHost({
      stateDir, mesh: durableHostFixture().mesh, listen: { host: '127.0.0.1', port: 0 },
      enableLoopbackHttpSessionMint: true, bootstrapSecret: SECRET, bootstrapNow: () => clock,
    });
    try {
      for (let i = 0; i < 10; i += 1) {
        const b = payload(`burst-${i}`);
        const r = await fetch(`${host.endpoint}/v1/session`, { method: 'POST', headers: signedHeaders(b, { ts: clock, nonce: `b-${i}` }), body: b });
        expect(r.status).toBe(200);
      }
      const b10 = payload('burst-10');
      const limited = await fetch(`${host.endpoint}/v1/session`, { method: 'POST', headers: signedHeaders(b10, { ts: clock, nonce: 'b-10' }), body: b10 });
      expect(limited.status).toBe(429);
      clock += 1_000;
      const refilled = await fetch(`${host.endpoint}/v1/session`, { method: 'POST', headers: signedHeaders(b10, { ts: clock, nonce: 'b-11' }), body: b10 });
      expect(refilled.status).toBe(200);
    } finally { await host.stop(); await rm(stateDir, { recursive: true, force: true }); }
  });

  it('bounds streaming body read before buffering (413) and isolates authenticated rate bucket from unauthenticated floods', async () => {
    let clock = 1_700_000_000_000;
    const memStore: GatewayStateStore = {
      load: async (): Promise<StoredState> => ({ schemaVersion: 1, revision: 0, sessions: {}, receipts: {} }),
      compareAndSet: async (_e, n) => ({ revision: n.revision }),
    };
    const handler = createLoopbackSessionMintHandler({
      service: new GatewaySessionService(memStore),
      ownerScopeRef: 'owner-a',
      bootstrapSecret: SECRET,
      now: () => clock,
    });
    // Streaming body > 65_536 bytes must cancel early without reading full stream
    let chunksRead = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (chunksRead >= 64) { controller.close(); return; }
        chunksRead += 1;
        controller.enqueue(new Uint8Array(4_096).fill(65));
      },
    });
    const oversizedReq = new Request('http://127.0.0.1/v1/session', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-sentropic-bootstrap-proof': '0'.repeat(64),
        'x-sentropic-bootstrap-timestamp': String(clock),
        'x-sentropic-bootstrap-nonce': 'oversized-1',
      },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    const oversizedRes = await handler(oversizedReq);
    expect(oversizedRes?.status).toBe(413);
    expect(chunksRead).toBeLessThan(25);

    // Flood of 25 unauthenticated/forged requests hits per-peer failed-attempt 429 without starving valid HMAC callers
    const stateDir = await mkdtemp(join(tmpdir(), 'gw-boot-flood-'));
    const host = await startGatewayHost({
      stateDir, mesh: durableHostFixture().mesh, listen: { host: '127.0.0.1', port: 0 },
      enableLoopbackHttpSessionMint: true, bootstrapSecret: SECRET, bootstrapNow: () => clock,
    });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 25; i += 1) {
        const badBody = payload(`bad-${i}`);
        const bad = await fetch(`${host.endpoint}/v1/session`, {
          method: 'POST',
          headers: signedHeaders(badBody, { secret: 'wrong-secret-012345678901234567890123456789', ts: clock, nonce: `bad-${i}` }),
          body: badBody,
        });
        statuses.push(bad.status);
      }
      expect(statuses[0]).toBe(401);
      expect(statuses.at(-1)).toBe(429);
      // Legitimate authenticated caller still gets its full burst=10 at the same clock tick
      for (let i = 0; i < 10; i += 1) {
        const okBody = payload(`ok-${i}`);
        const ok = await fetch(`${host.endpoint}/v1/session`, {
          method: 'POST', headers: signedHeaders(okBody, { ts: clock, nonce: `ok-${i}` }), body: okBody,
        });
        expect(ok.status).toBe(200);
      }
    } finally { await host.stop(); await rm(stateDir, { recursive: true, force: true }); }
  });
});
