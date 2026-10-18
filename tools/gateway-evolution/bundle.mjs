import { createHash } from 'node:crypto';
import { buildBundleIndex, checkManifest, GatewayInputError, validateConsumerInput, verifyBundleIndex } from './run.mjs';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (message, code) => { throw new GatewayInputError(message, code); };
export const safePath = (path) => {
  if (typeof path !== 'string' || !path || path.includes('\\') || path.split('/').some((p) => !p || p === '.' || p === '..') || path.includes(':')) fail('unsafe relative path', 'bad-path');
  return path;
};
export const createCandidateBundle = ({ program, delivery, manifest, files, mode, scopes }) => {
  const deliveries = { gateway: ['pr1', 'pr2', 'pr3'], registry: ['r4', 'r5', 'r6', 'r7b'] };
  if (!deliveries[program]?.includes(delivery)) fail('wrong program/delivery', 'bad-phase');
  checkManifest(manifest, { kind: 'candidate' });
  if (!/^[a-f0-9]{40}$/.test(manifest.sourceSha ?? '')) fail('full source SHA required', 'bad-source');
  if (!Array.isArray(manifest.artifacts) || !manifest.artifacts.length) fail('pack artifacts required', 'bad-manifest');
  const phase = `${delivery}-candidate`;
  const members = new Map();
  for (const artifact of manifest.artifacts) {
    if (Object.keys(artifact).sort().join(',') !== 'path,sha256,size') fail('closed artifact row required', 'bad-manifest');
    safePath(artifact.path);
    if (members.has(artifact.path) || ['manifest.json', 'bundle-index.json'].includes(artifact.path)) fail('reserved or repeated path', 'bad-path');
    const bytes = files.get(artifact.path);
    if (!bytes || bytes.length !== artifact.size || hash(bytes) !== artifact.sha256) fail('missing/altered pack bytes', 'bundle-mismatch');
    if (bytes.subarray(0, 80).toString().startsWith('version https://git-lfs.github.com/spec/v1')) fail('LFS pointer refused', 'unsafe-member');
    if (bytes.length >= 100 * 1024 * 1024) fail('GitHub blob limit exceeded', 'bundle-too-large');
    members.set(artifact.path, bytes);
  }
  if (members.size !== files.size) fail('extra pack bytes', 'bundle-mismatch');
  const text = JSON.stringify(manifest);
  members.set('manifest.json', Buffer.from(text));
  const index = buildBundleIndex([...members].map(([path, bytes]) => ({ path, size: bytes.length, sha256: hash(bytes) })));
  const indexBytes = Buffer.from(JSON.stringify({ version: index.version, files: index.files }));
  const root = `.github/gateway-candidates/${phase}/${hash(indexBytes)}/`;
  const input = validateConsumerInput({
    schemaVersion: 1, program, phase, artifactKind: 'candidate',
    contractSha256: manifest.contractSha256, releaseLockSha256: manifest.releaseLockSha256,
    packages: manifest.packages, profiles: manifest.profiles, programCoverage: manifest.programCoverage,
    artifactManifest: { path: `${root}manifest.json`, sha256: hash(text) },
    candidateBundle: { root, indexPath: `${root}bundle-index.json`, bundleSha256: hash(indexBytes) },
    mode, ...(mode === 'scoped' ? { scopes: scopes ?? manifest.scopes } : {}),
  });
  verifyBundleIndex(index, [...members].map(([path, bytes]) => ({ path, size: bytes.length, sha256: hash(bytes), kind: 'file' })));
  members.set('bundle-index.json', indexBytes);
  return { input, files: members, totalBytes: [...members.values()].reduce((n, b) => n + b.length, 0), largestBlob: Math.max(...[...members.values()].map((b) => b.length)) };
};
