# Feature: Cluster-mesh stateful MCP wrapping specification

## Objective
- [x] Specify the Immo-compatible stateful wrapper, schema validation and wire fidelity for the three assigned cluster-mesh blockers; deliver a draft PR without merging.

## Scope / Guardrails
- [x] Documentation only: runtime implementation, publication, deployment and token exchange activation are separate work.
- [x] Preserve the owner decision of 2026-10-14 (Hosting B), current identifiers and tools; require no forced hosted-client reconnection.
- [x] Keep token exchange disabled until #689 and explicit owner GO; prohibit user-bearer passthrough and legacy fallback.
- [x] Worktree: `tmp/worktrees/cm-mcp-stateful-wrap`; branch: `spec/cluster-mesh-mcp-stateful-wrap`; base: `origin/main` at `ab2138d605816cc278fbfd2cf88968ffcfbdb649`.
- [x] Make-only commands with ENV last; English artifacts; selective staging and commits under 150 changed lines via `make commit`.
- [x] Validation environment: `test-cm-mcp-stateful-wrap`; no services or ports allocated; root dev remains untouched.
- [x] No database migration, package source edit, dependency installation for runtime qualification, or version bump in this documentation branch.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - [x] `BRANCH.md`
  - [x] `spec/SPEC_EVOL_CLUSTER_MESH_MCP_STATEFUL_WRAP.md`
- [x] **Forbidden Paths (must not change in this branch)**:
  - [x] `Makefile`
  - [x] `docker-compose*.yml`
  - [x] `.cursor/rules/**`
  - [x] `packages/**`
  - [x] `api/**`
  - [x] `ui/**`
  - [x] `.track/**`
  - [x] `PLAN.md`
  - [x] `plan/**`
- [x] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - [x] `.github/workflows/**`
- [x] Exception process: declare BRxx-EXn with reason, impact and rollback before any exception; none needed.

## Feedback Loop
- [x] 2026-10-18 / owner / clarification: Radar owns mcp-auth 0.2.2 adoption (blocker 6); this specification owns blockers 1, 2 and 3 only.
- [x] 2026-10-18 / spec author / acknowledge: #689 remains open at `811455a5b3724999828e4b313057d78cb26323e3`; its schema/session code is reuse material, not evidence of released Immo parity.
- [x] 2026-10-18 / spec author / attention: protected live signals cannot satisfy full production parity with exchange disabled and bearer forwarding prohibited; release/cutover gates must expose this dependency.
- [ ] Design review: reconcile independent peer findings before marking the specification reviewed.
- [ ] Track import: designated repository writer imports this branch plan and links the three existing item IDs; this worktree does not append to the shared event log.

## AI Flaky tests
- [x] Not applicable to documentation checks; no runtime test waiver or increased timeout.

## Orchestration Mode (AI-selected)
- [x] Mono-branch: one documentation deliverable; independent reviewers have read-only source scope.
- [x] No integration from other branches; implementation lots are specified for later execution.

## UAT Management (in orchestration context)
- [x] No web, Chrome or VSCode behavior changes; no UAT service is launched by this branch.
- [x] Future hosted-client UAT and package conformance must qualify the same implementation HEAD and installed package tuple.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Evidence and scope**
  - [x] Read repository rules, branch template, prior composition analysis and the pinned #866 fixture/tests.
  - [x] Create the requested worktree from origin/main and pass `harness check branch` with actual and expected branch names.
  - [x] Inspect current composer, platform bridge/codec, #689 sessions/schema helper and release manifests.
- [x] **Lot 1 — Stateful host contract**
  - [x] Write the spec's decisions, host ownership, request authority, public exports and warm wrapping acceptance.
  - [x] Gate: no per-request recreation, identity rewriting, raw bearer exposure, or second session owner in the proposed API.
- [ ] **Lot 2 — Validation, discovery and result fidelity**
  - [ ] Define draft-07 schema semantics, defaults, resource limits, complete tool metadata and lossless CallToolResult handling.
  - [ ] Gate: all twelve #866 schemas and complete discovery/results have explicit positive and negative conformance checks.
- [ ] **Lot 3 — Delivery plan and risks**
  - [ ] Specify package versions, implementation lots, file-level tests, external dependencies and no-reconnection cutover gate.
  - [ ] Test inventory: platform `tests/mcp-wire-schema.test.ts`, `tests/mcp-wire-results.test.ts`, `tests/wire-parity.test.ts`; mesh `tests/mcp-stateful-wrap.spec.ts`, `tests/conformance/immo-stateful-wrap.spec.ts`, `tests/packaging/mcp-stateful-consumer.spec.ts`.
  - [ ] Radar follow-up: `packages/immo-mcp/src/deployed-baseline.test.ts` and `server-http.test.ts`; immutable #866 fixture; published dependencies only.
  - [ ] Gate: distinguish proposed runtime checks from evidence actually produced by this documentation branch.
- [ ] **Lot 4 — Docs consolidation and review**
  - [ ] Reconcile review findings; verify all references, signatures, dependency ranges and acceptance criteria.
  - [ ] Keep the standalone EVOL spec; no temporary BRANCH_SPEC_EVOL document is needed.
- [ ] **Lot 5 — Final validation and draft PR**
  - [ ] Run `make scope-check ENV=test-cm-mcp-stateful-wrap` before every commit; inspect the complete diff and whitespace.
  - [ ] Verify documentation-only scope; runtime test/typecheck/build/UAT campaigns and package bumps do not apply here.
  - [ ] Push the branch and create a draft PR using this BRANCH.md as its body; post the short execution plan.
  - [ ] Inspect PR checks and report the PR number, HEAD and specification path.
  - [x] Stop at draft delivery: retain BRANCH.md, do not merge, publish or activate exchange.
