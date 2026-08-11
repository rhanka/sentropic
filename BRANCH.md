# BR-74: Restore Anthropic compaction usage

Status: ACTIVE
Branch: `fix/llm-gateway-compaction-usage`
Worktree: `/home/antoinefa/src/sentropic/tmp/fix-llm-gateway-compaction-usage`
Base: `origin/main` at `61bd9231b7f41c22e281f89fd61f5cbe9ee5c005`
Canonical evolution spec: `spec/SPEC_EVOL_LLM_MESH_GATEWAY_ROUTING.md`

## Objective

- [ ] Restore the Anthropic streaming usage contract required by Claude Code
  compaction without buffering a routed response or changing financial usage.
- [ ] Prove the exact package in real h2a integration before opening a PR.
- [ ] Publish the Sentropic patch through regular CD, then support h2a's
  published 0.94.x integration, deployment, and real Claude validation.

## Branch Scope Boundaries (MANDATORY)

- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `PLAN.md`
  - `plan/done/73-BRANCH_feat-llm-mesh-gateway-routing.md`
  - `plan/done/74-BRANCH_fix-llm-gateway-compaction-usage.md`
  - `spec/SPEC_EVOL_LLM_MESH_GATEWAY_ROUTING.md`
  - `docs/reviews/llm-gateway-compaction-usage/**`
  - `docs/uat/2026-08-*-llm-gateway-compaction-usage*.md`
  - `packages/llm-gateway/package.json`
  - `packages/llm-gateway/src/canonical-stream.ts`
  - `packages/llm-gateway/src/route-stream-flow.ts`
  - `packages/llm-gateway/tests/canonical-stream.test.ts`
  - `packages/llm-gateway/tests/route-stream-flow.test.ts`
  - `packages/llm-gateway/tests/router.test.ts`
  - `package-lock.json`
  - `.track/events.jsonl`
  - `.track/head.json`
- **Forbidden Paths (must not change in this branch)**:
  - `packages/llm-mesh/**`
  - `api/**`
  - `ui/**`
  - `e2e/**`
  - `deploy/**`
  - `Makefile`
  - `.github/workflows/**`
  - every other repository
- **Conditional Paths**:
  - Any additional path requires a documented `BR74-EXn` exception with
    reason, impact, rollback, and owner approval before editing.
- Commands use Make targets; tests use `ENV=test-br74-gw-compaction`.

## Orchestration and feedback

- [ ] Mono-branch Sentropic implementation; h2a owns its isolated integration
  lane and all h2a source, release, and deployment changes.
- [ ] Objective loop `loop-gw-compaction-release-20260811` remains active
  until Sentropic npm publication, h2a 0.94.x npm publication, redeployment,
  and the real Claude smoke all pass.
- [ ] `BR74-F1` blocking: h2a must confirm the exact compaction contract and
  pre-PR UAT recipe.
- [ ] `BR74-F2` blocking: h2a must return exact tarball SHA, commands, and
  real two-compaction evidence before the Sentropic PR is opened.

## Plan / todo

- [ ] **Lot 0 — Contract, branch, specification, and Track**
  - [x] Create the isolated worktree and pass `harness check branch`.
  - [ ] Archive the merged BR-73 plan and register BR-74 in `PLAN.md`.
  - [ ] Amend the routing evolution spec with the Anthropic usage invariant.
  - [ ] Import this plan into Track and validate the append-only sidecar.
  - [ ] Reconcile the exact contract and UAT recipe with the live h2a owner.

- [ ] **Lot 1 — Red contract and integration tests**
  - [ ] Assert `message_start.usage.input_tokens` is request-derived and
    non-zero for text/system/tool context before provider completion.
  - [ ] Assert terminal `message_delta.usage` contains output usage only.
  - [ ] Assert OpenAI stream usage, settlement usage, SSE order, tools,
    reasoning, and first-frame streaming remain unchanged.
  - [ ] Cover long context, Unicode, tools, and binary/image payload handling
    so estimation cannot scale with embedded base64 bytes.

- [ ] **Lot 2 — Minimal gateway fix and package candidate**
  - [ ] Compute bounded request-derived Anthropic input usage before streaming.
  - [ ] Pass it only to the Anthropic canonical encoder; keep provider-reported
    usage authoritative for metering and settlement.
  - [ ] Bump only `@sentropic/llm-gateway` to a registry-unique patch.
  - [ ] Pass focused/full tests, typecheck, build, pack, scope, and branch gates.
  - [ ] Produce the exact tarball, commit SHA, version, and SHA-256 evidence.

- [ ] **Lot 3 — Mandatory h2a UAT before PR**
  - [ ] h2a installs the exact tarball in an isolated worktree.
  - [ ] Direct SSE integration proves first-frame input usage and output-only
    terminal usage without response buffering.
  - [ ] Real Claude Code through the enrolled gateway completes two successive
    compactions and continues with a preserved marker.
  - [ ] Re-run enrolment, tools, streaming, and route-selection regressions.
  - [ ] Record h2a's exact commands, versions, SHA, and PASS artifact locally.
  - [ ] Fix every blocking finding and repeat the affected gates and UAT.

- [ ] **Lot 4 — Review, PR, publication, and downstream release**
  - [ ] Obtain two exact-head independent reviews and reconcile all P0/P1.
  - [ ] Open the Sentropic PR only after Lot 3 PASS; obtain green CI and merge.
  - [ ] Archive this plan, remove root `BRANCH.md`, and run branch lifecycle.
  - [ ] Verify the new gateway version is visible on npmjs.org.
  - [ ] h2a consumes the published package, bumps to 0.94.x, and releases only
    through its regular CI/CD.
  - [ ] Verify h2a 0.94.x on npmjs.org, redeploy locally, and pass real Claude
    compaction, continuation, enrolment, and tool smoke tests.

## Acceptance

- [ ] No Sentropic PR exists before exact-tarball h2a UAT passes.
- [ ] No response buffering, extra provider call, or changed billing occurs.
- [ ] Existing Anthropic/OpenAI routing and enrolment regressions stay green.
- [ ] Completion means both npm publications, h2a redeployment, and real
  Claude smoke evidence—not merely commits, PRs, merges, or queued CI.
