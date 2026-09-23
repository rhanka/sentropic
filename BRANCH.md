# Feature: Muse provider parity (CLI-import serve + refresh)

## Objective
Bring the muse CLI-import path to full parity with codex/cloud-code and the muse device path: servable credentials (mint at complete + refresh via the shared mint wire) and mutualized error messages.

## Scope / Guardrails
- Scope limited to muse enrollment refresh/complete, the shared mint helper, mirror tests, and the mesh patch bump.
- No migration in `api/drizzle/*.sql`.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/muse-parity` (even for one active branch).
- Automated test campaigns must run on dedicated environments (`ENV=test` / `ENV=e2e`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off). If subtree/sync is used, record source and target SHAs in `BRANCH.md`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/llm-mesh/src/enrollment/muse.ts`
  - `packages/llm-mesh/src/enrollment/muse-code.ts` (shared mint export only)
  - `packages/llm-mesh/tests/enrollment/muse.test.ts`
  - `packages/llm-mesh/tests/service/local-account-transport-service-muse.test.ts`
  - `packages/llm-mesh/package.json` (patch bump, CI enforce-package-bump)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `packages/llm-mesh/src/enrollment/cloud-code.ts`
  - `packages/llm-mesh/src/enrollment/codex.ts`
  - `packages/llm-mesh/src/transport/*`
  - `packages/llm-mesh/src/service/*`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BR76-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- `acknowledge` BR76-D1 (owner): parity muse ↔ cloud-code/codex exigée, méthodes mutualisées, mêmes chemins (pas de nouveaux), garantie par tests.
- `acknowledge` BR76-D2 (evidence): T7-vert ne couvrait que la relecture store, jamais la branche expiry ni le headless. Refresh CLI-import ne minte pas → 401 au serve + flip reauth en headless (service:373-379). Fix: mint au complete + refresh via le wire partagé, erreurs au format `<Provider> token refresh failed`.

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
- Rationale: single focused fix with shared helper; one test cycle suffices.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- **Multi-branch**: no UAT on sub-branches; UAT happens only after integration on the main branch.
- UAT checkpoints must be listed as checkboxes inside each relevant lot (no separate UAT section).
- Execution flow (mandatory):
  - Develop and run tests in `tmp/muse-parity`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`~/src/top-ai-ideas-fullstack`, `ENV=dev`).
  - Switch back to `tmp/muse-parity` after UAT.

## Plan / Todo (lot-based)
- [x] **Lot 1 — Tests first (TDD red)**
  - [x] `muse.test.ts`: refresh mints via key endpoint, same accountId, minted token (mock fetchFn).
  - [x] `muse.test.ts`: complete mints via key endpoint (mock fetchFn).
  - [x] `muse.test.ts`: unreadable store on refresh → `Muse token refresh failed`, no leak.
  - [x] `muse.test.ts`: direct-key refresh → re-import error.
  - [x] `muse.test.ts`: mint failure propagates (`Muse key mint failed`).
  - [x] Lot gate: scoped mesh run red on new tests (5 failed), green after (24/24).
- [x] **Lot 2 — Shared mint + parity implementation**
  - [x] Export shared `mintMuseApiKey` from `muse-code.ts`; reuse in its private mint (no behavior change).
  - [x] `muse.ts`: `fetchFn` option (sibling pattern), mint at complete + refresh, direct-key guard, shared error shape.
  - [x] Evolve the re-read refresh test (minted token expected).
  - [x] Bump `packages/llm-mesh/package.json` `0.21.0` → `0.21.1`.
  - [x] Lot gate: `make typecheck` + `lint` + scoped mesh tests, `make scope-check`, all `ENV=test-fix-muse-provider-parity`.
- [ ] **Lot N — Final validation**
  - [x] Typecheck & Lint
  - [x] Retest API (mesh suite 250/250, gateway 114/114)
  - [ ] Retest e2e — `none` with reason (no gateway route change)
  - [x] Live re-proof: forced-expiry refresh + 1 minimal serve via seat (scratch `/tmp/muse-br76-proof.mjs`, PROOF PASS)
  - [x] VRAI test (owner-ordered, 2026-09-23): live h2a keyring emptied (`account rm` seat) then re-enrolled via branch code — import + forced-expiry refresh + serve `ok` (usage in 12/out 245), seat `active` in `h2a llm-mesh account ls`. Caveat: live resolves published 0.21.0 (no mint) → durability needs 0.21.1 merge+publish (PR598).
  - [ ] Push, PR, CI green — merge only on owner GO, no direct publish.
