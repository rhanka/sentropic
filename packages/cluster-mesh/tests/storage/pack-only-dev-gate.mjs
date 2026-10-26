// Pack-only dev tolerance for the installed-comments bare probe.
//
// The E2 integration reserves `RESERVED_NEXT` (today `0.23.0`) for its release
// line: lot workspaces carry `<reservedNext>-dev.N` by plan while the frozen
// packaging fixture keeps pinning the latest published release
// (`LATEST_PUBLISHED_CLUSTER_MESH`, today `0.22.4`). This mirrors the contract
// in tests/fixtures/reserved-versions.ts (#767), duplicated here because the
// bare probe runs as plain node `.mjs`. Bump the two versions together here
// and there.
export const RESERVED_NEXT = '0.23.0';
export const LATEST_PUBLISHED_CLUSTER_MESH = '0.22.4';

const devBumpPattern = (reservedNext) =>
  new RegExp(`^${reservedNext.replace(/\./g, '\\.')}-dev\\.\\d+$`);

export const isPackOnlyDevBump = (workspaceVersion, publishedPin, reservedNext) =>
  devBumpPattern(reservedNext).test(workspaceVersion) &&
  publishedPin === LATEST_PUBLISHED_CLUSTER_MESH;

// Bare-probe refusal decision: a bare install (comments peer absent) must
// refuse with `not_installed`; a pack-only `<reservedNext>-dev.N` candidate
// whose leaf sits outside the frozen Comments range refuses with
// `incompatible_version` instead, which the gate accepts.
export const acceptsCommentsRefusal = ({ installedVersion, publishedPin, reservedNext, reason, code }) => {
  if (reason === 'not_installed' || code === 'not_installed') return true;
  return reason === 'incompatible_version'
    && isPackOnlyDevBump(installedVersion, publishedPin, reservedNext);
};
