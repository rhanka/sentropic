# Feature: Release train 2026-11-04 (integration lane, wagons D + B + A + C)

## Objective
Integrate the wagon branches into one release branch with `--no-ff` merges in order D, B, A, C, assign package versions once, regenerate the integration-owned files once through make, and open exactly one READY PR with one CI.

## Scope / Guardrails
- Scope limited to the union of wagons D (`fix/mcp-terminal-jsonrpc-response`), B (`feat/share-g2-mcp-tools`), A (`feat/artifacts-files-parity-lot1` @ 238a3ff5d) and C (`feat/reader-consent-persistent` @ d8df0daa1); all four merged, departure called.
- Merge order: D first, then B, then A, then C, each with `git merge --no-ff`; conflicts resolved as UNION.
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
  - `packages/cluster-mesh/tests/integrations/artifacts-surface.spec.ts` (TR01-EX8, SPEC_TOOLS union only)
  - `packages/artifacts/probe/packed-consumer.mjs` (TR01-EX8, EXPECTED_TOOLS union only)
  - `api/src/services/artifacts/host-storage.ts` (TR01-EX8, 0008 asset pin + relations only)
  - `api/src/services/artifacts/reader-consent.ts`, `api/src/services/artifacts/composition.ts`, `api/src/services/artifacts/instance.ts` (TR01-EX8, wagon C binding union)
  - `api/src/routes/namespaces/artifacts.ts`, `api/src/routes/namespaces/resources-module.ts` (TR01-EX8, wagon C routes union)
  - `api/tests/api/artifacts-reader-consent.test.ts` (TR01-EX8, wagon C test)
  - `Makefile` (TR01-EX7, wagon A presigner dep-sync lines only), `scripts/ci/tool-locks.json` (TR01-EX7, append-only presigner entries), `packages/cluster-mesh/tests/storage/cold-workspace.sh` (TR01-EX7, one-line presigner install)
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
- TR01-EX7 (wagon A mechanical sync, inherited union): `Makefile` presigner dep-sync lines on the artifacts lanes only, append-only presigner entries in `scripts/ci/tool-locks.json`, one-line presigner install in `packages/cluster-mesh/tests/storage/cold-workspace.sh`; no other lane touched. Rollback: revert those hunks to the D+B state.
- TR01-EX8 (wagons A+C tool-union wiring): `EXPECTED_TOOLS` (probe) and `SPEC_TOOLS` (mesh surface spec) extended to the 21-name union in capability order; 0008 migration asset pin + `reader_consents`/`reader_consent_events` relations in `host-storage.ts`; wagon C api binding/routes/test union. Pre-existing tool selection and definitions unchanged. Rollback: restore the D+B pins and drop the C api files.
- Wagon watch: CLOSED. A (`feat/artifacts-files-parity-lot1` @ 238a3ff5d) merged with `--no-ff` (union), then C (`feat/reader-consent-persistent` @ d8df0daa1) merged with `--no-ff` (union). Both wagon tips are ancestors of HEAD. Departure called: no more wagons join this train.

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
- No UI surface changes in wagons D + B + A + C (C lot 1a is package + thin api binding, no screen); UAT = package suites + scoped api lanes + CI. No browser UAT for this train.
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
- [x] **Lot 4 — Final validation (all on `ENV=test-train`, LAST)**
  - [x] Typecheck & lint: `typecheck-mcp-platform` PASS, `typecheck-artifacts` PASS, `lint-artifacts` PASS.
  - [x] Scoped lanes: `test-mcp-platform SCOPE=tests/hono.test.ts` 21 passed; `test-api-unit` (registry-dispatch-terminal + app-artifacts-transport + artifacts-host-credentials) 49 passed; `test-artifacts SCOPE=tests/share-g2-tools.test.ts` 6 passed; `SCOPE=tests/share-g2-errors.test.ts` 6 passed; `SCOPE=tests/tools-list-snapshot.test.ts` 1 passed (pre-existing definitions byte-identical).
  - [x] Pin lane: `test-api-endpoints` (app-mcp-registry + app-mcp-installed + artifacts-host-publication) 44 passed → APP-P1 digests unchanged, TR01-EX6 verified, no re-pin.
  - [x] Full suites: `test-mcp-platform` 363 passed; `test-artifacts` 556 passed (53 files); `test-artifacts-integration` green (exit 0, 14 files); `test-lazy-package` 135 passed (16 files, sibling receipts recollected at train HEAD, byte-identical tarballs).
  - [x] No UI surface, no E2E, no AI-generation path in wagons D/B: full suites + AI shards run in the PR CI.
  - [x] `make down-volumes ENV=test-train` last (stack + volumes removed, no test-train containers left).
