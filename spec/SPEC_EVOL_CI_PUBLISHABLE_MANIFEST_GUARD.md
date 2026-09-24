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

## 6. D3 — Classification from `changes`

Extend the existing `dorny/paths-filter@v4` step with `list-files: json` and one additional filter `publishable_package_files: ['packages/*/**']`. Export `package_files: ${{ steps.filter.outputs.publishable_package_files_files }}` and `matched_filters: ${{ steps.filter.outputs.changes }}` from the `changes` job. Preserve every current validation and publication filter. The additional file list covers manifests, tests, assets, deleted paths, and new packages, not merely `src/**`.

Use the SAME dorny comparison as existing publication selection: PRs use the PR file API; main pushes compare the event's `before` SHA with its head. Main workflow_dispatch currently falls back to last-commit changes when `before` is absent; preserve that behavior and union bootstrap selection. Do not recompute a separate `HEAD^` diff. Persist event type, event base/head/before SHAs where available, matched filters, and reasons in the report.

Algorithm (one shared classifier used by inventory and validation packs):

1. Enumerate immediate `packages/*/package.json`, parse JSON, and retain `private !== true` as `U`. Invalid JSON/nonboolean `private` is a structural error, never a private-package skip. Record removed package directories separately as notices; no attempt to pack nonexistent paths.
2. `C` = packages in `U` owning any path in `package_files`, including a manifest-only change or a transition from private to public. Treat rename source and destination as touched. Verified upstream [dorny v4 main.ts](https://github.com/dorny/paths-filter/blob/v4/src/main.ts) represents a PR rename as deleted `previous_filename` plus added `filename`; its Git path uses `--no-renames`. Consume those paths directly; no second diff or custom rename normalization.
3. `P` = packages whose existing `_publish` filter appears in `matched_filters` AND whose steady-state npm `publish-<slug>` job references that filter. This is the would-publish-on-main set for a PR; do not require the PR's `github.ref` to equal main. Ignore version-already-exists skips: selection alone suffices to BLOCK. Map slug `-` to filter `_` explicitly and validate the mapping against ci.yml.
4. `D` = bootstrap target selected on `workflow_dispatch`; `all` expands to the actual bootstrap step list, `none` to empty. Include `D` even if no files changed. Steady-state jobs can also run on a main dispatch; retain `P` for those events.
5. `B = C ∪ P ∪ D`; BLOCK each package in `B`, WARN every other package in `U`. Standalone explicit `pack-<slug>` defaults to BLOCK. `publish-<slug>` and token publication ALWAYS force BLOCK, regardless of supplied context. Invalid/missing CI context is an error; never silently downgrade to WARN.

The steady-state mapping is: `llm-mesh`, `llm-gateway`, `cluster-mesh`, `chat-ui`, `cited-source-viewer`, `cowork-bridge`, `cowork-desktop`, `oauth-verify`, `mcp-auth`, `mcp-platform`, `auth-hono`, `auth-client`, `auth-ui`, `contracts`, `events`, `chat-core`, `chat-server`, `comments`, `flow`, `build-cli`, `harness`, `cli`. `focus_publish` exists but has no steady-state publish job at this baseline: focus enters BLOCK through `C` or bootstrap `D`, not that unused filter alone. `skills` is public but has no `pack-skills`/publisher lane: include it in inventory; a future change selecting it must provide a candidate pack lane before passing.

| Change/event | Required result |
|---|---|
| Only Makefile, guard scripts, or ci.yml changes | Existing global validation can run; packages remain WARN unless independently selected in `C/P/D`. |
| Only cluster-mesh source, tests, README, or manifest changes | Cluster-mesh BLOCK; unrelated cowork-desktop WARN. |
| Only oauth-verify changes | oauth-verify BLOCK; mcp-auth validates due its dependency filter but remains WARN unless itself selected. |
| Root package.json or package-lock.json changes | Current publication filters select all steady-state publishers, including cowork-desktop: BLOCK is intentional. |
| `workflow_dispatch` target cowork-desktop or `all` | cowork-desktop BLOCK, even if unchanged. |
| Docs-only PR outside packages | Inventory still reports all public packages; violations are WARN. |

Emit escaped `::error file=packages/<slug>/package.json,title=Publishable manifest::...` for BLOCK violations and `::warning ...` for WARN. Include packed-member location in the message rather than inventing source line numbers. Escape `%`, CR/LF and annotation-property separators; also write plain logs and JSON. Exit nonzero if any BLOCK violation, missing selected pack lane, or classification/tooling error occurs; WARN findings alone exit zero. An individual WARN archive failure emits `audit-incomplete` warning, not a false PASS. An unreadable global inventory/context fails the job. Never use `continue-on-error` to implement this policy.

## 7. D4 — Root Makefile and CI lint contract

Extend the existing static pattern, keeping its entire Docker/eslint body unchanged except for the working directory:

```make
.PHONY: lint-llm-mesh lint-llm-gateway lint-cluster-mesh
lint-llm-mesh lint-llm-gateway lint-cluster-mesh: lint-%:
# Existing recipe: change -w /workspace/packages/llm-$* to -w /workspace/packages/$*.
```

Keep `$(LLM_MESH_NODE_IMAGE)` (`node:24-bookworm-slim`), caller UID/GID, `HOME=/tmp`, isolated npm cache/tool directory, exact tool versions, generated config, `src tests`, and the same three disabled rules. No source fixes, new local config, or local Makefile is implied. Add `Lint Cluster Mesh` immediately after Docker setup in `validate-cluster-mesh`, running `make lint-cluster-mesh ENV=test-ci-cluster-mesh`; preserve its `needs: [changes]` and existing condition. Use that ENV on the other touched cluster-mesh make steps as well.

## 8. Shared guard and pack target contracts

BUILD adds `scripts/ci/publishable-manifests.mjs` (schema/ranges, classification, archive inspection, report CLI), `scripts/ci/check-publishable-manifests.sh` (sequential Make orchestration), and `scripts/ci/qualify-published-install.mjs` (consumer probe). Scripts run only behind root Make targets. Node helpers use argument arrays, never evaluate package metadata as shell code. Pin ephemeral tool installs; no root package/lock edits are needed.

| Root target | Exact contract |
|---|---|
| `check-publishable-manifest TARBALL=<path> [SOURCE_MANIFEST=<path>]` | Inspect one real archive and optional source using the shared checker; strict by default. Internal CI mode derives severity from validated context, never a public `WARN=1` escape for publishing. |
| `pack-publishable-manifest PACKAGE=<slug> [PACK_DESTINATION=<dir>]` | Packaging primitive for an already built package: validate source, run real `npm pack --json --pack-destination <unique-dir>`, parse its JSON filename, inspect the packed member, report hash/path; run normal pack lifecycle hooks. It does not build or publish. |
| `check-publishable-manifests` | Always enumerate `U`, validate context, check all source manifests, run full `make pack-<slug>` sequentially for BLOCK packages, and perform lightweight archive audits for WARN packages. Aggregate every diagnostic before the final exit. |
| `test-publishable-manifests` | Docker Node test runner for policy, classification, lifecycle, archive, and workflow wiring fixtures. |
| `qualify-published-install PKG=<name>@<exact-version>` or `qualify-published-install TARBALL=<path>` | Install and import in a fresh consumer container as specified in section 10. Exactly one input is required. |
| `test-qualify-published-install` | Docker Node test runner for qualification behavior with local fixture tarballs; no registry publish. |

Use the validated `$(LLM_MESH_NODE_IMAGE)` for all new targets, without Compose services, host Node, Python, mounted Docker socket, or exposed ports. The shell orchestrator invokes child Make targets on the host; each tool/build runs in Docker. Propagate ENV as the final child Make argument. Transfer classification through exported `CI_MANIFEST_CONTEXT`, `CI_MANIFEST_EVENT`, and `CI_MANIFEST_BOOTSTRAP_TARGET`, explicitly forwarded by Docker `-e`; never interpolate raw JSON into a shell program.

WARN archive audit: for every nonselected public package, run `npm pack --ignore-scripts --json` into a temporary container directory and inspect its actual `package/package.json`. This deliberately skips builds/hooks so ownerless packages and native build prerequisites do not block unrelated work. Label evidence `inventory-snapshot`, never `release-candidate` or install-qualified. Source plus snapshot checks enforce the authoring rule; only the full build/pack path can attest final lifecycle transformations. This also covers public `skills` without invoking its native build toolchain. No package is silently omitted because it lacks a named pack target.

All existing `pack-<slug>` targets keep their build prerequisites and replace dry-run packing with the shared real-pack primitive. Exact set: cluster-mesh, llm-mesh, llm-gateway, chat-ui, cited-source-viewer, auth-hono, auth-client, oauth-verify, mcp-auth, mcp-platform, auth-ui, cowork-bridge, cowork-desktop, build-cli, harness, focus, cli, contracts, events, chat-core, chat-server, comments, flow. Candidate packing requires a known explicit target; do not synthesize a target name from unchecked paths. A selected unknown public package fails with an actionable missing-lane diagnostic.

For chat-ui and cited-source-viewer, preserve existing dist sanity checks, call the existing `scripts/make-publish-pkgjson.mjs --write`, pack and inspect while the dist-form manifest is active, then restore the source form using the existing trap on success AND failure. Check the saved original manifest as well. chat-ui's `prepack` artifact verifier must still execute. Never add a dependency-rewrite exception to either transformation. Guard `package-llm-routing-candidates` for both produced tarballs as well.

Use one archive per invocation, outside the package directory, with a cleanup trap. Resolve the filename only from successful npm pack JSON; require exactly one archive and exactly one regular `package/package.json` member, bounded in size. Read that member without extracting arbitrary paths; reject malformed archives, duplicate members, symlinks, identity/version mismatch, and any packed attempt to switch private status. Preserve the tarball only when `PACK_DESTINATION` is explicit. This is dependency validation, not a claim that every file/export is present.

Every listed `publish-<slug>` and `publish-<slug>-token` retains current build prerequisites, OIDC environment, access/provenance flags, token cleanup, already-published skip, and ordering. Immediately before a real publication: produce one full candidate archive using the same transform/lifecycle path, force strict source+archive checks, and pass THAT archive to `npm publish <verified.tgz>`; never repack the directory afterward. Preserve chat-ui prepack verification and mesh OAuth verification. No current package declares `prepublishOnly`/publish/postpublish hooks; add a regression check that rejects newly introduced publish-only hooks pending an explicit lifecycle design, since tarball publication differs from directory publication. No publication is executed by this SPEC or by guard tests.

## 9. Exact ci.yml job and step changes

1. `changes`: add the two outputs and package file filter from section 6; enable JSON file lists. Keep checkout and dorny v4; make `contents: read` and `pull-requests: read` permissions explicit. Add `scripts/ci/**` to the existing `global` filter so guard/lint-wiring edits exercise validation. Do not add these paths to any `_publish` filter. No custom diff or rename step is needed.
2. New `validate-publishable-manifests`: `runs-on: ubuntu-latest`, `needs: [changes]`, no package/path `if`, `permissions: {contents: read}`. Steps: checkout v6; Docker setup v4; `make test-publishable-manifests test-qualify-published-install ENV=test-ci-manifests`; `make check-publishable-manifests ENV=test-ci-manifests`; upload JSON/log artifacts with `actions/upload-artifact@v4` under `if: always()` (7-day retention). Pass `CI_MANIFEST_CONTEXT: ${{ toJSON(needs.changes.outputs) }}`, event name and bootstrap input via job `env`; no registry credentials or OIDC token.
3. Every existing `validate-<slug>` pack step: pass the same CI context/event/bootstrap values via step `env` and an explicit `ENV=test-ci-<slug>` argument. Shared classification therefore keeps globally triggered cowork/mcp-auth pack diagnostics at WARN. Existing lint/typecheck/build failures retain their existing failure semantics. Add the cluster-mesh lint step from section 7. Missing candidate pack coverage is checked independently by the new job.
4. Every steady-state npm `publish-<slug>` job: add `validate-publishable-manifests` to `needs`. Preserve existing conditions and permissions. For `publish-llm-gateway`, which uses `always()`, additionally require `needs.validate-publishable-manifests.result == 'success'`; preserve mesh publish success-or-skipped ordering. Image publishers and deployment jobs are outside this change.
5. `bootstrap-publish`: add `needs: [changes, validate-publishable-manifests]`; retain main-only dispatch guard and per-target/all selection. The new gate must succeed before the token-file step. Each token target independently forces strict artifact validation, including focus.
6. Add `qualify-published-install` steps to `validate-mcp-auth` and `validate-cluster-mesh` after their full packs, using those exact tarballs; add `PACK_DESTINATION` to retain them in job-local artifacts and feed the path emitted by pack, not a glob. Post-publish qualification steps in `publish-mcp-auth`, `publish-cluster-mesh`, and the corresponding selected bootstrap paths install the exact version from the package manifest. Registry propagation retries apply only to a missing just-published version (12 attempts, 5 seconds, matching the existing mesh dependency wait); all install/import failures remain failures.

The conductor must add `validate-publishable-manifests` to required PR checks after its first successful CI run; YAML alone cannot change branch protection. A failing unrelated WARN finding cannot block merge, but failure of the checker itself must. The two qualification additions are mandatory for these backend packages; browser-only packages do not acquire a generic Node-import CI requirement.
