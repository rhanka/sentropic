import { describe, expect, it } from 'vitest';
import { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE } from '../src/profile/index.js';
import { createRadarKeyDerivation, createArtifactCommand } from '../src/server/command-identity.js';
import { createLifecycleService, createMemoryLifecycleStore } from '../src/server/lifecycle.js';

const artifactId = '00000000-0000-4000-8000-000000000001';
export function parityProfile() {
  return compileArtifactsProfile({ ...RADAR_ARTIFACTS_PROFILE,
    selectedCapabilities: [...RADAR_ARTIFACTS_PROFILE.selectedCapabilities,
      'artifacts_get_source', 'artifacts_set_access', 'artifacts_delete'],
    operations: [...RADAR_ARTIFACTS_PROFILE.operations,
      { operation: 'get_source', limits: {}, defaults: {} },
      { operation: 'set_access', limits: { idempotencyKeyMaxUnits: 256 }, defaults: {} },
      { operation: 'delete', limits: { idempotencyKeyMaxUnits: 256 }, defaults: {} }],
  });
}
describe('P0 control contracts', () => {
  it('should require named read access, caller keys and a delete precondition', () => {
    const profile = parityProfile();
    const input = { artifactId, action: 'grant', principalId: 'bob', grant: 'read', idempotencyKey: ' k ' };
    expect(profile.validate('artifacts_set_access', input)).toEqual(input);
    for (const changes of [{ grant: 'source' }, { action: 'set-public' }, { idempotencyKey: ' ' }]) {
      expect(() => profile.validate('artifacts_set_access', { ...input, ...changes })).toThrow();
    }
    expect(() => profile.validate('artifacts_delete', { artifactId, idempotencyKey: 'k' })).toThrow();
    expect(() => profile.validate('artifacts_get_source', { artifactId, paths: ['a', 'a'] })).toThrow();
  });
  it('should exclude confirmation proof from the command identity', () => {
    const profile = parityProfile();
    const authority = { storageScopeId: 'scope', actorId: 'alice' };
    const derivation = createRadarKeyDerivation({ storageScopeId: 'scope', actorIds: ['alice'] });
    const args = { artifactId, expectedCurrentReleaseId: null, idempotencyKey: 'delete' };
    const first = createArtifactCommand(profile, 'artifacts_delete', args, authority, derivation);
    const confirmed = createArtifactCommand(profile, 'artifacts_delete', { ...args, confirmationRef: 'proof' }, authority, derivation);
    expect(first.identity).toEqual(confirmed.identity);
    expect(() => profile.validate('artifacts_delete', { ...args, confirmed: true })).toThrow();
    expect(() => profile.validate('artifacts_delete', { ...args, idempotencyKey: 'a'.repeat(257) })).toThrow();
  });
  it('should prevent legacy restoration after terminal deletion', async () => {
    const store = createMemoryLifecycleStore();
    const lifecycle = createLifecycleService(store);
    await lifecycle.register(artifactId, 'alice');
    await store.markTerminal(artifactId);
    await expect(lifecycle.restore(artifactId, 'alice')).rejects.toThrow('terminal');
    await expect(lifecycle.renew(artifactId, 'alice')).rejects.toThrow();
  });
});
