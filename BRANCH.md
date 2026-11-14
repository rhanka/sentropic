# Fix: Harden deployment secrets and complete T1 w9

## Objective
- [x] Deliver A-R3-5, T1-w9 and the design-system seed from the ratified App-to-cluster-mesh plan.

## Scope / Guardrails
- [x] Worktree: `tmp/secret-keys-hardening-w9`; branch: `fix/secret-keys-hardening-w9`; base: `938709b08`.
- [x] Environment: `test-cm-t1-w9`; API_PORT=9450, UI_PORT=5650, MAILDEV_UI_PORT=1550 (checked free).
- [x] Make-only, Docker-first; no cluster/prod actions; no T3 changes; no merge.
- [x] Keep OAuth KEK checks at resolver time; do not add a KEK boot gate (QA-8r2).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/config/deployment-secrets.ts`
  - `api/src/routes/auth/oauth.ts`
  - `api/src/services/google-drive-oauth.ts`
  - `api/src/services/auth/jwks-adapter.ts`
  - `api/src/services/auth/oauth-client-seed.ts`
  - `api/tests/unit/deployment-secrets.test.ts`
  - `api/tests/unit/oauth-state-secret.test.ts`
  - `api/tests/unit/google-drive-oauth.test.ts`
  - `api/tests/unit/auth/jwks-adapter.test.ts`
  - `api/tests/unit/auth/oauth-client-seed.test.ts`
  - `api/tests/unit/k8s-bundle-secret.test.ts`
  - `Makefile` (BRT1-EX1 only)
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `deploy/**`
  - `packages/**`
  - `.github/workflows/**`
  - `.track/**` (designated conductor writer only)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile` (BRT1-EX1)

## Feedback Loop
- [x] BRT1-EX1 — Authorized by cm-t1-w9 packet: change only k8s-bundle-secret to deliver JWT_SECRET and reject short/blank JWT_SECRET or SECRET_ENCRYPTION_KEY before any apply. Impact: incomplete deployed bundles fail closed. Rollback: revert this branch's bundle hunk; preserve provisioned cluster secrets. Local scope-check may use the installed host harness via an ignored make overlay, avoiding a tooling rebuild.
- [x] Track: update this mergeable source artifact; conductor imports it as the designated single writer. No concurrent .track writes.
- [x] No browser UAT: these are secret resolvers, bundle generation and database seed defaults; synthetic tests cover behavior without cluster access.
- [x] Review corrections: reject the committed IdP KEK seed in deployed resolvers; only update a seeded client's tenant policy when explicitly declared (A-R3-3).
- [x] Bundle review correction: preserve quoted hash/comment bytes and assert received synthetic key digests, including padding and equals signs.

## AI Flaky tests
- [x] No AI calls in scoped acceptance tests; no flaky allowance requested.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; independent code review before final push.

## UAT Management (in orchestration context)
- [x] Synthetic acceptance only; do not alter live secrets or existing design-system registrations.

## Plan / Todo (lot-based)
- [x] Lot 0 — Read rules, ratified plan and A-R3-5/w9 criteria; mechanically check branch and isolate ports.
- [x] Lot 1 — Minimum trimmed length 32; deployed OAuth/Drive/JWKS resolver validation; retain development behavior and key bytes.
  - [x] `api/tests/unit/deployment-secrets.test.ts`: lengths 0/1/31/32, whitespace, public seeds, boot gates.
  - [x] `api/tests/unit/oauth-state-secret.test.ts`: production refusal in OAuth/Drive/JWKS, KEK precedence, empty dev fallback; existing Drive sealing checks retained.
- [x] Lot 2 — Bundle JWT_SECRET and refuse incomplete deployed input before any kubectl apply (BRT1-EX1).
  - [x] `api/tests/unit/k8s-bundle-secret.test.ts`: fake kubectl only; incomplete input, boundaries, all three names, no disclosed values. All 7 cases pass.
- [x] Lot 3 — Explicit tenant-free design-system seed; preserve tenant requirement for other sample clients.
  - [x] `api/tests/unit/auth/oauth-client-seed.test.ts`: observe insert/update values without a live database.
- [x] Lot 4 — Scoped local tests through make, independent review, scope gate, atomic commits below 150 lines.
  - [x] 24 scoped deployment/OAuth/JWKS/DS/bundle assertions pass after review corrections; 3 existing Drive sealing assertions pass.
  - [x] ESLint passes for all five modified source files; repository config does not lint test files.
  - [x] An initial missing synthetic SCW_TEM_SECRET_KEY was added to the isolated test overlay; no real credentials loaded.
  - [x] The unfiltered Drive file needs Postgres for an unrelated callback-settings case; local acceptance targets sealing only, full file remains a CI gate.
  - [x] Two independent Astra high code reviews approve `41c4d691c` after all P1/P2 findings were corrected; final change is progress documentation only.
- [ ] Lot 5 — Push, PR with this document as body, exact-head green CI, report and done marker; no merge.

## Deferred to conductor
- [ ] Import this branch's deliverables and evidence into Track from the designated origin/main writer.
