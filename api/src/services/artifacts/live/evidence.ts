import { createHash } from 'node:crypto';
import type { ArtifactBuildTuple } from '@sentropic/artifacts/server/build-contract';
import type { CacheReceipt } from './cache';
import type { SourceSnapshot } from './ports';
import { ARTIFACT_PUBLIC_ENV, BUILDER_IMAGE } from './recipes';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
/** A-LIVE §8.4 evidence join from trusted server state only: the pinned snapshot, the verified cache receipt and the
 * host-owned image/environment. Pod stdout, branch files and untrusted receipt files never contribute. */
export function buildEvidence(source: SourceSnapshot, cache: CacheReceipt): ArtifactBuildTuple {
  return {
    commitSha: source.headSha, treeSha: source.treeSha, descriptorDigest: source.descriptorDigest,
    lockfileDigest: cache.identity.lockSha256, nodeVersion: cache.identity.nodeVersion, npmVersion: cache.identity.npmVersion,
    builderImageDigest: BUILDER_IMAGE.slice(BUILDER_IMAGE.indexOf('@') + 1),
    publicEnvHashes: Object.fromEntries(Object.entries(ARTIFACT_PUBLIC_ENV).map(([name, value]) => [name, sha256(value)])),
  };
}
