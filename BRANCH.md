# Feature: Artifacts GitHub branch resolution (0.2.23)

## Objective
- [x] Resolve a git-backed artifact branch through `GET /repos/{owner}/{repo}/git/ref/heads/{branch}` (per-segment encoding, slashes kept) returning `object.sha`; an absent branch (404 or 422) is `missing`, never `conflict`/`git_ref_not_allowed`, so attach reaches `createBranch` (immo preprod 08/11, i-cond).
- [x] `resolveRef` returns the exact `refs/heads/<branch>` SHA for a slash branch (the 40-hex check at live-service.ts:100 already held on 0.2.22; the preprod `invalid_request` on live_control start maps to live-service.ts:49-51 or :101, caller arguments, reported to immo).
- [x] Release `@sentropic/artifacts` 0.2.23 with `ARTIFACTS_PROVIDER_VERSION` and the APP-P1 digest repin.

## Scope / Guardrails
- [x] Branch fix/artifacts-github-branch-resolve from main 4f4674b50; worktree tmp/worktrees/fix-github-forge-resolve; ENV=test-fix-gh-resolve.
- [x] Make only; no Python; no attribution trailers; no CI skip or rerun; never ENV=dev.
- [x] Immo DB untouched: the `git_live_draft_unavailable` requirements go to the lane report only.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/src/adapters/github-forge.ts`
  - `packages/artifacts/src/server/git-tools-attach.ts`
  - `packages/artifacts/src/mcp-core.ts`
  - `packages/artifacts/tests/github-branch-resolve.test.ts`
  - `packages/artifacts/package.json`
  - `packages/artifacts/CHANGELOG.md`
  - `api/src/services/mcp/cluster-registry.ts`
  - `api/tests/api/app-mcp-installed.test.ts`
  - `api/tests/api/app-mcp-registry.test.ts`
  - `api/tests/api/mcp-workspaces-list-dispatch.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `ui/**`
  - `deploy/**`
  - `packages/cluster-mesh/src/**`
  - `packages/cluster-mesh/package.json`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `package-lock.json`
  - `api/package-lock.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/**`
  - `packages/cluster-mesh/tests/packaging/artifacts-tuple.spec.ts`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- [x] BRGH-EX1: root and api lock workspace entries follow artifacts 0.2.23 (version strings only). Rollback: revert with the bump.
- [x] BRGH-EX2: the cluster-mesh selected packaging fixture follows artifacts 0.2.23 (`prepare-artifacts.spec.ts` requires the fixture to equal the candidate tuple; CI run 42499490549 lazy/source failed on 0.2.22): fixture `package.json`/`package-lock.json` version strings plus the integrity pin of the locally packed `make pack-artifacts` archive (sha256 fa03b147… equals the manifest guard), mirrored in `artifacts-tuple.spec.ts`, as BR90-EX20 did for 0.2.22. Impact: test fixtures only, no cluster-mesh source or version change. Rollback: revert with the bump.

## AI Flaky tests
- Acceptance rule: Accept only non-systematic provider/network/model nondeterminism as `flaky accepted` (at least one success on the same commit and command). Not applicable: no flaky test encountered this branch.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- Rationale: one owner-urgent fix PR, one CI.

## Plan / Todo (lot-based)
- [x] **Lot 1 — Branch resolution fix**
  - [x] `github-forge.ts`: branch refs resolve through `git/ref/heads/<segments>` (`object.type` commit, exact `ref`), commit SHAs through `/commits/<sha>`, other non-`artifact/` refs (tags, abbreviated SHAs) through `/commits/<segments>` after a heads miss; 404/422 map to `missing`.
  - [x] Review r1 (.h2a/reviews/pr-965-opus.md) majors: tag/abbreviated-SHA resolution restored; live start claim narrowed to bug 1.
  - [x] `git-tools-attach.ts`: attach treats the port's `git_branch_missing` like `not_found`, so a new personal branch is created from `baseRef`.
- [x] **Lot 2 — Tests (fake GitHub HTTP)**
  - [x] `tests/github-branch-resolve.test.ts`: slash branch to full SHA with per-segment URL; 404/422 to `missing`; tag through `/commits` and no fallback for an `artifact/` branch; full SHA without ref lookup; `createBranch` 422 stays `conflict`; 422 on `/commits` to `not_found`; attach creates a new branch; live_control start succeeds on the resolved head.
- [x] **Lot 3 — Release 0.2.23**
  - [x] package, locks, `ARTIFACTS_PROVIDER_VERSION`, APP-P1 digest 61c50b33 to 428a7527 (version field only), CHANGELOG.
- [ ] **Lot 4 — Final validation**
  - [x] `docker-slot.sh make test-artifacts SCOPE=tests/g ENV=test-fix-gh-resolve` unit files PASS (146 tests; the 3 integration files need postgres and run in CI).
  - [x] `docker-slot.sh make typecheck-artifacts ENV=test-fix-gh-resolve` PASS.
  - [ ] PR, CI green on the exact head, review in `.h2a/reviews/`, merge by s-conductor.
