# Feature: Identity error surfacing (T1, s-archi A3)

## Objective
- [ ] A rolled-back CM host transaction caused by an expected HTTP refusal is logged as `identity_http_refusal` with its HTTP status and closed refusal code, never as `identity_host_failure`; any other non-custody, non-SQLSTATE error keeps `identity_host_failure` with its error type and, when present, its non-SQLSTATE driver code.
- [ ] The IdP web and the product UI no longer mask a 4xx auth response as « Network request failed »: the auth transport receives the response and the error message carries the closed error code of the `{ error: { code, message } }` DTO.

## Scope / Guardrails
- [ ] Branch fix/identity-error-surfacing from origin/main c22163106; worktree tmp/worktrees/t1-identity-errors; ENV=test-t1-identity-errors; ports API_PORT=9462 UI_PORT=5662 MAILDEV_UI_PORT=1562.
- [ ] Train T1 wagon (s-archi verdict 2026-11-08 adopted, amendment A3): branch push only, no PR, no version bump, no lock regeneration.
- [ ] Make only; no Python; no attribution trailers; never ENV=dev; commits of 150 lines max.
- [ ] Logs carry closed codes only: never an error message, SQL parameter, response body or credential material.
- [ ] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/identity/cm-transaction.ts`
  - `api/src/routes/namespaces/auth/cm-http.ts`
  - `api/tests/unit/identity/cm-transaction-failure-log.test.ts`
  - `apps/auth-idp/web/src/lib/api.ts`
  - `apps/auth-idp/web/src/lib/auth-transport.ts`
  - `ui/src/lib/utils/api.ts`
  - `ui/src/lib/services/auth-transport.ts`
  - `ui/tests/utils/auth-transport.test.ts`
  - `packages/auth-ui/src/transport-fetch.ts`
  - `packages/auth-ui/tests/transport-fetch.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `deploy/**`
  - `packages/auth-ui/package.json`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
  - `package-lock.json`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- [ ] `attention`: `packages/auth-ui/src/transport-fetch.ts` changes, so `enforce-package-bump` needs a `@sentropic/auth-ui` patch bump (0.9.0 on main); per the wagon model the T1 train lane assigns it once with the train versions.

## AI Flaky tests
- Acceptance rule: Accept only non-systematic provider/network/model nondeterminism as `flaky accepted` (at least one success on the same commit and command). Not applicable: no AI test in scope.

## Orchestration Mode (AI-selected)
- [x] **Multi-branch**
- Rationale: train T1 wagon; the train lane merges the branch with its siblings and runs one CI.

## Plan / Todo (lot-based)
- [ ] **Lot 1 — Host transaction refusal log**
  - [ ] Tests first: `api/tests/unit/identity/cm-transaction-failure-log.test.ts` (custody code, HTTP refusal status and closed code, SQLSTATE direct and as cause, plain error, driver code, no message leak, refusal code bounded).
  - [ ] `cm-transaction.ts`: exported `CmHttpRefusalError` marker and `describeCmTransactionFailure`; refusals logged at info as `CM host transaction refused`, other failures at warn as before.
  - [ ] `cm-http.ts`: `HttpRefusal` extends the marker with the staged status and the closed code of its error DTO.
- [ ] **Lot 2 — Auth transports surface the closed code**
  - [ ] Tests first: `packages/auth-ui/tests/transport-fetch.test.ts` (nested `{ error: { code, message } }` DTO) and `ui/tests/utils/auth-transport.test.ts` (a 401 reaches the transport, its code is in the message, no « Network request failed »).
  - [ ] `packages/auth-ui/src/transport-fetch.ts`: read the nested DTO message and code.
  - [ ] IdP web `api.ts` and UI `utils/api.ts`: non-throwing `apiFetchResponse` (credentials, locale, scoping kept), `apiFetch` built on it; both `auth-transport.ts` use it.
- [ ] **Lot N — Final validation**
  - [x] `make typecheck-api` + `make lint-api` + `make typecheck-idp-web` + `make typecheck-ui` + `make lint-ui` (post-rebase 6b2fc2295: all PASS — lint-api 0 errors, typecheck-ui svelte-check 0 errors).
  - [x] Scoped runs: `make test-api-unit SCOPE=tests/unit/identity/cm-transaction-failure-log.test.ts ENV=test-t1-identity-errors` (7/7), `make test-auth-ui ENV=test-t1-identity-errors` (57/57), `make test-ui SCOPE=tests/utils/auth-transport.test.ts API_PORT=9462 UI_PORT=5662 MAILDEV_UI_PORT=1562 ENV=test-t1-identity-errors` (2/2) — post-rebase 6b2fc2295, all PASS.
  - [ ] Review `.h2a/reviews/t1-identity-error-surfacing-opus.md` (VERDICT line).
  - [ ] Push the branch; the T1 train lane assembles the PR and the CI.
