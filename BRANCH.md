# Feature: Release train 2026-11-04 (integration lane, wagons D + B, then A + C)

## Objective
Integrate the wagon branches into one release branch with `--no-ff` merges in order D, B (then A, C when they land), assign package versions once, regenerate the integration-owned files once through make, and open exactly one READY PR with one CI.

## Scope / Guardrails
- Scope limited to the union of wagons D (`fix/mcp-terminal-jsonrpc-response`) and B (`feat/share-g2-mcp-tools`); wagons A (`feat/artifacts-files-parity-lot1`) and C (`feat/reader-consent-persistent`) join only when green on their own branches, before the conductor calls departure.
- Merge order: D first, then B, each with `git merge --no-ff`; conflicts resolved as UNION.
- The integration lane owns versions, CHANGELOG entries, locks, the APP-P1 pin, cluster-mesh fixtures and the L5 manifest: on conflict take either side, then REGENERATE once at the end through make.
- Versions: `@sentropic/artifacts` 0.2.13, `@sentropic/mcp-platform` 0.4.2 (verified free on the registry through a repo make target, never npm on the host).
- Pre-existing MCP tool definitions stay byte-identical (tools/list snapshot must pass).
- Make-only workflow, no direct Docker commands; Docker under `flock /home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md` taken PER COMMAND (never nested, never a held shell).
- Tests on `ENV=test-train` (always LAST argument), never `ENV=dev`; every lane ends with `make down-volumes ENV=test-train`.
- No `[skip ci]` in any commit; CI budget: one run on the final head; never `gh run rerun`.
- Never merge `main` into this branch; future updates go through `git rebase` only if the conductor orders it.
- All new text in English.
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/mcp-platform/**`
  - `packages/mcp-broker/package.json`
  - `packages/artifacts/**`
  - `api/src/services/mcp/registry-dispatch.ts`
  - `api/src/services/mcp/cluster-registry.ts`
  - `api/tests/api/registry-dispatch-terminal.test.ts`
  - `api/tests/api/app-mcp-registry.test.ts`
  - `api/tests/api/app-mcp-installed.test.ts`
  - `api/tests/api/artifacts-host-publication.test.ts`
  - `api/tests/api/app-artifacts-transport.test.ts`
  - `api/tests/api/artifacts-host-credentials.test.ts`
  - `package-lock.json` (TR01-EX2, version lines only)
  - `api/package-lock.json` (TR01-EX2, `file:` link lines only)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json` (TR01-EX3)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json` (TR01-EX3)
  - `packages/cluster-mesh/tests/packaging/artifacts-tuple.spec.ts` (TR01-EX3)
  - `tools/memory-mcp-l5/artifacts/**` (TR01-EX5, P1 manifest regen)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
  - `api/**`, `ui/**`, `e2e/**`, `apps/**`, `deploy/**` except the Allowed files above
  - `packages/**` other than `packages/artifacts/**`, `packages/mcp-platform/**` and the TR01-EX3 files above
- **Exception process**:
  - Declare exception ID `TRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.

## Feedback Loop
- TR01-EX2 (lock pins): the 0.2.13 + 0.4.2 union changes workspace version lines, so root `package-lock.json` entries are refreshed through `make lock-root` (version lines only) and the two `../packages/*` version lines in `api/package-lock.json` are synced (same targeted one-line syncs as #878 BRP0B-EX1). No dependency graph change. Rollback: revert the lock lines with the version fix.
- TR01-EX3 (cluster-mesh packaging fixture re-pin): the `selected` fixture must pin both workspace candidate versions exactly (artifacts 0.2.13, mcp-platform 0.4.2). Re-pin through `make -f packages/cluster-mesh/packaging.mk refresh-lazy-package-lock` with the packed sibling receipts, never hand-editing integrities. Rollback: revert the fixture files to the origin/main pins.
- TR01-EX5 (memory-l5 P1 manifest): every lock change requires regenerating the P1 manifest through `make memory-l5-pack STAGE=pre-candidate ARTIFACT_MANIFEST=tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json`; previous manifest+sidecar retained in `artifacts/history/`. Rollback: restore the retained history manifest/sidecar and delete the new snapshot.
- TR01-EX6 (APP-P1 pin): the shipped profile digest and manifest digest in `api/src/services/mcp/cluster-registry.ts` are recomputed through make after the union; pre-existing tool selection unchanged. Rollback: restore origin/main digests.
- Wagon watch: A (`feat/artifacts-files-parity-lot1`, local worktree `tmp/worktrees/files-parity-lot1`) and C (`feat/reader-consent-persistent`, local worktree `tmp/worktrees/reader-consent`) have no remote heads yet; re-check `git ls-remote origin` every 10 minutes and merge only green heads before departure; a wagon not green at departure is DETACHED to the next train.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.
- This lane adds no AI-generation path; no AI flaky tests expected.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single integration branch, single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: one integration branch merging ready wagon heads; wagons were built and tested on their own branches.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- No UI surface changes in wagons D + B; UAT = package suites + scoped api lanes + CI. No browser UAT for this train.
- Execution flow (mandatory):
  - Develop and run tests in `tmp/worktrees/train-1104`.
  - Push branch before CI.
  - No root-workspace UAT needed (no app surface changed).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `.tmp/packets/COMMON-RULES.md`, `.tmp/release-train/TRAIN-2026-11-05.md` (incl. REVISION section).
  - [x] Create isolated worktree `tmp/worktrees/train-1104` on branch `release/train-2026-11-04` from `origin/main` (HEAD 3dd7d8012); copy root `.env`.
  - [x] Verify wagon heads: D `origin/fix/mcp-terminal-jsonrpc-response` = 4e47903bd; B `origin/feat/share-g2-mcp-tools` = ead444fab; A and C have no remote heads yet (local lanes in progress).
  - [x] Verify neither wagon touches `.track` (union-safe, no reseal needed).
  - [x] Confirm command style: `flock /home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md make … ENV=test-train` with `ENV` last, one lock per make command, never nested.
  - [x] Confirm scope boundaries declared above (TR01-EX2/EX3/EX5/EX6).
  - [x] Environment mapping: `ENV=test-train` for every test lane; no custom ports (disposable compose services per make target).
- [x] **Lot 1 — Merge wagon D (`fix/mcp-terminal-jsonrpc-response` @ 4e47903bd)**
  - [x] `git merge --no-ff origin/fix/mcp-terminal-jsonrpc-response`; resolve conflicts as UNION (`BRANCH.md` keeps this train doc; only BRANCH.md conflicted).
  - [x] Lot gate: `git status --short` shows only wagon-D paths plus owned files.
- [x] **Lot 2 — Merge wagon B (`feat/share-g2-mcp-tools` @ ead444fab)**
  - [x] `git merge --no-ff origin/feat/share-g2-mcp-tools`; resolve conflicts as UNION (BRANCH.md + L5 manifest + sha: ours; locks auto-merged).
  - [x] Lot gate: both wagon tips are ancestors of HEAD (`git merge-base --is-ancestor`).
- [x] **Lot 3 — Versions + regeneration ONCE through make**
  - [x] Registry check through a repo make target (Docker-based `qualify-published-install` probes with a published-version positive control): artifacts 0.2.13 free, mcp-platform 0.4.2 free (controls 0.2.12/0.4.1 confirmed published).
  - [x] Keep `packages/artifacts/package.json` at 0.2.13 and `packages/mcp-platform/package.json` at 0.4.2; CHANGELOG entries list wagons D and B.
  - [x] `make lock-root`, `make lock-api` (+ targeted `file:` syncs) (TR01-EX2): both no-diff, union already correct; `lock-api` needed the test-train api stack (ports 8789/5176/1082, 1080 left to wagon C).
  - [x] Cluster-mesh `selected` fixture re-pin through `packaging.mk refresh-lazy-package-lock` (TR01-EX3): no-diff; sibling receipts recollected at train HEAD (artifacts 0.2.13 sha256 844fdaaa, mcp-platform 0.4.2 sha256 f9b3b3c1, both byte-identical to wagon packs); tarball sha512 == spec == fixture lock.
  - [ ] APP-P1 pin recompute through make (TR01-EX6): verified in Lot 4 api pin tests.
  - [x] `make memory-l5-pack STAGE=pre-candidate …` + `make memory-l5-verify` (TR01-EX5): live f0e00f5d archived to `history/`, new manifest 7514ac8d (2 archives, 44 contracts), verify ok (30 files, 54 edges).
  - [ ] Lot gate: `make scope-check` PASS C2 before any commit.
- [ ] **Lot 4 — Final validation**
  - [ ] Typecheck & lint for touched packages.
  - [ ] Scoped wagon lanes with `ENV=test-train` LAST: `test-mcp-platform` (+ scoped `hono.test.ts`), scoped api registry lane, `test-artifacts` (+ scoped share-g2 files), `test-artifacts-integration`, `test-lazy-package` / packaging lane, tools-list snapshot PASS (pre-existing definitions byte-identical).
  - [ ] AI flaky tests run (non-blocking only under acceptance rule) and status/signature in `BRANCH.md`.
  - [ ] `make down-volumes ENV=test-train` last.
- [ ] **Lot 5 — PR + report**
  - [ ] Atomic commits via `make commit MSG="…"` (≤150 lines each, specific `git add` only, BRANCH.md checkboxes updated in the same commits); `make scope-check` before every commit; no AI trailers; no `[skip ci]`.
  - [ ] Push `release/train-2026-11-04` to origin; open ONE READY PR « release train 2026-11-04 » with wagon list; exactly one CI run on the final head; do NOT merge.
  - [ ] Report PR number and each step to `.tmp/rv/train-integration.md` (root workspace).
- [ ] **Lot 6 — Wagons A + C watch**
  - [ ] Re-check remote heads every 10 minutes; merge a wagon only when green on its own branch; re-assign versions and regenerate ONCE more per joining wagon.
  - [ ] Stop adding wagons once the conductor calls departure.
