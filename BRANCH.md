# fix(cluster-mesh): freeze common v1 module list (0.21.3)

## Objective
Replace the live root-lockfile equality in the P1 packed gate with a versioned fingerprint of the resolved P1 dependency and build-tool closure.

## Scope / Guardrails
- Scope limited to P1 pre-candidate pack/verify, manifest schema, and tooling tests.
- Make-only workflow, no direct Docker commands.
- Branch development in isolated worktree `tmp/worktrees/l5-p1-fingerprint`.
- Automated test campaigns on dedicated environment (`ENV=test-l5-fingerprint`), never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- Never run `make clean-all`.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `README.md` (BR710-EX10; merge-only, exact origin/main content)
  - `docs/governance/**` (BR710-EX10; merge-only, exact origin/main content)
  - `package.json`
  - `package-lock.json`
  - `packages/cluster-mesh/**` (BR710-EX11; merge-only, exact origin/main content)
  - `Makefile` (BR710-EX1-7 P1 changes; BR710-EX11 main-only CLUSTER_MESH_PEER_TOOLS pin)
  - `ui/package-lock.json`
  - `ui/package.json` (merge-only, exact origin/main DOMPurify pin)
  - `api/Dockerfile` (BR710-EX9; preserve the main Go 1.26.10 pin during integration)
  - `tools/memory-mcp-l5/lock-fingerprint.mjs`
  - `tools/memory-mcp-l5/lock-closure.mjs`
  - `tools/memory-mcp-l5/build-inputs.mjs`
  - `tools/memory-mcp-l5/precandidate.mjs`
  - `tools/memory-mcp-l5/pack.mjs`
  - `tools/memory-mcp-l5/schemas/artifact-manifest-v1.schema.json`
  - `tools/memory-mcp-l5/tests/**`
  - `tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json`
  - `tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json.sha256`
  - `tools/memory-mcp-l5/artifacts/history/**`
  - `tools/memory-mcp-l5/artifacts/archives/**`
  - `tools/memory-mcp-l5/artifacts/lock-snapshots/**`
  - `tools/memory-mcp-l5/artifacts/toolchain/**`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `packages/**`
  - `api/**`
  - `ui/**`
  - `e2e/**`
  - `.github/**`
  - `tools/memory-mcp-l5/receipt.mjs`
  - `tools/memory-mcp-l5/schema-validator.mjs`
  - `tools/memory-mcp-l5/schemas/checkpoint-v1.schema.json`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
- `attention`: BR710-EX11 — import PR 709 cluster-mesh files and its Makefile peer pin through the owner-authorized main merge. Reason: main advanced while CI ran. Impact: preserve upstream bytes exactly outside the branch P1 work. Rollback: revert the merge as a unit.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).
- `attention`: BR710-EX11 — import PR 709 cluster-mesh files and its Makefile peer pin through the owner-authorized main merge. Reason: main advanced while CI ran. Impact: preserve upstream bytes exactly outside the branch P1 work. Rollback: revert the merge as a unit.

