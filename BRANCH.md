# Feature: Repository-owned harness profiles

## Objective
- [ ] Enable sentbase and other repositories to own a strictly validated harness profile without changing the scope kernel.

## Scope / Guardrails
- [x] Owner packet: `.tmp/packets/harness-profile-file.md`; wagon `feat/harness-profile-file` from `origin/main` at `165ce5b93`.
- [x] Worktree: `tmp/worktrees/harness-profile-file`; test environment: `test-harness-profile-file`; no service ports required.
- [x] Make-only, Docker-first, no Python, no image builds, no attribution trailers; selective staging and `make commit` only.
- [x] No PR, version bump, lock regeneration or publish; integration lane assigns the wagon's version in the next dated train.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/harness/src/**`
  - `packages/harness/tests/**`
  - `packages/harness/schema/harness-profile.schema.json`
  - `packages/harness/README.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `package-lock.json`
  - `packages/harness/package.json`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - [x] Declare `BR99-EXn` with reason, impact and rollback before touching a conditional path.

## Feedback Loop
- [x] Tests-first receipt: CLI profile suite fails 11/14 against the unchanged kernel (loading, discovery, precedence, guards and configuration errors).
- [x] Owner requirements authorize the profile contract and precedence; preserve built-in C1/C2 behavior and advisory exit status.
- [ ] Track handoff: designated conductor imports the request, lots, deliverables and test receipts from this source; this lane does not append to the shared journal.
- [ ] Train handoff: consolidated independent review, version allocation, package qualification and CI belong to integration.

## AI Flaky tests
- [x] Deterministic unit/integration tests only; no accepted flaky cases.

## Orchestration Mode (AI-selected)
- [x] **Multi-branch** — one wagon, integrated and reviewed by the dated train lane.

## UAT Management (in orchestration context)
- [ ] CLI acceptance: load a Rust + Node profile, enforce Cargo.toml / .githooks/** / LICENSE restrictions, and reject invalid configuration with exit 2.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline**: mandatory reads, isolated worktree, mechanical `harness check branch`; reuse existing Node image only.
- [x] **Lot 1 — Tests first**: new `tests/cli/profile-file.spec.ts` and `tests/profile/profile-file.spec.ts`; red evidence for loading, discovery, precedence, strict validation and built-in regression matrices.
- [ ] **Lot 2 — Profile format**: JSON Schema, typed validation errors, serializable built-ins, file loader and root discovery; no dependency changes.
- [ ] **Lot 3 — Kernel and CLI**: profile path defaults, BRANCH conventions, commit guards; shared resolver for check/verify/audit/init; targeted tests and typecheck.
- [ ] **Lot 4 — Documentation and handoff**: README Rust + Node example, scoped regressions, mechanical scope gate, push branch only, report `.tmp/rv/harness-profile-file.md`, remove test volumes.
