/**
 * Gateway lifecycle integration — real HTTP over loopback (Lot 5).
 *
 * Boots the real router behind `node:http` on an ephemeral port and drives it
 * with real `fetch` round-trips (no `app.request` shortcut): boot serves
 * health + catalog, restart keeps serving, a newly enrolled account appears
 * without code change, and a rotated-out caller token is rejected while the
 * fresh token serves. Fixture pool + transport only — no network, no secrets.
 */

import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import type { VerifiedPrincipal } from '../src/index.js';
import { FixtureTransport } from './fixtures/transport.js';
import { authHeaders, buildHarness, twoAccountPool } from './fixtures/harness.js';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(
    (server) => new Promise<void>((resolve) => server.close(() => resolve())),
  ));
});

const serve = async (app: { fetch: (request: Request) => Response | Promise<Response> }) => {
  const server = createServer(async (req, res) => {
    const rawBody = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
    const url = `http://127.0.0.1${req.url ?? '/'}`;
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
      else if (value !== undefined) headers.set(key, value);
    }
    const response = await app.fetch(new Request(url, {
      method: req.method,
      headers,
      body: rawBody.length > 0 ? rawBody : undefined,
    }));
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    res.writeHead(response.status, responseHeaders);
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('ephemeral port unavailable');
  servers.push(server);
  return `http://127.0.0.1:${address.port}`;
};

describe('gateway lifecycle over real HTTP', () => {
  it('boots and serves health plus the caller-filtered catalog', async () => {
    const { app } = buildHarness({ transport: new FixtureTransport() });
    const base = await serve(app);

    const health = await fetch(`${base}/healthz`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok', mode: 'personal-passthrough' });

    const anonymous = await fetch(`${base}/v1/models`);
    expect(anonymous.status).toBe(401);

    const catalog = await fetch(`${base}/v1/models`, { headers: authHeaders('user-a') });
    expect(catalog.status).toBe(200);
    const body = (await catalog.json()) as { data: { id: string }[] };
    expect(body.data.map((m) => m.id).sort()).toEqual(
      ['claude-opus-4-7', 'claude-sonnet-4-6', 'gpt-5.5'],
    );
  });

  it('keeps serving across restart with fresh state', async () => {
    const first = buildHarness({ transport: new FixtureTransport() });
    const baseA = await serve(first.app);
    expect((await (await fetch(`${baseA}/healthz`)).json())).toEqual(
      { status: 'ok', mode: 'personal-passthrough' },
    );

    // Restart: close happens in afterEach; a rebuilt gateway serves again.
    const second = buildHarness({ transport: new FixtureTransport() });
    const baseB = await serve(second.app);
    const catalog = await fetch(`${baseB}/v1/models`, { headers: authHeaders('user-a') });
    expect(catalog.status).toBe(200);
    expect(first.metering.settlements).toHaveLength(0);
    expect(second.metering.settlements).toHaveLength(0);
  });

  it('serves a newly enrolled account with no code change', async () => {
    const transport = new FixtureTransport();
    const { app } = buildHarness({
      transport,
      accounts: [
        ...twoAccountPool(),
        {
          accountId: 'acct-muse',
          accountLabel: 'muse',
          targetProviderId: 'muse',
          transportProviderId: 'muse',
          accessToken: 'SECRET-MUSE-TOKEN-xyz',
          status: 'active',
          modelIds: ['muse-spark-1.3-contributor'],
          metadata: { ownerUserId: 'user-a' },
        },
      ],
    });
    const base = await serve(app);
    const catalog = await fetch(`${base}/muse-code/models`, { headers: authHeaders('user-a') });
    expect(catalog.status).toBe(200);
    const body = (await catalog.json()) as { data: { id: string }[] };
    expect(body.data.map((m) => m.id)).toContain('muse-spark-1.3-contributor');
  });

  it('rejects a rotated-out caller token while the fresh token serves', async () => {
    const verifyToken = {
      verify(token: string): VerifiedPrincipal | undefined {
        if (token === 'valid-old-user-a') return undefined;
        if (token === 'valid-user-a') {
          return {
            tenantId: 'tenant-1', principalId: 'user-a', workspaceId: 'ws-1',
            source: 'layer-c', budgetScope: 'personal',
          };
        }
        return undefined;
      },
    };
    const { app } = buildHarness({ transport: new FixtureTransport(), verifyToken });
    const base = await serve(app);

    const replayed = await fetch(`${base}/v1/models`, {
      headers: { authorization: 'Bearer valid-old-user-a' },
    });
    expect(replayed.status).toBe(401);

    const fresh = await fetch(`${base}/v1/models`, { headers: authHeaders('user-a') });
    expect(fresh.status).toBe(200);
  });
});
