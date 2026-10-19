# Feature: Freeze the app cluster-mesh W0 baseline

## Objective
- [ ] Freeze the real baseline and W2/W4/P handoffs for the approved app switch plan; submit a draft PR and stop.

## Scope / Guardrails
- [x] Owner GO: 2026-10-18 launch packet, AGENT_SIG:7f3a9c2e1b; W0 only, no merge or deployment.
- [x] Approved plan: `/home/antoinefa/src/sentropic/.tmp/app-switch-week/plan.md`, SHA-256 `166e9bbf2c580ee61b3decc9c3a4c758db579a38783eb212cf80f0a3a43c816a`, section 3.
- [x] Isolated worktree: `tmp/worktrees/app-cm-w0`; branch `feat/app-cm-w0-baseline`; initial HEAD/origin/main `9ed96eb83cd77da710f1adeb83a19e425d6c4910`.
- [x] Production access is read-only; no Secret values, privileged credentials, pod exec, migrations, service starts or live data changes.
- [x] Make-only commands, `ENV` last; atomic commits at most 150 changed lines, selective staging, `make scope-check` then `make commit`.
- [x] English records; no product/API/UI/package/lock/deployment changes; no migration file on W0.
- [x] Root dev 8787/5173/1080 and D2 9381/5581/1481, 9382/5582/1482 remain reserved to their owners.
- [x] W0 runtime slot: `test-app-cm-w0`, API/UI/Maildev UI 9710/5910/1810; no service listeners started.

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

## Feedback Loop
- [ ] `attention`: F1/F2 read-only collection is recorded in cluster-readings.md and recovery-readings.md; serving-tenant Kubernetes/DB/object access and current recovery/ACL/disposition evidence remain missing.
- [ ] `attention`: Owner decisions F3/F4 are prepared in .h2a/owner-questions-w0.md; named operators/accepted file ownership, staffed windows and authorized signer/key source remain unassigned.
- [ ] `blocked`: W0 acceptance/dispatch remains gated by B01–B08 in `docs/baselines/app-cm-w0/authorization.md`; draft delivery does not close those evidence gaps.
- [x] `clarification`: D2 owns control 0012–0016 and O1 owns 9495/5695/1595; W1 reserves 0017, with app test ports 9710–9717 and e2e 9720–9727 (full triples in reservations.md).
- [x] Track import belongs to the designated root writer; this concurrent worktree updates mergeable source records only (`track-operation` contract).

## AI Flaky tests
- [x] No AI/provider tests needed for records; no accepted flakes or timeout changes.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch**: one W0 coder, records only; no integration from other branches.
- [ ] **Multi-branch**: downstream T1/T2/T3/T4/TG/T5 are reserved by W0, not launched.

## UAT Management (in orchestration context)
- [x] No UI behavior changes or root-dev UAT; production qualification belongs to W5.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline and evidence boundaries**
  - [x] Read MASTER/workflow, README/TODO/PLAN, branch template and approved owner request/plan.
  - [x] Mechanical `harness check branch` passes; branch is clean and starts at pinned main.
  - [x] Record available runtime evidence, pending operator facts, endpoint parity, configured domains and generated-content authorities in `docs/baselines/app-cm-w0/baseline.md`.
  - [x] Pin exact releases, selected peers, integrities and lock/config hashes in `published-tuple.json`.
  - [x] F1/F2 follow-up: add standalone read-only metadata/archive collectors; validate COPY counting with a two-table fixture before recording historical aggregates.
  - [x] F1/F2 follow-up: preserve dated offline journal/content counts and existing CI SQL backup/restore metadata in recovery-readings.md; current tenant recovery/object/ACL proof remains open.
  - [x] F1 follow-up: record inactive-cluster deployment/config identities and hashes, zero pod lists, actual OVH RBAC denials and exact missing current-tenant access in cluster-readings.md.
- [ ] **Lot 1 — Frozen implementation handoffs**
  - [x] Record the W2 host-fit prototype and exact provider/transport preservation contract in `host-fit.md`.
  - [x] Freeze W4 context construction, signatures, caller changes and acceptance tests in `catalog-context.md`.
  - [x] Pin P canonical verifier, vectors and trust/key authorization contract in `promotion-contract.md` and `verifier-vectors.json`; actual signer authorization remains B05.
- [ ] **Lot 2 — Dispatch and authorization register**
  - [x] Reserve migration IDs, ports, six train slots and shared-file writer roles in `reservations.md`; SC confirms personal assignments/availability under B06.
  - [x] Record pending runtime/operator/key/approval dependencies, owners, deadlines and observable gates in `authorization.md`.
  - [x] F3/F4 follow-up: prepare the requested French owner questions with context, options, consequences and explicitly provisional recommendations; no assignments or keys invented.
  - [x] Consolidate findings into the bounded downstream branch handoffs, including W3/T3 EX1 and P/TG EX2.
- [ ] **Lot 3 — Final validation and draft delivery**
  - [x] Check JSON, source citations, secret hygiene, reservations, prototype/verifier evidence and every diff hunk; run `make scope-check` before each commit.
  - [x] Reproducible committed `probe.mk`: `w0-host-fit` and `w0-record-check` pass on the pinned Node image, exact selectors and frozen public vectors; no product services/credentials.
  - [x] Follow-up validation: w0-record-check passes; 34 local record/dossier links and retained CI JSON checked; COPY fixture passes; live digests and independent acceptance stay pending.
  - [x] API/UI/E2E/security suites: not applicable to documentation-only W0; downstream file-level gates are retained in handoffs.
  - [ ] Independent acceptance-scope review; coding instance does not review itself.
  - [x] Prepare this exact file as draft PR body; preserve pending evidence/review gates and the separate production authorization register.
  - [x] Initial draft PR #702 and required execution-plan comment delivered at reviewed head ce26bb090bf1d2a43a00d9c97671269e18152e52; follow-up evidence updates the same draft.
  - [ ] Report PR number and exact head SHA, then stop; keep BRANCH.md and leave merge/deployment to separately authorized actors.
