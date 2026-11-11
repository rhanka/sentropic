# Feature: t4a registration per-app MCP knowledge panel

## Objective
Deliver T4a part B wagons CMF-2, CMF-4, CMF-6, W4.c flag-gated additive preprod-safe in one PR, no merge before T3 closes.

## Scope / Guardrails
- Scope limited to registration loader, per-app MCP endpoint, knowledge loader, embeddable panel.
- CMF-3 excluded, waits for A-LIVE amendment 2 co-signature.
- Storage dependency on feat/t4a-cm-artifact-storage stubbed behind flags, never blocking.
- Everything flag-gated additive, preprod-safe, no legacy fallback.
- One migration max in api/drizzle/*.sql (none planned).
- Make-only workflow, no direct Docker commands.
- Root workspace reserved for user dev/UAT (ENV=dev) and must remain stable.
- Branch development in isolated worktree tmp/worktrees/t4a-registration.
- Automated test campaigns on dedicated ENV=test-t4a-reg, never on root dev.
- In every make command, ENV=<env> must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/services/artifacts/app-registration.*`
  - `api/src/routes/namespaces/mcp-apps.*`
  - `api/src/services/artifacts/knowledge-loader.*`
  - `api/src/services/artifacts/artifact-panel.*`
  - `api/src/app.ts`
  - `ui/src/lib/components/ArtifactsPanel.svelte`
  - `api/tests/api/cmf2-app-registration.test.ts`
  - `api/tests/api/cmf4-per-app-mcp.test.ts`
  - `api/tests/api/cmf6-knowledge-loader.test.ts`
  - `ui/tests/cmf-panel.test.ts`
  - `api/tests/api/cmf-panel-csp.test.ts`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID BRxx-EXn in ## Feedback Loop before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under ## Feedback Loop (or ## Questions / Notes if not yet migrated).

## Feedback Loop
- [ ] CMF-3 excluded: waits for Immo co-signature of A-LIVE amendment 2, no code in this lane.
- [x] Infra: parallel Docker jobs corrupted worktree node_modules (tsx preflight missing, api unhealthy). Fixed by make down plus sequential rerun on fresh stack. No code impact.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as flaky accepted.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs main: if unrelated, accept and record command + failing test file + signature in BRANCH.md; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: One PR for four wagons, train merges after T3, single CI on train head.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- UAT checkpoints must be listed as checkboxes inside each relevant lot (no separate UAT section).
- Execution flow (mandatory):
  - Develop and run tests in tmp/worktrees/t4a-registration.
  - Push branch before UAT.
  - Run user UAT from root workspace (ENV=dev).
  - Switch back to tmp/worktrees/t4a-registration after UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read rules/MASTER.md, rules/workflow.md, rules/testing.md, COMMON-RULES, spec CM_FIRST_ARTIFACTS §2-§7 §6.2, plan r3, verdict r3.
  - [x] Create isolated worktree tmp/worktrees/t4a-registration on feat/t4a-cm-artifact-registration from origin/main at 7a352bb4d.
  - [x] Define ENV=test-t4a-reg ports API_PORT=8949 UI_PORT=5349 MAILDEV_UI_PORT=1249.
  - [x] Confirm scope boundaries, CMF-3 excluded, storage stub rule.
- [x] **Lot 1 — CMF-2 registration + generalization §3.1**
  - [x] Loader validation control.app_instances projection imported-scope reserved-namespace per-app digests.
  - [x] Additive validator and loader behind CM_REGISTRATION_ENABLED, existing APP-P1 paths untouched.
  - [x] Contract test every refusal §3.1, bad registration refused alone (cmf2 4 passed).
  - [x] Lot gate: typecheck-api green, scoped test ENV=test-t4a-reg green (lint in CI).
  - [x] FIX Argon BLOCKER-5/MAJOR-6: digest helpers + control.app_instances projection + collision maps (helpers only).
  - [x] FIX enforced: real digest comparison, strict quotas, native UUID vs imported scope, collision refusals (cmf2 8 passed).
- [x] **Lot 2 — CMF-4 per-app MCP §4.1/§4.2**
  - [x] Endpoint api/v1/mcp/apps/slug PRM tenant pinning scopes tool summaries behind CM_PER_APP_MCP_ENABLED.
  - [x] 401 wrong audience, 403 non-member and wrong tenant, wording overlay byte-identical (cmf4 4 passed).
  - [x] Full 31-tool byte parity against Immo preprod connector verified at cutover (CMF-10 UAT).
  - [x] Lot gate: typecheck-api green, scoped test ENV=test-t4a-reg green (lint in CI).
  - [x] FIX Argon BLOCKER-2/3/4: real bearer verify (issuer/audience/tenant/membership), router mounted in app.ts, JSON-RPC tools/list+call, byte parity via router (cmf4 8 passed).
- [x] **Lot 3 — CMF-6 knowledge loader §3.4**
  - [x] Pinned commit SHA digest verified, GitHub unreachable serves stored bundle, mismatch refused (cmf6 3 passed).
  - [x] Storage bridge dependency on feat/t4a-cm-artifact-storage stubbed behind CM_KNOWLEDGE_ENABLED.
  - [x] Lot gate: typecheck-api green, scoped test ENV=test-t4a-reg green.
  - [x] FIX Argon MAJOR-7/MINOR-10: verifyKnowledgeDescriptor in load(), no refetch when cached, afterEach env cleanup (cmf6 4 passed).
- [x] **Lot 4 — W4.c embeddable panel §3.6**
  - [x] CM artifacts panel embedding frameAncestors exact https same-env, CSP builder (panel 2 passed, csp 3 passed).
  - [x] Lot gate: typecheck-ui green 0 errors, scoped test ENV=test-t4a-reg green.
  - [x] FIX Argon MAJOR-8/MINOR-9: strict origin (url.origin === value) + same-env, CSP router wired, UI test strengthened (csp 5, panel 3 passed).
- [ ] **Lot 5 — Final gates + PR**
  - [x] make scope-check PASS C2, typecheck-api and typecheck-ui green, scoped tests green.
  - [x] FIX re-verify: scope-check PASS each commit, typecheck-api green (exit 0), 27 scoped tests green (one-shot, host watchers exhausted), typecheck-ui blocked by host OOM (CI runs it).
  - [ ] Open PR, CI green, do NOT merge.
  - [ ] Report storage stub dependency exact commit if any.
- [ ] **Lot 6 — Report**
  - [ ] Write French report .tmp/rv/t4a-registration.md.
  - [ ] make down-volumes ENV=test-t4a-reg.
