# Feature: Sandbox Node K1 — clean startup, quota errors and isolation qualification

## Objective
Deliver packet s1-agent-k1 Fixes 1–5 on fix/sandbox-node-k1 in tmp/worktrees/sandbox-node-k1; no merge, deployment or VM access.

## Scope / Guardrails
- Scope: clean startup inventories, Linux quota outcomes, real-host isolation qualification and release packaging.
- Make-only workflow, no direct Docker commands.
- Root workspace `/home/antoinefa/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/worktrees/sandbox-node-k1` (verified mechanically with harness at base `6cc155d58`).
- Automated test campaigns must run on dedicated environments (`ENV=test` / `ENV=e2e`), never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `apps/sandbox-node/**`
  - `spec/SPEC_EVOL_SANDBOX_NODE.md`
  - `BRANCH.md`
  - `.github/workflows/ci.yml` (BRK1-EX1: only add `apps/sandbox-node/**` to the global filter).
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - [x] No scope exception required.

## Feedback Loop
- [x] RUN 9c finding 2 regressions: refuse active service, held lock, surviving scope, sandbox directory, runsc container and malformed inventory before creation; real flock exclusion/release test. Operator guide documents single-use marker and service exclusion.
- [x] RUN 9c finding 2 implementation: agent and qualification hold the same kernel lock; qualification requires inactive systemd service, clean inventory and consumes its marker. Regression coverage follows in the next atomic commit.
- [x] RUN 9c finding 1: build and ship qualification.erofs with SHA256SUMS; artifact verification requires its EROFS magic and checksum entry. No runtime mkfs.erofs dependency.
- [x] BRK1-EX1 authorized by conductor on 2026-11-13 05:50: add only `- 'apps/sandbox-node/**'` to the global filter in `.github/workflows/ci.yml`. Rationale: consumer-contracts requires every changed path to be classified; sandbox-node changes were unclassified. Impact: every sandbox-node change runs the full suite. Rollback: revert this single filter line.
- [x] K1 qualification prerequisite: production bundle upper root was 0700, inherited by overlay cwd, excluding sandbox uid 1000. Set only upper root to 0755; host bundle remains 0700 and workspace bind remains read-only. bundle.test.ts asserts both modes for session/build.
- [x] K1 final local verification: 27 files / 118 tests pass; both TypeScript projects, shell syntax and export GC pass on ENV=test-sandbox-node-k1. No API/UI stack started.
- [x] K1 cleanup regressions: isolation-runner.test.ts covers success, partial launch failure, failed probe, wrong scope policy, leaked mount and SIGTERM; cleanup is restricted to generated paths and preserves bases after a mount leak.
- [ ] K1 review limitation: harness/review requires h2a_run MCP and two complementary reviewer hosts; no matching tool is exposed. No peer consensus claimed; not a VM isolation acceptance.
- [x] Common-rules fallback: independent Astra high review identified the marker umask defect. Explicit chmod 0666 and real-filesystem regressions under umask 0022/0077 address it; EACCES remains a failure. Reviewer closure at d327b599a confirms the correction and identifies no further blocker. Single review, no two-host consensus.
## AI Flaky tests
- [x] No AI tests or flaky acceptance apply.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, independent read-only code review; no integration or cherry-pick.

## UAT Management (in orchestration context)
- [x] No UI surface changes; memory and Postgres conformance qualify the behavior.

## Plan / Todo (lot-based)
- [x] K1 Lot 0: verified existing branch with harness; ENV=test-sandbox-node-k1; no stack or ports started.
- [x] K1 Fix 1: normalize literal null runsc lists only; restart/lost+found/garbage regressions in restart.test.ts and runtime cleanup coverage.
- [x] K1 Fixes 4–5: shared code-or-errno recognition; qualification/source/runtime/export regressions. Audit: no EROFS/EXDEV/ELOOP/ENOTEMPTY branches exist; preserve their fail-closed failures.
- [x] K1 Fix 2: real-adapter two-tenant isolation qualification, standalone SEA command, shipped shell wrapper and cleanup checks. Tests cover refusal guard and observable read/write/network failures; execution on VM remains the k8s-owned gate.
  - [x] Real-adapter runner and in-sandbox probes; guards refuse non-isolated/non-root execution.
- [x] K1 Fix 3: archive root 0755, verification and operator custody modes.
- [x] K1 build/verify: archive f4cac77d73b130d770dd012a2196899b3fe1e51cc041a9c41d568485dc527818; nine internal checksums, extracted root 0755, SEA guard and uid 65534 self-test pass.
- [x] K1 handoff preparation: local gates and review correction complete; exact-head PR/CI final outcome is maintained in .tmp/rv/s1-agent-core.md RUN 9 and the s1-agent-k1.done marker after push. No merge or deployment.
- [ ] K1 Track handoff: designated conductor writer imports this BRANCH.md and RUN 9 evidence; this lane does not write the shared append-only journal.
