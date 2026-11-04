# Feature: Release train N+1 (integration lane, wagons E + F)

## Objective
Integrate the wagon branches into one release branch with `--no-ff` merges in order E then F, assign package versions once, regenerate the integration-owned files once through make, and open exactly one READY PR with one CI.

## Scope / Guardrails
- Scope limited to the union of wagons E (`chore/ci-ai-tests-scoped` @ fe78bfcbf, AI test shards scoped to AI-relevant path changes + async-wait root-cause fix) and F (`feat/artifacts-sqlite-u1` @ 0d4acee17, h2a artifacts durable local SQLite adapter U1); both merged, departure called.
- Merge order: E first, then F, each with `git merge --no-ff`; conflicts resolved as UNION.
- The integration lane owns versions, CHANGELOG entries, locks, the APP-P1 pin, cluster-mesh fixtures and the L5 manifest: on conflict take either side, then REGENERATE once at the end through make.
- Versions: `@sentropic/artifacts` 0.2.14 (stays in 0.2.x: cluster-mesh pins peer `>=0.2.0 <0.3.0`); no other package bumped unless touched.
- Pre-existing MCP tool definitions stay byte-identical (tools/list snapshot must pass).
- Make-only workflow, no direct Docker commands; Docker through `/home/antoinefa/src/sentropic/.tmp/packets/docker-slot.sh make … ENV=test-train-next` (one slot per command, never nested).
- Tests on `ENV=test-train-next` (always LAST argument), never `ENV=dev`; the lane ends with `make down-volumes ENV=test-train-next`.
- No `[skip ci]` in any commit; CI budget: one run on the final head; never `gh run rerun` (fresh pull_request run via a new commit instead).
- Never merge `main` into this branch; future updates go through `git rebase` only if the conductor orders it.
- All new text in English.
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `.github/workflows/ci.yml` (TN01-EX9, wagon E scoped AI shards)
  - `scripts/ci/ci-expected-results.test.mjs` (TN01-EX9, wagon E expected-results sync)
  - `api/tests/ai/initiative-generation-async.test.ts` (TN01-EX9, wagon E root-cause wait fix)
  - `packages/artifacts/**` (wagon F sqlite adapter set + 0.2.14 version normalization)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json` (TN01-EX3)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json` (TN01-EX3)
  - `packages/cluster-mesh/tests/packaging/artifacts-tuple.spec.ts` (TN01-EX3)
  - `api/src/services/mcp/cluster-registry.ts` (TN01-EX6, APP-P1 pin only)
  - `api/tests/api/app-mcp-installed.test.ts` (TN01-EX6, pin digest only)
  - `api/tests/api/app-mcp-registry.test.ts` (TN01-EX6, pin digest only)
  - `package-lock.json` (TN01-EX2, version lines only)
  - `api/package-lock.json` (TN01-EX2, `file:` link lines only)
  - `tools/memory-mcp-l5/artifacts/**` (TN01-EX5, P1 manifest regen)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `packages/cluster-mesh/package.json`
  - `packages/cluster-mesh/src/modules/catalog.ts`
  - `api/**`, `ui/**`, `e2e/**`, `apps/**`, `deploy/**` except the Allowed files above
  - `packages/**` other than `packages/artifacts/**` and the TN01-EX3 files above