- [ ] **Lot 8 — CI run 41809308029 fence gap (union-only, deterministic, not flaky)**
  - [x] New head green on `validate-artifacts` + `validate-cluster-mesh` (union fixes confirmed); `test-api-unit-integration (endpoints, 2)` failed on `root-mount-fence-completeness`: wagon C routes `/resources/artifacts/reader-consents{,/revoke,/revoke-all,/admin-revoke}` registered but missing from `RESOURCE_PATHS` fence + `IMMUTABLE_ARTIFACT_ROUTES` pin (C lane never ran that file; no E502 flake, never a rerun).
  - [x] Fix: extend `RESOURCE_PATHS` (`api/src/routes/namespaces/resources.ts`) and both immutable pins (`root-mount-fence-completeness`, `cluster-mesh-resources` inventory) with the 4 routes in mount order; wildcard `/resources/artifacts/*` fence already covers method wiring.
  - [ ] Validate `root-mount-fence-completeness` + `cluster-mesh-resources` on `ENV=test-train`, commit, push, watch the single new CI run.
- [ ] **Lot 5 — PR + report**
  - [x] Atomic commits via `make commit MSG="…"` (specific `git add` only, BRANCH.md checkboxes updated in the same commits); `make scope-check` PASS C2 before every commit; no AI trailers; no `[skip ci]`.
  - [ ] Push `release/train-2026-11-04` to origin; update body of PR #911 to list wagons A, B, C, D (body = this BRANCH.md); comment PR #910 as superseded by #911 and close it; exactly one CI run on the final head; do NOT merge #911 (conductor merges after review).
  - [ ] Report every step and every CI run id to `.tmp/rv/train-fix.md` (root workspace).
- [x] **Lot 6 — Wagons A + C watch: CLOSED**
  - [x] A (`feat/artifacts-files-parity-lot1` @ 238a3ff5d) merged with `--no-ff` (union conflicts resolved, no markers left); then C (`feat/reader-consent-persistent` @ d8df0daa1) merged with `--no-ff` (union conflicts resolved, no markers left).
  - [x] Departure called by owner (MAX PRIORITY: ONE train PR shipped now); no more wagons join this train.
- [x] **Lot 7 — A+C union fixes + regeneration ONCE + validation (all on `ENV=test-train`, LAST)**
  - [ ] Root causes from CI logs: train `validate-artifacts` probe `tool name mismatch` (B tools vs 17-name EXPECTED_TOOLS) + `validate-cluster-mesh (source installed major)` SPEC_TOOLS 17 vs 19 (+`artifacts_lookup_people`, `artifacts_list_access`); wagon A same probe cause + stale fixture lock (0.2.12 vs 0.2.13) + SPEC_TOOLS 17 vs 18 (+`artifacts_publish_bundle`). No npm E502 flake in any CI log: real mismatches, fixed in the union, never a rerun. Local E502 on the 127.0.0.1 mirror during refresh traced to stale sibling receipts (unpublished 0.2.13 unresolvable); receipts recollected at union HEAD via repo make flow, refresh then green.
  - [x] Union fixes: probe EXPECTED_TOOLS + mesh SPEC_TOOLS extended to the 21-name union (capability order: 17 + 2 B + 1 A + 1 C); probe css bytes made valid UTF-8 (LOT 1 commit validation); train-numbered migration `0008_reader_consent.sql` + host-storage pin/relations; stale wagon-local test assumptions evolved to the union (files-parity 17+4 pin, reader-consent-world duplicate `set_access` op); CHANGELOG 0.2.13 entries for A and C; versions stay 0.2.13 / 0.4.2 (A+C touch neither mcp-platform nor cluster-mesh versions).
  - [x] Regenerated ONCE through make: `make lock-root` no-diff, `api/package-lock.json` verified in sync (`file:` links + presigner entries, no stack change), `refresh-lazy-package-lock` 1-line integrity re-pin + tuple spec sync, APP-P1 digests verified unchanged on the union (pin tests green, no re-pin), `make memory-l5-pack STAGE=pre-candidate …` (7514ac8d archived, new 7443fd03) + `make memory-l5-verify` ok (30 files, 54 edges).
  - [x] Lot gate: typecheck-artifacts + lint-artifacts + typecheck-mcp-platform + typecheck-api green; scoped lanes of all four wagons on `ENV=test-train` (D: registry-dispatch-terminal 16; B: share-g2 6+6, sharing-management 8, mcp-platform 363; A: files-parity 7, uploads 6, http-uploads-templates 15, migration proof in integration 42; C: reader-consent 5+5+4, api reader-consent 3, host-migrations 16; transport 8, credentials 25, pin lane 27, publication 17; full test-artifacts 579, integration 42+42+29, lazy-package 135, mesh surface 21, probe PACKED_*_OK); tools/list snapshot pre-existing definitions unchanged; `make scope-check` PASS C2 before commit.
  - [x] `make down-volumes ENV=test-train` last (stack + volumes removed, no test-train containers left).
