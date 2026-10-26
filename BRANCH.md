# Feature: W1.b app artifact composition and current authority

## Objective
- [ ] Compose APP-P1 with durable app policy, opaque workspace scopes and one guarded HTTP/MCP effect path.

## Scope / Guardrails
- [x] Owner dispatch: W1.b, plan-v2 lines 128–147; tests first, draft PR only, no merge or deployment.
- [x] Worktree `tmp/worktrees/app-w1b`, branch `feat/app-cm-w1b`; base W1.a #773 `139729e9935c29112c7827d4684c79135404994f` (Opus APPROVE r2).
- [x] Main `ab981b16d` merged without rebase in `6ea8798a0`; artifacts 0.2.1 / mesh 0.22.4 inherited, no package/lock authoring.
- [x] Make-only; shared Docker flock for build/start/test, matching down after every step; `ENV=test-app-w1b` last.
- [x] API/UI/Maildev UI ports 8792/5178/1085 checked free before startup; no owner stacks touched.
- [x] Preserve W1.a migration authority and SQL hashes; W2.b alone reconciles final locks and physical image resolution.
- [x] Atomic authored commits below 150 lines, selective staging, scope-check and make commit; no attribution trailers.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/artifacts/composition.ts`
  - `api/src/services/artifacts/authorization.ts`
  - `api/tests/api/artifacts-host-publication.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/**`
  - `plan/**`
  - `.track/**`
  - `api/src/db/**`
  - `api/drizzle/**`
  - `api/package.json`
  - `api/package-lock.json`
  - `package-lock.json`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- [x] Exception process: declare BR01-EXn with reason, impact and rollback before expansion.

## Feedback Loop
- [x] BR01-EX1: owner requires merge of main after W1.a, never rebase. The ancestry-only merge inherits 247 upstream paths; no authored merge resolution except retaining W1.a BRANCH.md. Its scope-check reported inherited paths; subsequent authored changes use the four-path scope above. Atomic limit applies to authored deltas; upstream history stays intact.
- [x] PR targets `feat/app-cm-integration` as dispatched. Deviation: #773 currently targets main for CI; W1.b retains the integration destination and uses workflow_dispatch if its base does not trigger PR CI.
- [ ] W0-close.e acceptance and W1.c/UP-T activation remain external gates; this lot activates no route or reader.
- [ ] W2 binds verified transport identity and a current credential check on the coordinator transaction; credential verification must never come from tool/body arguments.

## AI Flaky tests
- [x] No AI tests, accepted flakes or increased timeouts.

## Orchestration Mode (AI-selected)
- [x] Mono-branch: one code author on the app integration train; upstream changes integrated by merge only.

## UAT Management (in orchestration context)
- [x] Backend-only composition; web, Chrome and VSCode remain for W2/W4/W5; no root UAT stack.

## Plan / Todo (lot-based)
- [x] Lot 0: read Docker lock, whole plan, APP-P1 freeze, MASTER/workflow/testing/API rules and template; mechanical branch check.
- [x] Lot 1: `api/tests/api/artifacts-host-publication.test.ts` first: HTTP/MCP identity and replay parity, ensure/publish, foreign authority, APP-P1 refusal. Red run failed on the missing composition module before implementation; `/tmp/app-w1b-red.log`.
- [ ] Lot 2: `authorization.ts`: current tenant/workspace/account/credential participants, post-wait rechecks and transactional quota; `composition.ts`: scoped PG store/KV/coordinator and shared transports.
- [x] Lot 3: same test file covers revocation after lock waits, DB-time expiry after quota/receipt waits, quota contention/rollback, guarded replay, version witness and no new durable success on denial; first full run 10/10 passed.
- [ ] Lot 4: typecheck-api, lint-api, focused publication/migration/tenancy regressions; runtime logs and stack cleanup; inspect each authored hunk.
- [ ] Lot 5: independent review/reconciliation, exact BRANCH.md draft PR body, push, green exact-head CI and W1.d/W2 handoff; do not merge.
