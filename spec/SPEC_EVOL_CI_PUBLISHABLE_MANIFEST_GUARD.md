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
| `global` excludes root package.json/lockfile; every `_publish` filter includes both | api/ui workspace dependency bumps rewrite the root lockfile and select unrelated publishers; selection must account for existing registry versions. |

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

Keep `enforce-package-bump` unchanged. Add `validate-publishable-manifests` as an always-scheduled required PR check after `changes`, without adding it to any publisher's `needs`. Source and lightweight inventory diagnostics follow BLOCK/WARN classification; full candidate pack and strict per-package publication checks close the lifecycle gap without a violation in X stopping publication of Y. Do not use workflow-wide `continue-on-error`, package name exemptions, or automatic dependency rewriting.

## 5. Decision register

| ID | Decision | Rationale |
|---|---|---|
| D1 | Plain semver in source and packed runtime/peer/optional dependency maps | Removes the npm authoring root cause. |
| D2 | Shared artifact checker, inventory job, pack and publication integration | Covers skipped validation and the actual bytes submitted. |
| D3 | BLOCK changed packages, publication-selected absent packed versions, and explicit bootstrap targets; WARN others | Enforces new work without transferring ownerless cowork debt through root-lock changes or bootstrap all. |
| D4 | Extend the root lint static pattern | Reuses the proven tooling and configuration without package-local rules. |
| D5 | Fresh Docker consumer installation with entry-point imports | Workspace links and caches must not hide packaging defects. |
| D6 | BUILD closes only after both specified published-version replays pass | A design review is not an install qualification result. |

## 6. D3 — Classification from `changes`

Extend the existing `dorny/paths-filter@v4` step with `list-files: json` and one additional filter `publishable_package_files: ['packages/*/**']`. Export `package_files: ${{ steps.filter.outputs.publishable_package_files_files }}` and `matched_filters: ${{ steps.filter.outputs.changes }}` from the `changes` job. Preserve every current validation and publication filter. The additional file list covers manifests, tests, assets, deleted paths, and new packages, not merely `src/**`.

Use the SAME dorny comparison as existing publication selection: PRs use the PR file API; main pushes compare the event's `before` SHA with its head. Main workflow_dispatch currently falls back to last-commit changes when `before` is absent; preserve that behavior and union bootstrap selection. Do not recompute a separate `HEAD^` diff. Persist event type, event base/head/before SHAs where available, matched filters, and reasons in the report.

Algorithm (one shared classifier used by inventory and validation packs):

