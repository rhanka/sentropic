// Pack-only dev tolerance for the installed-comments bare probe.
//
// The E2 integration reserves `RESERVED_NEXT` (today `0.24.0`) for its release
// line: lot workspaces carry `<reservedNext>-dev.N` by plan while the frozen
// packaging fixture keeps pinning the latest published release
// (`LATEST_PUBLISHED_CLUSTER_MESH`, today `0.22.4`). This mirrors the contract
// in tests/fixtures/reserved-versions.ts (#767), duplicated here because the
// bare probe runs as plain node `.mjs`. Bump the two versions together here
// and there.
export const RESERVED_NEXT = '0.24.0';
export const LATEST_PUBLISHED_CLUSTER_MESH = '0.22.4';
export const PACK_ONLY_PACKAGE = '@sentropic/cluster-mesh';

const devBumpPattern = (reservedNext) =>
  new RegExp(`^${reservedNext.replace(/\./g, '\\.')}-dev\\.\\d+$`);

// The tolerance applies to the exact package and version pair only, read from
// the refusal itself: the refused package must be cluster-mesh itself at a
// `<reservedNext>-dev.N` prerelease while the frozen pin is still the latest
// published release.
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
