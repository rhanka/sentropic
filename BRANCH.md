# Feature: Secret keys fail-closed and at-rest re-encryption tool (T1)

## Objective
- [ ] A deployed runtime (`requiresOAuthProductionSecrets`) refuses to sign or seal with a missing, blank or public development seed: `JWT_SECRET` (session JWTs, email tickets, LLM transport session ids) and `SECRET_ENCRYPTION_KEY` (at-rest envelopes, connector revocation custody). No literal fallback in a deployed runtime; the api and IdP listeners refuse to boot.
- [ ] Operator tool `node dist/index.js --secret-reencrypt [--apply]` moves every at-rest envelope from a source key (the development seed or `SECRET_REENCRYPT_SOURCE_KEY`) to the provisioned `SECRET_ENCRYPTION_KEY`; dry run by default; unreadable envelopes listed by identifier for the A2 audit.

## Scope / Guardrails
- [ ] Branch fix/secret-keys-fail-closed from origin/main c22163106; worktree tmp/worktrees/t1-secret-keys; ENV=test-t1-secret-keys; ports API_PORT=9461 UI_PORT=5661 MAILDEV_UI_PORT=1561.
- [ ] Train T1 wagon (s-archi verdict 2026-11-08 adopted, amendment A2): branch push only, no PR, no version bump, no lock regeneration.
- [ ] Make only; no Python; no attribution trailers; never ENV=dev; commits of 150 lines max.
- [ ] Dev/test keep the committed development seeds (byte-identical dev data); only a deployed runtime refuses them.
- [ ] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/config/deployment-secrets.ts`
  - `api/src/services/secret-crypto.ts`
  - `api/src/services/identity/cm-connector-envelope.ts`
  - `api/src/services/identity/cm-token-secrets.ts`
  - `api/src/services/llm-account-transports.ts`
  - `api/src/services/google-drive-oauth.ts`
  - `api/src/services/auth/jwks-adapter.ts`
  - `api/src/services/cluster-mesh/github-app-host.ts`
  - `api/src/routes/auth/oauth.ts`
  - `api/src/scripts/secret-reencrypt.ts`
  - `api/src/index.ts`
  - `apps/auth-idp/index.ts`
  - `api/tests/unit/deployment-secrets.test.ts`
  - `api/tests/unit/secret-crypto.test.ts`
  - `api/tests/unit/secret-reencrypt.test.ts`
  - `docs/secrets.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `deploy/**`
  - `packages/**`
  - `ui/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql`
  - `.github/workflows/**`
  - `api/package.json`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- [ ] `attention`: merge precondition for the train (no code workaround): the preprod product api has no `JWT_SECRET` (night plan 08/11, preserve-sessions.md); once this image runs in preprod the api refuses to boot until T1-ops provisions a non-seed `JWT_SECRET` in Secret `sentropic-api` (owner-reserved Secret-Store Write; invalidates the product sessions). The IdP keeps its own `auth-idp-session-signing` value (explicit `env` overrides `envFrom`).
- [ ] `attention`: prod order unchanged (A2): run `--secret-reencrypt --from-development-seed` against prod with the target key, set `SECRET_ENCRYPTION_KEY`, restart, re-run (idempotent), then deploy this image.

## AI Flaky tests
- Acceptance rule: Accept only non-systematic provider/network/model nondeterminism as `flaky accepted` (at least one success on the same commit and command). Not applicable: no AI test in scope.

## Orchestration Mode (AI-selected)
- [x] **Multi-branch**
- Rationale: train T1 wagon; the train lane merges the branch with its siblings and runs one CI.

## Plan / Todo (lot-based)
- [ ] **Lot 1 — Fail-closed deployment secrets**
  - [ ] Tests first: `api/tests/unit/deployment-secrets.test.ts` (dev seed, deployed refusal for unset/blank/seed values, e2e image runtime, boot gate, no literal outside the module) and `api/tests/unit/secret-crypto.test.ts` (deployed runtime without key refuses to seal and to borrow the custody key).
  - [ ] `api/src/config/deployment-secrets.ts`: development seeds, `isProvisionedDeploymentSecret`, `resolveDeploymentSecret`, `assertDeploymentSecrets`.
  - [ ] Consumers: `secret-crypto.ts`, `oauth.ts`, `cm-token-secrets.ts`, `llm-account-transports.ts`, `google-drive-oauth.ts`, `jwks-adapter.ts`, `github-app-host.ts`.
  - [ ] Boot gate in `api/src/index.ts` and `apps/auth-idp/index.ts`.
- [ ] **Lot 2 — Re-encryption tool**
  - [ ] Tests first: `api/tests/unit/secret-reencrypt.test.ts` (key parsing refusals, current/moved/unreadable for `enc:v1` values and connector custody envelopes, dry run writes nothing, apply swaps by compare-and-set, absent tables skipped, exit codes).
  - [ ] `secret-crypto.ts` and `cm-connector-envelope.ts` explicit-key primitives; `api/src/scripts/secret-reencrypt.ts`; `--secret-reencrypt` dispatch in `api/src/index.ts`.
  - [ ] `docs/secrets.md`: fail-closed rule, re-encryption procedure (prod order and preprod A2 audit).
- [ ] **Lot N — Final validation**
  - [ ] `make typecheck-api` + `make lint-api` + `make typecheck-idp`.
  - [ ] Scoped API unit runs: `make test-api-unit SCOPE="tests/unit/deployment-secrets.test.ts tests/unit/secret-crypto.test.ts tests/unit/secret-reencrypt.test.ts tests/unit/oauth-state-secret.test.ts tests/unit/google-drive-oauth.test.ts tests/unit/gmail-oauth.test.ts" ENV=test-t1-secret-keys`.
  - [ ] Review `.h2a/reviews/t1-secret-keys-fail-closed-opus.md` (VERDICT line).
  - [ ] Push the branch; the T1 train lane assembles the PR and the CI.
