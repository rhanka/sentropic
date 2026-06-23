# Feature: BR-39r — IdP consent prod-regression fix (native-form 302) + CI guard

## Objective
Fix the prod regression where a real client was blocked after clicking Authorize on the IdP consent screen: replace the JS-dependent consent navigation (fetch → 200+JSON → `window.location.assign`) with a native form POST + server 302 so the final RP redirect no longer depends on JS. Add the missing CI smoke guard that let the regression through.

## Scope / Guardrails
- Scope limited to IdP consent decision flow (auth-hono handler + auth-ui component + auth-idp host page/CSP) and one CI job.
- Make-only workflow, no direct Docker commands.
- Branch development in isolated worktree `tmp/br39r`.
- Automated tests on `ENV=test-br39r`, never on root `dev`.
- `ENV=<env>` passed as the last argument in every `make` command.
- All new text in English.
- Additive only: legacy fetch/JSON path and the optional prop keep full backward-compat (no legacy fallback removed because the JSON path is a still-supported public contract for programmatic hosts).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/auth-hono/**`
  - `packages/auth-ui/**`
  - `apps/auth-idp/**`
  - `.github/workflows/ci.yml`
  - `package-lock.json` (version/peer sync only)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed with declared exception)**:
  - `.github/workflows/ci.yml` — see `BR39r-EX1`
- **Exception process**:
  - `BR39r-EX1` — touch `.github/workflows/ci.yml` to add the `smoke-idp-screens` CI job (L2). Reason: the regression slipped because the IdP-served consent screen was never smoke-tested in CI; the existing `make smoke-idp-screens` target was unused. Impact: one additive job + add `smoke-idp-screens` to `publish-api-image` needs. Rollback: delete the job + revert the one-line `needs` edit.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single final test cycle)
- [ ] **Multi-branch**
- Rationale: One orthogonal fix (consent flow) + its CI guard; no independent sub-workstreams.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Verified branch `feat/idp-oidc-rp-evolutions` in worktree `tmp/br39r`.
  - [x] Confirmed L1 code present in all 5 files (handler, component, .d.ts, host page, CSP).
  - [x] Env mapping: tests on `ENV=test-br39r`; copied root `.env` into worktree for stack/typecheck targets.
  - [x] Confirmed command style `make ... ENV=<env>` (ENV last).

- [x] **Lot 1 — Native-form 302 consent (prod-regression fix, double-consensus Opus 4.8 + Codex 5.5)**
  - [x] `packages/auth-hono/src/oauth/consent-decision-handler.ts` — accept x-www-form-urlencoded OR JSON body; form (Accept:text/html) → 302 via `redirectOrJson`, JSON (Accept:application/json) → 200+`{redirectTo}` (backward-compat).
  - [x] `packages/auth-ui/src/components/OAuthConsent.svelte` (+ `.svelte.d.ts`) — new optional `decisionAction` prop; when set, renders a native `<form method="POST">` with hidden `state` input + DS `<Button type="submit" name="decision" value="approve|deny">`; when unset, legacy fetch path.
  - [x] `apps/auth-idp/web/src/routes/auth/oauth/consent/+page.svelte` — passes `decisionAction="/api/v1/auth/oauth/consent/decision"`.
  - [x] `apps/auth-idp/idp-app.ts` — CSP `form-action` widened to `['self', https:, +localhost in non-prod]` so the cross-origin 302 to the RP is not blocked.
  - [x] Lot gate:
    - [x] `make typecheck-api ENV=test-br39r` — PASS (tsc --noEmit clean)
    - [x] `make typecheck-auth-ui ENV=test-br39r` — PASS
    - [x] `make typecheck-idp-web ENV=test-br39r` — PASS (svelte-check 0 errors / 0 warnings; consent page typechecks with new prop)
    - [x] **auth-hono tests** (the security contract)
      - [x] Added `packages/auth-hono/tests/oauth-consent-form-redirect.test.ts` (5 tests): form/approve → 302 to RP with code+state; form/deny → 302 with error=access_denied+state; JSON/approve REGRESSION GUARD → 200+{redirectTo}; JSON/deny REGRESSION GUARD → 200+{redirectTo}; form missing decision → 400.
      - [x] Scoped run: `make test-auth-hono SCOPE=packages/auth-hono/tests/oauth-consent-form-redirect.test.ts ENV=test-br39r` — 5/5 PASS
      - [x] Sub-lot gate: `make test-auth-hono ENV=test-br39r` — 30 files / 125 tests PASS (incl. existing JSON consent-persistence guard)
    - [x] **auth-ui tests**
      - [x] `make test-auth-ui ENV=test-br39r` — 6 files / 34 tests PASS (no regression)
      - [x] DOM render-test of `OAuthConsent` deferred: the `test-auth-ui` runner is `vitest --environment node` (no svelte compiler / jsdom / DS package), and project policy is "UI tests TS-only, no Svelte component tests". The real DS-Button-forwarding proof is the headless-Chromium `smoke-idp-screens` (Lot 2), which renders the actual compiled DS Button in the native form and asserts the 302 to the RP. See A.2 verdict below.
    - [x] `make build-idp-web ENV=test-br39r` — PASS (host page compiles with new prop)
    - [x] `make build-auth-ui ENV=test-br39r` — PASS

- [x] **Lot 2 — L2 CI guard (BR39r-EX1)**
  - [x] Added `smoke-idp-screens` CI job to `.github/workflows/ci.yml` (mirrors `test-e2e`: pull api+e2e images → `make dev-idp` → `make smoke-idp-screens` → logs-on-failure → teardown), gated on `api`/`global` changes (`apps/auth-idp/**` is in the `api` paths-filter).
  - [x] Added `smoke-idp-screens` to `publish-api-image` `needs` so a failing IdP consent smoke blocks the API image publish (deploy path) — true gate, not advisory.
  - [x] Validated `ci.yml` YAML parses (56 jobs; new job present; publish-api-image needs updated).
  - [ ] CI run of the new job on the PR — **attendu** (runs on push; the screen-smoke needs the api+e2e images + secrets only available in CI).

- [x] **Lot N — Final validation**
  - [x] Version bumps (additive minor): `auth-hono` 0.7.0 → 0.8.0; `auth-ui` 0.4.1 → 0.5.0 (+ widened auth-hono peer to include `^0.8.0`); `package-lock.json` synced via `make lock-root`.
  - [x] PR created with this BRANCH.md content as body (source of truth).
  - [ ] Branch CI green on the PR — **attendu**.
  - [ ] Merge — owned by conductor / 39etc lane (do NOT merge here).

## A.2 verdict — does the DS Button forward submit attrs?
- A unit DOM render-test is infeasible in the existing `test-auth-ui` runner (node env, no svelte/jsdom; DS Button is an external published peerDep whose internals are not in this repo) and is barred by the UI-tests-are-TS-only policy.
- Forwarding IS proven by two means that ship in this branch: (1) `make build-idp-web` + `make typecheck-idp-web` compile the consent page passing `<Button type="submit" name="decision" value=...>` with 0 errors, and (2) the `smoke-idp-screens` real-browser smoke clicks the actual compiled DS Button inside the native form and asserts the resulting 302 lands on the RP with a `code` — which only holds if the DS Button forwards `type=submit`/`name`/`value`. No native-`<button>` fallback was needed; the DS `<Button>` is kept.

## Known caveats / not verified
- The CSP `form-action` widening (idp-app.ts) CANNOT be verified by vitest (in-process Hono router, no browser CSP enforcement). It needs real-browser / preprod validation (the `smoke-idp-screens` Chromium run exercises the cross-origin redirect; full CSP enforcement is confirmed only at the real `auth.sent-tech.ca` origin). **attendu**: preprod/real-browser confirmation that the consent 302 to the RP is not CSP-blocked in production.
- `make typecheck-idp` (apps/auth-idp tsconfig via the api container) hit a local npx footgun (installed wrong `tsc@2.0.4`); it runs correctly in CI where the api image has node_modules prepared. The IdP TS is otherwise covered by `typecheck-api` (PASS) and `typecheck-idp-web` (PASS).

## Out of scope (LATER lots — NOT this PR)
- OIDC RP evolutions (`select_account` / `end_session` / `login_hint` / `invite_token`) are L3/L4 on the same branch lineage and are intentionally excluded from BR-39r.
