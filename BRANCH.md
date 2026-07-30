# Fix: make the pgbackup secret resolve — prod has no working backup

## Objective
- [ ] Stop `k8s-bundle-secret` from creating an EMPTY `sentropic-pgbackup` Secret. It reads `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT` — five names that exist in NO `.env` in the repo. The Secret was therefore always created empty, the CronJob fails in `CreateContainerConfigError`, and **prod has no working scheduled backup on either cluster**.
- [ ] Nothing was missing except the mapping: the credentials are present under different names, and the backup bucket was already declared and never wired.

## Scope / Guardrails
- [ ] One target in `Makefile`, additive only. No app code, no k8s manifest, no CI.
- [ ] Explicit `S3_*` still wins, so a dedicated write-only credential can replace the fallback later without touching this target.
- [ ] No cluster action from this branch. `k8s-bundle-secret` is run by whoever holds the kubeconfig.
- [ ] No secret value is printed, committed, or echoed. The new guard reports only the NAME that failed to resolve.
- [ ] All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`, `.cursor/rules/**`
  - `deploy/k8s/**` (owned by the sibling prod-overlay branch, PR #476)
  - `api/**`, `ui/**`, `packages/**`, `.github/workflows/**`
  - `.env` (never committed; values are read, never written)
- **Conditional Paths (allowed only with explicit exception)**:
  - `Makefile` — covered by `BR-INFRA-EX6`

## Feedback Loop
- `BR-INFRA-EX6` — **Makefile** (default Forbidden Path).
  - Reason: `k8s-bundle-secret` is the only place that materialises `sentropic-pgbackup`. The name mismatch that empties it cannot be fixed anywhere else.
  - Impact: additive inside one existing target — five `[ -n ... ] ||` fallbacks and one non-empty guard. No existing read is changed; an `.env` that already carries `S3_*` behaves exactly as before.
  - Rollback: delete the fallback block and the guard loop.
  - Owner ratification: WP-INFRA scope exception on dedicated branches (2026-07-29), extended by the owner's instruction to organise the backup (2026-07-29).
- `attention` — the fallback reuses the **documents** object-store credentials for backups. The bucket is distinct (`PG_BACKUP_BUCKET` = `sentropic-pgbackup`, versus `top-ai-ideas-docs`), but the key is shared: whoever can read backups can read documents. Accepted to close a total absence of backup; the durable fix is a write-only credential scoped to the backup bucket. Recorded, not silently taken.
- `attention` — the store is Scaleway Object Storage (`https://s3.fr-par.scw.cloud`, `fr-par`), which is independent of the Kubernetes provider and stayed valid across the OVH move. So this is NOT part of the Scaleway-residue debt in `deploy/k8s/base`.
- `clarification` — no dependency on the at-rest key work. These S3 credentials are handed to the container as a Secret; they are not encrypted with `SECRET_ENCRYPTION_KEY`. The keyring sequencing (#464) does not gate this.
- `blocked` — I cannot verify that the `sentropic-pgbackup` bucket actually exists on Scaleway, nor that the key can write to it. I hold no credential and run no cluster command. First real CronJob run is the proof.
- `attention` — this fixes the Secret only. The CronJob still cannot exist in prod until the prod overlay converges (PR #476). Both are needed.

## AI Flaky tests
- Not applicable: one Makefile target, no test touched.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: single additive change. Kept separate from PR #476 (manifests) because the two have different reviewers and different blast radius.

## UAT Management (in orchestration context)
- **Mono-branch**: no UI change. Acceptance = after PR #476, a real `k8s-bundle-secret` run produces a NON-empty `sentropic-pgbackup`, the CronJob leaves `CreateContainerConfigError`, and one dump lands in `s3://sentropic-pgbackup/pg/`.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Confirm the CronJob consumes the five `S3_*` keys via `secretKeyRef` on `sentropic-pgbackup`.
  - [x] Confirm `k8s-bundle-secret` already creates that Secret — the mechanism existed, per the owner's pointer.
  - [x] Confirm the five `S3_*` names appear in NO `.env` (checked every `.env` in the tree).
  - [x] Find what the `.env` DOES carry: `DOC_STORAGE_{ACCESS_KEY,SECRET_KEY,ENDPOINT,REGION}_PROD` plus `PG_BACKUP_BUCKET`.
  - [x] Confirm `PG_BACKUP_BUCKET` is read NOWHERE in the repo — declared, never wired.
  - [x] Create isolated worktree `tmp/infra-pgbackup-secret`.
  - [x] Declare `BR-INFRA-EX6`.

- [x] **Lot 1 — Resolve the five values**
  - [x] Fall back to the `_PROD` object-store keys and `PG_BACKUP_BUCKET` when `S3_*` is absent or empty.
  - [x] Refuse to create the Secret at all if any of the five still resolves empty, naming the offender.
  - [x] Document in-target why the mismatch silenced the backup.
  - [x] Lot gate:
    - [x] `make -n k8s-bundle-secret` expands with no make syntax error.
    - [x] Resolution replayed against the real root `.env`: all five resolve — bucket `sentropic-pgbackup`, endpoint `https://s3.fr-par.scw.cloud`, region `fr-par`, both credentials non-empty (lengths only, values never printed).
    - [x] Guard replayed against an `.env` lacking the keys: exits 1 naming the offender instead of creating an empty Secret.

- [ ] **Lot 2 — Handover**
  - [ ] Hand to `claude:poc-k8s`: run `k8s-bundle-secret` on both namespaces once #476 has landed, then confirm the first dump object.
  - [ ] Follow-up scope: write-only credential dedicated to the backup bucket.
