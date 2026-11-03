# Feature: Byte-stable MCP tool definitions (artifacts provider + mcp-platform composition)

## Objective
MCP `tools/list` tool definitions (name, description, inputSchema, outputSchema, annotations, _meta) become byte-stable across deployments, package versions and profile switches, because claude.ai resets per-tool "Always allow" permissions whenever a tool definition changes. Dynamic contract values (profile revision, provider version, capability selection, limits) move into tool results, the API guide, or server metadata that clients do not use for per-tool permission identity.

## Scope / Guardrails
- Scope limited to `packages/artifacts` (mcp-core.ts, profile/contracts.ts, tool specs, tests, README/CHANGELOG/package.json), `packages/mcp-platform` (tests + README only, no src change), and the APP-P1 pin sites in `api/src/services/mcp/cluster-registry.ts` + `api/tests/api/app-mcp-registry.test.ts` + `api/tests/api/app-mcp-installed.test.ts`.
- The APP-P1 manifest pin semantics are kept: `computeManifestDigest` still covers the full tool definitions; the pin is refreshed once for the deliberate definition stabilization, never weakened.
- Make-only workflow; tests on `ENV=test-mcp-stable` only; `make down ENV=test-mcp-stable` at the end.
- Branch development happens in worktree `tmp/worktrees/mcp-stable-tool-defs` (branch `feat/mcp-stable-tool-definitions` from `origin/main`).
- In every `make` command, `ENV=<env>` is passed as the last argument.
- All new text in English. No `[skip ci]` anywhere.
- Open PRs #890 (0.2.7), #893 (single-label host), #891 (sqlite U1, 0.3.0) must NOT change existing tool definitions; their diffs are audited and reported in `.tmp/rv/mcp-stable-tool-defs.md`. This branch bumps `@sentropic/artifacts` to 0.2.8 to leave 0.2.7 to #890/#893 and 0.3.0 to #891.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/artifacts/src/**`
  - `packages/artifacts/tests/**`
  - `packages/artifacts/README.md`
  - `packages/artifacts/CHANGELOG.md`
  - `packages/artifacts/package.json`
  - `packages/mcp-platform/tests/**`
  - `packages/mcp-platform/README.md`
  - `api/src/services/mcp/cluster-registry.ts`
  - `api/tests/api/app-mcp-registry.test.ts`
  - `api/tests/api/app-mcp-installed.test.ts`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/mcp-platform/src/**` (audit found no dynamic values there; rule enforced by snapshot test + README)
  - `packages/cluster-mesh/**`
  - `api/src/**` except `api/src/services/mcp/cluster-registry.ts`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- (empty)

## AI Flaky tests
- Acceptance rule: no AI-flaky tests are involved; all tests here are deterministic.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single branch, single final test cycle)
- Rationale: one cohesive rule change across two packages plus pin sites; no parallel sub-workstreams.

## UAT Management (in orchestration context)
- **Mono-branch**: no UI surface change; package-level vitest lanes only (`make test-mcp-platform`, `make test-artifacts`, scoped api registry tests) on `ENV=test-mcp-stable`.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `.tmp/packets/COMMON-RULES.md`.
  - [x] Worktree `tmp/worktrees/mcp-stable-tool-defs` on `feat/mcp-stable-tool-definitions` from `origin/main`; `harness check branch` PASS.
  - [x] Audit tools/list definitions: artifacts `description` embeds `profileRevisionId`/`resultEnvelopeVersion`; `inputSchema` is profile-derived; `outputSchema` switches on `resultEnvelopeVersion`; mcp-platform composed descriptors are static (memory tools frozen; bridge passes host descriptors through).
  - [x] Audit PRs #890/#893/#891 against definition stability (report in `.tmp/rv/mcp-stable-tool-defs.md`).
  - [x] Confirm command style: `make ... ENV=test-mcp-stable` with ENV last; Docker lock via `flock .tmp/packets/DOCKER-LOCK.md` per command.

- [x] **Lot 1 — Static artifacts tool definitions**
  - [x] Add frozen static tool definitions (description, inputSchema, outputSchema, idempotency, gates) for all 17 `artifacts_*` tools in `packages/artifacts/src/mcp-core.ts` (`ARTIFACTS_TOOL_DEFINITIONS`).
  - [x] `createArtifactsManifest` builds tool entries from the static definitions only; profile stays in `audit.artifactsProfileDigest` (server metadata) and in typed result details.
  - [x] Update `packages/artifacts/tests/mcp.test.ts` and `parity-r2-profile.test.ts` expectations (description no longer contains the revision; inputSchema is the static definition).
  - [x] Lot gate:
    - [x] `make build-artifacts` / `make build-mcp-platform` (tsc typecheck) green on `ENV=test-mcp-stable`.
    - [x] `make test-artifacts ENV=test-mcp-stable` green (506 tests, incl. mcp.test.ts + parity-r2-profile.test.ts).

- [x] **Lot 2 — Snapshot tests of the tools/list catalogue**
  - [x] `packages/artifacts/tests/tools-list-snapshot.test.ts` + checked-in snapshot JSON: full catalogue (names, descriptions, inputSchema, outputSchema, annotations, _meta) for the APP-P1 profile and for an r2 profile, served over the real SDK bridge; asserts byte-identical definitions across profiles and equality with the snapshot file; header comment explains the claude.ai permission rule.
  - [ ] `packages/mcp-platform/tests/tools-list-snapshot.test.ts` + snapshot JSON: a composed registry (register + select + configure + compile) served through the real SDK bridge (`registerMcpWireTools`), snapshotting the full `tools/list` result.
  - [x] Lot gate: `make test-artifacts ENV=test-mcp-stable` green (506 tests incl. the snapshot test).

- [ ] **Lot 3 — Docs**
  - [ ] `packages/mcp-platform/README.md`: document the byte-stable tool-definition rule (what may/may not appear in a definition; where dynamic values go).
  - [ ] Artifacts API guide (`GUIDE_V1` in `packages/artifacts/src/server/templates.ts`, served by `artifacts_get_api_guide`): same rule; active profile revision/envelope reported in results and server metadata only.
  - [ ] `packages/artifacts/README.md` pointer if it documents the MCP surface.

- [ ] **Lot 4 — Version bump, CHANGELOG, pins**
  - [ ] Bump `packages/artifacts/package.json` 0.2.6 -> 0.2.8 (> published 0.2.6; leaves 0.2.7 to #890/#893, 0.3.0 to #891); CHANGELOG entry.
  - [ ] Recompute APP-P1 manifest digest through the make test lane; refresh `APP_P1_MANIFEST_DIGEST` in `api/src/services/mcp/cluster-registry.ts`, the compatibility receipts + version-witness digest in `api/tests/api/app-mcp-registry.test.ts`, and the receipts in `api/tests/api/app-mcp-installed.test.ts`. Pin semantics unchanged (digest still covers definitions + version + audit).
  - [ ] Lot gate: scoped api registry tests green (`app-mcp-registry.test.ts`, `app-mcp-installed.test.ts`, `app-artifacts-transport.test.ts`) on `ENV=test-mcp-stable`.

- [ ] **Lot N — Final validation**
  - [ ] `make build-artifacts build-mcp-platform ENV=test-mcp-stable` (typecheck/build).
  - [ ] `make test-mcp-platform ENV=test-mcp-stable` and `make test-artifacts ENV=test-mcp-stable` green.
  - [ ] `make scope-check` before every commit; `harness check scope` PASS.
  - [ ] Bumped affected `packages/<pkg>/package.json` version for every package whose `src/**` changed (artifacts only).
  - [ ] `make down ENV=test-mcp-stable` (and `down-volumes` only if merged — not merged here, so `make down`).
  - [ ] Final gate step 1: open READY PR using `BRANCH.md` text as PR body.
  - [ ] Final gate step 2: one CI run on the PR head; resolve blockers.
  - [ ] Report written to `.tmp/rv/mcp-stable-tool-defs.md` (audit findings, changes, PR #890/#893/#891 definition impact). Do not merge.
