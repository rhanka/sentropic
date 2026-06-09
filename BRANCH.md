# Feature: fix/harness-branchmd-grammar — parse canonical BRANCH.md Allowed/Forbidden headings

## Objective
Fix a correctness bug in `@sentropic/harness` found during BR-42h pre-UAT: the `BRANCH.md` parser fails to extract Allowed/Forbidden Paths from the canonical `plan/BRANCH_TEMPLATE.md` headings (which carry a parenthetical suffix), silently producing an empty scope so every in-scope file is wrongly classified `unknown`.

## Scope / Guardrails
- Scope limited to `packages/harness/src/branch-md/parse.ts`, `packages/harness/tests/**`, `packages/harness/package.json`.
- 2-line regex fix + regression test + patch version bump (0.1.0 → 0.1.1).
- Make-only workflow; branch work in `tmp/fix-harness-branchmd-grammar`; tests on `ENV=test-*`.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/harness/src/branch-md/parse.ts`
  - `packages/harness/tests/**`
  - `packages/harness/package.json`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`

## Feedback Loop
- `acknowledge`: bug found by the BR-42h pre-UAT (real `harness` 0.1.0 installed via `npm i -g`): heading `**Allowed Paths (implementation scope)**` (canonical template) is not matched by the parser's `/\*\*Allowed Paths\*\*/` regex (closing `**` not adjacent) → allowed/forbidden silently empty → in-scope files classify `unknown`; C2 advisory hid it (audit-predicted "tolerant parsing hides misconfiguration"). Conditional already used prefix-match and worked.

## AI Flaky tests
- None (pure unit lib; no AI).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: single 2-line fix + regression test.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline**
  - [x] Worktree `tmp/fix-harness-branchmd-grammar` on `fix/harness-branchmd-grammar` (base current origin/main); branch verified.
  - [x] Reproduced the bug with the installed `harness@0.1.0`: `**Allowed Paths**` → in-scope PASS; `**Allowed Paths (implementation scope)**` → in-scope FAIL(unknown).

- [ ] **Lot 1 — Fix + regression test**
  - [x] `parse.ts`: Allowed/Forbidden bucket headings prefix-match (`/\*\*Allowed Paths/i`, `/\*\*Forbidden Paths/i`) like Conditional, so the parenthetical-suffix template parses; comment explaining why.
  - [x] `tests/branch-md/parse.spec.ts`: new test parsing the CANONICAL template headings (suffixes) → asserts allowed/forbidden/conditional globs extracted.
  - [x] `packages/harness/package.json`: 0.1.0 → 0.1.1 (patch; src change → enforce-package-bump).
  - [ ] Lot gate: `make typecheck-harness` + `make test-harness ENV=test-fix-harness-branchmd-grammar`.

- [ ] **Lot N — Final**
  - [ ] Full gate green + `make pack-harness` + `make lock-root` (version bump).
  - [ ] PR → CI green → merge → OIDC auto-publish 0.1.1 (trusted publisher attached 2026-06-08, no token/2FA).
  - [ ] Resume the BR-42h pre-UAT agent scenario on `harness@0.1.1`.
