# Feature: Byte-stable MCP tool definitions (artifacts provider + mcp-platform composition)

## Objective
MCP `tools/list` tool definitions (name, description, inputSchema, outputSchema, annotations, _meta) become byte-stable across deployments, package versions and profile switches, because claude.ai resets per-tool "Always allow" permissions whenever a tool definition changes. Dynamic contract values (profile revision, provider version, capability selection, limits) move into tool results, the API guide, or server metadata that clients do not use for per-tool permission identity.

## Scope / Guardrails
- Scope limited to `packages/artifacts` (mcp-core.ts, profile/contracts.ts, tool specs, tests, README/CHANGELOG/package.json), `packages/mcp-platform` (tests + README only, no src change), and the APP-P1 pin sites in `api/src/services/mcp/cluster-registry.ts` + `api/tests/api/app-mcp-registry.test.ts` + `api/tests/api/app-mcp-installed.test.ts`.
- The APP-P1 manifest pin semantics are kept: `computeManifestDigest` still covers the full tool definitions; the pin is refreshed once for the deliberate definition stabilization, never weakened.
- Make-only workflow; tests on `ENV=test-mcp-stable-rebase` only; `make down-volumes ENV=test-mcp-stable-rebase` at the end.
- Branch development happens in worktree `tmp/worktrees/mcp-stable-tool-defs` (branch `feat/mcp-stable-tool-definitions` from `origin/main`).
- In every `make` command, `ENV=<env>` is passed as the last argument.
- All new text in English. No `[skip ci]` anywhere.
- Open PRs #890 (0.2.7), #893 (single-label host), #891 (sqlite U1, 0.3.0) must NOT change existing tool definitions; their diffs are audited and reported in `.tmp/rv/mcp-stable-tool-defs.md`. After the rebase onto origin/main (which published 0.2.7 via #890 and 0.2.8 via #893), this branch bumps `@sentropic/artifacts` to 0.2.9 (conductor allocation: #896=0.2.9, #901=0.3.0, #891=0.3.1); conflicts in the five pin/definition files are resolved as a union keeping #890 and #893 behaviours plus the byte-stable rule.
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

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
  - `package-lock.json` and `api/package-lock.json` — mechanical lockfile sync of the 0.2.9 version bump only (version-string-only diffs, same pattern as origin/main ddbe7b65e / 6b46b91fe); explicit allowed wins over the `api/**` forbidden glob
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
- **Mono-branch**: no UI surface change; package-level vitest lanes only (`make test-mcp-platform`, `make test-artifacts`, scoped api registry tests) on `ENV=test-mcp-stable-rebase`.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `.tmp/packets/COMMON-RULES.md`.
  - [x] Worktree `tmp/worktrees/mcp-stable-tool-defs` on `feat/mcp-stable-tool-definitions` from `origin/main`; `harness check branch` PASS.
  - [x] Audit tools/list definitions: artifacts `description` embeds `profileRevisionId`/`resultEnvelopeVersion`; `inputSchema` is profile-derived; `outputSchema` switches on `resultEnvelopeVersion`; mcp-platform composed descriptors are static (memory tools frozen; bridge passes host descriptors through).
  - [x] Audit PRs #890/#893/#891 against definition stability (report in `.tmp/rv/mcp-stable-tool-defs.md`).
  - [x] Confirm command style: `make ... ENV=test-mcp-stable-rebase` with ENV last; Docker lock via `flock .tmp/packets/DOCKER-LOCK.md` per command.

- [x] **Lot 1 — Static artifacts tool definitions**
  - [x] Add frozen static tool definitions (description, inputSchema, outputSchema, idempotency, gates) for all 17 `artifacts_*` tools in `packages/artifacts/src/mcp-core.ts` (`ARTIFACTS_TOOL_DEFINITIONS`).
  - [x] `createArtifactsManifest` builds tool entries from the static definitions only; profile stays in `audit.artifactsProfileDigest` (server metadata) and in typed result details.
  - [x] Static `oneOf` constraints kept in the static input schemas (file text/bytes exclusivity, publish files/edits exclusivity, set_access grant/revoke rules): `oneOf` is a compile-time constraint, not a per-deployment value; required by `probe-artifacts-packed-consumer` (`packed-consumer.mjs` asserts `fileSchema.oneOf.length === 2`).
  - [x] Update `packages/artifacts/tests/mcp.test.ts` and `parity-r2-profile.test.ts` expectations (description no longer contains the revision; inputSchema is the static definition).
  - [x] Lot gate:
    - [x] `make build-artifacts` / `make build-mcp-platform` (tsc typecheck) green on `ENV=test-mcp-stable-rebase`.
    - [x] `make test-artifacts ENV=test-mcp-stable-rebase` green (506 tests, incl. mcp.test.ts + parity-r2-profile.test.ts).

- [x] **Lot 2 — Snapshot tests of the tools/list catalogue**
  - [x] `packages/artifacts/tests/tools-list-snapshot.test.ts` + checked-in snapshot JSON: full catalogue (names, descriptions, inputSchema, outputSchema, annotations, _meta) for the APP-P1 profile and for an r2 profile, served over the real SDK bridge; asserts byte-identical definitions across profiles and equality with the snapshot file; header comment explains the claude.ai permission rule.
  - [x] `packages/mcp-platform/tests/tools-list-snapshot.test.ts` + snapshot JSON: a composed registry (register + select + configure + compile) served through the real SDK bridge (`registerMcpWireTools` over an in-memory link), snapshotting the full `tools/list` result; also asserts the catalogue is byte-identical across recompiles with different configuration values.
  - [x] Lot gate: `make test-artifacts ENV=test-mcp-stable-rebase` green (506 tests), `make test-mcp-platform ENV=test-mcp-stable-rebase` green (352 tests incl. the snapshot test).

