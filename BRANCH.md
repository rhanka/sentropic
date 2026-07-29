# Fix: Unblock preprod CD — cluster-agnostic postgres storage + prod→preprod restore path

## Objective
- [ ] Stop `deploy-preprod` from failing on every main push: `deploy/k8s/base/20-postgres.yaml` hardcodes the Scaleway StorageClass `scw-bssd` while preprod has run on OVH since 2026-07-28. `volumeClaimTemplates` is immutable, so `kubectl apply -k` can never reconcile the existing object.
- [ ] Add the missing prod→preprod data path: no `cd.yml` exists and `db-restore` targets the local docker-compose postgres, so nothing can seed preprod today.

## Scope / Guardrails
- [ ] Scope limited to `deploy/k8s/**` plus one additive Makefile target.
- [ ] No app code, no `api/drizzle/*.sql` migration, no prod namespace change.
- [ ] Make-only workflow, no direct Docker commands.
- [ ] Root workspace `~/src/sentropic` stays reserved for user dev/UAT (`ENV=dev`).
- [ ] Branch development happens in isolated worktree `tmp/infra-preprod-postgres`.
- [ ] The destructive StatefulSet recreation is a CLUSTER operation owned by `claude:poc-k8s`, never run from this branch.
- [ ] No `make k8s-*` is run from here with a `KUBECONFIG` override — those targets hardcode their own kubeconfig per sub-command and an outer override does not contain them.
- [ ] In every `make` command, `ENV=<env>` is passed as the last argument.
- [ ] All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `deploy/k8s/base/20-postgres.yaml`
  - `deploy/k8s/overlays/preprod/**`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/**`, `ui/**`, `packages/**`
  - `.github/workflows/ci.yml` (owned by the sibling filter/hash branch)
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception)**:
  - `Makefile` — covered by `BR-INFRA-EX1`

## Feedback Loop
- `BR-INFRA-EX1` — **Makefile** (default Forbidden Path).
  - Reason: the prod→preprod restore path exists nowhere. Only `ci.yml` exists (the `cd.yml` referenced by the preprod kustomization comment was never created), `db-restore` restores into the local docker-compose postgres, and `test-smoke-restore` uses the backup/restore couple to test migrations inside the runner — never to seed preprod. A new target is the only place this can live.
  - Impact: additive only — one new `.PHONY` target, no existing target modified, so no behaviour change for any current caller.
  - Rollback: delete the target block; nothing else references it.
  - Owner ratification: WP-INFRA scope exception on dedicated branches (2026-07-29).
- `attention` — copying real production data into the less-protected preprod namespace was explicitly requested by the owner (2026-07-29). Mitigated: the target is manual-only, never wired into a push-triggered job, and confirmation-gated.
- `blocked` — recreating the Service + StatefulSet on the OVH preprod cluster needs credentials held by `claude:poc-k8s`. This branch delivers the manifests, the restore path and the runbook; the execution is handed over.
- `attention` — PR #470 `BRANCH.md` states the `api`/`ui` change-filters "already SUPERSET the API_VERSION/UI_VERSION input paths (verified)". That is incorrect: `packages/comments/**` feeds `API_VERSION` without being in the `api` filter, and `packages/chat-ui/**`, `packages/cowork-desktop/**`, `packages/cowork-bridge/**` feed `UI_VERSION` without being in the `ui` filter. Handled by the sibling branch, not here.

## AI Flaky tests
- Not applicable: this branch changes Kubernetes manifests and adds one Makefile target. No AI-backed test is touched.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: single concern (unblock preprod CD). The filter/hash fix and the `SECRET_ENCRYPTION_KEY` delivery are separate branches by owner ratification — different risk, different cadence, and the security work is under embargo.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT on the integrated branch only.
- Execution flow:
  - [ ] Develop in `tmp/infra-preprod-postgres`.
  - [ ] Push branch before UAT.
  - [ ] UAT = `deploy-preprod` green on a main push after `claude:poc-k8s` has recreated the StatefulSet.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Establish the root cause from CI logs rather than from the inherited brief.
  - [x] Confirm the PR #470 image guard already passes on run `30420237778` (no missing manifest).
  - [x] Confirm the blocking fields: `Service.spec.clusterIPs[0]` and `StatefulSet.spec.volumeClaimTemplates`.
  - [x] Confirm `KUBE_CONFIG_DATA_PREPROD` moved to OVH on 2026-07-28 while `deploy/k8s/base` stayed on Scaleway.
  - [x] Confirm no prod→preprod restore path exists in any workflow or Makefile target.
  - [x] Create isolated worktree `tmp/infra-preprod-postgres`.
  - [x] Declare `BR-INFRA-EX1` for the Makefile.

- [x] **Lot 1 — Cluster-agnostic postgres storage**
  - [x] Remove the hardcoded `storageClassName: scw-bssd` from `deploy/k8s/base/20-postgres.yaml` so each cluster binds its own default StorageClass.
  - [x] Document in-file why the field is absent and how a tier forces one via an overlay patch.
  - [x] Lot gate:
    - [x] `kubectl kustomize deploy/k8s/overlays/preprod` renders without error.
    - [x] `kubectl kustomize deploy/k8s/overlays/prod` renders without error.
    - [x] The rendered preprod StatefulSet carries no `storageClassName`.

- [x] **Lot 2 — prod→preprod restore path**
  - [x] Add `k8s-db-restore-preprod` restoring a prod dump into the preprod namespace postgres.
  - [x] Manual-only, `SKIP_CONFIRM`-gated, and hard-refuses to run against the prod namespace.
  - [x] Lot gate:
    - [x] `make -n k8s-db-restore-preprod` expands without error.
    - [x] Namespace guard executed: `K8S_PREPROD_NAMESPACE=sentropic` exits 1 with "Refusing", before any `kubectl`.
    - [x] Missing `BACKUP_FILE` exits 1 with the available-backups hint.
    - [x] The target appears in no `.github/workflows/**` job (`grep -c` = 0 in `ci.yml`).

- [ ] **Lot 3 — Handover to `claude:poc-k8s`**
  - [x] Deliver the recreation runbook (below). Runs against the OVH PREPROD kubeconfig only — the prod namespace `sentropic` is never touched.
  - [ ] `blocked` until poc-k8s executes it on the OVH preprod cluster.
  - [ ] Runbook step 1 — dump prod: `make db-backup-prod KUBECONFIG=<prod-ovh-kubeconfig>`
  - [ ] Runbook step 2 — drop the immutable trio in preprod (the PVC must go too, otherwise the old StorageClass binding survives):
    - [ ] `kubectl -n sentropic-preprod delete statefulset postgres`
    - [ ] `kubectl -n sentropic-preprod delete service postgres`
    - [ ] `kubectl -n sentropic-preprod delete pvc data-postgres-0`
  - [ ] Runbook step 3 — re-apply the overlay from this branch (or let the next main push run `deploy-preprod`): `kubectl apply -k deploy/k8s/overlays/preprod`
  - [ ] Runbook step 4 — wait for `deploy/api` to roll out; the api owns the migrations on this DB.
  - [ ] Runbook step 5 — seed with prod data: `make k8s-db-restore-preprod KUBECONFIG=<preprod-ovh-kubeconfig> BACKUP_FILE=prod-<timestamp>.dump`
  - [ ] Runbook step 6 — report back the StorageClass the new PVC actually bound to, so it can be recorded.

- [ ] **Lot N — Docs consolidation**
  - [ ] Record the remaining Scaleway residue in `deploy/k8s/base` (image registry, LoadBalancer, TEM) as follow-up scope.
