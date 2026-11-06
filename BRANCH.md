# Feature: artifacts 0.2.18 train — GitHub enrollment, bindings, forge and builds

## Objective
- [ ] Integrate the approved git-artifact wagons after artifacts 0.2.17, release artifacts 0.2.18 with one ordinary train PR, and keep the train open for subsequent wagons.

## Scope / Guardrails
- [x] Branch `train/artifacts-0.2.18`; isolated worktree `tmp/worktrees/train-artifacts-0218`.
- [x] Base is upstream guarded-candidate checkpoint `6bd09d5569828773ac32dbb10d9b156d9f96de40`, carrying artifacts 0.2.17 and chat-core 0.3.2; advanced through mention checkpoint `fd91e7d2a` under BR0218-EX10/EX11.
- [x] Rebase onto merged #930 at `origin/main` `165ce5b932206bcd89e6374f5b80d970cd1d19b6`; preserve upstream auth authority, presence fencing, native browser checks and preprod recovery pin.
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
  - `Makefile` (BR0218-EX13)
  - `scripts/check-disk-hygiene.sh` (BR0218-EX13)
  - `scripts/check-disk-space.sh` (BR0218-EX13)
  - `scripts/resolve-api-image.sh` (BR0218-EX13)
  - `.github/workflows/ci.yml` (BR0218-EX14)
  - `scripts/ci/ci-dag.test.mjs` (BR0218-EX14)
  - `docs/ci/registry-egress.md` (BR0218-EX14)
  - `deploy/ci/gb4-probe/**` (BR0218-EX15)
  - `deploy/k8s/base/artifact-content-networkpolicy.yaml` (BR0218-EX15)
- **Forbidden Paths (must not change in this branch)**:
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
  - `e2e/Dockerfile` (BR0218-EX5, BR0218-EX12)
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
  - `ui/src/routes/organizations/[id]/+page.svelte` (BR0218-EX9)
  - `e2e/tests/01-organizations-detail.spec.ts` (BR0218-EX9)
  - `packages/chat-core/src/runtime/comments/state.ts` (BR0218-EX10)
  - `packages/chat-core/tests/runtime/comments-module.spec.ts` (BR0218-EX10)
  - `packages/chat-core/package.json` (BR0218-EX10)
  - `ui/package-lock.json` (BR0218-EX10)
  - `packages/chat-core/tests/runtime/chat-core-host.spec.ts` (BR0218-EX11)
  - `scripts/ci/publishable-ci-wiring.test.mjs` (BR0218-EX11)
- **Exception process**:
  - [x] Declare reason, impact and rollback before conditional changes; never weaken a CI gate.

