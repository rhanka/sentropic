// Pack-only dev tolerance for the installed-comments bare probe.
//
// The release train reserves `RESERVED_NEXT` (today `0.26.0`) for its release
// line: lot workspaces carry `<reservedNext>-dev.N` by plan. The frozen
// published compatibility pin (`LATEST_PUBLISHED_CLUSTER_MESH`, `0.24.0`)
// stays separate from the selected local candidate. This mirrors the contract
// in tests/fixtures/reserved-versions.ts (#767), duplicated here because the
// bare probe runs as plain node `.mjs`. Keep both constants aligned here
// and there; moving the reservation does not move the frozen published pin.
// The pin is the latest published release whose dependency and peer metadata
// equals the candidate's (0.24.0 published; candidate metadata unchanged).
export const RESERVED_NEXT = '0.26.0';
export const LATEST_PUBLISHED_CLUSTER_MESH = '0.24.0';
export const PACK_ONLY_PACKAGE = '@sentropic/cluster-mesh';

const devBumpPattern = (reservedNext) =>
  new RegExp(`^${reservedNext.replace(/\./g, '\\.')}-dev\\.\\d+$`);

// The tolerance applies to the exact package and version pair only, read from
// the refusal itself: the refused package must be cluster-mesh itself at a
// `<reservedNext>-dev.N` prerelease with the exact frozen published pin.
export const isPackOnlyDevBump = (packageName, workspaceVersion, publishedPin, reservedNext) =>
  packageName === PACK_ONLY_PACKAGE &&
  typeof workspaceVersion === 'string' &&
  devBumpPattern(reservedNext).test(workspaceVersion) &&
  publishedPin === LATEST_PUBLISHED_CLUSTER_MESH;

// Bare-probe refusal decision: a bare install (comments peer absent) must
// refuse with `not_installed`; a pack-only `<reservedNext>-dev.N` candidate
// whose leaf sits outside the frozen Comments range refuses with
// `incompatible_version` instead, which the gate accepts.
export const acceptsCommentsRefusal = ({ packageName, installedVersion, publishedPin, reservedNext, reason, code }) => {
  if (reason === 'not_installed' || code === 'not_installed') return true;
  return reason === 'incompatible_version'
    && isPackOnlyDevBump(packageName, installedVersion, publishedPin, reservedNext);
};
