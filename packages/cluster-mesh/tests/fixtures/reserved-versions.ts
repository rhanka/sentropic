// Reserved-next / latest-published contract for pack-only dev bumps.
//
// The E2 integration reserves `RESERVED_NEXT` (today `0.23.0`) for its release
// line: memory-lot workspaces carry `<reservedNext>-dev.N` by plan while the
// frozen packaging fixture keeps pinning the latest published release
// (`LATEST_PUBLISHED_CLUSTER_MESH`, today `0.22.4`). Both constants are
// declared ONCE here; bump them together when the reserved version ships.
export const RESERVED_NEXT = '0.23.0';
export const LATEST_PUBLISHED_CLUSTER_MESH = '0.22.4';

export const isPrerelease = (version: string): boolean => version.includes('-');

const devBumpPattern = (reservedNext: string): RegExp =>
  new RegExp(`^${reservedNext.replace(/\./g, '\\.')}-dev\\.\\d+$`);

// Pack-only topic bump: true only when the workspace version is a
// `<reservedNext>-dev.N` prerelease AND the frozen pin is still the latest
// published release. Anything else (stable, rc, another line, or a stale pin)
// takes the strict pin path, so the tolerance never widens.
export const isPackOnlyDevBump = (
  workspaceVersion: string,
  publishedPin: string,
  reservedNext: string,
): boolean =>
  devBumpPattern(reservedNext).test(workspaceVersion) &&
  publishedPin === LATEST_PUBLISHED_CLUSTER_MESH;
