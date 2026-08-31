import { createClusterMeshPlugin } from '@sentropic/cluster-mesh';
import {
  FOCUS_OWNER_SIGNATURE_CONTRACT_VERSION,
  type TrackOwnerSignatureWrite,
} from '@sentropic/focus';
import type { MiddlewareHandler } from 'hono';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { app as productApp } from '../../src/app';
import {
  PINNED_TRACK_PROVIDER,
  createTrackNamespaceModule,
} from '../../src/routes/namespaces/track';
import { clusterMeshAdapter } from '../../src/services/cluster-mesh-adapter';

const passAuth: MiddlewareHandler = async (_context, next) => next();
const runtime = clusterMeshAdapter.sessionControl!.runtime;

describe('cluster mesh Track adapter', () => {
  it('mounts a truthful 503 shell on the product root while the provider is absent', async () => {
    const response = await productApp.request('/api/v1/track/evidence/workspace-1/decision-1');
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'track_provider_unavailable' });
    expect((await productApp.request('/api/v1/api/v1/track/evidence/workspace-1/decision-1')).status)
      .toBe(404);
  });

  it('remains independently disableable without a fallback route', async () => {
    const app = new Hono().route('/api/v1', createClusterMeshPlugin({
      runtime,
      namespaces: [createTrackNamespaceModule()],
    }));
    expect((await app.request('/api/v1/track/cursor/workspace-1')).status).toBe(404);
  });

  it('shadows pinned deterministic reads and refuses a valid write intent with zero effects', async () => {
    const effectBoundary = vi.fn(async (_intent: TrackOwnerSignatureWrite) => ({ effectRef: 'track:1' }));
    const provider = {
      descriptor: PINNED_TRACK_PROVIDER,
      readEvidence: vi.fn(async () => ({ reference: 'evidence:decision-1', digest: 'sha256:evidence' })),
      readCursor: vi.fn(async () => ({ reference: 'cursor:workspace-1:7', digest: 'sha256:cursor' })),
      effectBoundary,
    };
    const app = new Hono().route('/api/v1', createClusterMeshPlugin({
      runtime,
      namespaces: [createTrackNamespaceModule({ enabled: true, authenticate: passAuth, provider })],
    }));

    const evidence = await app.request('/api/v1/track/evidence/workspace-1/decision-1');
    const cursor = await app.request('/api/v1/track/cursor/workspace-1');
    expect(evidence.status).toBe(200);
    expect(cursor.status).toBe(200);
    expect(provider.readEvidence).toHaveBeenCalledOnce();
    expect(provider.readCursor).toHaveBeenCalledOnce();

    const validIntent: TrackOwnerSignatureWrite = {
      contractVersion: FOCUS_OWNER_SIGNATURE_CONTRACT_VERSION,
      target: { workspace: 'workspace-1', decisionId: 'decision-1' },
      attestation: {
        attester: {
          principalId: 'owner-1',
          canonicalIdentity: { issuer: 'test', subject: 'human:owner@example.com' },
          authenticatedAt: '2026-08-31T12:00:00.000Z',
        },
      },
      relayer: {
        transport: 'http',
        relayerId: 'test',
        canonicalIdentity: { issuer: 'test', subject: 'track-shadow' },
      },
      idempotencyKey: 'valid-track-intent-1',
    };
    const write = await app.request('/api/v1/track/intents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validIntent),
    });
    expect(write.status).toBe(404);
    expect(effectBoundary).not.toHaveBeenCalled();
  });
});
