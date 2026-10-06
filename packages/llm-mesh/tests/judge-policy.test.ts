import { describe, expect, it, vi } from 'vitest';
import { resolveJudgeAuth, preflightJudgeRequest } from '../src/judge/service.js';
import { createJevAdapter } from '../src/judge/adapter.js';
import { createProviderRegistry } from '../src/registry.js';
import { judgeRequest, qualifiedDescriptor } from './judge-fixtures.js';

const auth = () => ({ material: { type: 'environment-token' as const, envVar: 'JEV_API_KEY', token: 'synthetic-key' },
  descriptor: { sourceType: 'environment-token' as const } });
describe('concrete host auth and descriptive retention', () => {
  it('requests only the environment source and detaches concrete secret material', async () => {
    const supplied = auth();
    const resolver = vi.fn().mockResolvedValue(supplied);
    const result = await resolveJudgeAuth(qualifiedDescriptor(), resolver);
    expect(resolver).toHaveBeenCalledExactlyOnceWith({ providerId: 'typesafe', modelId: 'jev-1.13.0', preferredSources: ['environment-token'] });
    expect(result.ok).toBe(true);
    supplied.material.token = 'changed';
    expect(result.ok && result.auth.material).toMatchObject({ token: 'synthetic-key' });
    expect(result.ok && Object.isFrozen(result.auth.material)).toBe(true);
  });
  it.each([{ type: 'environment-token', envVar: 'JEV_API_KEY' },
    { type: 'environment-token', envVar: 'JEV_API_KEY', token: '' },
    { type: 'environment-token', envVar: 'JEV_API_KEY', token: ' ' },
    { type: 'environment-token', envVar: 'OTHER_KEY', token: 'synthetic-key' },
    { type: 'user-token', userId: 'other-owner', token: 'synthetic-key' },
    { type: 'direct-token', token: 'synthetic-key' }])('refuses name-only, blank and alternate custody material', async (material) => {
    expect(await resolveJudgeAuth(qualifiedDescriptor(), vi.fn().mockResolvedValue({ ...auth(), material })))
      .toEqual({ ok: false, code: 'CREDENTIAL_MISSING' });
  });
  it('allows unknown published retention and refuses a requested unsupported retention policy before auth', async () => {
    const descriptor = qualifiedDescriptor();
    const resolver = vi.fn().mockResolvedValue(auth());
    const adapter = createJevAdapter({ descriptor, transport: { send: vi.fn() } });
    const options = { registry: createProviderRegistry([adapter]), resolveEvaluator: () => descriptor };
    const allowed = await preflightJudgeRequest(judgeRequest(), options);
    expect(allowed.ok && allowed.descriptor.retention.status).toBe('unknown');
    expect((await resolveJudgeAuth(descriptor, resolver)).ok).toBe(true);
    resolver.mockClear();
    expect(await preflightJudgeRequest({ ...judgeRequest(), policy: { zdr: 'required' } }, options))
      .toEqual({ ok: false, code: 'CAPABILITY_UNSUPPORTED' });
    expect(resolver).not.toHaveBeenCalled();
  });
  it('sanitizes credential authority exceptions', async () => {
    const result = await resolveJudgeAuth(qualifiedDescriptor(), vi.fn().mockRejectedValue(new Error('synthetic-key content-canary')));
    expect(result).toEqual({ ok: false, code: 'CREDENTIAL_MISSING' });
  });
});
