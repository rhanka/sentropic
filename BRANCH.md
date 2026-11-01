# Feature: artifacts parity P0 (list_versions, revert, conflict detection, metadata, edits, get_source)

## Objective
Close the generic P0 gaps of @sentropic/artifacts so the artifact MCP reaches Claude-artifacts parity for the modification lifecycle: version history, revert, optimistic-concurrency conflict detection, title/description/icon metadata, small old/new edits on publish, and source read-back for editing.

## Scope / Guardrails
- Scope limited to `packages/artifacts/**` plus the artifacts-host wiring in `api/src/services/artifacts/composition.ts` (only if the dep shape forces it).
- Reuse the existing commit/release/current-pointer model; no redesign.
- Make-only workflow, Docker under the single flock `/home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md`, `ENV=test-artifacts-parity` always LAST, `make down ENV=test-artifacts-parity` after; never `ENV=dev`; never `make clean-all`.
- Tests first: new unit suite `packages/artifacts/tests/parity-p0.test.ts`; run via `make test-artifacts SCOPE=packages/artifacts/tests/parity-p0.test.ts ENV=test-artifacts-parity` plus the full package unit suite, `make typecheck-artifacts`, `make build-artifacts`.
- Commits: `make commit MSG="..."` only, <=150 lines each, selective `git add`, push after each commit.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/artifacts/**`
  - `api/src/services/artifacts/composition.ts` (host store wiring only)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `packages/artifacts/l0-freeze/**` (frozen L0 contract vectors)
  - `packages/artifacts/probe/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file) — not needed; the artifacts schema migration lives in `packages/artifacts/migrations/`
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- (none open)

## AI Flaky tests
- Acceptance rule: only non-systematic provider/network/model nondeterminism as `flaky accepted`; never additive timeouts. None expected here (pure unit tests, no AI calls).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single branch `feat/artifacts-parity-p0`, one final test cycle)
- [ ] **Multi-branch**
- Rationale: one package, one concern; no orthogonal sub-workstreams.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read rules/MASTER.md, rules/workflow.md, COMMON-RULES packet, conductor brief.
  - [x] Worktree `tmp/worktrees/artifacts-parity-p0` on `feat/artifacts-parity-p0` from origin/main; `harness check branch` PASS.
  - [x] Make targets: `make test-artifacts SCOPE=... ENV=test-artifacts-parity`, `make typecheck-artifacts`, `make build-artifacts`, `make commit`, `make scope-check`, `make down`.
  - [x] Docker under flock `.tmp/packets/DOCKER-LOCK.md`, ENV last.
- [x] **Lot 1 — Tests first (tests/parity-p0-*.test.ts + fixtures/parity-world.ts)**
  - [x]  `artifacts_list_versions`: history of one artifact (id, createdAt, author, state, isCurrent, digest); read scope; foreign scope/not found hidden.
  - [ ] `artifacts_revert`: new release copying earlier content (stable URL, history grows); purged release refused with typed error; write scope + idempotency.
  - [x]  conflict: `expectedCurrentReleaseId` on publish and revert; mismatch returns typed `conflict` carrying current release id + digest; absent field keeps today's behaviour.
  - [x]  metadata: title/description/icon accepted on ensure and publish, returned by get and list.
  - [x]  edits: `edits:[{path,oldStr,newStr}]` on publish applied to current release text files; oldStr != exactly once -> typed `edit_mismatch`, nothing changed; result goes through the same commit path.
  - [x]  get_source: returns current content files (text decoded) for editing.
  - [x]  MCP executor routes the three new tools; manifest exposes them when selected.
- [x] **Lot 2 — Implementation**
  - [ ] profile/contracts.ts: add `artifacts_list_versions`, `artifacts_revert` to capability names.
  - [ ] profile/schemas.ts + validation.ts + index.ts: schemas for new ops; publish gains optional `expectedCurrentReleaseId`, `edits`, metadata; ensure gains metadata; files becomes conditionally required (files XOR edits); revert schema; routes in capabilityForRoute; idempotency for revert.
  - [ ] server/failures.ts: typed `edit_mismatch` (422) and conflict details carrier on `pointer_conflict`.
  - [ ] server/edits.ts: pure edit application with exactly-once rule.
  - [ ] server/publication.ts: `listReleases` on state store + service; memory double.
  - [ ] server/access.ts: optional `metadata` on ArtifactAcl; postgres adapter + migration 0004 for the metadata column.
  - [ ] server/command-identity.ts: allow `revert` operation in command/derivation.
  - [ ] http.ts: routes + handlers for /versions/:id, /source/:id, /revert; conflict pre-check; edits application; metadata read/write on ensure/publish; metadata in get/list; get_source content.
  - [ ] mcp-core.ts: route new tools; read-only mutability for list_versions; provider version bump.
  - [ ] server/outcome-projection.ts: carry conflict details in HTTP body and MCP error.
  - [ ] api host composition.ts: supply getRelease/listReleases if the dep shape requires.
  - [ ] templates.ts API guide text; CHANGELOG.md; package.json version bump (minor 0.3.0, must be > published 0.2.4).
- [~] **Lot 3 — Verify & ship**
  - [x] `make test-artifacts ENV=test-artifacts-parity` (full unit suite 472/472) green under flock; typecheck + build green; `make typecheck-artifacts`, `make build-artifacts` green; `make down ENV=test-artifacts-parity`.
  - [ ] `make scope-check` before each commit; commits <=150 lines; push after each commit.
  - [ ] Draft PR from BRANCH.md; ONE CI run on the final head; report to `.tmp/rv/artifacts-parity-p0.md`; do not merge.
