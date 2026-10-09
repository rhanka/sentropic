# Feature: Claude 5.5 Routes Remap To Muse-Codex-Cloud

## Objective
- Route the `claude-opus-5-5` and `claude-sonnet-5-5` families (base/high/xhigh/max/medium/low) through standard multi-candidate launch aliases (muse contributor, codex, cloud) so any single enrolled account serves any requested id; remove the exclusive Astra alias and its fail-closed `no-route`.
- Codex slot policy: `gpt-6-astra` only for `claude-opus-5-5-max` and the `claude-fable-5-1` family, otherwise `gpt-6.1-sol` at +1 effort rung; serving choices grounded on Artificial Analysis Intelligence Index v4.3.2.

## Scope / Guardrails
- Base: `origin/main` at `4515cc4c2` (rebased 2026-10-08 from `52c1fdc63`); branch `feat/llm-mesh-claude55-remap`; worktree `tmp/llm-mesh-claude55-remap`.
- Make-only and Docker-first. Never use the root checkout or `ENV=dev` for development/testing.
- Dedicated test mapping: `ENV=test-llm-claude55-remap`, `API_PORT=9487`, `UI_PORT=5687`, `MAILDEV_UI_PORT=1587`, with `ENV` last on each Make invocation.
- No real provider tokens, publication, push or merge in this branch without the owner.
- Index reference: AA Intelligence Index v4.3.2 (opus-5.5-max 58, sonnet-5.5-max 56, astra-max 53, fable-5.1-max 53, sol-6.1 52, opus-5-max 51, muse-1.3-max 48, flash-3.8-high 41); scores traced in the routing spec.
- All new code, comments, docs and commits in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/llm-mesh/src/**`
  - `packages/llm-mesh/tests/**`
  - `packages/llm-mesh/CHANGELOG.md`
  - `packages/llm-mesh/package.json` (semver bump after registry pre-check, before PR)
  - `packages/llm-gateway/package.json` (llm-mesh dependency range bump only)
  - `spec/SPEC_EVOL_LLM_MESH_GATEWAY_ROUTING.md` (route contract only)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
  - `packages/llm-gateway/src/**` (mesh package owns route targets; gateway only consumes)
  - `packages/llm-mesh/src/adapter-auth.ts` (owned by another lane)
  - `.github/**`, `PLAN.md`
- **Conditional Paths (require an approved BR55-EXn before any change)**:
  - `package-lock.json` (BR55-EX3) only for the `packages/llm-mesh` version entry refreshed through `make lock-root`.
  - `packages/cluster-mesh/tests/integrations/gateway-surface.spec.ts` (BR55-EX2) only for mesh installedVersion pins.
  - `packages/cluster-mesh/tests/integrations/llm-surface.spec.ts` (BR55-EX2) only for mesh installedVersion pins.
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json` (BR55-EX2) only for the frozen selected lock regenerated via `refresh-lazy-package-lock` with packed sibling receipts.
  - `packages/llm-gateway/tests/target.test.ts` (BR55-EX1) only for test expectations mirroring the mesh matrix (no src).
  - `scripts/llm-model-equivalences/council.source.json` and its generated output (no exception granted) — untouched.
- **Exception process**:
  - Record ID, evidence, reason, impact, rollback and decision in `## Feedback Loop` before touching any conditional path.

## Feedback Loop
- [x] BR55-Q6: GLM 5.3 supplemental fallback extended to the Claude 5.5 families (opus and sonnet, all six rungs) and the Fable 5.1 low/medium rungs, mirroring the requested effort at +1 rung on the native low/high/max ladder (base/low/medium -> high, high/xhigh/max -> max); fable-5-1 base moves from `max` to `high`. Opus 5 / Opus 4.8 keep effort `max`. Sonnet 5 and Fable 5 stay out of the map. Status: owner decision 2026-10-08.
- [x] BR55-Q1: Origin of the Astra exclusivity: BRANCH.md-only attestation ("owner decision relayed by sentropic-46"), no independent trace (`.h2a/negotiations` empty, no other mention). Owner states "astra systematique" meant codex-slot-only, never astra instead of muse. Status: resolved by owner 2026-10-07; exclusivity removed.
- [x] BR55-Q2: Codex policy: astra for opus-5.5-max plus fable-5.1 family, else gpt-6.1-sol at +1 rung (base→high, high→xhigh, xhigh→max, max→max by clamp, medium→high, low→medium). Status: decided by owner 2026-10-07.
- [x] BR55-Q3: Muse tier contributor (BR75-Q3 default); muse effort follows the same +1 rule. Status: approved via mapping table 2026-10-07.
- [x] BR55-Q4: Medium/low variants added on opus-5.5, sonnet-5.5, opus-5, opus-4-8, sonnet-5, fable-5, fable-5-1; sonnet-4-6 keeps base only (succession alias). Status: approved 2026-10-07.
- [x] BR55-Q5: Any single enrolled account must serve any requested id; `no-route` survives only when zero candidate transports hold an account. Status: owner exigence 2026-10-07.
- [ ] BR55-R1: Index gaps (opus-4-8, fable-5, luna, terra scores unknown; sol-6.1 effort basis presumed max; per-effort curves unknown) and partial coverage (muse-max 48 and astra-max 53 below opus-5.5-max 58; sol-6.1 52 below sonnet-5.5-max 56) — review checkpoint, not blocking.
- [x] BR55-R2: Review gemini-3.8-flash-high (AGY run-once, plan mode, 2026-10-08): NO BLOCKING FINDINGS. One minor noted (`canonicalTargetMappingsFor` drops bare-model lookups for non-default musePosition) is pre-existing code untouched by this branch — no action here.
- [ ] BR55-R3: CI `audit-gate` fails on PR #644 (typecheck-lint-api, build-api-image, build-api-tool-image, security-sast-sca) with unallowlisted HIGH/CRITICAL advisories (`@modelcontextprotocol/sdk` GHSA-6qxp-vccf-f47h, `proxy-addr` GHSA-jqcg-44mw-7w3h) published after main's last green run (2026-10-07T11:19Z). Branch diff touches no dependency — pre-existing, out of scope. Merge blocked until owner routes it (separate security lane or allowlist exception).
- [x] BR55-R5: Rebased onto `origin/main` at `36332ebaa` (2026-10-09): base now carries the Mistral runtime client, mesh 0.24.0, gateway 0.19.4 and cluster-mesh 0.13.2. Retarget redone for mesh 0.24.1 (package.json, cluster-mesh pins, root lock via `make lock-root`, CHANGELOG section); the selected train lock is regenerated from the final tree before push. Mesh suite green post-rebase (34 files, 372 tests).
- [x] BR55-R4: Rebased onto `origin/main` at `4515cc4c2` (2026-10-08): base now carries Mistral Vibe transport, GLM 5.3 fallback, mesh 0.23.1 and gateway 0.19.3. Conflicts resolved (GLM block kept, gateway matrix keeps Glm entries on mapped aliases, package.json takes 0.23.1); obsolete 0.22.4 pins commits skipped and redone for 0.23.2. Mesh suite green post-rebase (33 files, 360 tests) with GLM entries where mapped.
- [x] BR55-EX1: Paths `packages/llm-gateway/tests/target.test.ts` only (test expectations, no src). Evidence: gateway target-map is a direct re-export of mesh routing-targets, so the mesh remap changes gateway-resolved candidates. Reason: gateway CI runs target.test.ts against the workspace mesh. Impact: test literals only. Rollback: revert with the mesh remap. Decision: conductor, mechanical consequence of Lot 1.
- [x] BR55-EX2: Paths `packages/cluster-mesh/tests/integrations/{gateway-surface,llm-surface}.spec.ts` (mesh installedVersion pins) and `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json` (frozen selected lock, regenerated via `refresh-lazy-package-lock` with packed sibling receipts). Evidence: release-train gates pin the mesh sibling version. Reason: mesh version bump. Impact: version literals and fixture lock only. Rollback: revert with the version bump. Decision: conductor, mechanical consequence of the mesh release.
- [x] BR55-EX3: Path `package-lock.json`, `packages/llm-mesh` version entry only, refreshed through `make lock-root`. Evidence: train lock-sync gate requires the root lockfile to match the package bump. Reason: mesh 0.22.4 bump. Impact: version field only. Rollback: revert with the version bump. Decision: conductor, mechanical consequence of the mesh release.

## AI Flaky tests
- [ ] Only provider/network nondeterminism with a passing rerun on the same commit may be proposed for explicit owner sign-off; no timeout increases.

## Orchestration Mode (AI-selected)
- [ ] Mono-branch + cherry-pick
- [x] Multi-branch
- [x] Rationale: mesh route targets and gateway release-train pins live in separate review scopes with independent gates; implementation stays in this branch, release pins follow as declared exceptions.

## UAT Management (in orchestration context)
- [ ] Muse-only enrollment serves every requested id (no 503 no-route).
- [ ] Codex-only enrollment serves every requested id.
- [ ] Cloud-only enrollment serves every requested id.
- [ ] opus-5.5-max served by astra; fable-5.1 family served by astra; all other codex slots served by sol-6.1.
- [ ] Served provider/model visible in diagnostics; no `safeguard_results` synthesized.
- [ ] No web/Chrome/VSCode UI edits or UI-specific UAT for this package-only branch.

## Build Steps (M0-M6)
- [x] M0 — Branch plan commit
- [x] M1 — Standard routes for opus-5.5 and sonnet-5.5 families in routing-targets
- [x] M2 — Codex slot remap (sol-6.1 at +1) across families
- [x] M3 — Medium/low variants plus muse coverage on every row
- [x] M4 — Remove exclusive alias and exclusive-only guards (selection, planner, quote)
- [x] M5 — Council metadata, spec contract, CHANGELOG, version bump
- [x] M6 — Gateway dep bump and release-train pins

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and isolation**
  - [x] Create isolated worktree from `origin/main` and verify active branch.
  - [x] Reserve unique environment and three ports (verified free with `ss -ltn`).
  - [x] Record base SHA and port allocation in BRANCH.md.
- [ ] **Lot 1 — Route target remap**
  - [x] Move the opus-5.5 family to STANDARD_ROUTE_DEFINITIONS (base/high/xhigh/max/medium/low).
  - [x] Add the sonnet-5.5 family (base/high/xhigh/max/medium/low).
  - [x] Remap codex slots to sol-6.1 at +1 except opus-5.5-max and fable-5.1 (astra).
  - [x] Add medium/low variants on opus-5, opus-4-8, sonnet-5, fable-5, fable-5-1.
  - [x] Extend MUSE_ROUTE_EFFORT to every row (+1 rule; keep existing values).
  - [x] Remove EXCLUSIVE_LAUNCH_ALIAS_TARGET_MAPPINGS and exclusive-only branches.
  - [x] Tests in `packages/llm-mesh/tests/routing-targets.test.ts`: full matrix incl. medium/low, any-account coverage per transport.
  - [x] Tests in `packages/llm-mesh/tests/route-selection.test.ts`: standard guards without exclusivity.
  - [x] Tests in `packages/llm-mesh/tests/route-planner.test.ts`: no-route only when zero accounts; affinity without exclusive target.
  - [x] Tests in `packages/llm-mesh/tests/budget-quote.test.ts`: multi-candidate quotes for the 5.5 families.
  - [x] Tests in `packages/llm-mesh/tests/equivalence-council.test.ts`: alias metadata for new aliases.
  - [x] Tests in `packages/llm-mesh/tests/service/local-account-transport-service.test.ts`: standard alias effort semantics.
  - [x] Lot gate: `make test-llm-mesh API_PORT=9487 UI_PORT=5687 MAILDEV_UI_PORT=1587 ENV=test-llm-claude55-remap` (32 files, 352 tests passed).
  - [x] Lot gate: `make typecheck-llm-mesh API_PORT=9487 UI_PORT=5687 MAILDEV_UI_PORT=1587 ENV=test-llm-claude55-remap` (pass).
  - [x] Lot gate: `make build-llm-mesh API_PORT=9487 UI_PORT=5687 MAILDEV_UI_PORT=1587 ENV=test-llm-claude55-remap` (pass).
  - [x] Lot gate: `make scope-check API_PORT=9487 UI_PORT=5687 MAILDEV_UI_PORT=1587 ENV=test-llm-claude55-remap` (PASS C2).
- [ ] **Lot 2 — Docs, version and release train**
  - [x] Update `spec/SPEC_EVOL_LLM_MESH_GATEWAY_ROUTING.md` (route contract plus index scores v4.3.2).
  - [x] Update `packages/llm-mesh/CHANGELOG.md` (0.22.4 entry; no Unreleased section in this file).
  - [x] Registry pre-check (local 0.23.1, registry 0.23.1) then bump `packages/llm-mesh/package.json` to 0.23.2 (patch keeps the `^0.23.0` gateway range; no gateway dep bump needed).
  - [x] Cluster-mesh pins to 0.23.2 via BR55-EX2 (integrations pins plus regenerated selected fixture lock); root lock entry via BR55-EX3 (`make lock-root`); gateway target matrix via BR55-EX1 (tests only).
  - [x] Lot gate: cluster-mesh packaging (29 passed) plus integrations (31 passed) with the Lot 1 mapping.
- [ ] **Lot 3 — Final validation**
  - [x] `make test-llm-mesh API_PORT=9487 UI_PORT=5687 MAILDEV_UI_PORT=1587 ENV=test-llm-claude55-remap` (32 files, 352 tests passed).
  - [x] `make test-llm-gateway API_PORT=9487 UI_PORT=5687 MAILDEV_UI_PORT=1587 ENV=test-llm-claude55-remap` (28 files, 390 tests passed).
  - [x] `make typecheck-llm-mesh API_PORT=9487 UI_PORT=5687 MAILDEV_UI_PORT=1587 ENV=test-llm-claude55-remap` (pass).
  - [x] `make build-llm-mesh API_PORT=9487 UI_PORT=5687 MAILDEV_UI_PORT=1587 ENV=test-llm-claude55-remap` (pass).
  - [x] `make scope-check API_PORT=9487 UI_PORT=5687 MAILDEV_UI_PORT=1587 ENV=test-llm-claude55-remap` (PASS C2).
  - [x] `make down API_PORT=9487 UI_PORT=5687 MAILDEV_UI_PORT=1587 ENV=test-llm-claude55-remap`; local checks reported separately from CI (CI not run yet).
  - [ ] Final gate step 1: create/update PR using `BRANCH.md` text as PR body.
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Final gate step 3: once UAT + CI are both `OK`, commit removal of `BRANCH.md`, push, and merge.
