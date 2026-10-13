// K3 gate: scope binding proof (L3a v4.1 frozen §4, §17.1 K3).
// Test-first RED: imports the K3 kernel before it exists.

import { describe, expect, it } from 'vitest';
import { createKernel } from '../../src/storage/kernel.js';
import { grantFor, runAuthorityCorpus } from './authority-corpus.js';
import { expectCode } from './atomic-corpus.js';

describe('K3 binding: authority corpus', () => {
  it('K3-RED forged, cross-module, escalation, expiry and revocation deny', async () => {
    let now = '2026-01-01T00:00:00.000Z';
    const kernel = createKernel({ moduleId: 'comments', now: () => now });
    await runAuthorityCorpus({
      store: kernel,
      grant: grantFor(),
      readGrant: grantFor({ token: 'token-read-1', operations: ['read'] }),
      setNow: (iso: string) => {
        now = iso;
      },
    });
  });
});

describe('K3 binding: frozen grant copies', () => {
  it('K3-RED caller-side grant mutation cannot escalate or switch scope', async () => {
    const kernel = createKernel({ moduleId: 'comments' });
    const operations: Array<'read' | 'write' | 'publish' | 'maintain'> = ['read'];
    const grant = grantFor({ token: 'token-frozen-1', operations });
    const bound = kernel.bindNew(grant);
    operations.push('write');
    await expectCode(
      async () => bound.appendChain('frozen-chain', { id: 'm', bytes: '{}', hash: 'hm-1' }, { kind: 'absent', allocation: '0' }),
      'denied',
      'K3-RED binding: operations forged after binding stay denied',
    );
    const scope: { tenantId: string; workspaceId: string } = { tenantId: 'tenant-a', workspaceId: 'workspace-a' };
    const scopeBound = kernel.bindNew(grantFor({ token: 'token-frozen-2', scope }));
    scope.workspaceId = 'workspace-b';
    await scopeBound.appendChain('frozen-chain', { id: 's', bytes: '{}', hash: 'hs-1' }, { kind: 'absent', allocation: '0' });
    expect(await scopeBound.readHead('frozen-chain')).toBe('hs-1');
  });
});

describe('K3 binding: revalidation and capabilities', () => {
  it('K3-RED expired and revoked grants deny every operation', async () => {
    let now = '2026-01-01T00:00:00.000Z';
    const kernel = createKernel({ moduleId: 'comments', now: () => now });
    const leased = kernel.bindNew(grantFor({ token: 'token-lease-k3', lifetime: { kind: 'lease', expiresAt: '2030-01-01T00:00:00.000Z' } }));
    now = '2031-06-01T00:00:00.000Z';
    await expectCode(async () => leased.readHead('any'), 'denied', 'K3-RED binding: an expired lease is denied even for reads');
    now = '2026-01-01T00:00:00.000Z';
    const doomed = kernel.bindNew(grantFor({ token: 'token-revoked-k3' }));
    kernel.revoke('token-revoked-k3');
    await expectCode(async () => doomed.readHead('any'), 'denied', 'K3-RED binding: revocation denies queued work');
  });

  it('K3-RED advertised profiles expose ordinary capabilities only', async () => {
    const kernel = createKernel({ moduleId: 'comments' });
    const bound = kernel.bindNew(grantFor({ token: 'token-caps-k3', operations: ['read', 'write', 'maintain'] }));
    const profiles = bound.profiles.map((entry) => entry.profile);
    expect(profiles).toContain('atomic-units-v1');
    expect(profiles).toContain('immutable-chains-v1');
    expect(profiles).toContain('immutable-boundaries-v1');
    expect(() => bound.capability('staged-units-v1' as never)).toThrow();
  });
});
