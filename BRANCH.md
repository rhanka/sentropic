# Feature: app-cm-a4-g0 — A4 rebase + P1 reconciliation (lot G0 of a4-cm-gaps-r2)

## Objective
Lot G0 of the binding design `.tmp/cm-identity-agents/a4-cm-gaps-r2.md` (sha256 283cab237a4a2630c9a545e312399469af307adcca0b95feec7cdbf016e2058b), §10.1: on `feat/app-cm-a4` rebased onto post-#882 `origin/main`, apply the P1 reconciliation — §2.2 import split (9 auth-hono names to `@sentropic/cluster-mesh/identity/auth-hono`), §2.3.1 `handlerId` on both `deletePerson` commands, §2.3.2 merged cluster-mesh manifest (verified by the rebase union), §2.3.3 api build subpath resolution, plus the post-rebase migration-slot gate (control migration renumbered to the free slot 0015) and package-version gate (bump per repo rule).

## Scope / Guardrails
- Scope limited to the G0 lot: api import surface, one handlerId fix, the control migration slot renumber, cluster-mesh package manifest version, api vitest subpath alias, tests.
- One migration max: `api/drizzle/control/0015_app_cm_identity_cutover.sql` (control stream; renamed from 0014 because main took slot 0014 with `0014_session_content_policy_store`).
- Make-only workflow, no direct Docker commands; Docker under the packet flock `/home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md`, taken PER COMMAND; `make down ENV=test-a4-g0` after test stacks.
- Branch development in isolated worktree `tmp/worktrees/a4-gap-G0` on branch `feat/app-cm-a4-g0` from rebased `origin/feat/app-cm-a4` (33975baa0).
- Test campaigns on `ENV=test-a4-g0` (ENV last), never root dev. Ports: API_PORT=9650 UI_PORT=5850 MAILDEV_UI_PORT=1750.
- All new text in English.
- No legacy fallback; no CM backend edits (`packages/cluster-mesh/src/**` stays forbidden — P1a host widening is lot G0C, not this lot).
- Pins: a4-cm-gaps-r2.md sha256 283cab237a4a2630c9a545e312399469af307adcca0b95feec7cdbf016e2058b; A4 report `.tmp/rv/lot-A4.md` (stack boundary 905ca4ead, first A4 commit 2001799de); owner-answers-20261030.md (Q-K=A, Q-WS1, Q-IDP1 — not consumed by G0); A2.0b merged as 812d1f053, cluster-mesh 0.26.0-dev.6.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/**`
  - `api/tests/**`
  - `api/vitest.config.ts`
  - `api/drizzle/control/0014_app_cm_identity_cutover.sql` (deletion of the old slot name)
  - `api/drizzle/control/0015_app_cm_identity_cutover.sql`
  - `api/drizzle/control/meta/**`
  - `packages/cluster-mesh/package.json`
  - `package-lock.json`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `packages/cluster-mesh/src/**`
  - `packages/cluster-mesh/tests/**`
  - `packages/cluster-mesh/ui/**`
  - `.github/workflows/**`
  - `spec/**`
  - `ui/**`
  - `e2e/**`
  - `.env`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` public stream (not used; control stream only)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- [x] G0-REBASE — `feat/app-cm-a4` rebased onto `origin/main` replaying only the A4 range from `905ca4ead` (266 commits, `git rebase --onto origin/main 905ca4ead feat/app-cm-a4`); conflicts resolved: BRANCH.md kept as A4's own, `_journal.json` union (main idx14 `0014_session_content_policy_store` kept, A4 entry appended idx15), root `package-lock.json` cluster-mesh version kept at 0.26.0-dev.6; pushed `--force-with-lease` to 33975baa0. Rollback: `git reset --hard d3d7b09bc` on the old remote state.
- [x] G0-MANIFEST — §2.3.2 verified on the rebased tree: merged `packages/cluster-mesh/package.json` is the union (main exports incl. `./identity/auth-hono` + A4 `./ui/*` block, `files` incl. `ui`, union peers/meta/sideEffects, version 0.26.0-dev.6). No edit needed.
- [ ] G0-IMPORT-SPLIT — §2.2: split the 9 auth-hono names to the subpath in the 7 affected api files; root-import audit spec green.
- [ ] G0-HANDLER-ID — §2.3.1: `handlerId` on both `deletePerson` commands in `cm-account-deletion.ts`.
- [ ] G0-MIGRATION-SLOT — post-rebase gate: renumber the cutover control migration 0014 → 0015 (main owns 0014); journal, SQL id strings, `cm-cutover-config.ts`, tests, comment.
- [ ] G0-VERSION-GATE — post-rebase gate: bump `packages/cluster-mesh/package.json` 0.26.0-dev.6 → 0.26.0-dev.7 (> npm published 0.25.0) + root lockfile entry.
- [ ] G0-TEST-GATE — API typecheck + API build clean, root-import audit zero, cluster-mesh packaging spec green on the merged manifest.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single G0 lot on one branch off the rebased A4 branch; one CI run on the final head)
- [ ] **Multi-branch**
- Rationale: G0 is a small bounded edit set on the A4 lane; the design's stacking rules put CM lots on separate branches, G0 stays on the A4 lineage.

## UAT Management (in orchestration context)
- **Mono-branch**: no UI change in G0; qualification is typecheck/build/test gates only. A4's own runtime campaign stays with the A4 lane (item 7), not re-planned here.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read COMMON-RULES, MASTER, workflow, a4-cm-gaps-r2 §0–§4 + §10.0/§10.1, owner answers, A4 report, A4 BRANCH.md.
  - [x] Rebase `feat/app-cm-a4` onto `origin/main` in `tmp/worktrees/app-cm-a4-3`; push `--force-with-lease` (33975baa0).
  - [x] Post-rebase gates checked: npm published `@sentropic/cluster-mesh` = 0.25.0 < 0.26.0-dev.6; migration slot 0014 taken by main → renumber to 0015.
  - [x] Worktree `tmp/worktrees/a4-gap-G0`, branch `feat/app-cm-a4-g0`; `.env` copied; harness C1 PASS.
  - [x] BRANCH.md from `plan/BRANCH_TEMPLATE.md`.
  - [x] ENV mapping: `ENV=test-a4-g0`; ports API_PORT=9650 UI_PORT=5850 MAILDEV_UI_PORT=1750.
- [ ] **Lot 1 — Tests first**
  - [ ] `api/tests/unit/identity/cm-root-import-audit.test.ts`: root-import audit (named imports from exact `@sentropic/cluster-mesh` across api/src, api/tests, ui/src, ui/tests, e2e/tests vs root barrel reachability) — red before the split.
  - [ ] `api/tests/unit/identity/cm-account-deletion-command.test.ts`: both `deletePerson` commands carry `handlerId` — red before the fix.
  - [ ] Run both scoped specs on `ENV=test-a4-g0`, confirm red for the right reason.
- [ ] **Lot 2 — §2.2 import split + §2.3.1 handlerId + vitest subpath alias**
  - [ ] Split the 9 names to `@sentropic/cluster-mesh/identity/auth-hono` in the 7 affected api files.
  - [ ] Add `handlerId` to both `deletePerson` calls in `api/src/services/identity/cm-account-deletion.ts`.
  - [ ] Add `'@sentropic/cluster-mesh/identity/auth-hono'` alias in `api/vitest.config.ts`.
  - [ ] Audit spec + handlerId spec green; `make typecheck-api` clean.
- [ ] **Lot 3 — Migration-slot gate (0014 → 0015)**
  - [ ] Rename `api/drizzle/control/0014_app_cm_identity_cutover.sql` → `0015_app_cm_identity_cutover.sql`; update journal tag at idx 15; update SQL `migration_id` strings; update `cm-cutover-config.ts`, `cm-identity.ts` comment, `cm-cutover-migration.test.ts`, `artifacts-host-migrations.test.ts` tag filter.
  - [ ] Journal/renumber consistency covered by existing migration specs.
- [ ] **Lot 4 — Package-version gate + final gates**
  - [ ] Bump `packages/cluster-mesh/package.json` to 0.26.0-dev.7 + root `package-lock.json` entry.
  - [ ] `make typecheck-api ENV=test-a4-g0`, api build clean (§2.3.3 subpath resolves), `make test-cluster-mesh SCOPE=tests/packaging/identity-auth-types.spec.ts ENV=test-a4-g0`, scoped api specs green.
  - [ ] `make down ENV=test-a4-g0`.
  - [ ] Push branch, open READY PR, one CI run; report (do not merge).
