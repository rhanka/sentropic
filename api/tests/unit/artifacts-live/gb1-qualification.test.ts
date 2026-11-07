import { describe, expect, it } from 'vitest';
import {
  GB1_QUALIFICATION_MAX_BYTES, GB1_QUALIFICATION_PATH, integrityEvidence, qualifyBuild, type Gb1Source,
} from '../../../src/services/artifacts/live/gb1-qualification';
import { sha256 } from '../../../src/services/artifacts/live/integrity';

const sri = (seed: number) => `sha512-${Buffer.alloc(64, seed).toString('base64')}`;
const url = (name: string) => `https://registry.npmjs.org/${name}/-/${name}-1.0.0.tgz`;
const descriptor = JSON.stringify({ version: 1, buildScript: 'build:artifact', outputDir: 'ui/dist',
  lockfilePath: 'package-lock.json', entry: 'index.html' });
const manifest = { name: 'fixture', version: '1.0.0', scripts: { 'build:artifact': 'npm run build -w ui' } };
const row = { package: 'esbuild', version: '1.0.0', integrity: sri(1) };
function fixture(options: { scripts?: boolean; file?: Record<string, unknown> | string | null } = {}) {
  const packages: Record<string, Record<string, unknown>> = { '': manifest,
    'node_modules/esbuild': { version: '1.0.0', resolved: url('esbuild'), integrity: sri(1), hasInstallScript: options.scripts ?? true },
    'node_modules/plain': { version: '1.0.0', resolved: url('plain'), integrity: sri(2) } };
  const lock = { lockfileVersion: 3, packages };
  const source = () => {
    const lockText = JSON.stringify(lock);
    const files: Record<string, string> = { 'sentropic.artifact.json': descriptor, 'package.json': JSON.stringify(manifest),
      'package-lock.json': lockText };
    const file = options.file === undefined ? {} : options.file;
    if (file !== null) files[GB1_QUALIFICATION_PATH] = typeof file === 'string' ? file : JSON.stringify({ v: 1,
      lockSha256: sha256(lockText), postinstallAllowlist: [], scriptQualification: [row], ...file });
    return { subPath: '', files } as Gb1Source & { files: Record<string, string> };
  };
  return { packages, source };
}
function refused(source: Gb1Source, code: string, reason?: string) {
  let failure: unknown;
  try { qualifyBuild(source); } catch (error) { failure = error; }
  expect(failure).toMatchObject(reason ? { code, reason } : { code });
}

describe('GB1 qualification file at the pinned commit', () => {
  it('qualifies the exact script rows as disabled hooks and digests the file bytes as the integrity evidence', () => {
    const source = fixture().source();
    const qualification = qualifyBuild(source);
    expect(qualification).toMatchObject({ descriptorDigest: sha256(descriptor),
      lockfileDigest: sha256(source.files['package-lock.json']), digest: sha256(source.files[GB1_QUALIFICATION_PATH]),
      scriptQualification: [{ ...row, source: 'lockfile', execution: 'disabled' }] });
    expect(integrityEvidence(qualification)).toEqual({ lockSha256: qualification.lockfileDigest, digest: qualification.digest,
      inventory: [{ path: 'node_modules/esbuild', url: url('esbuild'), version: '1.0.0', integrity: sri(1) },
        { path: 'node_modules/plain', url: url('plain'), version: '1.0.0', integrity: sri(2) }] });
  });
  it('accepts a file of exactly 64 KiB and refuses one byte more', () => {
    const source = fixture().source(); const text = source.files[GB1_QUALIFICATION_PATH];
    source.files[GB1_QUALIFICATION_PATH] = text + ' '.repeat(GB1_QUALIFICATION_MAX_BYTES - text.length);
    expect(qualifyBuild(source).digest).toBe(sha256(source.files[GB1_QUALIFICATION_PATH]));
    source.files[GB1_QUALIFICATION_PATH] += ' ';
    refused(source, 'build_descriptor_invalid', 'qualification_invalid');
  });
  it.each([
    ['not JSON', '{'], ['an array', '[]'], ['an extra key', { extra: true }], ['version 2', { v: 2 }],
    ['a short lock digest', { lockSha256: 'abc' }], ['rows that are not a list', { scriptQualification: {} }],
    ['a row with an extra key', { scriptQualification: [{ ...row, path: 'node_modules/esbuild' }] }],
    ['a row with a numeric version', { scriptQualification: [{ ...row, version: 1 }] }],
    ['a duplicated row', { scriptQualification: [row, row] }],
  ])('refuses a file with %s as invalid', (_name, file) => {
    refused(fixture({ file: file as Record<string, unknown> | string }).source(), 'build_descriptor_invalid', 'qualification_invalid');
  });
  it('refuses a non-empty execution allowlist: no install hook runs in this train', () => {
    refused(fixture({ file: { postinstallAllowlist: [row] } }).source(), 'install_script_not_allowlisted', 'execution_allowlist_not_empty');
  });
  it('refuses a qualification made for another lock', () => {
    refused(fixture({ file: { lockSha256: 'a'.repeat(64) } }).source(), 'install_script_not_allowlisted', 'qualification_lock_mismatch');
  });
  it('refuses rows that do not exactly cover the lock script entries', () => {
    refused(fixture({ file: { scriptQualification: [] } }).source(), 'install_script_not_allowlisted', 'qualification_rows_mismatch');
    refused(fixture({ file: { scriptQualification: [row, { ...row, package: 'other' }] } }).source(),
      'install_script_not_allowlisted', 'qualification_rows_mismatch');
    refused(fixture({ file: { scriptQualification: [{ ...row, integrity: sri(3) }] } }).source(),
      'install_script_not_allowlisted', 'qualification_rows_mismatch');
  });
  it('refuses a missing file when the lock has script entries, and accepts it with none', () => {
    refused(fixture({ file: null }).source(), 'install_script_not_allowlisted', 'qualification_missing');
    const qualification = qualifyBuild(fixture({ scripts: false, file: null }).source());
    expect(qualification).toMatchObject({ digest: sha256(''), scriptQualification: [] });
  });
  it('never qualifies a script row from a host-map value and maps W5 refusals to closed live codes', () => {
    const f = fixture(); f.packages['node_modules/plain'].integrity = undefined;
    refused(f.source(), 'dependency_integrity_missing');
    const source = f.source(); const lockfileDigest = sha256(source.files['package-lock.json']);
    const mapped = { ...source, integrityMap: { lockfileDigest, entries: [{ path: 'node_modules/plain', name: 'plain',
      version: '1.0.0', registryUrl: url('plain'), integrity: sri(2) }] } };
    expect(integrityEvidence(qualifyBuild(mapped)).inventory[1]).toEqual({ path: 'node_modules/plain', url: url('plain'),
      version: '1.0.0', integrity: sri(2) });
    const g = fixture(); g.packages['node_modules/esbuild'].integrity = undefined;
    const script = g.source(); const digest = sha256(script.files['package-lock.json']);
    refused({ ...script, integrityMap: { lockfileDigest: digest, entries: [{ path: 'node_modules/esbuild', name: 'esbuild',
      version: '1.0.0', registryUrl: url('esbuild'), integrity: sri(1) }] } }, 'install_script_not_allowlisted', 'qualification_rows_mismatch');
  });
});
