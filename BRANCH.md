# Feature: Keep the Origin on the GitHub App enrollment forms

## Objective
- [x] Fix the preprod enroll defect (08/11 06:09, owner signed in as admin_app): `POST /api/v1/github-app/enroll?target=radar-immobilier` answered `{"error":"access_denied"}` because every SG0-app page was served with `referrer-policy: no-referrer`, under which a browser sends `Origin: null` on a non-CORS form POST (Fetch "append a request Origin header"), so the router's own forms always failed the strict `csrf()` Origin equality. Serve `referrer-policy: same-origin` instead; the strict Origin equality stays (no "null" accepted, CSRF kept).
- [x] Fix the next enroll step (i-cond, 08/11): github.com rejected the App manifest (« Default events unsupported: installation and installation_repositories »); the manifest carries no `default_events` (GitHub delivers both events to every App webhook without a subscription); `hook_attributes` and the webhook handler unchanged (commit 3b6b434c9, fix-manifest-events lane, report `.tmp/rv/fix-manifest-events.md`).

## Scope / Guardrails
- [x] Branch fix/github-app-form-origin from origin/main 0aa3b4043; worktree tmp/worktrees/fix-github-app-form-origin; ENV=test-ghapp-origin; ports API_PORT=9387 UI_PORT=5587 MAILDEV_UI_PORT=1487.
- [x] Make only; no Python, no attribution trailers, no CI skips or reruns; never ENV=dev.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/cluster-mesh/src/forge/hono.ts`
  - `packages/cluster-mesh/src/forge/enrollment.ts`
  - `packages/cluster-mesh/tests/forge/github-app-http.spec.ts`
  - `packages/cluster-mesh/package.json`
  - `packages/cluster-mesh/CHANGELOG.md`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`
  - `package-lock.json`
  - `api/package-lock.json`
  - `api/src/services/cluster-mesh/github-app-host.ts`
  - `api/src/app.ts`
  - `api/tests/unit/services/cluster-mesh/github-app-host.test.ts`
  - `api/tests/api/github-app-product-mount.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `deploy/**`
  - `ui/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- [x] `attention`: cluster-mesh 0.26.0-dev.18 is required by enforce-package-bump (src change); root/api lock workspace entries and the selected packaging fixture follow the version string only (the cluster-mesh fixture entry is a `file:` archive without integrity pin).
- [x] `attention`: the manifest form still posts cross-origin to github.com with no referrer and Origin "null" under same-origin, exactly as under no-referrer (unchanged for GitHub).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- Rationale: one fix PR, one CI.

## AI Flaky tests
- Acceptance rule: Accept only non-systematic provider/network/model nondeterminism as `flaky accepted` (at least one success on the same commit and command). Not applicable: no flaky test encountered this branch.

## Plan / Todo (lot-based)
- [x] **Lot 1 — Referrer policy and tests**
  - [x] `packages/cluster-mesh/src/forge/hono.ts`: `referrer-policy: same-origin` on every router response.
  - [x] `api/src/services/cluster-mesh/github-app-host.ts`: host header set `referrer-policy: same-origin`; `api/src/app.ts` comment aligned.
  - [x] `packages/cluster-mesh/tests/forge/github-app-http.spec.ts`: header value; enroll POST passes only with the exact public origin ("null", foreign, http, other port refused); browser regression: landing and rotation forms submitted with the Origin the served policy yields pass csrf(), the manifest form to github.com yields Origin "null".
  - [x] `api/tests/unit/services/cluster-mesh/github-app-host.test.ts`: header expectations; landing form action keeps `/api/v1` and `?target=radar-immobilier`; the browser-derived Origin passes (303 to the public prompt), Origin "null" stays access_denied.
  - [x] `api/tests/api/github-app-product-mount.test.ts`: header expectation.
  - [x] `packages/cluster-mesh/src/forge/enrollment.ts`: manifest without `default_events`; `github-app-http.spec.ts` asserts the manifest POSTed to github.com excludes `installation` and `installation_repositories` and keeps `hook_attributes` (3b6b434c9).
  - [x] cluster-mesh 0.26.0-dev.18: package.json, CHANGELOG, root/api lock entries, selected packaging fixture.
- [ ] **Lot 2 — Validation**
  - [x] `docker-slot.sh make test-cluster-mesh SCOPE=tests/forge/github-app-http.spec.ts ENV=test-ghapp-origin` PASS 5/5.
  - [x] `docker-slot.sh make test-cluster-mesh SCOPE=tests/forge ENV=test-fix-manifest-events` PASS 58/58 (fix-manifest-events lane, head 3b6b434c9).
  - [x] `make lint-cluster-mesh`, `make typecheck-cluster-mesh`, `make typecheck-api`, `make lint-api` (0 errors) ENV=test-ghapp-origin PASS.
  - [ ] `docker-slot.sh make test-api-unit SCOPE=tests/unit/services/cluster-mesh/github-app-host.test.ts API_PORT=9387 UI_PORT=5587 MAILDEV_UI_PORT=1487 ENV=test-ghapp-origin`.
  - [ ] PR « fix(github-app): keep the Origin on the enrollment forms », CI green on the exact head, GLM review `.h2a/reviews/pr-<n>-glm.md`.
