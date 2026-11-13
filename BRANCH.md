# Fix: Daily live provider qualification wiring

## Objective
- [ ] Restore daily qualification without arming the operator-only native UAT harness or using an unregistered OAuth callback.

## Scope / Guardrails
- [x] Worktree: tmp/worktrees/live-provider-qualify; branch: fix/live-provider-qualify; rebased base: 6cc155d58.
- [x] Make-only, Docker-first; ENV=fix-live-qualif last; API_PORT=9405 UI_PORT=5397 MAILDEV_UI_PORT=1505 checked free.
- [x] No paid dispatch, provider account workaround, timeout increase, or merge.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/tests/ai/gw-native-qualification*.ts`
  - `api/tests/unit/gw-native-qualification*.test.ts`
  - `scripts/ci/**`
  - `.github/workflows/llm-live-daily.yml`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`

## Feedback Loop
- [x] BRLP-EX1: update the live workflow UI port to seeded OAuth callback 5397; impact isolated daily stack only; rollback workflow and runner port together.
- [x] BRLP-F1: downloaded run artifact additionally proves two S2S HTTP 400 failures (log 8964-9011); aligned daily API issuer/resource 9405 through a generated script-owned Compose overlay; regression failed before fix, then passed.
- [ ] BRLP-F2: conductor owns diagnosis of 46 OpenAI HTTP 400 responses; no Gemini traffic. Cause is absent from retained wire observations. Acceptance: identify rejected request parameter/model from safe provider diagnostics and eliminate unexpected HTTP 400s; verify targeted tests then owner-authorized live qualification. Preserve the receipt gate.
- [ ] Track import delegated to conductor (single writer); import this BRANCH.md and final report.

## AI Flaky tests
- [x] No flaky acceptance requested; no live calls authorized.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, single builder; independent code review per common packet rules.

## UAT Management (in orchestration context)
- [x] Preserve operator-only native UAT guards and its explicit selection path.
- [ ] Owner/conductor may approve paid workflow_dispatch after merge; branch dispatch selects qualified main source.

## Plan / Todo (lot-based)
- [x] Lot 0: collect log evidence and mechanically check branch.
- [x] Lot 1: regress daily suite selection and OAuth port alignment in scripts/ci/live-provider-receipt.test.mjs; fix runner and workflow (16 Docker tests passed; 2 failed before fix).
- [x] Lot 2: safe underlying readiness/case/teardown diagnostics in api/tests/ai/gw-native-qualification.test.ts and helpers; regress secret suppression (2 Vitest tests passed under Docker).
- [x] Lot 3: 16 runner regressions and 2 diagnostic tests passed under Docker, repeated after rebase; generated overlay passed real Compose merge; two independent Astra high code reviews APPROVE; mechanical scope check passed.
- [ ] Final validation: push, PR from BRANCH.md, normal CI green; report and completion marker; no merge.
