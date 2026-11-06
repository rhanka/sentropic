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
  it('should expose validation through the built public package subpath', async () => {
    const api = await import('@sentropic/artifacts/server/build-contract');
    expect(api.validateArtifactBuild(fixture()).install.args).toEqual(['ci', '--ignore-scripts']);
  });
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
  it('should accept the byte-identical §4.1 example with public environment names only', () => {
    const example = '{\n  "version": 1,\n  "buildScript": "build",\n  "outputDir": "dist",\n  "lockfilePath": "package-lock.json",\n  "entry": "index.html",\n  "publicEnvNames": ["VITE_EXAMPLE"]\n}';
    const snapshot = fixture({ manifest: { scripts: { build: 'exit 99' } } });
    snapshot.files['sentropic.artifact.json'] = example;
    expect(validateArtifactBuild(snapshot).descriptor.publicEnvNames).toEqual(['VITE_EXAMPLE']);
    for (const publicEnvNames of [['NAME=value'], ['NAME\n'], [{ NAME: 'value' }], 'NAME']) {
      refusal(fixture({ descriptor: { ...descriptor, publicEnvNames } }), 'build_descriptor_invalid');
    }
  });
  it('should reject required fields missing from the frozen descriptor', () => {
    for (const key of ['version', 'buildScript', 'outputDir', 'lockfilePath']) {
      const value = { ...descriptor };
      delete value[key];
      refusal(fixture({ descriptor: value }), 'build_descriptor_invalid');
    }
  });
  it('should accept pinned workspace links with root installation and a nested script directory', () => {
    const app = { name: '@fixture/app', version: '1.0.0', scripts: { 'build:artifact': 'exit 99' } };
    const snapshot = fixture({ packages: { 'apps/ui': app, 'node_modules/@fixture/app': { resolved: 'apps/ui', link: true } } });
    snapshot.subPath = 'apps/ui';
    snapshot.files['apps/ui/package.json'] = JSON.stringify(app);
    snapshot.files['apps/ui/sentropic.artifact.json'] = immo;
    expect(validateArtifactBuild(snapshot)).toMatchObject({ installDirectory: '', scriptDirectory: 'apps/ui' });
    snapshot.files['apps/ui/package.json'] = JSON.stringify({ ...app, dependencies: { example: '*' } });
    refusal(snapshot, 'dep_outside_lock');
  });
  it('should reject escaping, missing and mismatched workspace link targets', () => {
    for (const resolved of ['../elsewhere', '/tmp/workspace', 'missing']) {
      refusal(fixture({ packages: { 'node_modules/example': { resolved, link: true } } }), 'dep_outside_lock');
    }
    const snapshot = fixture({ packages: { 'ui': {}, 'node_modules/example': { resolved: 'ui', link: true } } });
    snapshot.files['ui/package.json'] = JSON.stringify({ name: 'other' });
    refusal(snapshot, 'dep_outside_lock');
  });
  it('should reject a missing locked dependency and an edited workspace manifest', () => {
    refusal(fixture({ manifest: { dependencies: { missing: '^1.0.0' } } }), 'dep_outside_lock');
    const snapshot = fixture();
    snapshot.files['package.json'] = JSON.stringify({ scripts: { 'build:artifact': 'exit 99' }, dependencies: { example: '*' } });
    refusal(snapshot, 'dep_outside_lock');
  });
  it('should validate all dependency sections and the transitive closure', () => {
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      refusal(fixture({ packages: { 'node_modules/example': { ...dependency, [section]: { bad: 'file:../bad' } } } }), 'dep_outside_lock');
    }
    refusal(fixture({ packages: { 'node_modules/example': { ...dependency, hasInstallScript: 'false' } } }), 'dep_outside_lock');
  });
  it('should accept a host registry prefix and reject its lookalike paths and credentials', () => {
    const snapshot = fixture({ packages: { 'node_modules/example': { ...dependency, resolved: 'https://packages.example/npm/example.tgz' } } });
    refusal(snapshot, 'dep_outside_lock');
    expect(validateArtifactBuild({ ...snapshot, allowedRegistries: ['https://packages.example/npm/'] }).postinstall).toEqual([]);
    for (const resolved of ['https://u:p@registry.npmjs.org/x', 'http://registry.npmjs.org/x', 'file:local', 'git:repo']) {
      refusal(fixture({ packages: { 'node_modules/example': { ...dependency, resolved } } }), 'dep_outside_lock');
    }
  });
  it('should refuse root lifecycle scripts rather than execute them', () => {
    refusal(fixture({ manifest: { scripts: { 'build:artifact': 'exit 99', postinstall: 'exit 99' } } }), 'install_script_not_allowlisted');
  });
  it('should install beside a nested lockfile and accept npm v2 locked aliases', () => {
    const snapshot = fixture({
      descriptor: { ...descriptor, lockfilePath: 'app/package-lock.json' },
      manifest: { dependencies: { alias: 'npm:example@^1.2.3' } },
      packages: { 'node_modules/alias': dependency },
    });
    const original = { ...snapshot.files };
    snapshot.subPath = 'app';
    snapshot.files = Object.fromEntries(Object.entries(original).map(([path, text]) => [`app/${path}`, text]));
    const lock = JSON.parse(snapshot.files['app/package-lock.json']);
    lock.lockfileVersion = 2;
    snapshot.files['app/package-lock.json'] = JSON.stringify(lock);
    expect(validateArtifactBuild(snapshot)).toMatchObject({ installDirectory: 'app', scriptDirectory: 'app' });
    snapshot.subPath = '';
    snapshot.files['sentropic.artifact.json'] = original['sentropic.artifact.json'];
    snapshot.files['package.json'] = original['package.json'];
    refusal(snapshot, 'build_descriptor_invalid');
  });
});
