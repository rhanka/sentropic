# Feature: Security hotfix body-parser 2.4.0 and dated zod exception

## Objective
Fix red main audit-gate (2 un-allowlisted HIGH findings) with a minimal public hotfix.

## Scope / Guardrails
- Scope limited to body-parser 2.4.0 lockfile bump, one dated zod exception, L5 derived-pin recompute.
- Public repo only, no private storage. Ready-for-review PR, no merge by this session.
- Make-only workflow, no direct Docker commands.
- Branch development in isolated worktree `tmp/worktrees/sec-hotfix-0124`.
- Automated test campaigns on `ENV=test-sec-hotfix`, never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Zero Python in automation.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `package-lock.json`
  - `api/package-lock.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`
  - `.security/vulnerability-register.yaml`
  - `.security/audit-allowlist.json`
  - `tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json`
  - `tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json.sha256`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
  - `ui/Dockerfile`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
  - `packages/cluster-mesh/tests/storage/postgres.mk` (BR734-EX1 only, comments audit lines only)
  - `api/Dockerfile` (BR734-EX2 only, bundled undici 6.28.1 to 6.29.1 pin for CVE-2026-109869)
  - `api/tests/api/chat-tools.test.ts` (BR734-EX3 only, evaluator-absorbing mock, no assertion change)
  - `api/src/config/env.ts` (BR734-EX4 only)
  - `api/src/services/context-document.ts` (BR734-EX4 only)
  - `docker-compose.test.yml` (BR734-EX4 only)
  - `docker-compose*.yml` (BR734-EX4 permits only the DOCUMENT_MODEL test setting in docker-compose.test.yml)
  - `e2e/global.setup.ts` (BR734-EX4 only)
  - `api/tests/ai/initiative-generation-async.test.ts` (BR734-EX5 only)
  - `e2e/tests/09-chat-org-update-tool.spec.ts` (BR734-EX6 only)
  - `packages/llm-mesh/src/catalog.ts` (BR734-EX7 only)
  - `packages/llm-mesh/package.json` (BR734-EX7 only)
  - `packages/llm-mesh/tests/facade.test.ts` (BR734-EX7 only)
  - `api/src/services/llm-runtime/index.ts` (BR734-EX7 only)
  - `api/tests/unit/llm-runtime-stream.test.ts` (BR734-EX7 only)
  - `packages/cluster-mesh/tests/integrations/llm-surface.spec.ts` (BR734-EX8 only)
  - `packages/cluster-mesh/tests/integrations/gateway-surface.spec.ts` (BR734-EX8 only)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json` (BR734-EX9 only)
  - `e2e/tests/03-chat.spec.ts` (BR734-EX11 only, vision test model selection)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.

## Feedback Loop
- `BR734-EX11` / `attention`: owner-authorized P2-3 correction removes focused image analysis from production. Select the catalogued vision model mistral-medium-3.5 only in the live image E2E scenario; retain the red-square assertion and existing deadlines. Impact: one test model selection only. Rollback: restore that selection.
- `BR734-R1` / `attention`: owner requests all four Opus P2 corrections: remove duplicate register keys, reject failed or malformed audits in both comments gates, remove production image grounding and keep live-model selection in tests, restore the 120s API workflow budget and fix its cause. Existing exceptions cover the reviewed files; BR734-EX10 and the timeout increase in BR734-EX5 are revoked. Impact: review corrections only; assertions and security exceptions remain intact. Rollback: revert the corresponding review-fix commit.
- `BR734-EX10` / `resolved`: revoked by the owner in P2-3. Remove the production image-grounding call; the stream regression now requires one direct dispatch, unchanged image parts/instructions/tools, and no analysis call. Vision model selection is test-only under BR734-EX11.
- `BR734-EX9` / `attention`: run 40131831560 passes cluster-mesh tests then the packed release gate rejects the selected lock's 0.27.0 pin against the verified 0.27.1 sibling. Rebuild with TypeScript 5.4.5 and npm pack reproduces the CI archive exactly: sha256 d06766370b135f3438be535aa6e5ebf69adf50df5379d79f1bd41f1a0866f374. Align the fixture manifest, registry URL and integrity with those measured bytes; keep the integrity gate unchanged. Impact: the selected qualification tuple only. Rollback: restore the 0.27.0 tuple together with the package version.
- `BR734-EX8` / `attention`: run 40131082355 proves the two workspace integration tests still require installedVersion 0.27.0 after the required llm-mesh bump to 0.27.1. Update only these exact version literals; retain exact state/version assertions, namespace identity checks and published-fixture pins. Impact: two test expectations only. Rollback: restore the literals together with the llm-mesh version.
- `BR734-EX7` / `attention`: run 40129371697 proves vision fails before dispatch because the catalog marks mistral-small-2603 text-only; the Mistral wire converter also stringifies image parts. Live GET /v1/models/mistral-small-2603 returns HTTP 200 with vision=true. Enable that exact capability and preserve image_url blocks through conversion; update the capability expectation and add a serializer regression. npm view reports 0.27.0, so bump llm-mesh to 0.27.1 and align the root lock. Impact: Mistral image requests only; other providers retain their conversion. Rollback: revert this capability and converter change with the package bump.
- `BR734-EX6` / `attention`: run 40129371697 passes all eight document scenarios, then the organization-update turn completes with toolCalls=0 and unchanged persisted technologies. Make the live-model instruction identify the seeded organization and require organization_update before answering; retain every persisted-field assertion and every E2E timeout. Log the assistant response for future failure diagnosis. Impact: one E2E prompt and diagnostics only. Rollback: restore the original prompt.
- `BR734-EX4` / `attention`: owner-authorized CI repair. Run 40112282506 proves E2E A/C still select retired gpt-4.1-nano and B/D document summaries force an unfunded OpenAI model. Configure the live Mistral default through the authenticated E2E setup and expose DOCUMENT_MODEL with the existing production default; pin it to mistral-small-2603 in the test compose overlay. Impact: test configuration and one document model configuration option, no assertion or E2E timeout changes. Rollback: revert these configuration changes.
- `BR734-EX5` / `resolved`: restore the owner-required 120s outer cap. Run 40112282506 spent 53s enriching a random nonexistent company through nine sequential web searches; run 40134826999 spent 16s in that phase and completed the same workflow in 94.9s. Use the real company Schneider Electric in the live fixture so enrichment has a resolvable subject. All workflow phases, initiative counts and assertions remain unchanged. Impact: test fixture and restored timeout only. Rollback: restore the fixture name; do not raise the timeout.
- `owner-all-public` / `acknowledge`: binding owner decisions. Public repos only, goal zero open findings at all times. For zod: dated exception plus migration.
- `conductor-merge-733` / `acknowledge`: merged `origin/fix/ci-mistral-small` (merge commit, no rebase) into this branch; kept this BRANCH.md on conflict. #733 is superseded by this PR.
- `BR734-EX1` / `attention`: reason — the validate-cluster-mesh comments-deps-audit step runs a plain `npm audit` with no exception input, so the dated zod exception could not cover its GHSA-mrhx-c7xc-m3w5 finding; the recipe now evaluates the JSON audit against the existing `.security/audit-allowlist.json` (same GHSA-only, same expiry fail-closed semantics as `audit-gate.mjs`). Impact — one audit line in `cluster-mesh-comments-deps-audit` only; oracle/vectors variants share the line and inherit the same gate. Rollback — revert that line to plain `npm audit --audit-level=high`.
- `BR734-EX2` / `attention`: reason — base image bundled npm undici 6.28.1 is flagged (CVE-2026-109869, fixed in 6.29.1 per OSV, empty vuln set for 6.29.1); bump the existing per-CVE patch pin 6.28.1 to 6.29.1 in `api/Dockerfile`. Impact — one pin plus comment; integrity from registry. Rollback — revert the two lines.
- `BR734-EX3` / `attention`: reason — chat-tools comment_assistant tests fail under mistral-small-2603 because the best-effort reasoning-effort classifier consumes the test's scripted Once mock (main turn then runs on the empty default, zero tool calls; proven by `toolCalls: 0` in CI logs); add an evaluator-absorbing empty stream in `beforeEach`, conditional on `modelSupportsReasoning`, no assertion changed. Impact — test setup only. Rollback — delete the absorber block.
- `zod-rooted-only` / `acknowledge`: extended the same dated exception (2026-11-07, Track 01M5PMR6AG9QDZG9H3N57TB3FS) to exact finding IDs, all verified zod-rooted in the lock/tree: `npm_audit_api_zod_high`, `npm_audit_api_@ai-sdk_provider-utils_high` (HIGH via zod peer dep; own GHSA-866g is low), `npm_audit_api_ollama-ai-provider_high` (no own advisory), `npm_audit_ui_zod_high`, `CVE-2023-54404_api_zod_3.23.8`, `CVE-2023-54404_api_zod_3.25.76` (CVE confirmed as zod record). No non-zod finding covered. The comments-tree `GHSA-mrhx-c7xc-m3w5` (published `@sentropic/comments@0.3.0` pins zod ^3.25.76, no fixed release exists) is covered in-repo by BR734-EX1 (both plain-`npm audit` steps evaluate the JSON audit against the allowlist); full removal still needs the zod v4 migration release.
- `root-cause` / `attention`: main audit-gate red since 2026-10-24 ~07:58Z (run 40076120099). body-parser 2.3.0 in range [2.0.0, 2.4.0) fixed by 2.4.0 patch. zod 3.25.76 (< 4.6.6) has no same-major fix, only major v4, so dated exception plus migration.

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
- Rationale: single minimal hotfix, one PR.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- No UI changes in this branch, no UAT required.
- Execution flow (mandatory):
  - Develop and run tests in `tmp/worktrees/sec-hotfix-0124`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`~/src/sentropic`, `ENV=dev`).
  - Switch back to `tmp/worktrees/sec-hotfix-0124` after UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read `rules/MASTER.md` and `rules/workflow.md`.
  - [x] Create isolated worktree `tmp/worktrees/sec-hotfix-0124` from `origin/main` on branch `fix/security-bodyparser-zod-0124`.
  - [x] Reproduce audit-gate offenders via `make test-api-security-sca ENV=test-sec-hotfix` and capture GHSA ids.
  - [x] Define environment mapping (`ENV=test-sec-hotfix`) for this branch.
  - [x] Confirm command style: `make ... ENV=test-sec-hotfix` with `ENV` last.
  - [x] Confirm scope and guardrails.
  - [x] Validate scope boundaries (`Allowed/Forbidden/Conditional`) and declare exceptions if needed.
- [x] **Lot 1 — body-parser 2.4.0 lockfile bump**
  - [x] Fetch body-parser 2.4.0 registry metadata and verify integrity hash.
  - [x] Bump `node_modules/body-parser` entry in `package-lock.json`, `api/package-lock.json`, fixture lock.
  - [x] Prove no manifest range change needed (express `^2.2.1` admits 2.4.0).
  - [x] Lot gate:
    - [x] `make scope-check ENV=test-sec-hotfix`
    - [x] `make commit MSG="..." ENV=test-sec-hotfix` with selective `git add`
- [x] **Lot 2 — Dated zod exception plus L5 recompute**
  - [x] Add ONE `accepted_temporary` zod entry to `.security/vulnerability-register.yaml` (review_due 2026-11-07, Track ref, owner quote).
  - [x] Add matching zod GHSA entry to `.security/audit-allowlist.json` (review_due 2026-11-07).
  - [x] Prove no L5 P1 re-pin needed: `make memory-l5-verify` passes unchanged (fingerprint outside P1 closure).
  - [x] Leave P1 provenance to the post-merge regen flow (precedent 84667d57a), not this PR.
  - [x] Lot gate:
    - [x] `make scope-check ENV=test-sec-hotfix`
    - [x] `make memory-l5-verify ARTIFACT_MANIFEST=tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json ENV=test-sec-hotfix`
    - [x] `make commit MSG="..." ENV=test-sec-hotfix` with selective `git add`
- [ ] **Lot N — Final validation**
  - [x] P2-1: remove the eleven duplicate YAML fields from the nested toolbox zod entry.
  - [ ] P2-2: reject audit command errors and incomplete/error JSON in both comments gates.
  - [ ] P2-3: remove production image grounding and verify image streaming preserves the original request.
  - [ ] P2-4: restore the 120s live API budget and resolve the underlying delay.
  - [x] Reproduce the Small 4 full-prompt vision failure with red/blue images and verify focused live image analysis plus the unchanged main chat instructions/tools.
  - [x] Align the selected qualification lock with the byte-identical llm-mesh 0.27.1 archive; the unchanged sibling-integrity checker passes locally.
  - [x] Align the two cluster-mesh workspace version expectations with llm-mesh 0.27.1; all 16 scoped integration tests pass.
  - [x] Configure live Mistral defaults and document summaries; run 40129371697 passes API AI integration, E2E A/B and all eight document scenarios.
  - [x] Correct Mistral image capability and conversion; 17 facade and 152 stream-normalization tests pass, API typecheck and lint pass.
  - [ ] Repair live Mistral CI defaults and document summarization, then verify all checks on the pushed head.
  - [x] Run audit gate locally via image builds (`make build-api-image-fresh`, `make build-ui-image`): both green, `npm ci` consistent.
  - [x] SCA api/ui compliance green; container api compliance green (only the 2 zod findings, both accepted).
  - [ ] Final gate step 1: PR body is `BRANCH.md` text (PR already open, update body on push).
  - [ ] Final gate step 2: run and verify branch CI green on the exact head.
  - [ ] Final gate step 3: do NOT merge, report PR number, head SHA, CI URL.
