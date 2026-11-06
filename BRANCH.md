# Feature: artifacts 0.2.18 train — GitHub enrollment, bindings, forge and builds

## Objective
- [ ] Integrate the approved git-artifact wagons after artifacts 0.2.17, release artifacts 0.2.18 with one ordinary train PR, and keep the train open for subsequent wagons.

## Scope / Guardrails
- [x] Branch `train/artifacts-0.2.18`; isolated worktree `tmp/worktrees/train-artifacts-0218`.
- [x] Base is dated-train fix checkpoint `b9505f1197e394e29dfad3fd26b1be09dbe839c6`, carrying artifacts 0.2.17; advanced from initial `30b808cf5` under BR0218-EX7.
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
  - `e2e/Dockerfile` (BR0218-EX5)
  - `api/src/services/identity/cm-session-facade.ts` (BR0218-EX6)
  - `api/src/services/identity/cm-auth-binding.ts` (BR0218-EX6)
  - `api/src/services/identity/cm-http-principal.ts` (BR0218-EX6)
  - `api/src/services/identity/cm-session-activity.ts` (BR0218-EX6)
  - `api/tests/api/auth/cm-session-read-concurrency.test.ts` (BR0218-EX6)
  - `api/src/services/identity/cm-transaction.ts` (BR0218-EX7)
  - `api/tests/api/auth/cm-auth-request-concurrency.test.ts` (BR0218-EX7)
  - `e2e/tests/03-dashboard.spec.ts` (BR0218-EX7)
  - `e2e/tests/07-matrix.spec.ts` (BR0218-EX7)
  - `e2e/tests/08-chat-checkpoint-restore.spec.ts` (BR0218-EX7)
  - `packages/auth-ui/tests/oauth-consent-rendering.test.ts` (BR0218-EX7)
  - `packages/cluster-mesh/tests/packaging/prepare.sh` (BR0218-EX8)
  - `packages/cluster-mesh/tests/packaging/prepare-artifacts.spec.ts` (BR0218-EX8)
- **Exception process**:
  - [x] Declare reason, impact and rollback before conditional changes; never weaken a CI gate.

## Feedback Loop
- [ ] BR0218-EX8 / TRAIN0218-CI5: run 42243619012 lazy install rejects the guarded auth-ui 0.9.0 sibling absent from the selected committed lock; exact verified candidate replay reproduces it. Advance the dated-train base to upstream packaging checkpoint 40fc3e133 by rebase, preserving train version/integrity entries and original candidate no-integrity correction. Impact limited to selected auth-ui/compiler closure, guarded consumer preparation and alignment coverage; root/API locks and L5 remain unchanged. Rollback ref refs/backup/train0218-before-ci5; require full lazy replay, post-rebase versions, preservation and independent review before pushing. No gate, assertion, retry or timeout relaxation.
- [x] BR0218-EX7 / TRAIN0218-CI4: run 42238689292 reproduces upstream dashboard lock replacement and new-account magic-link 503; advanced the dated-train base to verified fix b9505f119 by rebase with merge history preserved. Inherited its auth-ui/matrix/checkpoint fixes without copying commits; unioned exclusive account admission with read-only session validation. Root/API locks and package evidence remain byte-identical; rollback ref refs/backup/train0218-before-ci4. Post-rebase versions, API typecheck/scoped lint/build and L5 verification pass; auth regressions 6/6, full browser shard 4 has 43 pass/six existing skips, presence 8/8, zero retries. Independent Astra xhigh integration review GO at 7971cd5ba; matrix loading was not reproduced or claimed fixed. Fresh full CI remains required; no merge to main.
- [x] BR0218-EX6 / TRAIN0218-CI3: local shard-4 qualification reproduces two login redirects caused by HTTP 500 session reads; logs prove SERIALIZABLE touchActivity conflicts exhaust unchanged retries with code 40001. Native completion now uses its supported read mode for session_validate; preserve refusal mapping and best-effort activity outside the snapshot. Regression: 64 concurrent real reads, identity/activity and invalid/revoked refusals; before 1 failed/4 passed, after 5/5. API typecheck, scoped lint and build pass; independent Astra xhigh review GO. Browser auth failures disappear; local shard has 42 pass/six unchanged skips/one separate unchanged chat-geometry failure. Impact limited to app identity adapters/tests; rollback restores them. No budget, retry, timeout or refusal is relaxed; fresh full CI remains required.
- [x] BR0218-EX5 / TRAIN0218-CI2: fix HIGH CVE-2026-85091 by pinning zlib 1.3.2-r1 in the E2E image; impact limited to the fixed Alpine library, rollback restores the previous package list. Built final image scans with zero HIGH/CRITICAL and both Chromium modes pass. Independent Astra xhigh review GO; conductor lifted the single-push limit on 2026-11-06. Ordinary full CI remains required; merge freeze remains active.
- [x] TRAIN0218-CI1: reproduce job `127733036865` EINTEGRITY with its verified archive; restore the existing no-integrity candidate policy, preserving all 175 sibling/dependency integrity pins. The committed-fixture regression fails before correction; full lazy replay passes 136/136 afterward. Independent Astra xhigh closure GO; replacement-head CI remains required under Lot 4.
- [x] TRAIN0218-R1: notify the superseded epoch and advance it only when rotation returns ready; retry preserves the old fence. Three regressions failed before and pass after, forge 31/31 and build/typecheck/lints pass; independent closure GO at `0af93d063`.
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
- [x] Safe/application content paths remain byte-identical to the qualified 0.2.17 dated train; registry, consent and installed-package checks pass on 0.2.18.
- [x] Binding projections and fake-forge code-right, lease, ref, path and authorship boundaries pass the scoped checks, including composed epoch fencing.
- [x] Real enrollment, release activation and live workers remain behind their named acceptance gates; no live action performed by this lane.

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
- [x] **Lot 2 — Single release regeneration**
  - [x] Registry verified through make after rebase/conflict resolution; bump artifacts to 0.2.18 and cluster-mesh to dev.14 with CHANGELOG entries.
  - [x] Regenerate root/API lock metadata through make, retaining dependency resolutions; align existing file-package optional peer metadata.
  - [x] Selected pins derive from guarded archives: artifacts SHA-256 `cf0a3ea115517e5945a0566af2f13c24389d019499047628f8e127022f9724f8`; corrected cluster-mesh `3c09dde3a41d6beb2fb505a5916cd50d310b643fc372a2b7905e8a5a25a19d55`. R1 repack preserves initial evidence; locks/APP-P1/L5 unchanged, tuple tests and L5 verification pass again.
  - [x] Recompute APP-P1 digest through make: `d55df3ada3722b79274e52c650a12d6baccd2640c61e4d712fe1380bd03c4c86`; frozen profile retained, physical installation pin and digest history updated.
  - [x] Commit final lock before L5 packing; generate P1 once through make: `cf7432d500b80de96486872b96c72f0512622e45381b275f6330d3a3fae2270b`, lock snapshot `1db058b64cadabcf0306fa92ff503af9e47acaccc7de10befb05654683eab4b9`; retain upstream history and verify 30 files/54 edges.
