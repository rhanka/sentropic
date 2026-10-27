# Feature: Refresh W0-close.d published workspace tuple

## Objective
- [ ] Freeze artifacts 0.2.3 / cluster-mesh 0.22.4 and qualify APP-P1 at the reconciled workspace head.

## Scope / Guardrails
- [x] Author codex gpt-6.1-sol high; owner deliverable 2; plan-v2 W0-close.d refresh.
- [x] Base feat/app-cm-w2b d0ce8aeb0; merge ancestry only; worktree tmp/worktrees/app-w0d-refresh.
- [x] Draft targets feat/app-cm-integration; no merge or production activation.
- [x] Tests first; make-only; Docker flock; ENV=test-app-w0d last; no Python.
- [x] Existing Compose qualification service has no listeners; reserved API/UI/Maildev ports 9730/5930/1830 if needed.
- [x] Selective staging; scope-check before make commit; authored commits under 150 lines; no trailers.
- [x] Stop if cluster-mesh needs an upstream release to consume artifacts 0.2.3.
- [x] Preserve historical receipts; dedicated environment teardown after each runtime step.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `docs/baselines/app-cm-w0/**`
  - `api/src/services/mcp/cluster-registry.ts`
  - `api/tests/api/app-mcp-registry.test.ts`
  - `api/tests/api/app-mcp-installed.test.ts`
  - `package-lock.json`
  - `api/package-lock.json`
  - `.h2a/owner-questions-w0.md`
  - `docs/runbooks/app-cm-baseline-restore/receipts/TEMPLATE.md`
  - `Makefile`
  - `packages/artifacts/**`
  - `api/src/scripts/oauth-provision-exchange-client.ts`
  - `api/tests/api/auth/oauth-token-exchange.test.ts`
  - `deploy/**`
  - `spec/evidence/memory-mcp-l5/**`
  - `tools/memory-mcp-l5/**`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `plan/**`
- **Conditional Paths (allowed only with explicit exception)**:
  - `.github/workflows/**`
- [x] BR00D-EXn records reason, impact and rollback before expansion.

## Feedback Loop
- [x] BR00D-EX2: merge main 72bb2da3d to consume already-published UP-T; listed inherited paths are merge-only, no author edits. Impact is existing upstream ancestry; rollback reverts the merge.
- [x] BR00D-EX1: merge #702 evidence and its owner question/restore template; retained evidence only; rollback reverts merge. No author edits outside scope.
- [ ] Independent reviews and remote CI remain separate from code authorship.

## AI Flaky tests
- [x] No AI calls, accepted flakes or timeout increases.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; one author; external independent review.

## UAT Management (in orchestration context)
- [x] Package/registry qualification only; browser and production acceptance remain downstream.

## Plan / Todo (lot-based)
- [x] Lot 0: read Docker lock, rules, plan-v2, template and receiving contracts; harness branch check passed.
- [x] Lot 1: merge #702; published strict consumer first; cluster-mesh resolves artifacts 0.2.3 with Comments/gateway.
- [ ] Lot 2: normalized published payload hashes, clean source equivalence, complete workspace resolution; merge published UP-T ancestry without package author edits.
- [ ] Lot 3: recompute APP-P1 with mcp:tools:invoke; observe old-pin refusal, then update registry and api/tests/api/{app-mcp-registry,app-mcp-installed}.test.ts.
- [ ] Lot 4: refresh reservations.md, host-fit.md, catalog-context.md and published-tuple.json; dated evidence and exact base/lock hashes.
- [ ] Lot 5: installed/profile tests, scope/branch gates, locked make down, empty stack, draft PR and head.
