# Feature: BR-39e Lot 4 Apple Federation

## Objective
- [ ] Add Sign in with Apple behind the existing federation broker with runtime ES256 client secrets, verified OIDC identity, POST `form_post` callbacks, and manual-link-only collision handling.

## Scope / Guardrails
- [ ] Limit implementation to `api/**` plus this temporary branch plan.
- [ ] Add no migrations and make no package changes.
- [ ] Use Make targets for build, lint, and tests with `ENV` last.
- [ ] Run automated tests only on `ENV=br39e-lot4` with `API_PORT=8791`, `UI_PORT=5177`, and `MAILDEV_UI_PORT=1084` whenever a stack starts.
- [ ] Keep all code, tests, commits, and PR text in English.

## Branch Scope Boundaries (MANDATORY)
- [ ] **Allowed Paths (implementation scope)**
  - [ ] `api/**`
  - [ ] `BRANCH.md` until the final merge-prep commit
- [ ] **Forbidden Paths (must not change in this branch)**
  - [ ] `Makefile`
  - [ ] `docker-compose*.yml`
  - [ ] `packages/**`
  - [ ] `.cursor/rules/**`
  - [ ] `plan/**`
- [ ] **Conditional Paths**
  - [ ] None.
- [ ] **Exception process**
  - [ ] Declare `BR39e-L4-EXn` with reason, impact, and rollback before any scope exception.

## Feedback Loop
- [ ] No blocker, deferred item, or scope exception is open.

## AI Flaky tests
- [ ] No AI/network test is in scope; all scoped unit failures are blocking.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch** with atomic commits and one final validation cycle.
- [ ] **Multi-branch**.
- [x] Rationale: Apple is one dedicated provider lot stacked on the completed Google/GitHub federation seam.

## UAT Management (in orchestration context)
- [x] No live-provider UAT is possible without owner-managed Apple credentials; pure unit keystones and API gates are authoritative for this lot.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline and constraints**
  - [x] Confirm branch `feat/br39e-lot4-apple` mechanically.
  - [x] Read `rules/MASTER.md`, workflow/testing rules, the EVOL D15/D16 scope, provider matrix, Lot 4, routes, and keystones.
  - [x] Inspect Google/GitHub providers, broker, registry, types, pending store, route, env, and unit-test patterns.
  - [x] Inspect installed Arctic 3.7.0 Apple constructor and client-secret behavior.
  - [x] Confirm api-only scope, no migration, no package change, and isolated ports/environment.
  - [ ] Gate: `make scope-check`.

- [ ] **Lot 1 — Apple provider and client secret**
  - [x] Add `apple-provider.ts` with a pure five-minute ES256 `mintAppleClientSecret` helper using `jose`.
  - [x] Construct Arctic Apple with PKCS#8 bytes, request `name email`, and set `response_mode=form_post` plus nonce.
  - [x] Verify Apple id_token signature, issuer, audience, mandatory nonce, subject, and verified email without returning upstream tokens.
  - [x] Capture the one-time Apple profile name/email and classify private-relay email as provider-scoped.
  - [ ] Gate: scoped provider unit tests and `make scope-check`.

- [ ] **Lot 2 — POST form callback transport**
  - [x] Add pure injectable callback parsing for Apple POST bodies and GET query parsing for non-Apple providers.
  - [x] Accept GET and POST callback routes while requiring Apple parameters from `parseBody()`.
  - [x] Pass the parsed one-time Apple profile through the broker verification seam for login and manual-link callbacks.
  - [x] Preserve bound flow-state cookie consumption on POST.
  - [ ] Gate: route cookie/form-post unit tests and `make scope-check`.

- [ ] **Lot 3 — Environment and registry**
  - [ ] Add optional Apple Services ID, team ID, key ID, private key, and redirect URI env values.
  - [ ] Register Apple feature-OFF unless all four required credentials exist.
  - [ ] Keep the auto-link allowlist Google-only so Apple and private-relay collisions require manual-link.
  - [ ] Gate: registry/provider unit tests and `make scope-check`.

- [ ] **Lot 4 — Keystone tests**
  - [ ] Add K-APPLE-SECRET signing and public-key verification coverage.
  - [ ] Add id_token issuer/audience/nonce and private-relay/manual-link coverage.
  - [ ] Add K-APPLE-FORMPOST POST-body parsing, first-auth profile capture, and GET-query-negative coverage.
  - [ ] Gate: `make test-api-unit SCOPE="federation-apple-provider federation-broker federation-route-cookies" ENV=br39e-lot4`.

- [ ] **Lot 5 — Final validation and closure**
  - [ ] Run `make typecheck-api` with zero errors.
  - [ ] Run the required scoped API unit command with all tests passing.
  - [ ] Run `make exec-api CMD="npm run lint"` if no dedicated API lint target is available.
  - [ ] Run two independent review lenses and reconcile all blocking findings.
  - [ ] Run final `make scope-check` and `harness check scope`.
  - [ ] Tear down `ENV=br39e-lot4` and verify no branch services remain.
  - [ ] Remove `BRANCH.md` in the final pre-push commit.
  - [ ] Push `feat/br39e-lot4-apple` and open the requested PR against `main`.
