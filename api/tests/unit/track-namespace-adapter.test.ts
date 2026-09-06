import type { MiddlewareHandler } from 'hono';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import {
  PINNED_TRACK_PROVIDER,
  createTrackNamespaceModule,
  isTrackProviderCompatible,
  type ExternalTrackReadPort,
} from '../../src/routes/namespaces/track';

const passAuth: MiddlewareHandler = async (_context, next) => next();
const ports = { context: {} as never, receipts: {} as never };
const makeProvider = (
  descriptor = PINNED_TRACK_PROVIDER,
): ExternalTrackReadPort => ({
  descriptor,
  readEvidence: vi.fn(async ({ workspace, decisionId }) => ({
    reference: `evidence:${workspace}:${decisionId}`,
    digest: 'sha256:evidence',
  })),
  readCursor: vi.fn(async ({ workspace }) => ({
    reference: `cursor:${workspace}:7`,
    digest: 'sha256:cursor',
  })),
});

describe('Track namespace adapter', () => {
  it('requires the exact external package, version, read contract and artifact digest', () => {
    expect(isTrackProviderCompatible(PINNED_TRACK_PROVIDER)).toBe(true);
    for (const descriptor of [
      { ...PINNED_TRACK_PROVIDER, packageName: '@other/track' },
      { ...PINNED_TRACK_PROVIDER, packageVersion: '0.91.2' },
      { ...PINNED_TRACK_PROVIDER, readContractMajor: 2 },
      { ...PINNED_TRACK_PROVIDER, packageDigest: 'sha512:mismatch' },
    ]) expect(isTrackProviderCompatible(descriptor)).toBe(false);
  });

  it('keeps the mount disabled by default', () => {
    expect(createTrackNamespaceModule().enabled).toBe(false);
  });

  it('returns 503 before authentication when the external provider is absent', async () => {
    const authenticate = vi.fn(passAuth);
    const module = createTrackNamespaceModule({ enabled: true, authenticate });
    const app = new Hono().route('/track', module.createRouter(ports));

    const response = await app.request('/track/evidence/workspace-1/decision-1');
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'track_provider_unavailable' });
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('rejects a digest mismatch without invoking either read author', async () => {
    const provider = makeProvider({ ...PINNED_TRACK_PROVIDER, packageDigest: 'sha512:mismatch' });
    const module = createTrackNamespaceModule({ enabled: true, authenticate: passAuth, provider });
    const app = new Hono().route('/track', module.createRouter(ports));

    const response = await app.request('/track/cursor/workspace-1');
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'track_provider_incompatible' });
    expect(provider.readEvidence).not.toHaveBeenCalled();
    expect(provider.readCursor).not.toHaveBeenCalled();
  });

  it('selects one compatible author for deterministic evidence and cursor reads', async () => {
    const provider = makeProvider();
    const module = createTrackNamespaceModule({ enabled: true, authenticate: passAuth, provider });
    const app = new Hono().route('/track', module.createRouter(ports));

    const evidence = await app.request('/track/evidence/workspace-1/decision-1');
    expect(evidence.status).toBe(200);
    await expect(evidence.json()).resolves.toEqual({
      item: { reference: 'evidence:workspace-1:decision-1', digest: 'sha256:evidence' },
    });
    const cursor = await app.request('/track/cursor/workspace-1');
    expect(cursor.status).toBe(200);
    await expect(cursor.json()).resolves.toEqual({
      item: { reference: 'cursor:workspace-1:7', digest: 'sha256:cursor' },
    });
    expect(provider.readEvidence).toHaveBeenCalledOnce();
    expect(provider.readCursor).toHaveBeenCalledOnce();
  });
});
