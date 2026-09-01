import { createClusterMeshPlugin } from '@sentropic/cluster-mesh';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { app as productApp } from '../../src/app';
import { db } from '../../src/db/client';
import { clusterMeshNamespaceCutovers } from '../../src/db/control-schema';
import {
  createBusinessNamespaceModule,
  createBusinessTransportRouter,
  BUSINESS_PATHS,
  type BusinessNamespacePorts,
} from '../../src/routes/namespaces/business';
import { productBusinessPorts } from '../../src/routes/namespaces/business/product-ports';
import { clusterMeshAdapter } from '../../src/services/cluster-mesh-adapter';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
  type TestUser,
} from '../utils/auth-helper';

const key = { compositionRoot: 'product' as const, namespace: '/business' as const };
const clearCutover = () => db.delete(clusterMeshNamespaceCutovers).where(and(
  eq(clusterMeshNamespaceCutovers.compositionRoot, key.compositionRoot),
  eq(clusterMeshNamespaceCutovers.namespace, key.namespace),
));
const candidate = (ports: BusinessNamespacePorts = productBusinessPorts, enabled = true) =>
  new Hono().route('/api/v1', createClusterMeshPlugin({
    runtime: clusterMeshAdapter.sessionControl!.runtime,
    namespaces: [createBusinessNamespaceModule({ enabled, ports })],
    mounts: { '/business': '/' },
  }));

describe('cluster mesh business pre-deletion shadow', () => {
  let user: TestUser;

  beforeEach(async () => {
    await clearCutover();
    user = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    await clearCutover();
    await cleanupAuthData();
  });

  it('matches a safe legacy read and dispatches one validated mutation intent', async () => {
    const path = '/api/v1/organizations';
    const legacy = await authenticatedRequest(productApp, 'GET', path, user.sessionToken!);
    const shadow = await authenticatedRequest(candidate(), 'GET', path, user.sessionToken!);
    const legacyBody = await legacy.text();
    expect(shadow.status).toBe(legacy.status);
    expect(await shadow.text()).toBe(legacyBody);

    const createIntent = vi.fn();
    const organizations = new Hono().post('/', (context) => {
      createIntent();
      return context.json({ id: 'candidate-only' }, 201);
    });
    const ports = {
      ...productBusinessPorts,
      organizations: { createRouter: () => organizations },
    };
    const intent = await authenticatedRequest(
      candidate(ports), 'POST', path, user.sessionToken!, { name: 'Validated intent' },
    );
    expect(intent.status).toBe(201);
    expect(createIntent).toHaveBeenCalledTimes(1);

    const unchanged = await authenticatedRequest(productApp, 'GET', path, user.sessionToken!);
    expect(await unchanged.text()).toBe(legacyBody);
  });

  it('enumerates every preserved business path without a transport catch-all', () => {
    const paths = [...new Set(
      createBusinessTransportRouter(productBusinessPorts).routes
        .filter(({ method }) => method !== 'ALL')
        .map(({ path }) => path),
    )].sort();
    expect(paths).toEqual([...BUSINESS_PATHS].sort());
    expect(paths).not.toContain('/*');
  });
});
