import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { checkNodeFloor, checkSdkVersion } from '../receipt.mjs';

describe('P10.tooling.ci-contract — L5 CI, SDK floor, and Node/SQLite runtime floor contract', () => {
  it('prepares verified sibling candidates when mesh is unchanged and platform is unpublished', () => {
    const workflow = readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8');
    const job = name => workflow.split(`\n  ${name}:`)[1]?.split(/\n  [a-z][\w-]*:/)[0];
    const producer = job('package-candidates');
    const meshJob = job('validate-cluster-mesh');
    expect(producer).toContain('needs: [changes]');
    expect(producer).toContain("needs.changes.outputs.cluster_mesh == 'true'");
    expect(producer).toContain("needs.changes.outputs.package_candidates == 'true'");
    expect(producer).toContain('CI_MANIFEST_CONTEXT:');
    expect(producer).toContain('make ci-package-candidate ENV=');
    expect(producer).toContain('name: package-candidates');
    expect(producer).toContain('if-no-files-found: error');
    expect(meshJob).toContain('needs: [changes, package-candidates]');
    expect(meshJob).toContain('CI_PACKAGE_CANDIDATES: tmp/ci-package-candidates');
    expect(meshJob).toContain('uses: actions/download-artifact@');
    expect(meshJob).toContain('name: package-candidates');
    const step = meshJob.match(/      - name: Export verified sibling archives without packing\n(?:(?!      - name:)[\s\S])*/)?.[0];
    expect(step).toBeDefined();
    // The sibling planner classifies each dependency itself; mesh WARN must not suppress it.
    expect(step).not.toMatch(/^        if:/m);
    expect(step).toContain('make pack-candidate-siblings PACKAGE=cluster-mesh');
    const download = meshJob.indexOf('uses: actions/download-artifact@');
    const verify = meshJob.indexOf('run: make ci-package-verify ENV=');
    const siblings = meshJob.indexOf('run: make pack-candidate-siblings PACKAGE=cluster-mesh');
    const qualify = meshJob.indexOf('make ci-package-qualification PACKAGE_LANE="$lane" ENV=test-ci-br80-$lane');
    expect(verify).toBeGreaterThan(download);
    expect(siblings).toBeGreaterThan(verify);
    expect(qualify).toBeGreaterThan(siblings);
  });
  it('P10.tooling.ci-contract: accepts unflagged Node >=22.13.0 on 22.x, >=23.4.0 on 23.x, and Node 24.x', () => {
    expect(checkNodeFloor('22.13.0', [], '')).toBe(true);
    expect(checkNodeFloor('v22.14.1', [], '')).toBe(true);
    expect(checkNodeFloor('23.4.0', [], '')).toBe(true);
    expect(checkNodeFloor('24.2.0', [], '')).toBe(true);
  });

  it('P10.tooling.ci-contract: rejects Node <22.13 on 22.x, Node 23.0-23.3, earlier/unpinned majors, and malformed versions', () => {
    expect(checkNodeFloor('20.18.0', [], '')).toBe(false);
    expect(checkNodeFloor('22.12.0', [], '')).toBe(false);
    expect(checkNodeFloor('23.0.0', [], '')).toBe(false);
    expect(checkNodeFloor('23.3.9', [], '')).toBe(false);
    expect(checkNodeFloor('99.0.0', [], '')).toBe(false);
    expect(checkNodeFloor('24.2.0-rc.1', [], '')).toBe(false);
    expect(checkNodeFloor('', [], '')).toBe(false);
  });

  it('P10.tooling.ci-contract: rejects flag-dependent SQLite invocation in either execArgv or NODE_OPTIONS', () => {
    expect(checkNodeFloor('24.2.0', ['--experimental-sqlite'], '')).toBe(false);
    expect(checkNodeFloor('22.13.0', ['--no-experimental-sqlite'], '')).toBe(false);
    expect(checkNodeFloor('24.2.0', [], '--experimental-sqlite')).toBe(false);
  });

  it('P10.tooling.ci-contract: enforces stable @modelcontextprotocol/sdk version floor >=1.31.0 <2.0.0 (^1.31.0) and rejects prereleases', () => {
    expect(checkSdkVersion('1.31.0')).toBe(true);
    expect(checkSdkVersion('1.32.4')).toBe(true);
    expect(checkSdkVersion('1.31.0-rc.1')).toBe(false);
    expect(checkSdkVersion('1.32.0-beta.0')).toBe(false);
    expect(checkSdkVersion('0.1.0')).toBe(false);
    expect(checkSdkVersion('1.30.9')).toBe(false);
    expect(checkSdkVersion('2.0.0')).toBe(false);
  });
});
