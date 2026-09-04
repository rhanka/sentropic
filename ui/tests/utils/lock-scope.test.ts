import { describe, expect, it } from 'vitest';
import { buildLockScopeKey } from '$lib/utils/lock-scope';

describe('buildLockScopeKey', () => {
  const ready = {
    hydrated: true,
    userId: 'user-a',
    workspaceId: 'workspace-a',
    targetId: 'object-a',
  };

  it('blocks startup until the complete tenant scope is ready', () => {
    expect(buildLockScopeKey({ ...ready, hydrated: false })).toBeNull();
    expect(buildLockScopeKey({ ...ready, userId: null })).toBeNull();
    expect(buildLockScopeKey({ ...ready, workspaceId: null })).toBeNull();
    expect(buildLockScopeKey({ ...ready, targetId: null })).toBeNull();
  });

  it('changes with every lock and presence fence', () => {
    const key = buildLockScopeKey(ready);
    expect(key).not.toBeNull();
    expect(buildLockScopeKey({ ...ready, userId: 'user-b' })).not.toBe(key);
    expect(buildLockScopeKey({ ...ready, workspaceId: 'workspace-b' })).not.toBe(key);
    expect(buildLockScopeKey({ ...ready, targetId: 'object-b' })).not.toBe(key);
  });
});