1. Enumerate immediate `packages/*/package.json`, parse JSON, and retain `private !== true` as `U`. Absent `private` is valid; invalid JSON or a present nonboolean `private` is a structural error, never a private-package skip. Record removed package directories separately as notices; no attempt to pack nonexistent paths.
2. `C` = packages in `U` owning only `packages/<slug>/**` paths from `publishable_package_files`, including a manifest-only change or a transition from private to public. Root manifest/lockfile paths never enter `C`. Treat rename source and destination as touched. Verified upstream [dorny v4 main.ts](https://github.com/dorny/paths-filter/blob/v4/src/main.ts) represents a PR rename as deleted `previous_filename` plus added `filename`; its Git path uses `--no-renames`. Consume those paths directly; no second diff or custom rename normalization.
3. `P` = packages whose existing `_publish` filter appears in `matched_filters` AND whose steady-state npm `publish-<slug>` job references that filter. This is the would-publish-on-main set for a PR; do not require the PR's `github.ref` to equal main. Map slug `-` to filter `_` explicitly and validate the mapping against ci.yml. Define `P' = { p ∈ P : the PACKED version of p is ABSENT from the registry }`; only `P'` promotes publication selection to BLOCK.
4. `D` = bootstrap target selected on `workflow_dispatch`; `none` is empty. For `all`, expand the actual bootstrap step list and retain only packages whose packed version is absent, using the same registry filter as `P'`. An explicit target stays in `D` regardless of version existence. Include `D` even if no files changed. Steady-state jobs can also run on a main dispatch; retain `P'` for those events.
5. `B = C ∪ P' ∪ D`; BLOCK each package in `B`, WARN every other package in `U`. Standalone explicit `pack-<slug>` defaults to BLOCK. Every actual OIDC/token publication forces BLOCK regardless of supplied context; existing-version skips occur before candidate packing and strict checks (section 8). Invalid/missing CI context is an error; never silently downgrade to WARN.

Resolve packed name/version from a lightweight archive snapshot (section 8), applying existing manifest transforms and restoring them, before registry classification; never infer the packed version solely from source or a filename. Full candidates must retain that identity/version; a mismatch is ERROR. Query the exact packed name/version at `https://registry.npmjs.org` inside Docker and record `present|absent|error` with lookup evidence. Only a confirmed missing package/version means absent; network, authentication, rate-limit, server, malformed-response, or other lookup failures are ERROR, never WARN or absence. Failure to obtain packed identity needed for `P'`/bootstrap-all classification is also ERROR, not an incomplete WARN audit. Cache successful lookups within the invocation; recheck immediately before publication to handle races.

The steady-state mapping is: `llm-mesh`, `llm-gateway`, `cluster-mesh`, `chat-ui`, `cited-source-viewer`, `cowork-bridge`, `cowork-desktop`, `oauth-verify`, `mcp-auth`, `mcp-platform`, `auth-hono`, `auth-client`, `auth-ui`, `contracts`, `events`, `chat-core`, `chat-server`, `comments`, `flow`, `build-cli`, `harness`, `cli`. `focus_publish` exists but has no steady-state publish job at this baseline: focus enters BLOCK through `C` or bootstrap `D`, not that unused filter alone. `skills` is public but has no `pack-skills`/publisher lane: include it in inventory; a future change selecting it must provide a candidate pack lane before passing.

| Change/event | Required result |
|---|---|
| Only Makefile, guard scripts, or ci.yml changes | Existing validation can run; packages remain WARN unless independently selected in `C/P'/D`. |
| Only cluster-mesh source, tests, README, or manifest changes | Cluster-mesh BLOCK; unrelated cowork-desktop WARN. |
| Only oauth-verify changes | oauth-verify BLOCK; mcp-auth validates due its dependency filter but remains WARN unless itself selected. |
| Root-only package.json or package-lock.json changes, including api/ui dependency bumps | Publication filters select cowork-desktop, but it stays WARN if its packed version exists; only `P'` promotes an unchanged package to BLOCK, on PRs and main. |
| `workflow_dispatch` target cowork-desktop | cowork-desktop BLOCK, even if unchanged or already published. |
| `workflow_dispatch` target `all` | Existing packed versions remain WARN unless in `C`; absent selected versions are BLOCK. |
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

Default host reports to `MANIFEST_REPORT_DIR=tmp/ci-manifest-guard/manifests` and qualification reports to `REPORT_DIR=tmp/ci-manifest-guard/qualification` (both under the existing ignored `/tmp/` subtree). Each retained pack writes a JSON receipt with absolute archive path, SHA-256, and `manifest_mode=block|warn`. Optional `PACK_OUTPUT_FILE=<runner GITHUB_OUTPUT path>` appends escaped `tarball` and `manifest_mode` outputs for the enclosing pack step; validation jobs use `id: pack`. Docker receives only the required report/output mounts. No new .gitignore entry is needed.

WARN archive audit: for every nonselected public package, run `npm pack --ignore-scripts --json` into a temporary container directory and inspect its actual `package/package.json`. This deliberately skips builds/hooks so ownerless packages and native build prerequisites do not block unrelated work. Label evidence `inventory-snapshot`, never `release-candidate` or install-qualified. Source plus snapshot checks enforce the authoring rule; only the full build/pack path can attest final lifecycle transformations. This also covers public `skills` without invoking its native build toolchain. No package is silently omitted because it lacks a named pack target.

All existing `pack-<slug>` targets keep their build prerequisites and replace dry-run packing with the shared real-pack primitive. Exact set: cluster-mesh, llm-mesh, llm-gateway, chat-ui, cited-source-viewer, auth-hono, auth-client, oauth-verify, mcp-auth, mcp-platform, auth-ui, cowork-bridge, cowork-desktop, build-cli, harness, focus, cli, contracts, events, chat-core, chat-server, comments, flow. Candidate packing requires a known explicit target; do not synthesize a target name from unchecked paths. A selected unknown public package fails with an actionable missing-lane diagnostic.

For chat-ui and cited-source-viewer, preserve existing dist sanity checks, call the existing `scripts/make-publish-pkgjson.mjs --write`, pack and inspect while the dist-form manifest is active, then restore the source form using the existing trap on success AND failure. Check the saved original manifest as well. chat-ui's `prepack` artifact verifier must still execute. Never add a dependency-rewrite exception to either transformation. Guard `package-llm-routing-candidates` for both produced tarballs as well.

Use one archive per invocation, outside the package directory, with a cleanup trap. Resolve the filename only from successful npm pack JSON; require exactly one archive and exactly one regular `package/package.json` member, bounded in size. Capture lifecycle logs separately and cover chat-ui's noisy prepack stdout in fixtures; never treat log text as a filename. Read that member without extracting arbitrary paths; reject malformed archives, duplicate members, symlinks, identity/version mismatch, and any packed attempt to switch private status. Preserve the tarball only when `PACK_DESTINATION` is explicit. This is dependency validation, not a claim that every file/export is present.

Every listed `publish-<slug>` and `publish-<slug>-token` retains current build prerequisites, OIDC environment, access/provenance flags, token cleanup, and ordering. After packed-identity discovery, the order is explicit: registry lookup → "version already exists" → skip with a WARN report, BEFORE the full candidate pack and strict check. Lookup failure is ERROR. Only for a confirmed absent version: produce one full candidate archive using the same transform/lifecycle path, force strict source+archive checks, and pass THAT archive to `npm publish <verified.tgz>`; never repack the directory afterward. Preserve chat-ui prepack verification and mesh OAuth verification. No current package declares `prepublishOnly`/publish/postpublish hooks; add a regression check that rejects newly introduced publish-only hooks pending an explicit lifecycle design, since tarball publication differs from directory publication. No publication is executed by this SPEC or by guard tests.

## 9. Exact ci.yml job and step changes

1. `changes`: add the two outputs and package file filter from section 6; enable JSON file lists. Keep checkout and dorny v4; make `contents: read` and `pull-requests: read` permissions explicit. Add `scripts/ci/**` to the existing `global` filter so guard/lint-wiring edits exercise validation. Do not add these paths to any `_publish` filter. No custom diff or rename step is needed.
2. New `validate-publishable-manifests`: `runs-on: ubuntu-latest`, `needs: [changes]`, `if: always() && !cancelled()`, `permissions: {contents: read}`. Steps: checkout v6; Docker setup v4; `make test-publishable-manifests test-qualify-published-install ENV=test-ci-manifests`; `make check-publishable-manifests ENV=test-ci-manifests`; upload `tmp/ci-manifest-guard/manifests/**` JSON/log artifacts with `actions/upload-artifact@v4` under `if: always()` (7-day retention). Pass `CI_MANIFEST_CONTEXT: ${{ toJSON(needs.changes.outputs) }}`, `CI_MANIFEST_CHANGES_RESULT: ${{ needs.changes.result }}`, event name and bootstrap input via job `env`; the inventory target rejects a non-success changes result or missing outputs. Thus a failed `changes` job cannot leave this required status silently skipped. No registry credentials or OIDC token are passed.
3. Every existing `validate-<slug>` pack step: pass the same CI context/event/bootstrap values via step `env` and an explicit `ENV=test-ci-<slug>` argument. Shared classification therefore keeps globally triggered cowork/mcp-auth pack diagnostics at WARN. Existing lint/typecheck/build failures retain their existing failure semantics. Add the cluster-mesh lint step from section 7. Missing candidate pack coverage is checked independently by the new job.
4. Every steady-state npm `publish-<slug>` job: preserve existing `needs`, conditions, permissions, and gateway's mesh success-or-skipped ordering; do not add the global inventory job to `needs` or its result to conditions. The strict checker inside each Make publication target guards its own bytes. Image publishers and deployment jobs are outside this change.
5. `bootstrap-publish`: preserve its existing needs and main-only dispatch/per-target/all selection; do not depend on the global inventory job. Apply the absent-version filter to `all` and keep explicit targets BLOCK in inventory. Each token target independently follows the skip-before-candidate ordering and forces strict checks on actual publication, including focus.
6. Add `qualify-published-install` steps to `validate-mcp-auth` and `validate-cluster-mesh` after their full packs, under `if: steps.pack.outputs.manifest_mode == 'block'`, using `steps.pack.outputs.tarball`. Add `PACK_DESTINATION` and `PACK_OUTPUT_FILE` to retain and identify those exact job-local archives, never a glob. An unrelated validation must not turn a WARN manifest into a blocking clean-install failure. Post-publish qualification steps in `publish-mcp-auth`, `publish-cluster-mesh`, and the corresponding selected bootstrap paths install the exact version from the package manifest. Registry propagation retries apply only to a missing just-published version (12 attempts, 5 seconds, matching the existing mesh dependency wait); all install/import failures remain failures. Upload each qualification report under `if: always()`.

The conductor must add `validate-publishable-manifests` to required PR checks after its first successful CI run; YAML alone cannot change branch protection. A failing unrelated WARN finding cannot block merge, but failure of the checker itself must. The two qualification additions are mandatory for these backend packages; browser-only packages do not acquire a generic Node-import CI requirement.

## 10. D5 — Clean out-of-monorepo installation

`qualify-published-install` uses `$(LLM_MESH_NODE_IMAGE)`, the Node 24 Debian slim image already used by these packages. Start a new `docker run --rm` via Make with no Compose dependencies, host Node, Python, exposed ports, npm credentials, monorepo mount, or shared node_modules/cache. Mount only the standalone probe script read-only at `/probe/qualify.mjs`, an optional single input archive read-only at `/input/package.tgz`, and an explicit report directory at `/reports`. The image's bundled Node/npm is logged with the resolved image identity. Never mount the repository at a second path or copy its lockfile/overrides into the consumer.

Create `/tmp/consumer-<random>` inside the container and a minimal `{ "private": true, "type": "module" }` package.json; use a new cache and empty user/global npm config. Clear `NODE_PATH`, `NODE_OPTIONS`, inherited npm prefix/workspace configuration and credentials. Install from `https://registry.npmjs.org` using npm's normal dependency/peer resolution, scripts enabled, `--save-exact --omit=dev --no-audit --no-fund`, with no force/legacy-peer-deps. The host Make command is the only user-facing entrypoint. Native build failures are real consumer failures; do not install Python or silently rerun with scripts disabled.

Input contract: exactly one of `PKG` (a registry package plus exact valid semver, prerelease allowed; no tag/range/protocol) or `TARBALL` (existing regular `.tgz`, validated and mounted as one file). Pin published input to its registry tarball/integrity before installation so the inspected and installed artifact are identical. Record registry name/version, `dist.integrity`, actual SHA-256, and resolved dependency tree. For a local archive, take expected name/version from its guarded packed manifest and record SHA-256. Reject an identity mismatch or any symlink resolving outside the clean consumer. The top-level local tarball is an allowed qualification input, not an allowed published dependency value.

The probe writes its import runner INSIDE the consumer directory so bare module resolution cannot accidentally use `/probe` tools. Run each import in a separate bounded child process; import by package name/subpath, never a dist file path that bypasses exports. Enumerate literal runtime exports (`.` and `./hono`, for example), resolve Node import/default/node conditions using Node itself, and test advertised CommonJS branches with `createRequire` as well. For packages without exports, import the bare name through normal main resolution. Do not import `types` targets or declarations. No wildcard, browser-only condition, or unsupported asset entry may silently disappear from coverage: report unsupported/incomplete and fail this generic Node qualification until a separate package-specific qualification is defined. This lot's two backend packages have finite Node entry sets.

Optional peer contract: optional peers must not be injected before the core smoke, which could conceal an accidental eager import. First install the package alone and import its root entry. If `PEERS` is supplied, accept only explicit exact registry versions declared in this package's peerDependencies and satisfying those ranges, add them inside the same clean consumer, then import ALL runtime entrypoints. Log before/after dependency trees and every added peer. Without `PEERS`, still attempt every entrypoint; missing optional peers produce an actionable failure rather than a success with skipped coverage. For mcp-auth's optional Hono adapter, supply `PEERS=hono@4.10.7`; jose is a required peer and npm resolves it normally. cluster-mesh needs no peer override.

Output: one JSON record plus human summary with requested/resolved input, archive hash/integrity, date/commit/job, image/Node/npm versions, clean consumer path, npm command/exit, dependency tree, core import result, optional peers added, each entrypoint/condition and result, and final pass/fail. Preserve logs/reports outside the disposable container; remove it on success/failure. Installation failure, incorrect identity, escaped resolution, missing entrypoint, import exception, or timeout exits nonzero. Success means this Node consumer installed/imported the stated artifact; it does not certify application semantics, all platforms, or browser integrations.

Mandatory BUILD closure replays (no service stack or port bindings):

```sh
make qualify-published-install PKG=@sentropic/mcp-auth@0.2.1 PEERS=hono@4.10.7 REPORT_DIR=tmp/ci-manifest-guard/qualify-mcp-auth ENV=test-ci-manifest-guard
make qualify-published-install PKG=@sentropic/cluster-mesh@0.11.0 REPORT_DIR=tmp/ci-manifest-guard/qualify-cluster-mesh ENV=test-ci-manifest-guard
```

For section 9's mcp-auth candidate and post-publication steps, pass the same explicit Hono peer; cluster-mesh uses no PEERS. The BUILD report must show core plus `@sentropic/mcp-auth/hono` imports and cluster-mesh's root import. Test local candidate archives through `TARBALL=<emitted-path>` before publication. A successful candidate install does not replace either pinned published-version replay. If a version is unavailable, report the lookup failure and keep BUILD closure open; do not substitute latest, a workspace, or an unpublished directory.

| Required published artifact | Entry points | SPEC result | BUILD closure requirement |
|---|---|---|---|
| `@sentropic/mcp-auth@0.2.1` | root, `/hono` with declared optional peer | NOT RUN: target does not exist in this design-only branch | Install and both imports PASS; attach JSON/logs/hash. |
| `@sentropic/cluster-mesh@0.11.0` | root | NOT RUN: target does not exist in this design-only branch | Install and import PASS; attach JSON/logs/hash. |

## 11. Test and acceptance plan

All implementation tests belong to BUILD. Use Node's test runner in the existing Docker image through the new Make targets; fixture files are generated in temporary container directories. Do not commit generated archives, install trees, or fixture lockfiles. No product API/UI/E2E campaign is needed for this tooling-only change.

| Planned test file | Observable cases |
|---|---|
| `scripts/ci/publishable-manifests.test.mjs` | All prohibited schemes and path forms in each of the three maps, uppercase prefixes, whitespace, HTTP tarballs without suffix, aliases/tags/Git shorthand, invalid/empty/non-string ranges; positive semver forms; valid private/dev-only exclusions; absent and malformed fields. |
| `scripts/ci/publishable-classification.test.mjs` | Source/test/README/manifest-only edits; new/public-transition/deleted/renamed packages; main multi-commit push; dispatch explicit/all/none; root-lock-only existing versions WARN vs absent versions BLOCK on PR/main; changed or explicit targets stay BLOCK; packed-version lookup differs from source guess; lookup failure ERROR; missing/corrupt context; focus's unused steady-state filter; public skills inventory. |
| `scripts/ci/publishable-pack.test.mjs` | Real local fixture `npm pack`, safe source with prepack-injected `file:` fails, bad source with cleaned archive still fails, normal semver succeeds, WARN emits annotation and exits zero, BLOCK exits nonzero; duplicate/missing/invalid manifest, traversal/symlink member, identity/private tampering, restoration after failure, no leftover archive. Test npm pack failure separately from dependency violations. |
| `scripts/ci/publishable-ci-wiring.test.mjs` | Parse real YAML with pinned ephemeral `yaml@2.8.1`; assert filter-output and publisher mapping coverage, strict pack path for every selected package, token/OIDC guards, unchanged gateway ordering, no global-inventory publisher/bootstrap needs, required PR job scheduling, lint step, context passed to validation packs, and no credential exposure in validation. Stub publication of Y stays independent of inventory BLOCK on X; existing-version skip emits WARN before candidate/strict checks; a real publication stub receives the exact inspected hash, never the directory. |
| `scripts/ci/qualify-published-install.test.mjs` | Good local fixture imports, absent dist/misdeclared export/imported missing dependency fails even if install succeeds, workspace-only sibling cannot resolve, guard rejects file dependency, name/version mismatch, optional peer core independence plus adapter coverage, multiple exports/CJS, unsupported patterns, invalid inputs, failed registry resolution, report retention and cleanup. |

Exercise the auth incident with a local fixture reproducing `file:../oauth-verify`, plus a plain-semver replacement. Do not depend on an immutable broken registry release for deterministic tests. Use the two exact published replays for real registry evidence. Known cowork source violations must WARN for global-only/root-lock-only changes when its packed version exists, on both PR and main; they BLOCK when cowork is touched, explicitly bootstrap-targeted, or selected with an absent packed version. Bootstrap `all` must leave existing untouched cowork WARN. Preserve existing publish filters and fail lookup errors explicitly.

BUILD gate commands, each run once after scoped fixture tests pass:

```sh
make test-publishable-manifests test-qualify-published-install ENV=test-ci-manifest-guard
make lint-cluster-mesh lint-llm-mesh lint-llm-gateway ENV=test-ci-manifest-guard
make typecheck-cluster-mesh test-cluster-mesh pack-cluster-mesh ENV=test-ci-manifest-guard
make check-ci-version-filters ENV=test-ci-manifest-guard
make check-publishable-manifests MANIFEST_CONTEXT_FILE=tmp/ci-manifest-guard/changes-context.json ENV=test-ci-manifest-guard
make scope-check ENV=test-ci-manifest-guard
make down API_PORT=9435 UI_PORT=5635 MAILDEV_UI_PORT=1535 ENV=test-ci-manifest-guard
```

For the standalone inventory command, require a validated context file via `MANIFEST_CONTEXT_FILE=<path>` or the CI context environment; absence must fail, since guessing which PR is under review is unsafe. The BUILD author records the exact context-bearing command and input in their report. Fixture tests supply synthetic contexts, while integration runs replay a captured real `changes` output. The standalone per-package pack/check remains strict without context. Qualification commands from section 10 and candidate-tarball runs are additional mandatory gates. Commands invoking any future Compose service must include all recorded ports and verify ownership first.

Acceptance: no pack or publication path omits the checker; source and packed values follow D1; global-only PRs do not fail because of unrelated manifest debt; actual selected offenders block; all changed public packages are discovered; lint reaches cluster-mesh CI; both published consumer replays succeed. Local tests cannot claim GitHub branch protection or OIDC publication was exercised: conductor CI review supplies workflow evidence without a test publication.

## 12. BUILD-only forbidden-path exception requests

These are declarations, NOT permissions for this SPEC branch. Before BUILD edits any forbidden path, its conductor must authorize the corresponding exception and reproduce it in that branch's `BRANCH.md`. No Compose exception is needed; no runtime package source edits or version bumps are planned here.

| ID / path | Reason | Impact | Rollback |
|---|---|---|---|
| BRCI-EX1 — `Makefile` | Root lint pattern, real pack/shared guard, strict tarball publication, inventory/test/qualification targets | Packaging changes from dry-run to real archives; all named npm lanes invoke the guard; isolated temporary artifacts/tool installs only | Revert these target/recipe hunks as one coordinated tooling rollback; do not revert independently while CI references removed targets; published versions stay immutable. |
| BRCI-EX2 — `.github/workflows/ci.yml` | Classification outputs, always-scheduled guard, validation context, lint, install smoke steps | New required PR check and registry qualification; existing-version root-only WARN behavior; unchanged publisher needs, permissions, and triggers | Revert job/step/filter hunks together with EX1; conductor removes the required status before removing its job. Keep existing version-bump gate and publication ordering. |
| BRCI-EX3 — `scripts/ci/publishable-manifests.mjs`, `scripts/ci/check-publishable-manifests.sh`, `scripts/ci/qualify-published-install.mjs`, the five test files in section 11 | Shared Node/shell implementation and behavior fixtures behind Make | New tooling files; no package dependency graph, product API, or lockfile change | Remove the files only after their Make/CI callers are reverted; generated reports are disposable. |
| BRCI-EX4 — `rules/workflow.md` (Package Publication section only) | Document D1, npm workspace semantics, mandatory exact-artifact guard and consumer qualification | Changes contributor policy so future manifests start compliant | Revert the added policy paragraph with tooling rollback; retain original CI-only publish and version-bump rules. |

`packages/cowork-desktop/package.json` and its lockfile repair are deliberately absent from these requests: owner assignment, compatible versions, bump, and separate package validation belong to its remediation lane. Root-only lock changes leave its existing packed version WARN. If cowork itself changes, an absent version is selected for publication, or an explicit bootstrap targets it, compliance is mandatory; there is no package-name exemption.

## 13. Rollout, risks, and handoff

1. SPEC: review this design and its two-file scope; choose conservative reversible options D2–D5. Conductor owns independent review and BUILD authorization. No infrastructure/code exception is exercised here.
2. Baseline: integrate the auth `0.2.1` fix (PR #603) through its owner and verify it is published. Refresh BUILD's source base before interpreting its mcp-auth diagnostics; retain the known-offender fixture. Do not repair auth in the CI tooling branch.
3. BUILD foundation: approve EX1/EX3/EX4, implement shared policy and fixtures, root lint, and consumer target. Prove the two pinned replays early. If cluster-mesh lint exposes violations, record a bounded package-owner handoff; source fixes need their own scope and version-bump checks.
4. BUILD activation: approve EX2, wire classification and both full candidate/inventory paths, then strict exact-tarball publication for OIDC and bootstrap together. Test Makefile-only global selection, an actual package edit, and root-lock selection; never ship an all-warning transitional mode for changed packages.
5. Conductor CI review: run the listed gates and both published replays, attach reports, confirm annotations and unchanged publisher `needs` with per-package strict guards, then require the new status check. The conductor handles push/PR/merge; only normal CI can publish. No manual npm publication is part of rollout or testing.
6. Closure: record the two qualification results, inspected/published artifact correspondence, remaining WARN packages and owner status. Cowork stays owner-unassigned until the conductor assigns a repair; WARN is observable debt, not policy compliance. A later all-packages BLOCK policy requires a separate decision after that debt is resolved.

Risks and limits: new inventory packaging adds registry/tooling latency; BLOCK candidates can build twice across validation and inventory jobs (accepted for the initial conservative rollout). Preserve unique artifact paths and serialize package transformations within a worktree. Snapshot audits intentionally do not execute unrelated pack hooks; final full packs and strict publication cover those mutations. Any future unsupported lifecycle or new public package lane must fail explicitly until integrated. Root manifest/lockfile edits fan out publication selection, but existing unrelated packed versions remain WARN; registry lookup outages are explicit errors. Successful imports prove Node loadability only; no native desktop/browser/CLI behavior is certified. No live install result or peer consensus is claimed in this SPEC.
