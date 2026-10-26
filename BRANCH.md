# Feature: Fix CI gateway mesh range wait (merged with main sec-zod4 plan; both kept)

## Objective
Fix `wait-llm-gateway-mesh-dependency` so a semver range dependency resolves before publishing llm-gateway.
- [x] Migrate zod 3.25.76 to zod >=4.6.6 across api, UI dependency trees, and packages, closing HIGH memory-exhaustion advisory GHSA-mrhx-c7xc-m3w5.

## Scope / Guardrails
- Scope limited to registry wait for gateway mesh dependency plus the merged zod v4 migration (no feature changes).
- One migration max in `api/drizzle/*.sql` (if applicable; none expected).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktrees (`tmp/worktrees/ci-gateway-wait`, `tmp/worktrees/sec-zod4`).
- Automated test campaigns run on dedicated environments (`ENV=test-ci-gateway-wait`, `ENV=test-sec-zod4`), never on root `dev`.
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
  - `Makefile` (BR01-EX1, BR01-EX2: Zod pins and Compose-safe verification; gateway mesh range wait)
  - `scripts/ci/publishable-manifests.mjs`
  - `scripts/ci/publishable-pack.test.mjs`
  - `scripts/ci/publishable-ci-wiring.test.mjs`
  - `scripts/ci/publishable-classification.test.mjs`
  - `.github/workflows/ci.yml` (BR01-EX4: skills validation lane)
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile`
  - `packages/cluster-mesh/packaging.mk`
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**` (except the allowed ci.yml exception)
  - `ui/**`
  - `e2e/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- [x] BR02-EX1: touch conditional `packages/cluster-mesh/packaging.mk` (`test-lazy-package` only: build workspace llm-mesh/llm-gateway/comments dists before packing them for the pre-publication fallback) plus `packages/cluster-mesh/tests/packaging/{prepare.sh,siblings.mjs,siblings.spec.ts,release-matrix.spec.ts}` (already allowed). Reason: PR CI is circular — the lazy gate installs workspace train versions from the registry, which 404 while their publication is what this PR unblocks. Impact: test-only; no published archive or manifest changes. Rollback: revert the prepare.sh fallback, the `train-spec` command, the spec updates and the added build lines.
- [x] BR01-EX1: touch conditional `Makefile` target `wait-llm-gateway-mesh-dependency` only. Merged resolution: adopt main's `dependencyFloor` recipe (union range resolves to its exact floor; main-CI-green), keep our range-aware `commandWait`/`waitForRange` machinery tested in `publishable-manifests.mjs`. Impact: one recipe line; no other target changed. Rollback: restore the single recipe line from `origin/main`.
- [x] CI run 40322725730 for PR #760: guard gates green (`validate-publishable-manifests`, `validate-llm-gateway`, `validate-llm-mesh`, `enforce-package-bump`, typecheck/lint). One failure: `validate-cluster-mesh` step `Qualify packed Cluster Mesh (lazy surface release gate)` cannot install `@sentropic/llm-gateway@0.21.1` (registry 404, version unpublished). Root cause is the blocked publication this branch unblocks, not this diff: no shared code path (lazy test never imports the guard module; pack steps passed), reproduced locally with the exact failing target. Needs owner decision: merge with override or bootstrap-publish 0.21.1, then re-run.
- [x] Resync #754: preserve live STT 0.28 support and Zod 4/auth-hono 0.17 support together. Main consumes gateway 0.21.1 and cluster-mesh 0.22.2; select free gateway 0.21.2 and cluster-mesh 0.22.3, refresh workspace/API/selected metadata and retain guarded archive integrities.
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
- Rationale: Single CI fix with one test cycle; merged main sec-zod4 plan kept for traceability.

## UAT Management (in orchestration context)
- [x] No UI change; no UAT required for the gateway wait fix.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read packet, `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `DOCKER-LOCK.md`, `harness-using-harness`, `durable-test-collateral`.
  - [x] Create worktree `tmp/worktrees/ci-gateway-wait` on `origin/main` as `fix/ci-gateway-mesh-range-wait`.
  - [x] Confirm scope and declare `BRCGW-EX1` before touching `Makefile`.
- [x] **Lot 1 — Range-aware wait**
  - [x] Extend `scripts/ci/publishable-manifests.mjs` wait with `waitForRange` (fresh packuments, full-range satisfaction, fail-closed).
  - [x] Merged resolution: `wait-llm-gateway-mesh-dependency` adopts main's `dependencyFloor` recipe; range machinery retained and tested.
  - [x] Add maintained tests: single caret, `||` range, unsatisfiable range.
  - [x] Lot gate:
    - [x] `make test-publishable-manifests ENV=test-ci-gateway-wait` (88 pass).
- [x] **Lot 2 — Circular lazy gate (BR02-EX1)**
  - [x] Pack workspace llm-mesh/llm-gateway/comments in `prepare.sh`; resolve via new `siblings.mjs train-spec` (receipt wins, else registry when published, else local tarball; other-version receipt, missing tarball, bad flag and non-404 registry errors fail).
  - [x] Build llm-mesh/llm-gateway/comments dists in `test-lazy-package` before packing.
  - [x] Regression checks: `train-spec` decision table in `siblings.spec.ts`; local-pack allowance in `release-matrix.spec.ts`.
  - [x] Lot gate:
    - [x] `make -f packages/cluster-mesh/packaging.mk test-lazy-package ENV=test-ci-gateway-wait` (15 files, 106 tests pass; mesh 0.28.1 + gateway 0.21.3 installed from local packs, no ERESOLVE).
- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint
  - [ ] Retest UI (cf Lot1, copy checklist)
  - [ ] Retest API (cf Lot1, copy checklist)
  - [ ] Retest e2e (cf lots e2e_groups like in Lot1)
  - [ ] Retest AI flaky tests (non-blocking only under acceptance rule) and document pass/fail signatures in `BRANCH.md`
  - [ ] Record explicit user sign-off if any AI flaky test is accepted
  - [ ] Bumped affected `packages/<pkg>/package.json` version (semver) for every package whose `src/**` changed in this branch — enforced by CI `enforce-package-bump`. See `rules/workflow.md → Package Publication`.
  - [ ] Final gate step 1: create/update PR using `BRANCH.md` text as PR body (source of truth).
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Final gate step 3: once UAT + CI are both `OK`, commit removal of `BRANCH.md`, push, and merge.

## Merged sec-zod4 plan (from origin/main; kept for traceability)
- Rationale: single dependency migration, sequential per-package lots in one worktree.

## UAT Management (sec-zod4; kept for traceability)
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

---

## Merged main plan (from origin/main 440599d04; kept for traceability, both sides preserved)

# Feature: Generic Decision capability — JEV first (BR96)

## Objective
- [ ] Deliver the strict decision contract, deterministic JEV adapter/service and lazy cluster surfaces in specification v2.2 §10.2; support the h2a native-plugin objective without consumer key custody.

