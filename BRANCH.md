# Feature: BR-39e Lot 5 Facebook Federation

## Objective
- [ ] Add Facebook OAuth2 federation through the existing broker, email-challenge, and manual-link paths.
- [ ] Preserve D1/D8/D9: drop Facebook tokens, never auto-link Facebook collisions, and never create a no-email user.

## Scope / Guardrails
- [ ] Limit implementation and tests to `api/**` plus this temporary branch plan.
- [ ] Add no migration and no dependency or package changes.
- [ ] Reuse the existing GET callback, broker, pending store, challenge completion, and manual-link flow.
- [ ] Use Make-only Docker-first verification with `ENV=br39e-lot5` last.
- [ ] Reserve API `8792`, UI `5178`, and MailDev UI `1085` for any branch stack.
- [ ] Keep all code, tests, comments, commits, and PR text in English.

## Branch Scope Boundaries (MANDATORY)
- [ ] **Allowed Paths (implementation scope)**
  - [ ] `BRANCH.md`
  - [ ] `api/src/config/env.ts`
  - [ ] `api/src/services/auth/federation/facebook-provider.ts`
  - [ ] `api/src/services/auth/federation/registry.ts`
  - [ ] `api/tests/unit/auth/federation-facebook-provider.test.ts`
  - [ ] `api/tests/unit/auth/federation-broker-facebook.test.ts`
- [ ] **Forbidden Paths (must not change in this branch)**
  - [ ] `Makefile`
  - [ ] `docker-compose*.yml`
  - [ ] `.cursor/rules/**`
  - [ ] `packages/**`
  - [ ] `api/drizzle/**`
  - [ ] `plan/**`
- [ ] **Conditional Paths**
  - [ ] None.
- [ ] **Exception process**
  - [ ] Declare and approve `BR39e-L5-EXn` in `## Feedback Loop` before any scope exception.

## Feedback Loop
- [ ] No blockers, decisions, scope exceptions, or accepted flaky tests.

## AI Flaky tests
- [ ] No AI or network-backed tests are in scope; all Facebook tests use injected fakes.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch**
- [ ] **Multi-branch**
- [x] No subagents; the provider, registry, environment, and pure-unit test changes form one API lane.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline and constraints**
  - [x] Verify branch `feat/br39e-lot5-facebook` mechanically with `harness check branch`.
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/testing.md`, and relevant harness skills.
  - [x] Read EVOL sections 2, 3.3, 4, 5, 6, and 7 plus the stacked GitHub/broker patterns.
  - [x] Inspect installed Arctic `Facebook`: state plus scopes supported; PKCE unsupported by its API.
  - [x] Confirm the initial worktree is clean and assigned ports are free.
  - [x] Lot gate: leave shared `.track` unchanged in this concurrent worktree; `make scope-check` passes.

- [x] **Lot 1 — Facebook provider and registration**
  - [x] Add `facebook-provider.ts` with Arctic OAuth2, scopes `email public_profile`, and Graph `/me?fields=id,name,email`.
  - [x] Derive `subject` from string `id`; expose optional email as unverified; return no token-bearing field.
  - [x] Inject `fetchImpl`; fail closed on Graph errors or missing string `id`.
  - [x] Register Facebook feature-OFF without client credentials and default its callback from the issuer.
  - [x] Add optional Facebook client id, secret, and redirect URI environment keys.
  - [x] Lot gate: `make typecheck-api` and `make scope-check` pass before the atomic provider commit.

- [ ] **Lot 2 — Facebook keystones**
  - [x] Add pure provider tests for authorization scopes, Graph identity derivation, absent email, failures, and token no-leak.
  - [x] Add K-FB-CHALLENGE proving absent email issues the existing challenge with no user, identity, or session created.
  - [ ] Prove Facebook subject-first login, credentialed collision manual-link, and no auto-link for shell collisions.
  - [ ] Run `make test-api-unit SCOPE="federation-facebook-provider federation-broker" ENV=br39e-lot5`.
  - [ ] Lot gate: `make scope-check` and commit keystone tests atomically.

- [ ] **Lot 3 — Final validation and publication**
  - [ ] Run `make typecheck-api` with zero errors.
  - [ ] Run `make exec-api CMD="npm run lint"` if no narrower lint target is available.
  - [ ] Run `make test-api-unit SCOPE="federation-facebook-provider federation-broker" ENV=br39e-lot5` with all tests passing.
  - [ ] Run harness review with at least two independent peers and reconcile findings.
  - [ ] Run `make scope-check` and `harness check scope`.
  - [ ] Tear down with `make down ENV=br39e-lot5` and confirm no branch services remain.
  - [ ] Remove `BRANCH.md` in the final pre-push commit.
  - [ ] Push `feat/br39e-lot5-facebook` and create the requested PR against `main`.
