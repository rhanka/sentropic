# CI Publishable Manifest Guard — Evolution Specification

## 1. Status, objective, and authority

Status: Lot G SPEC, design only, 2026-09-24. Baseline: `273bff382` (`origin/main` at entry). This document defines TARGET behavior; it does not claim implementation or live qualification results. The conductor owns BUILD authorization and independent review before push/PR/merge.

Deliver three controls: root-owned cluster-mesh lint in CI, an npm-compatible dependency authoring rule enforced against packed manifests, and an isolated consumer install/import qualification target. This branch changes only this specification and `BRANCH.md`. All Makefile, workflow, script, test, and rule changes below belong to BUILD.

## 2. CURRENT evidence and root cause

| Evidence | Consequence |
|---|---|
| Root `package.json`: `workspaces: ["api", "ui", "packages/*"]`; root `package-lock.json`; no pnpm/yarn lockfile | npm is the package manager; choose plain semver ranges. |
| `Makefile:539`: static `lint-llm-%` rule for mesh/gateway, isolated eslint `10.0.2` and typescript-eslint `8.56.1` | Extend this root recipe; do not resurrect cluster-mesh's removed package-local lint.mk. |
| `validate-cluster-mesh` currently runs typecheck, test, build, pack, without lint | Add lint to that job before typecheck. |
| Most `pack-*` recipes run `npm pack --dry-run`; chat-ui and cited-source-viewer rewrite exports temporarily | A source-only check or dry-run listing cannot prove the manifest actually distributed. |
| Most `publish-*` and `publish-*-token` recipes publish a directory independently of pack validation | Guard the exact tarball submitted by every publication path. |
| `enforce-package-bump` is PR-only and considers `packages/<p>/src/**` | Keep it focused on version changes; dependency-only edits need their own gate. |
| `changes` has broad validation filters and narrower `<slug_with_underscores>_publish` filters | Validation selection alone must not promote unrelated packages to BLOCK. |

The auth incident is a dependency-authoring failure: npm does not replace `file:../oauth-verify` with a version range at publication. The conductor reports `@sentropic/mcp-auth@0.2.0` shipped that value and was unusable outside the monorepo; `0.2.1` fixes it through PR #603. This checkout still contains `0.2.0` and the invalid value. Do not mistake that source snapshot for the fixed registry artifact.

`workspace:` is also invalid here: npm rejects it with `EUNSUPPORTEDPROTOCOL`; pnpm/yarn rewriting behavior does not apply. npm workspaces already link a local dependency when its version satisfies the declared plain range. Authors must select a compatible, published semver range (for example `^0.1.0`), bump the consumer as required, and refresh the npm lockfile through approved Make targets. The guard never guesses or rewrites dependency versions.

Known debt at 2026-09-24: cowork-desktop `0.2.0` declares `file:../chat-ui` and `file:../cowork-bridge`. Its remediation owner is unassigned. Preserve warnings when unrelated; changing or publishing it makes compliance mandatory. This lot does not repair or republish either package.

## 3. D1 — Authoring and packed-manifest rule

For each immediate `packages/*/package.json` with `private !== true`, every value in `dependencies`, `peerDependencies`, and `optionalDependencies` MUST be a nonempty plain semver range. Check all three maps independently, including optional peers and names duplicated across maps. Exclude `devDependencies`, repository URLs, export/main/types paths, and the private root/api/ui manifests. Private-package exclusion uses the boolean `true`, not a truthy string.

Exact JavaScript forbidden-spec regex, applied to a trimmed string, case-insensitively:

```js
/^(?:(?:file|link|portal|workspace|github|gitlab|bitbucket|https?|ftp|npm):|git(?:\+[^:]+)?:|ssh:|\.{1,2}(?:[\\/]|$)|[\\/]|[a-z]:[\\/]|~(?:[\\/]|$))/i
```

This rejects the named protocols, HTTP(S) tarball URLs (including URLs without `.tgz`), POSIX/rooted/UNC and Windows absolute paths, relative paths, and home-relative paths. It intentionally also rejects npm aliases and other non-range references. The regex is a diagnostic classifier, NOT the complete allow rule: a string passes only if it is nonempty, matches no forbidden prefix, and `semver.validRange(value, { loose: false }) !== null`. Reject non-string values and malformed dependency maps; use pinned `semver@7.7.2` installed in an ephemeral Docker tool directory, never the root dependency graph. Tags (`latest`, `next`), Git shorthand (`owner/repo`), bare tarball names, unknown schemes, and garbage fail the positive range check. Accept exact/prerelease versions, caret/tilde/comparator ranges, hyphen ranges, disjunctions, and semver wildcards (`*`, `1.x`).

Check source values for actionable author feedback AND read `package/package.json` from the actual `.tgz` for final enforcement. Report artifact name/version, dependency section/name/value, classification reason, and tarball SHA-256. Never validate a guessed filename or the working manifest in place of the packed member. A selected package cannot escape by having a pack hook remove its source violation or change its identity/private flag.

## 4. D2 — Placement recommendation

| Placement | Advantages | Limits |
|---|---|---|
| Only `pack-*` | Local/CI parity; observes build and manifest transformations | Skipped validators and unrelated published packages remain invisible; publishing currently repacks independently. |
| Inside `enforce-package-bump` | Existing required PR gate | Wrong trigger (`src/**` only), no push/bootstrap coverage, no packed artifact; couples unrelated policies. |
| New inventory job only | Always visible; centralized classification and annotations | A cheap audit cannot replace full build/pack lifecycle checks or protect a later repack. |
| **Recommended: new inventory job + shared pack/publish guard** | Covers every public manifest, changed-package actual tarballs, and the final publication artifact | Extra packaging work and some duplicate builds; keep helpers shared and validate filter/target coverage. |

Keep `enforce-package-bump` unchanged. Add `validate-publishable-manifests` as an always-scheduled job after `changes`, and make npm publication jobs depend on its success. Source and lightweight inventory diagnostics follow BLOCK/WARN classification; full candidate pack and publication checks close the lifecycle gap. Do not use workflow-wide `continue-on-error`, package name exemptions, or automatic dependency rewriting.

## 5. Decision register

| ID | Decision | Rationale |
|---|---|---|
| D1 | Plain semver in source and packed runtime/peer/optional dependency maps | Removes the npm authoring root cause. |
| D2 | Shared artifact checker, inventory job, pack and publication integration | Covers skipped validation and the actual bytes submitted. |
| D3 | BLOCK changed or publication-selected packages; WARN others | Enforces new work without transferring ownerless cowork debt to unrelated PRs. |
| D4 | Extend the root lint static pattern | Reuses the proven tooling and configuration without package-local rules. |
| D5 | Fresh Docker consumer installation with entry-point imports | Workspace links and caches must not hide packaging defects. |
| D6 | BUILD closes only after both specified published-version replays pass | A design review is not an install qualification result. |
