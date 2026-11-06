import { expect, it } from 'vitest';
import { ARTIFACTS_TOOL_NAMES, ARTIFACTS_TOOL_DEFINITIONS } from '../src/mcp-core.js';
import { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE } from '../src/profile/index.js';

export const liveNames = ['artifacts_live_write', 'artifacts_live_read', 'artifacts_live_reset',
  'artifacts_live_status', 'artifacts_live_control'] as const;
it('should deliberately append the frozen G0 and A-LIVE tools after the original 24', () => {
  expect(ARTIFACTS_TOOL_NAMES).toHaveLength(35);
  expect(ARTIFACTS_TOOL_NAMES.slice(24)).toEqual(['artifacts_list_app_sources', 'artifacts_fetch_app_source',
    'artifacts_git_attach', 'artifacts_git_commit', 'artifacts_git_publish', 'artifacts_git_live', ...liveNames]);
});
it('should select live operations without changing definitions or granting legacy Tool 6', () => {
  const profile = compileArtifactsProfile({ ...RADAR_ARTIFACTS_PROFILE, selectedCapabilities: liveNames,
    operations: liveNames.map(name => ({ operation: name.slice(10), defaults: {},
      limits: name.endsWith('_read') || name.endsWith('_status') ? {} : { idempotencyKeyMaxUnits: 256 } })) });
  const artifactId = '11111111-1111-4111-8111-111111111111';
  expect(profile.capabilityForRoute('POST', '/live_status')).toBe('artifacts_live_status');
  expect(profile.validate('artifacts_live_status', { artifactId })).toEqual({ artifactId });
  expect(() => profile.validate('artifacts_git_live', {})).toThrow('capability_unavailable');
  expect(ARTIFACTS_TOOL_DEFINITIONS.artifacts_live_read.mutability).toBe('read-only');
  expect(ARTIFACTS_TOOL_DEFINITIONS.artifacts_live_write.idempotency).toEqual({ required: true, scope: 'principal' });
});
