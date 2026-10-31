# Feature: APP-837-REBASE — rebase PR #837 onto main (replay 8)

## Objective
- [x] Rebase `feat/app-cm-integration` (PR #837) onto `origin/main` (`fb454cb4c`) per COMMON-RULES (`git rebase origin/main`, then `--force-with-lease` on this PR branch only), then fix the code/doc MINOR findings of review `pr837_large4_r1.md`.
- [x] Keep the schema/migration delta minimal (the W1 control host migration, renumbered to the post-A2-M0-MIG slot `0012` at idx 12, plus its journal entry) so APP-837-DUMP can regenerate the clean schema dump after A2-M0-MIG repairs `0007`–`0011`.
- [ ] One CI run on the final head; PR stays open; merge belongs to APP-837-MERGE.

## Scope / Guardrails
- [x] Worktree `tmp/pr-837`; branch `feat/app-cm-integration`; replay 7 from head `10d289560` (base `d08517ed1`) onto main `1b7f8ab94`; replay 8 from head `e99bd29fa` onto main `fb454cb4c`.
- [x] Make-only; Docker serialized under `.tmp/packets/DOCKER-LOCK.md` (plus the legacy `/home/antoinefa/.cache-tmp/sentropic-docker.lock`); `ENV=test-app-837` always last; `make down` after campaigns.
- [x] Local acceptance gates pass before the single push; zero WIP pushes; Post-Rebase Gate re-verified (no package source or manifest difference from main).
- [x] Atomic commits below 150 changed lines via `make commit`; selective staging; English only.
- [x] CI lockfile-lane policy acknowledged (review_by=2026-11-30T00:00:00Z); installs resolve committed tool profiles or frozen consumer closures.
- [x] No production activation, Python, AI trailers or destructive cleanup; no draft-state change; this author does not merge.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `.dockerignore`
  - `.github/workflows/**`
  - `Makefile`
  - `api/**`
  - `apps/**`
  - `deploy/**`
  - `docs/**`
  - `package-lock.json`
  - `scripts/**`
  - `spec/**`
  - `track/TRACK.md`
  - `packages/cluster-mesh/tests/packaging/activation-environment.ts`
  - `packages/cluster-mesh/tests/packaging/activation-vectors.spec.ts`
- [x] **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `packages/**` except the two activation test paths allowed by BR143-EX3
  - `plan/**`
  - `ui/**`
  - `e2e/**`
  - `.cursor/rules/**`
  - `.track/**`
- [x] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile`
  - `.github/workflows/ci.yml`
- [x] **Exception process**: BR143-EX1 covers the completed inherited merge only; BR143-EX2 covers topic workflow retirement and equivalent CI gates; BR143-EX3 covers the two activation test paths under `packages/**`. This lot adds no new exception.

## Feedback Loop
- [x] PR837-R7-1: rebase onto `origin/main 1b7f8ab94`. Conflicts at the initial plan patch (branch plan intent kept) and at `702185813` (canonical API image). The Makefile version-input block union retains main's `scripts/ci/locked-tools.mjs` and `scripts/ci/tool-locks.json` inputs, main's `chat-core` and `e2e/npm-toolchain` UI/E2E inputs, and adds `apps/artifact-content`; `ci.yml` keeps main's `scripts/ci/tool-locks.json` path filter plus `apps/artifact-content/**`; `api/Dockerfile` retains main's `npx --no-install` and locked-npm lines plus the artifact-content COPY/esbuild/dist lines; `.dockerignore` unions both sides. Lockfiles merge additively: main's pins retained, `file:../packages/artifacts` workspace link retained, no registry fallback. `BRANCH.md` ends deleted as at the pre-rebase head; this file re-adds the lot scope contract, and APP-837-MERGE branch-close removes it again on the final head.
- [x] PR837-R7-2: drizzle delta vs main verified exactly `A api/drizzle/control/0020_app_artifact_host.sql` plus one `_journal.json` entry (`0020_app_artifact_host`, idx 11, when 1791860000001; `0012_decision_host` bumped to idx 12). No stale schema dump hunks; APP-837-DUMP regenerates the restore smoke dump with zero drift after A2-M0-MIG.
- [x] PR837-R7-3: first final-head CI run `41093224667` failed the `validate-publishable-manifests` gate inherited from main's lock lane (run 41004444100 on `10d289560` predates it): four branch sites used unlocked npm resolution and `BRANCH.md` lacked the policy acknowledgment. Fixes mirror main's own patterns: `npx --no-install` for the `api/Dockerfile` content compile (same build stage as main's auth-idp `npx --no-install esbuild`) and for the in-container tsc/eslint, `scripts/ci/locked-tools.mjs` with the committed `yaml@2.8.1` tool profile (mounted `scripts/ci` read-only) for the bundle selftest, the matching `scripts/test-artifact-content-image.sh` grep assertion, and the acknowledgment line above. Second push and one CI run on the new final head, per the per-head CI budget. Local re-verification before the second push: `test-ci-lockfile-installs` 11/11, `check-eradicated-packages` PASS, `test-publishable-manifests` 103/103, `test-qualify-published-install` 9/9, candidate + qualification-DAG suites PASS, `check-publishable-manifests` with the real change classification (`cluster-mesh` BLOCK, packed, guard PASS sha256 a984b2fe), `test-artifact-content-manifests` 54/54, `test-artifact-content-image` static + identity PASS, `scope-check` C2 PASS.
- [x] PR837-R8-1: replay 8 onto `origin/main fb454cb4c` (main advanced with #855, #858, #844, #857). 196 commits replayed; one manual stop at the initial plan patch (`BRANCH.md`, branch version kept, per the packet); later `BRANCH.md` content merges resolve keep-branch through a worktree-local merge driver; `api/drizzle/control/meta/_journal.json`, `api/Dockerfile`, `Makefile`, `ci.yml` and lockfile hunks merge with main's authority retained (A2-M0-MIG renumbered control chain, api image dependency slimming, memory-mcp lane). Range-diff `1b7f8ab94..e99bd29fa` vs `fb454cb4c..8fad5cd53`: 192 equal / 3 changed (the three control-journal context repairs) / 1 old-only / 1 new-only (initial plan patch), SHA-256 `15fc6df44ad6bc5983210c6c11463969f066194f80a850854b762af5ec7b3ef1`, full output `.tmp/rv/pr837-replay8-full.txt`. Net diff vs main remains 140 files; Post-Rebase Gate: only the two BR143-EX3 test paths differ under `packages/**`, no package src/manifest change.
- [x] PR837-R8-2: main's #858 added `api/tests/unit/drizzle-journal-integrity.test.ts` (idx = array position, unique tags/prefixes, strictly increasing prefixes and `when`, journal/files consistent). A plain replay put `0020_app_artifact_host` at idx 11 before `0011_decision_host` (prefix regression), so the W1 migration is renumbered per the packet: SQL file renamed `0020` -> `0012_app_artifact_host.sql` (bytes unchanged, SHA-256 `510c8b931b6d57048d4f6400ab61de04b7bd116a56aa2b59f87af3e9d1570c98` preserved), journal entry moved to idx 12 with `when` advanced `1791860000001` -> `1793145600001` (strictly after `0011_decision_host`, required by the integrity test). Migration tests adapted: reserved/frontier synthetic witnesses move past the new slot (`0013_reserved_witness`, `0019_frontier_witness` at 1793200000000, idx 12) and receipt `created_at` assertions updated. No control snapshot exists for this migration (control meta snapshots stop at `0008`; product `0020_snapshot.json` belongs to `0020_add_comments` and is untouched). Live references updated: restore runbook, W0 reservations, BRANCH.md; the rehearsal receipt is renamed `migration-0012-rehearsal-20261030T044030Z.md` with a dated renumbering addendum (content hash unchanged; journal-row identity and application order vs `0011_decision_host` change; the exact dump no longer exists, so no same-dump re-run is possible).
- [x] PR837-R8-3: review `pr837_large4_r1.md` MINOR findings: (1) `apps/artifact-content/README.md` stale unlocked `npm exec` example corrected to the lock-compliant `npx --no-install tsc` form; (2) the manifest-context measurement is re-run on the final head instead of pre-fix head `98689e369`; findings 3-5 are merge-lane/verification-lane items (final-head consensus review/native approval, Antoine's product acceptance, reviewer-side CI JSON readability), not code or doc, and stay with their owners.

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
- Rationale: single existing PR branch; one rebase, one final local gate cycle, one CI run on the final head.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- This lot changes no UI behavior (rebase plus docs); UAT belongs to the integration gates already recorded on PR #837.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Worktree `tmp/pr-837` on `feat/app-cm-integration`; `.env` copied; `harness check branch` C1 PASS.
  - [x] Capture pre-replay-7 references: net diff vs main (140 files), PR body, journal delta, prior replay evidence.
- [x] **Lot 1 — Rebase onto origin/main (replay 7)**
  - [x] `git rebase origin/main`; resolve the two conflict stops (see PR837-R7-1).
  - [x] Verify the net file set is identical to the pre-rebase PR (140 files) and every union keeps main's authority.
  - [x] Post-Rebase Gate: no `packages/*/src/**` or `packages/*/package.json` difference from main, so no registry/version comparison is required.
- [x] **Lot 2 — Stale schema dump strip verification**
  - [x] Drizzle delta is exactly the reserved `0020` slot plus its journal entry (see PR837-R7-2).
- [ ] **Lot 3 — Replay 7 patch-equivalence evidence**
  - [x] `git range-diff --no-color d08517ed1..10d289560 1b7f8ab94..<head>`: 190 equal / 1 changed / 1 old-only / 1 new-only.
  - [x] Extend `docs/runbooks/app-cm-integration-review.md` with the replay 7 row and publish the full output from the PR.
  - [ ] Update the PR body N5 record to the exact final head and its completed/success CI run.
- [x] **Lot 4 — Local acceptance gates (ENV=test-app-837-rebase)**
  - [x] `make typecheck-auth-hono ENV=test-app-837-rebase` — exit 0, tsc clean.
  - [x] `make test-auth-hono ENV=test-app-837-rebase` — 43 test files, 239 tests passed.
  - [x] `make test-auth-ui ENV=test-app-837-rebase` — 8 test files, 54 tests passed.
  - [x] `make scope-check` — PASS C2 on every commit and on the clean final tree.
  - [x] `make down ENV=test-app-837-rebase` — no compose project was started by this lot; the down pass completes the campaign.
- [ ] **Lot 5 — Pushes and CI (per-head budget)**
  - [x] First `git push --force-with-lease origin feat/app-cm-integration` after Lot 4 green; head `98689e369`, CI run `41093224667` failed the inherited `validate-publishable-manifests` gate (see PR837-R7-3); failed head not re-run.
  - [x] Lock-compliance local battery green before the second push: `test-ci-lockfile-installs` 11/11, `check-eradicated-packages` PASS, `test-publishable-manifests` 103/103, `test-qualify-published-install` 9/9, candidate + qualification-DAG suites PASS, `check-publishable-manifests` with the real change classification (`cluster-mesh` BLOCK, packed, guard PASS), `test-artifact-content-manifests` 54/54, `test-artifact-content-image` static + identity PASS, `scope-check` C2 PASS.
  - [ ] Second `git push --force-with-lease` with the lock-compliance commit; one CI run on the new final head, completed/success including the gates named by the review (endpoints shard 2, chat lanes, security-container, validate-artifacts, validate-idp-sync, validate-publishable-manifests, ci-gate).
- [x] **Lot 6 — Replay 8 rebase, A2-M0-MIG renumbering, review r1 MINOR fixes (31 October)**
  - [x] `git rebase origin/main` onto `fb454cb4c`; `BRANCH.md` conflicts keep the branch version; unions keep main's authority (see PR837-R8-1).
  - [x] Renumber the W1 control migration to `0012_app_artifact_host` (idx 12, `when` 1793145600001); rename SQL file and rehearsal receipt; update live references and the migration tests (see PR837-R8-2).
  - [x] Fix the review r1 code/doc MINOR findings (see PR837-R8-3).
  - [x] Local targeted gates green before the single push: drizzle-journal-integrity, migration tests, `test-ci-lockfile-installs`, `test-artifact-content-manifests`, PR-touched api unit tests, final-head manifest-context measurement; Docker under the flock, `ENV=test-app-837` last, `make down` after.
  - [ ] Single `git push --force-with-lease` on this branch only; one CI run on the final head; report `.tmp/rv/837-rebase.md` records the head, run id and conclusion.