## Scope / Guardrails
- [x] Execute `.h2a/inputs/build_brief.md`; specification `.h2a/specs/judge_spec_v2_2.md` and its Opus review are the design inputs.
- [x] Work only in `/home/antoinefa/src/sentropic/tmp/llm-judge`, branch `feat/llm-judge`; root dev/UAT remains untouched.
- [x] Baseline rebased onto origin/main `12be48eeb566439b9f455b106c7928065511aa7f` on 2026-10-04; mesh/gateway/cluster remain 0.22.3/0.19.1/0.13.0.
- [x] Build brief supersedes the spec's early-code prohibition: code/tests may proceed before PR #662 (with folded native relay) lands; TUPLE, migration generation and release qualification remain gated.
- [x] Make-only, Docker-first, no native package manager/Python; one Docker build at a time, Make uses -j1 after the OOM report; every Make invocation ends with ENV.
- [x] Never ENV=dev; never make clean-all; all new code, comments, commits and Markdown text are in English.
- [x] Tracked judge design/docs consolidation is a prerequisite before any PR or integration; the ignored draft is a local execution input only.
- [x] Integration test slot: API_PORT=9480, UI_PORT=5680, MAILDEV_UI_PORT=1580, ENV=test-llm-judge; ports absent from `ss -ltn` at kickoff, recheck before stack creation.
- [x] Pass all three ports on stack-capable commands; command-line ENV/ports replace editing a custody copy; verify project prefix/binding through `make ps` after first startup.
- [x] No real provider tokens or real JEV calls; synthetic fixtures/injected transports only. Live qualification needs conductor-relayed owner GO.
- [x] Atomic commits at most 149 changed lines/15 files including BRANCH.md; selective staging, separate add/commit, `make commit MSG="type: description"`; no attribution trailers.
- [x] Stop after every lot and write `.h2a/build/lotN_report.md`; conductor's Opus 5.5 high review must resolve blocking findings before the next lot.
- [x] No version bumps, packaging tuple/lock changes, publish, push, PR or merge until conductor GO after the /gw train lands; carve-outs: Sol P2 0.27.0/0.21.0/0.20.0 version/range/lockfile/qualification edits under active BR96-EX4/EX7/EX8/EX9, no publish.
- [x] Product durable-host §10.3, later providers/local serving and §9.3 architecture are outside this execution; portable client 2.09 is the explicit §10.2 cluster prerequisite.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - [x] `docs/comments-annotations/contract/package-zod4-migration.json` (BR96-EX33: incoming #752 contract attestation only)
  - [x] `packages/auth-hono/**`, `packages/auth-ui/**`, `packages/comments/**`, `packages/skills/**`, `package.json`, `scripts/ci/publishable-classification.test.mjs` (BR96-EX33: incoming #752 history only)
  - [x] `scripts/ci/publishable-manifests.mjs` (BR96-EX32: dependency-floor parsing only)
  - [x] `.tmp/live-stt/l1/**`, `packages/llm-mesh/src/speech/**`, `packages/llm-mesh/src/index.ts`, `packages/llm-mesh/tests/speech-contract.test.ts`, `packages/llm-mesh/CHANGELOG.md` (BR96-EX31: incoming #754 history only)
  - [x] `Makefile`, `docker-compose*.yml`, `api/**`, `e2e/**`, `docs/governance/**`, `packages/artifacts/**`, `packages/cluster-mesh/**`, `packages/llm-mesh/tests/facade.test.ts`, `scripts/ci/immo-861-*` (BR96-EX25: incoming origin/main history only; no new implementation scope)
  - [x] `BRANCH.md`, `.h2a/build/**`
  - [x] `packages/llm-mesh/src/judge/**`, `packages/llm-mesh/src/transport/jev.ts`
  - [x] `packages/llm-mesh/src/decision/**` (V4-L2 rename target; judge/** removed in the same lot, no dual tree)
  - [x] `packages/llm-mesh/src/providers.ts`, `packages/llm-mesh/src/capabilities.ts`, `packages/llm-mesh/src/catalog.ts`, `packages/llm-mesh/src/registry.ts`
  - [x] `packages/llm-mesh/tests/judge-*.test.ts`, `packages/llm-mesh/tests/transport/jev*.test.ts`, `packages/llm-mesh/tests/muse.test.ts`, `packages/llm-mesh/tests/gcp.test.ts`
  - [x] `packages/llm-mesh/tests/judge-fixtures.ts` (shared synthetic descriptors/requests; no live qualification or credentials)
  - [x] `packages/llm-mesh/tests/decision-*.test.ts`, `packages/llm-mesh/tests/decision-fixtures.ts` (V4-L2 renamed suites; judge-* removed in the same lot)
  - [x] `packages/llm-mesh/tests/execution-features.test.ts` (V4-L2-R1 scope completion; decision surface regression)
  - [x] `packages/llm-mesh/package.json` (judge export-map additions plus the 0.27.0 feature version; BR96-EX8 cascade)
  - [x] `packages/cluster-mesh/src/modules/contracts.ts`, `packages/cluster-mesh/src/modules/catalog.ts`, `packages/cluster-mesh/src/compose/llm-mesh.ts`
  - [x] `packages/cluster-mesh/src/integrations/llm-mesh/judge.ts`, `packages/cluster-mesh/src/integrations/llm-mesh/judge/**`, `packages/cluster-mesh/src/integrations/llm-mesh/transport/jev.ts`
  - [x] `packages/cluster-mesh/src/loaders/llm-mesh/judge.ts`, `packages/cluster-mesh/src/loaders/llm-mesh/judge/**`, `packages/cluster-mesh/src/loaders/llm-mesh/transport/jev.ts`
  - [x] `packages/cluster-mesh/src/integrations/llm-mesh/decision.ts`, `packages/cluster-mesh/src/integrations/llm-mesh/decision/**`, `packages/cluster-mesh/src/loaders/llm-mesh/decision.ts`, `packages/cluster-mesh/src/loaders/llm-mesh/decision/**` (V4-L2 rename targets; judge surfaces removed in the same lot)
  - [x] `packages/cluster-mesh/package.json` (judge export-map additions plus the 0.20.0 feature version and `<0.28.0`/`<0.22.0` peer ranges; BR96-EX8/EX9)
  - [x] `packages/cluster-mesh/tests/judge-*.spec.ts`, `packages/cluster-mesh/tests/modules/judge-loading.spec.ts`, `packages/cluster-mesh/tests/modules/capabilities.spec.ts`
  - [x] `packages/cluster-mesh/tests/decision-*.spec.ts`, `packages/cluster-mesh/tests/modules/decision-loading.spec.ts` (V4-L2 renamed suites; judge-* removed in the same lot)
  - [x] `packages/cluster-mesh/tests/integrations/llm-surface.spec.ts`, `packages/cluster-mesh/tests/integrations/gateway-surface.spec.ts`, `packages/cluster-mesh/tests/fixtures/train.ts`, `packages/cluster-mesh/tests/fixtures/package-tree.ts`
  - [x] `packages/cluster-mesh/tests/modules/registry.spec.ts`, `packages/cluster-mesh/tests/modules/topology.spec.ts`, `packages/cluster-mesh/tests/modules/topology-ranges.spec.ts`
  - [x] `api/src/services/provider-runtime.ts`, `api/src/services/provider-registry.ts`, `api/src/services/model-catalog.ts`, `api/src/services/llm-runtime/index.ts`, `api/src/services/llm-runtime/gateway-wire-adapter.ts`
  - [x] `api/src/services/settings.ts` (getAISettings marker preservation only: legacy model normalization otherwise erases a stored judge-only provider before 1.04b/c can refuse it)
  - [x] `api/src/routes/namespaces/config-product-ai.ts`
  - [x] `api/tests/unit/judge-*-selection.test.ts`, `api/tests/unit/provider-registry-expansion.test.ts`, `api/tests/api/judge-chat-settings.test.ts`
  - [x] `api/tests/api/decision-chat-settings.test.ts`, `api/tests/unit/decision-chat-selection.test.ts`, `api/tests/unit/decision-runtime-selection.test.ts`, `api/tests/unit/decision-wire-selection.test.ts` (V4-L2-R1 scope completion; renamed decision suites)
  - [x] `api/tests/unit/gateway-package-version.test.ts` (version literal follows the gateway bump only; BR96-EX8)
  - [x] `packages/llm-mesh/README.md`, `packages/cluster-mesh/README.md`, `spec/SPEC_EVOL_LLM_MESH.md`, `spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md` (judge semantics only)
- [x] **Forbidden Paths (must not change in this branch)**:
  - [x] `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`, `.github/workflows/idp-identity-sync.yml`, `plan/**`
  - [x] `packages/contracts/**`, `packages/events/**`, `package.json`
- [x] `packages/llm-gateway/src/**`, `packages/llm-gateway/tests/**`, `packages/llm-gateway/scripts/**`, `packages/llm-gateway/README.md`, `packages/llm-gateway/CHANGELOG.md`, `packages/llm-gateway/LICENSE`, `packages/llm-gateway/tsconfig.json`, `packages/llm-gateway/tsconfig.test.json`
- [x] `packages/cluster-mesh/tests/packaging/helpers.ts`, `packages/cluster-mesh/tests/packaging/*.mjs`, `packages/cluster-mesh/tests/packaging/*.sh`, `packages/cluster-mesh/tests/packaging/fixtures/global-consumer/**`, `packages/cluster-mesh/tests/packaging/fixtures/global-consumer-pinned/**`, `packages/cluster-mesh/tests/packaging/fixtures/separate-runtime/**`
  - [x] `ui/**`, `apps/**`, `deploy/**`, `api/src/db/**`, `api/drizzle/**`, `api/src/services/llm-metering/**`
- [x] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - [x] `api/tests/ai/initiative-generation-async.test.ts` (composite live API test outer budget only; BR96-EX27)
  - [x] `.track/events.jsonl`, `.track/head.json` (workflow-managed consolidate/acceptance records only, no product content; BR96-EX16)
  - [x] `ui/package-lock.json` (nested EX10 vite 7.3.6 to 7.3.7 security pin only, otherwise converged to main; BR96-EX10, BR96-EX16)
  - [x] `api/vitest.config.ts` (judge-subpath aliases only; declare a numeric branch exception before editing)
  - [x] `api/src/config/env.ts`, `api/src/services/settings.ts`, `api/src/services/business/organizations.ts`, `api/src/services/chat-service.ts`, `api/src/services/tool-service.ts`, `api/src/services/tools.ts`, `api/src/services/context-organization.ts`, `api/src/services/model-catalog.ts`, `api/src/services/model-selection-legacy.ts` (OpenAI nano-retirement default/fallback/cutover bump to the registered gpt-5.4-nano successor only; BR96-EX18)
  - [x] `api/tests/utils/test-helpers.ts`, `api/tests/api/me.test.ts`, `api/tests/api/models.test.ts` (TEST_MODEL fallback, default-model assertions and nano cutover regression for the retirement bump only; BR96-EX18)
  - [x] `api/tests/ai/documents-tool.test.ts`, `api/tests/unit/model-selection-legacy.test.ts`, `api/tests/unit/decision-chat-selection.test.ts`, `api/tests/unit/decision-runtime-selection.test.ts`, `api/tests/unit/llm-runtime-stream.test.ts`, `api/tests/unit/vscode-code-agent-prompt-profile.test.ts`, `api/tests/api/chat-tools.test.ts`, `api/tests/unit/chat-service-tools.test.ts`, `api/tests/unit/chat-service-batch-create-orgs.test.ts`, `api/tests/unit/chat-service-document-generate.test.ts`, `api/tests/unit/chat-service-document-generate-pptx.test.ts` (stale gpt-4.1-nano default/model pins and reasoning-effort call-sequence expectations updated to the registered gpt-5.4-nano successor for the retirement bump only; BR96-EX20)
  - [x] `.security/audit-allowlist.json`, `.security/vulnerability-register.yaml` (GHSA-mrhx-c7xc-m3w5 time-boxed allowlist + register record only, review_due 2026-10-30; BR96-EX19; plus the two Trivy container-gate finding-id records for the same advisory, BR96-EX24)
  - [x] `api/src/routes/namespaces/llm-mesh.ts` (only aiSettingsSchema/updateUserSettings if the existing typesafe refusal needs a source edit)
  - [x] `package-lock.json` (root lock mirrors for the 0.27.0/0.21.0/0.20.0 cascade only, BR96-EX4; dompurify 3.4.17 security pin only, BR96-EX13; body-parser 2.3.0 to 2.4.0 + qs 6.15.3 to 6.16.1 + nested content-type 2.0.0 to 2.1.0 security pin only, BR96-EX21)
  - [x] `api/package.json` (body-parser ^2.4.0 transitive override only, mirroring the proxy-addr precedent; BR96-EX21)
  - [x] `api/package-lock.json` (body-parser 2.3.0 to 2.4.0 + qs 6.15.3 to 6.16.1 security pin only, BR96-EX21)
  - [x] `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json`, `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json` (B3 0.20.0 candidate and sibling archive lock pins only; BR96-EX7)
  - [x] `packages/llm-gateway/package.json` (mesh range ^0.27.0 and the required 0.21.0 bump only; BR96-EX8)
  - [x] `api/package.json` (gateway range ^0.21.0 only, keeps the workspace link; BR96-EX8)
  - [x] `packages/cluster-mesh/tests/packaging/optional-install.spec.ts`, `packages/cluster-mesh/tests/packaging/skew-invariants.spec.ts`, `packages/cluster-mesh/tests/packaging/skew-invariants.ts`, `packages/cluster-mesh/tests/packaging/types-and-bundlers.spec.ts` (coupled `<0.28.0`/`<0.22.0` peer range and 13 `.d.ts` integration leaf assertions only; BR96-EX9)
  - [x] `.github/workflows/ci.yml`, `scripts/ci/publishable-ci-wiring.test.mjs` (cluster-mesh qualification `PEERS` tuple `@sentropic/llm-mesh@0.27.0,@sentropic/llm-gateway@0.21.0` only; BR96-EX9)
  - [x] `tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json`, `tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json.sha256`, `tools/memory-mcp-l5/artifacts/history/*.json`, `tools/memory-mcp-l5/artifacts/history/*.json.sha256`, `tools/memory-mcp-l5/artifacts/lock-snapshots/*.package-lock.json` (P1 provenance declaredLockSha256 re-pin plus superseded-manifest retention and pack-generated root-lock snapshots only; BR96-EX12, BR96-EX14, BR96-EX17)
- [x] **Exception process**: use the numeric BR96-EXn grammar with rationale, impact and rollback before a conditional/forbidden edit; active: BR96-EX4, BR96-EX7, BR96-EX8, BR96-EX9, BR96-EX10, BR96-EX11, BR96-EX12, BR96-EX13, BR96-EX14, BR96-EX15, BR96-EX16, BR96-EX17, BR96-EX18, BR96-EX19, BR96-EX20, BR96-EX21, BR96-EX22, BR96-EX23, BR96-EX24.

## Feedback Loop
- [x] EX33 exact-archive qualification: shared lock released externally; real guarded mesh 0.28.1 / gateway 0.21.3 archives match the refreshed frozen lock for cluster 0.22.4. All 100 packaging/import/type/skew tests passed with Zod 4 and published auth-hono 0.17.0/comments 0.3.1. No process interruption was performed. Scope and Track containment checks passed; reviewed Decision source remains unchanged.
- [x] EX33 scope completion: the advisory C2 scan flagged the incoming Comments Zod contract attestation as undeclared; add that exact inherited document path and recheck the full integration delta with SCOPE_BASE=31630a0fa. No authored document or product change.
- [x] Lifecycle refresh at merge 3bddd94f0: Track CLI re-anchored two eligible done items; reread leaves the same 15 done items NOT consolidated - to treat (acceptance unknown). Journal integrity remains valid at 370 events.
- [x] BR96-EX33: main advanced through Zod 4 #752 (7815a2a85) while CI 40319367382 had passed Cluster Mesh and all E2E groups. Merge main without rebase, retain its Zod 4 migration, validation envelopes, security removals and configurable pack runner; preserve the reviewed Decision sources and the tested compound-range wait fix. Advance cluster to 0.22.4 above main 0.22.3 and gateway candidate to 0.21.3 above main 0.21.2; retain mesh 0.28.1. Align current auth/comments peers and real archive fixture metadata. Drop the resolved Zod/provider-utils branch exceptions, retain only the unrelated pre-existing undici toolbox record. Scope: incoming migration plus bounded merge/tuple resolutions only. Rollback: revert this integration merge and tuple alignment.
- [x] EX32 final qualification: gateway 0.21.2 and mesh 0.28.1 guarded archives match the selected lock; packed consumer/import/type/skew qualification passed 100/100. Full publication-guard regression suite passed 88/88 after aligning CI peers; per-step Compose cleanup completed. Candidate Gateway metadata now differs from main, so same-PR sibling qualification includes its archive without relying on the failed 0.21.1 publication.
- [x] EX32 regression validation: wiring suite 24/24 passed, including the real Make version-selector command, caret/union/comparator ranges and malformed/unsatisfiable refusal. The actual wait-llm-gateway-mesh-dependency target passed with one cache-bypassing registry read of mesh 0.27.0; cleanup completed.
- [x] BR96-EX32: CI 40315291563 cannot install gateway 0.21.1 (registry HTTP 404). Main run 40313611927 proves its publisher passes the literal string `0.27.0 || ^0.28.0` to the exact-version registry wait after stripping one caret. Parse the dependency floor with the existing pinned semver helper, preserve the wait budget and registry cache bypass, and add a regression. Advance the unpublished gateway candidate to 0.21.2 so PR sibling qualification carries its exact archive; align workspace lock, independent train, API version assertion, CI peers and selected fixture. Scope: bounded Make/guard helper and existing tuple/test paths; no Decision source change. Rollback: revert this correction and its tuple metadata together.
- [x] Lifecycle refresh at merge 8935888eb: Track CLI re-anchored two eligible done items; report reread leaves the same 15 done items NOT consolidated - to treat (acceptance unknown). Journal integrity and containment remain valid after the four generated events.
- [x] EX31 validation: full LLM Mesh 1381/1381, real guarded packed Cluster Mesh qualification 100/100 (15 files), and CI wiring/expected-results 38/38 passed under the shared lock with per-step teardown. Frozen lock mesh/gateway integrity matches the exact guarded archives. Decision implementation remains byte-identical to 46df280cc. Track needs no conflict repair: 362 valid events contain both parent journals (362 branch, 346 main).
- [x] EX31 verification: admit test-llm-judge in the incoming speech verification adapter ENV guard so its existing mesh and guarded packed-tuple targets can verify the merge under the required isolated project. Same recipes, Docker lock and cleanup; rollback removes this ENV from the adapter guard.
- [x] BR96-EX31: main advanced through live speech #754 (6c3f9f04a) during CI 40312214853; cancel that superseded run and merge main without rebase. Retain all speech and reviewed Decision sources; resolve release metadata to mesh 0.28.1 / gateway 0.21.1 / cluster 0.22.3, above main's 0.28.0 / 0.21.1 / 0.22.2 where this branch changes source. Align train literals, CI peers, public-surface version assertion and frozen selected fixture with guarded sibling archives. Scope: incoming speech history plus existing tuple/fixture/CI paths only. Rollback: revert this merge and its tuple alignment together.
- [x] Lifecycle refresh at merge ce57fd093: re-anchor the two eligible done items using the Track CLI and reread the report; 15 done items remain NOT consolidated - to treat (acceptance unknown). The source trees of llm-mesh and cluster-mesh are byte-identical to the fully green head 444e7e41d.
- [x] EX30 local validation: publication wiring and CI expected-results suites passed 38/38 through Compose under the shared lock; cleanup removed the test project. No Track conflict: valid 358-event journal contains both parent logs (358 branch, 346 main).
- [x] EX30 verification lane: extend the incoming test-publishable-manifests Compose filter to test-llm-judge so wiring and expected-result regressions run through the existing target under the shared lock. Default runners and every assertion stay unchanged; rollback removes that ENV from this target.
- [x] BR96-EX30: exact-head CI 40303208631 attempt 2 passed at 444e7e41d (61 successful checks; E2E group-a rerun cleared Mistral Service unavailable). Main advanced through #755 during that run; merge 2e9ce682f with a merge commit, preserve incoming E2 CI routing and publication guards, combine Compose ENV allowlists, and retain this plan. Impact: Makefile/.github/workflows/ci.yml incoming history and bounded allowlist resolutions only; no Decision source or version changes. Rollback: revert this integration merge.
- [x] EX28/EX29 validation: full Compose-isolated make test-cluster-mesh passed, 1127 tests in 138 files with 129 existing conditional skips. Decision suites, #729 common-rule/scope-grant regressions and #751 artifacts integration pass. Decision source remains byte-identical to reviewed 46df280cc; incoming common contract and artifacts source match origin/main.
- [x] BR96-EX29: registry verification after #729 confirms cluster-mesh 0.22.1 is published; advance this candidate to 0.22.2, including workspace lock, independent train literal and selected fixture candidate identity. llm-mesh 0.27.2 remains above published 0.27.1. Scope: existing EX26 version/fixture paths only, no Decision source changes. Rollback: revert these five version/fixture files together.
- [x] Lifecycle refresh at integration merge 7938a1859: consolidate re-anchored the same two eligible done items through four CLI-generated events; reread leaves 15 done items NOT consolidated - to treat (acceptance unknown).
- [x] BR96-EX28: owner authorizes merge commits from current origin/main and PR #693 after exact-head green CI. Merge fc1c87c6b (#729 and #751), retain the reviewed Decision implementation and this branch plan, combine both Compose ENV allowlists and retain the incoming publication wait budget. Incoming-only scope includes scripts/ci/publishable-ci-wiring.test.mjs and .github/workflows/ci.yml; no new product scope. Track needs no union repair: the valid 354-event journal contains all events from both parents (354 branch, 346 main). Rollback: revert this integration merge.
- [x] BR96-EX27: CI 40238458478 attempts 1-3 repeatedly exhaust the full live API workflow's 120-second outer budget across sequential Mistral enrichment, generation, detail and summary calls; attempt 2 generated all three initiatives and reached an idle queue at the deadline. Raise only that API test's outer budget to 180 seconds; retain every assertion, per-phase limit, initiative count and live provider call. Scope: one test and this declaration, no product or E2E changes. Rollback: restore its 120-second outer budget.
- [x] EX26 fixture follow-up: CI 40237356761 passed 1122 cluster tests and failed the frozen artifacts baseline assertion because lock regeneration selected artifacts 0.2.0 while the fixture explicitly pins published 0.1.4. Restore only that unrelated lock record (version, registry URL and original integrity); retain llm-mesh 0.27.2 and cluster-mesh 0.22.1. No assertion or product behavior changes.
- [x] EX26 validation: public Decision surface 4/4, CI wiring 22/22, exact llm-mesh 0.27.2 guarded pack and selected-lock regeneration passed in the isolated Compose lane; P1 manifest verification passes without regeneration. Preserve MANIFEST_GUARD_IMAGE overrides outside the Compose lane.
- [x] BR96-EX26: post-merge CI 40236714211 proves unchanged-version failures for llm-mesh 0.27.1 and cluster-mesh 0.22.0 (both published). Bump to 0.27.2 and 0.22.1; align root lock, train, public-surface assertion, selected fixture and CI sibling pins. Extend the existing Compose qualification lane to test-llm-judge for required builds, packs and tests under the shared lock. Scope: Makefile, cluster packaging.mk and existing version/fixture/CI conditional paths only. Rollback: revert this bounded version and lane update together.
- [x] BR96-EX25: owner-authorized merge of origin/main `fa8f2334c` without rebase. Preserve incoming history outside Decision scope, main's zod audit gate and Mistral CI, reviewed Decision code and the branch plan; resolve version/peer conflicts to main's current package versions. Impact: inherited changes and bounded merge resolutions only. Rollback: revert this merge on the feature branch.
- [x] R4-N1 validation after main integration: full Compose-isolated `make test-cluster-mesh` passed (1123 tests, 137 files; 129 existing conditional skips); decision receipt suite 4/4. Shared Docker lock and matching teardown used.
- [x] `make typecheck-cluster-mesh` passed through the same isolated Compose lane. Owner-approved Track union applied: 350 events, valid integrity and head, both 346-event parent journals fully contained.
- [x] Post-merge lifecycle refresh: four CLI-generated events anchor two eligible done items to e4ea31c58; 354 total events retain the full union. The other 15 done items remain NOT consolidated - to treat (acceptance unknown); no acceptance was invented.
- [x] R4-N1: bind the decision receipt test tariff to `fixture:synthetic-tariff` / `jev-native`; preserve mandatory production tariff binding. Owner requests merge of origin/main without rebase, push, and green CI on the exact head; do not merge PR #693.
- [x] Q1 working assumption: develop code/tests now per launch brief; after PR #662 (with folded native relay) lands, rebase/recheck and wait for conductor GO before the reserved tuple. No alternate tuple.
- [x] Q2/Q5/Q6 working assumptions remain revisable: product /llm-mesh host later; common ProviderId with explicit judgeOnly marker; environment-only JEV key, no BYOK.
- [x] Review S1: before future 2.08a, add app.ts registry authPaths union and root-mount-fence-completeness/namespace-inventory regressions; future host scope must explicitly include these paths.
- [x] Review S2 working assumption for future API tests: non-secret REGISTRY=local configuration with no provider keys; conductor confirms review-slot provisioning before any review/API stack launch.
- [x] Review s1: current GO covers §10.2 plus prerequisite 2.09; durable host rows 2.01–2.12 and TUPLE are not implicitly authorized by the phrase “Lot 1”.
- [x] Review s2/s3: future live guard needs a fsynced, ignored cross-run attempt ledger, boolean-only key check, injected public-rate estimate, command-line project/port overrides and startup verification.
- [x] Review s4/s5: future host uses DPoP for bound tokens, rejects workspace selectors, sanitizes duplicate-binding configuration failures; migration regeneration must have zero artifact delta.
- [x] Track source artifact only: concurrent worktree is not designated .track writer; conductor imports BRANCH.md under track-operation single-writer rules.
- [x] Lot 0 Opus review: no BLOCKER; M1 maps the brief's BRJ-EXn spelling to numeric BR96-EXn; exception numbers 1–3 remain reserved for future Compose/migration/TUPLE and numbers 4+ for Lot 1. Do not list concrete inactive IDs, since the harness unlock is global.
- [x] M2: 1.26a/b defer until PR #662 (with folded native relay) merged, rebase completed and 2.12 committed; no pre-train literal fixture changes.
- [x] M3 conductor decision, 2026-10-04: SPLIT into 1A contracts (1.01–1.03), 1B chat gates (1.04a–g), 1C JEV/service (1.05–1.18), 1D client/cluster/docs (2.09, 1.20a–1.23, 1.25a…). Stop/report/Opus review after each; no next checkpoint before blocking findings are resolved.
- [x] m1: user default-provider route is llm-mesh.ts, not config-product-settings.ts; 1.04e asserts its existing closed-enum refusal through judge-chat-settings.test.ts; conditional source scope is limited above.
- [x] m2: 1.04f includes R API provider-mesh-contract-proof.test.ts/provider-credentials.test.ts and mesh local.test.ts; any necessary test edit requires scope extension first. Gateway typecheck/lint/full tests join the checkpoint gates.
- [x] m3: template docs/final lots and English/dev/clean-all guardrails restored; release steps stay unchecked and conductor-gated.
- [x] m4: test-llm-judge replaces spec slot-0 test-llm-judge-int throughout this execution and the future host runbook; cleanup always includes the complete port triple and ENV.
- [x] m5: tracked consolidation into SPEC_EVOL_LLM_MESH.md is mandatory before PR/integration, so the ignored design draft is never the sole reviewer reference.
- [x] m6: host-global harness C1/recorder output is advisory; repository make scope-check C2 is authoritative. Makefile remains forbidden; no new host packages or C1 target.
- [x] Lot 1A M1/m4: reproduced proxy serialization drift and unbounded shared-reference traversal; copy data descriptors under a byte-derived work budget, serialize once and validate/return the same detached copy.
- [x] Lot 1A M2/m3: retryability is phase-aware; all settlement-phase errors and financial-authority errors after admission refuse retry hints. Keep advisory retryAfterMs in 0–60,000 ms, matching the maximum deadline; test all 26 codes across five phases and carry this rule into 1.25a docs.
- [x] Lot 1A m2: pin all listed request/verdict/receipt refusal branches, including declared-label checks, schema/evaluator/context/direction, standalone zdr, non-boolean native decision, missing evaluatorCalls and invalid-phase fallback.
- [x] Lot 1A m6: unsafe JSON keys are __proto__, constructor and prototype at every depth, including evaluated content; tests pin this policy. Canonical MicroUsd has no separate digit ceiling within the whole-request 256 KiB bound; future 1.14 arithmetic uses BigInt, never floating point.
- [x] Lot 1A m1: type declarations do not qualify criterion-kind, decision-confidence/native-decision or providerRaw enforcement; explicit 1C sub-items below own these remaining invariants.
- [x] Lot 1A m5 — conductor decision, 2026-10-05: JSON null is valid significant candidate content. Output-only null, state-only null and both-null are accepted; an absent candidate or any explicit undefined field is REQUEST_INVALID. Pin the request cases now and encode present null fields explicitly at 1.05.
- [x] Lot 1B Opus review, 2026-10-05: GO with fixes, no BLOCKER or MAJOR; prior Lot 1A corrections confirmed. This review covers the entry-stop range, not implementation of 1.04a–g.
- [x] Lot 1B m1: reproduced invalid-phase SETTLEMENT_UNAVAILABLE returning retryable true; unrecognized phases now fail closed with preflight shape, retryable false and no retryAfterMs. The financial-error fallback regression pins both fields.
- [x] Lot 1B m2: reproduced live score/confidence/usage drift and duplicate descriptor-key reads; all four parsers now validate and return detached snapshotBoundedJson data. Proxy regressions pin score/confidence/distribution/usage; symbol refusal uses the materialized descriptor object from the same ownKeys read as copying.
- [x] Lot 1B m3 — conductor delivered the valid-null semantic decision on 2026-10-05; the 1B entry hold is released without relocating the gate. Complete 1.04a–g and stop at .h2a/build/lot1B_impl_report.md for its own implementation review.
- [x] Lot 1B follow-up stop: only review findings and handoffs recorded; no implementation change or new acceptance tests. Update .h2a/build/lot1B_report.md and stop per the instruction to report required conductor decisions.
- [x] 2026-10-05 continuation: Lot 1B code findings m1/m2 are now implemented; m3 remains a conductor decision. Rows 1.04a–g are still unimplemented; .h2a/build/lot1C_report.md records corrections and the entry stop, not checkpoint completion.
- [x] Lot 1C Opus review, 2026-10-05: GO with fixes, no BLOCKER or MAJOR; Lot 1B m1/m2 and the symbol nit accepted. Reviewed range 2ce265e2d..806082dcc covers corrections and the decision stop only; 1B/1C implementation remains unreviewed because it is not started.
- [x] Lot 1C m1 routed to the unchecked 1.07 sub-item: copy the declared outcome table once and build returned entries inside validation from local bindings; add a declared-outcome getter drift regression in judge-verdict.test.ts. Routing is complete; implementation is pending.
- [x] Lot 1C m2 routed to the same unchecked 1.07 sub-item: split confidence/distribution Proxy tests and observe each regression independently. The previous combined red count does not demonstrate distribution independently; test work is pending.
- [x] Lot 1C handoffs: literal service phases, strict remote wire errors, validated inputs to decision helpers and baseline refresh before any 1B API stack are owned by the unchecked sub-items below.
- [x] Review cycle 4 (lot1D_report) stop: Lot 1C review still requires the m3/m5 conductor decision; no semantic choice or gate relocation is delivered. Findings and the decision request are recorded in .h2a/build/lot1D_report.md; checkpoints 1B/1C remain unstarted and 1D is not entered.
- [x] Report naming: lot1X_report filenames count review cycles independently of implementation checkpoints 1A–1D; checkpoint completion is defined by the Plan / Todo gate rows. No checkpoint 1E is defined.
- [x] Lot 1D Opus review, 2026-10-05: GO, no BLOCKER or MAJOR; reviewed documentation-only range 806082dcc..82b2f0937. The conductor note confirms m3/m5 remains the only gate and another builder launch without a decision cannot advance implementation.
- [x] Lot 1D m1: review-cycle naming and decision-request wording clarified above; the stop row does not claim checkpoint 1D entry or a ratified decision.
- [x] Lot 1D m2: Lot 1C m1/m2 Feedback Loop rows now record completed routing; the single 1.07 implementation owner stays unchecked until source/tests land.
- [x] Review cycle 5 (lot1E_report) stop: record Lot 1D review reconciliation and the unresolved conductor decision in .h2a/build/lot1E_report.md; no new implementation checkpoint is entered.
- [x] Consolidated review trail: Lot 1E GO accepted pre-rebase 82b2f0937..7669041da (rebased d4405122a..afa20b1bf); cycle 6 (lot1F_report) was a no-op stop at 7669041da, accepted by Lot 1F GO with no findings. Cycle 7 (lot1G_report) recorded the same decision stop without a commit; the conductor decision above now releases 1B.
- [x] Lot 1G review: GO with fixes, no BLOCKER/MAJOR; m1 decision provenance is the user's verbatim CONDUCTOR DECISION message dated 2026-10-05, including the explicit undefined clause, quoted in lot1B_impl_report. Track remains conductor-owned; m2 validation and m3 sibling nesting corrected below; nit uses toStrictEqual for absent-field preservation.
- [x] Early lot1B_impl review read a draft before 1.04a was committed: NO-GO B1/M1 require completing and validating 1.04a–g and a fresh implementation review before 1C. MINOR m1 startup evidence is in 1.04a/report, m2 report path corrected, m3 recorded: 1.04a's associated review prerequisites were one 44-line commit; subsequent rows remain separate bounded commits. Pre-spy muse assertions pin the M1 recommendation.
- [x] Final lot1B_impl Opus review of f69702b37: GO with fixes, no BLOCKER/MAJOR; this resume authorizes checkpoint 1C after the minor fixes below.
- [x] Implementation m1 policy (conductor-revisable): stored judge-only defaults fail closed on catalog/settings reads, chat selection and even explicit ordinary-model inference. Global repair uses generic admin PUT /ai-settings/default_provider_id followed by catalog GET; endpoint regression owns this recovery sequence.
- [x] Implementation m1 operational limitation: out-of-band user-scoped judge-only defaults require operator repair. Runbook: identify the affected user's default_provider_id setting through existing restricted DB administration, replace only that scoped value with an ordinary provider (or remove that override to inherit a valid global default), then verify that user's catalog GET. Never substitute a provider during judge/chat execution; conductor may authorize a separate user-repair route refinement.
- [x] Implementation m2 deviation: temporary unlocked Rollup fetch/symlink and -o prepare-node-workspace bypass were used to diagnose the incomplete generated graph in 1B; the subsequent lockfile npm ci superseded them. This checkpoint restores through prepare-node-workspace only, never an ad-hoc package fetch or prerequisite bypass; unresolved graph defects go in the conductor report.
- [x] Resume environment evidence: generated-dependency EACCES was cleared by clean-node-modules; normal up-api-test then failed the image audit on critical proxy-addr GHSA-jqcg-44mw-7w3h. No dependency/allowlist bypass. Existing up-api-test-ci used the 1B lockfile-prepared local/sentropic-api:9a8b8a image with ignored, read-only current-source mounts; toolbox runtime checks and all eight judge-chat-settings endpoint tests passed. This is source-test evidence, not rebuilt-image/security qualification; the audit defect remains a conductor release/environment handoff.
- [x] Lot R0 rebase & compatibility (2026-10-12): Option A (« rebase puis finir ») executed from .h2a/proposals/judge_resume_proposal.md. Old HEAD 24966366e03de395337bc28585919b69199014e6 rebased cleanly onto origin/main dc95f7e4f88048e9671002827537cde4cb8149b7 (0 git conflicts). Semantic compatibility confirmed: preserved judge refusals (isJudgeOnlyProvider in runtime/catalog), preserved transports from #645 (Mistral Vibe/GLM 5.3), #655 (Claude seats) and #659 (export maps). Updated packages/llm-mesh/tests/judge-public-surface.test.ts to rebased 0.25.0 manifest version.
- [x] Lot R0 version collision analysis & proposal: origin/main published versions are llm-mesh 0.25.0, llm-gateway 0.19.5, cluster-mesh 0.13.3. The previously reserved tuple (0.24.0/0.21.0/0.15.0) collides because llm-mesh 0.24.0 is already used. Pending PR #662 advances gateway/mesh to minor (0.26.0/0.20.0) and PR #664 advances cluster-mesh to 0.14.0. Proposed next free minors strictly above published/pending for conductor determination: llm-mesh 0.27.0, llm-gateway 0.21.0, cluster-mesh 0.15.0. No publication versions chosen in branch.
- [x] Lot R0 review resolution (2026-10-12): MAJ-2 resolved by working on a structuredClone receipt copy in interruptedResult so timeout during settlement does not mutate the shared receipt; added assertion in tests/judge-dispatch.test.ts for persisted receipt at settle. Minor m1 resolved by preflight check in service.ts refusing when adapter and service descriptors diverge on wireModel/qualification; minor m2 documented attempts=0 vs dispatch=unknown on ambiguous marker; minor m3 extended api/tests/unit/judge-runtime-selection.test.ts mocks to resolveConnectedMistralVibeTransport and createMistralVibeAccountAuthInput.
- [x] Lot 2.09 review resolution - part 1 (2026-10-12): resolved MINEUR-1 so persisted receipt and settlement ledger agree on verdict outcome when deadline occurs during settlement without overwriting durable receipt to error; mapped transport/adapter CANCELLED to TIMEOUT when deadline exceeded; removed unused closeJudgeReceipt import in deadline.ts; pinned exact settled verdict assertions and new CANCELLED/TIMEOUT regressions in tests/judge-dispatch.test.ts.
