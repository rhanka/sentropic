import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateArtifactBuild } from '../src/server/build-contract.js';
import { hostIntegrityMapDigest, lockfileSha256 } from '../src/server/build-integrity.js';
import { ArtifactOperationError, classifyArtifactFailure } from '../src/server/failures.js';

// A-LIVE §7.2–7.3: every remote package must be covered by approved integrity (literal lockfile
// SRI or a host-sealed map), and only literal SRI can qualify a script-bearing package.
const immo = readFileSync(new URL('./fixtures/build-contract/immo.artifact.json', import.meta.url), 'utf8');
const sri = (byte: number, bytes = 64, alg = 'sha512') => `${alg}-${Buffer.alloc(bytes, byte).toString('base64')}`;
const resolved = 'https://registry.npmjs.org/example/-/example-1.2.3.tgz';
const pinned = { version: '1.2.3', integrity: sri(1), resolved };
const bare = { version: '1.2.3', resolved };
// Shape of the 607 Immo lock entries lacking both `integrity` and `resolved`.
const immoGap = { version: '1.2.3' };

function fixtures(packages: object = {}) {
  const manifest = { name: 'fixture', version: '1.0.0', scripts: { 'build:artifact': 'npm run build -w ui' } };
  const files: Record<string, string> = {
    'sentropic.artifact.json': immo,
    'package.json': JSON.stringify(manifest),
    'package-lock.json': JSON.stringify({ lockfileVersion: 3, packages: { '': manifest, ...packages } }),
  };
  return { subPath: '', files };
}
function withMap(snapshot: ReturnType<typeof fixtures>, entries: object[], lockfileDigest?: string) {
  const integrityMap = {
    lockfileDigest: lockfileDigest ?? lockfileSha256(snapshot.files['package-lock.json']),
    entries: entries.map(entry => ({ path: 'node_modules/example', name: 'example', version: '1.2.3',
      registryUrl: resolved, integrity: sri(2), ...entry })),
  };
  return { ...snapshot, integrityMap };
}
function refusal(snapshot: Parameters<typeof validateArtifactBuild>[0], code: string) {
  let failure: unknown;
  try { validateArtifactBuild(snapshot); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(ArtifactOperationError);
  expect(failure).toMatchObject({ kind: code });
  expect(classifyArtifactFailure(failure, {
    invocationId: 'validation', operation: 'build', phase: 'validation', commitState: 'not_committed',
  })).toMatchObject({ publicCode: code, httpStatus: 422, commitState: 'not_committed', retriable: false });
}

describe('GB1 dependency integrity coverage', () => {
  it('should admit complete literal lockfile integrity without a map and bind the lock digest', () => {
    const snapshot = fixtures({ 'node_modules/example': pinned });
    const outcome = validateArtifactBuild(snapshot);
    expect(outcome.lockfileDigest).toBe(lockfileSha256(snapshot.files['package-lock.json']));
    expect(outcome.descriptorDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(outcome.integrity).toEqual({ mapDigest: null, lockfileSri: 1, hostMap: 0, entries: [{
      path: 'node_modules/example', name: 'example', version: '1.2.3', registryUrl: resolved,
      integrity: sri(1), source: 'lockfile' }] });
  });

  it('should refuse remote entries lacking approved integrity, including the Immo gap shape', () => {
    for (const entry of [bare, immoGap, { ...pinned, integrity: sri(1, 20, 'sha1') },
      { ...pinned, integrity: 'sha512-short' }, { ...pinned, integrity: 'md5-abc' }]) {
      refusal(fixtures({ 'node_modules/example': entry }), 'dependency_integrity_missing');
    }
  });

  it('should admit host-map coverage and take the approved URL from the map when the lock has none', () => {
    for (const entry of [bare, immoGap]) {
      const snapshot = withMap(fixtures({ 'node_modules/example': entry }), [{}]);
      expect(validateArtifactBuild(snapshot).integrity).toEqual({
        mapDigest: hostIntegrityMapDigest(snapshot.integrityMap), lockfileSri: 0, hostMap: 1, entries: [{
          path: 'node_modules/example', name: 'example', version: '1.2.3', registryUrl: resolved,
          integrity: sri(2), source: 'host_map' }] });
    }
  });

  it('should refuse a literal pin without any approved registry location', () => {
    refusal(fixtures({ 'node_modules/example': { version: '1.2.3', integrity: sri(1) } }), 'dep_outside_lock');
  });

  it('should refuse maps sealed for other lock bytes or contradicting the lock', () => {
    const gap = fixtures({ 'node_modules/example': immoGap });
    refusal(withMap(gap, [{}], 'a'.repeat(64)), 'dependency_integrity_mismatch');
    refusal(withMap(fixtures({ 'node_modules/example': pinned }), [{}]), 'dependency_integrity_mismatch');
    refusal(withMap(fixtures({ 'node_modules/example': bare }),
      [{ registryUrl: 'https://registry.npmjs.org/other/-/example-1.2.3.tgz' }]), 'dependency_integrity_mismatch');
    for (const entry of [{ path: 'node_modules/absent' }, { version: '1.2.4' }, { name: 'other' },
      { registryUrl: 'https://unapproved.example/example-1.2.3.tgz' }, { integrity: sri(2, 20, 'sha1') },
      { integrity: 'sha512-short' }]) {
      refusal(withMap(gap, [entry]), 'dependency_integrity_mismatch');
    }
    refusal(withMap(gap, [{}, { integrity: sri(3) }]), 'dependency_integrity_mismatch');
  });

  it('should accept a map entry restating the literal pin and cover mixed evidence', () => {
    const snapshot = withMap(fixtures({
      'node_modules/example': immoGap,
      'node_modules/other': { version: '2.0.0', integrity: sri(4), resolved: 'https://registry.npmjs.org/other/-/other-2.0.0.tgz' },
    }), [{}, { path: 'node_modules/other', name: 'other', version: '2.0.0', integrity: sri(4),
      registryUrl: 'https://registry.npmjs.org/other/-/other-2.0.0.tgz' }]);
    expect(validateArtifactBuild(snapshot).integrity).toMatchObject({ lockfileSri: 1, hostMap: 1 });
  });

  it('should bind the map digest to the lock digest and to every entry field, independent of order', () => {
    const map = withMap(fixtures({ 'node_modules/example': immoGap }), [{}, { path: 'node_modules/b' }]).integrityMap;
    expect(hostIntegrityMapDigest({ ...map, entries: [...map.entries].reverse() })).toBe(hostIntegrityMapDigest(map));
    expect(hostIntegrityMapDigest({ ...map, lockfileDigest: 'b'.repeat(64) })).not.toBe(hostIntegrityMapDigest(map));
    expect(hostIntegrityMapDigest({ ...map, entries: [{ ...map.entries[0], integrity: sri(9) }, map.entries[1]] }))
      .not.toBe(hostIntegrityMapDigest(map));
  });
});

describe('GB1 script-package qualification', () => {
  const script = (entry: object) => fixtures({ 'node_modules/example': { ...entry, hasInstallScript: true } });
  const triple = { package: 'example', version: '1.2.3', integrity: sri(1) };

  it('should record disabled qualification rows apart from the empty execution allowlist', () => {
    refusal(script(pinned), 'install_script_not_allowlisted');
    const outcome = validateArtifactBuild({ ...script(pinned), scriptQualification: [triple] });
    expect(outcome.postinstall).toEqual([]);
    expect(outcome.install.args).toEqual(['ci', '--ignore-scripts']);
    expect(outcome.scriptQualification).toEqual([{ ...triple, source: 'lockfile', execution: 'disabled' }]);
    for (const key of ['package', 'version', 'integrity']) {
      refusal({ ...script(pinned), scriptQualification: [{ ...triple, [key]: 'other' }] }, 'install_script_not_allowlisted');
    }
  });

  it('should never qualify or allowlist a script package from a host-map value', () => {
    for (const entry of [bare, immoGap]) {
      const mapped = withMap(script(entry), [{}]);
      const value = { ...triple, integrity: sri(2) };
      refusal({ ...mapped, scriptQualification: [value] }, 'install_script_not_allowlisted');
      refusal({ ...mapped, postinstallAllowlist: [value] }, 'install_script_not_allowlisted');
    }
  });

  it('should keep the exact G0 allowlist the only route to an allowlisted hook', () => {
    const outcome = validateArtifactBuild({ ...script(pinned), postinstallAllowlist: [triple], scriptQualification: [triple] });
    expect(outcome.postinstall).toEqual([triple]);
    expect(outcome.scriptQualification).toEqual([{ ...triple, source: 'lockfile', execution: 'allowlisted' }]);
  });

  it('should require a row for every script-bearing package', () => {
    const other = { version: '2.0.0', integrity: sri(4), resolved: 'https://registry.npmjs.org/other/-/other-2.0.0.tgz' };
    const snapshot = fixtures({ 'node_modules/example': { ...pinned, hasInstallScript: true },
      'node_modules/other': { ...other, hasInstallScript: true } });
    refusal({ ...snapshot, scriptQualification: [triple] }, 'install_script_not_allowlisted');
    const rows = [triple, { package: 'other', version: '2.0.0', integrity: sri(4) }];
    expect(validateArtifactBuild({ ...snapshot, scriptQualification: rows }).scriptQualification).toHaveLength(2);
  });
});