## Feedback Loop
- `attention`: BR710-EX11 — import PR 709 cluster-mesh files and its Makefile peer pin through the owner-authorized main merge. Reason: main advanced while CI ran. Impact: preserve upstream bytes exactly outside the branch P1 work. Rollback: revert the merge as a unit.
- `attention`: BR710-EX10 — allow README.md and docs/governance/** imported by the owner-authorized merge of main (4138a0ecb, PR #711). Reason: preserve both branches while scope-checking the merge index. Impact: upstream content only, byte-identical to origin/main, no local edits. Rollback: revert the merge as a unit.
Actions with the following status should be included around tasks only if really required (cf. Task 1 feedback loop):
- subagent or agent requires support or informs: `blocked` / `deferred` / `cancelled` / `attention`
- conductor agent or human brings response: `clarification` / `acknowledge` / `refuse`
- `attention`: BR710-EX1 — pin `@types/node@22.20.1` in `Makefile` P1-producing targets and pass the committed lock sha to the packer (4 recipe tokens, bare `@types/node` and no provenance binding today).
- `attention`: BR710-EX2 — add `Makefile` target `lock-markdown-it-direct` (pinned sed bump 14.3.0/14.1.1→14.3.2, mirrors committed `lock-api-direct` precedent; full npm regen is ERESOLVE-blocked per the comment above that target).
  - Reason: remediate the CI-blocking markdown-it HIGH pair (GHSA-253c-mchw-3w2r fixed in 14.3.1, GHSA-r7fv-28h4-cvq7 fixed in 14.3.2) with registry-pinned integrity; dep ranges of 14.3.x are identical so the 3-line delta is exact.
  - Impact: root + ui locks resolve markdown-it 14.3.2; P1 closure untouched (no P1 regen).
  - Rollback: revert the target, the override, and the two lock hunks.
  - Reason: the P1 build toolchain installs an unpinned `@types/node` (floating `latest`); the fingerprint must bind the actual resolved toolchain deterministically (Astra R1 finding 2). Pin matches `packages/mcp-*/devDependencies ^22.10.10` and the lock nested resolution `22.20.1`. The `--head-lock-sha` provenance arg enforces generation from the committed lock (Astra R1 finding 3); host-shell evaluation matches the existing `--l5-head`/`--base` args since the pack container cannot read the worktree gitdir.
  - Impact: build `@types/node` becomes `22.20.1` instead of floating latest; `pack.mjs` refuses a dirty lockfile; `typecheck-*`/`test-*` targets untouched.
  - Rollback: revert the 3 tokens to bare `@types/node` and drop the `--head-lock-sha` arg.
- `attention`: BR710-EX3 — install the P1 build toolchain via `npm ci` from a committed union toolchain snapshot and add the explicit `memory-l5-toolchain-snapshot` regen target (3 recipe install tokens + 1 additive target).
  - Reason: Astra R2 finding 2 — the recipes fresh-install transitive ranges, so root-lock records describe a different installation (api-extractor 7.58.12 vs actual 7.58.9). One resolved toolchain record must be consumed by the producing build and checked by the verifier.
  - Impact: builds install the byte-identical locked tree (same direct pins `typescript@5.4.5 @types/node@22.20.1 @microsoft/api-extractor@7.58.9`); snapshot regen is explicit and reviewable; fingerprint v3 binds snapshot content plus spec satisfaction; all other targets untouched.
  - Rollback: revert the 3 install tokens to `npm install <specs>` and drop the snapshot target; keep or revert the `v3` modules with the snapshot files retained.
- `attention`: BR710-EX4 — remediate the NEW markdown-it advisories (GHSA-vfgh-jcmw-g37q low, GHSA-gfr2-rv44-r23c high; fixed in 14.3.3) with the same pinned-sed procedure as BR710-EX2 (root `overrides` 14.3.2→14.3.3, lock bumps in root + ui, integrity var + bump target).
  - Reason: CI audit-gate/SCA red on the R2 head (6 jobs plus `ci-gate`); the advisories were published after the last green run and are unrelated to the R2 diff (identical ui/api locks were green at `27a560ce4`).
  - Impact: markdown-it 14.3.2→14.3.3 in root + ui locks only; P1 closure untouched (no P1 regen — `memory-l5-verify` proves it).
  - Rollback: revert the override, both lock hunks, and the target/var.
- `attention`: BR710-EX5 — remediate the follow-redirects HIGH pair (GHSA-q3jh-wrc6-jgq8, GHSA-8r9p-f939-6h3c; fixed in 1.16.1) with the same pinned-sed procedure (root `overrides` pin, root lock hunk, integrity var + bump target).
  - Reason: CI `build-api-image` + `security-sast-sca` red on the post-EX4 head; the advisories were published mid-run (narrow `>=1.16.0 <1.16.1` range, single parent `centra ^1.15.6`); unrelated to the R2 diff.
  - Impact: follow-redirects 1.16.0→1.16.1 in the root lock only; P1 closure untouched (no P1 regen — `memory-l5-verify` proves it).
  - Rollback: revert the override, the lock hunk, and the target/var.
- `attention`: BR710-EX6 — remediate the vite launch-editor advisories (GHSA-587h-7wmj-h5pm HIGH incl. CVE-2026-112942, GHSA-698v-4r3x-3vcv medium, GHSA-r825-w8mm-5pxw medium; vite fixed in 7.3.7/8.2.4) with the same pinned-sed procedure (root + api lock hunks, integrity vars + bump target; no single-version override exists across the 7/8 lines so none is added).
  - Reason: CI `security-sast-sca` (api workspace, dev included) + `security-container` (api-tool image) red; advisories published 10/20, after the last green run; unrelated to the R2 diff.
  - Impact: vite 7.3.6→7.3.7 (root top) and 8.2.2→8.2.4 (root nested ×2, api nested ×1); ui/auth-idp vite copies untouched (their gates green, minimal diff); P1 closure untouched (no P1 regen — `memory-l5-verify` proves it).
  - Rollback: revert the lock hunks and the target/vars.
- `attention`: BR710-EX7 — add one effective-image equality guard line to each of the 3 P1-producing `Makefile` recipes plus the `memory-l5-pack` recipe (Astra R3 P1: execution-contract enforcement).
  - Reason: the finding's invocation-level repro (`make memory-l5-pack LLM_MESH_NODE_IMAGE=node:22 ...`) changes the effective image of every producing recipe without touching recipe text; the parser requires the guard and the fingerprint binds it, but only a recipe-executed equality test refuses the override before anything is produced.
  - Impact: 4 additive recipe lines; the guard only constrains values that override the makefile (`$(origin ...)` is `command line` or `environment override`) — those must equal the pin. Plain environment values are exempt (they carry make's own export plumbing to `$(MAKE)` sub-makes); makefile-internal values (`?=` default, target-scoped export) are untouched. An unconditional first version refused legitimate direct builds (CI `typecheck-lint-api`, `validate-artifacts`, `validate-mcp-platform` red); the origin-gated version restored them, and exempting plain environment restored the `probe-artifacts-packed-consumer` sub-make chain. The finding stays closed: the qualified pack path forces the pin over plain env via the target-scoped export, while command-line and `make -e` overrides are refused. All other targets untouched.
  - Rollback: drop the 4 guard lines and revert the parser's guard requirement with them.
- `attention`: BR710-EX9 — bump the `ci-esbuild` Go base image `1.26.9→1.26.10` (amd64 digest pin) in `api/Dockerfile` to remediate CVE-2026-111943 (Go stdlib HIGH, published mid-run; main red on the same `security-container` job).
  - Reason: CI `security-container` + `ci-gate` red on the post-merge head; the api-tool image embeds the Go 1.26.9 toolchain; Go 1.26.10 carries the stdlib fix; single pin site; unrelated to the branch diff.
  - Impact: api-tool image rebuilds on Go 1.26.10 (same Alpine 3.23, same esbuild pins); production target untouched (toolbox only).
  - Rollback: revert the FROM line.
- `attention`: BR710-EX8 — align the `ui/package-lock.json` markdown-it 14.3.3 record's dependency metadata to the published ranges (`entities ^4.5.0`, `linkify-it ^5.0.2`; Astra R3 non-blocking).
  - Reason: the 14.3.3 record still declares the 14.3.2 ranges (`^4.4.0`/`^5.0.0`) while the installed tree resolves entities 6.0.1 + linkify-it 5.0.2; metadata-only, resolved/integrity bytes untouched, satisfies both ranges.
  - Impact: 2 metadata tokens in the ui lock; installs reproducible (`npm ci` unaffected); P1 closure untouched.
  - Rollback: revert the 2 tokens.

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
- Rationale: single orthogonal fix, one test cycle, no sub-workstreams.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- UAT skipped: no UI changes in this branch.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, packet and proposal.
  - [x] Confirm worktree `tmp/worktrees/l5-p1-fingerprint` on branch `fix/l5-p1-lockfile-fingerprint`.
  - [x] Run `harness check branch`.
  - [x] Confirm ENV mapping: `ENV=test-l5-fingerprint` for all make runs, ports `API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725`.
  - [x] Validate scope boundaries (no EXn expected).
- [x] **Lot 1 — Fingerprint the P1 dependency and build-tool closure**
  - [x] Add `tools/memory-mcp-l5/lock-fingerprint.mjs` (`LOCK_FINGERPRINT_VERSION=1`, `computeLockFingerprint`, relevant-key projection).
  - [x] `precandidate.mjs`: compare pinned fingerprint against live lockfile instead of full-file sha equality; keep `declaredLockSha256` as provenance only.
  - [x] `pack.mjs`: pin `lockFingerprintVersion` + `lockFingerprint` in manifest source; retain `declaredLockSha256`.
  - [x] `schemas/artifact-manifest-v1.schema.json`: require versioned fingerprint in `manifestSource`; keep `declaredLockSha256`.
  - [x] Update `tests/p1-fixture.mjs`, `tests/artifact-manifest.test.mjs`, `tests/receipt-contract.test.mjs` fixtures for the new source fields.
  - [x] Lot gate: `make scope-check` before commit.
- [x] **Lot 2 — Fixtures and regression tests**
  - [x] Add `tests/lock-fingerprint.test.mjs`: unrelated lockfile edits pass, relevant dependency/build-input edits fail.
  - [x] Extend packed-gate coverage: unrelated lock edit passes, relevant lock edit fails, contract/archive drift still fails.
  - [x] Lot gate: `make memory-l5-tooling API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-l5-fingerprint`.
- [x] **Lot 3 — Regenerate P1, full gate, PR**
  - [x] Retain superseded manifest in `artifacts/history/` (content-sha name + sidecar).
  - [x] Rebuild dist and repack P1 via make targets.
  - [x] Verify archives unchanged, inventory still exact 44 contracts, sidecars valid.
  - [x] Lot gate: `make memory-l5-gate LOT=1 ARTIFACT_MANIFEST=tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-l5-fingerprint`.
  - [x] `make scope-check` before each commit; atomic commits via `make commit MSG="..."`.
  - [x] Push branch and open DRAFT PR; do not merge.

## Round R1 (Astra review, CHANGES)
- [x] **Lot 4 — Per-consumer resolved closure (finding 1)**
  - [x] Add `tools/memory-mcp-l5/lock-closure.mjs`: resolve each consumer independently, follow runtime and build edges plus build-tool transitives, hash effective resolved records.
  - [x] Red-first packed-gate regressions: nested SDK shadow, broker nested TypeScript integrity drift, `undici-types` integrity drift fail; identical nested duplicate and unrelated entry pass.
  - [x] Lot gate: scoped tooling run on `ENV=test-l5-fingerprint`.
- [x] **Lot 5 — Derived build-input record (finding 2, BR710-EX1)**
  - [x] Add `tools/memory-mcp-l5/build-inputs.mjs`: derive toolchain specs from `Makefile` producing targets, hash `tsconfig` and api-extractor configs, fail closed on unpinned specs.
  - [x] Pin `@types/node@22.20.1` in the 3 P1-producing `Makefile` targets (BR710-EX1).
  - [x] Red-first regressions through the production verifier: `Makefile` pin change fails, `tsconfig` target change fails.
  - [x] Lot gate: scoped tooling run on `ENV=test-l5-fingerprint`.
- [x] **Lot 6 — Generation lock snapshot provenance (finding 3)**
  - [x] `pack.mjs` writes `artifacts/lock-snapshots/<sha>.package-lock.json`, binds `declaredLockSnapshot` in manifest source, enforces clean-tree lock vs `HEAD`.
  - [x] `precandidate.mjs` verifies snapshot bytes against `declaredLockSha256` independently of the live closure check.
  - [x] Red-first regressions: missing snapshot fails, corrupt snapshot fails, zeroed `declaredLockSha256` fails, unrelated live-lock edit passes.
  - [x] Schema requires `declaredLockSnapshot`; update fixtures.
  - [x] Lot gate: scoped tooling run on `ENV=test-l5-fingerprint`.
- [x] **Lot 7 — Regenerate P1, full gate, PR stays draft**
  - [x] Retain superseded manifest in `artifacts/history/`; commit the generation lock snapshot (generated bytes, hash-verified).
  - [x] Rebuild dist and repack P1 via make targets; inventory stays exact 44 contracts.
  - [x] Lot gate: `make memory-l5-gate LOT=1 ARTIFACT_MANIFEST=tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-l5-fingerprint`.
  - [x] Push branch; PR stays DRAFT, do not merge, do not mark ready.

## Round M (main merge + security remediation)
- [x] **Lot 8 — Merge origin/main, resolve in scope**
  - [x] Merge `origin/main` (merge commit, no squash, no rebase); conflicts limited to the P1 manifest + sidecar, resolved with ours then regenerated.
  - [x] Containment: `track events-contains` OK, all 342 branch event ids survive.
- [x] **Lot 9 — Remediate markdown-it HIGH (GHSA-253c-mchw-3w2r, GHSA-r7fv-28h4-cvq7)**
  - [x] Pin `markdown-it@14.3.2` via root `overrides` (fixes both advisories; satisfies `^14.0.0`/`^14.1.0` dependent ranges).
  - [x] Pinned sed bump in `package-lock.json` (14.3.0) and `ui/package-lock.json` (14.1.1) via `lock-markdown-it-direct` (BR710-EX2, mirrors `lock-api-direct` precedent).
  - [x] Verify P1 unaffected (`memory-l5-verify` on the bumped lock); no P1 regen expected.
  - [ ] Push; PR stays DRAFT, do not merge, no publish; CI green required.

## Round R2 (Astra review, CHANGES)
- [x] **Lot 10 — Full transitive toolchain traversal (finding 1)**
  - [x] `lock-closure.mjs`: carry traversal through all descendants once inside the build-toolchain subtree, preserving consumer resolution and edges.
  - [x] Red-first regressions: second-level integrity change and edge deletion fail (unit + packed gate); unchanged-content hoisting passes.
  - [x] Lot gate: scoped tooling run on `ENV=test-pr710-fix-r2` (11 files / 75 tests).
- [x] **Lot 11 — Effective emitting commands and image (finding 3)**
  - [x] `build-inputs.mjs`: record per-target recipe lines, docker image tokens, and `LLM_MESH_NODE_IMAGE` export/default bindings; fail closed on unknown image tokens and missing bindings.
  - [x] Red-first regressions: single-line `tsc` flag change fails via fingerprint mismatch and image token swap fails closed (unit + packed gate).
  - [x] Lot gate: scoped tooling run on `ENV=test-pr710-fix-r2` (11 files / 83 tests).
- [x] **Lot 12 — Actual resolved toolchain record (finding 2, BR710-EX3)**
  - [x] Committed union toolchain snapshot (`artifacts/toolchain/`); the 3 producing recipes consume it via `npm ci`; fingerprint v3 binds snapshot content plus spec satisfaction.
  - [x] Explicit regen via `pack.mjs --snapshot-toolchain` and the `memory-l5-toolchain-snapshot` target; pack and verify refuse a stale snapshot.
  - [x] Red-first regressions: snapshot transitive change and edge deletion fail (unit + packed gate); spec/snapshot mismatch throws.
  - [x] Lot gate: scoped tooling run on `ENV=test-pr710-fix-r2` (11 files / 88 tests).
