# Feature: Generic codec/compiler (Lot 1a)

## Objective
Implement Lot 1a generic tool-configuration codec/compiler in packages/mcp-platform as specified in spec-v2.md §1a with challenge-opus-r2 corrections touching 1a.

## Scope / Guardrails
- Scope limited to generic codec/compiler, synthetic fixtures only, no Immo-specific fixture inside generic package.
- One migration max in `api/drizzle/*.sql` (if applicable).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/feat-<slug>` (even for one active branch).
- Automated test campaigns must run on dedicated environments (`ENV=test` / `ENV=e2e`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off). If subtree/sync is used, record source and target SHAs in `BRANCH.md`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/mcp-platform/src/tool-configuration.ts`
  - `packages/mcp-platform/tests/tool-configuration.test.ts`
  - `packages/mcp-platform/package.json`
  - `packages/mcp-platform/README.md`
  - `packages/mcp-platform/docs/ADOPTION_GUIDE.md`
  - `packages/mcp-platform/etc/mcp-platform.api.md`
  - `BRANCH.md`
  - `.h2a/build/immo_1a_report.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `packages/auth-hono/**`
  - `packages/cluster-mesh/**`
  - `packages/mcp-auth/**`
  - `packages/mcp-broker/**`
  - `api/**`
  - `ui/**`
  - `e2e/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
  - `package-lock.json`
  - `packages/connector-host/package.json` (consumer range bump only)
  - `packages/mcp-platform/dist/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- [ ] `attention`: npm published `@sentropic/mcp-platform` is `0.2.0`, source is `0.2.0`, candidate `0.3.0` is strictly above both (verified 2026-10-16)
- [ ] `attention` BR1a-EX1: bump `packages/connector-host/package.json` range `^0.2.0` -> `^0.3.0` and refresh root `package-lock.json` via `make lock-root`. Reason: minor bump exits the `^0.2.0` range (`0.x` caret pins minor) and desyncs the lockfile, blocking every Make gate (`npm ci` fails). Impact: two files outside Allowed Paths, consumer-only range bump, no source change. Rollback: revert range and lockfile.

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
- Rationale: single S-size library slice, one writer, no shared-file contention, one test cycle

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- **Multi-branch**: no UAT on sub-branches; UAT happens only after integration on the main branch.
- UAT checkpoints must be listed as checkboxes inside each relevant lot (no separate UAT section).
- Execution flow (mandatory):
  - Develop and run tests in `tmp/feat-<slug>`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`~/src/top-ai-ideas-fullstack`, `ENV=dev`).
  - Switch back to `tmp/feat-<slug>` after UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/testing.md`, `rules/security.md`
  - [x] Read `spec-v2.md` §1a + §3 contract and `challenge-opus-r2.md` R1-R7 filtering 1a touches
  - [x] Confirm branch `feat/mcp-registry-config-codec` on baseline `09b1c601d` via `git -C <worktree> branch --show-current`
  - [x] Confirm isolated worktree `/home/antoinefa/src/sentropic/tmp/worktrees/mcp-registry-codec`
  - [x] Define environment mapping `ENV=test-mcp-registry-codec`, `API_PORT=9550`, `UI_PORT=5750`, `MAILDEV_UI_PORT=1650`
  - [x] Confirm command style: `make ... ENV=<env>` with `ENV` last, no shell-prefix assignment
  - [x] Confirm scope boundaries and version rule (new version strictly above npm `0.2.0` and main `0.2.0`)
  - [x] Verify npm published version via containerized `npm view @sentropic/mcp-platform version`
- [x] **Lot 1 — Generic codec/compiler**
  - [x] Create `packages/mcp-platform/src/tool-configuration.ts` (strict codec/compiler, synthetic-only, no SDK, no Immo fixture, no network I/O)
  - [x] Implement identity/version checks (schema `v1`, provider/connector refs, revision, manifest digest, provider/platform versions)
  - [x] Implement tool binding checks (unique external names, manifest capability match, handler table match, no executable strings/URL imports/upstream selection)
  - [x] Implement per-tool values checks (typed schema validation, unknown keys/handlers rejected, invalid values rejected)
  - [x] Implement policy checks (reuse manifest scopes/claims/mutability/idempotency/freshness/redaction/gates, no weakening)
  - [x] Implement compatibility checks (consumer digest covers public schemas/result codec, no rename/remove/param/result change)
  - [x] Implement provenance checks (approval ref, revision, payload/manifest/code binding, review provenance, no credentials/bearers/user data)
  - [x] Implement whole-candidate validation before activation plus active-generation retention and cold-start fail-closed
  - [x] Implement deterministic canonical JSON and SHA-256 digests (round-trip stable)
  - [x] Add `packages/mcp-platform/tests/tool-configuration.test.ts` (synthetic providers only)
  - [x] Update `packages/mcp-platform/package.json` (`0.2.0` -> `0.3.0`, `./tool-configuration` export and typesVersions)
  - [x] Update `packages/mcp-platform/README.md` (subpath section)
  - [x] Update `packages/mcp-platform/docs/ADOPTION_GUIDE.md` (compiler section)
  - [x] Update `packages/mcp-platform/etc/mcp-platform.api.md` only if extractor reports drift, else leave untouched (no drift, untouched)
  - [x] Lot gate:
    - [x] `make typecheck-mcp-platform ENV=test-mcp-registry-codec`
    - [x] **API tests**
      - [x] Existing regression `packages/mcp-platform/tests/manifest.test.ts` (unchanged)
      - [x] Existing regression `packages/mcp-platform/tests/authz.test.ts` (unchanged)
      - [x] New `packages/mcp-platform/tests/tool-configuration.test.ts` (deterministic round trips/digests, two-tool independent settings, schema/version/handler strictness, duplicates, missing bindings, weakened policy, rejection preserves active state, throwing-fetch zero-call sentinel, fresh-process reload equivalence)
      - [x] Scoped run: `make test-mcp-platform SCOPE=tests/tool-configuration.test.ts ENV=test-mcp-registry-codec`
      - [x] Scoped run: `make test-mcp-platform SCOPE=tests/manifest.test.ts ENV=test-mcp-registry-codec`
      - [x] Scoped run: `make test-mcp-platform SCOPE=tests/authz.test.ts ENV=test-mcp-registry-codec`
      - [x] Sub-lot gate: `make test-mcp-platform ENV=test-mcp-registry-codec`
    - [x] **UI tests (TypeScript only)**
      - [x] None (pure library slice, no UI change)
      - [x] Sub-lot gate: not applicable, no `ui/tests/**` touched
    - [x] **E2E tests**
      - [x] None (pure library slice, no app wiring)
      - [x] Sub-lot gate: not applicable, no `e2e/tests/**` touched
    - [x] Package gates: `make api-extract-mcp-platform ENV=test-mcp-registry-codec`
    - [x] Package gates: `make pack-mcp-platform ENV=test-mcp-registry-codec`
    - [ ] Package gates: `make check-publishable-manifests ENV=test-mcp-registry-codec`
    - [x] UAT (compiler delivered, no Immo claim):
      - [x] Compile two synthetic tools with distinct settings, confirm only intended binding receives each value
      - [x] Reject wrong schema/type, unknown handler, duplicate external name, policy weakening before activation
      - [x] Run with fetch throwing and assert zero calls, reproduce same compiled result in fresh process
      - [x] Install packed subpath from clean consumer, report compiler delivered without claiming Immo registry integration
- [x] **Lot N-1 — Docs consolidation**
  - [x] Refactor and integrate `spec/BRANCH_SPEC_EVOL.md` into existing specs (if not a new standalone spec).
  - [x] Delete `spec/BRANCH_SPEC_EVOL.md` after integration.
  - [x] Confirm no `spec/BRANCH_SPEC_EVOL.md` needed (S slice, no spec evolution file created)
  - [x] Confirm `README.md` and `docs/ADOPTION_GUIDE.md` updated, no stale publication/Make notes introduced
- [ ] **Lot N — Final validation**
  - [x] Typecheck & Lint
  - [x] Retest UI (cf Lot1, copy checklist)
  - [x] Retest API (cf Lot1, copy checklist)
  - [x] Retest e2e (cf lots e2e_groups like in Lot1)
  - [ ] Retest AI flaky tests (non-blocking only under acceptance rule) and document pass/fail signatures in `BRANCH.md`
  - [ ] Record explicit user sign-off if any AI flaky test is accepted
  - [ ] Bumped affected `packages/<pkg>/package.json` version (semver) for every package whose `src/**` changed in this branch — enforced by CI `enforce-package-bump`. See `rules/workflow.md → Package Publication`.
  - [ ] Final gate step 1: create/update PR using `BRANCH.md` text as PR body (source of truth).
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Final gate step 3: once UAT + CI are both `OK`, commit removal of `BRANCH.md`, push, and merge.
  - [ ] Stop condition: decision needed stops and reports, never merges, never publishes (packet stop rule)
