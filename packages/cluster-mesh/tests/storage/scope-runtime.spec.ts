// K3 gate: scope binding proof (L3a v4.1 frozen §4, §17.1 K3).
// Test-first RED: imports the K3 kernel before it exists.

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createKernel, createStaticAuthorityPort } from '../../src/storage/kernel.js';
import { StorageDeniedError } from '../../src/storage/errors.js';
import * as storageIndex from '../../src/storage/index.js';
import { CONSUMER_REQUIREMENTS, PROFILE_IDS } from '../../src/storage/profiles.js';
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

describe('K3 binding: sealed handle invariants', () => {
  it('K3-FIX4 prototype check replacement throws and reads stay denied (a)', async () => {
    const kernel = createKernel({ moduleId: 'comments' });
    const reader = kernel.bindNew(grantFor({ token: 'token-seal4-a', operations: ['read'] }));
    const proto = Object.getPrototypeOf(reader) as Record<string, unknown>;
    // Negative control: without the prototype freeze this assignment holds
    // and the read-only handle below escalates to write.
    expect(Object.isFrozen(proto)).toBe(true);
    expect(() => {
      proto['requireOperation'] = () => undefined;
    }).toThrow();
    await expectCode(
      async () => reader.appendChain('seal4-esc', { id: 'e', bytes: '{}', hash: 'h-seal4-esc' }, { kind: 'absent', allocation: '0' }),
      'denied',
      'K3-FIX4 sealed prototype: a replaced check cannot escalate a read-only handle',
    );
  });

  it('K3-FIX4 bound scope mutation throws and the victim chain stays put (b)', async () => {
    const kernel = createKernel({ moduleId: 'comments' });
    const victim = kernel.bindNew(
      grantFor({ token: 'token-seal4-victim', scope: { tenantId: 'tenant-b', workspaceId: 'workspace-a' } }),
    );
    await victim.appendChain('seal4-secret', { id: 's', bytes: '{}', hash: 'h-seal4-secret' }, { kind: 'absent', allocation: '0' });
    const alien = kernel.bindNew(grantFor({ token: 'token-seal4-alien' }));
    const alienScope = (alien as unknown as { boundScope: { tenantId: string } }).boundScope;
    // Negative control: without the scope freeze this assignment holds.
    expect(Object.isFrozen(alienScope)).toBe(true);
    expect(() => {
      alienScope.tenantId = 'tenant-b';
    }).toThrow();
    expect(await alien.readHead('seal4-secret')).toBe(null);
    expect(await victim.readHead('seal4-secret')).toBe('h-seal4-secret');
  });

  it('K3-FIX4 prototype method wrappers throw and foreign bytes persist clean (c)', async () => {
    const kernelA = createKernel({ moduleId: 'comments' });
    const kernelB = createKernel({ moduleId: 'engram-live' });
    const writer = kernelB.bindNew(grantFor({ token: 'token-seal4-c', moduleId: 'engram-live' }));
    const proto = Object.getPrototypeOf(writer) as Record<string, unknown>;
    // Negative control: without the prototype freeze the wrapper installs
    // and the persisted bytes below come back tampered.
    expect(Object.isFrozen(proto)).toBe(true);
    expect(() => {
      proto['appendChain'] = async () => ({ seq: 0, hash: 'h-tampered' });
    }).toThrow();
    expect(() => {
      proto['readChain'] = async () => [];
    }).toThrow();
    await writer.appendChain('seal4-chain', { id: 'c', bytes: '{"clean":true}', hash: 'h-seal4-clean' }, { kind: 'absent', allocation: '0' });
    const rows = await writer.readChain('seal4-chain');
    expect(rows.map((entry) => entry.bytes)).toEqual(['{"clean":true}']);
    // One shared prototype across kernels: a handle of kernelA is sealed by
    // the same freeze.
    const readerA = kernelA.bindNew(grantFor({ token: 'token-seal4-c-a', operations: ['read'] }));
    expect(Object.getPrototypeOf(readerA)).toBe(proto);
  });

  it('K3-FIX handle invariants cannot be replaced at runtime', async () => {
    const kernel = createKernel({ moduleId: 'comments' });
    const reader = kernel.bindNew(grantFor({ token: 'token-brand-read', operations: ['read'] }));
    // Escalation: the grant property is sealed; replacing it throws and the
    // original read-only grant still denies writes.
    expect(() => {
      (reader as unknown as Record<string, unknown>)['grant'] = grantFor({ token: 'token-brand-evil' });
    }).toThrow();
    expect(() => {
      (reader as unknown as Record<string, unknown>)['requireOperation'] = () => undefined;
    }).toThrow();
    await expectCode(
      async () => reader.appendChain('brand-esc', { id: 'e', bytes: '{}', hash: 'h-brand-esc' }, { kind: 'absent', allocation: '0' }),
      'denied',
      'K3-FIX branding: a replaced grant cannot escalate a read-only handle',
    );
    // Tenant switch: the scope invariant is sealed; spoofing it is ignored.
    const victim = kernel.bindNew(
      grantFor({ token: 'token-brand-victim', scope: { tenantId: 'tenant-b', workspaceId: 'workspace-a' } }),
    );
    await victim.appendChain('brand-secret', { id: 's', bytes: '{}', hash: 'h-brand-secret' }, { kind: 'absent', allocation: '0' });
    const alien = kernel.bindNew(grantFor({ token: 'token-brand-alien' }));
    expect(() => {
      (alien as unknown as Record<string, unknown>)['boundScope'] = { tenantId: 'tenant-b', workspaceId: 'workspace-a' };
    }).toThrow();
    expect(await alien.readHead('brand-secret')).toBe(null);
  });

  it('K3-R5 backend and provider prototype replacement throws and handles stay bound (O1)', async () => {
    const kernel = createKernel({ moduleId: 'comments' });
    const victim = kernel.bindNew(
      grantFor({ token: 'token-o1-victim', scope: { tenantId: 'tenant-b', workspaceId: 'workspace-a' } }),
    );
    await victim.appendChain('o1-secret', { id: 's', bytes: '{}', hash: 'h-o1-secret' }, { kind: 'absent', allocation: '0' });
    const alien = kernel.bindNew(grantFor({ token: 'token-o1-alien' }));
    const backendProto = storageIndex.MemoryBackend.prototype as unknown as Record<string, unknown>;
    const providerProto = storageIndex.HmacExactHeadBoundaryProvider.prototype as unknown as Record<string, unknown>;
    // Negative controls: without the O1 freeze these assignments hold and
    // every handle below addresses the attacker-chosen scope.
    expect(Object.isFrozen(backendProto)).toBe(true);
    expect(Object.isFrozen(providerProto)).toBe(true);
    expect(() => {
      backendProto['scopeState'] = () => ({ chains: new Map([['o1-secret', { head: 'h-forged' }]]) });
    }).toThrow();
    expect(() => {
      providerProto['verify'] = () => null;
    }).toThrow();
    expect(await alien.readHead('o1-secret')).toBe(null);
    expect(await victim.readHead('o1-secret')).toBe('h-o1-secret');
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

  it('K3-FIX divergent re-issuance of a token is refused', async () => {
    const kernel = createKernel({ moduleId: 'comments' });
    const base = grantFor({ token: 'token-reissue-1' });
    kernel.bindNew(base);
    await expectCode(
      async () =>
        kernel.bindNew({ ...base, operations: ['read', 'write', 'publish'] } as typeof base),
      'denied',
      'K3-FIX binding: a second bindNew with widened operations is refused',
    );
    const rebound = kernel.bind(base);
    expect(await rebound.readHead('nothing')).toBe(null);
  });

  it('K3-FIX the adapter handle exposes no issuance', async () => {
    const kernel = createKernel({ moduleId: 'comments' });
    const grant = grantFor({ token: 'token-adapter-1' });
    kernel.bindNew(grant);
    const adapter = kernel.adapter();
    expect('bindNew' in (adapter as unknown as Record<string, unknown>)).toBe(false);
    expect('revoke' in (adapter as unknown as Record<string, unknown>)).toBe(false);
    const bound = adapter.bind(grant);
    expect(await bound.readHead('nothing')).toBe(null);
  });

  it('K3-FIX grants with an unexpected issuer are refused at the root', async () => {
    const kernel = createKernel({
      moduleId: 'comments',
      authority: createStaticAuthorityPort({ issuer: 'expected-issuer' }),
    });
    await expectCode(
      async () => kernel.bindNew(grantFor({ token: 'token-rogue-1', issuer: 'rogue' })),
      'denied',
      'K3-FIX binding: a grant with an unexpected issuer is refused',
    );
  });

  it('K3-FIX adapter handles expose no issuance state', async () => {
    const kernel = createKernel({ moduleId: 'comments' });
    const grant = grantFor({ token: 'token-surface-1' });
    kernel.bindNew(grant);
    const bound = kernel.adapter().bind(grant);
    const surface = bound as unknown as Record<string, unknown>;
    expect(surface['deps']).toBe(undefined);
    for (const key of Object.keys(surface)) {
      expect(['issued', 'revoked', 'backend', 'provider', 'nextCommitId', 'predicates', 'authority']).not.toContain(key);
    }
    // The public entry point carries no constructor and no deps interface.
    expect('ScopedRuntime' in storageIndex).toBe(false);
    expect('ScopedRuntimeDeps' in storageIndex).toBe(false);
    expect('ORDINARY_PROFILES' in storageIndex).toBe(true);
    // The frozen grant copy stays readable; the scope getter returns a copy.
    const view = bound.scope;
    view.tenantId = 'evil-tenant';
    view.workspaceId = 'evil-workspace';
    expect(bound.scope).toEqual({ tenantId: 'tenant-a', workspaceId: 'workspace-a' });
    expect(await bound.readHead('nothing')).toBe(null);
  });

  it('K3-FIX the authority port is re-attested on every operation', async () => {
    let attestations = 0;
    let open = true;
    const kernel = createKernel({
      moduleId: 'comments',
      authority: {
        attest: (): void => {
          attestations += 1;
          if (!open) throw new StorageDeniedError('policy changed');
        },
      },
    });
    const bound = kernel.bindNew(grantFor({ token: 'token-attest-1' }));
    const afterBind = attestations;
    expect(afterBind).toBeGreaterThan(0);
    await bound.readHead('nothing');
    expect(attestations).toBeGreaterThan(afterBind);
    open = false;
    await expectCode(
      async () => bound.readHead('nothing'),
      'denied',
      'K3-FIX binding: a changed authority policy denies without touching the grant',
    );
  });

  it('K3-FIX profile digests hash semantic definitions, not bare labels', async () => {
    const kernel = createKernel({ moduleId: 'comments' });
    const bound = kernel.bindNew(grantFor({ token: 'token-digest-1' }));
    const labelDigest = (profile: string): string =>
      createHash('sha256').update(`k3-ordinary-v1:${profile}:1`, 'utf8').digest('hex');
    for (const claim of bound.profiles) {
      expect(claim.digest).not.toBe(labelDigest(claim.profile));
    }
    expect(bound.capability('immutable-boundaries-v1').digest).toBe(
      createHash('sha256')
        .update(
          'k3-ordinary-v1:immutable-boundaries-v1:immutable-boundaries-v1:cursor-v2[HMAC-SHA256-128(module,scope,incarnation,keyId,selection,head,seq,allocation,ordering,position)];unknown-boundary-incomplete;no-lease;no-clock-expiry',
          'utf8',
        )
        .digest('hex'),
    );
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

  it('K3-FIX4 ordinary profiles are frozen against cross-handle planting (m1)', async () => {
    const kernel = createKernel({ moduleId: 'comments' });
    const planter = kernel.bindNew(grantFor({ token: 'token-prof4-planter' }));
    const witness = kernel.bindNew(grantFor({ token: 'token-prof4-witness' }));
    // Negative control: without the freeze the push below holds and the
    // planted profile becomes advertisable on the witness handle.
    expect(Object.isFrozen(planter.profiles)).toBe(true);
    for (const entry of planter.profiles) expect(Object.isFrozen(entry)).toBe(true);
    expect(() => {
      (planter.profiles as unknown as unknown[]).push({ profile: 'fenced-writers-v1', version: '1', digest: 'planted' });
    }).toThrow();
    expect(() => witness.capability('fenced-writers-v1' as never)).toThrow();
    expect(witness.profiles.map((entry) => entry.profile)).toEqual(['atomic-units-v1', 'immutable-chains-v1', 'immutable-boundaries-v1']);
  });

  it('K3-R5 exported profile catalogues are frozen against planting (O6)', async () => {
    // Negative control: without the O6 freeze the push below holds and a
    // planted id passes isProfileId on every handle.
    expect(Object.isFrozen(PROFILE_IDS)).toBe(true);
    expect(() => {
      (PROFILE_IDS as unknown as unknown[]).push('fenced-writers-v1');
    }).toThrow();
    expect(Object.isFrozen(CONSUMER_REQUIREMENTS)).toBe(true);
    for (const entry of Object.values(CONSUMER_REQUIREMENTS)) expect(Object.isFrozen(entry)).toBe(true);
    expect(() => {
      (CONSUMER_REQUIREMENTS as unknown as Record<string, unknown>)['m1-adapter'] = ['fenced-writers-v1'];
    }).toThrow();
  });
});
