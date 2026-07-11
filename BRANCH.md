# Feature: BR-39e Lot 6 — auth-ui social provider buttons + link/unlink UI

## Objective
Add an optional `federationProviders` prop to `AuthLogin`/`AuthRegister` that renders DS-styled social/enterprise sign-in buttons (browser redirect to `GET /auth/federation/:provider/start`), plus an authenticated link/unlink surface, and wire Google into the IdP screens. Additive-minor `@sentropic/auth-ui` 0.6.0 → 0.7.0 (D17).

## Scope / Guardrails
- Scope limited to `packages/auth-ui/**` + `apps/auth-idp/web/**` (prop wiring only).
- No migration, no API/auth-hono source, no design-system source.
- Make-only workflow, no direct Docker commands.
- Branch development happens in isolated worktree `tmp/br39e-lot6`.
- Automated tests run on a dedicated env (`ENV=test-br39e-lot6`), never on `dev`.
- All new text in English (label presets ship EN + FR).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/auth-ui/**`
  - `packages/auth-ui/package.json`
  - `apps/auth-idp/web/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/auth-hono/**`, `api/**`, migrations
  - `packages/design-system-*/**`
  - any other package
- **Conditional Paths (allowed only with explicit exception)**:
  - none
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- none

## AI Flaky tests
- None observed; suite is deterministic (node-environment vitest).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single orthogonal UI additive-minor; one test cycle)
- [ ] **Multi-branch**
- Rationale: one cohesive additive-minor package change plus its host wiring.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT on the integrated branch after merge (UI change present).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read spec `SPEC_EVOL_39E_SOCIAL_FEDERATION.md` (D17) + ground components/tests.
  - [x] Confirm isolated worktree `tmp/br39e-lot6` on `feat/br39e-lot6-ui`.
  - [x] Confirm scope and guardrails.

- [x] **Lot 1 — Federation contracts + helpers + i18n + tests**
  - [x] `src/federation.ts`: `AuthUiFederationProvider`, `AuthUiLinkedIdentity`, `isLastSignInFactor`, glyph + label helpers.
  - [x] Add federation/identity labels to `AuthUiLabels` + EN/FR presets.
  - [x] `tests/federation.test.ts` (15 tests): last-factor guard, glyph resolution, i18n, backward-compat.

- [x] **Lot 2 — Components**
  - [x] `AuthProviderGlyph.svelte` (DS-neutral monochrome glyphs, text fallback).
  - [x] `AuthFederationButtons.svelte` (divider + "Continue with {label}" redirect buttons).
  - [x] `AuthLinkedIdentities.svelte` (list + unlink guarded by last-factor + link-another).
  - [x] `.svelte.d.ts` typings + package.json exports + version 0.7.0.

- [x] **Lot 3 — Wire prop into AuthLogin/AuthRegister**
  - [x] `federationProviders?` prop; empty/absent → no federation UI (K-UI-LEGACY).

- [x] **Lot 4 — Wire IdP screens**
  - [x] Google button on login + register (`/api/v1/auth/federation/google/start` + query passthrough).

- [x] **Lot gate**
  - [x] `make typecheck-auth-ui` — clean.
  - [x] `make test-auth-ui ENV=test-br39e-lot6` — 49 passed (15 new).
  - [x] `make typecheck-idp-web` — svelte-check 0 errors / 0 warnings.
