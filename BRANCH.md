# Feature: SG0-app GitHub App enrollment by cluster-mesh

## Objective
- [ ] Deliver G0 v3 §2.7 enrollment, encrypted custody, repository leases and rotation for the initial Immo and Sentropic repositories.

## Scope / Guardrails
- [x] Binding contract: `.tmp/concertation-git-artifact/G0-FROZEN-v3.md`, SHA-256 `4c405c8f49e9d242d65eebe35a14a45e4826afc0007e9f94a7fe21d7404e21ba`.
- [x] Worktree `tmp/worktrees/sg0-app`; branch `feat/git-artifact-sg0-app`; base `origin/main`.
- [x] Docker commands use `.tmp/packets/docker-slot.sh`; Make only; ENV last; no Python.
- [x] Environment `test-sg0-app`; API_PORT=9585 UI_PORT=5785 MAILDEV_UI_PORT=1685.
- [x] No live GitHub enrollment, merge, version bump, lock/pin/fixture/L5 regeneration or credential output.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/cluster-mesh/src/forge/**`
  - `packages/cluster-mesh/src/index.ts`
  - `packages/cluster-mesh/tests/forge/**`
  - `packages/cluster-mesh/docs/github-app-enrollment.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `package-lock.json`
  - `packages/*/package.json`
  - `tools/memory-mcp-l5/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - [x] Record reason, impact and rollback in Feedback Loop before changing a conditional path.

## Feedback Loop
- [x] Train owner explicitly overrides package-bump and final merge rules: one READY wagon PR, no merge; integration lane owns publication inputs.
- [ ] Conductor imports this source plan into Track as designated writer; this concurrent lane does not write `.track`.
- [ ] P2 real-forge enrollment, prompts and rotation receipts remain activation gates; fake GitHub tests cannot certify them.

## AI Flaky tests
- [x] No AI-dependent tests; no accepted flakes or timeout increases.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; no delegated implementation or cherry-picks.

## UAT Management (in orchestration context)
- [x] No real owner enrollment during this wagon; document the exact owner gesture and host prompt location.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read common rules, MASTER, workflow, testing, approved contract and template; harness C1 passed.
- [ ] **Lot 1 — Tests first**
  - [x] Added fake GitHub and manifest/install, callback replay/expiry and scope/repo denial tests before production code.
  - [x] Initial scoped run fails because the forge domain is absent; added permission, dual-repo, rotation and revocation cases before implementation.
  - [ ] `tests/forge/github-app.spec.ts`: fake manifest/install, scoped mint, escalation refusal, state replay/scope refusal, expiry, rotation and revocation.
  - [ ] `tests/forge/github-app-http.spec.ts`: owner prompt, callback sanitization and broker authentication.
- [ ] **Lot 2 — Enrollment and custody**
  - [x] Added the exact frozen lease/webhook ports and internal encrypted-store transaction contract.
  - [x] Implemented authenticated-encryption custody; specified host prompt and service authentication tests before routing implementation.
  - [x] Added owner/scope/repo-bound expiring single-use manifest and installation callbacks.
  - [x] Added fixed-origin GitHub REST exchange, RS256 App authentication, selected-repo discovery and narrowed installation token minting.
  - [x] Added owner-authenticated prompt/callback routes and authenticated, tuple-bound lease broker; exported host composition factories.
  - [x] Added owner rotation/revocation forms, same-origin mutation checks and the authenticated HMAC broker transport.
  - [ ] `src/forge/*`: durable encrypted custodian, manifest/callback routes, installation records and exact §2.7 ports.
- [ ] **Lot 3 — Lifecycle and runbook**
  - [x] Added exact-permission repository token leases, revocation fencing and bounded HMAC overlap verification.
  - [x] Added verified App-key replacement and staged webhook rotation with a separate sender switch; specified REST adapter tests first.
  - [x] Added HMAC-authenticated installation suspension, uninstall, repository-removal and permission-change handling.
  - [x] Added explicit secret retirement and ciphertext tamper/substitution and concurrent callback checks.
  - [x] Required a sanitized host invalidation callback to discard adapter caches and fence dependent jobs on revocation/key rotation.
  - [x] Added renewal/lifetime and host-notification failure checks; retain rejected minted bearers for revocation and conversion credentials through verification failures.
  - [ ] Deliver App-key and bounded webhook-secret rotation, token revocation and installation-change fencing.
  - [x] Document owner clicks and activation gates in `docs/github-app-enrollment.md`.
  - [x] Wrote the host-composition and owner-click runbook, including rotation, custody boundaries and unverified live P2 gates.
- [ ] **Lot 4 — Final validation and handoff**
  - [ ] Scoped `make test-cluster-mesh SCOPE=tests/forge ENV=test-sg0-app`; typecheck and lint.
  - [ ] Scope-check before each make commit; every commit under 150 changed lines.
  - [ ] Open one READY PR using this plan; observe CI green; no merge.
  - [ ] Write `.tmp/rv/sg0-app.md`; teardown with `make down-volumes ENV=test-sg0-app`.
