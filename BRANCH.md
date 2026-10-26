# Feature: Freeze the app cluster-mesh W0 baseline

## Objective
- [ ] Freeze the real baseline and W2/W4/P handoffs for the approved app switch plan; submit a draft PR and stop.

## Scope / Guardrails
- [x] Owner GO: 2026-10-18 launch packet, AGENT_SIG:7f3a9c2e1b; W0 only, no PR merge or deployment; 19 October follow-up authorizes main integration under BR142-EX2.
- [x] Approved plan: `/home/antoinefa/src/sentropic/.tmp/app-switch-week/plan.md`, SHA-256 `166e9bbf2c580ee61b3decc9c3a4c758db579a38783eb212cf80f0a3a43c816a`, section 3.
- [x] Isolated worktree: `tmp/worktrees/app-cm-w0`; branch `feat/app-cm-w0-baseline`; initial HEAD/origin/main `9ed96eb83cd77da710f1adeb83a19e425d6c4910`.
- [x] Production access is read-only; 22 October owner authorization permits tenant-admin exec into existing PostgreSQL pods for migration-bookkeeping SELECTs only, plus backup catalogue/status/receipt reads; no Secret values in records, migration execution, service starts or live data changes.
- [x] Make-only commands, `ENV` last; atomic W0-authored commits at most 150 changed lines, selective staging, `make scope-check` then `make commit`; owner-requested upstream merge carries inherited changes under BR142-EX2.
- [x] English records with owner quotations retained verbatim; no W0-authored product/API/UI/package/lock/deployment changes; no migration file on W0; inherited main changes only under BR142-EX2.
- [x] Root dev 8787/5173/1080 and D2 9381/5581/1481, 9382/5582/1482 remain reserved to their owners.
- [x] W0 runtime slot: `test-app-cm-w0`, API/UI/Maildev UI 9710/5910/1810; no service listeners started.
- [x] 26 October follow-up: execute only plan-v2 W0-close.a/d; merge current main without rebasing, preserve historical readings, use `ENV=test-app-w0`; no restore, PR merge or deployment.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `docs/baselines/app-cm-w0/**`
  - `.h2a/owner-questions-w0.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/**`
  - `ui/**`
  - `apps/**`
  - `packages/**`
  - `deploy/**`
  - `.github/**`
  - `.track/**`
  - `plan/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - None; downstream W3/P exceptions are recorded as handoffs, not exercised here.
- **Exception process**:
  - Declare `BR-CM-W0-EXn` with reason, impact and rollback before any scope expansion.
  - [x] `BR-CM-W0-EX1`: owner follow-up explicitly requests `.h2a/owner-questions-w0.md` in French; impact is one decision-preparation record, no operator/key assignment; rollback removes that record. Other records remain English.
  - [x] `BR142-EX2`: owner follow-up explicitly requested merging origin/main `cf0ad8ee44f9bb7cf4ad1222a468172f0f77fc2d` into W0. Integrated unchanged upstream bytes at fe26214df; temporary allowances removed. Impact: main history and its existing package/lock/CI/spec/plan changes entered this branch; rollback: owner-authorized merge revert. No PR merge or deployment is authorized.
  - [x] `BR142-EX3`: owner requests merging origin/main `fbfe68f0e40d386e6b3429abc2ea8f868fcdd3f6`, including the published artifacts/mesh tuple. All inherited paths are allowed solely for this merge; retain this branch's BRANCH.md on add/add conflict. Impact: unchanged main bytes/history, exceeding the authored-diff limit; rollback: separately authorized merge revert. Track contains all 342 prior branch events and matches main byte-for-byte; acceptance refresh belongs to the designated Track writer.
  - [x] `BR-CM-W0-EX4`: conductor packet `app-W0c.md` explicitly orders the W0-close.c receipt template at `docs/runbooks/app-cm-baseline-restore/receipts/TEMPLATE.md` in this worktree plus the index entry in `docs/baselines/app-cm-w0/baseline.md`. Impact: one template doc + one table cell, no code, no cluster contact; rollback: remove the template file and revert the cell.

## Feedback Loop
- [ ] `attention`: 26 October B01/B02/B04 and B06 number evidence supplied; B03 isolated recovery/checkpoint and B08 exact-head reviews remain open. Missing upstream UP-T durable activation receipt gates W1.c; positive writer fencing gates W2.
- [x] `acknowledge`: F3/F4 owner answers Q1–Q4 copied verbatim into owner-decisions.md; owner holds all human roles, agents execute, no staffed windows or temporal slot bookings are required because there are no users; owner signs with a later-enrolled dedicated identity/key.
- [ ] `blocked`: W0 acceptance remains gated by B03 and exact-head independent review B08 in authorization.md; UP-T, enrollment/infra/promotion and runtime qualification retain their applicable downstream gates.
- [x] `clarification`: D2/#677 owns control 0012–0019; W1 withdraws 0017 and reserves verified-free 0020. O1 owns 9495/5695/1595; app ports remain in reservations.md; W2.b alone reconciles API manifest/root/API locks.
- [x] Track import belongs to the designated root writer; this concurrent worktree updates mergeable source records only (`track-operation` contract).

## AI Flaky tests
- [x] No AI/provider tests needed for records; no accepted flakes or timeout changes.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch**: one W0 coder, records only; owner-requested main integration under BR142-EX2.
- [ ] **Multi-branch**: downstream T1/T2/T3/T4/TG/T5 retain technical ordering/file ownership; no staffed slot reservations required or downstream branches launched by W0.

## UAT Management (in orchestration context)
- [x] No UI behavior changes or root-dev UAT; production qualification belongs to W5.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline and evidence boundaries**
  - [x] W0-close.a/B01: 26 October endpoint-to-Service/Pod routing, public HTTPS body hashes, live ConfigMap/template/environment hashes and refreshed image identities recorded; BR142-EX3 temporary merge allowance removed.
  - [x] W0-close.a/B02: current package-journal discovery and complete cutover/author/generation/lease inventory recorded; absent runtime authority is explicit and positive fencing remains W2 qualification.
  - [x] W0-close.a/B04: dated scoped SQL inventory and per-source leave-in-place disposition; 4 unscoped chat messages explicitly excluded from import, legacy readers retained.
  - [x] W0-close.a/B04 object/ACL evidence: 14 scoped S3 reads/checksums, size matches, private ACLs and failed anonymous HEADs recorded; no content/keys/credentials exported or objects changed.
  - [x] W0-close.d probe runner uses the existing pinned Compose qualification service and matching down target; preserve historical defaults while accepting the current published-fit probe/tuple.
  - [x] Read MASTER/workflow, README/TODO/PLAN, branch template and approved owner request/plan.
  - [x] Mechanical `harness check branch` passes; branch is clean and starts at pinned main.
  - [x] Follow-up: branch verified, remote pulled with fast-forward only, main integrated under BR142-EX2; identical Track blobs and all 342 event IDs preserved. Track acceptance refresh stays with the designated root writer.
  - [x] 26 October: current main merged under BR142-EX3; only BRANCH.md conflicted, retained W0 plan; no source/lock/package conflict resolution or rebase.
  - [x] Record available runtime evidence, pending operator facts, endpoint parity, configured domains and generated-content authorities in `docs/baselines/app-cm-w0/baseline.md`.
  - [x] Pin exact releases, selected peers, integrities and lock/config hashes in `published-tuple.json`.
  - [x] F1/F2 follow-up: add standalone read-only metadata/archive collectors; validate COPY counting with a two-table fixture before recording historical aggregates.
  - [x] F1/F2 follow-up: preserve dated offline journal/content counts and existing CI SQL backup/restore metadata in recovery-readings.md; current tenant recovery/object/ACL proof remains open.
  - [x] F1 follow-up: record inactive-cluster deployment/config identities and hashes, zero pod lists, actual OVH RBAC denials and exact missing current-tenant access in cluster-readings.md.
  - [x] 21 October B01 follow-up: verify branch/pull; tenant-admin GETs only; record prod/preprod/remote running digests, pod UID/start, controller chains, content-role absence and config names/resourceVersions; delete temporary mode-600 kubeconfig; B02/B03 remain pending, no DB access.
  - [x] 22 October B02/B03 follow-up: verify branch/pull; owner-authorized read-only migration discovery/count/max/frontiers in prod/preprod and latest backup status/upload receipts recorded in migration-backup-readings-2026-10-22.md; temporary mode-600 kubeconfigs deleted, no refusal; runtime/package state, private object checkpoint and restore proof remain pending.
- [ ] **Lot 1 — Frozen implementation handoffs**
  - [x] W0-close.d/B06: 747 ref / 263 worktree nonlocal scan; withdraw 0017, reserve control 0020, freeze main/upstream/next-branch bases and W2.b's sole lock-writer turn.
  - [x] W0-close.d tuple/profile: published 0.2.0/0.22.1 strict fit passes; APP-P1/internal ports, whole source-lock/installed tuple trees and payload-equivalence gates frozen; missing upstream UP-T durable activation receipt explicitly gates W1.c.
  - [x] Record the W2 host-fit prototype and exact provider/transport preservation contract in `host-fit.md`.
  - [x] Freeze W4 context construction, signatures, caller changes and acceptance tests in `catalog-context.md`.
  - [x] Pin P canonical verifier, vectors and trust/key authorization contract in `promotion-contract.md` and `verifier-vectors.json`; Q3/Q4 settle signer/key source, with enrollment and public fingerprint deferred under B05.
- [ ] **Lot 2 — Dispatch and authorization register**
  - [x] Record migration IDs, isolated ports, six-step train order and shared-file writers in `reservations.md`; Q1 assigns human roles to the owner with agent execution; Q2 removes staffed-window/slot booking from W0 acceptance.
  - [x] Record pending runtime/operator/key/approval dependencies, owners, deadlines and observable gates in `authorization.md`.
  - [x] F3/F4 follow-up: prepare the requested French owner questions with context, options, consequences and explicitly provisional recommendations; no assignments or keys invented.
  - [x] Record the supplied Q1–Q4 answers verbatim and update plan-dependent ownership, scheduling and signer/key handoffs; dedicated-key enrollment is a later authorized action, fingerprint pending, no private key collected.
  - [x] Enumerate remaining W0 acceptance blockers precisely: serving-cluster/DB/backup/object access and F1/F2 receipts/disposition, B06 nonlocal migration-0017 reconciliation and B08 independent final-head review; distinguish later technical/action gates.
  - [x] Consolidate findings into the bounded downstream branch handoffs, including W3/T3 EX1 and P/TG EX2.
- [ ] **Lot 3 — Final validation and draft delivery**
  - [x] W0-close.a/d: baseline/authorization/catalogue/README consolidated around dated current receipts; B03/B08 remain open, UP-T W1.c dependency explicit, no restore or PR merge.
  - [x] W0-close.a/d verification: strict published fit and original vector/source/link checks pass; payload asset comparisons, JSON/diff hygiene, mechanical C1/C2 and matching locked Compose cleanup recorded in verification-2026-10-26.md; exact pushed-head CI checked at delivery.
  - [x] Check JSON, source citations, secret hygiene, reservations, prototype/verifier evidence and every diff hunk; run `make scope-check` before each commit.
  - [x] Reproducible committed `probe.mk`: `w0-host-fit` and `w0-record-check` pass on the pinned Node image, exact selectors and frozen public vectors; no product services/credentials.
  - [x] Follow-up validation: w0-record-check passes; 34 local record/dossier links and retained CI JSON checked; COPY fixture passes; live digests and independent acceptance stay pending.
  - [x] Owner-answer follow-up validation: byte-for-byte Q1–Q4 copy, current record links/vectors and frozen source hashes at tuple.sourceSha pass after main integration; no private-key markers found; scope and diff hygiene checked before commit.
  - [x] API/UI/E2E/security suites: not applicable to documentation-only W0; downstream file-level gates are retained in handoffs.
  - [ ] Independent acceptance-scope review; coding instance does not review itself.
  - [x] Prepare this exact file as draft PR body; preserve pending evidence/review gates and the separate production authorization register.
  - [x] Initial draft PR #702 and required execution-plan comment delivered at reviewed head ce26bb090bf1d2a43a00d9c97671269e18152e52; follow-up evidence updates the same draft.
  - [ ] Report PR number and exact head SHA, then stop; keep BRANCH.md and leave merge/deployment to separately authorized actors.
