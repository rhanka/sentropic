# Feature: JWT secret separation Step 1

## Objective
Decouple at-rest credential encryption from JWT signing without changing legacy ciphertext
readability, and make the OAuth signing KEK primary for continuation state.

## Scope / Guardrails
- Implement Step 1 only from `spec/SPEC_EVOL_SECRET_KEY_SEPARATION.md`.
- Keep all secret inputs byte-exact and retain the existing at-rest fallback.
- Do not change deployments, manifests, migrations, CI, or secret values.

## Branch Scope Boundaries
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/config/env.ts`
  - `api/src/services/secret-crypto.ts`
  - `api/src/routes/auth/oauth.ts`
  - `api/tests/unit/secret-crypto.test.ts`
  - `api/tests/unit/oauth-state-secret.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `.env*`
  - `.github/workflows/**`
  - `Makefile`
  - `api/drizzle/**`
  - `deploy/**`
  - `docker-compose*.yml`
- **Conditional Paths (allowed only with explicit exception)**:
  - `spec/**`

## Plan / Todo
- [x] **Lot 1 — Step 1 key separation**
  - [x] Add the optional credential encryption key configuration.
  - [x] Preserve legacy envelope derivation and verify byte-exact compatibility.
  - [x] Invert OAuth continuation-state precedence to prefer the OAuth KEK.
  - [x] Prove both tests fail before the fix and pass after it.
  - [x] Prove the crypto test fails under a temporary newline KDF mutation.
  - [x] Run scoped API tests, typecheck, lint, branch check, and scope check.
