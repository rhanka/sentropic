# Feature: Refresh W0-close.d published workspace tuple

## Objective
- [x] Freeze artifacts 0.2.4 / cluster-mesh 0.22.4 and qualify APP-P1 at the reconciled workspace head.

## Scope / Guardrails
- [x] Author codex gpt-6.1-sol high; owner deliverable 2; plan-v2 W0-close.d refresh.
- [x] Base feat/app-cm-w2b d0ce8aeb0; merge ancestry only; worktree tmp/worktrees/app-w0d-refresh.
- [x] Draft targets feat/app-cm-integration; no merge or production activation.
- [x] Review authored refresh from source merge 2c3bf7750; integration diff includes inherited W2.b/#702/UP-T ancestry.
- [x] Tests first; make-only; Docker flock; ENV=test-app-w0d last; no Python.
- [x] Dedicated runtime ENV=test-app-w0d; API/UI/Maildev ports 8798/5184/1091; checked free before startup.
- [x] Selective staging; scope-check before make commit; authored commits under 150 lines; no trailers.
- [x] Stop if cluster-mesh needs an upstream release to consume artifacts 0.2.4.
- [x] Preserve historical receipts; dedicated environment teardown after each runtime step.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `docs/baselines/app-cm-w0/**`
  - `api/src/services/mcp/cluster-registry.ts`
  - `api/src/services/artifacts/transport.ts`
  - `api/tests/api/app-artifacts-transport.test.ts`
  - `api/tests/api/app-mcp-registry.test.ts`
  - `api/tests/api/app-mcp-installed.test.ts`
  - `package-lock.json`
  - `api/package-lock.json`
  - `.h2a/owner-questions-w0.md`
  - `docs/runbooks/app-cm-baseline-restore/receipts/TEMPLATE.md`
  - `Makefile`
  - `packages/artifacts/**`
  - `packages/cluster-mesh/packaging.mk`
  - `packages/cluster-mesh/tests/packaging/**`
  - `.github/workflows/ci.yml`
  - `api/src/scripts/oauth-provision-exchange-client.ts`
  - `api/tests/api/auth/oauth-token-exchange.test.ts`
  - `deploy/**`
  - `spec/evidence/memory-mcp-l5/**`
  - `tools/memory-mcp-l5/**`
  - `api/src/routes/namespaces/catalog*.ts`
  - `api/src/services/catalog/**`
  - `api/src/services/chat-service.ts`
  - `api/src/services/skills/**`
  - `api/tests/ai/chat-tools.test.ts`
  - `api/tests/ai/comment-assistant.test.ts`
  - `api/tests/api/catalog-auth-context.test.ts`
  - `api/tests/api/cluster-mesh-catalog.test.ts`
  - `api/tests/services/catalog*/**`
  - `api/tests/services/catalog-characterization.spec.ts`
  - `api/tests/unit/chat-service-*.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `plan/**`
- **Conditional Paths (allowed only with explicit exception)**:
  - `.github/workflows/**`
- [x] BR00D-EXn records reason, impact and rollback before expansion.

## Feedback Loop
- [x] BR00D-EX5: merge published artifacts 0.2.4 source 60affbaf6, including its existing packed-vector CI gate; package/packaging/workflow paths are inherited only. Impact is source/published byte alignment and upstream gate coverage; rollback reverts this merge with the tuple refresh. No package release is authored here.
- [x] BR00D-EX4: owner-requested merge of integration ca3239295 brings W1/W2/W4 catalog and chat ancestry; these paths are merge-only. Impact is the integrated app baseline; rollback reverts the merge. Preserve this PR's BRANCH.md; inherited merge diff is outside the authored 150-line limit.
- [x] BR00D-EX3: transport.ts carries the frozen APP-P1 digest refreshed by this lot. Share the registry constant and add a transport-readiness regression; impact is startup acceptance of qualified artifacts 0.2.4, with exact compatibility checks retained. Rollback restores the prior qualified tuple, registry pin and transport together.
- [x] Opus r1 P1: 85/85 transport/credentials/MCP/resource tests; real API listener, HTTP 200/readiness ready and healthy container; locked teardown completed. See runtime-qualification-2026-10-27.md.
- [x] Opus r1 P2: regenerate 0.2.4 tuple vectors; historical/current w0-record-check passes without weakening. Final-head push/CI evidence is reported in PR #796.
- [x] BR00D-EX2: merge main 72bb2da3d to consume already-published UP-T; listed inherited paths are merge-only, no author edits. Impact is existing upstream ancestry; rollback reverts the merge.
- [x] BR00D-EX1: merge #702 evidence and its owner question/restore template; retained evidence only; rollback reverts merge. No author edits outside scope.
- [ ] Independent reviews and remote CI remain separate from code authorship.
- [x] Payload receipt preserves union-order-only declaration differences in mesh/root-facade and gateway/request-receipts; all JS/exports/SQL and full artifacts/llm-mesh payloads match bytes.
- [x] Strict install and runtime tree pass; full development npm ls retains Vitest UI/esbuild/skills Node-types diagnostics, recorded in the complete tree.
- [x] Qualification: 23/23 registry/installed tests; APP-P1 manifest 020aacfec500d754b76c90d3ad4a05097e0f996b8b9282145ca458917ea6fb27; no upstream bump.

## AI Flaky tests
- [x] No AI calls, accepted flakes or timeout increases.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; one author; external independent review.

## UAT Management (in orchestration context)
- [x] Package/registry and real API startup qualification; browser and production acceptance remain downstream.

## Plan / Todo (lot-based)
- [x] Lot 0: read Docker lock, rules, plan-v2, template and receiving contracts; harness branch check passed.
- [x] Lot 1: merge #702; published strict consumer first; cluster-mesh resolves artifacts 0.2.4 with Comments/gateway.
- [x] Lot 2: normalized published payload hashes, clean source equivalence, complete workspace resolution; merge published UP-T ancestry without package author edits.
- [x] Lot 3: recompute APP-P1 with mcp:tools:invoke; observe old-pin refusal, then update registry and api/tests/api/{app-mcp-registry,app-mcp-installed}.test.ts.
- [x] Lot 4: refresh reservations.md, host-fit.md, catalog-context.md and published-tuple.json; dated evidence and exact base/lock hashes.
- [x] Lot 5: installed/profile tests, scope/branch gates, locked make down, empty stack, draft PR and head.
- [x] Lot 6: resolve Opus r1 startup and record-check findings; #794 must drop its registry pin after #796 lands and retain the qualified workspace source; no #794 edits.
- [x] Lot 6a: retain all historical signature/source checks; add regenerated current-tuple vectors and exact receipt/lock/source consistency checks for artifacts 0.2.4.
