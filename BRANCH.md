# Feature: Cluster Mesh Token Exchange (2a)

## Objective
Implement the RFC 8693 token-exchange client in `@sentropic/cluster-mesh`: mesh wiring is no longer gated when an issuer binding is configured, with a mandatory 60s cache and a strict never-passthrough posture, proven by security tests for every refusal path.

## Scope / Guardrails
- Scope limited to `packages/cluster-mesh` (exchange client, mesh wiring, tests, version bump).
- One migration max in `api/drizzle/*.sql` (if applicable).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/worktrees/cm-token-exchange` (even for one active branch).
- Automated test campaigns must run on dedicated environments (`ENV=test` / `ENV=e2e`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off). If subtree/sync is used, record source and target SHAs in `BRANCH.md`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/cluster-mesh/src/token-exchange.ts`
  - `packages/cluster-mesh/src/mesh.ts`
  - `packages/cluster-mesh/src/index.ts`
  - `packages/cluster-mesh/src/trust.ts`
  - `packages/cluster-mesh/tests/token-exchange.spec.ts`
  - `packages/cluster-mesh/tests/token-exchange-security.spec.ts`
  - `packages/cluster-mesh/tests/token-exchange-cache.spec.ts`
  - `packages/cluster-mesh/tests/token-exchange-no-passthrough.spec.ts`
  - `packages/cluster-mesh/tests/fixtures/fake-token-issuer.ts`
  - `packages/cluster-mesh/tests/trust.spec.ts`
  - `packages/cluster-mesh/tests/mesh.spec.ts`
  - `packages/cluster-mesh/tests/conformance/h2a-contract.spec.ts`
  - `packages/cluster-mesh/tests/conformance/h2a-contract.json`
  - `packages/cluster-mesh/package.json`
  - `package-lock.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json` (B3 candidate-tarball sync with version bump)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json` (B3 frozen-lock regen via `refresh-lazy-package-lock`)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- `attention` CMT-GAP1: spec-v2.md and challenge-opus-r2.md bodies are not present in this worktree, the parent checkout, or the sibling `auth-token-exchange` worktree (targeted searches empty). Lot 2a is implemented from Discovery A/B/C evidence (requirements summary), the sibling `feat/auth-token-exchange` BRANCH.md shared vocabulary, and current `packages/cluster-mesh` sources. Interpretation decisions are recorded under Lot 2a and in the implementation notes; any deviation found when the spec bodies resurface must be fixed in a follow-up lot.

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
- Rationale: Single lot 2a with one worktree and one package test cycle; 2-IdP lives on the sibling `feat/auth-token-exchange` branch and hands a version/policy receipt to 2a/2b.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- **Multi-branch**: no UAT on sub-branches; UAT happens only after integration on the main branch.
- UAT checkpoints must be listed as checkboxes inside each relevant lot (no separate UAT section).
- Execution flow (mandatory):
  - Develop and run tests in `tmp/worktrees/cm-token-exchange`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`~/src/top-ai-ideas-fullstack`, `ENV=dev`).
  - Switch back to `tmp/worktrees/cm-token-exchange` after UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/testing.md`, `rules/security.md`.
  - [x] Read spec-v2 section 2a and challenge-opus-r2 corrections touching 2a (via Discovery A evidence; bodies absent — see CMT-GAP1).
  - [x] Confirm worktree `tmp/worktrees/cm-token-exchange` on `feat/cluster-mesh-token-exchange` baseline `09b1c601d`.
  - [x] Define environment mapping: `ENV=test-cm-token-exchange`, `API_PORT=9560`, `UI_PORT=5760`, `MAILDEV_UI_PORT=1660` (slot-0 triple, branch number unconfirmed — recorded, not derived).
  - [x] Confirm command style: `make ... <vars> ENV=<env>` with `ENV` last.
  - [x] Confirm scope and guardrails.
  - [x] Validate scope boundaries (`Allowed/Forbidden/Conditional`); no exception needed for lot 2a.
  - [x] Version survey: npm `@sentropic/cluster-mesh` = 0.15.0, origin/main = 0.15.0, `origin/fix/llm-gateway-muse-vibe-wires` holds 0.16.0, `origin/feat/cluster-mesh-storage-k1/k2b/k3` hold 0.17.0, nothing holds 0.18.0 → this branch takes **0.18.0**.

