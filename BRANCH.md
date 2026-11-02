# Feature: ACT-L07 — integrated daily scan, performance and recovery

## Objective
- [ ] Integrate npm, Trivy and native ast-grep; prove L7-A–E and T5-S6 from approved r6 §7.2/§7.3 and retained r4 §6/Lot 7.

## Scope / Guardrails
- [x] Binding r6 SHA-256: 4438d481e5021b06299d7c61bc95354dcd45d42664e59fdbecf02a2b0cfd451f.
- [x] Isolated branch `feat/cyber-act-L07`, worktree `tmp/worktrees/cyber-act-L07`, base `origin/main`.
- [x] Make only; Docker under `.tmp/packets/DOCKER-LOCK.md`; `ENV=test-cyber-L07` last; `make down` after.
- [x] No payment, Python, secrets in output, schedule activation or work on another lot. No merge.
- [x] Preserve scanner admission and runtime custody; fixtures never qualify production.
- [x] Push every few atomic commits; one CI on the final ready PR head; never skip CI.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `scripts/security/daily/scan*.mjs`
  - `scripts/security/daily/inventory*.mjs`
  - `scripts/security/daily/schema*.mjs`
  - `scripts/security/daily/sast*.mjs`
  - `scripts/security/daily/trivy*.mjs`
  - `scripts/security/daily/runtime-recovery*.mjs`
  - `scripts/security/daily/scan-performance*.mjs`
  - `scripts/security/daily/acceptance-disposition.mjs`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `.track/**`
  - `packages/**`
  - `api/**`
  - `ui/**`
  - `.security/**`
- **Conditional Paths (allowed only with explicit exception)**:
  - `Makefile` (BR07-EX1: daily test collection only).

## Feedback Loop
- [x] BR07-EX1: required collection of integration/recovery/performance tests; impact limited to daily suite; rollback reverts added SCOPE entries.
- [x] BRLOCK-EX1 acknowledgement: review_by=2026-11-30T00:00:00Z.
- [ ] L02/L05 live admission prerequisites remain missing on main: downstream image digest, admitted builder and actual remote/rebuild receipts. Do not replace them with mocks.
- [x] Conductor remains sole Track writer; this branch and final report provide the importable evidence.

## AI Flaky tests
- [x] No AI call in this lot; no accepted flaky result or timeout increase.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; no cherry-picks; independent code review before final validation.

## UAT Management (in orchestration context)
- [x] No UI surface; use immutable integration fixtures and real runtime receipts when admitted.

## Plan / Todo (lot-based)
- [x] Lot 0: read binding contracts, create worktree and pass mechanical branch check.
- [ ] Lot 1: tests first in `scan-integration.test.mjs`; L7-A/B/C full cohort, each refusal, debt/publication.
- [ ] Lot 2: integrate existing `scan.mjs`, `inventory.mjs`, `schema.mjs`, `sast.mjs`, `trivy.mjs`; keep all required coverage and admission.
- [ ] Lot 3: `runtime-recovery.test.mjs` and `scanner-provenance.test.mjs` for L7-E/T5-S6; preserve trust, holds, cursors and debt.
- [ ] Lot 4: `scan-performance.test.mjs` for L7-D, actual cold/warm remote/rebuild and complete CI ≤600 seconds; queue separate, all failed samples retained.
- [ ] Lot 5: required daily suite (existing schema/inventory/scan/toolchain/trivy plus new files), parser suite, scope check and independent review.
- [ ] Lot 6: ready PR with this body, one final-head CI, report every acceptance to `.tmp/rv/cyber-act-L07.md`; stop without merging.
