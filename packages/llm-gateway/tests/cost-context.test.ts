import { describe, expect, it, vi } from 'vitest';
import { PersonalPassthroughCallerAuth, VerifiedCostContextResolver } from '../src/index.js';

const principal = { tenantId: 'tenant', principalId: 'user', source: 'gateway',
  ownerScopeRef: 'enrolled:exact-owner', workspaceId: 'workspace', budgetScope: 'personal' };
const context = { method: 'POST', url: 'https://gateway.test/v1/messages', requestId: 'generated' };

describe('trusted cost context', () => {
  it('projects only trusted identity, preserving owner and optional scopes', () => {
    const resolver = new VerifiedCostContextResolver();
    const cost = resolver.resolve(principal, context);
    expect(cost).toEqual({ ...principal, correlationId: 'generated', callSite: 'llm-gateway' });
    expect(resolver.resolve(principal, context)).not.toBe(cost);
    expect(resolver.resolve(principal, { ...context, requestId: 'next' })?.correlationId).toBe('next');
  });
  it.each(['tenantId', 'principalId', 'source', 'ownerScopeRef'])('denies empty trusted %s', key => {
    const resolver = new VerifiedCostContextResolver();
    for (const value of ['', ' ', undefined]) {
      expect(resolver.resolve({ ...principal, [key]: value }, context)).toBeUndefined();
    }
    expect(resolver.resolve(principal, { ...context, requestId: '' })).toBeUndefined();
  });
  it('ignores spoofed identity and correlation headers with an explicit resolver', async () => {
    const auth = new PersonalPassthroughCallerAuth({ verifyToken: { verify: () => principal },
      costContextResolver: new VerifiedCostContextResolver() });
    expect(await auth.verify({ authorization: 'Bearer token', 'x-correlation-id': 'attacker',
      'x-tenant-id': 'attacker', 'x-owner-scope-ref': 'attacker' }, context))
      .toEqual({ ok: true, cost: { ...principal, correlationId: 'generated', callSite: 'llm-gateway' } });
  });
  it('never falls back after resolver denial or exception', async () => {
    const resolve = vi.fn(() => undefined);
    const auth = new PersonalPassthroughCallerAuth({ verifyToken: { verify: () => principal },
      costContextResolver: { resolve } });
    expect(await auth.verify({ authorization: 'Bearer t' }, context)).toMatchObject({ ok: false });
    resolve.mockImplementation(() => { throw Error('store unavailable'); });
    await expect(auth.verify({ authorization: 'Bearer t' }, context)).rejects.toThrow();
  });
  it('rejects conflicting correlation configuration', () => {
    for (const extra of [{ correlationHeader: 'x-correlation-id' }, { correlation: { next: () => 'r' } }]) {
      expect(() => new PersonalPassthroughCallerAuth({ verifyToken: { verify: () => principal },
        costContextResolver: new VerifiedCostContextResolver(), ...extra })).toThrow('correlation');
    }
  });
});