- [x] **Lot 2a — RFC 8693 exchange client, mesh ungating, mandatory cache**
  - [x] New `packages/cluster-mesh/src/token-exchange.ts`: `TokenExchangeIssuer` port (`verify`/`mint`), `createTokenExchangeClient` (grant-type, Bearer-only, signature via issuer, issuer/audience/subject/actor/scopes/TTL policy, scope intersection, TTL ceiling, refresh-output refusal), 60s mandatory cache (`min(minted.exp, subject.exp, insertedAt+60s)`, 12-field key), zero-fallback refusal errors. No static `jose` reference in `src/` (root-graph isolation).
  - [x] Update `packages/cluster-mesh/src/mesh.ts`: optional `tokenExchangeIssuer` input; real client wired when configured, gated domain otherwise; `capabilities.tokenExchange` is `'available' | 'gated'` following the `localDevices` precedent.
  - [x] Update `packages/cluster-mesh/src/index.ts`: export the new module.
  - [x] Bump `packages/cluster-mesh/package.json` to `0.18.0` (strictly above npm 0.15.0 and main 0.15.0; avoids held 0.16.0/0.17.0).
  - [x] Test doubles via new `packages/cluster-mesh/tests/fixtures/fake-token-issuer.ts` (HS256 `jose` fake; test-only until lot 2-IdP wires the real IdP).
  - [x] Lot gate:
    - [x] `make typecheck-cluster-mesh ENV=test-cm-token-exchange` + `make lint-cluster-mesh ENV=test-cm-token-exchange` (both pass; one-line tsc index-signature fix committed separately)
    - [ ] **Package tests**
      - [x] New `packages/cluster-mesh/tests/token-exchange.spec.ts` (happy paths: valid exchange, scope intersection, TTL ceiling, `act` claim, cache hit).
      - [x] New `packages/cluster-mesh/tests/token-exchange-security.spec.ts` (every refusal path).
      - [x] New `packages/cluster-mesh/tests/token-exchange-cache.spec.ts` (60s cap, `min()` semantics, no stale serve, key isolation).
      - [x] New `packages/cluster-mesh/tests/token-exchange-no-passthrough.spec.ts` (failures never return the subject token, no fallback, expired entries never served).
      - [x] Updated `packages/cluster-mesh/tests/trust.spec.ts` (gated domain still fail-closes when unconfigured).
      - [x] Updated `packages/cluster-mesh/tests/mesh.spec.ts` (unconfigured stays gated; configured is available and exchanges).
      - [x] Updated `packages/cluster-mesh/tests/conformance/h2a-contract.spec.ts` + `h2a-contract.json` (configured-mesh available case; unconfigured federal gating preserved).
      - [x] Scoped runs while evolving tests: `make test-cluster-mesh SCOPE=tests/token-exchange.spec.ts ENV=test-cm-token-exchange` (repeat per file).
      - [x] Sub-lot gate: `make test-cluster-mesh ENV=test-cm-token-exchange` (59 files pass, 476 tests pass, 5 files/34 tests skipped — all skips pre-existing in `tests/packaging/*`).
    - [ ] **API tests**
      - [ ] None; no API change in 2a.
    - [ ] **UI tests (TypeScript only)**
      - [ ] None; no UI change in 2a.
    - [ ] **E2E tests**
      - [ ] None for 2a; cross-repository receipt lands in 2b.

- [ ] **Lot 2-IdP — Real issuer binding (sibling branch, tracked dependency)**
  - [ ] Consume the immutable version/policy receipt from `feat/auth-token-exchange` (subject validation, policy table, rotation procedure).
  - [ ] Replace the fake issuer with the real IdP-backed binding; no test-only key material in `src/`.

- [ ] **Lot N-2 — UAT**
  - [ ] Web app (no UI change; verify mesh host path only)
    - [ ] Configure a mesh with the fake issuer; exchange a valid subject token and verify claims, human sub, scope intersection, expiry.
    - [ ] Repeat negatives: wrong grant type, non-access subject token type, DPoP requested, forged signature, wrong issuer, wrong audience, missing subject, forged actor, excess scope, TTL above ceiling; every refusal surfaces before any downstream call.
    - [ ] Prove the 60s cap: advance past `insertedAt+60s` and confirm re-exchange; advance past subject expiry and confirm refusal, never a stale token.
    - [ ] Prove never-passthrough: force issuer failure and confirm the error carries no token material and the subject token is never returned as the access token.
    - [ ] Confirm unconfigured mesh still reports `tokenExchange: 'gated'` and rejects with `capability_gated`.

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Refactor and integrate `spec/BRANCH_SPEC_EVOL.md` into existing specs (if not a new standalone spec).
  - [ ] Delete `spec/BRANCH_SPEC_EVOL.md` after integration.

- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint
  - [ ] Retest package (cf Lot 2a, copy checklist)
  - [ ] Retest API (cf Lot 2a: none)
  - [ ] Retest e2e (cf lots e2e_groups like in Lot 2a: none)
  - [ ] Retest AI flaky tests (non-blocking only under acceptance rule) and document pass/fail signatures in `BRANCH.md`
  - [ ] Record explicit user sign-off if any AI flaky test is accepted
  - [ ] Bumped affected `packages/<pkg>/package.json` version (semver) for every package whose `src/**` changed in this branch — enforced by CI `enforce-package-bump`. See `rules/workflow.md → Package Publication`.
  - [ ] Final gate step 1: create/update PR using `BRANCH.md` text as PR body (source of truth).
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Final gate step 3: once UAT + CI are both `OK`, commit removal of `BRANCH.md`, push, and merge.
