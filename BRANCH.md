# Fix: Independently acquire frozen Cosign and Sigstore trust material

## Objective
- [ ] Reacquire exact Trivy signature material and Cosign 3.1.4; initialize fresh TUF custody and verify offline without prior host evidence.

## Scope / Guardrails
- [x] Branch `fix/sec5a-trust-custody`; worktree `tmp/sec5a-trust-custody`; base `401cffae1`.
- [x] Make-only, Docker-first, zero Python; ENV=test-sec5a-trust last; no application stack or host ports.
- [x] Docker flock: `/home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md`; down after trials.
- [x] Existing service and auto-merge stay off; no scanner admission, severity reduction or vulnerability exception.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `scripts/security/daily/**`
  - `docs/security/**`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `.security/**`
  - `packages/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - None.

## Feedback Loop
- [x] Rebase preserves BR-80/#829 and #841/#840 behavior from main; BR-80's full plan remains at [main 028e63d33](https://github.com/rhanka/sentropic/blob/028e63d3338cd6c2effa6707642cab3e2b679fd3/BRANCH.md) and `plan/66-BRANCH_perf-ci-package-candidates.md`; its pending acceptance is not claimed here.
- [x] No author-set admission flags: cryptographic observations and independent review remain distinct from runtime admission.
- [x] The current upstream scanner still requires a patched candidate; latest upstream release remains 0.76.1.

## AI Flaky tests
- [x] None accepted.

## Orchestration Mode (AI-selected)
- [x] Multi-branch; no dependency on CI or safety PRs; only qualification evidence paths overlap.

## UAT Management (in orchestration context)
- [x] No UI changes; positive offline verification and corrupted-material refusal are operator UAT.

## Plan / Todo (lot-based)
- [x] Lot 0: read rules, owner decisions and #840 review; mechanical branch check PASS C1.
- [x] Lot 1: remove host-specific evidence dependency in `qualify-signature.sh`; acquire index/platform/config/bundle with verified hashes.
- [x] Lot 2: freshly hash-check Cosign 3.1.4 and initialize Sigstore TUF with its embedded release root in an empty isolated home.
- [x] Lot 3: exact-index offline verification passed; changed index/root/bundle refused; public hash-bound custody receipt retained.
- [ ] Lot 4: regressions, shell syntax, scope check, <=150-line commits, independent exact-head review and CI; PR body from this file.
- [x] No package source changes; package publication version gate not applicable.
- [x] No merge or auto-merge; keep PR open for review.
