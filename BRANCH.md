# Feature: Prepare hardened Trivy image lane (S2b option B)

## Objective
- [ ] Prepare upstream Trivy by immutable image digest with trusted DB acquisition and fail-closed execution; qualification and daily activation remain blocked.

## Scope / Guardrails
- [x] Owner-authorized default B from dossier r2, SHA-256 b4de75e7 prefix; no toolbox Dockerfile change.
- [x] Branch `feat/sec-s2b-trivy-b` from `origin/main` at `213638676`; isolated worktree `tmp/worktrees/sec-s2b`.
- [x] Make only; zero Python; selective staging; commits at most 150 changed lines without AI trailers; merge updates only.
- [x] Docker uses the shared `.tmp/packets/DOCKER-LOCK.md` flock and scoped teardown; `ENV=test-sec-s2b` always last.
- [x] Fixture containers bind no ports; reserved API/UI/Maildev ports 9410/5610/1510 remain unused.
- [x] Preserve disabled auto-fix, S2c/S3 and all missing S2b evidence; no schedule, publisher, credentials or merge actor.
- [x] Keep source, target and DB isolated from the scanner; no host Docker socket or credential mounts in scanner execution.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `.security/trivy-toolchain.json`
  - `scripts/security/daily/toolchain*.mjs`
  - `scripts/security/daily/trivy*.mjs`
  - `scripts/security/daily/scan.mjs`
  - `scripts/security/daily/scan.test.mjs`
  - `scripts/ci/publishable-ci-wiring.test.mjs`
  - `docs/security/trivy-s2b.md`
  - `Makefile`
- **Forbidden Paths (must not change in this branch)**:
  - `api/Dockerfile`
  - `ui/Dockerfile`
  - `docker-compose*.yml`
  - `.github/workflows/**`
  - `.cursor/rules/**`
  - `.security/security-fix.json`
  - `.security/vulnerability-register.yaml`
  - `packages/**`
  - `.track/**`
  - `plan/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile` (SECDAILY-EX1, daily Trivy preparation/test recipes only)
- **Exception process**:
  - [x] Declare additional exceptions with reason, impact and rollback before editing.

## Feedback Loop
- [x] SECDAILY-EX1: approved plan permits daily scanner pin/isolation recipes. Impact limited to preparation and fixture targets; rollback removes those targets and retains S2a blocked state. Toolbox exception is not opened.
- [ ] S2B-Q1, conductor, blocked: verifier admission, publisher identity/signature receipt and content review of exact index/platform pins.
- [ ] S2B-Q2, conductor, blocked: live DB provenance/integrity/freshness, Java/IaC data, immutable targets with exact source/platform, zero-Python runtime inventory.
- [ ] S2B-Q3, conductor, blocked: real offline/rate-limit/corruption/rollback exercises and cold/warm remote/rebuild measurements including full CI critical path.
- [x] Shared Track remains owned by its designated writer; no event writes from this lot.

## AI Flaky tests
- [x] Deterministic fixtures only; failures block delivery and timeouts are not increased.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch**: bounded author lot with serial Docker campaigns.
- [ ] **Multi-branch**: not required.

## UAT Management (in orchestration context)
- [x] Web, Chrome and VSCode UAT not applicable; no application changes.
- [ ] Operator UAT: inspect source evidence, immutable pins, refusal receipts and qualification gaps.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and admission**
  - [x] Read rules, approved plan, historical reviews, S1 receipt, dossier r2 and merged S1/S2a.
  - [x] Verify branch mechanically with harness C1 and declare exact scope before implementation.
- [ ] **Lot 1 — Frozen scanner policy and source evidence**
  - [ ] Resolve upstream index/platform/config and signature; inspect release and both security advisories.
  - [x] Freeze pins, minimum version, exact publisher, trusted DB/rules sources and explicit missing admissions.
- [ ] **Lot 2 — Acquisition and execution contracts**
  - [ ] Acquire DB once per campaign through allowed OCI origin; verify descriptors and hashes before atomic cache publication.
  - [ ] Validate schema/dates and cache bytes after restoration; block missing/corrupt/stale/incompatible data.
  - [ ] Prepare socket-free, least-privilege remote/archive scans with immutable target/source/platform proof and frozen flags/data.
  - [x] Reject caller configuration and untrusted mirrors before acquisition; no automatic mirror fallback.
  - [ ] Reject silent Java/IaC fallback and preserve all-severity raw diagnostics.
  - [ ] Keep unqualified code gated and daily job off.
- [ ] **Lot 3 — Security regression fixtures**
  - [ ] `toolchain-contract.test.mjs`: pin/version, publisher/platform/source, cache corruption/schema/dates and bounded acquisition failures.
  - [ ] `trivy.test.mjs`: sandbox flags, environment isolation, report/target mismatch and unqualified execution refusal.
  - [ ] Existing `schema.test.mjs`, `inventory.test.mjs`, `scan.test.mjs` plus required wiring entrypoint and `test-security-parser`.
- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Document source receipts, frozen identities, trust limits, qualification matrix and rollback in `docs/security/trivy-s2b.md`.
- [ ] **Lot N — Final validation**
  - [ ] Run scoped and full daily/required wiring fixtures under flock, then `make down ENV=test-sec-s2b`.
  - [ ] Check scope before each commit; verify diff, commit sizes and no AI trailers.
  - [ ] Create draft PR to main with this plan as body; verify CI completed/success on exact head.
  - [ ] Report PR/head and remaining evidence; retain BRANCH.md, disabled service and qualification blockers; no merge.
