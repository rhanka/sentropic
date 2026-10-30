# Fix: Refuse expired TUF roots and intra-set metadata parent-pin mismatches

## Objective
Extract the inline Sigstore TUF freshness and version-link checks into an exported pure validator with unit-tested expiry and intra-set parent-pin mismatch refusal (items 2 and 11 slice; prior-trusted-state rollback history stays open).

## Scope / Guardrails
- Scope limited to validator extraction, its unit tests, and fail-closed-strengthening wiring (strict integer and positive versions, null and array guards, finite verification time, coverage-blocked errors, validate-after-read ordering; not identical behavior).
- Make-only workflow, no direct Docker commands.
- Branch development in isolated worktree `tmp/sec5a-trust-expiry`.
- Automated test campaigns on dedicated environment (`ENV=test-sec5a-expiry`), never on root `dev`.
- In every `make` command, `ENV=<env>` passed as the last argument.
- All new text in English.
- No daily scheduling, auto-merge, publishing, package source, or admission flag changes.
- No secret, no registry credential, no network; pure local validation.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `scripts/security/daily/qualify-trust-receipt.mjs`
  - `scripts/security/daily/toolchain-contract.test.mjs`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `.security/**`
  - `docs/security/sec5a-trust-custody.json`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - None
- **Exception process**:
  - No new exception declared. Inherited unchanged from main: BRLOCK-EX1 review_by=2026-11-30T00:00:00Z (owner CI maintainers, removal on PR 846 closure); this branch changes no lockfile path.

## Feedback Loop
- `attention`: items 2 and 11 stay OPEN after this slice; only expiry and intra-set parent-pin mismatch refusal at receipt validation are added, independent content/verifier admission remains required; a fully self-consistent older, unexpired set still passes (no prior trusted state).

## AI Flaky tests
- Acceptance rule: none apply; no AI/provider-dependent tests in scope.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: single coherent gate with unit tests, no UI/E2E surface.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read COMMON-RULES, packet, PR #850 comment 6514874779, and `qualify-trust-receipt.mjs` metadata checks.
  - [x] Confirm isolated worktree `tmp/sec5a-trust-expiry` on branch `fix/sec5a-trust-expiry`.
  - [x] Capture make target: `make test-security-daily ENV=test-sec5a-expiry`.
  - [x] Confirm scope boundaries, no EXn.
- [x] **Lot 1 — TUF expiry and intra-set parent-pin refusal**
  - [x] Add exported `validateTufMetadata(documents, digests, verifiedAt)` to `scripts/security/daily/qualify-trust-receipt.mjs`.
  - [x] Call it from `createTrustReceipt` as a fail-closed strengthening (see Scope).
  - [x] Add unit tests in `scripts/security/daily/toolchain-contract.test.mjs` (fresh pass, expired root, wrong type, parent-pin version mismatch, parent-pin digest mismatch, malformed, non-integer version, snapshot-targets digest replay refusal).
  - [x] Lot gate:
    - [x] `make scope-check ENV=test-sec5a-expiry`
    - [x] Focused `toolchain-contract.test.mjs` green in Docker (15/15, retained-evidence replay passes).
  - [x] Lot gate:
    - [x] `make test-security-daily ENV=test-sec5a-expiry` (140/140).
- [x] **Lot 2 — Review and PR**
  - [x] Muse Wonder full xhigh legs (correctness r1, risk r2), receipts `.h2a/reviews/sec5a-expiry_muse_{r1,r2}.md`; final: APPROVE + APPROVE.
  - [ ] Open PR with `BRANCH.md` as body; record head; leave merge to owner.
