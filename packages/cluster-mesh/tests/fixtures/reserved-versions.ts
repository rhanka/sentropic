// Reserved-next / compatible published pin contract for pack-only dev bumps.
//
// The E2 integration reserves `RESERVED_NEXT` (today `0.26.0`) for its release
// line: identity-lot workspaces carry `<reservedNext>-dev.N` by plan. The
// frozen published compatibility pin (`LATEST_PUBLISHED_CLUSTER_MESH`,
// `0.25.0`) stays separate from the selected local candidate fixture.
// Both constants are declared ONCE here; keep the bare-probe mirror aligned.
// The pin is the latest published release whose dependency and peer metadata
// equals the candidate's (0.25.0 published; candidate metadata unchanged).
export const RESERVED_NEXT = '0.26.0';
export const LATEST_PUBLISHED_CLUSTER_MESH = '0.25.0';

export const isPrerelease = (version: string): boolean => version.includes('-');

const devBumpPattern = (reservedNext: string): RegExp =>
  new RegExp(`^${reservedNext.replace(/\./g, '\\.')}-dev\\.\\d+$`);

// Pack-only topic bump: true only when the workspace version is a
// `<reservedNext>-dev.N` prerelease AND the frozen published pin matches.
// Anything else (stable, rc, another line, or a different pin)
// takes the strict pin path, so the tolerance never widens.
export const isPackOnlyDevBump = (
  workspaceVersion: string,
  publishedPin: string,
  reservedNext: string,
): boolean =>
  devBumpPattern(reservedNext).test(workspaceVersion) &&
  publishedPin === LATEST_PUBLISHED_CLUSTER_MESH;
