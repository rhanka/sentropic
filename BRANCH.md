# Feature: Native Anthropic Messages relay on product /gw

## Objective
- [ ] Deliver spec_v8 plus its N1–N7 addendum: opaque native Messages, count_tokens and joined usage observation with one financial settlement.

## Scope / Guardrails
- [x] Worktree `tmp/llm-gateway-native-relay`, branch `feat/llm-gateway-native-relay`, base `7d1002505`; mechanical branch check passed.
- [x] Implementer pass 01: rows 0a, 0b, 1, 1a, 2, 3 in order; conductor `s-conductor` owns later passes and review.
- [x] Make-only, Docker-first; English text; no Python, real provider calls, push, merge or publication.
- [x] Every commit is one row or declared split, at most 149 additions plus deletions including this file; selective staging and scope-check before commit.
- [x] Owner dev/UAT root remains reserved; automated checks use `ENV=test-llm-native-relay` last on every Make command.
- [x] Slot owner: pass 01 implementer; `API_PORT=9471`, `UI_PORT=5671`, `MAILDEV_UI_PORT=1571`; conductor checked ports free.
- [x] No schema/migration, identity, catalog, enrollment, general retry-policy or h2a transport changes.
- [ ] Before each later stage, add its full checklist and file-level gates in a bounded plan commit; no undeclared implementation.
- [ ] Operator UAT branch is separate, never merged; record exact feature/UAT SHAs and rebuild after rebases.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/llm-mesh/src/native-messages.ts` (BR-REL-EX1 approved, pass 01)
  - `packages/llm-mesh/src/index.ts` (BR-REL-EX1 approved, pass 01)
  - `packages/llm-mesh/src/routing-contracts.ts` (BR-REL-EX1 approved, pass 01)
  - `packages/llm-mesh/src/route-quote.ts` (BR-REL-EX1 approved, pass 02)
  - `packages/llm-mesh/tests/native-messages.test.ts` (BR-REL-EX1 approved, pass 01)
  - `packages/llm-mesh/tests/budget-quote.test.ts` (BR-REL-EX1 approved, pass 02)
  - `packages/llm-gateway/src/**`
  - `packages/llm-gateway/tests/**`
  - `packages/llm-gateway/package.json`
  - `packages/llm-gateway/CHANGELOG.md`
  - `packages/llm-gateway/README.md`
  - `spec/SPEC_EVOL_LLM_MESH_GATEWAY_ROUTING.md`
  - `spec/SPEC_EVOL_LLM_GATEWAY.md`
  - `spec/SPEC_EVOL_LLM_METERING_OBSERVABILITY.md`
  - `spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `apps/**`
  - `.github/**`
  - `PLAN.md`
  - `plan/**`
  - `ui/**`
  - `deploy/**`
  - `packages/llm-mesh/src/routing-targets.ts`
  - `packages/llm-mesh/src/providers.ts`
  - `packages/llm-mesh/src/catalog.ts`
  - `packages/llm-mesh/src/adapter-auth.ts`
  - `api/package-lock.json`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `packages/llm-mesh/src/native-messages.ts`
  - `packages/llm-mesh/src/index.ts`
  - `packages/llm-mesh/src/routing-contracts.ts`
  - `packages/llm-mesh/src/route-planner.ts`
  - `packages/llm-mesh/src/route-planner-state.ts`
  - `packages/llm-mesh/src/route-quote.ts`
  - `packages/llm-mesh/src/route-attempt.ts`
  - `packages/llm-mesh/src/errors.ts`
  - `packages/llm-mesh/tests/**`
  - `packages/llm-mesh/package.json`
  - `packages/llm-mesh/CHANGELOG.md`
  - `api/src/services/llm-runtime/**`
  - `api/src/services/providers/claude-provider.ts`
  - `api/src/routes/namespaces/gw.ts`
  - `api/src/services/llm-metering/budget-admission.ts`
  - `api/src/services/llm-metering/route-settlement.ts`
  - `api/src/services/llm-metering/cost-ledger-sink.ts`
  - `api/tests/**`
  - `package-lock.json`
  - `packages/cluster-mesh/package.json`
  - `packages/cluster-mesh/src/modules/catalog.ts`
  - `packages/cluster-mesh/CHANGELOG.md`
  - `packages/cluster-mesh/README.md`
  - `packages/cluster-mesh/tests/modules/registry.spec.ts`
  - `packages/cluster-mesh/tests/modules/topology-ranges.spec.ts`
  - `packages/cluster-mesh/tests/modules/topology.spec.ts`
  - `packages/cluster-mesh/tests/packaging/skew-invariants.ts`
  - `packages/cluster-mesh/tests/packaging/skew-invariants.spec.ts`
  - `packages/cluster-mesh/tests/packaging/optional-install.spec.ts`
  - `packages/cluster-mesh/tests/integrations/gateway-surface.spec.ts`
  - `packages/cluster-mesh/tests/integrations/llm-surface.spec.ts`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`
  - `packages/cluster-mesh/tests/packaging/lock-integrity.spec.ts`
  - `packages/cluster-mesh/tests/packaging/lock-integrity-registry.spec.ts`
  - `packages/cluster-mesh/tests/packaging/release-matrix-sources.spec.ts`
  - `packages/cluster-mesh/tests/packaging/siblings.spec.ts`
- [x] Exception process: declare ID, rationale, impact and rollback below before touching conditional paths; undeclared scope stops the pass.

## Feedback Loop
- [x] Scope gate clarification: harness exception grammar accepts numeric branch IDs only; approved pass 01 EX1 paths are mirrored explicitly in Allowed Paths so C2 verifies the granted scope without changing harness or inventing an exception ID.
- [x] BR-REL-EX1 approved by frozen §2: rationale: mesh capability/planner/quote/attempt/error seams; impact: additive contracts, tests, exports, version and CHANGELOG only; rollback: revert mesh feature commits and tuple before release.
- [x] BR-REL-EX2 approved by frozen §2: rationale: product native execution/count/classification/body-cap/M6 and trusted metering; impact: listed API paths only, no general metering refactor; rollback: disable switch and restart/redeploy, then revert API feature commits.
- [x] BR-REL-EX3 approved under Q-A: rationale: coordinated §6.2 release train; impact: listed cluster/root files only, tuple/range literals, expectations, release docs and generated integrity; rollback: restore prior tuple/ranges and regenerate affected locks/archives before release.
- [ ] BR-REL-EX4 RESERVED under conductor Q11: rationale: `api/package.json` gateway range must resolve the new exports; impact: only `@sentropic/llm-gateway` to `^0.20.0`; rollback: restore prior range with gateway tuple. Activate and declare its conditional path in the SAME commit as the gateway version bump; no API manifest write in pass 01.
- [x] No open implementation blocker; stop for uncovered design, scope exception, unfixable row failure or real-call requirement.

## AI Flaky tests
- [x] No live AI tests authorized in this pass; never weaken tests or increase timeouts; any later accepted flake requires same-commit success and owner sign-off.

## Orchestration Mode (AI-selected)
- [x] Mono-branch: sequential conductor-assigned passes on this worktree, with cross-review managed by conductor; no cherry-pick or delegation in pass 01.
- [ ] Multi-branch.

## UAT Management (in orchestration context)
- [ ] Operator owns separate exact-SHA UAT setup, edge/resource evidence, OFF client release gate and authorized ON qualification; production remains OFF pending all M8 facts and owner GO.

## Plan / Todo (lot-based)
- [x] Row 0a — Minimal template skeleton, scope/exceptions, ports and stage index.
- [x] Row 0b — Mesh-stage checklist and file-level gates before row 1.
- [ ] Stage 1 — Mesh: rows 1–9 (pass 01 ends at row 3).
  - [x] Row 1 — `src/native-messages.ts`: credential-free Messages request/result/prepared contracts and fixed-message upstream error; `src/index.ts`: public exports. Typecheck PASS; tests 317 passed, 0 failed (32 files).
  - [x] Row 1a — Immutable closed `NativeUsageSnapshot`, safe raw categories/fixed metadata, optional trusted capability/request finalize channel; gateway owns invocation. Typecheck PASS; tests 317 passed, 0 failed (32 files).
  - [x] Row 2 — Structural capability guard (including callable optional hook), empty default allowlist, Anthropic catalog/exclusive validation, pure exact target identity and raw beta composition. Typecheck PASS; tests 317 passed, 0 failed (32 files).
  - [x] Row 3 — `tests/native-messages.test.ts`: helper behavior and additive `src/routing-contracts.ts` pricing/proof/served-ID/source/uncertainty/inference fields on physical attempt usage. Typecheck PASS; tests 360 passed, 0 failed (33 files; 43 new cases); no split needed.
  - [x] Row 4 — `src/routing-contracts.ts`, `src/route-quote.ts`: advertisement, required flag/Pick/error/prepared seams, native feasibility/filtering/hash. Typecheck PASS; tests 360 passed, 0 failed (33 files).
  - [x] Row 5 — `tests/budget-quote.test.ts`: required filtering, exact identity/exclusive refusal, quote-plan agreement, flag hash and stable canonical references. Typecheck PASS; tests 364 passed, 0 failed (33 files; 4 new cases).
  - [ ] Row 6 — `src/route-planner.ts`, `src/route-planner-state.ts`: validated allowlist, P0/P1 before sticky/health/truncation, ineligible affinity ignored without mutation.
  - [ ] Row 7 — `tests/route-planner.test.ts`, `tests/route-selection.test.ts`: exclusive/sticky/filter-order, empty versus filtered-empty and canonical baselines.
  - [ ] Row 8 — `src/route-attempt.ts` and `tests/route-planner.test.ts`: fresh descriptor/target/capability exact-model checks, optional native forwarding and existing terminal guards.
  - [ ] Row 9 — `tests/service/local-account-transport-service.test.ts`: no h2a native advertisement/capability; `CHANGELOG.md`: additive mesh native contract/planner release entry.
  - [ ] File gate — `tests/native-messages.test.ts`: malformed discriminators/model/versions/betas/execute/finalize rejected; raw arbitrary header map, resolved version, empty-required-beta identity, unknown token/spacing preservation, exact catalog allowlist and exclusive rejection.
  - [ ] File gate — `tests/native-messages.test.ts`: closed snapshot and additive usage contracts preserve physical counts, separate raw reported TTL from inferred allocation, fixed reasons/provenance; caller body cannot supply trusted pricing fields.
  - [ ] Deferred M6 file gate — `tests/native-error-metadata.test.ts` (new), `src/errors.ts`, `src/native-messages.ts`: typed numeric size details survive normalization/cause wrapping without raw-message leakage, rows 40–42.
  - [ ] After EVERY code row/split: `make typecheck-llm-mesh API_PORT=9471 UI_PORT=5671 MAILDEV_UI_PORT=1571 ENV=test-llm-native-relay`.
  - [ ] After EVERY code row/split: `make test-llm-mesh API_PORT=9471 UI_PORT=5671 MAILDEV_UI_PORT=1571 ENV=test-llm-native-relay`; record per-row counts below.
  - [ ] Before EVERY commit: `make scope-check API_PORT=9471 UI_PORT=5671 MAILDEV_UI_PORT=1571 ENV=test-llm-native-relay`; stage explicit files plus this checklist, commit through Make.
  - [ ] Mesh stage handoff: conductor cross-review, full scoped gates, no live qualification; package bump stays in atomic T1 row 58 after registry checks.
- [ ] Stage 2 — Gateway selection/headers/body/errors/SSE/usage/count: rows 10–52a, with addendum insertions.
- [ ] Stage 3 — Contract documentation and atomic release train: rows 53–61 (T1 activates reserved EX4).
- [ ] Stage 4 — API execution/pricing/route plane/ledger: rows 62–81e2, with addendum insertions.
- [ ] Stage 5 — Operator setup, HTTP-only qualification and OFF/ON client gates: rows 82a–83b plus 82c.
- [ ] Stage 6 — Qualified default list, final train packing, Ffinal/Ufinal evidence and release handoff: rows 84–87.
