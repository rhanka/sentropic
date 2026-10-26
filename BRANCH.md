# Feature: Migrate all Zod consumers to v4

## Objective
- [x] Migrate zod 3.25.76 to zod >=4.6.6 across api, UI dependency trees, and packages, closing HIGH memory-exhaustion advisory GHSA-mrhx-c7xc-m3w5.

## Scope / Guardrails
- Scope limited to zod version bump plus required v4 API adaptations, no feature changes.
- One migration max in `api/drizzle/*.sql` (none expected).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/worktrees/sec-zod4` (packet path).
- Automated test campaigns run on dedicated environment (`ENV=test-sec-zod4`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off). If subtree/sync is used, record source and target SHAs in `BRANCH.md`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- 0 Python in repos and jobs. One Docker build at a time machine-wide.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/package.json`
  - `api/package-lock.json`
  - `package-lock.json` (root workspace lock sync for packages/* bumps)
  - `package.json` (root, `overrides` pin only — forces the single v4 line tree-wide)
  - `api/src/**`
  - `api/tests/api/organizations.test.ts` (PR #752 autosave status regression)
  - `api/tests/unit/zod-validator.test.ts` (PR #752 validation response contract)
  - `api/tests/unit/gateway-package-version.test.ts` (candidate gateway version evidence)
  - `api/tests/unit/google-drive-oauth.test.ts` (deterministic tamper test blocking CI)
  - `packages/auth-hono/**`
  - `packages/auth-ui/package.json` (auth-hono 0.17 peer support)
  - `packages/llm-gateway/package.json` (auth-hono 0.17 peer support)
  - `packages/cluster-mesh/package.json` (auth-hono 0.17 peer support)
  - `packages/cluster-mesh/src/modules/catalog.ts` (auth-hono 0.17 runtime preflight support)
  - `packages/cluster-mesh/tests/integrations/gateway-surface.spec.ts` (candidate version assertions)
  - `packages/cluster-mesh/tests/modules/registry.spec.ts` (auth-hono runtime version boundary)
  - `packages/comments/**`
  - `packages/skills/**`
  - `packages/cluster-mesh/tests/packaging/**` (Zod resolution in the frozen consumer)
  - `packages/cluster-mesh/tests/storage/comments-deps.package.json`
  - `packages/cluster-mesh/tests/storage/postgres.mk` (standalone consumer Zod resolution)
  - `packages/cluster-mesh/tests/comments-contract-boundaries.spec.ts`
  - `docs/comments-annotations/contract/package-zod4-migration.json`
  - `.security/vulnerability-register.yaml`
  - `.security/audit-allowlist.json`
  - `BRANCH.md`
  - `Makefile` (BR01-EX1, BR01-EX2: Zod pins and Compose-safe verification)
  - `scripts/ci/publishable-manifests.mjs`
  - `scripts/ci/publishable-classification.test.mjs`
  - `.github/workflows/ci.yml` (BR01-EX4: skills validation lane)
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**` (except the allowed ci.yml exception)
  - `ui/**`
  - `e2e/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- [x] Resync #755: preserve all BR-E2-EX1 Make targets, integration triggers, exact-head bump receipts and qualification predicates from main; union the host scope environments. No source, version or Track conflict.
- [x] BR-E2-EX1 resync: owner authorized merge of PR #752; merged main #751 with both Compose packaging runners and all qualification environments preserved. Added test-resync-752 to the existing host scope lane; rollback removes that environment. Reviewed migration code is unchanged.
- [x] CI 40288664433: gateway archive integrity differed because workspace and cold builds emitted different request-receipts.d.ts bytes. Rebuilt all gateway prerequisites in isolated storage with the CI recipe's pinned tools/dependencies; resulting archive SHA-256 3b0ad59cbdf3578a2160181c3f2ffa8bdb7a7106ae1a7f3552b955ee9570573f exactly matches CI. Pin the selected lock to that verified archive's SHA-512.
- [x] CI 40287324395: aligned Cluster Mesh runtime auth-hono preflight with 0.17 support and both API/Cluster Mesh gateway version assertions with 0.21.1. Focused Cluster Mesh boundary/surface tests 55/55 PASS and package build PASS; API version evidence 22/22 PASS. All four endpoint CI shards PASS, including autosave regressions.
- [x] Opus r1 P1: reproduced default injection under Zod 4.6.7; reserve defaults for POST. Added autosave PUT/GET regressions for draft/enriching/completed and explicit status updates in api/tests/api/organizations.test.ts (endpoint CI gate). Only folders/initiatives also use partial schemas; neither contains defaults. No wrapped defaults found in other migrated consumers.
- [x] Opus r1 P2-1: all 25 API router modules use one shared validator hook restoring the exact 400 envelope (success/error/issues/name, no message); JSON/query/success contract tests 3/3 PASS and API typecheck PASS via Compose. Zod 4 issue contents remain the native validation output.
- [x] Opus r1 P2-2: auth-hono 0.17.0 documents the breaking Zod peer change. auth-ui 0.7.7, llm-gateway 0.21.1 and cluster-mesh 0.22.2 widen their peer support; registry predecessors verified (0.7.6/0.21.0/0.22.1). Root/API locks refreshed; standalone API uses the local gateway candidate to avoid its published predecessor's incompatible peer. Three backend package builds PASS. Frozen selected versions/peer metadata and SHA-512 integrities refreshed from guarded auth-hono/gateway archives; exact-head CI validates the installed consumers.
- [x] Resume 2026-10-25: merge origin/main without rebase; preserve the six WIP commits. Track item `01M5PMR6AG9QDZG9H3N57TB3FS`; owner decision verbatim: « Exception datée + migration ».
- [x] BR01-EX2: allow the host scope-check lane for `test-sec-zod4` and an optional comparison base during the main merge. Reason: the default scope checker starts non-Compose containers, forbidden by the Docker packet. Impact: scope checking only; rollback: remove this environment and comparison-base parameter.
- [x] Merge containment: all 342 pre-merge Track event IDs survive; no local Track writes. Main now contains the dated Zod exception and body-parser fix; requalify the resumed migration.
- [x] PR #752 created as draft. Refresh main again to resolve its intervening BRANCH.md update and enable CI; retain this migration plan and all incoming source changes.
- [x] Expanded inventory: 44 API source files, five auth-hono handlers, comments Hono adapter, skills parser; UI/e2e have no direct consumer. Root/API locks resolve 4.6.7; the frozen cluster-mesh selected consumer still resolves 3.25.76 and needs its own lot.
- [x] Transitive inspection: Ollama 1.2.0 (latest published) declares a v3 peer but its runtime validation uses safeParse and the record parses successfully with 4.6.7. No application shim or v3 import introduced.
- [x] CI run 40243669602 reproduces a second independent consumer: comments-deps.package.json installs published comments 0.3.0 into scratch space and resolves vulnerable Zod 3. Pin Zod 4 for this audit/oracle tree and the installed-comments consumer; keep the frozen published peer identity.
- [x] Historical memory qualification lock-snapshots are content-addressed archived evidence, not active workspace install locks; preserve their bytes and hashes.
- [x] BR01-EX3: add the missing guarded skills build/pack lane and register it in the manifest inventory. CI 40243669602 fails because the changed, unpublished skills package has no pack-skills target. Impact: build/pack verification only, no publisher; rollback: remove this lane and its inventory entry. Make the existing pack runner overridable for Compose-only local verification.
- [x] BR01-EX4: wire the skills pack lane into CI and its final gates. Reason: the existing wiring regression requires one validation pack step per registered lane. Impact: additive validation only; rollback: remove the skills filter/job and gate dependencies with its pack registration.
- [x] CI 40244768449 passes the standalone audit and then reports only the frozen comments package-manifest hash mismatch. Preserve contract-v1.json and all 29 original pins; add a dated, digest-bound package migration receipt and verify that reversing exactly the version/Zod changes recovers the original bytes. Contract sources, exports and wire/hash rules stay pinned.
- [x] CI 40245755696 reaches packed consumers: the selected fixture still pins published auth-hono 0.16.0/comments 0.3.0 while same-PR receipts carry 0.16.1/0.3.1. Advance only those fixture entries and record the verified candidate archive integrities, retaining the Zod 4 resolution.
- [x] CI unit failure: google-drive-oauth.test.ts replaces the final signature characters with xx, which can decode to the same bytes as xw; an unchanged valid MAC then reports expiry. Flip a decoded signature byte and pass the test's fixed time so the tamper assertion always exercises authentication.
- [x] CI 40247946287 validates the new fixture pins, then exposes a missing comments substitution in prepare.sh: selected/latest consumers must resolve the same-PR comments archive with the existing verified-sibling resolver, instead of requesting the unpublished registry version.
- [ ] BR01-EX1 (`acknowledge` self): touch `Makefile` (Forbidden Path), pin-only changes of `zod@3.25.76`/`zod@3.23.8` install pins to the v4 line in package typecheck/test targets (skills, auth-hono, llm-gateway, auth-client, cluster-mesh peer tools). Reason: targets hardcode the exact zod version under test; without the pin update the gates keep validating against v3. Impact: version strings in ephemeral `npm install` commands only, no target logic change. Rollback: revert pin strings to v3.
- [x] `acknowledge`: `make scope-check` available (harness CLI installed); run before every commit.
- [x] Previous pause lifted by owner resume on 2026-10-25; merged the main fixes and refreshed the API lock. Current root audit reports zero HIGH/CRITICAL.
- [x] Local API endpoint tests need their normal Compose environment: qualification-only runs stop during env validation without SCW_TEM_SECRET_KEY. Full API/E2E validation runs in PR CI.

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
- Rationale: single dependency migration, sequential per-package lots in one worktree.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- **Multi-branch**: no UAT on sub-branches; UAT happens only after integration on the main branch.
- UAT checkpoints must be listed as checkboxes inside each relevant lot (no separate UAT section).
- Execution flow (mandatory):
  - Develop and run tests in `tmp/worktrees/sec-zod4`.
  - Push branch before UAT.
  - No interactive UAT: dependency migration with no UI behavior changes; validate API/UI/E2E in CI.
  - Switch back to `tmp/worktrees/sec-zod4` after UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/security.md`.
  - [x] Created isolated worktree `tmp/worktrees/sec-zod4` on `feat/security-zod4-migration` from `origin/main` (`7fb76b7b2`).
  - [x] Zod inventory: `api` (`^3.22.4`, locked 3.25.76) + `@hono/zod-validator ^0.7.6`; `packages/auth-hono` (`^3.25.76`, validator `^0.7.5`); `packages/comments` (`^3.25.76`); `packages/skills` (`3.23.8` pinned); `ui` and `e2e` have zero zod usage; `api/tests` touches zod only in frozen historical fixtures (out of scope).
  - [x] Breaking API surface: `error.errors` (6 sites) becomes `error.issues`; single-arg `z.record(value)` (skills parser, product-docx, bids, products, config-product-settings) becomes `z.record(z.string(), value)`; `z.string().email()`, `z.coerce`, `.strict()`, `.refine()` unchanged in v4.
  - [x] Existing `make sh-api` with COMPOSE_RUN_API selecting docker-compose.immo-861.yml qualification; `make down` after each step, both under the shared Docker lock.
  - [x] ENV=test-sec-zod4 last; qualification exposes no host ports. Reserved stack ports if needed: API 9065, UI 5265, Maildev 1165.
  - [x] Scope mechanically checked through harness; Makefile exceptions documented above.

- [x] **Lot 1 — packages/skills zod v4**
  - [x] Bump `zod` to `^4.6.6` (min, resolve `>=4.6.6`, no legacy shim) in `packages/skills/package.json`.
  - [x] Adapt `packages/skills/src/format/parser.ts`: single-arg `z.record` becomes two-arg.
  - [x] Bump `packages/skills/package.json` version (patch, must exceed npm published version per `npm view`).
  - [x] Lot gate:
    - [x] `make typecheck-skills ENV=test-sec-zod4` PASS (zod 4.6.7)
    - [x] `make test-skills ENV=test-sec-zod4` PASS (136/136)
    - [x] `make lock-root` refreshed (skills zod resolves 4.6.7)
    - [x] No API/UI/E2E test changes needed; integrated API/E2E suites are final CI gates in Lot 5.
    - [x] UI regression suite after SvelteKit sync: 83 files, 489 tests PASS via Compose qualification.
    - [x] No UAT (no UI change).
  - [x] Skills Compose build and strict guarded pack PASS; 56 classification, wiring and expected-result regression tests PASS with the new CI lane.

- [x] **Lot 2 — packages/comments zod v4**
  - [x] Bump `zod` to `^4.6.6` in `packages/comments/package.json`.
  - [x] Adapt `packages/comments/src/hono.ts` if typecheck requires (no change needed: enum/object/string/min/optional/nullable/safeParse stable in v4).
  - [x] Bump `packages/comments/package.json` version (patch, must exceed npm published version per `npm view`).
  - [x] Lot gate: `make typecheck-comments ENV=test-sec-zod4` PASS, `make test-comments ENV=test-sec-zod4` PASS (102/102), `make lock-root` refreshed (comments zod nests 4.6.7); no UAT (no UI change).

- [x] **Lot 3 — packages/auth-hono zod v4**
  - [x] Bump `zod` to `^4.6.6` in `packages/auth-hono/package.json`; verify `@hono/zod-validator` resolves v4-compatible (bump only if typecheck/resolution requires).
  - [x] Adapt `packages/auth-hono/src/*-handlers.ts` (5 files) if typecheck requires.
  - [x] Bump `packages/auth-hono/package.json` version (patch, must exceed npm published version per `npm view`).
  - [x] Lot gate: `make typecheck-auth-hono ENV=test-sec-zod4` PASS, `make test-auth-hono ENV=test-sec-zod4` PASS (239/239); `@hono/zod-validator@0.7.5` peer range already allows v4 (no bump); no UAT (no UI change).
  - [x] `make lock-root` deferred to Lot 4 (evidence: ERESOLVE — hoisted zod stays 3.25.76 while api pins `^3.22.4`; single hoist anchor left; lock refreshes once api moves to `^4.6.6`).

- [x] **Lot 4 — api zod v4 (resumed)**
  - [x] Bump `zod` to `^4.6.6` in `api/package.json`; refresh `api/package-lock.json` through the existing Compose qualification service.
  - [x] Replace `error.errors` with `error.issues` (magic-link, config-product-ai, session-device x3, session-lifecycle; live-declarations + queue-manager verified custom `string[]` interfaces, untouched).
  - [x] Replace single-arg `z.record(value)` with two-arg form (config-product-settings, product-docx, bids, products, proposals, solutions, view-templates, product-workspaces).
  - [x] `api/src/services/object-registry/json-schema-to-zod.ts` compiles with Zod 4 without changes.
  - [x] Refresh standalone API lock through the Compose qualification service; root and API resolve only Zod 4.6.7. Remove an unnecessary generic from `resources.ts` after reproducing Zod 4 output inference errors; existing resource endpoint tests cover target validation.
  - [x] Resume gates via Compose `make sh-api`: API typecheck PASS; auth-hono 239/239, comments 102/102, skills 136/136 tests PASS on the merged base.
  - [x] Root `overrides` pin `"zod": "^4.6.6"` added (single hoisted 4.6.7, zero v3) — `make lock-root` green.
  - [x] API typecheck via Compose PASS; full API, UI and E2E suites delegated to exact-head PR CI; no UAT (no UI change).
  - [x] Reproduced identical decoded bytes for xw/xx suffixes; the corrected signature-tamper/expiry case PASS in scoped Vitest. Full OAuth file requires its normal CI database fixture.

- [ ] **Lot 5 — Register cleanup + final validation**
  - [x] Root npm audit after migration: zero HIGH/CRITICAL, no Zod finding. Remove npm-audit/SCA-api dated exceptions and the GHSA allowlist first; remove remaining scanner aliases in the next atomic commit.
  - [x] Removed all Zod dated exceptions, including SCA UI and API/toolbox container aliases for both 3.25.76 and 3.23.8.
  - [x] `.security/audit-allowlist.json` has no Zod entry.
  - [x] Trim register trailing whitespace after exception removal; staged diff whitespace check PASS.
  - [x] Local API typecheck PASS; API lint PASS (0 errors, 219 warnings); package builds/typechecks PASS.
  - [x] Local UI regression: 489/489 PASS; auth-hono 239/239, comments 102/102, skills 136/136, packaging lock integrity 8/8 PASS.
  - [x] Exception-free Docker audit command PASS: `node .security/audit-gate.mjs --omit=dev --workspaces --include-workspace-root`. Register parses as YAML and every lock resolves only Zod 4.6.7.
  - [x] Coverage: root/API dependency trees use npm audit/SCA; UI lock has no Zod; API/toolbox images require rebuilt container scans in PR CI; frozen consumer installs with npm ci.
  - [ ] Exact-head PR CI: API unit/integration, E2E matrix, builds, typecheck/lint, SAST/SCA, IaC and rebuilt image scans.
  - [x] No AI flake accepted; any failure remains blocking for this draft handoff.
  - [x] Package versions bumped for changed source: skills 0.1.3, auth-hono 0.16.1; comments 0.3.1 also bumped. Published checks: skills E404, auth-hono 0.16.0, comments 0.3.0.
  - [x] Final gate step 1: PR #752 opened as draft; body mirrors BRANCH.md and first comment contains the five-step plan.
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Final gate step 3: retain BRANCH.md, keep PR draft, report exact head and CI result; do not merge.

- [x] **Lot 6 — cluster-mesh frozen consumer Zod resolution**
  - [x] Pin the selected fixture to Zod >=4.6.6, preserve overrides when preparing consumers, and refresh its Zod lock entry.
  - [x] Frozen consumer npm ci PASS (176 packages, Zod 4.6.7); packaging lock-integrity 8/8 PASS via Compose qualification.
  - [x] No application source or package version change; no UI/UAT change.
  - [x] Standalone comments audit/oracle and installed-comments consumer pin Zod 4. Reproduction after fix: six dependencies installed, Zod 4.6.7, npm production audit reports zero vulnerabilities; frozen oracle imports successfully.
  - [x] Contract-boundary suite 54/54 PASS, including rejection of export drift, Zod downgrade and a false predecessor digest; original frozen contract digest remains e027fdbb4a806df39809326697bf9b60ad5cb977eb1988af3be293da07161ba0.
  - [x] Actual local auth-hono/comments tarballs match both CI SHA-512 integrities exactly; official sibling lock check PASS and lock-integrity regression 8/8 PASS.
  - [x] Full packed preparation with guarded auth-hono/comments archives PASS; all 97 tests across 15 packaging files PASS, including selected/latest/global consumers and sibling verification, through Compose qualification.
