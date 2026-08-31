import { readFileSync } from 'node:fs';
import {
  createClusterMeshPlugin,
  createClusterMeshRuntime,
  createGraphifyMemoryAdapter,
  type GraphifyMemoryContractEvidence,
  type H2aGraphifyMemoryPort,
} from '@sentropic/cluster-mesh';
import type { VerifiedInvocationContext } from '@sentropic/contracts';
import { Hono, type MiddlewareHandler } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { app as productApp } from '../../src/app';
import { createMemoryNamespaceModule } from '../../src/routes/namespaces/memory';

interface Authorization { readonly principalRef: string; readonly workspaceRef: string }
interface QueryIntent { readonly questionRef: string }

const passAuth: MiddlewareHandler = async (_context, next) => next();
const evidence = Object.freeze({
  contractVersion: 'synthetic-h2a-graphify-memory/v2',
  fixtureDigest: 'sha256:synthetic-memory-fixture',
  releaseEvidenceRef: 'release:synthetic-graphify',
}) satisfies GraphifyMemoryContractEvidence;
const verified: VerifiedInvocationContext = {
  invocationId: 'invocation-1', correlationId: 'correlation-1', generationId: 'generation-1',
  principal: { principalId: 'principal-1', kind: 'human', verifierId: 'verifier-1' },
  workspace: { bindingId: 'binding-1', workspaceId: 'workspace-1', revision: '7' },
  scopes: ['memory:query'], policyRevision: 'policy-3', issuedAt: '2026-08-31T12:00:00.000Z',
};

const runtime = createClusterMeshRuntime({
  generationId: 'generation-1',
  config: { capacity: { poolSize: 1 } },
  context: { verify: vi.fn(async () => verified) },
  registration: { authorize: vi.fn(async () => ({ ok: false, reason: 'missing_registration' })) },
  receipts: { append: vi.fn(async () => undefined) },
});

const makeProvider = (
  providerEvidence: GraphifyMemoryContractEvidence = evidence,
): H2aGraphifyMemoryPort<Authorization, QueryIntent> => ({
  evidence: providerEvidence,
  mapAuthorization: vi.fn(async (context) => ({
    principalRef: context.principal.principalId,
    workspaceRef: context.workspace.workspaceId,
  })),
  mapQueryIntent: vi.fn(async (value) => {
    const questionRef = value && typeof value === 'object'
      ? (value as Record<string, unknown>).questionRef
      : undefined;
    return typeof questionRef === 'string' ? { questionRef } : undefined;
  }),
  evaluateEligibility: vi.fn(async () => ({
    eligible: true, receiptRef: 'graphify:eligibility-receipt:1',
  })),
  shadowQueryIntent: vi.fn(async () => ({
    cursorRef: 'graphify:cursor:17', receiptRef: 'graphify:query-receipt:1',
  })),
  revalidateFinal: vi.fn(async () => ({
    accepted: false, refusalRef: 'graphify:refusal:scope-changed',
  })),
});

const appWith = (module: ReturnType<typeof createMemoryNamespaceModule>) =>
  new Hono().route('/api/v1', createClusterMeshPlugin({ runtime, namespaces: [module] }));

describe('cluster mesh Graphify memory adapter', () => {
  it('mounts a truthful 503 shell while the external provider is absent', async () => {
    const response = await productApp.request('/api/v1/memory/query-intents', { method: 'POST' });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'memory_provider_unavailable' });
    expect((await productApp.request('/api/v1/api/v1/memory/query-intents', { method: 'POST' })).status)
      .toBe(404);
  });

  it('remains independently disableable without a fallback route', async () => {
    expect((await appWith(createMemoryNamespaceModule()).request(
      '/api/v1/memory/query-intents', { method: 'POST' },
    )).status).toBe(404);
  });

  it('rejects a fixture digest mismatch before authentication or Graphify', async () => {
    const provider = makeProvider({ ...evidence, fixtureDigest: 'sha256:mismatch' });
    const adapter = createGraphifyMemoryAdapter({ provider, expectedEvidence: evidence });
    const authenticate = vi.fn(passAuth);
    const response = await appWith(createMemoryNamespaceModule({
      enabled: true, adapter, authenticate, generationId: 'generation-1',
    })).request('/api/v1/memory/query-intents', { method: 'POST' });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'memory_provider_incompatible' });
    expect(authenticate).not.toHaveBeenCalled();
    expect(provider.mapAuthorization).not.toHaveBeenCalled();
  });

  it('maps authz below the route and refuses failed final revalidation', async () => {
    const provider = makeProvider();
    const adapter = createGraphifyMemoryAdapter({ provider, expectedEvidence: evidence });
    const response = await appWith(createMemoryNamespaceModule({
      enabled: true, adapter, authenticate: passAuth, generationId: 'generation-1',
    })).request('/api/v1/memory/query-intents', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cluster-mesh-invocation-id': 'invocation-1',
      },
      body: JSON.stringify({ questionRef: 'question:1' }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'memory_final_revalidation_refused',
      refusalRef: 'graphify:refusal:scope-changed',
    });
    expect(provider.evaluateEligibility).toHaveBeenCalledWith({
      authorization: { principalRef: 'principal-1', workspaceRef: 'workspace-1' },
      queryIntent: { questionRef: 'question:1' },
    });
    expect(provider.shadowQueryIntent).toHaveBeenCalledOnce();
    expect(provider.revalidateFinal).toHaveBeenCalledOnce();
  });

  it('keeps canonical memory persistence outside the application module', () => {
    const source = readFileSync('src/routes/namespaces/memory.ts', 'utf8');
    expect(source).not.toMatch(/from ['"][^'"]*(?:db|schema|storage|persistence)[^'"]*['"]/);
    expect(source).not.toMatch(/\bnew (?:Map|Set)\b|\b(?:writeFile|appendFile)\b/);
  });
});
