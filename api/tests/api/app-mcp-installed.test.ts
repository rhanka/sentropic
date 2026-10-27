import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('physical app registry installation', () => {
  it('should compile APP-P1 through Node resolution without test or TypeScript aliases', () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import { createRequire } from 'node:module';
      import { realpathSync } from 'node:fs';
      import { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE } from '@sentropic/artifacts/mcp';
      import { compileAppMcpRegistry } from './src/services/mcp/cluster-registry.ts';
      const api = createRequire(new URL('./package.json', import.meta.url));
      const mesh = createRequire(api.resolve('@sentropic/cluster-mesh'));
      assert.equal(realpathSync(api.resolve('@sentropic/artifacts/mcp')),
        realpathSync(mesh.resolve('@sentropic/artifacts/mcp')));
      const profile = compileArtifactsProfile(RADAR_ARTIFACTS_PROFILE);
      const result = await compileAppMcpRegistry({
        artifacts: { profile, app: { profileDigest: profile.profileDigest,
          selectedCapabilities: profile.selectedCapabilities,
          execute: async () => { throw new Error('Compilation must not execute'); } },
          createInvocation: () => { throw new Error('Compilation must not bind'); } },
        selection: ['sentropic.artifacts'], configurations: { 'sentropic.artifacts': {} }, bindings: {},
        compatibility: { 'sentropic.artifacts': {
          manifestDigest: 'ccf8a4ddd9365537741eb0550efa49954d86a0c2d1ee808fb18ca81ef7090e9a' } },
      });
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.deepEqual([...result.registry.tools.keys()],
        ['artifacts_ensure', 'artifacts_get', 'artifacts_list', 'artifacts_publish']);
      console.log(JSON.stringify({ artifacts: realpathSync(api.resolve('@sentropic/artifacts/mcp')) }));
    `], { encoding: 'utf8' });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(JSON.parse(result.stdout).artifacts).toContain('/packages/artifacts/dist/');
  });
});