- [x] **Lot 3 — Scoped integrated checks and review**
  - [x] Scoped `make test-artifacts`: git-port 75, git-bindings 10, git-binding registry/projection 4, build-contract 36, provider-failures 100, tools-list snapshot 1, composed invalidation regressions 3; 229 passing tests.
  - [x] `make test-artifacts-integration` per file: git-bindings 12/12 and release-index 1/1; separate runs preserve the shared-schema isolation used by the complete target.
  - [x] `make test-cluster-mesh SCOPE=tests/forge` 31/31; artifacts and cluster-mesh build/typecheck/lint pass (three unchanged unused-disable warnings in artifacts tests).
  - [x] API registry, physical installation, grant and consent 35/35; packaging tuple/preparation 24 pass, three installed-fixture-only cases belong to full CI. Total scoped checks: 332 passing tests.
  - [x] One consolidated independent Sol xhigh review: initial NO-GO at `c2896d1e5`, P1 R1 reproduced/corrected, closure GO at `0af93d063`; receipts retained in `.tmp/rv/train-0218-*-review.md` and `train-0218-sol-closure.md`.
  - [x] Full-delta `make scope-check` C2, harness branch C1 and `git diff --check` pass; workflow/Makefile unchanged from the dated train; ordinary version bumps and publication checks pass.
  - [x] `make down-volumes API_PORT=9600 UI_PORT=5800 MAILDEV_UI_PORT=1700 ENV=test-train-art0218` completed after scoped checks and remediation.
- [ ] **Lot 4 — One train PR and CI watch**
  - [x] Close only wagon PRs #925/#926 with `superseded by train/artifacts-0.2.18`; preserve their branches.
  - [x] Push one review-ready head and open one READY PR `train/artifacts-0.2.18` to main using this plan as body.
  - [ ] Observe and fix full CI; no reruns or gate changes; never merge to main from this lane.
  - [ ] After the dated train merges, rebase onto origin/main and recheck published versions and generated evidence.

## Deferred to later wagons on this train
- [ ] SG3a/SG3b: tools, attach and commit orchestration; append scoped paths when branches land.
- [ ] SG4a/SG4b: job-bound release publication and receipt handling.
- [ ] GB4 and live lots: qualified ephemeral execution and private HMR lifecycle; no premature activation.
- [ ] SG1 SQLite parity and real forge probes retain their own recorded acceptance gates.
