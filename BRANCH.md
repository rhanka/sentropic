# Feature: Security Zod 4 Migration

## Objective
Migrate zod 3.25.76 to zod >=4.6.6 across api and packages, closing HIGH memory-exhaustion advisory GHSA-mrhx-c7xc-m3w5.

## Scope / Guardrails
- Scope limited to zod version bump plus required v4 API adaptations, no feature changes.
- One migration max in `api/drizzle/*.sql` (none expected).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/worktrees/sec-zod4` (packet path).
- Automated test campaigns run on dedicated environment (`ENV=test-sec-zod4`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off). If subtree/sync is used, record source and target SHAs in `BRANCH.md`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- 0 Python in repos and jobs. One Docker build at a time machine-wide.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/package.json`
  - `api/package-lock.json`
  - `package-lock.json` (root workspace lock sync for packages/* bumps)
  - `api/src/**`
  - `packages/auth-hono/**`
  - `packages/comments/**`
  - `packages/skills/**`
  - `.security/vulnerability-register.yaml`
  - `.security/audit-allowlist.json`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
  - `ui/**`
  - `e2e/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- [ ] `attention`: origin/main carries no zod exception in `.security/vulnerability-register.yaml` (verified 2026-10-24, GHSA-mrhx-c7xc-m3w5 entry exists only on `feat/llm-judge` as BR96-EX19) — nothing to remove unless main gains one before merge; re-check before final gate.
- [ ] BR01-EX1 (`acknowledge` self): touch `Makefile` (Forbidden Path), pin-only changes of `zod@3.25.76`/`zod@3.23.8` install pins to the v4 line in package typecheck/test targets (skills, auth-hono, llm-gateway, auth-client, cluster-mesh peer tools). Reason: targets hardcode the exact zod version under test; without the pin update the gates keep validating against v3. Impact: version strings in ephemeral `npm install` commands only, no target logic change. Rollback: revert pin strings to v3.
- [x] `acknowledge`: `make scope-check` available (harness CLI installed); run before every commit.

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
- Rationale: single dependency migration, sequential per-package lots in one worktree.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- **Multi-branch**: no UAT on sub-branches; UAT happens only after integration on the main branch.
- UAT checkpoints must be listed as checkboxes inside each relevant lot (no separate UAT section).
- Execution flow (mandatory):
  - Develop and run tests in `tmp/worktrees/sec-zod4`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`~/src/sentropic`, `ENV=dev`).
  - Switch back to `tmp/worktrees/sec-zod4` after UAT.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/security.md`.
  - [x] Created isolated worktree `tmp/worktrees/sec-zod4` on `feat/security-zod4-migration` from `origin/main` (`7fb76b7b2`).
  - [x] Zod inventory: `api` (`^3.22.4`, locked 3.25.76) + `@hono/zod-validator ^0.7.6`; `packages/auth-hono` (`^3.25.76`, validator `^0.7.5`); `packages/comments` (`^3.25.76`); `packages/skills` (`3.23.8` pinned); `ui` and `e2e` have zero zod usage; `api/tests` touches zod only in frozen historical fixtures (out of scope).
  - [x] Breaking API surface: `error.errors` (6 sites) becomes `error.issues`; single-arg `z.record(value)` (skills parser, product-docx, bids, products, config-product-settings) becomes `z.record(z.string(), value)`; `z.string().email()`, `z.coerce`, `.strict()`, `.refine()` unchanged in v4.
  - [ ] Capture Makefile targets needed for debug/testing.
  - [ ] Define environment mapping (`ENV=test-sec-zod4`) and ports for this branch.
  - [ ] Confirm command style: `make ... <vars> ENV=<env>` with `ENV` last.
  - [ ] Confirm scope and guardrails.
  - [ ] Validate scope boundaries (`Allowed/Forbidden/Conditional`) and declare `BRxx-EXn` exceptions if needed.

- [x] **Lot 1 — packages/skills zod v4**
  - [x] Bump `zod` to `^4.6.6` (min, resolve `>=4.6.6`, no legacy shim) in `packages/skills/package.json`.
  - [x] Adapt `packages/skills/src/format/parser.ts`: single-arg `z.record` becomes two-arg.
  - [x] Bump `packages/skills/package.json` version (patch, must exceed npm published version per `npm view`).
  - [x] Lot gate:
    - [x] `make typecheck-skills ENV=test-sec-zod4` PASS (zod 4.6.7)
    - [x] `make test-skills ENV=test-sec-zod4` PASS (136/136)
    - [x] `make lock-root` refreshed (skills zod resolves 4.6.7)
    - [ ] **API tests**
      - [ ] No API test changes expected for this lot.
      - [ ] Sub-lot gate: `make test-api ENV=test-sec-zod4` (deferred to Lot 4: api image audit gate still sees v3 in api/auth-hono/comments until their lots land; exception allowlist keeps it advisory-clean)
      - [ ] AI flaky tests run (non-blocking only under acceptance rule): `make test-api-ai ENV=test-sec-zod4` and document status/signature in `BRANCH.md`
    - [ ] **UI tests (TypeScript only)**
      - [ ] No UI test changes expected for this lot.
      - [ ] Sub-lot gate: `make test-ui ENV=test-sec-zod4` (deferred to Lot 4, same reason)
    - [ ] **E2E tests**
      - [ ] No E2E changes for this lot.
    - [ ] non mandatory UAT if required user interaction strictly required before Lot 2, splitted by sublist for each env
      - [ ] No UAT (no UI change).

- [ ] **Lot 2 — packages/comments zod v4**
  - [ ] Bump `zod` to `^4.6.6` in `packages/comments/package.json`.
  - [ ] Adapt `packages/comments/src/hono.ts` if typecheck requires.
  - [ ] Bump `packages/comments/package.json` version (patch, must exceed npm published version per `npm view`).
  - [ ] Lot gate: copy exact checklist of Lot 1, no UAT if last branch.

- [ ] **Lot 3 — packages/auth-hono zod v4**
  - [ ] Bump `zod` to `^4.6.6` in `packages/auth-hono/package.json`; verify `@hono/zod-validator` resolves v4-compatible (bump only if typecheck/resolution requires).
  - [ ] Adapt `packages/auth-hono/src/*-handlers.ts` (5 files) if typecheck requires.
  - [ ] Bump `packages/auth-hono/package.json` version (patch, must exceed npm published version per `npm view`).
  - [ ] Lot gate: copy exact checklist of Lot 1, no UAT if last branch.

- [ ] **Lot 4 — api zod v4**
  - [ ] Bump `zod` to `^4.6.6` in `api/package.json`; refresh `api/package-lock.json` via make lock target; verify `@hono/zod-validator` resolves v4-compatible.
  - [ ] Replace `error.errors` with `error.issues` (magic-link, config-product-ai, session-device x3, session-lifecycle, live-declarations, queue-manager).
  - [ ] Replace single-arg `z.record(value)` with two-arg form (config-product-settings, product-docx, bids, products).
  - [ ] Adapt `api/src/services/object-registry/json-schema-to-zod.ts` only if typecheck requires.
  - [ ] Lot gate: copy exact checklist of Lot 1, no UAT if last branch.

- [ ] **Lot 5 — Register cleanup + final validation**
  - [ ] Re-check `.security/vulnerability-register.yaml` for any zod entry (GHSA-mrhx-c7xc-m3w5); remove it if present, else record absence.
  - [ ] Verify `.security/audit-allowlist.json` carries no zod entry.
  - [ ] Typecheck & Lint
  - [ ] Retest UI (cf Lot1, copy checklist)
  - [ ] Retest API (cf Lot1, copy checklist)
  - [ ] Retest e2e (cf lots e2e_groups like in Lot1)
  - [ ] Retest AI flaky tests (non-blocking only under acceptance rule) and document pass/fail signatures in `BRANCH.md`
  - [ ] Record explicit user sign-off if any AI flaky test is accepted
  - [ ] Bumped affected `packages/<pkg>/package.json` version (semver) for every package whose `src/**` changed in this branch — enforced by CI `enforce-package-bump`. See `rules/workflow.md → Package Publication`.
  - [ ] Final gate step 1: create/update PR using `BRANCH.md` text as PR body (source of truth).
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Final gate step 3: once UAT + CI are both `OK`, commit removal of `BRANCH.md`, push, and merge.
