import { ArtifactOperationError } from './failures.js';
import type { ReleaseRecord } from './publication.js';

type Position = { createdAt: string; releaseId: string };
const order = (a: Position, b: Position) => a.createdAt.localeCompare(b.createdAt) || a.releaseId.localeCompare(b.releaseId);

/** A cursor fixes the release boundary and is bound to the authorized artifact and scope. */
export async function artifactVersions(input: {
  artifactId: string; storageScopeId: string; currentReleaseId: string | null;
  releases: ReleaseRecord[]; limit?: number; cursor?: string;
  state(releaseId: string): Promise<string>;
  urls?: (artifactId: string, releaseId: string) => { versionUrl: string };
}) {
  const releases = [...input.releases].sort((a, b) => order(b, a));
  let snapshot: Position | undefined = releases[0];
  let after: Position | undefined;
  if (input.cursor !== undefined) {
    try {
      const parsed = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'));
      const position = (value: Position) => value && typeof value.createdAt === 'string' &&
        typeof value.releaseId === 'string' && releases.some(release => order(release, value) === 0);
      if (parsed.artifactId !== input.artifactId || parsed.storageScopeId !== input.storageScopeId ||
        !position(parsed.snapshot) || !position(parsed.after) || order(parsed.after, parsed.snapshot) > 0) throw new Error();
      snapshot = parsed.snapshot;
      after = parsed.after;
    } catch { throw new ArtifactOperationError('invalid_request'); }
  }
  const available = releases.filter(release => snapshot && order(release, snapshot) <= 0 &&
    (!after || order(release, after) < 0));
  const page = available.slice(0, input.limit ?? 20);
  const versions = await Promise.all(page.map(async release => {
    const state = await input.state(release.releaseId);
    return { releaseId: release.releaseId, createdAt: release.createdAt, state,
      authorPrincipalId: release.authorPrincipalId ?? null, parentReleaseId: release.parentReleaseId ?? null,
      revertedFromReleaseId: release.revertedFromReleaseId ?? null, digest: release.manifestDigest,
      isCurrent: release.releaseId === input.currentReleaseId,
      versionUrl: state === 'purged' ? null : input.urls?.(input.artifactId, release.releaseId).versionUrl ?? null };
  }));
  const last = page.at(-1);
  const position = (value: Position) => ({ createdAt: value.createdAt, releaseId: value.releaseId });
  return { artifactId: input.artifactId, currentReleaseId: input.currentReleaseId, versions,
    nextCursor: last && available.length > page.length ? Buffer.from(JSON.stringify({ artifactId: input.artifactId,
      storageScopeId: input.storageScopeId, snapshot: position(snapshot!), after: position(last) })).toString('base64url') : null };
}
