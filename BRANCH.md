# Feature: BR-45 — IdP identity sync prod → preprod via CD (#799, model A)

## Objective
Keep the preprod IdP on the SAME user IDs as prod (`sub = users.id`), synced by CD only (no manual kubectl): a prod-side export to the k8s-owned S3 relay and a preprod-side transactional import, dry-run first, same model as the immo/geo bascules.

## Scope / Guardrails
- Scope limited to the IdP identity relay (prod export, preprod import), its CD workflow, its selftests, and the `pgbackup` upload migration to s5cmd.
- No migration in `api/drizzle/*.sql`.
- Make-only workflow, no direct Docker commands; ZERO Python (no `amazon/aws-cli`); images pinned by digest (`postgres:17-alpine@sha256:b0f9560a…`, `peakcom/s5cmd:v2.2.2@sha256:6e551552…`).
- No prod credential ever referenced from `sentropic-preprod` objects (prod exports to the relay with the writer; preprod reads with the reader).
- Never touched by the import: `oauth_clients` (incl. `radar-immobilier-preprod`), `id_token_signing_keys`, OAuth codes/tokens/consents, sessions of non-rekeyed users (DV5).
- Logs and Job termination messages carry IDs and counts only, never emails or secrets.
- Root workspace `~/src/sentropic` is reserved for user dev/UAT and must remain stable.
- Branch development happens in isolated worktree `tmp/idp-identity-sync`.
- Automated test campaigns run on dedicated environments (`ENV=test-idp-sync`), never on root `dev`.
- In every `make` command, `ENV=<env>` is passed as the last argument.
- Ports (branch 45): slot 0 `API_PORT=9225 UI_PORT=5425 MAILDEV_UI_PORT=1325`, slot 1 `API_PORT=9226 UI_PORT=5426 MAILDEV_UI_PORT=1326` (no app stack expected; tests use one-off containers).
- Commits < 150 lines, `make commit MSG="..."`, selective `git add`, no AI attribution.
- No merge, no deploy, no push to `main`: PR only, merge and CD run by s-conductor under owner GO.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `deploy/k8s/overlays/prod/idp-identity-sync/**`
  - `deploy/k8s/overlays/preprod/idp-identity-sync/**`
  - `deploy/k8s/overlays/prod/kustomization.yaml`
  - `deploy/k8s/overlays/preprod/kustomization.yaml`
  - `deploy/k8s/base/70-pgbackup-cronjob.yaml`
  - `deploy/ci/idp-identity-sync/**`
  - `deploy/k8s/README.md`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/**`, `ui/**`, `packages/**`
  - `deploy/k8s/base/**` except `70-pgbackup-cronjob.yaml`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile` (BR45-EX1)
  - `.github/workflows/**` (BR45-EX2)
- **Exception process**:
  - Declare exception ID `BR45-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- `BR45-EX1` Makefile — reason: add `test-idp-sync-selftest` (Node in Docker, `$(LLM_MESH_NODE_IMAGE)`) and `test-idp-sync-sql` (one-off `postgres:17-alpine` with drizzle migrations + fixtures, runs `import-preprod.sql` in dry-run and commit modes); impact: two new targets only, no change to existing targets; rollback: revert the commit.
- `BR45-EX2` `.github/workflows/idp-identity-sync.yml` (new) + `ci.yml` (selftest + SQL test jobs on PR/push) — reason: CD bundle for prod objects (prod has no CD today) and the sync run workflow (schedule + dispatch, DRY_RUN default true); impact: new workflow armed by repo var `IDP_SYNC_CD_ENABLED`, prod jobs behind GitHub Environments with owner approval; rollback: unset the arming var, revert the commit.
- `attention` bootstrap actions outside CD (applied once, documented in `deploy/ci/idp-identity-sync/README.md`): tenant admin applies `rbac-ci-idp-bundle-prod.yaml` and mints TokenRequest kubeconfigs (≤ 90 d) for `sentropic-ci-idp-bundle-prod` and `sentropic-ci-trigger-idp-export`; GitHub Environments + secrets from `.env`; k8s lane applies the VAP `sentropic-ci-trigger-suspend-only`.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: one deliverable (relay sync) plus one small orthogonal lot (pgbackup s5cmd); DEV `gpt-6.1-sol` (high) implements Lots 1-4 in `tmp/idp-identity-sync`, DEV `gemini-3.8-flash-high` implements Lot 5 in `tmp/idp-identity-sync-pgbackup` (cherry-picked), each cross-reviews the other; conductor (auth session) reviews every lot.

## UAT Management (in orchestration context)
- **Mono-branch**: no UI change; acceptance = CI green + the CD dry-run audit validated by s-conductor after merge.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `plan/BRANCH_TEMPLATE.md`.
  - [x] Create isolated worktree `tmp/idp-identity-sync` from `origin/main` (7d1002505).
  - [x] Survey the immo/geo bascule CD model (bundle CD, dormant `*/5` CronJob, suspend-only trigger SA + VAP, idempotent RO-role Job with `\getenv`, Node selftests, CI reads Job status).
  - [x] Confirm relay facts (poc-k8s `preprod-cred-governance.md` origin/main: bucket `sentropic-idp-identity-relay`, prefix `idp-identity/latest/`, writer no-delete, reader GET/LIST, SSE AES256, 2-day expiry).
  - [x] Confirm measured state 2026-10-03 (owner re-key `9f11d240-fc75-4d55-80be-1bafcd79eadb` → `1b9b9e15-2956-4df4-9ee1-a42273f0d096`; Farid unchanged; DV5 oauth_clients 2, signing keys 1/1).
  - [x] Declare `BR45-EX1`, `BR45-EX2`.

- [ ] **Lot 1 — SQL (versioned, idempotent)**
  - [x] Version the reviewed import transaction through catalog-driven FK repointing (post-conditions follow in the next atomic commit).
  - [x] `deploy/k8s/overlays/prod/idp-identity-sync/reader-role.sql`: idempotent `idp_identity_reader` (password via psql `\getenv` from Secret, refuse empty, column-level SELECT on `users` 13 cols + `webauthn_credentials` 10 cols, read-only, `CONNECTION LIMIT 2`, `statement_timeout 60s`); regularizes the hand-created role.
  - [x] `deploy/k8s/overlays/prod/idp-identity-sync/export-prod.sql`: one `REPEATABLE READ READ ONLY` snapshot → `users.csv`, `webauthn.csv`, `snapshot.csv`.
  - [ ] `deploy/k8s/overlays/preprod/idp-identity-sync/import-preprod.sql`: single transaction, advisory lock, count guard, collision free-email, upsert by prod id, `ALLOWED_REKEY` guard, catalog-driven FK repoint, webauthn authoritative by `credential_id` with `GREATEST` counter, in-txn post-conditions incl. DV5 fingerprint, audit lines (IDs/counts), `dry_run` rollback.
  - [ ] Lot gate:
    - [ ] `make test-idp-sync-sql ENV=test-idp-sync`: fixtures reproduce the measured state (8/8 users, 1 collision with 8 creds + 9 sessions, 7 shared creds, 1 missing prod cred, 1 kept preprod-only user, product rows on the duplicate) → dry run rolls back with expected audit; commit run yields users 9 / webauthn 22 / collisions 0; second commit run is a no-op; unknown re-key pair fails closed; DV5 tamper fails closed.

- [ ] **Lot 2 — Kubernetes objects (kustomize, deployed by CD)**
  - [ ] `overlays/prod/idp-identity-sync/`: kustomization (ns `sentropic`, `configMapGenerator` with `disableNameSuffixHash`), SA `sentropic-idp-export` (no token), NetworkPolicy `allow-idp-export-to-postgres`, CronJob `sentropic-idp-identity-export` (`*/5`, `suspend: true`, Forbid, export + `SHA256SUMS` + s5cmd put with `sentropic-idp-relay-writer`), trigger SA/Role/RoleBinding `sentropic-ci-trigger-idp-export` (cronjobs get/patch by resourceName, jobs get/list/watch, pods/log get).
  - [ ] `overlays/preprod/idp-identity-sync/`: kustomization (ns `sentropic-preprod`), SA `sentropic-idp-sync` (no token), NetworkPolicy `allow-idp-sync-to-postgres`, CronJob `sentropic-idp-identity-sync` (`*/5`, `suspend: true`, frozen `DRY_RUN=1`, `ALLOWED_REKEY=""`, `MAX_SNAPSHOT_AGE_S`) with pre-sync rollback dump (s5cmd `run` command file, `sentropic-pgbackup`), relay fetch (`sentropic-idp-relay-reader`), `sha256sum -c`, import.
  - [ ] Include `idp-identity-sync` in `overlays/prod/kustomization.yaml` and `overlays/preprod/kustomization.yaml`.
  - [ ] Hardened pods (runAsNonRoot, seccomp RuntimeDefault, drop ALL, no SA token, `enableServiceLinks: false`, memory emptyDirs with sizeLimit, requests/limits, TTL).
  - [ ] Lot gate:
    - [ ] `make test-idp-sync-selftest ENV=test-idp-sync`: kustomize build of both sub-dirs; invariants (suspend true, digests pinned, no aws-cli/python image, no `sentropic-idp-relay-writer`/`sentropic-idp-identity-reader` referenced in preprod, no reader referenced in prod, frozen DRY_RUN=1).

- [ ] **Lot 3 — CD and run workflow**
  - [ ] `deploy/ci/idp-identity-sync/reader-role-provision-job.tmpl.yaml` (prod Job, `\getenv`, backoffLimit 0, deadline 300 s) and `import-job.tmpl.yaml` (preprod Job, `${DRY_RUN}`, `${ALLOWED_REKEY}`, `${MAX_SNAPSHOT_AGE_S}`).
  - [ ] `deploy/ci/idp-identity-sync/run.mjs`: render `${VAR}` (fail on leftover), delete+apply Job, poll `.status`, flip/restore `spec.suspend`, collect audit (Job logs + termination message), write step summary; Node only.
  - [ ] `.github/workflows/idp-identity-sync.yml`: `selftest`; `bundle-prod` (push to main path-scoped + dispatch, var `IDP_SYNC_CD_ENABLED`, env `sentropic-idp-prod` with owner approval, prod apiserver preflight, Secret `replace --dry-run=server` then `replace` from env secrets, `apply -k overlays/prod/idp-identity-sync`, reader-role Job, anti-RCE gate `--as` trigger SA: jobTemplate patch DENIED + suspend flip ALLOWED else empty the Role and fail); `run` (schedule daily + dispatch, `DRY_RUN` default true, `ALLOWED_REKEY` default empty, `CONFIRM` date guard for real runs, env `sentropic-idp-run` main-only: flip prod export → wait Job → always re-suspend → preprod import Job → audit).
  - [ ] `ci.yml`: run `test-idp-sync-selftest` and `test-idp-sync-sql` on PR/push when `deploy/**` changes.
  - [ ] `deploy/ci/idp-identity-sync/rbac-ci-idp-bundle-prod.yaml` (bootstrap, applied once by tenant admin) and `vap-ci-trigger-suspend-only.yaml` (for the k8s lane).
  - [ ] Lot gate:
    - [ ] `make test-idp-sync-selftest ENV=test-idp-sync` covers render, status classification, workflow wiring (no `${{ }}` inside `run:`, DRY_RUN default true, prod trigger kubeconfig only in `run`).

- [ ] **Lot 4 — Docs and credential cycle**
  - [ ] `deploy/ci/idp-identity-sync/README.md`: flow, bootstrap, dry-run → real run procedure, rollback (`pre-idp-sync/<job>.dump`), audit acceptance lines.
  - [ ] `deploy/ci/idp-identity-sync/CRED_CYCLE.md`: delegations table (SA, ns, verbs, secret, expiry) + 4-locations table (identity | OVH id | GH env secret | k8s Secret | rewritten by | rotation due).
  - [ ] `deploy/k8s/README.md`: pointer section.

- [ ] **Lot 5 — pgbackup upload to s5cmd (zero Python)**
  - [ ] `deploy/k8s/base/70-pgbackup-cronjob.yaml`: replace `amazon/aws-cli` with pinned `peakcom/s5cmd`, key from the dump container via an s5cmd `run` command file; same bucket/prefix/secret.
  - [ ] Lot gate:
    - [ ] `make test-idp-sync-selftest ENV=test-idp-sync` asserts no `amazon/aws-cli` left under `deploy/k8s/`.

- [ ] **Lot 6 — Final validation**
  - [ ] Cross-reviews recorded (sol ↔ gemini) and conductor review.
  - [ ] CI green on the PR.
  - [ ] Remove `BRANCH.md` before merge.
