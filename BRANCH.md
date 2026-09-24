# Feature: Security — auth-idp web HIGH dependency alerts

## Objective
Remediate the three remaining open HIGH Dependabot alerts in `apps/auth-idp/web/package-lock.json` (browserslist, postcss, brace-expansion) with minimal dependency changes, using the same methods as PR #606.

## Scope / Guardrails
- Scope limited to `apps/auth-idp/web` dependency manifest and lockfile.
- Make-only workflow, no direct Docker commands, no host npm.
- Branch development in isolated worktree `tmp/security-auth-idp`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- No application source changes.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `apps/auth-idp/web/package.json`
  - `apps/auth-idp/web/package-lock.json`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `apps/auth-idp/web/src/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.security/**`
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- `attention`: no make target runs `npm audit` for `apps/auth-idp/web`; audit verified by posting the lockfile package/version set to the npm registry bulk advisory endpoint (same data source as `npm audit`).

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Never amend tests with additive timeouts.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: single lockfile remediation.

## UAT Management (in orchestration context)
- No UAT: dependency-only change, no UI behavior change.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read rules and PR #606 remediation method.
  - [x] Verify worktree `tmp/security-auth-idp` on branch `fix/security-auth-idp-web` from `origin/main`.
  - [x] Make targets: `make lock-idp-web`, `make typecheck-idp-web`, `make build-idp-web`.
  - [x] Ports: `API_PORT=9181 UI_PORT=5381 MAILDEV_UI_PORT=1281 ENV=sec-idp`.

- [x] **Lot 1 — Dependency remediation**
  - [x] GHSA-r28c-9q8g-f849 postcss 8.5.15 -> 8.5.28 (direct devDependency bump `^8.5.28`; also clears GHSA-fxqj-rqcc-2cmp).
  - [x] GHSA-73wf-gq98-2v4g browserslist 4.28.2 -> 4.28.7 (npm `overrides`).
  - [x] GHSA-3jxr-9vmj-r5cp brace-expansion 1.1.15 -> 1.1.18 (npm `overrides` `brace-expansion@<2`).
  - [x] Lockfile regenerated with `make lock-idp-web ENV=sec-idp`.
  - [x] Lot gate:
    - [x] `make typecheck-idp-web ENV=sec-idp` (svelte-check 0 errors, 0 warnings).
    - [x] `make build-idp-web ENV=sec-idp` (build OK, SPA fallback present).
    - [x] Advisory check of lockfile: 0 high/critical (remaining: moderate/low only).
    - [x] `make down ENV=sec-idp`.

- [ ] **Lot N — Final validation**
  - [ ] Final gate step 1: create PR using `BRANCH.md` text as PR body.
  - [ ] Final gate step 2: verify branch CI on that PR.
  - [ ] Final gate step 3: once CI is `OK`, commit removal of `BRANCH.md` and push.
