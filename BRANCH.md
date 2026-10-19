# Feature: Artifacts trust and publication hardening

## Objective
- [ ] Fix the seven verified artifacts findings for Track `01M5A25DNQ78WRK4618CXBW3HH` and deliver a draft PR.

## Scope / Guardrails
- [x] Branch `fix/artifacts-hardening`, worktree `tmp/worktrees/artifacts-hardening`, base `origin/main` at `cf0ad8ee4`.
- [x] Mechanical `harness check branch`: PASS C1.
- [x] Make only, Docker tools, no Python, ENV=test-artifacts-hardening last; no listening services during unit checks.
- [x] Selective staging, make commit, every commit under 150 changed lines, no attribution.
- [x] Do not merge or publish; preserve root work and shared Track log.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - [x] `BRANCH.md`
  - [x] `packages/artifacts/**`
  - [x] `package-lock.json`
- [x] **Forbidden Paths (must not change in this branch)**:
  - [x] `Makefile`
  - [x] `docker-compose*.yml`
  - [x] `.cursor/rules/**`
  - [x] `.track/**`
  - [x] `api/**`
  - [x] `ui/**`
  - [x] `plan/**`
- [x] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - [x] `.github/workflows/**`
- [x] Exception process: document BRAH-EXn with reason, impact and rollback before sensitive edits.

## Feedback Loop
- [x] Version coordination: open PR #707 reserves artifacts 0.1.3 and widens the optional platform peer to >=0.3.0 <0.5.0; this branch selects the next patch 0.1.4 and retains that widening. Both current mesh >=0.1.0 <0.2.0 and #707's >=0.1.3 <0.2.0 accept 0.1.4.
- [x] Baseline evidence: HTTP `src/http.ts:200` trusts body storageScopeId; `:202,251,520` accept client paramsHash. Service `src/server/service.ts:46` and publication `src/server/publication.ts:197` use global keys.
- [x] Baseline evidence: publication `src/server/publication.ts:138` hashes arbitrary files without path/size validation; content `src/content/handler.ts:92,154` allows HEAD then returns bytes; `:54` errors have only content-type.
- [x] Baseline evidence: `src/mcp.ts:18` imports platform tool-configuration at runtime.
- [x] Resume audit: seven commits and pending MCP split are readable; first build caught the missed needBytes argument in uploads/append; bound it before allocation.
- [ ] Document compatibility changes and migration in packages/artifacts/README.md.
- [ ] Designated Track writer imports this source plan; this worktree does not append .track.

## AI Flaky tests
- [x] No waiver or increased timeout; deterministic library checks.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, one coder; independent review only when available through the prescribed review surface.

## UAT Management (in orchestration context)
- [x] Library contracts only; no browser application changes or root dev UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and branch**: read rules, inspect findings, verify isolated branch, inspect #707.
- [ ] **Lot 1 — Authority and idempotency**
  - [x] Resolve ensure scope from trusted host context and ignore legacy body scope/hash.
  - [ ] Namespace service keys by operation and principal; hash validated parameters server-side.
  - [x] Ensure service now scopes keys and derives hashes; three focused repros failed against baseline before the fix.
  - [ ] Tests: service.test.ts, http-security.test.ts, HTTP/MCP parity and existing fixtures.
- [ ] **Lot 2 — Publication boundaries**
  - [x] Path/hash/principal repros failed in 17 cases against baseline; added service validation and server-derived replay digest.
  - [x] Validate canonical relative paths, duplicates, count, per-file and total bytes before effects; HTTP checks before allocating decoded bytes.
  - [ ] Compute publication hash over server-derived file digests and metadata; principal-scoped keys.
  - [ ] Tests: publication.test.ts, publication-security.test.ts, HTTP publication regressions.
- [ ] **Lot 3 — Content HTTP semantics**
  - [x] Suppress all HEAD bodies and apply security/cache headers to errors and activation; regression failed on baseline.
  - [ ] Tests: content-security.test.ts and content.e2e.test.ts.
- [ ] **Lot 4 — Platform-free MCP and release**
  - [x] Preserve /mcp compatibility; expose /mcp-core with no runtime platform dependency.
  - [x] Relocate MCP source with public exports preserved, before splitting its platform wrapper in a separate atomic commit.
  - [x] Finish compatible /mcp wrapper; MCP scoped tests passed 11/11 before release-version update; select unpublished 0.1.4 above npm 0.1.2 and retain #707 peer widening.
  - [ ] Packed clean-consumer proof with platform absent; update package version and provider version.
  - [ ] Tests: mcp.test.ts, packed consumer, typecheck-artifacts, lint-artifacts, test-artifacts.
- [ ] **Lot 5 — Delivery**
  - [ ] Review every hunk, scope-check before each commit, push and open draft PR using this plan.
  - [ ] Report draft PR number, HEAD and validation receipts; no merge or publication.
