# Feature: Host-configured external sources on the artifacts content CSP

## Objective
Let an artifacts host allow exact HTTPS origins as frame sources and as
media/image sources on served HTML (radar-immobilier AQX: YouTube nocookie
embeds and Sentropic bucket media), without changing any policy by default.

## Scope / Guardrails
- Scope limited to `packages/artifacts/src/content/headers.ts` and its tests.
- Make-only workflow, no direct Docker commands; `ENV` last, `ENV=test-*` only.
- Branch development in `tmp/artifacts-csp-external-sources`.
- Version bump 0.2.29 required by `enforce-package-bump`; publication stays a separate CI act.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/artifacts/src/content/headers.ts`
  - `packages/artifacts/tests/content-external-sources.test.ts`
  - `packages/artifacts/package.json`
  - `packages/artifacts/CHANGELOG.md`
  - `package-lock.json`
  - `api/package-lock.json`
  - `packages/artifacts/src/mcp-core.ts`
  - `api/src/services/mcp/cluster-registry.ts`
  - `api/tests/api/app-mcp-installed.test.ts`
  - `api/tests/api/app-mcp-registry.test.ts`
  - `api/tests/api/mcp-workspaces-list-dispatch.test.ts`
  - `packages/cluster-mesh/tests/packaging/artifacts-tuple.spec.ts`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - none

## Feedback Loop
- `acknowledge`: version bump 0.2.29 (package, CHANGELOG, root and api lockfiles) required by
  `enforce-package-bump`; CI publishes it on merge. Rollback: revert the bump commit.
- `attention`: consumer is rhanka/radar-immobilier branch
  `feat/artifacts-quota-exceptions`, which composes the same directives
  host-side until a qualified provider release carries this option.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: one additive, opt-in option.

## Plan / Todo (lot-based)
- [ ] **Lot 1 — Opt-in external sources**
  - [x] `ContentHeaderInput.externalSources` (`frame`, `media`), HTML only, both modes.
  - [x] `withExternalSources` refuses any value that is not an exact HTTPS origin.
  - [x] Unit tests: unchanged defaults, directive-only changes, non-HTML untouched, refusals.
  - [x] Lot gate: `make typecheck-artifacts` + `make test-artifacts SCOPE=tests/content-` on `ENV=test-artifacts-csp` (7 files, 90 tests).
- [ ] **Lot 2 — Merge & close**
  - [x] Bump `packages/artifacts` 0.2.28 -> 0.2.29 (CHANGELOG, root and api lockfiles) for `enforce-package-bump`.
  - [x] `ARTIFACTS_PROVIDER_VERSION` follows 0.2.29; APP-P1 manifest digest repinned through the version field only
    (`83dd0a2c6381363e87e53e556a462dd3e65256dd488fca277d313d9843259ef7`, computed with the API test construction,
    which reproduces the pinned 0.2.28 digest `b7d6d576...`), as the 0.2.25 and 0.2.23 releases did.
  - [ ] Push branch, open PR, verify CI green.
