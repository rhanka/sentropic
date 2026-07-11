# Feature: BR-39e Social Federation Lot 3 — Microsoft Entra ID

## Objective
- [ ] Add Microsoft Entra ID behind the existing federation provider seam with `oid` subject, `tid` tenant, mandatory nonce, PKCE S256, issuer/audience verification, and manual-link-only behavior.

## Scope / Guardrails
- [x] Work only in `/home/antoinefa/src/sentropic/tmp/br39e-lot3-ms` on `feat/br39e-lot3-microsoft`.
- [x] Use Make-only verification with `ENV=br39e-lot3` last.
- [x] Use `API_PORT=8790`, `UI_PORT=5176`, and `MAILDEV_UI_PORT=1083` for any stack command.
- [x] Add no migration and no package change.
- [x] Keep all code, comments, commits, and PR text in English.

## Branch Scope Boundaries
- **Allowed Paths (implementation scope)**:
  - `api/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `packages/**`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `plan/**`
  - `spec/**`
- **Conditional Paths**:
  - None.
- **Exception process**:
  - [x] No exception declared or required.

## Feedback Loop
- [x] No blocking feedback or scope exception.

## Orchestration Mode
- [x] Mono-branch.
- [ ] Multi-branch.

## Plan / Todo
- [x] **Lot 0 — Baseline and constraints**
  - [x] Verify the branch mechanically with `harness check branch`.
  - [x] Read repository rules, committed federation design, existing provider seam, route, env, and reference tests.
  - [x] Confirm `api/**`-only implementation scope and no migration/package changes.
- [x] **Lot 1 — Microsoft provider and configuration**
  - [x] Add `api/src/services/auth/federation/microsoft-provider.ts` with Entra authorization, nonce, PKCE, verified id token, `oid`, and `tid` policy.
  - [x] Register feature-OFF `microsoft` in `api/src/services/auth/federation/registry.ts`.
  - [x] Add optional Microsoft OAuth env configuration in `api/src/config/env.ts`.
  - [x] Keep `AUTO_LINK_PROVIDERS` Google-only and reuse existing GET callbacks and broker logic.
- [ ] **Lot 2 — Microsoft keystone tests**
  - [ ] Add `api/tests/unit/auth/federation-microsoft-provider.test.ts` for auth URL, signature/issuer/audience verification, mandatory nonce, `oid` subject, `tid` tenant, unverified email, and token no-leak.
  - [ ] Prove K-MS-SUBJECT across same-`sub` identities in distinct tenants through the shared broker seam.
  - [ ] Prove Microsoft email collision routes to manual-link and never auto-links.
  - [ ] Run `make test-api-unit SCOPE="federation-microsoft-provider federation-broker" ENV=br39e-lot3`.
- [ ] **Lot 3 — Final validation and delivery**
  - [ ] Run `make typecheck-api ENV=br39e-lot3`.
  - [ ] Run `make lint-api ENV=br39e-lot3` or the documented `make exec-api` fallback.
  - [ ] Run `make scope-check` before every commit.
  - [ ] Run harness consensus review and resolve blocking findings.
  - [ ] Push `feat/br39e-lot3-microsoft` and open the requested PR against `main`.
  - [ ] Verify GitHub Actions.
  - [ ] Run `make down ENV=br39e-lot3`.
  - [ ] Remove `BRANCH.md` in the final pre-push commit.
