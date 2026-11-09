# Fix: compose-backup-owner (root-owned data/backup + workspace writers)

## Objective
- [ ] Fix the follow-up gap of merged PR #973 (fix/compose-host-user): no root-owned file is left on the host under data/backup and the workspace after backup/restore and docker writer targets run.
- [ ] Keep make db-backup / db-restore working with backups visible on the host, and run every workspace-writing docker run as the host user through one Makefile variable.

## Scope / Guardrails
- [ ] Worktree tmp/worktrees/compose-backup-owner on branch fix/compose-backup-owner from origin/main e0fde09 (rebased 09/11, BRANCH.md sole conflict kept via -X theirs), verified with git branch --show-current before any work.
- [ ] Test env ENV=test-compose-backup with API_PORT=8915 UI_PORT=5315 MAILDEV_UI_PORT=1215, ENV always last on make commands, never ENV=dev, never make clean-all, no Python.
- [ ] Make-only workflow, Docker through .tmp/packets/docker-slot.sh, one slot per command, never nested, make down-volumes ENV=test-compose-backup at the end.
- [ ] Atomic commits under 150 lines via make commit MSG="...", specific git add, no attribution trailer.
- [ ] All new text in English.
- [ ] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `Makefile`
  - `docker-compose.dev.yml` (only if verification forces a compose change; untouched so far)
  - `.tmp/rv/compose-backup-owner.md` (French verification report, untracked)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile` (covered by BRCBO-EX1 below)
  - `docker-compose*.yml` (covered by BRCBO-EX1 below)
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file, not needed here)
  - `.github/workflows/**` (not needed here)
- **Exception process**:
  - [ ] BRCBO-EX1 declared in ## Feedback Loop before touching any conditional/forbidden path.

## Feedback Loop
- [ ] BRCBO-EX1 (scope exception for Makefile + docker-compose*.yml, default-forbidden): rationale: PR #973 left postgres/minio bind-mount writes into ./data/backup root-owned and 9 workspace-writing docker runs without host user (verified audit: 370 docker run sites, 211 already host-user, 134 deletion-only, 16 others classified below); impact: Makefile-only behavior change (run writers as UID:GID, chown backup after pg_dump), no image/volume/data-layout change, backups stay host-visible bind-mount files; rollback: git revert the branch commits, ownership normalizes again on next backup run.
- [ ] Root-stay exceptions (verified, must stay root with reason): 134 pure rm -rf deletion-only docker runs (need root to delete legacy root-owned cruft, deletions create no files); chown normalizers Makefile 355/368/2547/1182 + new db-backup step (chown itself requires 0:0); :ro mounts (kernel read-only, cannot create host files); no-workspace-mount runs 672/780/2069/3078/3995 (no host write possible, 3078 output via host redirect); scanners 3929/3942-trivy/4025/4026 (scan-only, JSON via host-shell redirect); minio/minio-init user 0:0 kept (Chainguard uid 65532 vs pre-existing root-owned minio_data named volume, backup writes go through MINIO_EXEC as host user); test.yml api root default (no workspace bind, CI ephemeral).
- [ ] Already-compliant equivalence note: 167 docker run sites already pass literal -u "$$(id -u):$$(id -g)" -e HOME=/tmp, behaviorally identical to the new variable, left untouched for diff minimality.

## AI Flaky tests
- [ ] Acceptance rule: accept only non-systematic provider/network/model nondeterminism as flaky accepted, with same-commit same-command success evidence, never additive timeouts, user sign-off before merge.

## Orchestration Mode (AI-selected)
- [ ] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- [ ] Rationale: single small fix train (data/backup + writer variable), one PR, one CI.

## UAT Management (in orchestration context)
- [ ] **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- [ ] No UI change in this branch, no UAT required.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Worktree tmp/worktrees/compose-backup-owner on fix/compose-backup-owner from origin/main aa21ecdfd verified.
  - [x] Read rules/MASTER.md, rules/workflow.md, .tmp/packets/COMMON-RULES.md.
  - [x] Env mapping: ENV=test-compose-backup, API_PORT=8915, UI_PORT=5315, MAILDEV_UI_PORT=1215.
  - [x] Audit done: 370 docker run sites joined across continuations, 211 with -u, 134 pure rm, 9 writers fixed + db-backup chown (see Feedback Loop).
  - [x] BRCBO-EX1 declared before touching Makefile.
- [ ] **Lot 1 — data/backup ownership**
  - [x] db-backup: normalize ownership after pg_dump via compose run postgres as 0:0 with HOST_UID/HOST_GID chown on the new dump (existing 355/368 pattern).
  - [x] doc-backup/doc-backup-prod need no change (MINIO_EXEC already --user host-uid, Makefile 3761, tar runs on host).
  - [x] db-restore/doc-restore/db-backup-prod need no change (no host writes: cp into container, host mkdir/tar/redirect).
  - [x] minio user 0:0 kept (see Feedback Loop), no named-volume move.
  - [x] Lot gate: make db-backup 09/11 16:45 ENV=test-compose-backup exit 0, dump app-2026-11-09T16-45-27.dump stat antoinefa:antoinefa, find data -user root empty.
- [ ] **Lot 2 — DOCKER_RUN_USER variable**
  - [x] Define DOCKER_RUN_USER = -u $(UID):$(GID) -e HOME=/tmp once next to UID/GID exports (UID/GID from #973).
  - [x] Apply to Makefile 1259 (typecheck-llm-mesh), 1460 (--check), 1473 (audit versions), 1477 (typecheck-skills, ln -s writer), 1593 (typecheck-flow), 2881 (test-llm-mesh via ARTIFACTS_RUN), 2893 (bench-live-speech OUT= writer), 2989 (test-skills, ln -s + vitest writer), 3942 node-audit branch.
  - [x] Lot gate: grep shows every writable-workspace docker run uses the variable or the equivalent literal, exceptions listed in Feedback Loop only.
- [ ] **Lot 3 — Verification on ENV=test-compose-backup**
  - [x] Run make typecheck-llm-mesh API_PORT=8915 UI_PORT=5315 MAILDEV_UI_PORT=1215 ENV=test-compose-backup, find packages/llm-mesh -user root empty (PASS 09/11, exit 0, find empty).
  - [x] Run make typecheck-api API_PORT=8915 UI_PORT=5315 MAILDEV_UI_PORT=1215 ENV=test-compose-backup, find api -user root empty (PASS 09/11, exit 0, find count 0).
  - [x] Run make db-backup + db-restore BACKUP_FILE=app-2026-11-09T16-45-27.dump SKIP_CONFIRM=true API_PORT=8915 UI_PORT=5315 MAILDEV_UI_PORT=1215 ENV=test-compose-backup (both exit 0, 09/11), stat -c %U host-owned, find data -user root empty, find packages/llm-mesh + api/node_modules/.vite-temp -user root empty.
  - [ ] End with make down-volumes ENV=test-compose-backup.
- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint for impacted surface (Makefile/compose only, no src change, no package bump needed).
  - [ ] Final gate step 1: create PR from this BRANCH.md text, push fix/compose-backup-owner, iterate to green CI (no rerun, no skip).
  - [ ] Final gate step 2: French report in .tmp/rv/compose-backup-owner.md, no external review (conductor runs it), Do NOT merge.
