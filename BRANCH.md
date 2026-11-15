# Feature: llm-mesh Cloud Code client identity parity (gemini-4-argon 503)

## Objective
An enrolled Cloud Code seat must get the same answers through llm-mesh as through the provider CLI (agy): fix the 503 returned for `gemini-4-argon` while agy succeeds on the same seat.

## Scope / Guardrails
- Scope limited to `packages/llm-mesh` Cloud Code client identity, catalogue-miss error typing, and the release bookkeeping it forces.
- Make-only workflow, no direct Docker commands.
- Branch development in isolated worktree `tmp/worktrees/llm-mesh-argon-503`.
- Tests on `ENV=test-llm-mesh-argon` only (ports API_PORT=9180 UI_PORT=5380 MAILDEV_UI_PORT=1280), never `ENV=dev`.
- In every `make` command, `ENV=<env>` is the last argument.
- No token, refresh token, cookie or credential in any trace, test or commit; request comparison by structure only.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/llm-mesh/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `package-lock.json` (BRLMA-EX1)
  - `packages/cluster-mesh/tests/fixtures/train.ts` (BRLMA-EX2)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json` (BRLMA-EX2)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json` (BRLMA-EX2)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- [x] `attention` BRLMA-EX1: `package-lock.json` workspace entry `packages/llm-mesh` version 0.38.0 -> 0.38.1 (one line). Reason: the mandatory patch bump must keep the root workspace lock in sync (precedent a546b9ca8). Impact: lock metadata only. Rollback: revert the line with the bump.
- [x] `attention` BRLMA-EX2: cluster-mesh release-tuple fixtures follow the llm-mesh candidate (`TRAIN_LLM_MESH_VERSION`, selected fixture spec, lock version/resolved/integrity of the guarded `make pack-llm-mesh` archive). Reason: `prepare-artifacts.spec.ts` and `llm-surface.spec.ts` assert workspace-version alignment (precedent 930a8902c, d132ed89c). Impact: test fixtures only. Rollback: revert the three files with the bump.
- [x] `attention` local `make test-cluster-mesh`: identity/sqlite specs (`a20b-prerequisites.spec.ts`, `service-tenancy.spec.ts`) time out at 5 s under host load 9-12, a different test each run, pass in isolation; unrelated to this diff (no llm-mesh import). CI on the exact head is the gate.

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
- Rationale: single-package bugfix, one lane.

## UAT Management (in orchestration context)
- **Mono-branch**: no UI change; UAT = live replay of the mesh Cloud Code client against the enrolled seat (structure-only trace).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/testing.md`, `.tmp/packets/COMMON-RULES.md`.
  - [x] Create isolated worktree `tmp/worktrees/llm-mesh-argon-503` from `origin/main` (913e3bcbc).
  - [x] Confirm Cloud Code transport is identical between llm-mesh 0.26.0 (f3e2b0afc) and 0.38.0.
  - [x] Capture agy and mesh request structure through a local redacting proxy; reproduce on 0.38.0 (catalogue without Argon, 404 on generation with the mesh identity).

- [x] **Lot 1 — Client identity parity**
  - [x] Single `CLOUD_CODE_USER_AGENT` / `CLOUD_CODE_CLIENT_VERSION` in `src/enrollment/cloud-code.ts`, mirroring agy 1.5.9; transport re-exports it; enrollment metadata `cloudCodeUserAgentVersion` derives from it.
  - [x] Catalogue miss throws `statusCode: 404`, `code: 'model_not_found'` in `src/transport/cloud-code-runtime-client.ts`.
  - [x] New `tests/transport/cloud-code-client-identity.test.ts` (fixture of the measured server gate; fails before the fix); update `tests/enrollment/cloud-code.test.ts`.
  - [x] Lot gate: `make test-llm-mesh ENV=test-llm-mesh-argon`, `make typecheck-llm-mesh ENV=test-llm-mesh-argon`.

- [x] **Lot 2 — Release bookkeeping**
  - [x] Bump `@sentropic/llm-mesh` 0.38.0 -> 0.38.1 (npm latest 0.38.0), CHANGELOG entry, `tests/decision-public-surface.test.ts` version.
  - [x] BRLMA-EX1 root lock line; BRLMA-EX2 cluster-mesh train and selected fixtures.
  - [x] Lot gate: `make test-cluster-mesh ENV=test-llm-mesh-argon`, `make pack-llm-mesh ENV=test-llm-mesh-argon`.

- [ ] **Lot 3 — PR and CI**
  - [ ] Push, open PR (no merge, no publish), CI green on the exact head.
