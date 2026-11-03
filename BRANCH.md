# Fix: libexpat CVE-2026-117610 / CVE-2026-118370 in e2e and ui container images

## Objective
Upgrade the Alpine package libexpat from vulnerable 2.9.0-r0 to the patched 2.10.0-r0 in every affected Dockerfile, so the `security-container-e2e` and `security-container-ui` CI lanes (and the `security-container` join) go green again. Alpine v3.24 ships libexpat 2.10.0-r0 (fixed version per Trivy) since 2026-11-02; no vulnerability-register exception is needed.

## Scope / Guardrails
- Scope limited to `e2e/Dockerfile`, `ui/Dockerfile` and this `BRANCH.md`.
- Make-only workflow; every Docker build runs under the single flock lock `.tmp/packets/DOCKER-LOCK.md`, one build at a time, `make down ENV=test-libexpat` after.
- `ENV=test-libexpat` always last argument; never `ENV=dev`; never `make clean-all`.
- Build only the e2e and ui images (disk is tight); api and api-tool images are unchanged and already pass their scans.
- All new text in English. No `[skip ci]` anywhere.
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `e2e/Dockerfile`
  - `ui/Dockerfile`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.github/workflows/**`
  - `.security/**` (no register exception needed: patched package exists)
  - `api/Dockerfile` (api image scan passes: Alpine 3.23.7, no findings)
  - everything else
- **Conditional Paths**: none.
- **Exception process**: not needed (no forbidden path touched).

## Feedback Loop
- None.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single two-file fix, one CI run)
- Rationale: one logical change (libexpat pin) across the two affected images; no sub-workstreams.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/security.md`, `.tmp/packets/COMMON-RULES.md`.
  - [x] Read CI job logs (run 41566759161 jobs 125691683453 / 125690566305 + PR run 41570443679 ui/e2e jobs): e2e and ui images carry libexpat 2.9.0-r0, HIGH CVE-2026-117610 + CVE-2026-118370, FixedVersion 2.10.0-r0.
  - [x] Verify patched package exists: pkgs.alpinelinux.org v3.22/v3.23/v3.24 main + edge all ship libexpat 2.10.0-r0 (built 2026-11-02).
  - [x] Create worktree `tmp/worktrees/fix-libexpat` from `origin/main`, branch `fix/libexpat-cve-2026-11`.
  - [x] Confirm command style: `make ... ENV=test-libexpat` with ENV last.
- [ ] **Lot 1 — libexpat pin in affected Dockerfiles**
  - [ ] Pin `libexpat=2.10.0-r0` in `e2e/Dockerfile` (existing pinned `apk add` line).
  - [ ] Refresh stale `chromium`/`chromium-headless-shell` pins 155.0.8059.84-r0 → 156.0.8078.79-r0 in the same line: 155 left the Alpine v3.24 repo (verified in APKINDEX), so the forced e2e rebuild cannot resolve otherwise. ffmpeg 8.1.3-r0 / libcrypto3+libssl3 3.5.9-r0 pins are still current.
  - [ ] Pin `libexpat=2.10.0-r0` in `ui/Dockerfile` production stage (existing `apk update && apk upgrade` line).
  - [ ] Build e2e image under the single Docker lock: `flock .tmp/packets/DOCKER-LOCK.md make build-e2e ENV=test-libexpat`.
  - [ ] Build ui production image under the lock: `flock .tmp/packets/DOCKER-LOCK.md make build-ui-image ENV=test-libexpat`.
  - [ ] Prove: `flock .tmp/packets/DOCKER-LOCK.md make test-e2e-security-container test-ui-security-container ENV=test-libexpat` (both must pass compliance).
  - [ ] Cleanup: `make down ENV=test-libexpat`.
  - [ ] Lot gate: `make scope-check` before commit.
- [ ] **Lot 2 — Commit, PR, one CI run**
  - [ ] `git add e2e/Dockerfile ui/Dockerfile BRANCH.md` then `make commit MSG="fix(security): pin Alpine libexpat 2.10.0-r0 in e2e and ui images"`.
  - [ ] Push `fix/libexpat-cve-2026-11`, open READY PR (BRANCH.md as body).
  - [ ] Exactly one CI run on the PR head; record result.
- [ ] **Lot 3 — Report**
  - [ ] Write `.tmp/rv/fix-libexpat.md` (path taken, evidence, CI result). Do not merge.

## AI Flaky tests
- Not applicable (no test-code change).

## UAT Management (in orchestration context)
- Not applicable (infra-only change; container scans are the acceptance gate).
