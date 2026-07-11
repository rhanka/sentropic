# Feature: Branded AppChrome header on IdP auth screens (BR-39e Lot A)

## Objective
Render the real DS-branded header (brand zone SENT logo mark + wordmark) on the standalone IdP auth screens by configuring the design-system-svelte `AppChrome` brand zone (OD4, config-only, reversible), consistent with the main app's canonical header — without duplicating `ui/Header.svelte`.

## Scope / Guardrails
- Scope limited to `apps/auth-idp/web/**` (config + static asset).
- No DS-package change: `AppChrome` already exposes `logoSrc`; config only.
- Make-only workflow, no direct Docker commands.
- Branch development happens in isolated worktree `tmp/auth-brand-header`.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `apps/auth-idp/web/**`
  - `packages/design-system-svelte/src/**` (only if a brand-zone prop/slot were missing — NOT used; not present in this repo)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/auth-hono/**`, `packages/auth-ui/**`, `api/**`, migrations
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - none
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- `acknowledge`: DS package (`@sentropic/design-system-svelte`) is an external npm dependency (`^0.34.0`, resolves 0.34.48) — its `src/**` is not in this repo. No DS change was needed; `AppChrome` already supports `logoSrc`, so the requirement is met by config alone (preferred outcome).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (orthogonal single-file config + asset; one test cycle)
- [ ] **Multi-branch**
- Rationale: Single small config change scoped to one app; no independent CI needed.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Ground on `ui/Header.svelte`, `apps/auth-idp/web/+layout.svelte`, DS `AppChrome`, `screen-smoke.ts`.
  - [x] Confirm isolated worktree `tmp/auth-brand-header`.
  - [x] Confirm scope and guardrails.

- [x] **Lot 1 — Branded AppChrome brand zone**
  - [x] Ship `SENT-logo-squared.svg` into `apps/auth-idp/web/static/` (same asset the main app serves).
  - [x] Configure `AppChrome` with `logoSrc="/SENT-logo-squared.svg"` in `apps/auth-idp/web/src/routes/+layout.svelte` (keep `brandName="SENT"`, `productName="Sentropic ID"`, entropicTheme, locale).
  - [x] Lot gate:
    - [x] `make typecheck-idp-web` — svelte-check found 0 errors and 0 warnings.
    - [x] `make build-idp-web` — production build OK; `build/SENT-logo-squared.svg` shipped; root-layout chunk references the logoSrc.
    - [ ] `make dev-idp` + `make smoke-idp-screens` — screen smoke assertions (login heading / consent Approve / token exchange) are orthogonal to a decorative brand-logo addition; not booted to avoid colliding with a possible live `ENV=dev` shared-DB stack (project footgun). Command recorded for the integration test cycle.

- [ ] **Lot N — Final validation**
  - [x] Typecheck (svelte-check) green.
  - [ ] PR opened; branch CI to run on the PR.
  - [ ] Merge after CI + UAT sign-off (conductor/owner).
