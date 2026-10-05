import * as mesh from '@sentropic/llm-mesh';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isJudgeOnlyProvider, isProviderId } from '../../src/services/provider-runtime';

afterEach(() => vi.restoreAllMocks());

describe('judge-only chat selection', () => {
  it('uses the explicit profile marker before real judge-provider activation', () => {
    const original = mesh.getProviderProfile;
    const profile = vi.spyOn(mesh, 'getProviderProfile').mockImplementation((id) => (
      id === 'muse' ? { ...original(id), judgeOnly: true } : original(id)
    ));

    expect(isProviderId('muse')).toBe(true);
    expect(isJudgeOnlyProvider('muse')).toBe(true);
    expect(isJudgeOnlyProvider('openai')).toBe(false);
    profile.mockClear();
    expect(isJudgeOnlyProvider('unknown-provider')).toBe(false);
    expect(profile).not.toHaveBeenCalled();
  });

  it('keeps an unmarked local provider with an empty model inventory eligible', () => {
    expect(mesh.listModelProfilesByProvider('local')).toEqual([]);
    expect(mesh.getProviderProfile('local').judgeOnly).toBeUndefined();
    expect(isJudgeOnlyProvider('local')).toBe(false);
  });
});