- [x] **Lot 3 — Docs**
  - [x] `packages/mcp-platform/README.md`: "Stable tool definitions (permission identity)" section — what may/may not appear in a definition, where dynamic values go, snapshot-test update procedure.
  - [x] Artifacts API guide (`GUIDE_V1` in `packages/artifacts/src/server/templates.ts`, served by `artifacts_get_api_guide`): same rule; active profile revision/envelope reported in results and audit metadata only.
  - [x] `packages/artifacts/README.md` pointer on the `src/mcp-core.ts` bullet.

- [x] **Lot 4 — Version bump, CHANGELOG, pins**
  - [x] Bump `packages/artifacts/package.json` 0.2.8 -> 0.2.9 (> published 0.2.8; #901 takes 0.3.0, #891 takes 0.3.1); CHANGELOG entry under `## 0.2.9` above main's `## 0.2.8`; `ARTIFACTS_PROVIDER_VERSION` = '0.2.9'.
  - [x] Recompute APP-P1 manifest digest through the make test lane; refreshed `APP_P1_MANIFEST_DIGEST` = `96226d32f64ca7ac06749d5083084b6f572eac23d27256cae8d37e7f7579933d` in `api/src/services/mcp/cluster-registry.ts`, the compatibility receipts + version-witness digest (`da14b7bd...`, manifest with `version: '0.2.5'`) in `api/tests/api/app-mcp-registry.test.ts`, and the receipts + version assertion in `api/tests/api/app-mcp-installed.test.ts`. Pin semantics unchanged (digest still covers definitions + version + audit); `APP_P1_PROFILE_DIGEST` unchanged.
  - [x] Lot gate: scoped api tests green on `ENV=test-mcp-stable-rebase` — `app-mcp-registry.test.ts`, `app-mcp-installed.test.ts`, `app-artifacts-transport.test.ts` (32 tests).

- [x] **Lot N — Final validation**
  - [x] `make build-artifacts` / `make build-mcp-platform` (via test lanes, tsc typecheck) green on `ENV=test-mcp-stable-rebase`.
  - [x] `make test-mcp-platform ENV=test-mcp-stable-rebase` (39 files / 352 tests) and `make test-artifacts ENV=test-mcp-stable-rebase` (48 files / 506 tests) green.
  - [x] `make probe-artifacts-packed-consumer ENV=test-mcp-stable-rebase` green (`PACKED_MCP_CORE_OK` / `PACKED_CONSUMER_OK` / `PACKED_ADAPTERS_OK`; `fileSchema.oneOf.length === 2` assertion passes).
  - [x] `make scope-check` PASS before every commit; `harness check scope` PASS.
  - [x] Bumped affected `packages/<pkg>/package.json` version for every package whose `src/**` changed (artifacts only, 0.2.9).
  - [x] `make down-volumes ENV=test-mcp-stable-rebase` after the api-test lane (exit 0).
  - [ ] Final gate step 1: open READY PR using `BRANCH.md` text as PR body (PR #896 open).
  - [ ] Final gate step 2: one CI run on the PR head; resolve blockers.
  - [ ] Report written to `.tmp/rv/mcp-stable-tool-defs.md` (audit findings, changes, PR #890/#893/#891 definition impact). Do not merge.

- [x] **Lot R — Rebase onto origin/main (union) + 0.2.9**
  - [x] `git rebase origin/main`; conflicts in `api/src/services/mcp/cluster-registry.ts`, `api/tests/api/app-mcp-installed.test.ts`, `api/tests/api/app-mcp-registry.test.ts`, `packages/artifacts/CHANGELOG.md`, `packages/artifacts/src/mcp-core.ts` resolved as a UNION: #890 (get_source text/base64 description) and #893 (single-label host, 0.2.8) behaviours kept; #896 byte-stable rule kept (static definitions, dynamic data in results only).
  - [x] `@sentropic/artifacts` bumped to 0.2.9 (conductor allocation; 0.3.0 reserved for #901, 0.3.1 for #891); CHANGELOG `## 0.2.9` entry above main's `## 0.2.8`; post-rebase gate: 0.2.9 > published 0.2.8.
  - [x] tools/list snapshots regenerated deliberately (delete JSON + re-run snapshot test) and covering main's current definitions (incl. the #890 get_source description); artifacts snapshot diff is exactly the two #890 get_source description lines, mcp-platform snapshot byte-identical.
  - [x] Lockfiles refreshed via `make lock-root` (root lock: artifacts 0.2.8→0.2.9 + mcp-platform 0.4.0→0.4.1 sync) and the api lock via the one-line `"../packages/artifacts"` version-string bump (same pattern as origin/main ddbe7b65e; api is a root workspace so npm updates the root lock only); APP-P1 manifest pin recomputed through the make test lane (guard unchanged: digest still covers full definitions + version + audit).
  - [x] Final validation LAST on `ENV=test-mcp-stable-rebase`: scoped api MCP registry tests (26/26), `make test-artifacts` (48 files / 509 tests), `make test-mcp-platform` (39 files / 352 tests), then `make down-volumes ENV=test-mcp-stable-rebase` (exit 0, containers/volumes/networks removed).
  - [x] `make commit`, `git push --force-with-lease` (one CI), report to `.tmp/rv/mcp-stable-rebase.md`. Do not merge.
