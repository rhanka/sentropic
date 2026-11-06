# Feature: artifacts 0.2.18 train — GitHub enrollment, bindings, forge and builds

## Objective
- [ ] Integrate the approved git-artifact wagons after artifacts 0.2.17, release artifacts 0.2.18 with one ordinary train PR, and keep the train open for subsequent wagons.

## Scope / Guardrails
- [x] Branch `train/artifacts-0.2.18`; isolated worktree `tmp/worktrees/train-artifacts-0218`.
- [x] Base exactly `origin/train/2026-11-06` at `30b808cf5b118ad9b91db6c651f74912cef1fad5`, carrying artifacts 0.2.17.
- [ ] After the dated train merges, rebase onto `origin/main` and recheck registry versions.
- [x] Make only; Docker commands through `/home/antoinefa/src/sentropic/.tmp/packets/docker-slot.sh`, one slot per command.
- [x] Dedicated ports `API_PORT=9600 UI_PORT=5800 MAILDEV_UI_PORT=1700 ENV=test-train-art0218`; ENV always last; tear down volumes after tests.
- [x] Wagons push branches and scoped checks; integration owns versions, locks, fixture pins, APP-P1 digest and L5 once per integrated release head.
- [x] One READY train PR to main; ordinary full CI and package-bump enforcement; no CI gate exception; no merge to main by this lane.
- [x] No skip markers, run reruns, Python, attribution trailers, secret output or live enrollment.
- [x] Selective staging and `make commit` only; newly authored commits stay below 150 changed lines; two-parent wagon merges retain existing history and immutable generated L5 snapshots retain exact bytes under BR0218-EX4.
- [x] G0 FROZEN v3 contract SHA-256 `4c405c8f49e9d242d65eebe35a14a45e4826afc0007e9f94a7fe21d7404e21ba` remains binding.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json` (required by `scripts/ci/ci-lockfile-installs.test.mjs`, enforced by the `validate-publishable-manifests` CI job).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/**`
  - `packages/cluster-mesh/src/forge/**`
  - `packages/cluster-mesh/src/index.ts`
  - `packages/cluster-mesh/tests/forge/**`
  - `packages/cluster-mesh/docs/github-app-enrollment.md`
  - `packages/cluster-mesh/package.json`
  - `packages/cluster-mesh/CHANGELOG.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `.track/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `package-lock.json` (BR0218-EX1)
  - `api/package-lock.json` (BR0218-EX1)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/**` (BR0218-EX2)
  - `packages/cluster-mesh/tests/packaging/artifacts-tuple.spec.ts` (BR0218-EX2)
  - `api/src/services/mcp/cluster-registry.ts` (BR0218-EX3)
  - `api/tests/api/app-mcp-registry.test.ts` (BR0218-EX3)
  - `api/tests/api/app-mcp-installed.test.ts` (BR0218-EX3)
  - `tools/memory-mcp-l5/artifacts/**` (BR0218-EX4)
- **Exception process**:
  - [x] Declare reason, impact and rollback before conditional changes; never weaken a CI gate.

## Feedback Loop
- [x] BR-TRAIN0218-EX1: conductor REFUSED the previous CI gate proposal; branch-only wagons resolve the gate requirement normally on the bumped train.
- [x] BR0218-EX1: regenerate root workspace and API file-dependency lock metadata through make after final union; impact limited to train manifests; rollback restores upstream locks.
- [x] BR0218-EX2: refresh selected artifacts/cluster-mesh candidate pins and packed integrity through make; impact is qualification evidence; rollback restores upstream fixture pins and integrity assertion.
- [x] BR0218-EX3: recompute APP-P1 manifest digest through make for artifacts 0.2.18 and retain historical digest coverage; profile selection and existing definitions remain unchanged; rollback restores upstream pin and test.
- [x] BR0218-EX4: retain upstream L5 manifest/sidecar in history, regenerate P1 from the committed union lock and verify; impact limited to generated evidence; rollback restores retained upstream evidence.
- [x] SG0-app scope exceptions: none; merge only enrollment/custody source, tests and runbook.
- [x] SG1 scope exceptions: none; merge binding records, registry, Postgres migration 0010, projection and conformance tests.
- [x] GB1 scope exceptions: none; merge build validation, public export and inert fixture/tests; no executor activation.
- [x] SG2 scope exceptions: none; merge GitPort and GitHub adapters, scoped tests and documentation; preserve typed failure unions from all wagons.
- [x] Cluster-mesh allocation: dev.14, the next number beyond documented dev.11–dev.13 reservations; no newer allocation was supplied in this lane.
- [ ] Conductor imports this source and the owner decision into Track as designated single writer; this concurrent lane does not write `.track`.
- [ ] Live forge probes and enrollment acceptance remain activation gates; local fake tests cannot certify them.

## AI Flaky tests
- [x] No AI-dependent wagon acceptance or flaky exception requested; do not increase timeouts.

## Orchestration Mode (AI-selected)
- [x] Mono-branch train integration by merging wagon branches; one consolidated final-diff review and one PR CI per review-ready head.

## UAT Management (in orchestration context)
- [ ] Verify the integrated local package keeps safe/application-mode behavior inherited from 0.2.17.
- [ ] Verify binding projections and fake-forge code-right, lease, ref, path and authorship boundaries.
- [ ] Keep real enrollment, release activation and live workers disabled until their named acceptance receipts exist.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Required base and scope**
  - [x] Read common rules first, MASTER, workflow, frozen G0 and wagon plans; harness branch C1 passes.
  - [x] Establish the branch on the published dated-train ref carrying artifacts 0.2.17 and retain its exact SHA.
  - [x] Write this single train plan and mechanically verify its scope before every commit.
- [x] **Lot 1 — Merge ready wagon branches**
  - [x] SG0-app `origin/feat/git-artifact-sg0-app` — GitHub App enrollment and encrypted cluster-mesh custody.
  - [x] SG1 `origin/feat/git-artifact-sg1` — binding lifecycle, host registry and immutable release index.
  - [x] GB1 `origin/feat/git-artifact-gb1` — build descriptor and locked dependency validation.
  - [x] SG2 `origin/feat/git-artifact-sg2` — injected leases, GitPort and atomic forge commits.
  - [x] Resolve source conflicts as the union of all typed categories/exports and retained upstream behavior; verify every wagon tip is an ancestor.
- [ ] **Lot 2 — Single release regeneration**
  - [x] Registry verified through make after rebase/conflict resolution; bump artifacts to 0.2.18 and cluster-mesh to dev.14 with CHANGELOG entries.
  - [x] Regenerate root/API lock metadata through make, retaining dependency resolutions; align existing file-package optional peer metadata.
  - [x] Regenerate selected-fixture versions/integrity through make from guarded artifacts/cluster-mesh archives; archive SHA-256 `cf0a3ea115517e5945a0566af2f13c24389d019499047628f8e127022f9724f8` / `479fe63272ce86eb1a9b54442c19d6f34e35d03cbab06adf134ebd0bee8e2073`.
  - [x] Recompute APP-P1 digest through make: `d55df3ada3722b79274e52c650a12d6baccd2640c61e4d712fe1380bd03c4c86`; frozen profile retained, physical installation pin and digest history updated.
  - [ ] Commit final lock before L5 packing; retain upstream manifest/sidecar, regenerate and verify P1 once through make.
- [ ] **Lot 3 — Scoped integrated checks and review**
  - [x] Scoped `make test-artifacts`: git-port 75, git-bindings 10, git-binding registry/projection 4, build-contract 36, provider-failures 100, tools-list snapshot 1; 226/226 pass on the union.
  - [x] `make test-artifacts-integration` per file: git-bindings 12/12 and release-index 1/1; separate runs preserve the shared-schema isolation used by the complete target.
  - [x] `make test-cluster-mesh SCOPE=tests/forge` 31/31; artifacts and cluster-mesh build/typecheck/lint pass (three unchanged unused-disable warnings in artifacts tests).
  - [x] API registry, physical installation, grant and consent 35/35; packaging tuple/preparation 24 pass, three installed-fixture-only cases belong to full CI. Total scoped checks: 329 passing tests.
  - [ ] One consolidated code review on the final train diff; resolve evidenced root causes and retain the receipt.
  - [ ] `make scope-check`, `git diff --check`, no conflict markers, ordinary package-bump verification.
  - [ ] `make down-volumes API_PORT=9600 UI_PORT=5800 MAILDEV_UI_PORT=1700 ENV=test-train-art0218`.
- [ ] **Lot 4 — One train PR and CI watch**
  - [x] Close only wagon PRs #925/#926 with `superseded by train/artifacts-0.2.18`; preserve their branches.
  - [ ] Push one review-ready head and open one READY PR `train/artifacts-0.2.18` to main using this plan as body.
  - [ ] Observe and fix full CI; no reruns or gate changes; never merge to main from this lane.
  - [ ] After the dated train merges, rebase onto origin/main and recheck published versions and generated evidence.

## Deferred to later wagons on this train
- [ ] SG3a/SG3b: tools, attach and commit orchestration; append scoped paths when branches land.
- [ ] SG4a/SG4b: job-bound release publication and receipt handling.
- [ ] GB4 and live lots: qualified ephemeral execution and private HMR lifecycle; no premature activation.
- [ ] SG1 SQLite parity and real forge probes retain their own recorded acceptance gates.
