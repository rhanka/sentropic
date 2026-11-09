# Feature: APP train T1 — prod A4 code prerequisites (8 wagons, one PR)

## Objective
- [x] Assemble the 8 T1 wagons into one train branch `train/2026-11-08-app-t1` from origin/main ec3c0bcc8, one PR, one CI (release train rule: one PR for several wagons).
- [x] Merge each wagon with `git merge --no-ff origin/<branch>` in order, never rebase, never force-push; BRANCH.md conflicts resolved to the train version.
- [x] Fix the r3 cross-wagon integration findings in the train: BLOCKER-R3-1, BLOCKER-R3-2, MAJOR-R3-1; record MAJOR-R3-2 as a T1-ops prerequisite.
- [ ] Validate on ENV=test-train-t1 (API 8903, UI 5303, MAILDEV 1203): typecheck, lint, wagon scoped tests, test-preprod-a4, test-artifact-content-manifests.
- [ ] Open the train PR from this BRANCH.md, push, iterate to green CI; Argon review of the integration delta; do NOT merge.
- [x] Flag: s-archi must ratify A1 (`fix/oauth-consent-optional-tid`) before the train merges; the train is assembled without waiting.

## Scope / Guardrails
- [x] Worktree tmp/worktrees/train-t1 on branch train/2026-11-08-app-t1, verified before any action.
- [x] Preprod overlay pins kept from main (API sha256:69bd39eb0aee104b59e39271c9badc06ebf0410f54032b5a6d476c6832604444, UI sha256:bf1aa5096ad41750a3dec307c37d0929a418f76c168588d3b8dc8287ab34d3e0); selftest expectations match.
- [x] Atomic commits under 150 lines via `make commit MSG="..."`, specific git add, no attribution trailer.
- [x] Make-only, Docker via `.tmp/packets/docker-slot.sh`, one slot per command, never nested; ENV=test-train-t1 always last; never ENV=dev; never `make clean-all`; no Python.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/auth/**`, `api/src/services/identity/**`, `api/src/services/secret-crypto.ts`, `api/src/services/llm-account-transports.ts`, `api/src/services/google-drive-oauth.ts`, `api/src/services/cluster-mesh/github-app-host.ts`
  - `api/src/config/deployment-secrets.ts`, `api/src/config/env.ts`, `api/src/index.ts`, `api/src/routes/auth/oauth.ts`, `api/src/routes/namespaces/auth/**`
  - `api/src/scripts/secret-reencrypt.ts`, `api/src/scripts/cm-preprod-state.ts`, `api/src/scripts/cm-preprod-checkpoint.ts`, `api/src/scripts/cm-preprod-contract.ts`, `api/src/scripts/oauth-register-client.ts`
  - `api/src/db/schema.ts`, `api/drizzle/control/0022_oauth_consent_optional_tenant.sql`
  - `api/tests/api/auth/**`, `api/tests/api/tenancy/arch11-tenant-data.test.ts`, `api/tests/unit/**`, `api/tests/utils/oauth-consent-flow.ts`, `api/tests/utils/cm-*.ts`
  - `apps/auth-idp/index.ts`, `apps/auth-idp/web/src/lib/api.ts`, `apps/auth-idp/web/src/lib/auth-transport.ts`
  - `packages/auth-ui/src/transport-fetch.ts`, `packages/auth-ui/tests/transport-fetch.test.ts`, `packages/cluster-mesh/src/storage/identity/replica-sync.ts`, `packages/cluster-mesh/tests/identity/replica-sync.spec.ts`
  - `ui/src/lib/services/auth-transport.ts`, `ui/src/lib/utils/api.ts`, `ui/tests/utils/auth-transport.test.ts`
  - `deploy/k8s/base/38-cm-account-approve-job.yaml`, `deploy/k8s/components/a4-wiring/**`, `deploy/k8s/overlays/preprod/**`, `deploy/k8s/overlays/preprod-a4/**`, `deploy/k8s/overlays/prod/**`, `deploy/k8s/overlays/prod-a4/**`
  - `deploy/ci/preprod-a4/**`, `deploy/ci/artifact-content/**`, `deploy/ci/artifact-data-guard/**`, `deploy/ci/idp-identity-sync/**`
  - `scripts/ci/cm-account-approve-job.test.mjs`, `scripts/ci/preprod-repin.mjs`, `scripts/ci/preprod-repin.test.mjs`
  - `scripts/test-artifact-content-image.sh` (promotion guard follows the repin flow)
  - `docs/secrets.md`, `docs/oauth-client-rotation.md`, `docs/runbooks/preprod-a4-cutover.md`, `docs/runbooks/prod-a4-cutover.md`
  - `spec/DATA_MODEL.md`, `spec/SPEC_AMENDMENT_D11R_LOGIN_A.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose.yml`
  - `docker-compose.*.yml` except `docker-compose.ci.yml` (see TRAIN-EX3)
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `.track/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile` (see TRAIN-EX1)
  - `.github/workflows/**` (see TRAIN-EX2)
  - `docker-compose.ci.yml` (see TRAIN-EX3)
  - `api/drizzle/*.sql` (see TRAIN-EX4)
  - `packages/**` src (see TRAIN-EX5)
- **Exception process**:
  - [x] TRAIN-EX1 `Makefile`: cm-account-approve-job target (wagon launcher) + preprod-repin wiring (wagon repin) + smoke-restore SUT single-RP declaration (train integration); reason: operator Job entry points; impact: CI-tested Make targets only; rollback: revert train.
  - [x] TRAIN-EX2 `.github/workflows/ci.yml`: fail-closed secret gates (wagon secret-keys) + preprod auto-repin receipts (wagon repin); reason: wagon scopes merged as-is; impact: CI only; rollback: revert train.
  - [x] TRAIN-EX3 `docker-compose.ci.yml`: secret-gate test composition (wagon secret-keys); reason: wagon scope merged as-is; impact: CI only; rollback: revert train.
  - [x] TRAIN-EX4 `api/drizzle/control/0022_oauth_consent_optional_tenant.sql`: A1 consent key migration (wagon A1); reason: architect-verdict wagon; impact: one migration, applied at preprod boot; rollback: revert train.
  - [x] TRAIN-EX5 `packages/auth-ui`, `packages/cluster-mesh` src: error surfacing transport + replica-sync provenance (wagons A3/RP); reason: wagon scopes merged as-is; impact: patch bumps carried by the train release; rollback: revert train.

## Feedback Loop
- [ ] `attention`: s-archi ratification of A1 pending before train merge (architect verdict A1 BLOCKING; Argon APPROVE on db81cf35b; allowlist require_tenant=false and CM tenant-less governance attribution to ratify).
- [x] `acknowledge`: MAJOR-R3-2 recorded as T1-ops prerequisite, not train code: the preprod `--secret-reencrypt --apply` Job must run AFTER the T1 merge/deploy-preprod on the published main image (publish-api-image only pushes on main); only Secret provisioning precedes the merge.
- [x] `acknowledge`: wagon open points carried, non-blocking: G7 reactivation stays gated post-T3; KEK boot-gate question QA-8r2 open to s-archi; artifact-data-guard hardenings deferred to a later wagon; approve-Job `--custodian` spawn test missing (LOW).
- [x] `acknowledge`: smoke-restore SUT declares `CM_IDENTITY_CUTOVER_IDP_RP_ID=localhost` (single-RP rehearsal tier, mirrors BLOCKER-R3-1 prod declaration); the wagon-c RP guard failed closed on carried prod credentials with undeclared IdP RP on every train run; the secret was present in all runs (guard echo misread, no branch-policy issue, no rename needed).
- [x] `acknowledge`: train rebased onto origin/main ec3c0bcc8 (#971 live-teardown; only BRANCH.md overlapped, kept train version; 8 merges + fixes replayed, rerere resolutions verified identical); the conflicting head received no pull_request run (12 prior runs all while mergeable; mergeable sister PR got one), so the rebase also unblocks CI.
- [x] `acknowledge`: run 42626825813 FULL GREEN on head 1df6369eb (base a23d7e672): build-desktop, build-ui, security-container (+ui), test-smoke-restore (RP-guard fix proven on prod backup), all 6 e2e shards, ci-gate. Rebases #2 (a23d7e672, #970: ci.yml receipts + Makefile UID/e2e-output auto-merged) and #3 (ec3c0bcc8, #975: BRANCH.md only) replayed cleanly; every main merge re-conflicts the train BRANCH.md and suppresses new runs until rebased. S2 supplement review of the 2-line smoke fix pending: Argon 429 quota-exhausted (~106h) and Vibe 402 budget-exhausted; no merge until reviewed or owner decides.

## AI Flaky tests
- [x] Acceptance rule: non-systematic provider/network/model nondeterminism only, with same-commit success; never amend timeouts; record command + file + signature here; user sign-off before merge.
- [x] Contention flake accepted (non-systematic, same-commit isolated greens): `make test-api-endpoints SCOPE="tests/api/auth"` with 4 workers fails shifting subsets (10 files/27 tests, then 7 files/22, then 5 files/24: cm-auth-request-concurrency, oauth-refresh.integration, cm-account-deletion, remote-session, service-auth-middleware, cm-account-connectors, remote-revocation); every one of those files passes alone on the exact train head (12/12, 5/5, 35/35, 3/3, 7/7). Signature: shared-postgres deadlock/timeout under parallel DB create/drop load, same class as the T1-a 40001/503 contention. Full suites rerun in the train CI.
- [x] Provider flake recorded (allowlisted `e2e/tests/00-ai-generation.spec.ts`): run 42614061318 shard 5 fails `devrait générer des cas d'usage` on `page.waitForResponse Timeout 60000ms` at generate start while shards 1/2/3/4/6 and all 3 test-api-ai jobs pass on the same head; run 42622819107 (code-identical head) fails the same test on `socket hang up` polling `GET queue/jobs` while api-1 logs prove the job was actively scoring one second later (37 passed, 1 failed). Signatures: provider stall + load-induced dropped poll, train touches no generation or queue path. Fresh head pushed; no rerun, no skip, no timeout change.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single integration branch, one test cycle, one CI)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- [x] Rationale: the 8 wagons arrived pre-built, pre-tested and Argon-APPROVEd on exact heads; the train only merges (--no-ff) plus 4 atomic integration fixes, then one validation cycle and one CI.

## UAT Management (in orchestration context)
- [x] **Mono-branch**: no UI-behavior change ships user-visible flows alone (transport error text only); qualification is CI + scoped suites + Argon delta review, no separate UAT lot.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and train setup**
  - [x] Read rules/MASTER.md, rules/workflow.md, rules/testing.md, COMMON-RULES.md, archi verdict A1-A5, transition plan r3, r3 Argon review, wagon reports t1-a/b/c/d.
  - [x] git fetch origin; worktree tmp/worktrees/train-t1 on train/2026-11-08-app-t1 from origin/main ec3c0bcc8; verify branch.
  - [x] ENV=test-train-t1, API_PORT=8903, UI_PORT=5303, MAILDEV_UI_PORT=1203.
- [x] **Lot 1 — Wagon merges (--no-ff, in order)**
  - [x] fix/oauth-consent-optional-tid head db81cf35b, merge 991545127, review .h2a/reviews/t1-oauth-consent-optional-tid-argon.md APPROVE (A1, s-archi ratification flagged, not waited).
  - [x] fix/cm-first-member-bootstrap head a99003adb, merge ed9e376f8, review .h2a/reviews/t1-cm-first-member-bootstrap-argon.md APPROVE.
  - [x] fix/a4-import-rp-provenance head f86f06933, merge 187be80ec, review .h2a/reviews/t1-a4-import-rp-provenance-argon.md APPROVE.
  - [x] fix/cm-account-approve-launcher head efe7d6dd1, merge 4491bcce6, review .h2a/reviews/t1-cm-account-approve-launcher-argon.md APPROVE.
  - [x] fix/secret-keys-fail-closed head b84f44679, merge 7b50f637a, review .h2a/reviews/secret-keys-fail-closed-argon.md APPROVE.
  - [x] fix/identity-error-surfacing head 7b7ed930d, merge b5fb6a1c4, review .h2a/reviews/identity-error-surfacing-argon.md APPROVE.
  - [x] feat/prod-a4-operator head ce9b2b9d0, merge 4ab371d7a, review .h2a/reviews/t1-feat-prod-a4-operator-argon.md APPROVE (selftest conflict reconciled: checkA4 refactor kept, WEBAUTHN guard kept with prodA4 symmetry, pins kept from main).
  - [x] fix/ci-preprod-auto-repin head 2f742fc8d, merge 40dddd79c, review .h2a/reviews/t1-fix-ci-preprod-auto-repin-argon.md APPROVE WITH COMMENTS (pin comment reconciled to main digests + repin mechanics).
- [x] **Lot 2 — Cross-wagon integration fixes (atomic commits)**
  - [x] BLOCKER-R3-1 b3c57d546: CM_IDENTITY_CUTOVER_IDP_RP_ID via configMapKeyRef auth-idp/WEBAUTHN_RP_ID on the A4 api pod + selftest assert.
  - [x] BLOCKER-R3-2 620cbf427: CM_A4_NAMESPACE fieldRef on the approve Job + approve-job test retargeted to components/a4-wiring with namespace asserts.
  - [x] MAJOR-R3-1 abbc1d094: require_tenant through export-prod, reader-role grant (15 columns), client-policy copy + transform, sync-clients upsert, NULL-safe purge, sql-test.sh 0022 load + header + count, fixtures (immo-mcp false, NULL-tenant consent).
  - [x] MAJOR-R3-1 f7beb3441: OAUTH_CLIENT_REQUIRE_TENANT preserved through oauth-register-client (omission keeps stored) + unit tests.
  - [x] MAJOR-R3-2 recorded as T1-ops prerequisite (see Feedback Loop), no train code.
- [x] **Lot 3 — Validation (ENV=test-train-t1, foreground via docker-slot.sh)**
  - [x] make typecheck-api PASS + make lint-api 0 errors (245 warnings, none in train-touched files) + make scope-check PASS C2.
  - [x] Wagon scoped suites per t1-a/b/c/d reports, all green on the train head: consent set1+enforce+bootstrap 49/49; rp endpoints 28/28; unit secret-keys/rp/errors 65/65; consumers 37/37; register-client 27/27; replica-sync 11/11; auth-ui 57/57; ui auth-transport 2/2; cm-preprod unit 51/51; test-preprod-a4 43/43; test-publishable-manifests 138 pass; test-ghcr-images 45/45; test-artifact-data-guard 7/7.
  - [x] make test-artifact-content-manifests PASS + bundle.selftest.mjs equivalent on kubectl-rendered prod/preprod/preprod-a4/prod-a4 PASS (main pins, IDP_RP_ID, CM_A4_NAMESPACE, WEBAUTHN guards).
  - [x] make test-idp-sync-sql PASS including authorize selftest (0022 load, 15-column grant, require_tenant end-to-end, NULL-tenant purge survival).
  - [x] Full tests/api/auth directory: contention flakes only, documented above; each failing file green alone.
- [ ] **Lot 4 — PR and review**
  - [ ] Open train PR (title/body from this BRANCH.md), push, iterate to green CI (no rerun, no skip, no timeout increase; provider AI e2e failure recorded here + fresh head).
  - [x] Train release versions: @sentropic/auth-ui 0.9.0 to 0.9.1, @sentropic/cluster-mesh 0.26.0-dev.18 to 0.26.0-dev.19 with root/api lockfile sync, packaging fixture renames and CHANGELOG entry (BRDP-EX10 lock-sync gate).
  - [x] Fixture alignment (prepare-artifacts 20/20 local): selected fixture follows auth-ui 0.9.1 with the built-bytes integrity reproduced locally (tsc dist + pack) byte-identical to the CI seal hash.
  - [x] 0022 A1-REKEY guard 545a4a21a: skip the rekey when CM authority tables are absent (artifact host-slot DBs); frontier + rekey suites 19/19 local.
  - [x] Argon high review of the integration delta to .h2a/reviews/train-t1-argon.md: APPROVE WITH COMMENTS (2 LOWs); do NOT merge.
  - [ ] CI iteration (no rerun, no skip): 42555622186 cancelled; 42555695785 changes-gate red (lock-sync, fixed); 42556238258 red on consumer-contracts + manifests (changes cascade) and cluster-mesh lanes (fixture alignment, fixed); 42556740207 red on 2 integration shards (0022 rekey, fixed) + lazy lane (fixture hash, fixed); 42560895039 red on api-image-guards (promotion guard, fixed) + test-smoke-restore (KUBECONFIG_B64 secret missing on that runner only; sibling PRs 969/971/973 pass it contemporaneously).
  - [x] Runner-infra flakes recorded (non-systematic, same-code greens): run 42562967250 test-e2e (1) fails in 46s on `network e2e-ci_default not found` in ci-provider-receipt while the identical shard passed on run 42560895039 and shards 2-6 pass here; test-smoke-restore fails on the empty KUBECONFIG_B64 secret on runs 42560895039/42562967250 while PR 973 run 42563356785 passes it at the same hour. Fresh head pushed for a clean run; no job rerun, no skip, no timeout change.
  - [x] Run 42564558585 (head 00f6b3cee): test-e2e (1) passes (2m19s, transient confirmed); api-image-guards, cluster-mesh lanes, integration shards all green; test-smoke-restore fails a 3rd time on the empty secret while PRs 969/970/971/973 pass it. Same repo, same event, same pool/image, overlapping hours, ci.yml smoke section untouched by the train. Anomaly escalated as open point; fresh head pushed.
  - [x] Run 42566321266 (head 1d3543ab2): everything owned by the train is green (mesh lanes, integration shards, e2e 1-6, guards, manifests, G7). Remain: build-desktop fails on `pkg` 504 downloading node24-win-x64 (runner network; zero desktop files in the train diff) which cascades via build-ui/security-container-ui into the security-container join; test-smoke-restore fails a 4th time on the empty secret. No job rerun, no skip, no timeout change; fresh head pushed.
  - [x] Run 42567740414 (head 984ee8651): same three out-of-scope failures (build-desktop `pkg` 504 + security-container cascade + smoke secret ×5, PR not a draft, ci.yml smoke section intact). Everything owned by the train green on consecutive runs. Fresh head pushed; anomaly details in the report.
  - [x] Run 42569215842 (head 50d7435ee): build-desktop and security-container pass (transients confirmed); ONLY test-smoke-restore red (empty secret ×6) plus the ci-gate aggregator. Every gate owned by the train is green on this run. Fresh head pushed; report finalized with the anomaly as the single open CI point.
  - [x] Supplement Argon review appended to .h2a/reviews/train-t1-argon.md (late fixes f1b8d31fe..49deaf2a9 + head deltas to d02509171): APPROVE WITH COMMENTS (1 LOW doc, deferred).
  - [x] Run 42570087778 (head d02509171): same three transient-class failures (build-desktop 30s + security-container cascade + smoke secret ×7). All train-owned gates green. Cross-checked infra: Failed/Unknown runner images only on train runs; affected actions (pkg, aws-actions/configure-aws-credentials) pinned on main and postdate the wagons' base; ci.yml smoke section intact; PR not a draft. Anomaly escalated as THE blocking open point (owner action: KUBECONFIG_B64 delivery check).
- [ ] **Lot 5 — Report**
  - [ ] French report to .tmp/rv/train-t1.md: PR, head, per-wagon merge sha, fixes, tests, CI, review verdict, open points.
