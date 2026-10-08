# Feature: SCA fixes — tinypool (CRITICAL) and source-map-js (HIGH) out of the root and ui trees

## Objective
Clear the two repo-blocking security findings (security-sast-sca: npm_audit_api_source-map-js HIGH; security-container: CVE-2026-104848/104849 tinypool 1.1.1 CRITICAL ×2 + CVE-2026-93749 source-map-js 1.2.1, all in the root workspace tree scanned by the api-tool image) so the 49-check main protection can pass again.

## Scope / Guardrails
- Scope limited to `package.json`, `ui/package.json`, `package-lock.json`, `ui/package-lock.json`.
- Make-only workflow; no direct Docker/npm commands outside the documented lock regen containers.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `package.json`
  - `ui/package.json`
  - `package-lock.json`
  - `ui/package-lock.json`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths**:
  - none beyond the allowed list (both lockfiles are direct targets here)
- **Exception process**: none required.

## Feedback Loop
- `attention`: tinypool 1.1.1 is the worker pool of ui vitest 3.2.7 hoisted into the root workspace tree; there is no 1.x patched release (next is 2.0.0), so the fix is ui vitest ^3.2.6 → ^5.0.3 (same approach as dependabot PR #648, applied to the ROOT tree that the api-tool image scans). ui `@types/node` goes ^20.14.2 → ^22.12.0 to satisfy the vitest 5 peerOptional (`^22.0.0 || >=24.0.0`) and the vite peer (`>=22.12.0`); other workspaces already run @types/node ^22.10.10.
- `attention`: source-map-js 1.2.1 → 1.2.2 via root override (same outcome as dependabot PR #649, which stays root-lock-only) + surgical lock bump in both locks (repo precedent: `make lock-api-direct`).
- `attention`: ui/package-lock.json cannot be regenerated in place (npm walks up to the workspace root); regenerated in an isolated copy of ui/ and copied back. Root lock regenerated with `npm install --package-lock-only`.
- `attention`: verified locally — repo audit gate on both trees: `audit-gate: OK — only allowlisted HIGH/CRITICAL remain []` (root `--workspaces --include-workspace-root` and ui).
- Supersedes dependabot #648 (ui tinypool/vitest) and #649 (source-map-js) — both become redundant after merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- Rationale: single dependency bump vertical; no sub-workstreams.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline**
  - [x] Worktree `tmp/secu-root-fix` off origin/main; `harness check branch` PASS.
- [x] **Lot 1 — Dependency bumps**
  - [x] `ui/package.json`: vitest ^5.0.3, @types/node ^22.12.0.
  - [x] `package.json` override: source-map-js 1.2.2.
  - [x] Root + ui lockfiles regenerated/patched (tinypool absent, source-map-js 1.2.2, vitest 5.0.3, @types/node 22.x).
  - [x] Local proof: audit-gate OK on root and ui trees.
  - [ ] Gate: branch CI green (49 checks), then merge.
