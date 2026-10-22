# fix(security): patch critical DOMPurify advisory

## Objective
- [x] Remove vulnerable DOMPurify resolutions and qualify the first patched version, 3.4.17.

## Scope / Guardrails
- [x] Worktree: `tmp/worktrees/fix-dompurify`; branch: `fix/dompurify-critical-advisory`; base: `origin/main` at `4138a0ecb`.
- [x] Make-only workflow; no Python; `ENV=test-dompurify` last; one Docker build at a time.
- [x] No audit exceptions, allowlist changes, merge, or changes to the root development environment.
- [x] Ports reserved after availability check: API 9891, UI 5891, Maildev UI 1891.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `package.json`
  - `package-lock.json`
  - `ui/package.json`
  - `ui/package-lock.json`
  - `docs/governance/kit/package.json`
  - `docs/governance/kit/package-lock.json`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `.security/**`
  - `plan/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql`
- **Exception process**:
  - [x] No exception authorized or needed.

## Feedback Loop
- [x] CI run `39833406661`, UI job `120015499754`, fails in the Docker npm audit gate on DOMPurify.
- [x] npm advisory `1242880` / `GHSA-cg2g-xh64-v4q7`: CRITICAL, affected `>=3.4.4 <=3.4.16`, first patched `3.4.17`; no CVE assigned in advisory metadata.
- [x] Same patch also resolves HIGH `GHSA-mrv2-3pqr-j5jr` and the remaining DOMPurify advisories in the failing log.
- [x] Coverage: root workspace lock feeds API/UI Docker audits and SCA; standalone UI lock and governance kit lock also resolve DOMPurify; other tracked locks contain no DOMPurify.
- [x] Local Docker Hub pull fails on unreachable IPv6; mirror returns HTML. Used cached `node:24-bookworm-slim` via a temporary Make target; repository Makefile, Dockerfiles and audit policy unchanged. Standard pinned-image gates remain required in CI.
- [x] Extra governance-kit audit identifies unrelated devalue/lodash advisories outside the CI gate coverage; dependency expansion is outside this DOMPurify patch.

## AI Flaky tests
- [x] No flaky acceptance or timeout changes authorized.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; single author; no integration between branches.

## UAT Management (in orchestration context)
- [x] Dependency-only change; qualify rendering and sanitization with automated UI tests in the isolated worktree.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read repository rules, branch template, security/debug skills, CI logs and npm advisory database.
  - [x] Create worktree from origin/main and pass mechanical harness branch check.
  - [x] Identify all DOMPurify lock entries and Docker audit scopes.
- [x] **Lot 1 — Patch dependency resolutions**
  - [x] Set UI dependency and root/governance overrides to 3.4.17; all three locks change only DOMPurify resolution and direct dependency metadata.
  - [x] Registry confirms 3.4.17 integrity; workspace UI `npm ci --ignore-scripts --no-audit --no-fund --workspace sentropic-ui --include-workspace-root` passes.
- [x] **Lot 2 — Local validation**
  - [x] Through Make/Docker: `node .security/audit-gate.mjs --omit=dev --workspaces --include-workspace-root` and `--omit=dev --workspace sentropic-ui`: PASS.
  - [x] Through Make/Docker: npm audit for both workspaces plus `security-parser.sh sca` and `security-compliance.sh sca` for API/UI: PASS, no findings.
  - [x] Through Make/Docker: `npx svelte-kit sync` and `npm test` in UI: 83 files, 489 tests PASS; includes `ui/tests/utils/markdown.test.ts` (12) and `ui/tests/utils/todo-chat-rendering.test.ts` (3).
  - [x] No vulnerable DOMPurify remains in tracked locks; every implementation diff hunk reviewed.
  - [x] Mechanical `make scope-check ENV=test-dompurify`: PASS C2; selective staging and `make commit` only.
- [ ] **Lot 3 — Draft PR and exact-head CI**
  - [ ] Push branch; open draft PR using this file as its body and post the execution plan.
  - [ ] Verify CI passes on the final head SHA and retain BRANCH.md for review.
  - [ ] Clean temporary output and stop only this branch's test services; do not merge.