## Feedback Loop
- [x] BR0218-EX13: owner requests the pushed disk-hygiene wagon; integrate its bounded Make prune/opt-in build guard and shell checks. Impact limited to local Docker hygiene; rollback reverts that wagon. Retain all main Make behavior.
- [x] Disk wagon `cd0cbbf3e`: merged with train scope retained; `check-disk-hygiene` and `check-down-volumes` pass on the integration tree, including image reuse and 89/90/91 percent disk boundaries. No real image build ran.
- [x] BR0218-EX14: owner requests the pushed registry-egress wagon; remove unused registry credentials from internal CI consumers and retain its DAG regressions/report. Impact limited to credential exposure and regression checks; rollback restores the wagon diff. No CI gate or artifact transport changes.
- [x] Registry wagon `ac77dd823`: train workflow retains every main change and removes only the 13 credential lines. Integrated DAG, image-receipt and release-receipt checks pass 10/10, 16/16 and 40/40.
- [x] BR0218-EX15: owner requests the pushed GB4 probe wagon and artifact-content egress rule. Integrate the offline probe and namespace/pod-scoped TCP 5173 policy only; no cluster deployment. Preserve reported live storage failure and pending positive WebSocket qualification; rollback reverts the wagon.
- [x] GB4 wagon `154ab388e`: integrated its 11 files; restricted offline qualification passes 3/3. Live probe remains unqualified for `/dev/termination-log` writable storage and artifact-content positive WebSocket egress; owner requests this prepared policy rule in the train without deploying it.
- [ ] TRAIN0218-MAIN: regenerate release locks, selected pins, APP-P1 and immutable L5 once after wagon integration; validate scoped checks, independent final-diff review and fresh CI. Keep preprod pin byte-identical to `165ce5b93`.
- [x] LIVE wagon eligibility at initial fetch: neither `origin/feat/git-artifact-live-tools` nor `origin/feat/git-artifact-live-pod` exists. Exclude both until pushed with green scoped receipts; recheck before the integration push.
- [x] BR0218-EX11 / TRAIN0218-CI8: inherited minimal upstream checkpoint 6bd09d556 by rebase, aligning strict release equality to 0.3.2 and qualifying the guarded packer's emitted tarball. New wiring regression fails against the old workflow and passes after: wiring 40/40, core-host/comments 55/55, versions and L5 verification pass. Workflow is byte-identical to the approved upstream base under its BR83-EX1; no qualification or dispatch gate relaxed. Root lock, runtime sources and immutable L5 evidence remain unchanged; rollback ref backup/train0218-before-ci8. Fresh CI required.
- [x] BR0218-EX12 / TRAIN0218-CI9: pin musl/musl-utils 1.2.6-r3 for HIGH CVE-2026-107891 (two findings on 1.2.6-r2 before). Alpine policy confirms zlib 1.3.2-r1 was replaced by 1.4-r0; refresh that exact pin to keep rebuilds resolvable and the prior zlib fix. Final flattened image builds, both Chromium modes pass screenshots/video and native-version probes, and Trivy reports zero HIGH/CRITICAL. No register waiver or scanner/gate change. Impact limited to patched native libraries; rollback restores the previous package list. Fresh full CI required.
- [x] BR0218-EX10 / TRAIN0218-CI7: inherited immediate upstream checkpoint fd91e7d2a by rebase with merge history preserved, fixing the asynchronous mention-loading failure in run 42267445221 shard 4. Three regressions reproduce two failures before; comments 32/32 and tenancy browser file 6/6 pass after at four workers, zero retries/skips. Web build and post-rebase versions pass (chat-core 0.3.2 > published 0.3.1); L5 regenerated/retained through make and verified 30 files/54 edges with unchanged archive bytes. All prior runtime/test corrections remain byte-identical and all four wagon tips remain ancestors. Impact limited to the inherited mention fix, root/UI version metadata and required immutable L5 evidence under EX4; rollback ref backup/train0218-before-ci7. Fresh CI required; no copied commit, gate, timeout or assertion relaxation.
- [x] BR0218-EX9 / TRAIN0218-CI6: run 42263294555 shard 6 exposes stale organization presence. A delayed initial HTTP snapshot overwrites a newer SSE event; final deterministic regression fails on the verified original CI UI and passes with the six-line response-order guard. Scoped organization file passes 9/9 at four workers with zero retries/skips; production web build and C2 pass. Broader local shard has two separate role/document failures retained in the receipt; full fresh CI remains required. Impact limited to organization presence ordering and its regression; rollback restores these two files. No timeout, retry or assertion relaxation.
- [x] Review #931 re-review residual R1: incomplete mint permissions no longer imply installation loss; reject and clean up the unissued token while preserving the prior valid lease, enrollment and credential epoch. Missing, empty and both partial permission cases fail before correction and pass after; complete forge suite passes 55/55, including confirmed suspension/permission-loss fencing and healthy retry without reenrollment. Cluster-mesh typecheck/lint and C1/C2 pass; fresh final-head CI remains required.
- [x] Review #931 R1 authority closure: minted-token inventory refusal and incomplete installation responses do not prove enrollment loss. Three additional regressions failed before correction; complete forge suite passes 51/51, including automatic suspension/permission-loss fencing and recovery without enrollment or epoch changes.
- [x] Review #931 R4: supported rollback restores the previous application and retains additive 0010 schema, journal and immutable history. Postgres qualification passes: a pre-0010 release remains readable, unchanged legacy publication/CAS works after rollback, binding rows/receipts/events and indexed provenance remain unchanged, and append-only triggers still refuse mutation. Host deployment qualification remains host-owned.
- [x] Review #931 R3: both enrollment-runbook passages use the exact owner wording "one click to approve, plus the password confirmation if GitHub asks"; removed both alternate challenge references and retained the unverified P2 prompt/forge receipt. Scoped runbook check passes.
- [x] Review #931 R2: active repository, branch and subpath target conflicts include only the scoped artifactId. Shared conformance checks public HTTP 409 projection, unchanged row/audit and absence of a refused-write replay receipt: memory 13/13 and Postgres 15/15 pass; three regressions failed before correction.
- [x] Review #931 R1: encrypted enrollment now retains recoverable unavailable status after transient inspection, mint or webhook inspection failure; authoritative access loss still revokes and fences the epoch. Regression reproduced 11 failures before the fix; forge suite passes 45/45 afterward.
- [x] BR0218-EX8 / TRAIN0218-CI5: run 42243619012 lazy install rejects the guarded auth-ui 0.9.0 sibling absent from the selected committed lock; exact verified candidate replay reproduces it. Advanced the dated-train base to upstream packaging checkpoint 40fc3e133 by rebase, preserving train version/integrity entries and original candidate no-integrity correction. Impact limited to selected auth-ui/compiler closure, guarded consumer preparation and alignment coverage; all existing non-root selected-lock entries, root/API locks, runtime source and L5 remain unchanged. Full lazy replay passes 136/136 without type errors; post-rebase registry versions and C1/C2 pass, cleanup completed. Independent Astra xhigh review GO at 7f4e395dd; rollback ref refs/backup/train0218-before-ci5. Fresh full CI remains required. No gate, assertion, retry or timeout relaxation.
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
  - [x] Regenerate L5 P1 through make after the committed EX10 lock change: `d1fa54e1a7be851a26a5a4a42c0fa1021189f39de926eb1a0a299001a98694f9`, lock snapshot `a0880959c58791ca4bd1ad02aabff3b342de5b194c8e41f28e672591a05079ee`; retain prior manifest/lock history, unchanged packed archives and verify 30 files/54 edges.
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
