# Feature: llm-mesh encrypted keyring read-only reads

## Objective
Make `EncryptedFileKeyring` reads side-effect free (no `mkdir`/`chmod` on the read path) so `listAccounts` → `restorePersistedAccounts` → `getSecret` → `readMasterKey(false)` works on read-only mounts (seat export) without EROFS and without bumping the keyring ctime. Wrong modes on a read refuse with a typed `keyring_insecure_permissions` error; the write path keeps creating and sets modes only when they differ. Bump `@sentropic/llm-mesh` to 0.32.4.

## Scope / Guardrails
- Scope limited to `packages/llm-mesh` keyring read path, its tests, version, changelog and the root lockfile refresh.
- Make-only workflow; Docker lock `.tmp/packets/DOCKER-LOCK.md` taken per command via `flock`.
- Branch development in isolated worktree `tmp/worktrees/llm-mesh-keyring-ro` (branch `fix/llm-mesh-keyring-readonly` from `origin/main`).
- `ENV=test-keyring-ro` always last argument of every `make` command; never `ENV=dev`.
- All new text in English. No secrets anywhere.
- Retain inherited BRLOCK-EX1 under `.security/ci-lockfile-policy.json`: owner=CI maintainers, review_by=2026-11-30T00:00:00Z; bounded scope and removal trigger remain unchanged (required by `validate-publishable-manifests`).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/llm-mesh/src/node/keyring/encrypted-file-keyring.ts`
  - `packages/llm-mesh/src/node/index.ts`
  - `packages/llm-mesh/src/global.d.ts` (ambient `node:fs/promises` shim: add `stat`/`Stats`, the package compiles with `types: []`)
  - `packages/llm-mesh/tests/node/encrypted-file-keyring.test.ts`
  - `packages/llm-mesh/tests/decision-public-surface.test.ts`
  - `packages/llm-mesh/package.json`
  - `packages/llm-mesh/CHANGELOG.md`
  - `package-lock.json`
  - `packages/cluster-mesh/tests/fixtures/train.ts` (train pin rebind, required by the cluster-mesh validate lanes)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json` (selected tuple pin rebind)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json` (regenerated via `make -f packages/cluster-mesh/packaging.mk refresh-lazy-package-lock`)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
  - `.github/workflows/**`
  - `api/**`, `ui/**`, `e2e/**`, `apps/**`
- **Conditional Paths (allowed only with explicit exception)**:
  - none
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- [ ] none so far

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single-package bugfix, one PR, one CI run)
- [ ] **Multi-branch**
- Rationale: one package, one logical change; no sub-workstreams.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Worktree `tmp/worktrees/llm-mesh-keyring-ro` created from `origin/main`, branch `fix/llm-mesh-keyring-readonly`.
  - [x] `BRANCH.md` written from `plan/BRANCH_TEMPLATE.md`.
  - [ ] `make scope-check ENV=test-keyring-ro` after first commit.
- [ ] **Lot 1 — Tests first** (`packages/llm-mesh/tests/node/encrypted-file-keyring.test.ts`)
  - [x] read from a read-only mount succeeds with no EROFS (mutating syscalls mocked to throw EROFS)
  - [x] a read never changes the directory or master-key ctime/mtime
  - [x] wrong dir mode (0755) and wrong key mode (0644) on a read give the typed `keyring_insecure_permissions` refusal
  - [x] read on a missing directory returns null (no account) and creates nothing
  - [x] read with a missing master key keeps the existing error and does not touch the directory
  - [x] write path on a non-existent directory still creates dir 0700 / `.key` 0600 / record 0600
  - [x] write path sets modes only when they differ (chmod spy)
  - [x] Scoped run `make test-llm-mesh SCOPE=tests/node/encrypted-file-keyring.test.ts` shows the new tests failing on the unfixed code (5 failed / 4 passed before the fix)
- [x] **Lot 2 — Fix** (`packages/llm-mesh/src/node/keyring/encrypted-file-keyring.ts`)
  - [x] read path (`create=false`): stat dir + `.key`, read only when modes are 0700/0600, typed refusal otherwise, missing dir/key keeps the existing not-found behaviour, zero mkdir/chmod
  - [x] write path (`create=true`): still creates; `chmod` only when the mode differs
  - [x] export `KeyringInsecurePermissionsError` from `src/node/index.ts`
  - [x] ambient `node:fs/promises` shim in `src/global.d.ts` gains `stat`/`Stats` (package compiles with `types: []`)
- [x] **Lot 3 — Gates**
  - [x] `make test-llm-mesh SCOPE=tests/node/encrypted-file-keyring.test.ts ENV=test-keyring-ro` green (9/9)
  - [x] `make test-llm-mesh ENV=test-keyring-ro` full suite green (95 files, 1651 tests)
  - [x] `make typecheck-llm-mesh ENV=test-keyring-ro` green
  - [x] `make build-llm-mesh ENV=test-keyring-ro` green
- [x] **Lot 4 — Release**
  - [x] bump `packages/llm-mesh/package.json` to 0.32.4 (pre-check: registry publishes 0.32.3, 0.32.4 > 0.32.3)
  - [x] update fixture `packages/llm-mesh/tests/decision-public-surface.test.ts` to 0.32.4
  - [x] `packages/llm-mesh/CHANGELOG.md` 0.32.4 entry
  - [x] `make lock-root ENV=test-keyring-ro` run; kept only the in-scope `packages/llm-mesh` lock entry (other workspace entries on main are stale from other lanes, out of scope)
  - [x] rebind cluster-mesh train/selected fixture pins to 0.32.4 (`tests/fixtures/train.ts`, `tests/packaging/fixtures/selected/package.json`) and regenerate `tests/packaging/fixtures/selected/package-lock.json` via `make -f packages/cluster-mesh/packaging.mk refresh-lazy-package-lock ENV=test-keyring-ro` (first CI run 41477264507 failed the cluster-mesh lanes on the stale 0.32.3 pin)
  - [x] BRANCH.md retains the inherited BRLOCK-EX1 `review_by=2026-11-30T00:00:00Z` line (first CI run failed `validate-publishable-manifests` without it)
- [ ] **Lot 5 — Commit, push, PR, CI**
  - [ ] `make scope-check ENV=test-keyring-ro`
  - [ ] `git add` specific files + `make commit MSG="fix(llm-mesh): ..."` (atomic, ≤150 lines)
  - [ ] push branch `fix/llm-mesh-keyring-readonly` (crash-safety copy)
  - [ ] open READY PR with `BRANCH.md` as body
  - [ ] run one CI on the final head and monitor
- [ ] **Lot N — Close**
  - [ ] report to `.tmp/rv/llm-mesh-keyring-ro.md`
  - [ ] do NOT merge
