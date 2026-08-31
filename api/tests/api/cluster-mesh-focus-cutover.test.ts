import { createClusterMeshPlugin } from '@sentropic/cluster-mesh';
import type { CreateFocusRouterOptions } from '@sentropic/focus/hono';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { app as productApp } from '../../src/app';
import { db } from '../../src/db/client';
import { clusterMeshNamespaceCutovers } from '../../src/db/control-schema';
import {
  createFocusNamespaceModule,
} from '../../src/routes/namespaces/focus';
import { FOCUS_AUTHOR } from '../../src/routes/namespaces/focus-cutover';
import { clusterMeshAdapter } from '../../src/services/cluster-mesh-adapter';
import { PostgresClusterMeshCutoverStore } from '../../src/services/cluster-mesh/postgres-cutover-store';

const store = new PostgresClusterMeshCutoverStore();
const key = { compositionRoot: 'product' as const, namespace: '/focus' as const };
const clearCutover = () => db.delete(clusterMeshNamespaceCutovers).where(and(
  eq(clusterMeshNamespaceCutovers.compositionRoot, 'product'),
  eq(clusterMeshNamespaceCutovers.namespace, '/focus'),
));

const document = {
  ref: 'decision-1', subject: 'workspace-1', title: 'Focus decision', hash: 'hash-1', cursor: 'count:1',
  sections: [], interactions: [], provenance: { source: 'track:test', readAt: '2026-08-31T12:00:00.000Z' },
  amendmentTrace: [],
};

const buildCandidate = () => {
  let effects = 0;
  const readDecision = vi.fn().mockResolvedValue({ status: 'found', document });
  const routerOptions: CreateFocusRouterOptions = {
    resolvePrincipal: async () => ({
      userId: 'user-1', sessionId: 'session-1', authenticatedAt: '2026-08-31T12:00:00.000Z',
      workspaceId: 'workspace-1', email: 'owner@example.com', role: 'admin_app',
    }),
    decisionValidator: { validate: vi.fn().mockResolvedValue({ authorized: true }) },
    tenancy: { authorize: vi.fn().mockResolvedValue(true) },
    track: {
      readDecision,
      getOwnerSignaturePort: async () => ({
        contractVersion: 'track-owner-signature/1.0.0',
        appendOwnerSignature: async () => ({ status: 'written', recordId: 'record-1' }),
        readOwnerSignature: async () => undefined,
      }),
    },
    ownerSignature: {
      createSession: () => ({
        sign: async (request) => {
          effects += 1;
          return {
            status: 'signed', duplicate: false,
            persisted: {
              contractVersion: 'track-owner-signature/1.0.0', target: request.target,
              attestation: {
                attester: {
                  principalId: 'user-1',
                  canonicalIdentity: { issuer: 'test', subject: 'human:owner@example.com' },
                  authenticatedAt: '2026-08-31T12:00:00.000Z',
                },
              },
              relayer: {
                transport: 'http', relayerId: 'test',
                canonicalIdentity: { issuer: 'test', subject: 'focus' },
              },
              idempotencyKey: request.idempotencyKey, recordId: 'record-1',
            },
          };
        },
      }),
    },
  };
  const app = new Hono().route('/api/v1', createClusterMeshPlugin({
    runtime: clusterMeshAdapter.sessionControl!.runtime,
    namespaces: [createFocusNamespaceModule({
      authenticate: async (_context, next) => next(),
      routerOptions,
    })],
  }));
  return { app, effects: () => effects, readDecision };
};

describe('cluster mesh focus cutover', () => {
  beforeEach(clearCutover);
  afterEach(clearCutover);

  it('mounts the Focus factory on the product root', async () => {
    expect((await productApp.request('/api/v1/focus/decisions/decision-1')).status).toBe(401);
    expect((await productApp.request('/api/v1/api/v1/focus/decisions/decision-1')).status).toBe(404);
  });

  it('shadows the Track read and signature intent, selects one author, and rolls back', async () => {
    const candidate = buildCandidate();
    const read = await candidate.app.request('/api/v1/focus/decisions/decision-1');
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toEqual({ item: document });
    expect(candidate.readDecision).toHaveBeenCalledOnce();

    const invalidIntent = await candidate.app.request('/api/v1/focus/owner-signatures', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision_id: '' }),
    });
    expect(invalidIntent.status).toBe(400);
    expect(candidate.effects()).toBe(0);

    const signature = await candidate.app.request('/api/v1/focus/owner-signatures', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision_id: 'decision-1', idempotency_key: 'intent-1' }),
    });
    expect(signature.status).toBe(201);
    expect(candidate.effects()).toBe(1);

    const active = await store.find(key);
    expect(active).toMatchObject({
      activeAuthor: FOCUS_AUTHOR, status: 'active', previousGenerationId: 'legacy-api-focus-v1',
      shadowComparison: { effectsDuplicated: false },
    });
    await store.rollback(key, active!.previousGenerationId!);
    await expect(store.verifyRollback(key)).resolves.toMatchObject({ reversible: true });
    const blocked = await candidate.app.request('/api/v1/focus/decisions/decision-1');
    expect(blocked.status).toBe(503);
    await expect(blocked.json()).resolves.toEqual({ error: 'wrong_author' });
  });

  it('is disableable without selecting a fallback author', async () => {
    const app = new Hono().route('/api/v1', createClusterMeshPlugin({
      runtime: clusterMeshAdapter.sessionControl!.runtime,
      namespaces: [createFocusNamespaceModule({ enabled: false })],
    }));
    expect((await app.request('/api/v1/focus/decisions/decision-1')).status).toBe(404);
    expect(await store.find(key)).toBeNull();
  });
});
