# Feature: Replace withdrawn MinIO images

## Objective
Unblock CI and the dev stack: `quay.io/minio/minio` and `quay.io/minio/mc` now return 401 (upstream withdrew public images), so every E2E job fails at `up-e2e`. Replace them with digest-pinned Chainguard images with identical behaviour.

## Scope / Guardrails
- Scope limited to MinIO image references in compose files.
- Make-only workflow, no direct Docker commands.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `docker-compose.test.yml` (via BRMINIO-EX1)
  - `docker-compose.dev.yml` (via BRMINIO-EX1)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
  - everything not listed in Allowed Paths
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**` (not needed: no MinIO image pre-pull in CI)
- **Exception process**:
  - BRMINIO-EX1 declared in `## Feedback Loop`.

## Feedback Loop
- [x] BRMINIO-EX1 — `acknowledge`: touch `docker-compose.test.yml` and `docker-compose.dev.yml` (default forbidden).
  - Rationale: upstream MinIO images withdrawn (401 on quay.io, 404 on Docker Hub); all E2E jobs blocked at `up-e2e`.
  - Impact: `minio` and `minio-init` services only; image swap to `cgr.dev/chainguard/minio` and `cgr.dev/chainguard/minio-client:latest-dev`, pinned by digest; dev `minio` keeps root user for pre-existing root-owned volumes.
  - Rollback: revert the branch commit.

## AI Flaky tests
- Acceptance rule: unchanged from template; no test changes in this branch.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- Rationale: single atomic infra fix.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Worktree `tmp/minio-image` on `fix/minio-image-replacement` from `origin/main` 3e9a78909.
  - [x] References inventory: only `docker-compose.test.yml` and `docker-compose.dev.yml` (no CI pre-pull, no k8s manifest).
  - [x] Scope exception BRMINIO-EX1 declared.

- [ ] **Lot 1 — Image replacement**
  - [x] `minio`: `cgr.dev/chainguard/minio:latest@sha256:bd014394a80898e68c149f2311fdf8d5a2c2f3bb2c33b9327ae6d02b4b065ae1` (entrypoint `/usr/bin/minio`, so `server /data --console-address ":9001"` unchanged; user 65532; `/data` is mode 0777 in image; image also ships `mc` and `/bin/sh` for Makefile `doc-backup`/`doc-restore`).
  - [x] `minio-init`: `cgr.dev/chainguard/minio-client:latest-dev@sha256:614e083a12c6dc779f13f97e01b13afda4021a8ce3f4021a2fcf23ec86f46837` (`/usr/bin/mc`, `/bin/sh` via busybox, HOME `/home/nonroot` writable for mc config).
  - [x] Dev `minio`: `user: "0:0"` to keep pre-existing root-owned `minio_data` volumes writable.
  - [ ] Lot gate: CI E2E jobs pass `up-e2e` with no new failure vs main.

- [ ] **Lot N — Final validation**
  - [ ] Final gate step 1: create PR using `BRANCH.md` text as PR body.
  - [ ] Final gate step 2: verify branch CI on that PR.
  - [ ] Final gate step 3: once CI is `OK`, commit removal of `BRANCH.md` and push.
