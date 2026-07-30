# Fix: pin the live OVH storage class in the prod overlay

## Objective
- [ ] Make `overlays/prod` converge. It is blocked exactly as preprod was: the live prod StatefulSet carries `block-standard` while the base template (post-#471) carries none, and `volumeClaimTemplates` is immutable. Mirrors #474, which turned `deploy-preprod` green.
- [ ] Unblock the consequence that matters more than the deploy: while the prod overlay does not converge, the `pgbackup` CronJob is never created, so **prod has no working scheduled backup on either cluster**.

## Scope / Guardrails
- [ ] Two files in `deploy/k8s/overlays/prod/`. No base change, no app code, no Makefile, no CI.
- [ ] Copies `overlays/preprod/patch-postgres-storageclass.yaml` line for line, same `block-standard` value.
- [ ] Repo-side only. No cluster action from this branch, and no `make k8s-*` with a `KUBECONFIG` override.
- [ ] Merging cannot deploy PROD: there is no `deploy-prod` job in `ci.yml` (verified) — prod deploys are manual. It does trigger CI and `deploy-preprod` on the main push, but the rendered preprod overlay is BYTE-IDENTICAL to main (verified by diff), so that job is inert here.
- [ ] All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `deploy/k8s/overlays/prod/patch-postgres-storageclass.yaml`
  - `deploy/k8s/overlays/prod/kustomization.yaml`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`
  - `deploy/k8s/base/**`, `deploy/k8s/overlays/preprod/**`
  - `api/**`, `ui/**`, `packages/**`, `.github/workflows/**`
- **Conditional Paths**: none. No exception needed.

## Feedback Loop
- `clarification` — **my earlier root cause was wrong in the detail that decided everything.** I reported that the live cluster carried `scw-bssd`. `claude:poc-k8s` measured it: the live preprod StatefulSet carried `block-standard` (its port had already rewritten the class on 2026-07-28), and the live prod one carries `block-standard` too. The divergence was REPO-vs-LIVE, not Scaleway-vs-OVH. Consequence: #471 alone did not unblock preprod — a server-side dry-run against `main` still failed on both the Service and the StatefulSet.
- `attention` — the destructive runbook I relayed (delete StatefulSet + Service + PVC, then restore from a prod dump) would have destroyed the preprod database for a fix that was insufficient. poc-k8s measured before executing and declined it. The non-destructive remedy is this overlay pin. Do not re-propose the recreation path.
- `acknowledge` — the headless Service half was already fixed cluster-side by poc-k8s on both namespaces (prod `clusterIP 10.3.83.73 -> None`, endpoints unchanged, zero pod restart, integrity checked before/after). This patch is the remaining repo-side half.
- `clarification` — **the S3 credentials were never missing.** `.env.prod` (present since 2026-07-25) carries all five `S3_*` keys, and `Makefile:2984-2986` documents prod provisioning as `make k8s-bundle-secret K8S_ENV_FILE=.env.prod`. I had claimed they existed nowhere and opened PR #477 to map them from other names; that PR was a no-op on the documented prod path and is CLOSED. My `find` matched the literal name `.env` and never saw `.env.prod`. No Makefile change is needed for the backup.
- `attention` — **residual risk gating this patch.** `volumeClaimTemplates` has no patch merge key, so the strategic merge REPLACES the whole list and asserts `storageClassName` + `accessModes` + `1Gi` together. If the live prod template differs on any of the three, the apply is still rejected and this patch is a no-op. The Lot 2 server-side dry-run is mandatory, not a formality.
- `attention` — **a separate, pre-existing hazard found during review, worth its own branch.** The guard-free `k8s-bundle-secret` applies `sentropic-postgres` and the 38-key `sentropic-api` Secret before validating anything. The root `.env` has `DATABASE_URL`, `OAUTH_SIGNING_KEK`, `POSTGRES_PASSWORD` and `SCW_TEM_SECRET_KEY` EMPTY. An operator running the target against prod without `K8S_ENV_FILE=.env.prod` blanks the api Secret — a blank `OAUTH_SIGNING_KEK` bricks every stored `enc:v1:` envelope — and resets the postgres password to `app`. Needs a precondition guard over the full required key set, before the first `kubectl apply`. Not in this branch's scope.
- `attention` — the `pgbackup` object key carries no tier prefix (`s3://$S3_BUCKET/pg/<ts>.sql.gz`) and both tiers share `schedule: 15 2 * * *`. If both tiers ever point at the same bucket, a preprod dump becomes indistinguishable from a prod one and could be restored into prod. Follow-up scope.

## AI Flaky tests
- Not applicable: Kubernetes manifests only.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: two files, one concern, mirrors an already-merged and already-proven patch.

## UAT Management (in orchestration context)
- **Mono-branch**: no UI change. Acceptance = `claude:poc-k8s` runs a server-side dry-run of `overlays/prod` against ns `sentropic` and gets 0 error, then the manual prod deploy converges and `cronjob.batch/pgbackup` reports `created`.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read poc-k8s's two measurement reports rather than re-deriving.
  - [x] Confirm #474 is on `main` and read its patch verbatim.
  - [x] Confirm `overlays/prod` has no `patches:` block at all.
  - [x] Confirm no `deploy-prod` job exists in `ci.yml`, so merging is inert.
  - [x] Create isolated worktree `tmp/infra-prod-storageclass`.

- [x] **Lot 1 — The prod pin**
  - [x] Add `deploy/k8s/overlays/prod/patch-postgres-storageclass.yaml`, mirroring preprod with `block-standard`.
  - [x] Reference it from a `patches:` block in the prod kustomization.
  - [x] Document in-file the three-way-merge reason and the backup consequence.
  - [x] Lot gate:
    - [x] `kubectl kustomize deploy/k8s/overlays/prod` renders without error.
    - [x] The rendered prod StatefulSet carries `storageClassName: block-standard`.
    - [x] `kubectl kustomize deploy/k8s/overlays/preprod` still renders (no cross-tier regression).

- [ ] **Lot 2 — Handover**
  - [ ] Ask poc-k8s for a server-side dry-run of `overlays/prod` before any real apply.
  - [ ] Escalate the five S3 values to the owner — the backup gap outlives this patch.
