# Fix: Detect partial warm reports in cold/warm comparison

## Objective
Refuse a warm Trivy report whose finding inventory diverges from the cold report for the same target and DB snapshots (#840 item 6 slice).

## Scope / Guardrails
- Scope limited to cold/warm agreement gate, its unit tests, and one wiring call.
- Make-only workflow, no direct Docker commands.
- Branch development in isolated worktree `tmp/sec5a-report-agreement`.
- Automated test campaigns on dedicated environment (`ENV=test-sec5a-agreement`), never on root `dev`.
- In every `make` command, `ENV=<env>` passed as the last argument.
- All new text in English.
- No daily scheduling, auto-merge, publishing, package source, or admission flag changes.
- No secret, no registry credential, no network in the gate; pure local comparison.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `scripts/security/daily/trivy.mjs`
  - `scripts/security/daily/trivy.test.mjs`
  - `scripts/security/daily/qualify-current.mjs`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `.security/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - None
- **Exception process**:
  - No exception declared.

## Feedback Loop
- `attention`: item 6 stays OPEN after this slice; only omitted/partial-report detection is added, independent expected inventories remain pending.

## AI Flaky tests
- Acceptance rule: none apply; no AI/provider-dependent tests in scope.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: single coherent gate with unit tests, no UI/E2E surface.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read COMMON-RULES, packet, PR #850 comment 6514874779, and `trivy.mjs` comparison path.
  - [x] Confirm isolated worktree `tmp/sec5a-report-agreement` on branch `fix/sec5a-report-agreement`.
  - [x] Capture make target: `make test-security-daily ENV=test-sec5a-agreement`.
  - [x] Confirm scope boundaries, no EXn.
- [x] **Lot 1 — Cold/warm finding-inventory agreement gate**
  - [x] Add exported `validateReportAgreement(coldReport, warmReport)` to `scripts/security/daily/trivy.mjs`.
  - [x] Add unit tests in `scripts/security/daily/trivy.test.mjs` (agree, reordered agree, dropped/added CVE, same-count PkgName/ID/version/severity drift, extra/missing result, reclassed result, nested malformed finding).
  - [x] Lot gate:
    - [x] `make scope-check ENV=test-sec5a-agreement`
    - [x] Focused `trivy.test.mjs` green in Docker (6/6).
  - [x] Wire one agreement call into `scripts/security/daily/qualify-current.mjs` cold/warm join.
  - [x] Lot gate:
    - [x] `make test-security-daily ENV=test-sec5a-agreement` (140/140 on final head).
- [x] **Lot 2 — Review and PR**
  - [x] Muse Wonder full xhigh legs (correctness r1/r1b/r1c, risk r2), receipts `.h2a/reviews/sec5a-agreement_muse_{r1,r1b,r1c,r2}.md`; final: APPROVE + APPROVE.
  - [ ] Open PR with `BRANCH.md` as body; record head; leave merge to owner.
