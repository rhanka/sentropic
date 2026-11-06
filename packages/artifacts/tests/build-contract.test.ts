import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateArtifactBuild } from '../src/server/build-contract.js';
import { ArtifactOperationError, classifyArtifactFailure } from '../src/server/failures.js';

// Exact descriptor bytes from rhanka/radar-immobilier#1012, blob fa1a073ce0d1ce79ccdbca6ec9638f604f441b9f.
const immo = readFileSync(new URL('./fixtures/build-contract/immo.artifact.json', import.meta.url), 'utf8');
const descriptor = JSON.parse(immo);
const dependency = {
  version: '1.2.3', integrity: 'sha512-pinned',
  resolved: 'https://registry.npmjs.org/example/-/example-1.2.3.tgz',
};
function fixture(options: { descriptor?: unknown; manifest?: object; packages?: object; subPath?: string } = {}) {
  const manifest = { name: 'fixture', version: '1.0.0', scripts: { 'build:artifact': 'npm run build -w ui' }, ...options.manifest };
  const files: Record<string, string> = {
    'sentropic.artifact.json': JSON.stringify(options.descriptor ?? descriptor),
    'package.json': JSON.stringify(manifest),
    'package-lock.json': JSON.stringify({ lockfileVersion: 3, packages: { '': manifest, ...options.packages } }),
  };
  return { subPath: options.subPath ?? '', files };
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

describe('GB1 frozen build contract', () => {
  it('should accept the real Immo descriptor with an empty allowlist and scripts disabled', () => {
    const snapshot = fixture();
    snapshot.files['sentropic.artifact.json'] = immo;
    expect(validateArtifactBuild(snapshot)).toMatchObject({
      descriptor, installDirectory: '', scriptDirectory: '', postinstall: [],
      install: { command: 'npm', args: ['ci', '--ignore-scripts'] },
      build: { command: 'npm', args: ['run', 'build:artifact'] },
    });
  });
  it.each(['command', 'args', 'env', 'postinstallAllowlist'])('should reject descriptor field %s', field => {
    refusal(fixture({ descriptor: { ...descriptor, [field]: 'arbitrary' } }), 'build_descriptor_invalid');
  });
  it.each(['build; echo injected', 'npm run build', '$(id)', 'build\n', ''])('should reject free shell %j', buildScript => {
    refusal(fixture({ descriptor: { ...descriptor, buildScript } }), 'build_descriptor_invalid');
  });
  it.each([0, 2, '1', null])('should reject unsupported version %j', version => {
    refusal(fixture({ descriptor: { ...descriptor, version } }), 'build_descriptor_invalid');
  });
  it.each(['outputDir', 'lockfilePath', 'entry'])('should reject traversal in %s', field => {
    for (const path of ['../secret', '/tmp/output', 'a/../b', 'a\\b', 'a/%2e%2e/b', 'a\u0000b']) {
      refusal(fixture({ descriptor: { ...descriptor, [field]: path } }), 'build_descriptor_invalid');
    }
  });
  it('should reject missing scripts and locks with distinct typed errors', () => {
    refusal(fixture({ manifest: { scripts: {} } }), 'build_script_missing');
    const snapshot = fixture();
    delete snapshot.files['package-lock.json'];
    refusal(snapshot, 'lock_missing');
  });
  it('should reject malformed descriptors and locks', () => {
    for (const file of ['sentropic.artifact.json', 'package-lock.json']) {
      const snapshot = fixture();
      snapshot.files[file] = '{';
      refusal(snapshot, 'build_descriptor_invalid');
    }
  });
  it.each(['git:repo', 'git+https://github.com/x/y', 'file:../local', 'https://example.org/p.tgz', 'x/y'])('should reject dependency %s', spec => {
    refusal(fixture({ manifest: { dependencies: { example: spec } } }), 'dep_outside_lock');
  });
  it('should reject a registry escape in the transitive lock closure', () => {
    refusal(fixture({ packages: { 'node_modules/example': { ...dependency, resolved: 'https://registry.npmjs.org.evil/x' } } }), 'dep_outside_lock');
  });
  it('should require the exact host-owned postinstall triple', () => {
    const snapshot = fixture({ packages: { 'node_modules/example': { ...dependency, hasInstallScript: true } } });
    const allowed = { package: 'example', version: '1.2.3', integrity: 'sha512-pinned' };
    refusal(snapshot, 'install_script_not_allowlisted');
    for (const key of ['package', 'version', 'integrity']) {
      refusal({ ...snapshot, postinstallAllowlist: [{ ...allowed, [key]: 'wrong' }] }, 'install_script_not_allowlisted');
    }
    expect(validateArtifactBuild({ ...snapshot, postinstallAllowlist: [allowed] }).postinstall).toEqual([allowed]);
  });
});
