# Feature: G2 — MCP sharing tools in @sentropic/artifacts

## Objective
Implement sharing lot G2 of the binding convergence `.tmp/concertation-share/converged-r2.md` (sha256 1d5723e4…) — row G2 of §4 with its acceptance column, plus §2.3/§2.4/§2.5 as referenced — with owner answers (`.tmp/concertation-share/owner-answers.md`): collaboration is an additional right granted case by case to one named colleague only; sharing is visible; a share covers all retained versions. G1 (#901, 0.2.10) is the base: byte-stable tool definitions (#896, 0.2.9) are built on, never redone. Existing MCP tool definitions stay byte-identical before and after this lot.

## Scope / Guardrails
- Scope limited to `packages/artifacts/**` plus the pin/lock/manifest refresh files listed under Allowed Paths.
- No new migration (G1's `0006_sharing.sql` is reused unchanged).
- Make-only workflow, no direct Docker commands; Docker under `flock /home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md` taken PER COMMAND (never nested).
- Tests on `ENV=test-share-g2` (always LAST argument), never `ENV=dev`; every test lane ends with `make down-volumes ENV=test-share-g2`.
- No `[skip ci]` in any commit; CI budget: one run on the final head; never `gh run rerun`.
- All new text in English. No human-effort or time estimates.
- Crash safety: push `feat/share-g2-mcp-tools` to origin after every few commits.
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.
- Version allocation: main is 0.2.12 (#907 merged after #901), 0.2.11 is reserved for #891; this lot takes the next free version **0.2.13**, inside cluster-mesh's `>=0.2.0 <0.3.0` peer range. Rebased onto origin/main 3dd7d8012 (#907); version-line conflicts resolved in favour of 0.2.13, CHANGELOG unioned (0.2.13 on top of 0.2.12).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/artifacts/src/server/publication.ts`
  - `packages/artifacts/src/mcp-core.ts` (ARTIFACTS_PROVIDER_VERSION only)
  - `packages/artifacts/tests/**`
  - `packages/artifacts/package.json` (version bump only)
  - `packages/artifacts/CHANGELOG.md` (release entry)
  - `package-lock.json` (BR02-EX2, artifacts version line only)
  - `api/package-lock.json` (BR02-EX2, one-line `file:` sync)
  - `api/src/services/mcp/cluster-registry.ts` (BR02-EX6, APP-P1 pin)
  - `api/tests/api/app-mcp-registry.test.ts` (BR02-EX6, pin vectors)
  - `api/tests/api/app-mcp-installed.test.ts` (BR02-EX6, pin vectors)
  - `api/tests/api/artifacts-host-publication.test.ts` (BR02-EX6, profileDigest pin)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json` (BR02-EX3)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json` (BR02-EX3)
  - `packages/cluster-mesh/tests/packaging/artifacts-tuple.spec.ts` (BR02-EX3)
  - `tools/memory-mcp-l5/artifacts/**` (BR02-EX5, P1 manifest regen)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/artifacts/src/**` except `server/publication.ts` and `mcp-core.ts` (tool definitions byte-identical; snapshot JSON untouched)
  - `api/src/**` except `api/src/services/mcp/cluster-registry.ts`
  - every other packages/cluster-mesh path stays out of scope (classified unknown); only the three BR01-EX3 files are conditional below
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
  - `.cursor/rules/**`, `rules/**`
  - `api/**`, `ui/**`, `e2e/**`, `apps/**`, `deploy/**` except the BR02-EX6 files above
  - `packages/**` other than `packages/artifacts/**` and the BR02-EX3 files above
  - `src/**` (root app sources)
- **Conditional Paths**: none beyond Allowed Paths above (all exception-bearing paths are declared in Allowed Paths, which takes precedence over Forbidden).
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- BR02-EX2 (lock pins): the 0.2.13 release bumps the workspace package version, so the root `package-lock.json` `packages/artifacts` entry is refreshed through `make lock-root` (only the artifacts version line is kept) and the single `"../packages/artifacts"` version line in `api/package-lock.json` is synced (same targeted one-line sync as #901 BR01-EX2). No dependency graph change; rollback with the version fix.
- BR02-EX3 (cluster-mesh packaging fixture re-pin): `tests/packaging/prepare-artifacts.spec.ts` requires the `selected` fixture to pin the workspace candidate version exactly (artifacts 0.2.13). Re-pin `fixtures/selected/package.json` + `package-lock.json` through `make -f packages/cluster-mesh/packaging.mk refresh-lazy-package-lock` and the hardcoded archive integrity in `artifacts-tuple.spec.ts` to the candidate tarball's sha512. Rollback: revert the three files to the 0.2.10 pin.
- BR02-EX5 (scope exception, `tools/memory-mcp-l5/artifacts/**`): every rebase/lock change touching the root lock requires regenerating the memory-l5 P1 manifest through `make memory-l5-pack STAGE=pre-candidate ARTIFACT_MANIFEST=tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json` (never hand-editing digests); previous manifest+sidecar retained in `artifacts/history/`. Rollback: restore the retained history manifest/sidecar and delete the new snapshot.
- BR02-EX6 (APP-P1 pin): the provider version 0.2.13 changes the APP-P1 manifest digest, and the new operation profiles in the shipped radar profile change `APP_P1_PROFILE_DIGEST`; both constants in `api/src/services/mcp/cluster-registry.ts` and the app-mcp test fixtures are re-pinned to the digests computed through make. The four-tool host selection and every pre-existing tool definition stay byte-identical. Never weaken the pin guard. Rollback: restore the 0.2.10 digests.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.
- G2 touches no AI-generation path; no AI flaky tests expected.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: single lot G2 in one package; one branch, one worktree `tmp/worktrees/share-g2`, one test env `test-share-g2`.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- G2 is package-internal (no UI surface); UAT = package test suites + CI. No browser UAT for this lot.
- Execution flow (mandatory):
  - Develop and run tests in `tmp/worktrees/share-g2`.
  - Push branch before CI.
  - No root-workspace UAT needed for G2 (no app surface changed).

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `.tmp/packets/COMMON-RULES.md`, `.tmp/concertation-share/converged-r2.md` (§2.3–§2.5, §4 G2 row), `.tmp/concertation-share/owner-answers.md`.
  - [x] Create isolated worktree `tmp/worktrees/share-g2` on branch `feat/share-g2-mcp-tools` from `origin/main` (HEAD 3c0897b06, #901 merged); `cp /home/antoinefa/src/sentropic/.env .env`.
  - [x] Version check: main 0.2.10; open PRs — #891 reserves 0.2.11, #907 takes 0.2.12 ⇒ G2 takes **0.2.13**.
  - [x] Make targets captured: `make test-artifacts SCOPE=… ENV=test-share-g2`, `make test-artifacts-integration SCOPE=… ENV=test-share-g2`, `make typecheck-artifacts`, `make lint-artifacts`, `make build-artifacts`, `make down-volumes ENV=test-share-g2`, `make scope-check`, `make commit MSG="…"`, `make lock-root`.
  - [x] Command style confirmed: `flock /home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md make … ENV=test-share-g2` with `ENV` last, one lock per make command, never nested.
  - [x] Scope boundaries declared above (BR02-EX2/EX3/EX5/EX6).
- [x] **Lot 1 — Tests first (G2 acceptance column of §4 row G2)**
  - [x] `packages/artifacts/tests/share-g2-tools.test.ts` + `share-g2-errors.test.ts` (new, split with the `fixtures/share-g2-world.ts` helper): hash of pre-existing definitions unchanged across a `profileRevisionId` bump; end-to-end « share with Farid » (lookup_people → `userRef` → set_access → reader reads → revoke → next read refused); exhaustive payload capture (`get`, `list`, `set_access` receipt, `list_access`, `lookup_people`) with no internal principal and no full email; lookup by a `pending` caller refused without enumeration; homonyms returned with distinct `emailHint`, no silent choice; « tout le monde » (sentinel) opens to an approved account and refuses a `pending` one; non-reader + forged `userRef` ⇒ `not_found` (no resolution leak); owner + non-shareable target ⇒ single `person_not_shareable` 422 in all four causes (unknown, inactive, unapproved, out of scope); replay of the same key across a `policyRevision` change without a parasitic 409; admin lists/revokes someone else's `restricted` artifact without becoming a reader; reader sees only the mode and its own entry in `list_access`; without a `PrincipalDirectoryPort` the new tools answer `capability_unavailable`.
  - [x] `packages/artifacts/tests/tools-list-snapshot.test.ts` (evolve): r2-strict profile also selects `artifacts_lookup_people` / `artifacts_list_access` with operation profiles; regenerate `tests/snapshots/tools-list-catalogue.json` through the test (delete + re-run + re-run) so the CI snapshot covers the new tools while every pre-existing definition keeps its exact bytes.
  - [x] `packages/artifacts/tests/fixtures/transport-world.ts` (evolve): memory `PrincipalDirectoryPort` double (search / resolve / describe, userRef ≠ internal principal, masked-hint source emails), `directory` option, `createdAt` on grant records.
  - [x] Scoped runs while evolving: `flock … make test-artifacts SCOPE=tests/share-g2-tools.test.ts ENV=test-share-g2` (6/6), `SCOPE=tests/share-g2-errors.test.ts` (6/6), then full `make test-artifacts ENV=test-share-g2` (51 files, 545/545); `flock … make down-volumes ENV=test-share-g2` after each stack.
- [x] **Lot 2 — Implementation (G2)**
  - [x] `src/server/ports.ts`: `PrincipalDirectoryPort` (search, `userRef`→internal resolution, inverse projection) + `DirectoryPerson` + email-hint masking helper.
  - [x] `src/server/access.ts`: `GrantRecord.createdAt?`.
  - [x] `src/server/management.ts`: `set_access` resolves `userRef` at §2.3 step 4 (after visibility and management right), merged `person_not_shareable` on resolution/approval failure, trusted internal-principal fallback, receipt grants projected to `userRef`, `policyRevision` stays a barrier (never hashed). The 422 is delivered through the operational refusal channel (`shareableRefused()`, same pattern as `policyRefused()`), not as a new `ArtifactErrorKind`: `failures.ts` is untouched because the coordinator classifies non-operational failures as 500.
  - [x] `src/http.ts`: `directory` dep; `/lookup_people` (approved-caller guard) and `/list_access` (management visibility exception, owner/admin full list, reader mode + own entry) routes; projection of `ownerId`/`grants` on `get`/`list`/`ensure` summaries; transport profile allows the two new capabilities.
  - [x] `src/profile/contracts.ts` + `src/mcp-core.ts`: two new capability names, static frozen definitions, read-only mutability, executor routes; `ARTIFACTS_PROVIDER_VERSION` 0.2.13.
  - [x] `src/profile/schemas.ts` + `src/profile/index.ts` + `src/profile/radar.ts`: operation profiles `set_access` / `lookup_people` / `list_access` in the shipped profile, schemas and routes for the new operations.
  - [x] `src/adapters/postgres-management.ts` + `src/adapters/postgres.ts`: grant `created_at` round-trip.
  - [x] `src/server/templates.ts`: authoring-guide lines for the two new tools (guide text only, never a tool definition).
  - [x] Lot gate: full `make test-artifacts ENV=test-share-g2` + `make test-artifacts-integration ENV=test-share-g2` green; `make typecheck-artifacts`, `make lint-artifacts` green; `make down-volumes ENV=test-share-g2`.
- [x] **Lot 3 — Refresh pins/locks/manifests through make, commit, push, PR, CI**
  - [x] Bump `packages/artifacts/package.json` to 0.2.13 (> published 0.2.9); CHANGELOG entry.
  - [x] `make lock-root` (BR02-EX2) + api lock one-liner; BR02-EX3 cluster-mesh fixtures via packaging.mk (`refresh-lazy-package-lock` with the packed 0.2.13 sibling receipt, sha256 15802f3c…, fixture integrity sha512-kq81A5RP…); BR02-EX6 APP-P1 digests recomputed through make (profileDigest 9d216231…, manifestDigest 108f7c19…); BR02-EX5 L5 P1 manifest via `make memory-l5-pack`.
  - [x] Rebase onto origin/main 3dd7d8012 (#907, 0.2.12): 11 commits replayed, version-line conflicts kept at 0.2.13, CHANGELOG unioned (0.2.13 over 0.2.12). Post-rebase refresh through make: 0.2.13 repacked + sibling receipts recollected (sha256 844fdaaa…), `refresh-lazy-package-lock` (fixture integrity sha512-+MzlH…), L5 P1 manifest regenerated (previous 75dfe0ca… retained in history/, new bb425aed…).
  - [x] Post-rebase gates: `make scope-check` PASS C2; `make typecheck-artifacts`, `make lint-artifacts` PASS; `make test-artifacts` 556/556; `make test-artifacts-integration` green on rerun (one transient 1-failed/28-passed first run, identity not captured, two consecutive full-green reruns on the same commit); api pin tests (`app-mcp-registry`, `app-mcp-installed`, `artifacts-host-publication`) PASS — APP-P1 digests unchanged by the rebase.
  - [ ] Atomic commits via `make commit MSG="…"` (≤150 lines each, specific `git add` only, BRANCH.md checkboxes updated in the same commits); `make scope-check` before every commit; no AI trailers.
  - [ ] Push `feat/share-g2-mcp-tools` to origin after the commit wave (crash safety).
  - [ ] Open READY PR (title/body from this BRANCH.md, English, test plan included), wait for exactly one CI run on the final head; report results.
  - [ ] Write report to `.tmp/rv/share-g2.md` (root workspace). Do NOT merge; do NOT delete BRANCH.md. End with `make down-volumes ENV=test-share-g2`.
