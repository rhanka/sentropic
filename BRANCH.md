# Feature: artifacts 0.2.17 application mode (safe unchanged) + generic grant contract

## Objective
Ship @sentropic/artifacts 0.2.17 with a host-configured application content mode (safe stays bit-for-bit default) plus the generic J1.3b grant contract, in one PR without merging until #879 lands.

## Scope / Guardrails
- Scope limited to application CSP mode (safe default untouched), generic grant route + neutral consent screen, MIME map additions, 0.2.17 bump with CHANGELOG, and lock/pin refresh through make.
- One migration max in `api/drizzle/*.sql` (none expected; no migration planned).
- Make-only workflow, no direct Docker commands; every Docker-using make command goes through `.tmp/packets/docker-slot.sh`, one slot per command, never nested.
- Root workspace `~/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/worktrees/artifacts-0217`.
- Automated test campaigns run on dedicated environment (`ENV=test-art0217`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off). If subtree/sync is used, record source and target SHAs in `BRANCH.md`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.
- Merge freeze: no merge to main until PR #879 lands; this lane reports and opens a READY PR only.
- Tool definitions stay byte-stable; add a new tool version only if a definition must change.
- Ports: API_PORT=8798 UI_PORT=5198 MAILDEV_UI_PORT=1098 ENV=test-art0217.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/src/content/headers.ts`
  - `packages/artifacts/src/content/handler.ts`
  - `packages/artifacts/src/content/routing.ts`
  - `packages/artifacts/src/server/mime.ts`
  - `packages/artifacts/src/server/upload-page.ts`
  - `packages/artifacts/src/server/consent.ts`
  - `packages/artifacts/src/server/reader-consent-screen.ts`
  - `packages/artifacts/src/mcp-core.ts`
  - `packages/artifacts/src/http.ts`
  - `apps/artifact-content/src/host.ts`
  - `apps/artifact-content/tests/**`
  - `packages/artifacts/tests/**`
  - `packages/artifacts/CHANGELOG.md`
  - `packages/artifacts/package.json`
  - `api/src/services/artifacts/reader-consent.ts`
  - `api/src/services/artifacts/reader-consent-screen.ts`
  - `api/src/services/artifacts/instance.ts` (product readerConsent port only)
  - `api/src/routes/namespaces/artifacts.ts`
  - `api/tests/api/artifacts-reader-consent.test.ts`
  - `api/tests/api/artifacts-reader-grant.test.ts`
  - `api/tests/api/app-mcp-registry.test.ts`
  - `api/tests/api/app-mcp-installed.test.ts`
  - `api/src/services/mcp/cluster-registry.ts`
  - `package-lock.json`
  - `api/package-lock.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`
  - `packages/cluster-mesh/tests/packaging/artifacts-tuple.spec.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
  - `tools/memory-mcp-l5/**`

## Feedback Loop
- No exceptions declared.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: Two wagons in one PR on one branch, one integration lane, one CI run.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- No UI changes in this branch; no UAT lot. No merge until #879 lands.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline and constraints**
  - [ ] Read rules/MASTER.md, rules/workflow.md, .tmp/packets/COMMON-RULES.md, converged-r2 rows J1.1a J1.1b J1.3b and section 3, pass-sentropic-runtime-spark.md G-R1 G-R4, j1-0-report.md section 6.
  - [ ] Confirm worktree tmp/worktrees/artifacts-0217 on branch feat/artifacts-0.2.17-app-mode tracking origin/main at 843efe3a1.
  - [ ] Copy .env into the worktree for compose runs (gitignored, never committed).
  - [ ] Confirm environment mapping: ENV=test-art0217 always last; API_PORT=8798 UI_PORT=5198 MAILDEV_UI_PORT=1098.
  - [ ] Confirm scope boundaries and no BRxx-EXn needed unless a CI gate demands tools/memory-mcp-l5.
- [x] **Lot 1 — Tests first for application mode**
  - [x] Add failing-first tests in packages/artifacts/tests for the application CSP constant (every directive locked), safe-mode snapshot unchanged, reference SPA zero-violation shape, 404 for missing asset vs history fallback for extensionless HTML navigation, service worker refusal.
  - [x] Add failing-first tests in apps/artifact-content/tests for application mode (no unconditional worker-src none) and safe-mode bit-for-bit headers.
  - [x] Add MIME tests for .geojson .mjs .woff2 plus .wasm .pbf presence with no wasm-unsafe-eval.
  - [x] Lot gate: new tests fail on current code for the right reason (22 failed on content-application-mode, ceiling rejection on mime-map); make typecheck-artifacts + make lint-artifacts clean.
- [x] **Lot 2 — Wagon 1 application mode implementation**
  - [x] Implement host-configured safe/application content mode (safe default bit-for-bit); application mode serves the binding J1.0 CSP constant; remove unconditional worker-src none for application only.
  - [x] Implement history fallback to index.html for HTML navigations without extension in application mode only; missing asset stays 404; service worker stays refused in both modes.
  - [x] Extend MIME map per packet (.geojson .mjs .woff2; keep .wasm .pbf; no wasm-unsafe-eval).
  - [x] Lot gate: scoped make test-artifacts green (28/28 content-application-mode); safe snapshot unchanged; no tool definition bytes changed.
- [x] **Lot 3 — Wagon 2 generic grant contract**
  - [x] Wire grantWithFreshRights to a first-party HTTP grant route in api/src/routes/namespaces/artifacts.ts with host-declared scopes and versions.
  - [x] Add neutral host-parameterizable consent screen; single prescribed navigation from typed 403 code scopeId retryable false.
  - [x] Add fake non-immo tenant test: reader without consent reaches the screen in one click from the typed 403 with no loop.
  - [ ] Lot gate: scoped api consent/grant tests green; no loop; scopes and versions host-declared.
- [x] **Lot 4 — Version 0.2.17 and pins**
  - [x] Bump packages/artifacts/package.json to 0.2.17 and ARTIFACTS_PROVIDER_VERSION; add CHANGELOG entry.
  - [x] Regenerate locks/pins and APP-P1 digest once through make (digest 0725ef30 computed in the api container from the manifest definition, corroborated by registry tests); cluster-mesh selected fixture re-pinned to the verified packed 0.2.17 archive.
  - [x] Verify npm view @sentropic/artifacts version is below 0.2.17 after any rebase.
  - [x] Lot gate: make scope-check before every commit; commits under 150 lines via make commit.
- [ ] **Lot 5 — Final validation**
  - [x] Typecheck and Lint for impacted components (typecheck-artifacts, lint-artifacts 0 errors, typecheck-api, lint-api 0 errors, test-artifact-content 37/37 with tsc).
  - [x] Scoped make test-artifacts full unit run ENV=test-art0217 last (65 files, 675 tests green; one load-induced sqlite timing red resolved by identical-command re-run).
  - [x] Scoped api consent grant and registry tests ENV=test-art0217 last (grant 3/3, consent 3/3, registry 25/25, installed 2/2, tuple 4 passed 3 skipped).
  - [ ] Push early; open ONE READY PR with BRANCH.md as body; watch CI to green; no re-run except proven transient.
  - [ ] Write report to .tmp/rv/artifacts-0217.md; do not merge (freeze until #879 lands).
  - [ ] Run make down-volumes ENV=test-art0217 at the end (disk hygiene).
