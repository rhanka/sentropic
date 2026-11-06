import { ArtifactOperationError } from './failures.js';
import { validateBuildDependencies } from './build-dependencies.js';

/** Frozen G0 v3 §4.1 fields. Install permissions belong to the host. */
export interface ArtifactBuildDescriptor {
  readonly version: 1;
  readonly buildScript: string;
  readonly outputDir: string;
  readonly lockfilePath: string;
  readonly entry?: string;
  readonly publicEnvNames?: readonly string[];
}
export interface PostinstallAllowlistEntry {
  readonly package: string;
  readonly version: string;
  readonly integrity: string;
}
/** Host supplies files from one exact SHA, rooted at the repository, never the live draft. */
export interface ArtifactBuildSnapshot {
  readonly subPath: string;
  readonly files: Readonly<Record<string, string>>;
  readonly postinstallAllowlist?: readonly PostinstallAllowlistEntry[];
  readonly allowedRegistries?: readonly string[];
}
export interface ArtifactBuildTuple {
  readonly commitSha: string;
  readonly treeSha: string;
  readonly lockfileDigest: string;
  readonly descriptorDigest: string;
  readonly builderImageDigest: string;
  readonly nodeVersion: string;
  readonly npmVersion: string;
  readonly publicEnvHashes: Readonly<Record<string, string>>;
}

export function buildRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function buildJson(text: string | undefined): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text ?? '');
    if (buildRecord(value)) return value;
  } catch { /* Refuse malformed input without exposing source bytes. */ }
  throw new ArtifactOperationError('build_descriptor_invalid');
}
export function buildPath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
    && !/[\\\u0000-\u001f\u007f:%?#]/.test(value)
    && value.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..');
}
const join = (root: string, path: string): string => root ? `${root}/${path}` : path;

/** Validation only: no filesystem, network, install, shell or script execution. */
export function validateArtifactBuild(snapshot: ArtifactBuildSnapshot) {
  const invalid = (): never => { throw new ArtifactOperationError('build_descriptor_invalid'); };
  if (snapshot.subPath !== '' && !buildPath(snapshot.subPath)) invalid();
  const value = buildJson(snapshot.files[join(snapshot.subPath, 'sentropic.artifact.json')]);
  const fields = ['version', 'buildScript', 'outputDir', 'lockfilePath', 'entry', 'publicEnvNames'];
  if (Object.keys(value).some(key => !fields.includes(key)) || value.version !== 1
    || typeof value.buildScript !== 'string' || !/^[A-Za-z0-9:_-]+$/.test(value.buildScript)
    || !buildPath(value.outputDir) || !buildPath(value.lockfilePath)
    || (value.entry !== undefined && !buildPath(value.entry))
    || (value.publicEnvNames !== undefined && (!Array.isArray(value.publicEnvNames)
      || value.publicEnvNames.some(name => typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))))) invalid();
  const descriptor = value as unknown as ArtifactBuildDescriptor;
  const manifest = buildJson(snapshot.files[join(snapshot.subPath, 'package.json')]);
  if (!buildRecord(manifest.scripts) || !Object.hasOwn(manifest.scripts, descriptor.buildScript)
    || typeof manifest.scripts[descriptor.buildScript] !== 'string'
    || !manifest.scripts[descriptor.buildScript].trim()) throw new ArtifactOperationError('build_script_missing');
  if (!Object.hasOwn(snapshot.files, descriptor.lockfilePath)) throw new ArtifactOperationError('lock_missing');
  const lock = buildJson(snapshot.files[descriptor.lockfilePath]);
  const installDirectory = descriptor.lockfilePath.includes('/')
    ? descriptor.lockfilePath.slice(0, descriptor.lockfilePath.lastIndexOf('/')) : '';
  if (installDirectory && snapshot.subPath !== installDirectory
    && !snapshot.subPath.startsWith(`${installDirectory}/`)) invalid();
  const postinstall = validateBuildDependencies(snapshot, lock, installDirectory);
  return {
    descriptor, installDirectory, scriptDirectory: snapshot.subPath,
    install: { command: 'npm', args: ['ci', '--ignore-scripts'] },
    build: { command: 'npm', args: ['run', descriptor.buildScript] },
    postinstall,
  } as const;
}