- **Exception process**:
  - Declare exception ID `TNxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.

## Feedback Loop
- TN01-EX2 (lock pins): the 0.2.14 union changes workspace version lines, so root `package-lock.json` entries are refreshed through `make lock-root` (version lines only) and the `../packages/*` version lines in `api/package-lock.json` are synced. No dependency graph change. Rollback: revert the lock lines with the version fix.
- TN01-EX3 (cluster-mesh packaging fixture re-pin): the `selected` fixture must pin the workspace candidate version exactly (artifacts 0.2.14). Re-pin through `make -f packages/cluster-mesh/packaging.mk refresh-lazy-package-lock` with the packed sibling receipts, never hand-editing integrities. Rollback: revert the fixture files to the origin/main pins.
- TN01-EX5 (memory-l5 P1 manifest): every lock change requires regenerating the P1 manifest through `make memory-l5-pack STAGE=pre-candidate ARTIFACT_MANIFEST=tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json`; previous manifest+sidecar retained in `artifacts/history/`. Rollback: restore the retained history manifest/sidecar and delete the new snapshot.
- TN01-EX6 (APP-P1 pin): the shipped profile digest and manifest digest in `api/src/services/mcp/cluster-registry.ts` are recomputed through make after the union; pre-existing tool selection unchanged. Rollback: restore origin/main digests.
- TN01-EX9 (wagon E CI scoping): `.github/workflows/ci.yml` AI-shard path filter, `ci-expected-results.test.mjs` sync and the `initiative-generation-async` deterministic-wait fix (BR02-EX3 on the wagon branch) are taken as the wagon union; the integration lane amends nothing there except conflict union. Rollback: revert those hunks to origin/main.
- Wagon watch: OPEN until the single train CI is green, then wagons E and F are commented as superseded and closed.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.
- Owner rule for this train: the AI tests must pass green at least once; `initiative-generation-async` / `executive-summary-sync` flakiness fixed at the root on wagon E (deterministic waits on real conditions, isolation, capped retry only on a provider rate limit), never masked by longer timeouts.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single integration branch, single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: one integration branch merging ready wagon heads; wagons were built and tested on their own branches.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- No UI surface changes in wagons E + F; UAT = package suites + scoped api lanes + CI. No browser UAT for this train.
- Execution flow (mandatory):
  - Develop and run tests in `tmp/worktrees/train-next`.
  - Push branch before CI.
  - No root-workspace UAT needed (no app surface changed).

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `.tmp/packets/COMMON-RULES.md`.
  - [x] Create isolated worktree `tmp/worktrees/train-next` on branch `release/train-next` from `origin/main` (HEAD fa7199852).
  - [x] Verify wagon heads: E `chore/ci-ai-tests-scoped` = fe78bfcbf; F `feat/artifacts-sqlite-u1` = 0d4acee17; neither touches `.track`.
  - [x] Confirm command style: `/home/antoinefa/src/sentropic/.tmp/packets/docker-slot.sh make … ENV=test-train-next` with `ENV` last, one slot per make command, never nested.
  - [x] Confirm scope boundaries declared above (TN01-EX2/EX3/EX5/EX6/EX9).
  - [x] Environment mapping: `ENV=test-train-next` for every test lane; no custom ports (disposable compose services per make target).
- [ ] **Lot 1 — Merge wagon E (`chore/ci-ai-tests-scoped` @ fe78bfcbf)**
  - [ ] `git merge --no-ff chore/ci-ai-tests-scoped`; resolve conflicts as UNION (`BRANCH.md` keeps this train doc).
  - [ ] Lot gate: `git status --short` shows only wagon-E paths plus owned files.
- [ ] **Lot 2 — Merge wagon F (`feat/artifacts-sqlite-u1` @ 0d4acee17)**
  - [ ] `git merge --no-ff feat/artifacts-sqlite-u1`; resolve conflicts as UNION.
  - [ ] Normalize 0.3.0 to 0.2.14 (`packages/artifacts/package.json`, `ARTIFACTS_PROVIDER_VERSION`, CHANGELOG heading); keep main's cluster-mesh `0.26.0-dev.8` and peer range `>=0.2.0 <0.3.0`.
  - [ ] Lot gate: both wagon tips are ancestors of HEAD (`git merge-base --is-ancestor`).
- [ ] **Lot 3 — Versions + regeneration ONCE through make**
  - [ ] Registry check through a repo make target: artifacts 0.2.14 free (0.2.13 confirmed published).
  - [ ] `make lock-root`, `make lock-api` (TN01-EX2) through docker-slot.sh.
  - [ ] Cluster-mesh `selected` fixture re-pin through `packaging.mk refresh-lazy-package-lock` (TN01-EX3).
  - [ ] APP-P1 pin recompute through make if the pin tests fail on the union (TN01-EX6).
  - [ ] `make memory-l5-pack STAGE=pre-candidate …` + `make memory-l5-verify` (TN01-EX5).
  - [ ] Lot gate: `make scope-check` PASS C2 before any commit.
- [ ] **Lot 4 — Final validation (all on `ENV=test-train-next`, LAST)**
  - [ ] Typecheck & lint: `typecheck-artifacts` + `lint-artifacts` + `typecheck-api` scoped lanes.
  - [ ] Scoped lanes: artifacts sqlite suites (conformance, export), cluster-mesh tuple/lazy-package specs, api pin tests (app-mcp-registry + app-mcp-installed), AI scoped lane (`initiative-generation-async` + `executive-summary-sync`).
  - [ ] Pre-existing MCP tool definitions byte-identical (tools/list snapshot lane).
  - [ ] `make down-volumes ENV=test-train-next` last (stack + volumes removed).
- [ ] **Lot 5 — PR + wagon closure + report**
  - [ ] Atomic commits via `make commit MSG="…"` (specific `git add` only, BRANCH.md checkboxes updated in the same commits); `make scope-check` PASS C2 before every commit; no AI trailers; no `[skip ci]`.
  - [ ] Push `release/train-next` to origin; open exactly one READY PR (body = this BRANCH.md); comment #908 and #891 as superseded by the train PR and close them; do NOT merge the train PR.
  - [ ] Report every step and every CI run id to `.tmp/rv/train-next.md` (root workspace).
- [ ] **Lot 6 — Single CI watch**
  - [ ] Watch the single PR CI; fix real failures at the root; if only the AI shards fail, retrigger with an empty commit, up to 3 times (owner-authorized).
